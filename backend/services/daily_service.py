"""
每日一签(Daily Oracle)服务。

- 纯函数:streak、解读上下文窗口、history_block、签语提取、模板渲染(本文件上半部,可单测)
- DailyService:daily_draws.json 读写 + 提示词组装

提示词模板在 backend/prompts/ 下,每次请求实时读盘渲染——编辑保存后下一次请求立即生效。
"""
import json
import re
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

import aiofiles

from config import DAILY_DRAWS_FILE
from models import Conversation, DailyDrawRecord, MessageRole, User

# 解读上下文:最近至多 5 次,最远回溯 14 天
HISTORY_MAX_DRAWS = 5
HISTORY_MAX_DAYS = 14
# 弹窗日历带与 journey 素材窗口:14 天
CALENDAR_DAYS = 14
# journey 最少素材数
JOURNEY_MIN_RECORDS = 3


def compute_streak(record_dates: set, today: date) -> int:
    """连续抽牌天数:从今日(今日未抽则从昨日)起往前数连续有记录的天数"""
    d = today
    if d.isoformat() not in record_dates:
        d = d - timedelta(days=1)
    streak = 0
    while d.isoformat() in record_dates:
        streak += 1
        d -= timedelta(days=1)
    return streak


def select_history_records(
    records: Dict[str, DailyDrawRecord],
    anchor: date,
    max_draws: int = HISTORY_MAX_DRAWS,
    max_days: int = HISTORY_MAX_DAYS,
) -> List[DailyDrawRecord]:
    """anchor 当日及之前、最远回溯 max_days 天内,最近 max_draws 次记录,升序返回。
    晚于 anchor 的记录(晚间抽出的明日签)不进入上下文。"""
    cutoff = anchor - timedelta(days=max_days)
    picked: List[DailyDrawRecord] = []
    for ds in sorted(records.keys(), reverse=True):
        d = date.fromisoformat(ds)
        if d > anchor:
            continue
        if d < cutoff:
            break
        picked.append(records[ds])
        if len(picked) >= max_draws:
            break
    return list(reversed(picked))


def note_summaries(notes: List[dict], history: List[DailyDrawRecord]) -> Dict[str, str]:
    """history 这几天的日签对话各自的笔记,只取 summary,按 conversation_id 索引。

    那天抽了什么牌、用户是谁,{history_block} 和 <用户资料> 里已经有了,笔记里只有
    「聊下去之后发生了什么」是新的——那就是 summary 这一个字段。"""
    conv_ids = {r.conversation_id for r in history}
    return {
        e["conversation_id"]: e["summary"]
        for e in notes
        if e.get("conversation_id") in conv_ids and e.get("summary")
    }


def build_history_block(
    history: List[DailyDrawRecord], summaries: Optional[Dict[str, str]] = None,
) -> str:
    """渲染 {history_block}:每条记录一行,附言存全文不截断。
    那天聊下去过、并且已经写成笔记的,紧跟一行笔记(只有注册用户有)。"""
    if not history:
        return "(这是旅程的第一签,还没有过往记录。)"
    summaries = summaries or {}
    lines = []
    for r in history:
        d = date.fromisoformat(r.effective_date)
        pos = "逆位" if r.card.reversed else "正位"
        if r.feedback and r.feedback.verdict == "hit":
            fb = "印证:应验了"
        elif r.feedback and r.feedback.verdict == "miss":
            fb = "印证:没感觉"
        else:
            fb = "未印证"
        line = f"{d.month}月{d.day}日 | {r.card.card_name}·{pos} | {fb}"
        if r.feedback and r.feedback.note:
            line += f" | 附言:{r.feedback.note}"
        lines.append(line)
        summary = summaries.get(r.conversation_id)
        if summary:
            lines.append(f"  笔记:{summary}")
    return "\n".join(lines)


def extract_tagline(conversation: Optional[Conversation]) -> Optional[str]:
    """签语:对话首条 AI 解读的首句(≤40 字),懒取不落库"""
    if not conversation:
        return None
    first = next((m for m in conversation.messages if m.role == MessageRole.ASSISTANT), None)
    if not first or not first.content.strip():
        return None
    text = " ".join(first.content.split())
    sentence = re.split(r"[。！？!?]", text, maxsplit=1)[0].strip() or text
    return sentence[:40]


from services import context_service, prompt_service
from services.notebook_service import notebook_enabled, notebook_service
from services.prompt_service import Part


def _nickname(user: Optional[User]) -> str:
    if user and user.profile and user.profile.nickname:
        return user.profile.nickname
    return "朋友"


def daily_oracle_prompt_parts(
    user: Optional[User], own: Optional[DailyDrawRecord],
    history: List[DailyDrawRecord], anchor: date, notes: Optional[List[dict]] = None,
) -> List[Part]:
    """每日一签提示词：本对话自己的牌作 {today_card}，history 进 {history_block}。

    用户资料和塔罗/占星同一份（context_service.build_user_context），只是不带本命星盘。"""
    if own:
        pos = "逆位" if own.card.reversed else "正位"
        today_card = f"{own.card.card_name}·{pos}"
        today_date_str = own.effective_date
    else:
        today_card = "(未找到本对话的抽牌记录)"
        today_date_str = anchor.isoformat()
    return prompt_service.render_prompt_parts("daily_oracle_system.md", {
        "user_context": context_service.build_user_context(user, include_chart=False),
        "today_date": today_date_str,
        "today_card": today_card,
        "history_block": build_history_block(history, note_summaries(notes or [], history)),
    })


def journey_window_records(
    records: Dict[str, DailyDrawRecord], anchor: date,
) -> List[DailyDrawRecord]:
    """心灵奇旅的素材窗口:近 CALENDAR_DAYS 天全量日运记录,升序。"""
    cutoff = anchor - timedelta(days=CALENDAR_DAYS)
    return [
        r for d, r in sorted(records.items())
        if cutoff <= date.fromisoformat(d) <= anchor
    ]


def journey_date_range(recent: List[DailyDrawRecord]) -> str:
    """这一篇覆盖的日子:第一条到最后一条。提示词里和篇目标题用同一份。"""
    return f"{recent[0].effective_date} ~ {recent[-1].effective_date}"


def journey_prompt_parts(
    user: Optional[User], recent: List[DailyDrawRecord], notes: List[dict],
) -> List[Part]:
    """心灵奇旅提示词：recent 升序且非空；只摘这些日子对应对话的笔记。"""
    conv_ids = {r.conversation_id for r in recent}
    nb_lines = [
        f"- {e.get('summary')}"
        for e in notes
        if e.get("conversation_id") in conv_ids and e.get("summary")
    ]
    return prompt_service.render_prompt_parts("daily_journey.md", {
        "nickname": _nickname(user),
        "date_range": journey_date_range(recent),
        "history_block": build_history_block(recent),
        "notebook_block": "\n".join(nb_lines) if nb_lines else "(无)",
    })


class DailyService:
    """daily_draws.json 读写与提示词组装。文件结构:
    {
      "<user_id>": {
        "records": { "<effective_date>": DailyDrawRecord.dict() },
        "journeys": [ { "generated_on", "date_range", "text", "generated_at" } ]
      }
    }
    journeys 一天最多一篇,按 generated_on 升序;写过的都留着供回顾。
    """

    @staticmethod
    async def _read_all() -> dict:
        if not DAILY_DRAWS_FILE.exists():
            return {}
        async with aiofiles.open(DAILY_DRAWS_FILE, "r", encoding="utf-8") as f:
            content = await f.read()
            return json.loads(content) if content else {}

    @staticmethod
    async def _write_all(data: dict):
        async with aiofiles.open(DAILY_DRAWS_FILE, "w", encoding="utf-8") as f:
            await f.write(json.dumps(data, ensure_ascii=False, indent=2))

    @staticmethod
    async def get_user_records(user_id: str) -> Dict[str, DailyDrawRecord]:
        data = await DailyService._read_all()
        raw = data.get(user_id, {}).get("records", {})
        return {d: DailyDrawRecord(**r) for d, r in raw.items()}

    @staticmethod
    async def get_record(user_id: str, effective_date: str) -> Optional[DailyDrawRecord]:
        return (await DailyService.get_user_records(user_id)).get(effective_date)

    @staticmethod
    async def save_record(user_id: str, record: DailyDrawRecord):
        data = await DailyService._read_all()
        node = data.setdefault(user_id, {"records": {}})
        node.setdefault("records", {})[record.effective_date] = record.model_dump()
        await DailyService._write_all(data)

    @staticmethod
    async def update_feedback(
        user_id: str, effective_date: str,
        verdict: Optional[str], note: Optional[str],
    ) -> Optional[DailyDrawRecord]:
        """更新指定日期的印证反馈。整体覆盖 feedback:verdict/note 需一并传入,传 None 会清空既有值。"""
        data = await DailyService._read_all()
        raw = data.get(user_id, {}).get("records", {}).get(effective_date)
        if not raw:
            return None
        raw["feedback"] = {
            "verdict": verdict,
            "note": note,
            "fed_back_at": datetime.utcnow().isoformat(),
        }
        await DailyService._write_all(data)
        return DailyDrawRecord(**raw)

    @staticmethod
    async def get_journeys(user_id: str) -> List[dict]:
        """这个人写过的全部心灵奇旅,新→旧。一天最多一篇。"""
        data = await DailyService._read_all()
        return list(reversed(data.get(user_id, {}).get("journeys", [])))

    @staticmethod
    async def get_journey_of_day(user_id: str, generated_on: str) -> Optional[dict]:
        """当天那一篇(同日再点就回放它,不再花额度)。"""
        return next(
            (j for j in await DailyService.get_journeys(user_id)
             if j.get("generated_on") == generated_on),
            None,
        )

    @staticmethod
    async def save_journey(user_id: str, generated_on: str, text: str) -> dict:
        """落一篇心灵奇旅。同一天重新生成就地覆盖,篇目不会越攒越多。"""
        data = await DailyService._read_all()
        node = data.setdefault(user_id, {"records": {}})
        node.pop("journey_cache", None)   # 只存最新一篇的旧结构,已被 journeys 取代
        records = {d: DailyDrawRecord(**r) for d, r in node.get("records", {}).items()}
        recent = journey_window_records(records, date.fromisoformat(generated_on))
        entry = {
            "generated_on": generated_on,
            "date_range": journey_date_range(recent) if recent else generated_on,
            "text": text,
            "generated_at": datetime.utcnow().isoformat(),
        }
        journeys = [j for j in node.get("journeys", []) if j.get("generated_on") != generated_on]
        journeys.append(entry)
        node["journeys"] = sorted(journeys, key=lambda j: j["generated_on"])
        await DailyService._write_all(data)
        return entry

    # ── 提示词组装 ────────────────────────────────────────────────

    @staticmethod
    async def render_daily_system_prompt(
        conversation: Conversation, user: Optional[User],
        own: Optional[DailyDrawRecord] = None,
    ) -> str:
        """每次请求实时渲染（热加载）：锚点取服务器今日，本对话自己的牌作 {today_card}，
        其余记录进 {history_block}（那几天聊下去过的，附上那场的笔记）。
        抽签那一刻记录还没落库，由调用方把 own 传进来。"""
        records = await DailyService.get_user_records(conversation.user_id)
        if own is None:
            own = next(
                (r for r in records.values() if r.conversation_id == conversation.conversation_id),
                None,
            )
        others = {
            d: r for d, r in records.items()
            if r.conversation_id != conversation.conversation_id
        }
        anchor = date.today()
        history = select_history_records(others, anchor)
        notes = notebook_service.get_notes(user.user_id) if notebook_enabled(user) else []
        return prompt_service.join(daily_oracle_prompt_parts(user, own, history, anchor, notes))

    @staticmethod
    async def build_journey_prompt(
        user_id: str, anchor_date: str,
        user: Optional[User], notes: List[dict],
    ) -> Optional[str]:
        """心灵奇旅:近 14 天全量记录 + 对应 daily 对话的占卜笔记。
        素材 < JOURNEY_MIN_RECORDS 时返回 None。"""
        records = await DailyService.get_user_records(user_id)
        recent = journey_window_records(records, date.fromisoformat(anchor_date))
        if len(recent) < JOURNEY_MIN_RECORDS:
            return None
        return prompt_service.join(journey_prompt_parts(user, recent, notes))
