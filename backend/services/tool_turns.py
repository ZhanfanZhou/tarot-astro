"""工具轮的落库形状与 interrupt 收口。

一次工具调用在会话里是两条记录：ASSISTANT（带 tool_calls）+ TOOL（带 tool_call_id）。
Loop 内执行的工具（星盘、笔记本、交单）两条都由 Agent Loop 产出；interrupt 式工具
（抽牌、补资料）调用那条由 Loop 产出，结果那条要等用户动手：
  · 抽牌   → /draw 生成真牌，写 TOOL
  · 补资料 → 用户提交表单后调 /resume，服务端从用户当前 profile 取值写 TOOL
  · 用户不做、直接发消息 → /message 先写一条「没做」的 TOOL，再写用户发言
没有结果的调用不能留在历史末尾：两家 API 都要求每个调用后面跟着它的结果。
"""
import json
import uuid
from typing import List, Optional

from models import (
    Conversation, DrawCardsRequest, Message, MessageRole, TarotCard, ToolCallRecord, User,
)
from services.llm import tools as toolspecs


def new_call_id(name: str) -> str:
    return f"{name}-{uuid.uuid4().hex[:8]}"


def assistant_message(
    text: str, calls: Optional[List[ToolCallRecord]] = None, reasoning: str = "",
) -> Message:
    return Message(role=MessageRole.ASSISTANT, content=text or "", tool_calls=calls or None,
                   reasoning=(reasoning or None) if calls else None)


def tool_message(
    call: ToolCallRecord, result: dict, *,
    tarot_cards: Optional[List[TarotCard]] = None,
    draw_request: Optional[DrawCardsRequest] = None,
) -> Message:
    return Message(
        role=MessageRole.TOOL,
        content=json.dumps(result, ensure_ascii=False),
        tool_call_id=call.id, tool_name=call.name,
        tarot_cards=tarot_cards, draw_request=draw_request,
    )


def pending_interrupt(conversation: Conversation) -> Optional[ToolCallRecord]:
    """历史末尾是一次还没有结果的 interrupt 调用 → 返回它。"""
    if not conversation.messages:
        return None
    last = conversation.messages[-1]
    if last.role == MessageRole.ASSISTANT and last.tool_calls:
        call = last.tool_calls[0]
        if call.name in toolspecs.INTERRUPT_TOOL_NAMES:
            return call
    return None


# ── 各种结果 ──────────────────────────────────────────────────────

def cards_result(cards: List[TarotCard], draw_request: DrawCardsRequest) -> dict:
    """抽牌结果：逐张带位置与正逆。"""
    positions = draw_request.positions or []
    return {"cards": [{
        "position": positions[i] if i < len(positions) else f"第{i + 1}张",
        "card": c.card_name,
        "orientation": "逆位" if c.reversed else "正位",
    } for i, c in enumerate(cards)]}


def profile_result(user: Optional[User]) -> dict:
    """request_user_profile 的结果：用户现在填了什么就报什么。缺的字段不出现，
    模型接着调 get_astrology_chart，缺什么由那个工具的结果说。"""
    p = user.profile if user else None
    if not p:
        return {"success": False, "error": "用户没有填写任何资料"}
    provided = {}
    if p.nickname:
        provided["nickname"] = p.nickname
    if p.gender:
        provided["gender"] = getattr(p.gender, "value", p.gender)
    if all([p.birth_year, p.birth_month, p.birth_day]):
        provided["birth_date"] = f"{p.birth_year}-{p.birth_month:02d}-{p.birth_day:02d}"
    if p.birth_hour is not None and p.birth_minute is not None:
        provided["birth_time"] = f"{p.birth_hour:02d}:{p.birth_minute:02d}"
    if p.birth_city:
        provided["birth_city"] = p.birth_city
    return {"success": True, "profile": provided}


_DECLINED = {
    "draw_tarot_cards": "用户没有抽牌，直接继续了对话",
    "request_user_profile": "用户没有填写资料，直接继续了对话",
}


def declined_result(call: ToolCallRecord) -> dict:
    return {"success": False, "error": _DECLINED.get(call.name, "用户没有完成这一步，直接继续了对话")}


# ── 旧格式会话 ────────────────────────────────────────────────────

LEGACY_READ_ONLY_DETAIL = "这是旧版本的对话，只能查看；想继续聊请开一场新的。"


def is_legacy(conversation: Conversation) -> bool:
    """2026-09 之前的会话：工具结果套在 SYSTEM 里、触发语伪装成用户发言。
    那时没有记录调用，历史无法按官方形状重建——只能查看。"""
    return any(
        m.role == MessageRole.SYSTEM or (m.role == MessageRole.TOOL and not m.tool_call_id)
        for m in conversation.messages
    )
