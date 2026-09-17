"""一轮对话：校验 → 收口 interrupt → 扣额度 → Agent Loop → 逐条落库 → SSE。

塔罗与占星两个 router 共用（此前各自复制了一份 250 行的同样逻辑）。会话类型、相位、
提示词都从会话本身取，router 只负责路径和鉴权。
"""
import json
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from models import (
    Conversation, DrawCardsRequest, DrawCardsResponse, Message, MessageRole, SessionType, User,
)
from services import opening_service, tool_turns
from services.astrology_service import AstrologyService
from services.conversation_service import ConversationService
from services.daily_service import DailyService
from services.gemini_service import GeminiService
from services.notebook_service import notebook_service
from services.rate_limit_service import RateLimitService
from services.tarot_service import TarotService
from dependencies import ensure_owner

gemini_service = GeminiService()


async def _load(conversation_id: str, current_user: User) -> Conversation:
    conversation = await ConversationService.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")
    ensure_owner(current_user, conversation.user_id)
    if tool_turns.is_legacy(conversation):
        raise HTTPException(status_code=409, detail=tool_turns.LEGACY_READ_ONLY_DETAIL)
    return conversation


async def stream_turn(
    conversation_id: str, current_user: User, user_content: Optional[str],
) -> StreamingResponse:
    """user_content 为 None = resume：用户在界面上做完了动作，不写用户消息。"""
    conversation = await _load(conversation_id, current_user)
    user = current_user
    pending = tool_turns.pending_interrupt(conversation)

    # 先把历史收口成「每个调用后面都跟着结果」，再扣额度、再跑模型
    if user_content is not None:
        if not user_content.strip():
            raise HTTPException(status_code=400, detail="消息内容不能为空")
        appended = []
        if pending:
            # 用户没做那一步（没抽牌 / 没填资料），直接说话了——把这个事实作为结果记下
            appended.append(tool_turns.tool_message(pending, tool_turns.declined_result(pending)))
        appended.append(Message(role=MessageRole.USER, content=user_content))
    else:
        if pending and pending.name == "request_user_profile":
            appended = [tool_turns.tool_message(pending, tool_turns.profile_result(user))]
        elif pending:
            raise HTTPException(status_code=400, detail="还没有抽牌，没有可以继续的内容")
        elif conversation.messages and conversation.messages[-1].role == MessageRole.TOOL:
            appended = []   # 抽牌结果已由 /draw 写好，直接继续
        else:
            raise HTTPException(status_code=400, detail="没有可以继续的内容")

    await RateLimitService.check_and_consume(current_user)
    for msg in appended:
        conversation = await ConversationService.append_message(conversation_id, msg)

    # 开场幕上下文：守卫兜底 + 相位 + 强制交单 + 关系上下文（conversation 可能被就地翻相位）
    phase, force_brief, relationship_block = await opening_service.prepare_opening_context(
        conversation, user
    )

    async def execute_function(func_name: str, func_args: dict) -> dict:
        print(f"\n[Function Executor] 执行函数: {func_name} {func_args}")
        if func_name == "submit_reading_brief":
            # 纯后台工具：落库策略单 + 翻相位，不产生任何前端事件
            await opening_service.save_strategy(conversation, dict(func_args))
            return {"success": True}
        if func_name == "get_astrology_chart":
            return await _fetch_chart(user)
        if func_name == "read_divination_notebook":
            return _read_notebook(conversation.user_id)
        return {"success": False, "error": f"未知的函数: {func_name}"}

    # daily 对话：每次请求实时渲染日运系统提示词（模板热加载 + 近日旅程始终最新）
    system_prompt_override = None
    if conversation.session_type == SessionType.DAILY:
        system_prompt_override = await DailyService.render_daily_system_prompt(conversation, user)

    async def generate():
        async for event in gemini_service.stream_response(
            conversation.messages,
            user,
            function_executor=execute_function,
            session_type=conversation.session_type,
            system_prompt_override=system_prompt_override,
            phase=phase,
            strategy=conversation.strategy,
            relationship_block=relationship_block,
            force_brief=force_brief,
        ):
            if "content" in event:
                yield f"data: {json.dumps({'content': event['content']})}\n\n"
            elif "message" in event:
                # 模型的一轮 / 一个工具结果，按发生顺序落库。抽牌、补资料这类 interrupt 调用
                # 也在这里落库；前端刷新会话后看末尾那条的 tool_calls 决定显示哪个按钮。
                await ConversationService.append_message(conversation_id, event["message"])
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


async def record_draw(
    conversation_id: str, current_user: User, draw_request: DrawCardsRequest,
) -> DrawCardsResponse:
    """用户在抽牌器上抽完了：生成真牌，作为那次 draw_tarot_cards 调用的结果落库。"""
    conversation = await _load(conversation_id, current_user)
    pending = tool_turns.pending_interrupt(conversation)
    if not pending or pending.name != "draw_tarot_cards":
        raise HTTPException(status_code=409, detail="当前没有待抽的牌")

    cards = TarotService.draw_cards(draw_request)
    await ConversationService.append_message(
        conversation_id,
        tool_turns.tool_message(
            pending, tool_turns.cards_result(cards, draw_request),
            tarot_cards=cards, draw_request=draw_request,
        ),
    )
    await ConversationService.mark_cards_drawn(conversation_id)
    return DrawCardsResponse(cards=cards, conversation_id=conversation_id)


# ── Loop 内工具 ────────────────────────────────────────────────────

async def _fetch_chart(user: Optional[User]) -> dict:
    """get_astrology_chart：只报事实。「失败了就去调 request_user_profile」是常驻规则，
    写在工具描述里（llm/tools.py），不在结果里重发。"""
    if not user or not user.profile:
        return {"success": False, "error": "用户尚未提供任何个人信息"}
    p = user.profile
    missing = []
    if not (p.birth_year and p.birth_month and p.birth_day):
        missing.append("birth_date")
    if p.birth_hour is None or p.birth_minute is None:
        missing.append("birth_time")
    if not p.birth_city:
        missing.append("birth_city")
    if missing:
        # 缺哪几项是这次调用才知道的事实，模型拿它填 request_user_profile 的 required_fields
        return {"success": False, "error": "用户的出生信息不完整", "missing_fields": missing}

    chart_data = await AstrologyService.fetch_natal_chart(
        birth_year=p.birth_year, birth_month=p.birth_month, birth_day=p.birth_day,
        birth_hour=p.birth_hour, birth_minute=p.birth_minute, city=p.birth_city,
    )
    if not chart_data:
        return {"success": False, "error": "获取星盘数据失败，请稍后重试"}
    chart_text = AstrologyService.format_chart_data_to_text(chart_data, {
        "birth_year": p.birth_year, "birth_month": p.birth_month, "birth_day": p.birth_day,
        "birth_hour": p.birth_hour, "birth_minute": p.birth_minute, "city": p.birth_city,
    })
    return {"success": True, "data": chart_text}


def _read_notebook(user_id: str) -> dict:
    entries = notebook_service.get_notebook(user_id)
    if not entries:
        return {
            "success": True, "notebook_count": 0,
            "message": "笔记本中暂时还没有记录。当你完成占卜并退出对话后，系统会自动生成占卜记录保存在笔记本中。",
        }
    text = f"用户的占卜笔记本（共 {len(entries)} 条记录）：\n\n"
    for i, entry in enumerate(entries, 1):
        try:
            start_time = datetime.fromisoformat(entry["start_time"]).strftime("%Y年%m月%d日")
        except (KeyError, ValueError, TypeError):
            start_time = entry.get("start_time", "未知时间")
        cards = "、".join(entry.get("cards_drawn") or []) or "无"
        text += (
            f"【记录 {i}】\n时间：{start_time}\n问题：{entry.get('question', '无')}\n"
            f"抽到的牌：{cards}\n记录：{entry.get('summary', '无')}\n"
        )
        if entry.get("user_feedback"):
            text += f"用户反馈：{entry['user_feedback']}\n"
        text += "\n"
    return {"success": True, "notebook_count": len(entries), "notebook_content": text}
