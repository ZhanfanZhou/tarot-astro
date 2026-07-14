"""开场幕上下文服务：相位判定、关系元数据、策略单渲染、两相位的提示词拼装。

「相位」概念的唯一权威——gemini_service、routers、守卫全部问这里，不各自判断，
杜绝「路由认为在开场、工具集却给了抽牌」的分裂。
"""
from datetime import datetime
from typing import Optional

from models import Conversation, SessionType
from services import prompt_service
from services.db import get_db

PHASE_OPENING = "opening"
PHASE_READING = "reading"

# 只有塔罗/占星有开场幕；每日一签/闲聊恒为解读相位
OPENING_PHASE_SESSIONS = {SessionType.TAROT, SessionType.ASTROLOGY}

_ENTRY_LABEL = {
    SessionType.TAROT: "塔罗",
    SessionType.ASTROLOGY: "占星",
}


def get_phase(conversation: Conversation) -> str:
    """当前相位。

    两道门控：session_type（每日一签/闲聊无开场幕）优先；phase 只认 opening，
    其余任何值（含脏数据）一律降级为 reading——宁可跳过开场幕，不可让会话卡死。
    """
    if conversation.session_type not in OPENING_PHASE_SESSIONS:
        return PHASE_READING
    return PHASE_OPENING if conversation.phase == PHASE_OPENING else PHASE_READING


async def build_relationship_meta(user_id: str, current_conversation_id: str) -> dict:
    """关系元数据：来访次数、距上次天数。一条 SQL，不加载会话全文。

    只数「找占卜师的那种来访」——塔罗/占星。每日一签每天自动建一个会话（且有 2+ 条
    消息），闲聊同理；不筛掉它们的话，连续签到 7 天的新客第一次开塔罗就成了「第 8 次
    来访」，占卜师对陌生人说「又来啦」——正是设计要防的认人露馅。

    排除本场；排除只有开场白（消息数 <= 1）的会话——「点开又关」不算一次来访。
    """
    placeholders = ",".join("?" * len(OPENING_PHASE_SESSIONS))
    types = tuple(st.value for st in OPENING_PHASE_SESSIONS)
    async with get_db() as db:
        cur = await db.execute(
            "SELECT COUNT(*) AS cnt, MAX(updated_at) AS last_at "
            "FROM conversations "
            "WHERE user_id = ? AND conversation_id != ? "
            "  AND json_array_length(data, '$.messages') > 1 "
            f"  AND json_extract(data, '$.session_type') IN ({placeholders})",
            (user_id, current_conversation_id, *types),
        )
        row = await cur.fetchone()

    past_visits = row["cnt"] or 0
    last_at = row["last_at"]

    days_since_last = None
    if last_at:
        try:
            delta = datetime.utcnow() - datetime.fromisoformat(last_at)
            days_since_last = max(delta.days, 0)
        except ValueError:
            days_since_last = None

    return {
        "visit_count": past_visits + 1,   # 含本次
        "days_since_last": days_since_last,
    }


def render_relationship_block(meta: dict) -> str:
    """关系上下文块。新客与回头客两种变体；回头客明令禁止翻旧账。"""
    nickname = meta.get("nickname") or "朋友"
    visit_count = meta.get("visit_count", 1)

    if visit_count <= 1:
        return (
            "<关系上下文>\n"
            f"称呼：{nickname} ｜ 首次来访\n"
            "（新客：安静、稳、留白，给他开口的空间）"
        )

    days = meta.get("days_since_last")
    gap = f"距上次：{days} 天" if days is not None else "距上次：不详"
    return (
        "<关系上下文>\n"
        f"称呼：{nickname} ｜ 来访：第 {visit_count} 次 ｜ {gap}\n"
        "（回头客：熟人语气，不主动提及任何旧话题、旧问题、旧牌面）"
    )


_BRIEF_LABELS = [
    ("question_topic", "议题"),
    ("user_goal", "目标类型"),
    ("emotional_intensity", "情绪浓度"),
    ("pacing", "节奏"),
    ("context_summary", "背景"),
    ("desired_takeaway", "想带走"),
    ("tool_route", "路线"),
    ("suggested_spread", "牌阵"),
    ("reading_strategy", "解读策略"),
]


def render_brief_block(strategy: Optional[dict]) -> str:
    """策略单块。None/空 → 空串（存量会话与守卫兜底场景，解读 Agent 表现同改动前）。"""
    if not strategy:
        return ""
    lines = [
        f"{label}：{strategy[key]}"
        for key, label in _BRIEF_LABELS
        if strategy.get(key)
    ]
    if not lines:
        return ""
    return (
        "\n\n# <本场策略单>（开场读人的结论，内部参考，绝不向用户外露，"
        "不要复述、不要向用户解释你的分类）\n" + "\n".join(lines)
    )


_GUARD_INSTRUCTION = (
    "\n\n# <本轮强制>\n"
    "澄清预算已用尽。本轮必须立刻调用 submit_reading_brief 提交策略单，"
    "不确定的字段按最可能的值填，不要再向用户提问。"
)


def build_opening_prompt(
    relationship_block: str,
    session_type: SessionType,
    force_brief: bool = False,
) -> str:
    """开场相位系统提示词 = opening_system.md + 关系上下文 + 入口偏好 [+ 守卫指令]。"""
    parts = [prompt_service.get_prompt("opening_system.md")]

    entry = _ENTRY_LABEL.get(session_type, "塔罗")
    parts.append(
        f"\n\n# <入口>\n用户从「{entry}」入口进来，这是他的先验偏好，"
        f"作为策略单 tool_route 的默认值；若读人后判断另一条路线更合适，可以改。"
    )

    if relationship_block:
        parts.append(f"\n\n{relationship_block}")
    if force_brief:
        parts.append(_GUARD_INSTRUCTION)

    return "".join(parts)


# 接场约束：只在「开场幕真的跑过」（strategy 非空）时追加。
#
# tarot_system.md / astrology_system.md 是给「从零开始的占卜师」写的，里面仍命令
# 「首次对话先用占卜者的语气欢迎他」和「意图模糊时参数化澄清（哪方面？时间跨度？）」。
# 移交之后这两条都已经由开场幕做完了——而后者恰恰是开场幕要消灭的填表式澄清。
# 不压掉就会二次欢迎、重问旧问题。约束从这里注入，两份提示词本身不动（管理页可在线
# 编辑它们，改坏了也波及不到接场逻辑）。
_HANDOFF_INSTRUCTION = (
    "\n\n# <接场>（本场已由前置占卜师完成开场读人，你是同一个占卜师，中途接手）\n"
    "1. 开场、迎接、澄清都已经完成了。不要再欢迎用户，不要重问已经问过的问题，"
    "直接接着往下走。\n"
    "2. 上面系统提示词里「首次对话先用占卜者的语气欢迎他」，以及「意图模糊时先参数化"
    "澄清（问要看哪方面、时间跨度多大）」这两条指示，在本场已失效——忽略它们。"
    "（解读过程中与用户保持连接、收集反馈仍然照做。）\n"
    "3. `submit_reading_brief` 只在用户彻底更换了新议题时才重新调用；"
    "正常解读过程中不要调用它。"
)


def build_reading_prompt(
    base_prompt: str,
    user_context: str,
    strategy: Optional[dict],
) -> str:
    """解读相位系统提示词 = 现有系统提示词 + 用户资料 + 策略单块 [+ 接场约束]。

    strategy 为空（存量会话 / 守卫兜底）→ 不追加接场约束，表现与开场幕上线前一致。
    """
    prompt = base_prompt
    if user_context:
        prompt += f"\n\n{user_context}"

    brief_block = render_brief_block(strategy)
    prompt += brief_block
    if brief_block:
        prompt += _HANDOFF_INSTRUCTION
    return prompt
