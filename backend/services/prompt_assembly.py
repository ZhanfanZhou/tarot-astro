"""管理页：每次模型调用的完整输入是怎么拼出来的，按阶段分组。

这里不拼任何东西——每一处调用都直接调运行时的拼装函数（context_service /
daily_service / notebook_service），只是把用户、会话换成示例数据。拼接顺序、代码拼的段落、
模板变量怎么展开，都和线上走同一份代码，改了拼装这里自动跟着变。

新增提示词或新的调用点：在 _call_sites() 里加一项，stage 选一个 _STAGES。
tests/test_prompt_assembly.py 检查每个登记的提示词至少出现在一处，漏接会直接失败。
"""
from datetime import date, timedelta
from typing import List, Optional

from config import TAROT_CARDS
from models import (
    Conversation, DailyDrawRecord, DailyFeedback, DrawCardsRequest, Gender, Message, MessageRole,
    SessionType, TarotCard, ToolCallRecord, User, UserProfile, UserType,
)
from services import context_service, prompt_service, spread_service, tool_turns
from services.daily_service import daily_oracle_prompt_parts, journey_prompt_parts
from services.gemini_service import tool_names
from services.llm import agent_config
from services.llm import tools as toolspecs
from services.notebook_service import empty_portrait, merge_portrait, notebook_prompt_parts
from services.prompt_service import Part

_SYSTEM = "系统提示词（system），由下面几段按顺序拼成"
_SINGLE = "整段作为一条用户消息单次发出，由下面几段按顺序拼成；没有系统提示词、没有对话历史"
_HISTORY = ("其后是这场会话的全部记录，逐条对应落库的消息：用户发言 / 占卜师（正文 + 工具调用）/ "
            "工具结果。最后一条是本轮要回应的用户发言或工具结果。")

# 一场占卜按时间走过的几段，管理页按这个分组；每次调用挂在其中一段上
_STAGES = [
    ("opening", "开场幕",
     "塔罗/占星会话的前半场：迎接、问清楚、定路线，最后交出起手单。只有这两个入口有开场幕。"),
    ("reading", "解读",
     "交单之后的正场，塔罗与占星各一份大提示词；接场约束把开场已经做完的事压掉。"),
    ("daily", "每日一签",
     "每天一张牌：抽签当场生成解读，之后可以接着聊；心灵奇旅是隔一段时间回看这些签。"),
    ("notebook", "笔记本",
     "会话结束后离线跑一次：写这场的占卜笔记，并给这个人的画像打补丁。只有注册用户有。"),
]


# ── 示例数据 ────────────────────────────────────────────────────────

def _card(card_id: int, reversed_: bool = False) -> TarotCard:
    return TarotCard(card_id=card_id, card_name=TAROT_CARDS[card_id], reversed=reversed_)


_USER = User(user_id="sample", user_type=UserType.REGISTERED, profile=UserProfile(
    nickname="小夏", gender=Gender.FEMALE, birth_year=1996, birth_month=3, birth_day=12,
    birth_hour=8, birth_minute=30, birth_city="上海",
))

_RELATIONSHIP = {"nickname": "小夏", "visit_count": 4, "days_since_last": 11}


def _tarot_brief() -> dict:
    """示例起手单。走的是线上同一条展开：开场只交牌阵 ID，位置由牌阵目录补上。"""
    return context_service.expand_brief({
        "question": "留在上海现在这家公司，还是接杭州这个 offer，未来一年各自会怎么发展",
        "context": "工作三年，拿到杭州一家公司的 offer，薪资高三成。男朋友在上海，还没跟他商量。",
        "route": "tarot",
        "spread_type": "choice_two",
    })


_ASTRO_BRIEF = {"question": "今年事业往哪走", "context": "做了三年运营，想转产品。", "route": "astrology"}


def _daily_record(today: date, days_ago: int, card: TarotCard, verdict=None, note=None) -> DailyDrawRecord:
    return DailyDrawRecord(
        effective_date=(today - timedelta(days=days_ago)).isoformat(), card=card,
        conversation_id=f"sample-daily-{days_ago}",
        feedback=DailyFeedback(verdict=verdict, note=note),
    )


def _sample_portrait() -> dict:
    """一份记过几场的画像：记忆 Agent 每次都会先看到它，再决定这场要改哪几个字段。"""
    return merge_portrait(empty_portrait(), {
        "recent": "在上海做设计，和男友异地一年多，最近在看杭州的工作机会。",
        "people_and_events": "- 男友在杭州，聊过同城的打算\n- 现在的团队年后有调整",
        "understanding": "做决定前习惯把每种可能都想一遍，问的常是「该不该」而不是「会怎样」。"
                         "说到家里人时会绕开。认可具体的下一步，不喜欢被安慰。",
        "preferences": "希望话说直一点，别兜圈子。不想被劝。",
    }, "2026-09-10T14:20:00")


def _sample_conversation() -> Conversation:
    filed = _tarot_brief()
    # 落库的调用参数是模型交的那几项，不含展开出来的位置——展开的结果在 conversation.strategy
    brief = ToolCallRecord(id="call-1", name="submit_reading_brief", args={
        k: filed[k] for k in ("question", "context", "route", "spread_type")})
    spread = DrawCardsRequest(spread_type=filed["spread_type"], positions=filed["positions"])
    draw = ToolCallRecord(id="call-2", name="draw_tarot_cards", args=spread.model_dump())
    cards = [_card(24), _card(56, True), _card(5), _card(31), _card(62, True)]
    return Conversation(
        conversation_id="sample", user_id="sample", session_type=SessionType.TAROT,
        messages=[
            Message(role=MessageRole.ASSISTANT, content="来了。坐吧。"),
            Message(role=MessageRole.USER, content="拿到了杭州的 offer，在纠结要不要去"),
            tool_turns.assistant_message("", [brief]),
            tool_turns.tool_message(brief, {"success": True}),
            tool_turns.assistant_message("", [draw]),
            tool_turns.tool_message(draw, tool_turns.cards_result(cards, spread),
                                    tarot_cards=cards, draw_request=spread),
            Message(role=MessageRole.ASSISTANT, content="「选项 B 的前期」这边是权杖三，你其实已经在往外看了……"),
            Message(role=MessageRole.USER, content="确实，我心里已经想去了"),
        ],
    )


# ── 调用点 ──────────────────────────────────────────────────────────

def _spread_catalog_parts() -> List[Part]:
    """五份牌阵说明各一段，管理页在这里逐份编辑；线上一次只发其中一份。"""
    parts = []
    for spread in spread_service.all_spreads():
        parts.append(Part(f"\n\n【{spread.name}】{spread.card_count} 张 · "
                          f"ID `{spread.id}` · 位置：{' / '.join(spread.positions)}\n\n",
                          label="文件头那几项（代码读的）", sample=True))
        parts.append(Part(spread.detail, prompt=spread_service.prompt_name(spread.id),
                          label="正文（发给模型的就是这一段）"))
    return parts


def _agent(agent: Optional[str]) -> dict:
    if agent is None:
        return {"agent": None, "agent_label": None, "provider": None, "model": None}
    provider, model, _ = agent_config.resolve(agent)
    return {"agent": agent, "agent_label": agent_config.AGENT_LABELS[agent],
            "provider": provider, "model": model}


def _site(title, stage, agent, delivery, parts: List[Part], *,
          tools=(), after="") -> dict:
    return {
        "title": title, "stage": stage, **_agent(agent), "delivery": delivery,
        "parts": [p.to_dict() for p in parts],
        "tools": toolspecs.specs_by_names(list(tools)),
        "after": after,
    }


def _call_sites() -> List[dict]:
    today = date.today()
    user_context = context_service.build_user_context(_USER)
    portrait_context = context_service.render_portrait_block(_sample_portrait())
    relationship = context_service.render_relationship_block(_RELATIONSHIP)

    own = _daily_record(today, 0, _card(17))
    history = [
        _daily_record(today, 3, _card(52), "hit", "那天确实和同事闹了点别扭"),
        _daily_record(today, 2, _card(23, True), "miss"),
        _daily_record(today, 1, _card(41)),
    ]
    notes = [{"conversation_id": "sample-daily-1", "summary": "聊到想给自己放个假，[圣杯六（正位）]像在提醒她回头看看老朋友。"}]
    daily_parts = daily_oracle_prompt_parts(_USER, own, history, today, notes)

    reading_tools = tool_names(SessionType.TAROT, opening=False, has_override=False)
    return [
        _site("开场白（创建会话那一次）", "opening", "opening", _SINGLE,
              context_service.greeting_prompt_parts(relationship, SessionType.TAROT)),
        _site("开场 · 每一轮对话", "opening", "opening", _SYSTEM,
              context_service.opening_prompt_parts(relationship, SessionType.TAROT,
                                                   user_context=user_context,
                                                   portrait_context=portrait_context),
              tools=tool_names(SessionType.TAROT, opening=True, has_override=False),
              after=_HISTORY),
        _site("塔罗解读 · 每一轮对话", "reading", "reading", _SYSTEM,
              context_service.reading_prompt_parts(SessionType.TAROT, user_context, _tarot_brief(),
                                                   portrait_context),
              tools=reading_tools, after=_HISTORY),
        _site("塔罗解读 · 五份牌阵说明", "reading", None,
              "不单独发给模型。开场交单只交一个牌阵 ID，解读时按这个 ID 取下面对应的一份，"
              "接在塔罗解读提示词末尾（上面那一处显示的就是示例起手单选中的那一份）。"
              "每份文件开头的 id / name / positions 是给代码读的：位置和张数从那里来，"
              "不发给模型，也不要在正文里另写一遍",
              _spread_catalog_parts()),
        _site("占星解读 · 每一轮对话", "reading", "reading", _SYSTEM,
              context_service.reading_prompt_parts(SessionType.ASTROLOGY, user_context, _ASTRO_BRIEF,
                                                   portrait_context),
              tools=reading_tools, after=_HISTORY),
        _site("每日一签 · 抽签当场生成解读", "daily", "reading", _SINGLE, daily_parts),
        _site("每日一签 · 之后接着聊", "daily", "reading", _SYSTEM, daily_parts,
              tools=tool_names(SessionType.DAILY, opening=False, has_override=True), after=_HISTORY),
        _site("心灵奇旅", "daily", "reading", _SINGLE,
              journey_prompt_parts(_USER, history + [own], notes)),
        _site("笔记本（会话结束后生成这场的占卜笔记 + 用户画像的改动，要求输出 JSON）",
              "notebook", "memory", _SINGLE,
              notebook_prompt_parts(_sample_conversation(), _sample_portrait())),
    ]


def stages() -> List[dict]:
    """全部调用按阶段分组，外加每一段里出现过的提示词文件（按出现顺序，段内去重）。"""
    sites = _call_sites()
    groups = []
    for key, label, note in _STAGES:
        group = [site for site in sites if site["stage"] == key]
        names = []
        for site in group:
            for part in site["parts"]:
                if part["prompt"] and part["prompt"] not in names:
                    names.append(part["prompt"])
        groups.append({"key": key, "label": label, "note": note,
                       "sites": group, "prompts": names})
    return groups
