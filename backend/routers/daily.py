from datetime import date, timedelta
import json

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse

from models import (
    DailyDayView, DailyDrawRecord, DailyDrawRequest, DailyDrawResponse,
    DailyFeedbackRequest, DailyOverviewResponse, DrawCardsRequest,
    Message, MessageRole, SessionType, User,
)
from services.conversation_service import ConversationService
from services.daily_service import CALENDAR_DAYS, DailyService, compute_streak, extract_tagline
from services.gemini_service import GeminiService
from services.notebook_service import notebook_service
from services.tarot_service import TarotService
from services.user_service import UserService
from services.rate_limit_service import RateLimitService
from dependencies import get_current_user, ensure_owner

router = APIRouter(prefix="/api/daily", tags=["daily"])

gemini_service = GeminiService()


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="无效的日期格式,应为 YYYY-MM-DD")


@router.get("/{user_id}/overview", response_model=DailyOverviewResponse)
async def get_overview(
    user_id: str,
    date_param: str = Query(..., alias="date"),
    current_user: User = Depends(get_current_user),
):
    """近 14 天日运概览:逐日记录 + 签语(懒取) + streak。
    date 为前端按本地时间(18:00 切日)算出的今日生效日。"""
    ensure_owner(current_user, user_id)
    today = _parse_date(date_param)
    records = await DailyService.get_user_records(user_id)
    streak = compute_streak(set(records.keys()), today)

    history: list = []
    for i in range(CALENDAR_DAYS - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        rec = records.get(d)
        view = DailyDayView(effective_date=d, record=rec)
        if rec:
            conv = await ConversationService.get_conversation(rec.conversation_id)
            view.conversation_exists = conv is not None
            view.tagline = extract_tagline(conv)
        history.append(view)

    return DailyOverviewResponse(
        today_effective_date=date_param,
        today_record=records.get(date_param),
        streak=streak,
        history=history,
    )


@router.post("/{user_id}/draw", response_model=DailyDrawResponse)
async def draw_daily(
    user_id: str,
    body: DailyDrawRequest,
    current_user: User = Depends(get_current_user),
):
    """每日抽牌:一日一次。创建 daily 对话 + 服务端随机单张 + 落记录。
    解读不在此生成——前端随后走 /api/tarot/message 流式触发。"""
    ensure_owner(current_user, user_id)
    eff = _parse_date(body.effective_date)
    if abs((eff - date.today()).days) > 1:
        raise HTTPException(status_code=422, detail="生效日期超出允许范围")

    if await DailyService.get_record(user_id, body.effective_date):
        raise HTTPException(status_code=409, detail="这一日已抽过签")

    user = await UserService.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    conversation = await ConversationService.create_conversation(user_id, SessionType.DAILY)
    await ConversationService.update_conversation_title(
        conversation.conversation_id, f"{eff.month}月{eff.day}日 · 每日一签"
    )

    draw_request = DrawCardsRequest(spread_type="single", card_count=1, positions=["今日指引"])
    cards = TarotService.draw_cards(draw_request)
    await ConversationService.add_message(
        conversation.conversation_id, MessageRole.SYSTEM, "用户已完成抽牌",
        tarot_cards=cards, draw_request=draw_request,
    )
    await ConversationService.mark_cards_drawn(conversation.conversation_id)

    record = DailyDrawRecord(
        effective_date=body.effective_date,
        card=cards[0],
        conversation_id=conversation.conversation_id,
    )
    await DailyService.save_record(user_id, record)
    return DailyDrawResponse(record=record, conversation_id=conversation.conversation_id)


@router.post("/{user_id}/feedback", response_model=DailyDrawRecord)
async def save_feedback(
    user_id: str,
    body: DailyFeedbackRequest,
    current_user: User = Depends(get_current_user),
):
    """印证反馈:任意有记录的日期均可写入/修改(整体覆盖)"""
    ensure_owner(current_user, user_id)
    record = await DailyService.update_feedback(
        user_id, body.effective_date, body.verdict, body.note
    )
    if not record:
        raise HTTPException(status_code=404, detail="该日没有日运记录")
    return record


@router.post("/{user_id}/journey")
async def generate_journey(
    user_id: str,
    date_param: str = Query(..., alias="date"),
    force: bool = False,
    current_user: User = Depends(get_current_user),
):
    """心灵奇旅(用户主动触发,SSE 流式)。同日缓存命中且非 force 时直接回放,不花 token。"""
    ensure_owner(current_user, user_id)
    _parse_date(date_param)

    cache = await DailyService.get_journey_cache(user_id)
    if cache and cache.get("generated_on") == date_param and not force:
        async def replay():
            yield f"data: {json.dumps({'content': cache['text']}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(replay(), media_type="text/event-stream")

    # 用量控制：缓存未命中、确实要调 LLM 时才扣额度
    await RateLimitService.check_and_consume(current_user)

    user = await UserService.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    entries = notebook_service.get_notebook(user_id)
    prompt = await DailyService.build_journey_prompt(user_id, date_param, user, entries)
    if prompt is None:
        raise HTTPException(status_code=400, detail="记录不足,再积累几天")

    async def generate():
        full = ""
        seed = Message(role=MessageRole.USER, content="请回望我最近的旅程,讲给我听。")
        async for event in gemini_service.stream_response(
            [seed], user,
            session_type=SessionType.CHAT,
            system_prompt_override=prompt,
        ):
            if "content" in event:
                full += event["content"]
                yield f"data: {json.dumps({'content': event['content']}, ensure_ascii=False)}\n\n"
        if full.strip():
            await DailyService.save_journey_cache(user_id, date_param, full)
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
