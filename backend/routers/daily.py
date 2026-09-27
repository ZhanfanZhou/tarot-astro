import asyncio
from datetime import date, timedelta
import json
import uuid
import weakref

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse

from models import (
    Conversation, DailyDayView, DailyDrawRecord, DailyDrawRequest, DailyDrawResponse,
    DailyFeedbackRequest, DailyOverviewResponse, DailyReadingResponse, DrawCardsRequest,
    JourneyListResponse,
    Message, MessageRole, SessionType, User,
)
from services import llm
from services.conversation_service import ConversationService
from services.daily_service import (
    CALENDAR_DAYS, DailyService, compute_streak, drew_cards, extract_tagline,
)
from services.notebook_service import notebook_enabled, notebook_service
from services.tarot_service import TarotService
from services.user_service import UserService
from services.rate_limit_service import RateLimitService
from services.storage_service import StorageService
from dependencies import get_current_user, ensure_owner

router = APIRouter(prefix="/api/daily", tags=["daily"])

# 一次性生成（今日解读 / 心灵奇旅）的超时。都是几百字的单次输出，不走 Agent Loop。
GENERATION_TIMEOUT_SECONDS = 60

# 每日一签的牌阵：单张，一个位置
DAILY_DRAW_REQUEST = DrawCardsRequest(spread_type="single", positions=["今日指引"])


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
        journey_ready=await DailyService.journey_ready(user_id, today),
        journey_count=len(await DailyService.get_journeys(user_id)),
    )


@router.post("/{user_id}/draw", response_model=DailyDrawResponse)
async def draw_daily(
    user_id: str,
    body: DailyDrawRequest,
    current_user: User = Depends(get_current_user),
):
    """每日抽牌：一日一次。服务端随机单张，建 daily 对话、落记录，立刻把牌返回。

    解读不在这里写：和占卜里「/draw 抽牌 → /resume 解读」一样分两步，前端拿到牌先翻开，
    再调 /reading 等解读。
    """
    ensure_owner(current_user, user_id)
    eff = _parse_date(body.effective_date)
    if abs((eff - date.today()).days) > 1:
        raise HTTPException(status_code=422, detail="生效日期超出允许范围")

    if await DailyService.get_record(user_id, body.effective_date):
        raise HTTPException(status_code=409, detail="这一日已抽过签")

    cards = TarotService.draw_cards(DAILY_DRAW_REQUEST)
    conversation = Conversation(
        conversation_id=f"conv_{uuid.uuid4().hex[:16]}",
        user_id=user_id,
        session_type=SessionType.DAILY,
        title=f"{eff.month}月{eff.day}日 · 每日一签",
        has_drawn_cards=True,
    )
    record = DailyDrawRecord(
        effective_date=body.effective_date,
        card=cards[0],
        conversation_id=conversation.conversation_id,
    )
    await StorageService.save_conversation(conversation)
    await DailyService.save_record(user_id, record)
    return DailyDrawResponse(record=record, conversation_id=conversation.conversation_id)


# 同一场对话的今日解读一次只写一份。后来的请求（写的时候刷新了页面，重载后又来要）
# 等前一个写完，再看库里有没有。线上是单个 uvicorn worker，锁放进程内就够了；
# 没人再拿着的锁自动从表里消失
_reading_locks: "weakref.WeakValueDictionary[str, asyncio.Lock]" = weakref.WeakValueDictionary()


def _reading_lock(conversation_id: str) -> asyncio.Lock:
    lock = _reading_locks.get(conversation_id)
    if lock is None:
        lock = asyncio.Lock()
        _reading_locks[conversation_id] = lock
    return lock


@router.post("/{user_id}/reading", response_model=DailyReadingResponse)
async def read_daily(
    user_id: str,
    body: DailyDrawRequest,
    current_user: User = Depends(get_current_user),
):
    """保证这一日的牌有解读，并把它返回：写好了直接给；正在写就等那一份写完；都不是才开始写。

    页面刷新过、请求断开过都不影响：服务端这次照样写完落库，页面重载后再来要，拿到的是同一份。
    只有真正去写、并且写失败了才报错（503），这时对话里什么都不落，牌照旧，再要一次就是重写。

    牌已经在提示词里，模型没有工具可调，也没有用户发言要回——和开场白同一个道理，
    一次生成、落成这场对话的第一条 assistant，当日的牌挂在它上面。
    """
    ensure_owner(current_user, user_id)
    record = await DailyService.get_record(user_id, body.effective_date)
    if not record:
        raise HTTPException(status_code=404, detail="这一日还没有抽签")

    async with _reading_lock(record.conversation_id):
        conversation = await ConversationService.get_conversation(record.conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        if conversation.messages:
            # 已经写好了（或者已经接着聊起来了）：解读就是首条 assistant
            return DailyReadingResponse(reading=next(
                (m.content for m in conversation.messages if m.role == MessageRole.ASSISTANT), ""))

        user = await UserService.get_user(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")

        # 解读是一次真实 LLM 调用，真去写才计一次；一日一签，不拦
        await RateLimitService.consume(current_user)

        prompt = await DailyService.render_daily_system_prompt(conversation, user)
        try:
            reading = (await llm.get_provider("reading").generate_text(
                prompt, timeout=GENERATION_TIMEOUT_SECONDS,
            )).strip()
        except Exception as e:  # noqa: BLE001 —— 翻成一个前端认得的失败，让用户再要一次
            print(f"[Daily] ⚠️ 今日解读生成失败: {e}")
            raise HTTPException(status_code=503, detail="占卜师暂时联系不上，请重试")
        if not reading:
            raise HTTPException(status_code=503, detail="占卜师暂时联系不上，请重试")

        # 解读 + 当日的牌挂在同一条 assistant 上（没有工具调用，牌不是模型抽的）
        await ConversationService.append_message(conversation.conversation_id, Message(
            role=MessageRole.ASSISTANT, content=reading,
            tarot_cards=[record.card], draw_request=DAILY_DRAW_REQUEST,
        ))
        return DailyReadingResponse(reading=reading)


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


async def _has_unarchived_today(user_id: str) -> bool:
    """今天聊过、但笔记还没写的对话。笔记是退出对话 12 小时后才归档的,所以今天刚发生的
    事进不了这一篇——界面上据此给一句说明,免得用户以为旅程漏了他今天的占卜。"""
    today = date.today().isoformat()
    noted = {e["conversation_id"] for e in notebook_service.get_notes(user_id)}
    return any(
        c.created_at[:10] == today
        and c.conversation_id not in noted
        and len(c.messages) > 1
        and drew_cards(c)
        for c in await StorageService.get_user_conversations(user_id)
    )


@router.get("/{user_id}/journeys", response_model=JourneyListResponse)
async def list_journeys(
    user_id: str,
    date_param: str = Query(..., alias="date"),
    current_user: User = Depends(get_current_user),
):
    """写过的心灵奇旅(新→旧)+ 现在能不能再写一篇 + 今天的记录归没归档。"""
    ensure_owner(current_user, user_id)
    today = _parse_date(date_param)
    return JourneyListResponse(
        entries=await DailyService.get_journeys(user_id),
        ready=await DailyService.journey_ready(user_id, today),
        pending_today=(await _has_unarchived_today(user_id)
                       if notebook_enabled(current_user) else False),
    )


@router.post("/{user_id}/journey")
async def generate_journey(
    user_id: str,
    date_param: str = Query(..., alias="date"),
    current_user: User = Depends(get_current_user),
):
    """心灵奇旅(用户主动触发,SSE 流式)。一天只写一篇:当天那一篇已经写过就直接回放,不花 token。"""
    ensure_owner(current_user, user_id)
    _parse_date(date_param)

    today_piece = await DailyService.get_journey_of_day(user_id, date_param)
    if today_piece:
        async def replay():
            yield f"data: {json.dumps({'content': today_piece['text']}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(replay(), media_type="text/event-stream")

    # 确实要调 LLM 时计一次；一天只写一篇，不拦
    await RateLimitService.consume(current_user)

    user = await UserService.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    entries = notebook_service.get_notes(user_id)
    prompt = await DailyService.build_journey_prompt(user_id, date_param, user, entries)
    if prompt is None:
        raise HTTPException(status_code=400, detail="记录不足,再积累几天")

    # 单次生成：整段提示词就是全部输入，没有对话历史，也没有用户发言要回。
    # 和缓存命中一样整段一次推给前端（Agent Loop 那边的「流式」也只是把完整回复切块）。
    try:
        text = (await llm.get_provider("reading").generate_text(
            prompt, timeout=GENERATION_TIMEOUT_SECONDS,
        )).strip()
    except Exception as e:  # noqa: BLE001
        print(f"[Daily] ⚠️ 心灵奇旅生成失败: {e}")
        raise HTTPException(status_code=503, detail="旅程生成失败，请重试")
    if text:
        await DailyService.save_journey(user_id, date_param, text)

    async def generate():
        yield f"data: {json.dumps({'content': text}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
