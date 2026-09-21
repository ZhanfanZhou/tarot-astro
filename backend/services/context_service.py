"""开场幕上下文服务：相位判定、关系元数据、策略单渲染、两相位的提示词拼装。

「相位」概念的唯一权威——gemini_service、routers 全部问这里，不各自判断，
杜绝「路由认为在开场、工具集却给了抽牌」的分裂。
"""
from datetime import datetime
from typing import List, Optional

from models import GENDER_LABELS, Conversation, SessionType, User, UserProfile
from services import prompt_service, spread_service
from services.astrology_service import AstrologyService
from services.db import get_db
from services.notebook_service import notebook_enabled, notebook_service as notebook
from services.prompt_service import Part

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


def build_user_context(user: Optional[User], include_chart: bool = True) -> str:
    """用户资料块：两个相位的系统提示词都带。最后是本命星盘：基本星盘或它的状态。

    一个字段都没填过（profile 为 None，注册/游客时没填任何东西就是这样）也照样出这一块，
    写明「尚未完善」和星盘缺哪几项：两份提示词都写着「看 <用户资料> 里有没有完整的出生
    日期」，块整个不出现的话，模型是去一个不存在的小节里找答案。

    include_chart=False 只出资料几行，不带星盘那一行——每日一签用这一份：一张牌的日运
    不看盘，但昵称、性别、生日、出生地照样是同一份资料。
    """
    if not user:
        return ""

    profile = user.profile or UserProfile()
    context_parts = []

    if profile.nickname:
        context_parts.append(f"昵称：{profile.nickname}")
    if profile.gender:
        context_parts.append(f"性别：{GENDER_LABELS.get(profile.gender, '未知')}")
    if all([profile.birth_year, profile.birth_month, profile.birth_day]):
        birth_str = f"{profile.birth_year}年{profile.birth_month}月{profile.birth_day}日"
        if profile.birth_hour is not None and profile.birth_minute is not None:
            birth_str += f" {profile.birth_hour:02d}:{profile.birth_minute:02d}"
        context_parts.append(f"生日：{birth_str}")
    if profile.birth_city:
        context_parts.append(f"出生地点：{profile.birth_city}")

    # 只报状态，不带指令：「资料不全就去调 request_user_profile」这条规则
    # tarot_system.md / astrology_system.md / opening_system.md 都已写明，
    # 代码里再写一遍就是第四份，改提示词时必然漏掉这一份。
    lines = context_parts or ["尚未完善"]
    if include_chart:
        lines = lines + [_chart_status(user)]
    return "\n# <用户资料>\n" + "\n".join(lines)


def _chart_status(user: User) -> str:
    """本命星盘三种情况：存了基本星盘就直接列出来 / 出生资料齐全但还没排过 / 排不了（缺哪几项）。"""
    missing = AstrologyService.missing_birth_fields(user.profile)
    if missing:
        labels = "、".join(AstrologyService.BIRTH_FIELD_LABELS[f] for f in missing)
        return f"本命星盘：无法排盘（缺{labels}）"
    if user.natal_chart:
        return f"本命星盘：\n{user.natal_chart}"
    return "本命星盘：未保存（出生资料齐全，可以排盘）"


_PROFILE_SHAPES = ("一个字段都没填过时只写「尚未完善」；末行本命星盘三种：已存基本星盘 / "
                   "出生资料齐全但还没排过 / 缺出生资料排不了（示例是第一种）")

_PORTRAIT_LABELS = {
    "recent": "生活近况",
    "people_and_events": "近期的人与事",
    "understanding": "累积认识",
    "preferences": "交流偏好",
}

_PORTRAIT_EMPTY = "还没有形成印象。"

# 画像块只有注册用户有，两个相位都带
_PORTRAIT_ONLY = "注册用户才有（游客没有笔记本）"
_PORTRAIT_SHAPES = "四项里只出写过的那几项；一项都没写过时块里只有一句「还没有形成印象。」"


def render_portrait_block(portrait: Optional[dict]) -> str:
    """用户画像块：只列写过的项，每项带它最后一次被记下的日期。

    空项一行都不占——把完整骨架（四个空字段）摆给模型看，除了占篇幅没有别的作用。
    一项都没写过也照样出这一块，写明还没有印象：模型要知道「这个人还没有画像」是正常
    状态，而不是从这一块的消失去猜。

    「这是过去的印象、该怎么用」写在 portrait_usage.md（管理页可改），跟着这个块一起发。
    """
    if portrait is None:
        return ""
    lines = []
    for name, label in _PORTRAIT_LABELS.items():
        item = portrait.get(name) or {}
        text = (item.get("text") or "").strip()
        if not text:
            continue
        day = (item.get("confirmed_at") or "").split("T")[0]
        head = f"{label}（{day} 记）" if day else label
        # 分条写的项（人与事常是几行）另起一行，免得第二条起顶格、看不出还属于这一项
        lines.append(f"{head}：\n{text}" if "\n" in text else f"{head}：{text}")
    return "# <用户画像>\n" + ("\n".join(lines) if lines else _PORTRAIT_EMPTY)


def build_portrait_context(user: Optional[User]) -> str:
    """这位用户的画像块。游客没有笔记本，也就没有画像，整块不出现。"""
    if not notebook_enabled(user):
        return ""
    return render_portrait_block(notebook.get_portrait(user.user_id))


def render_relationship_block(meta: dict) -> str:
    """<称呼与来访次数> 块：只注入事实（称呼/第几次/距上次多久）。

    「新客要安静、回头客要熟人语气、禁止翻旧账」这类语气指令写在 opening_persona.md 的
    <迎接> 一节（管理页可在线改）。这里留纯数据，代码里不再藏文案。
    """
    nickname = meta.get("nickname") or "朋友"
    visit_count = meta.get("visit_count", 1)

    line = f"称呼：{nickname} ｜ 来访：第 {visit_count} 次"
    if visit_count > 1:
        days = meta.get("days_since_last")
        line += f" ｜ 距上次：{days} 天" if days is not None else " ｜ 距上次：不详"
    return f"# <称呼与来访次数>\n{line}"


_RELATIONSHIP_SHAPES = "第 1 次来访没有「距上次」那一段；查不到上次时间写「距上次：不详」"

_BRIEF_LABELS = [
    ("question", "问题"),
    ("context", "背景"),
    ("route", "起手"),
    ("spread", "牌阵"),
    ("positions", "位置"),
]


def _brief_value(strategy: dict, key: str):
    """一个起手单字段渲染成一行里的值。

    牌阵一行同时给名字和 ID：名字是解读时要说的那副阵，ID 是 <牌阵说明> 那一块的出处。
    位置编号，因为牌阵说明里是按 1、2、3 讲各位置职责的，不编号模型得自己数。
    存量会话只有 spread_type（当时是模型自拟的阵名），照原样出。
    """
    if key == "spread":
        name, spread_id = strategy.get("spread_name"), strategy.get("spread_type")
        if not spread_id:
            return name
        return f"{name}（{spread_id}）" if name else spread_id
    value = strategy.get(key)
    if key == "positions" and value:
        return " / ".join(f"{i} {p}" for i, p in enumerate(value, 1))
    if isinstance(value, (list, tuple)):
        return " / ".join(str(v) for v in value)
    return value


def render_brief_block(strategy: Optional[dict]) -> str:
    """起手单块。None/空 → 空串（存量会话，解读 Agent 表现同改动前）。

    措辞是「本场起手」而不是「当前策略」：它是开场定下的一次性记录，用户后来换了角度、
    补抽了别的牌阵都不会回写这里，解读 Agent 不该拿它当当前指令用。

    这里只放数据。「这是开场的记录、不是当前指令、不要向用户复述」这些话写在
    reading_handoff.md（管理页可改），它和这个块同时出现。
    """
    if not strategy:
        return ""
    lines = []
    for key, label in _BRIEF_LABELS:
        value = _brief_value(strategy, key)
        if not value:
            continue
        lines.append(f"{label}：{value}")
    if not lines:
        return ""
    return (
        "\n\n# <本场起手>\n"
        + "\n".join(lines)
    )


def spread_of(strategy: Optional[dict]):
    """这场用的牌阵。非塔罗路线、存量会话里模型自拟的阵名 → None。"""
    if (strategy or {}).get("route") != "tarot":
        return None
    return spread_service.get(strategy.get("spread_type"))


def expand_brief(args: Optional[dict]) -> Optional[dict]:
    """交单参数 → 完整起手单。牌阵 ID 不在目录里 → None（调用方负责退回重选）。

    开场只交 ID，位置、张数、牌阵名都挂在那个 ID 上，在这里一次性展开。展开只在这一处
    做：落库的那一份、同一轮里交给解读 Agent 的那一份、推给抽牌器的那一副，
    都从这个返回值来，不各自再查一遍目录。
    """
    if args is None:
        return None
    brief = dict(args)
    if brief.get("route") == "tarot":
        spread = spread_service.get(brief.get("spread_type"))
        if spread is None:
            return None
        brief["spread_name"] = spread.name
        brief["positions"] = list(spread.positions)
    else:
        # 星盘路线没有牌阵。模型多填了也不留：留着 <本场起手> 会多出一行没有位置的牌阵，
        # 而这场根本没抽牌。
        brief.pop("spread_type", None)
    return brief


def _spread_parts(spread) -> List[Part]:
    """牌阵说明块：这副牌阵的固定位置、适用场合、解读方法与限制，逐字来自它自己那份 .md。

    开场只交一个牌阵 ID，这一整块的内容它从没见过——五副阵的详解一起发过去，
    对只需要选阵的开场 Agent 是纯噪音。选定之后才在这里接给解读 Agent。

    正文取 spread.detail 而不是整份文件：文件头那几行（id / name / positions）是给代码
    读的，positions 已经在 <本场起手> 里编好号了，同一份东西不发两遍。
    """
    return [
        Part(f"\n\n# <牌阵说明>\n本场用的是「{spread.name}」。"
             "以下是这副牌阵的固定位置与解读方法。\n\n",
             label="块标题 + 这副阵的名字", sample=True, when=_SPREAD_ONLY),
        Part(spread.detail, prompt=spread_service.prompt_name(spread.id), when=_SPREAD_ONLY,
             label="正文（文件头那几行是机器读的，不发给模型）",
             variants="按本场起手单的 spread_type 从五副阵里取一份；"
                      "这一页显示的是示例起手单选中的那副"),
    ]


_BRIEF_ONLY = "开场幕交过单才有（旧会话没有）"
_SPREAD_ONLY = "起手单走塔罗、牌阵 ID 在目录里才有（星盘路线和旧会话没有）"


def _portrait_parts(portrait_context: str) -> List[Part]:
    """画像块 + 它的使用须知。两个相位接法一样，接在用户资料后面。"""
    if not portrait_context:
        return []
    return [
        Part(f"\n\n{portrait_context}", label="用户画像", sample=True,
             when=_PORTRAIT_ONLY, variants=_PORTRAIT_SHAPES),
        Part("\n\n"),
        prompt_service.prompt_part("portrait_usage.md", when=_PORTRAIT_ONLY),
    ]


def _entry_part(session_type: SessionType) -> Part:
    entry = _ENTRY_LABEL.get(session_type, "塔罗")
    return Part(f"\n\n# <用户点开的入口>\n{entry}", label="用户点开的入口",
                variants="按会话入口取值：" + " / ".join(_ENTRY_LABEL.values()))


def opening_prompt_parts(
    relationship_block: str,
    session_type: SessionType,
    user_context: str = "",
    portrait_context: str = "",
) -> List[Part]:
    """开场相位系统提示词 = opening_persona.md + opening_system.md + opening_spread_catalog.md
    + 用户点开的入口 + 称呼与来访次数 + 用户资料 + 用户画像。

    <称呼与来访次数> 紧跟在入口后面：opening_persona.md 的 <迎接> 一节按它决定语气，
    两块挨着，读提示词的人不必从头翻到尾才知道那一节指的是哪一块。

    人设与迎接单独一份（opening_persona.md）：开场白那一次调用只发得着这一份，见
    greeting_prompt_parts。开场的活（问清楚 / 选路线 / 牌阵 / 交单）留在 opening_system.md。

    牌阵目录紧跟在后面：opening_system.md 里「仅从 <牌阵选择参考> 的五种牌阵中选择」
    指的就是它。这里只有每副阵的简介和适用场合，够选阵用；各阵的位置与解读方法是
    解读相位的事（render_spread_block），开场看不到也不需要看到。

    用户资料必须注入：前置占卜师要自己判断「这个问题该不该走星盘」，而星盘要出生信息。
    看不见资料它就只能盲调 request_user_profile 去撞。

    所有模型可见的文案都来自 .md（管理页可改）；这里只负责拼接顺序和数据。
    """
    parts = [prompt_service.prompt_part("opening_persona.md"),
             Part("\n\n"),
             prompt_service.prompt_part("opening_system.md"),
             Part("\n\n"),
             prompt_service.prompt_part("opening_spread_catalog.md"),
             _entry_part(session_type)]

    if relationship_block:
        parts.append(Part(f"\n\n{relationship_block}", label="称呼与来访次数",
                          sample=True, variants=_RELATIONSHIP_SHAPES))
    if user_context:
        parts.append(Part(f"\n{user_context}", label="用户资料", sample=True, variants=_PROFILE_SHAPES))
    parts += _portrait_parts(portrait_context)
    return parts


def build_opening_prompt(
    relationship_block: str,
    session_type: SessionType,
    user_context: str = "",
    portrait_context: str = "",
) -> str:
    return prompt_service.join(opening_prompt_parts(
        relationship_block, session_type, user_context, portrait_context))


def greeting_prompt_parts(relationship_block: str, session_type: SessionType) -> List[Part]:
    """开场白那一次调用 = opening_persona.md + 用户点开的入口 + 称呼与来访次数 + opening_greeting.md。

    只发人设与迎接。开场的活那几节（问清楚 / 选塔罗还是星盘 / 牌阵表 / 交单 / 边界）这一次
    一件也做不了——用户还没开口，这次调用也没有工具——发过去只是让一句问候语挤在两千字后面。
    用户资料和画像同理不发：迎接语不该提到它们。

    这一轮的指令不能并进 opening_persona.md：那份提示词开场相位每一轮都在用，
    而「用户刚刚坐下、还没开口」只在第一轮成立，写进去会让后续每轮都想再迎接一次。
    """
    parts = [prompt_service.prompt_part("opening_persona.md"), _entry_part(session_type)]
    if relationship_block:
        parts.append(Part(f"\n\n{relationship_block}", label="称呼与来访次数",
                          sample=True, variants=_RELATIONSHIP_SHAPES))
    return parts + [
        Part("\n\n"),
        prompt_service.prompt_part("opening_greeting.md"),
    ]


def first_action(strategy: Optional[dict]) -> tuple:
    """起手单 → 交单后 harness 要执行的第一个动作 (tool_name, args)。

    收的是 `expand_brief` 展开过的单子：route=tarot 时牌阵与位置都已经在里面，直接推抽牌，
    不必再让解读 Agent 重念一遍。route 非 tarot 一律走星盘移交（解读 Agent 自己取盘）。

    抽几张由 positions 的长度决定，没有单独的张数字段——见 DrawCardsRequest。
    """
    if (strategy or {}).get("route") != "tarot":
        return (None, None)

    return ("draw_tarot_cards", {"spread_type": strategy["spread_type"],
                                 "positions": list(strategy["positions"])})


# 接场约束：只在「开场幕真的跑过」（strategy 非空）时追加。
#
# tarot_system.md / astrology_system.md 是给「从零开始的占卜师」写的，里面仍命令
# 「首次对话先用占卜者的语气欢迎他」和「意图模糊时参数化澄清」。移交之后这两条都
# 已经由开场幕做完了。不压掉就会二次欢迎、重问旧问题。约束从 reading_handoff.md
# 注入（管理页可在线改），两份大提示词本身不动。


def reading_base_prompt_name(session_type: SessionType) -> str:
    return "astrology_system.md" if session_type == SessionType.ASTROLOGY else "tarot_system.md"


def reading_prompt_parts(
    session_type: SessionType,
    user_context: str,
    strategy: Optional[dict],
    portrait_context: str = "",
) -> List[Part]:
    """解读相位系统提示词 = 塔罗/占星提示词 + 用户资料 + 用户画像 + 起手单块
    [+ 牌阵说明] [+ 接场约束]。

    strategy 为空（存量会话）→ 不追加接场约束，表现与开场幕上线前一致。
    牌阵说明按起手单里的牌阵 ID 取那一副，所以只有走塔罗、且 ID 在目录里时才有这一段；
    它紧接在 <本场起手> 后面——那一块列的是这副阵的位置，位置怎么解读就在这一段里。

    接场约束永远是最后一段：它作废的是上面塔罗/占星提示词里的「先欢迎、先澄清」，
    中间再插东西，等于让它离要压的那两条更远、离结尾更远。
    """
    parts = [prompt_service.prompt_part(reading_base_prompt_name(session_type))]
    if user_context:
        parts.append(Part(f"\n\n{user_context}", label="用户资料", sample=True, variants=_PROFILE_SHAPES))
    parts += _portrait_parts(portrait_context)

    brief_block = render_brief_block(strategy)
    if not brief_block:
        return parts

    parts.append(Part(brief_block, label="本场起手", sample=True, when=_BRIEF_ONLY))

    spread = spread_of(strategy)      # 走塔罗才有；牌阵 ID 决定取哪一份详解
    if spread:
        parts += _spread_parts(spread)

    parts.append(Part("\n\n"))
    parts.append(prompt_service.prompt_part("reading_handoff.md", when=_BRIEF_ONLY))
    return parts


def build_reading_prompt(
    session_type: SessionType,
    user_context: str,
    strategy: Optional[dict],
    portrait_context: str = "",
) -> str:
    return prompt_service.join(
        reading_prompt_parts(session_type, user_context, strategy, portrait_context))
