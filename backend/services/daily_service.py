"""
每日一签(Daily Oracle)服务。

- 纯函数:streak、解读上下文窗口、history_block、签语提取、模板渲染(本文件上半部,可单测)
- DailyService:daily_draws.json 读写 + 提示词组装

提示词模板在 backend/prompts/ 下,每次请求实时读盘渲染——编辑保存后下一次请求立即生效。
"""
import json
import re
from datetime import date, timedelta
from typing import Dict, List, Optional

import aiofiles

from config import DAILY_DRAWS_FILE, PROMPTS_DIR
from models import Conversation, DailyDrawRecord, MessageRole, User

# 解读上下文:最近至多 7 次,最远回溯 14 天(spec 决策)
HISTORY_MAX_DRAWS = 7
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


def build_history_block(history: List[DailyDrawRecord]) -> str:
    """渲染 {history_block}:每条记录一行,附言存全文不截断"""
    if not history:
        return "(这是旅程的第一签,还没有过往记录。)"
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


def render_template(name: str, variables: Dict[str, str]) -> str:
    """读取 backend/prompts/<name> 并替换 {key} 占位符。
    每次调用实时读盘(热加载);用 str.replace 而非 str.format,
    模板正文里出现孤立花括号也不会崩。"""
    path = PROMPTS_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"提示词模板缺失: {path}")
    text = path.read_text(encoding="utf-8")
    for key, value in variables.items():
        text = text.replace("{" + key + "}", str(value))
    return text


def _nickname(user: Optional[User]) -> str:
    if user and user.profile and user.profile.nickname:
        return user.profile.nickname
    return "朋友"


def _birth_info(user: Optional[User]) -> str:
    if user and user.profile:
        p = user.profile
        if all([p.birth_year, p.birth_month, p.birth_day]):
            return f"生日:{p.birth_year}年{p.birth_month}月{p.birth_day}日"
    return "生日:未提供"


class DailyService:
    """daily_draws.json 读写与提示词组装。文件结构:
    {
      "<user_id>": {
        "records": { "<effective_date>": DailyDrawRecord.dict() },
        "journey_cache": { "generated_on": "YYYY-MM-DD", "text": "..." }
      }
    }
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
        from datetime import datetime
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
    async def get_journey_cache(user_id: str) -> Optional[dict]:
        data = await DailyService._read_all()
        return data.get(user_id, {}).get("journey_cache")

    @staticmethod
    async def save_journey_cache(user_id: str, generated_on: str, text: str):
        data = await DailyService._read_all()
        node = data.setdefault(user_id, {"records": {}})
        node["journey_cache"] = {"generated_on": generated_on, "text": text}
        await DailyService._write_all(data)

    # ── 提示词组装 ────────────────────────────────────────────────

    @staticmethod
    async def render_daily_system_prompt(conversation: Conversation, user: Optional[User]) -> str:
        """每次消息请求时调用(热加载):锚点取服务器今日,
        本对话自己的牌作 {today_card},其余记录进 {history_block}。"""
        records = await DailyService.get_user_records(conversation.user_id)
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
        if own:
            pos = "逆位" if own.card.reversed else "正位"
            today_card = f"{own.card.card_name}·{pos}"
            today_date_str = own.effective_date
        else:
            today_card = "(未找到本对话的抽牌记录)"
            today_date_str = anchor.isoformat()
        return render_template("daily_oracle_system.md", {
            "nickname": _nickname(user),
            "birth_info": _birth_info(user),
            "today_date": today_date_str,
            "today_card": today_card,
            "history_block": build_history_block(history),
        })

    @staticmethod
    async def build_journey_prompt(
        user_id: str, anchor_date: str,
        user: Optional[User], notebook_entries: List[dict],
    ) -> Optional[str]:
        """心灵奇旅:近 14 天全量记录 + 对应 daily 对话的 notebook 笔记。
        素材 < JOURNEY_MIN_RECORDS 时返回 None。"""
        records = await DailyService.get_user_records(user_id)
        anchor = date.fromisoformat(anchor_date)
        cutoff = anchor - timedelta(days=CALENDAR_DAYS)
        recent = [
            r for d, r in sorted(records.items())
            if cutoff <= date.fromisoformat(d) <= anchor
        ]
        if len(recent) < JOURNEY_MIN_RECORDS:
            return None
        conv_ids = {r.conversation_id for r in recent}
        nb_lines = [
            f"- {e.get('summary')}"
            for e in notebook_entries
            if e.get("conversation_id") in conv_ids and e.get("summary")
        ]
        return render_template("daily_journey.md", {
            "nickname": _nickname(user),
            "date_range": f"{recent[0].effective_date} ~ {recent[-1].effective_date}",
            "history_block": build_history_block(recent),
            "notebook_block": "\n".join(nb_lines) if nb_lines else "(无)",
        })
