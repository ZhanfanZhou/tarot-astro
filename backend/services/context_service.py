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
    """关系上下文块：只注入事实（称呼/第几次/距上次多久）。

    「新客要安静、回头客要熟人语气、禁止翻旧账」这类语气指令已搬进 opening_system.md
    （管理页可在线改）。这里留纯数据，代码里不再藏文案。
    """
    nickname = meta.get("nickname") or "朋友"
    visit_count = meta.get("visit_count", 1)

    line = f"称呼：{nickname} ｜ 来访：第 {visit_count} 次"
    if visit_count > 1:
        days = meta.get("days_since_last")
        line += f" ｜ 距上次：{days} 天" if days is not None else " ｜ 距上次：不详"
    return f"<关系上下文>\n{line}"


_BRIEF_LABELS = [
    ("question", "问题"),
    ("context", "背景"),
    ("route", "起手"),
    ("spread_type", "牌阵"),
    ("positions", "位置"),
]


def render_brief_block(strategy: Optional[dict]) -> str:
    """起手单块。None/空 → 空串（存量会话与守卫兜底场景，解读 Agent 表现同改动前）。

    措辞是「本场起手」而不是「当前策略」：它是开场定下的一次性记录，用户后来换了角度、
    补抽了别的牌阵都不会回写这里，解读 Agent 不该拿它当当前指令用。
    """
    if not strategy:
        return ""
    lines = []
    for key, label in _BRIEF_LABELS:
        value = strategy.get(key)
        if not value:
            continue
        if isinstance(value, (list, tuple)):
            value = " / ".join(str(v) for v in value)
        lines.append(f"{label}：{value}")
    if not lines:
        return ""
    return (
        "\n\n# <本场起手>（开场时定下的记录，内部参考，绝不向用户外露）\n"
        + "\n".join(lines)
    )


# 走塔罗但模型没给 positions 时的兜底——不为这个再花一次往返去问它
_DEFAULT_SPREAD = {
    "spread_type": "three_card",
    "positions": ["现状", "阻碍", "流向"],
}


def build_opening_prompt(
    relationship_block: str,
    session_type: SessionType,
    force_brief: bool = False,
    user_context: str = "",
) -> str:
    """开场相位系统提示词 = opening_system.md + 入口 + 用户资料 + 关系上下文
    [+ opening_force_brief.md]。

    用户资料必须注入：前置占卜师要自己判断「这个问题该不该走星盘」，而星盘要出生信息。
    看不见资料它就只能盲调 request_user_profile 去撞。

    所有模型可见的文案都来自 .md（管理页可改）；这里只负责拼接顺序和数据。
    """
    parts = [prompt_service.get_prompt("opening_system.md")]

    entry = _ENTRY_LABEL.get(session_type, "塔罗")
    parts.append(f"\n\n# <入口>\n{entry}")

    if user_context:
        parts.append(f"\n{user_context}")
    if relationship_block:
        parts.append(f"\n\n{relationship_block}")
    if force_brief:
        parts.append("\n\n" + _forced_brief_parts()[0])

    return "".join(parts)


def first_action(strategy: dict) -> tuple:
    """起手单 → 交单后 harness 要执行的第一个动作 (tool_name, args)。

    route=tarot 时牌阵已经在单子里，直接推抽牌，不必再让解读 Agent 重念一遍；
    positions 缺失则兜底三张阵。route 非 tarot 一律走星盘移交（解读 Agent 自己取盘）。

    抽几张由 positions 的长度决定，没有单独的张数字段——见 DrawCardsRequest。
    """
    if (strategy or {}).get("route") != "tarot":
        return (None, None)

    args = {key: strategy.get(key) or fallback for key, fallback in _DEFAULT_SPREAD.items()}
    return ("draw_tarot_cards", args)


# opening_force_brief.md 的两个小节标题。这一轮有两段文案，用途不同：
#   <本轮强制> 注入系统提示词，是给模型的指令；
#   <过渡语>   反过来是替模型说给用户听的——强制交单走 mode=ANY，模型在解码层
#              只被允许输出函数调用，一个字也说不出来，不是它选择沉默，是它没得选。
#              不补这句，抽牌器就凭空弹到用户面前。
# 其余路径一律不补：模型想说就说（说了照常流式输出），不想说就沉默，两种都正常。
#
# 两段同属「预算用尽的那一轮」，放同一个文件同一个管理页条目里改；小节标题就是
# 分隔符本身，编辑的人看得见，不是藏在正文里的隐形标记。
_FORCED_BRIEF_LINE_HEADING = "# <过渡语>"


def _forced_brief_parts() -> tuple:
    text = prompt_service.get_prompt("opening_force_brief.md")
    instruction, _, line = text.partition(_FORCED_BRIEF_LINE_HEADING)
    return instruction.strip(), line.strip()


def forced_brief_handoff_line() -> str:
    """守卫第 2 层被迫沉默时，替模型说的那句过渡语。"""
    return _forced_brief_parts()[1]


# 接场约束：只在「开场幕真的跑过」（strategy 非空）时追加。
#
# tarot_system.md / astrology_system.md 是给「从零开始的占卜师」写的，里面仍命令
# 「首次对话先用占卜者的语气欢迎他」和「意图模糊时参数化澄清」。移交之后这两条都
# 已经由开场幕做完了。不压掉就会二次欢迎、重问旧问题。约束从 reading_handoff.md
# 注入（管理页可在线改），两份大提示词本身不动。


def _handoff_instruction() -> str:
    return "\n\n" + prompt_service.get_prompt("reading_handoff.md")


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
        prompt += _handoff_instruction()
    return prompt
