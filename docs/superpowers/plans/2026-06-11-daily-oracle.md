# 每日一签 · 心灵奇旅 (Daily Oracle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 殿堂主页新增每日日运入口 + 弹窗(两周日历回看 / 抽牌 / 流式解读 / 印证反馈 / 心灵奇旅叙事),日运对话可无缝延续为占卜聊天。

**Architecture:** 日运记录是轻量索引(`daily_draws.json`:牌面+反馈+对话引用),解读/聊天/笔记全部复用现有 conversation + notebook + Gemini Agent Loop 链路。新增 `SessionType.DAILY`、`/api/daily/*` 路由、`backend/prompts/` 热加载提示词模板(每次请求实时读盘渲染,改完即生效);前端新增 `DailyOracleBanner` + `DailyOracleModal`,选牌器 `TarotCardDrawer` 加可选 props 复用。

**Tech Stack:** FastAPI + JSON 文件存储 + google-generativeai(后端,新增 pytest 做纯函数测试);React 18 + framer-motion + zustand + vitest(前端)。

**Spec:** `docs/superpowers/specs/2026-06-11-daily-oracle-design.md`

**验证基线:** 前端 `npm run build`(repo 的 lint 已知损坏,不用)+ `npm test`(vitest);后端 `pytest`(本计划引入)+ 本地起服 curl 手动验证。

---

## 关键现状(实现者必读)

- **选牌器是纯仪式 UI**:`TarotCardDrawer` 的 `onCardsDrawn` 返回的牌是前端模拟的;真实牌面由服务端随机(现有流程是 `POST /api/tarot/draw`)。daily 流程中真实牌来自 `POST /api/daily/{user_id}/draw` 的响应。
- **解读触发方式**:前端向 `POST /api/tarot/message` 发送固定文案「请根据抽牌结果进行解读」,后端 `should_attach_tarot_cards()`(backend/routers/tarot.py:28)检测该文案并把牌面附到 AI 消息上。daily 完整沿用。
- **首条用户消息会覆盖标题**:`ConversationService.add_message`(backend/services/conversation_service.py:70)把第一条 USER 消息截断为标题——daily 的第一条用户消息是「请根据抽牌结果进行解读」,必须跳过(Task 1 处理)。
- **系统提示词选择**:`gemini_service._format_messages_for_gemini`(backend/services/gemini_service.py:338-342)按 session_type 选硬编码常量;工具集选择在 stream_response(~line 423)与 continue_with_function_result(~line 552):`tarot_tools if session_type == SessionType.TAROT else astrology_tools`——daily 必须落到 tarot_tools(Task 4 处理)。
- **前端 API 基址**:`API_BASE_URL = import.meta.env.VITE_API_URL || ''`,开发期由 Vite 代理 `/api`,daily 接口同前缀自动覆盖。
- **生效日规则**:浏览器本地时间 18:00 前=今天,之后=明天;由前端计算并上送,后端只校验与服务器日期偏差 ≤1 天。

---

### Task 1: 后端基础 — config / models / conversation_service 的 daily 适配

**Files:**
- Modify: `backend/config.py`
- Modify: `backend/models.py`
- Modify: `backend/services/conversation_service.py`

- [ ] **Step 1: config.py 增加数据文件与模板目录常量**

在 `PAYMENT_ORDERS_FILE = ...` 之后追加:

```python
# 每日一签:日运记录(牌面/反馈/旅程缓存)
DAILY_DRAWS_FILE = DATA_DIR / "daily_draws.json"
# 提示词模板目录(每次请求实时读取,编辑后无需重启)
PROMPTS_DIR = BASE_DIR / "backend" / "prompts"
```

- [ ] **Step 2: models.py 增加 SessionType.DAILY 与 daily 模型**

`SessionType` 改为:

```python
class SessionType(str, Enum):
    TAROT = "tarot"
    ASTROLOGY = "astrology"
    CHAT = "chat"
    DAILY = "daily"  # 每日一签
```

文件末尾追加:

```python
# ── 每日一签 ──────────────────────────────────────────────────────

class DailyFeedback(BaseModel):
    verdict: Optional[Literal["hit", "miss"]] = None  # 应验了 / 没感觉
    note: Optional[str] = None                         # 一句话附言,存全文不截断
    fed_back_at: Optional[str] = None


class DailyDrawRecord(BaseModel):
    effective_date: str            # "YYYY-MM-DD",用户本地生效日
    card: TarotCard
    conversation_id: str
    drawn_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    feedback: DailyFeedback = Field(default_factory=DailyFeedback)


class DailyDrawRequest(BaseModel):
    effective_date: str


class DailyFeedbackRequest(BaseModel):
    effective_date: str
    verdict: Optional[Literal["hit", "miss"]] = None
    note: Optional[str] = None


class DailyDayView(BaseModel):
    effective_date: str
    record: Optional[DailyDrawRecord] = None
    tagline: Optional[str] = None          # 解读首句(懒取自对话,不落库)
    conversation_exists: bool = False


class DailyOverviewResponse(BaseModel):
    today_effective_date: str
    today_record: Optional[DailyDrawRecord] = None
    streak: int = 0
    history: List[DailyDayView] = []       # 升序 14 天,最后一项为今日


class DailyDrawResponse(BaseModel):
    record: DailyDrawRecord
    conversation_id: str
```

- [ ] **Step 3: conversation_service.py 两处适配**

`_get_default_title` 的 title_map 增加一项(daily 路由随后会用具体日期覆盖,此为兜底):

```python
        title_map = {
            SessionType.TAROT: "塔罗占卜",
            SessionType.ASTROLOGY: "星盘解读",
            SessionType.CHAT: "聊愈对话",
            SessionType.DAILY: "每日一签",
        }
```

`add_message` 中自动标题逻辑(line 70)加 daily 豁免——日运标题是「M月D日 · 每日一签」,不能被「请根据抽牌结果进行解读」覆盖:

```python
        # 如果是用户的第一条消息，根据内容更新标题（daily 对话标题固定为日期，不覆盖）
        if (
            role == MessageRole.USER
            and conversation.session_type != SessionType.DAILY
            and len([m for m in conversation.messages if m.role == MessageRole.USER]) == 1
        ):
            conversation.title = ConversationService._generate_title_from_message(content)
```

- [ ] **Step 4: 验证可导入**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/backend && ../venv/bin/python -c "from models import SessionType, DailyDrawRecord, DailyOverviewResponse; from config import DAILY_DRAWS_FILE, PROMPTS_DIR; print(SessionType.DAILY.value, DAILY_DRAWS_FILE.name, PROMPTS_DIR.name)"`
Expected: `daily daily_draws.json prompts`

- [ ] **Step 5: Commit**

```bash
git add backend/config.py backend/models.py backend/services/conversation_service.py
git commit -m "feat(daily): SessionType.DAILY + daily 数据模型 + 对话标题豁免"
```

---

### Task 2: pytest 基建 + daily_service 纯函数(TDD)

**Files:**
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_daily_service.py`
- Create: `backend/services/daily_service.py`
- Modify: `requirements.txt`(根目录)

- [ ] **Step 1: 安装 pytest 并记入 requirements**

```bash
/Users/zhanfan/PycharmProjects/tarot-astro/venv/bin/pip install pytest
echo "pytest" >> /Users/zhanfan/PycharmProjects/tarot-astro/requirements.txt
```

- [ ] **Step 2: 创建 conftest(把 backend 加入 sys.path,与运行时一致)**

`backend/tests/conftest.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
```

- [ ] **Step 3: 写失败测试**

`backend/tests/test_daily_service.py`:

```python
from datetime import date

import pytest

from models import Conversation, DailyDrawRecord, DailyFeedback, Message, MessageRole, SessionType, TarotCard
from services.daily_service import (
    build_history_block,
    compute_streak,
    extract_tagline,
    render_template,
    select_history_records,
)


def make_record(effective_date: str, card_name: str = "星星 (The Star)", reversed_: bool = False,
                verdict: str | None = None, note: str | None = None,
                conversation_id: str = "conv_x") -> DailyDrawRecord:
    return DailyDrawRecord(
        effective_date=effective_date,
        card=TarotCard(card_id=17, card_name=card_name, reversed=reversed_),
        conversation_id=conversation_id,
        drawn_at="2026-06-11T00:00:00",
        feedback=DailyFeedback(verdict=verdict, note=note),
    )


class TestComputeStreak:
    def test_today_drawn_consecutive(self):
        dates = {"2026-06-11", "2026-06-10", "2026-06-09"}
        assert compute_streak(dates, date(2026, 6, 11)) == 3

    def test_today_not_drawn_counts_from_yesterday(self):
        dates = {"2026-06-10", "2026-06-09"}
        assert compute_streak(dates, date(2026, 6, 11)) == 2

    def test_gap_breaks_streak(self):
        dates = {"2026-06-11", "2026-06-09"}
        assert compute_streak(dates, date(2026, 6, 11)) == 1

    def test_empty(self):
        assert compute_streak(set(), date(2026, 6, 11)) == 0


class TestSelectHistoryRecords:
    def test_caps_at_seven_draws(self):
        records = {f"2026-06-{d:02d}": make_record(f"2026-06-{d:02d}") for d in range(1, 11)}  # 6/1..6/10
        picked = select_history_records(records, date(2026, 6, 11))
        assert len(picked) == 7
        assert picked[0].effective_date == "2026-06-04"   # 升序,最近 7 次
        assert picked[-1].effective_date == "2026-06-10"

    def test_fourteen_day_cutoff(self):
        records = {
            "2026-05-27": make_record("2026-05-27"),  # 距 6/11 已 15 天,超窗
            "2026-05-29": make_record("2026-05-29"),
            "2026-06-10": make_record("2026-06-10"),
        }
        picked = select_history_records(records, date(2026, 6, 11))
        assert [r.effective_date for r in picked] == ["2026-05-29", "2026-06-10"]

    def test_skips_future_dates_keeps_anchor_day(self):
        records = {
            "2026-06-12": make_record("2026-06-12"),  # 晚间抽的明日签,不进上下文
            "2026-06-11": make_record("2026-06-11"),
            "2026-06-10": make_record("2026-06-10"),
        }
        picked = select_history_records(records, date(2026, 6, 11))
        assert [r.effective_date for r in picked] == ["2026-06-10", "2026-06-11"]

    def test_fewer_than_seven_uses_actual(self):
        records = {"2026-06-10": make_record("2026-06-10")}
        assert len(select_history_records(records, date(2026, 6, 11))) == 1


class TestBuildHistoryBlock:
    def test_empty_is_first_draw(self):
        assert "第一签" in build_history_block([])

    def test_line_format(self):
        rec = make_record("2026-06-10", card_name="宝剑三", reversed_=True, verdict="hit", note="确实和同事起了争执")
        block = build_history_block([rec])
        assert block == "6月10日 | 宝剑三·逆位 | 印证:应验了 | 附言:确实和同事起了争执"

    def test_no_feedback_and_miss(self):
        no_fb = make_record("2026-06-09")
        miss = make_record("2026-06-10", verdict="miss")
        block = build_history_block([no_fb, miss])
        lines = block.split("\n")
        assert "未印证" in lines[0]
        assert "印证:没感觉" in lines[1]
        assert "附言" not in block


def make_conversation(messages: list[Message]) -> Conversation:
    return Conversation(
        conversation_id="conv_x", user_id="u1",
        session_type=SessionType.DAILY, title="t", messages=messages,
    )


class TestExtractTagline:
    def test_first_sentence_of_first_assistant_message(self):
        conv = make_conversation([
            Message(role=MessageRole.SYSTEM, content="用户已完成抽牌"),
            Message(role=MessageRole.USER, content="请根据抽牌结果进行解读"),
            Message(role=MessageRole.ASSISTANT, content="星星在今夜为你点灯。它提醒你保持希望。"),
        ])
        assert extract_tagline(conv) == "星星在今夜为你点灯"

    def test_caps_at_40_chars(self):
        conv = make_conversation([Message(role=MessageRole.ASSISTANT, content="无" * 80)])
        assert len(extract_tagline(conv)) == 40

    def test_none_cases(self):
        assert extract_tagline(None) is None
        assert extract_tagline(make_conversation([])) is None


class TestRenderTemplate:
    def test_replaces_placeholders_and_hot_reads(self, tmp_path, monkeypatch):
        import services.daily_service as ds
        monkeypatch.setattr(ds, "PROMPTS_DIR", tmp_path)
        (tmp_path / "t.md").write_text("你好 {nickname},今天是 {today_date}。{孤立花括号不崩}", encoding="utf-8")
        out = render_template("t.md", {"nickname": "小x", "today_date": "2026-06-11"})
        assert out == "你好 小x,今天是 2026-06-11。{孤立花括号不崩}"
        # 热加载:改文件后再次渲染立即生效
        (tmp_path / "t.md").write_text("新版 {nickname}", encoding="utf-8")
        assert render_template("t.md", {"nickname": "小x"}) == "新版 小x"

    def test_missing_template_raises(self, tmp_path, monkeypatch):
        import services.daily_service as ds
        monkeypatch.setattr(ds, "PROMPTS_DIR", tmp_path)
        with pytest.raises(FileNotFoundError):
            render_template("nope.md", {})
```

- [ ] **Step 4: 运行确认失败**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/backend && ../venv/bin/python -m pytest tests/ -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.daily_service'`

- [ ] **Step 5: 创建 daily_service.py(本步只含纯函数)**

`backend/services/daily_service.py`:

```python
"""
每日一签(Daily Oracle)服务。

- 纯函数:streak、解读上下文窗口、history_block、签语提取、模板渲染(本文件上半部,可单测)
- DailyService:daily_draws.json 读写 + 提示词组装(Task 3 追加)

提示词模板在 backend/prompts/ 下,每次请求实时读盘渲染——编辑保存后下一次请求立即生效。
"""
import re
from datetime import date, timedelta
from typing import Dict, List, Optional

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
```

注意:`render_template` 内通过 `PROMPTS_DIR` 模块属性访问——测试用 monkeypatch 替换,所以函数体内要写 `PROMPTS_DIR / name` 而不能在 import 时固化路径拼接。当前写法满足(monkeypatch.setattr(ds, "PROMPTS_DIR", ...) 会生效,因为函数运行时查模块全局)。

- [ ] **Step 6: 运行测试确认通过**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/backend && ../venv/bin/python -m pytest tests/ -v`
Expected: 全部 PASS(15 个测试)

- [ ] **Step 7: Commit**

```bash
git add backend/tests/ backend/services/daily_service.py requirements.txt
git commit -m "feat(daily): daily_service 纯函数(streak/上下文窗口/签语/模板渲染) + pytest 基建"
```

---

### Task 3: daily_service 存储 + 提示词模板文件 + 提示词组装

**Files:**
- Modify: `backend/services/daily_service.py`(末尾追加)
- Create: `backend/prompts/daily_oracle_system.md`
- Create: `backend/prompts/daily_journey.md`

- [ ] **Step 1: daily_service.py 顶部补 import,末尾追加 DailyService 类**

顶部 import 区追加:

```python
import json

import aiofiles
```

文件末尾追加:

```python
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
```

- [ ] **Step 2: 创建每日解读模板**

`backend/prompts/daily_oracle_system.md`:

```markdown
你是「小x的秘密圣殿」中主持「每日一签」的占卜师。你陪伴用户进行每天一张牌的日运仪式,并把一天天的牌串成一段连续的心灵旅程。

# 你的风格
- 简短、温暖、有觉察力;直觉敏锐但不卖弄术语。
- 有连续感:如果<近日旅程>中有记录,自然地呼应它们(例如"昨天的宝剑三还带着些刺,今天的星星来得正好");用户印证过"应验"的,温和地接住;说"没感觉"的,不辩解,换个角度陪他看。
- 不宿命、不吓人;把牌当成观照当下的镜子,而非判决。

# 任务
用户刚刚抽出了今日的指引牌:{today_card}(生效日期:{today_date})。
请给出今日解读,要求:
1. 第一句话点出这张牌今天最想提醒用户的事——这句会被单独用作"签语"展示,务必凝练、有画面感,不超过 30 字,以句号结尾。
2. 随后用 150-250 字展开:结合牌意讲讲今天值得留意的心境、人际或选择;如<近日旅程>非空,至少自然呼应其中一处。
3. 结尾用一个轻轻的开放式问题邀请用户聊聊(例如"今天有什么正悬在你心上的事吗?")。
4. 今日的牌已经抽出,绝对不要调用 draw_tarot_cards 工具。
5. 之后用户若继续聊天,像朋友兼占卜师那样对话,可引用<近日旅程>中的任何细节;需要更早的占卜历史时可使用 read_divination_notebook 工具。

# <用户>
昵称:{nickname}
{birth_info}

# <近日旅程>(最近至多 7 次日运,最远回溯 14 天;"未印证"表示用户尚未反馈)
{history_block}
```

- [ ] **Step 3: 创建心灵奇旅模板**

`backend/prompts/daily_journey.md`:

```markdown
你是「小x的秘密圣殿」的旅程记述者。请根据下面的日运记录与占卜笔记,为用户写一段「心灵奇旅」回顾。

# 要求
- 第二人称("你"),像一位看着用户走过这段日子的温柔旁观者。
- 把日子串成一条有起伏的故事线:从哪里出发、经历了什么转折、此刻走到了哪里;点出反复出现的主题(某类牌组、某种情绪)。
- 用户印证过"应验"的日子可以作为故事的锚点;"没感觉"的日子也诚实纳入,不强行圆说。
- 350-500 字,分 2-4 个自然段;结尾给一句面向接下来几天的祝语。
- 直接开始讲述,不要任何开场白或客套,不要调用任何工具。

# <用户>
昵称:{nickname}

# <时间范围>
{date_range}

# <日运记录>
{history_block}

# <占卜笔记摘录>(来自这些日子里用户与占卜师的对话,可能为空)
{notebook_block}
```

- [ ] **Step 4: 验证(回归纯函数测试 + 渲染冒烟)**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/backend && ../venv/bin/python -m pytest tests/ -v && ../venv/bin/python -c "
from services.daily_service import render_template
out = render_template('daily_oracle_system.md', {'nickname':'小x','birth_info':'生日:未提供','today_date':'2026-06-11','today_card':'星星·正位','history_block':'(这是旅程的第一签,还没有过往记录。)'})
assert '小x' in out and '星星·正位' in out and '{nickname}' not in out
print('render ok')"`
Expected: 测试全 PASS + `render ok`

- [ ] **Step 5: Commit**

```bash
git add backend/services/daily_service.py backend/prompts/
git commit -m "feat(daily): daily_draws 存储 + 热加载提示词模板(每日解读/心灵奇旅)"
```

---

### Task 4: gemini_service 支持 system_prompt_override + daily 工具集

**Files:**
- Modify: `backend/services/gemini_service.py`

- [ ] **Step 1: `_format_messages_for_gemini` 增加 override 参数**

签名与提示词选择改为(backend/services/gemini_service.py:329-346 区域):

```python
    def _format_messages_for_gemini(
        self,
        messages: List[Message],
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT,
        system_prompt_override: Optional[str] = None
    ) -> List[Dict]:
        """将消息格式化为Gemini API格式"""
        gemini_messages = []

        # 根据会话类型选择系统提示;override(daily/journey)由调用方完整渲染,
        # 已含用户资料,不再追加 user_context
        if system_prompt_override is not None:
            system_prompt = system_prompt_override
        else:
            if session_type == SessionType.ASTROLOGY:
                system_prompt = self.ASTROLOGY_SYSTEM_PROMPT
            else:
                system_prompt = self.TAROT_SYSTEM_PROMPT

            user_context = self._build_user_context(user)
            if user_context:
                system_prompt += f"\n\n{user_context}"
```

(后续 `gemini_messages.append(...)` 两段保持不变。)

- [ ] **Step 2: `stream_response` 与 `continue_with_function_result` 透传 override**

两个方法的签名各加一个参数(放在 `function_executor` / `function_result` 之后):

```python
        system_prompt_override: Optional[str] = None
```

两处 `_format_messages_for_gemini` 调用点(约 line 434 与 564)改为:

```python
        gemini_messages = self._format_messages_for_gemini(messages, user, session_type, system_prompt_override)
```

`stream_response` 内部若有对 `continue_with_function_result`(或自身递归)的调用,同样补传 `system_prompt_override=system_prompt_override`(用 `grep -n "continue_with_function_result(" backend/services/gemini_service.py` 找全部调用点)。

- [ ] **Step 3: daily 使用 tarot 工具集**

两处工具集选择(约 line 423 与 552):

```python
        # 选择工具集(daily 与 tarot 同集:含 read_divination_notebook;模板已禁止再抽牌)
        tools = self.tarot_tools if session_type in (SessionType.TAROT, SessionType.DAILY) else self.astrology_tools
```

- [ ] **Step 4: 验证可导入 + 回归**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/backend && ../venv/bin/python -c "from services.gemini_service import GeminiService; import inspect; sig = inspect.signature(GeminiService._format_messages_for_gemini); assert 'system_prompt_override' in sig.parameters; print('ok')" && ../venv/bin/python -m pytest tests/ -q`
Expected: `ok` + 测试全 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/gemini_service.py
git commit -m "feat(daily): gemini_service 支持 system_prompt_override,daily 走 tarot 工具集"
```

---

### Task 5: /api/daily 路由 + tarot.py 注入 daily 提示词 + 注册

**Files:**
- Create: `backend/routers/daily.py`
- Modify: `backend/routers/tarot.py`
- Modify: `backend/main.py`

- [ ] **Step 1: 创建 daily 路由**

`backend/routers/daily.py`:

```python
from datetime import date, timedelta
import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from models import (
    DailyDayView, DailyDrawRecord, DailyDrawRequest, DailyDrawResponse,
    DailyFeedbackRequest, DailyOverviewResponse, DrawCardsRequest,
    Message, MessageRole, SessionType,
)
from services.conversation_service import ConversationService
from services.daily_service import CALENDAR_DAYS, DailyService, compute_streak, extract_tagline
from services.gemini_service import GeminiService
from services.notebook_service import notebook_service
from services.tarot_service import TarotService
from services.user_service import UserService

router = APIRouter(prefix="/api/daily", tags=["daily"])

gemini_service = GeminiService()


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="无效的日期格式,应为 YYYY-MM-DD")


@router.get("/{user_id}/overview", response_model=DailyOverviewResponse)
async def get_overview(user_id: str, date_param: str = Query(..., alias="date")):
    """近 14 天日运概览:逐日记录 + 签语(懒取) + streak。
    date 为前端按本地时间(18:00 切日)算出的今日生效日。"""
    today = _parse_date(date_param)
    records = await DailyService.get_user_records(user_id)
    streak = compute_streak(set(records.keys()), today)

    history: list[DailyDayView] = []
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
async def draw_daily(user_id: str, body: DailyDrawRequest):
    """每日抽牌:一日一次。创建 daily 对话 + 服务端随机单张 + 落记录。
    解读不在此生成——前端随后走 /api/tarot/message 流式触发。"""
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
async def save_feedback(user_id: str, body: DailyFeedbackRequest):
    """印证反馈:近 14 天内任意有记录的日期均可写入/修改"""
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
):
    """心灵奇旅(用户主动触发,SSE 流式)。同日缓存命中且非 force 时直接回放,不花 token。"""
    _parse_date(date_param)

    cache = await DailyService.get_journey_cache(user_id)
    if cache and cache.get("generated_on") == date_param and not force:
        async def replay():
            yield f"data: {json.dumps({'content': cache['text']}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(replay(), media_type="text/event-stream")

    user = await UserService.get_user(user_id)
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
```

- [ ] **Step 2: tarot.py 对 daily 对话注入渲染后的系统提示词**

backend/routers/tarot.py:
① import 区:`from models import (...)` 中补 `SessionType`;新增 `from services.daily_service import DailyService`。
② `generate()` 内、`async for event in gemini_service.stream_response(` 之前(约 line 254)插入:

```python
            # daily 对话:每次请求实时渲染日运系统提示词(模板热加载 + history 始终最新)
            system_prompt_override = None
            if conversation.session_type == SessionType.DAILY:
                system_prompt_override = await DailyService.render_daily_system_prompt(conversation, user)
```

③ `stream_response(...)` 调用补传参数:

```python
            async for event in gemini_service.stream_response(
                conversation.messages,
                user,
                session_type=conversation.session_type,
                function_executor=execute_function,
                system_prompt_override=system_prompt_override
            ):
```

- [ ] **Step 3: main.py 注册路由**

`from routers import users, conversations, tarot, astrology, decks, wallet, payments` → 末尾加 `, daily`;
`app.include_router(payments.router)` 之后加 `app.include_router(daily.router)`。

- [ ] **Step 4: 起服 + curl 全链路验证**

```bash
cd /Users/zhanfan/PycharmProjects/tarot-astro && source venv/bin/activate && python backend/main.py &
sleep 3
# 1) 建访客用户
UID=$(curl -s -X POST localhost:8000/api/users/guest -H 'Content-Type: application/json' -d '{"nickname":"测试"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['user_id'])")
# 2) overview(应为空,streak=0,history 14 项)
curl -s "localhost:8000/api/daily/$UID/overview?date=$(date +%F)" | python3 -m json.tool | head -20
# 3) 抽牌(应返回 record + conversation_id)
curl -s -X POST localhost:8000/api/daily/$UID/draw -H 'Content-Type: application/json' -d "{\"effective_date\":\"$(date +%F)\"}" | python3 -m json.tool
# 4) 重复抽牌(应 409)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8000/api/daily/$UID/draw -H 'Content-Type: application/json' -d "{\"effective_date\":\"$(date +%F)\"}"
# 5) 越界日期(应 422)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8000/api/daily/$UID/draw -H 'Content-Type: application/json' -d '{"effective_date":"2030-01-01"}'
# 6) 解读 SSE(取第3步的 conversation_id;观察后端日志确认系统提示词为渲染后的日运模板)
CONV=<第3步返回的 conversation_id>
curl -sN -X POST localhost:8000/api/tarot/message -H 'Content-Type: application/json' -d "{\"conversation_id\":\"$CONV\",\"content\":\"请根据抽牌结果进行解读\"}" | head -20
# 7) 反馈
curl -s -X POST localhost:8000/api/daily/$UID/feedback -H 'Content-Type: application/json' -d "{\"effective_date\":\"$(date +%F)\",\"verdict\":\"hit\",\"note\":\"准的\"}" | python3 -m json.tool
# 8) journey:记录不足应 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST "localhost:8000/api/daily/$UID/journey?date=$(date +%F)"
# 9) 标题与签语:overview 应出现 tagline 与「M月D日 · 每日一签」标题(经 conversations 接口看标题)
curl -s "localhost:8000/api/daily/$UID/overview?date=$(date +%F)" | python3 -m json.tool | grep -A2 tagline | head -6
kill %1
```

Expected: 步骤 2 空概览;3 返回单张牌记录;4=409;5=422;6 流式输出解读(且标题保持「M月D日 · 每日一签」);7 反馈写入;8=400;9 出现非空 tagline。

- [ ] **Step 5: Commit**

```bash
git add backend/routers/daily.py backend/routers/tarot.py backend/main.py
git commit -m "feat(daily): /api/daily 路由(overview/draw/feedback/journey) + daily 提示词注入"
```

---

### Task 6: 前端 types + 生效日 util(TDD)+ dailyApi

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/utils/dailyDate.ts`
- Create: `frontend/src/utils/dailyDate.test.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: types 增加 DAILY 与 daily 接口类型**

`SessionType` enum 加 `DAILY = 'daily',`;文件末尾追加:

```typescript
// ── 每日一签 ──────────────────────────────────────────────────────

export interface DailyFeedback {
  verdict?: 'hit' | 'miss' | null;
  note?: string | null;
  fed_back_at?: string | null;
}

export interface DailyDrawRecord {
  effective_date: string;
  card: TarotCard;
  conversation_id: string;
  drawn_at: string;
  feedback: DailyFeedback;
}

export interface DailyDayView {
  effective_date: string;
  record?: DailyDrawRecord | null;
  tagline?: string | null;
  conversation_exists: boolean;
}

export interface DailyOverview {
  today_effective_date: string;
  today_record?: DailyDrawRecord | null;
  streak: number;
  history: DailyDayView[]; // 升序 14 天,最后一项为今日
}
```

- [ ] **Step 2: 写失败测试**

`frontend/src/utils/dailyDate.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getEffectiveDate, isEveningDraw } from './dailyDate';

describe('getEffectiveDate(本地时间,18:00 切日)', () => {
  it('18:00 前算今天', () => {
    expect(getEffectiveDate(new Date(2026, 5, 11, 17, 59))).toBe('2026-06-11');
  });
  it('18:00 起算明天', () => {
    expect(getEffectiveDate(new Date(2026, 5, 11, 18, 0))).toBe('2026-06-12');
  });
  it('跨月进位', () => {
    expect(getEffectiveDate(new Date(2026, 0, 31, 20, 30))).toBe('2026-02-01');
  });
});

describe('isEveningDraw', () => {
  it('18:00 为界', () => {
    expect(isEveningDraw(new Date(2026, 5, 11, 17, 59))).toBe(false);
    expect(isEveningDraw(new Date(2026, 5, 11, 18, 0))).toBe(true);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/frontend && npm test`
Expected: FAIL — 找不到 `./dailyDate`

- [ ] **Step 4: 实现 util**

`frontend/src/utils/dailyDate.ts`:

```typescript
/** 日运切日时刻:本地时间 18:00 后抽的签算作明日 */
export const EVENING_CUTOVER_HOUR = 18;

export function isEveningDraw(now: Date = new Date()): boolean {
  return now.getHours() >= EVENING_CUTOVER_HOUR;
}

/** 日运生效日(YYYY-MM-DD,本地时区):18:00 前=今天,之后=明天 */
export function getEffectiveDate(now: Date = new Date()): string {
  const d = new Date(now);
  if (isEveningDraw(d)) d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/frontend && npm test`
Expected: PASS(新增 4 个用例 + 原有 useDeckWallet 用例)

- [ ] **Step 6: api.ts 增加 dailyApi**

import type 区补 `DailyOverview, DailyDrawRecord`;在 `astrologyApi` 之后追加:

```typescript
// ── 每日一签 ──────────────────────────────────────────────────────
export const dailyApi = {
  overview: async (userId: string, date: string): Promise<DailyOverview> => {
    const r = await api.get(`/api/daily/${userId}/overview`, { params: { date } });
    return r.data;
  },

  draw: async (
    userId: string,
    effectiveDate: string
  ): Promise<{ record: DailyDrawRecord; conversation_id: string }> => {
    const r = await api.post(`/api/daily/${userId}/draw`, { effective_date: effectiveDate });
    return r.data;
  },

  feedback: async (
    userId: string,
    effectiveDate: string,
    verdict: 'hit' | 'miss',
    note?: string
  ): Promise<DailyDrawRecord> => {
    const r = await api.post(`/api/daily/${userId}/feedback`, {
      effective_date: effectiveDate,
      verdict,
      note: note || null,
    });
    return r.data;
  },

  /** 心灵奇旅(SSE 流式;解析方式与 tarotApi.sendMessage 一致) */
  journey: async (
    userId: string,
    date: string,
    force: boolean,
    onChunk: (chunk: string) => void
  ): Promise<void> => {
    const response = await fetch(
      `${API_BASE_URL}/api/daily/${userId}/journey?date=${date}&force=${force}`,
      { method: 'POST' }
    );
    if (!response.ok) {
      const err = new Error('旅程生成失败') as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) onChunk(parsed.content);
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    }
  },
};
```

- [ ] **Step 7: 构建验证 + Commit**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/frontend && npm run build`
Expected: 构建成功

```bash
git add frontend/src/types/index.ts frontend/src/utils/ frontend/src/services/api.ts
git commit -m "feat(daily): 前端 daily 类型 + 生效日 util(vitest) + dailyApi"
```

---

### Task 7: TarotCardDrawer 定制 props(文案 / 单张即选即确认 / 揭示开关)

**Files:**
- Modify: `frontend/src/components/TarotCardDrawer.tsx`

- [ ] **Step 1: Props 扩展**

`TarotCardDrawerProps`(line 7-12)改为:

```typescript
interface TarotCardDrawerProps {
  isOpen: boolean;
  drawRequest: DrawCardsRequest;
  onClose: () => void;
  onCardsDrawn: (cards: TarotCard[]) => void;
  /** 弹层标题,默认「抽取塔罗牌」(日运场景定制) */
  title?: string;
  /** 洗牌前副标题,默认「静心凝神，准备开启命运之门」 */
  subtitle?: string;
  /** false 时确认后不在抽牌器内翻面展示——真实牌面由调用方揭示(daily 用),默认 true */
  revealOnConfirm?: boolean;
}
```

组件解构(line 27-32)补:

```typescript
const TarotCardDrawer: React.FC<TarotCardDrawerProps> = ({
  isOpen,
  drawRequest,
  onClose,
  onCardsDrawn,
  title = '抽取塔罗牌',
  subtitle = '静心凝神，准备开启命运之门',
  revealOnConfirm = true,
}) => {
```

- [ ] **Step 2: 抽出 finishSelection,单张选中即确认**

`handleConfirm`(line 238-256)替换为:

```typescript
  const finishSelection = (indices: number[]) => {
    // 模拟抽牌结果(仪式用;daily 等场景的真实牌面由服务端决定)
    const drawnCards: TarotCard[] = indices.map((idx) => {
      const cardInfo = getCardInfo(idx);
      return {
        card_id: idx,
        card_name: cardInfo?.name_zh || `塔罗牌 ${idx}`,
        reversed: Math.random() < 0.3,
      };
    });

    if (!revealOnConfirm) {
      onCardsDrawn(drawnCards);
      onClose();
      return;
    }

    setConfirmedCards(drawnCards);

    // 延迟后关闭并返回结果
    setTimeout(() => {
      onCardsDrawn(drawnCards);
      onClose();
    }, 2000);
  };

  const handleConfirm = () => finishSelection(selectedIndices);
```

`handleCardClick`(line 223-236)中选满分支改为:

```typescript
    } else if (selectedIndices.length < drawRequest.card_count) {
      const newSelected = [...selectedIndices, index];
      setSelectedIndices(newSelected);
      if (newSelected.length === drawRequest.card_count) {
        if (drawRequest.card_count === 1) {
          finishSelection(newSelected); // 单张:选中即确认,省去二次确认面板
        } else {
          setShowConfirm(true);
        }
      }
    }
```

- [ ] **Step 3: 文案接入**

Header(line 322-329):

```tsx
                    <h2 className="text-2xl font-display font-semibold mystic-text">
                      {title}
                    </h2>
                    <p className="text-gray-400 font-display mt-1">
                      {isSpread
                        ? `请选择 ${drawRequest.card_count} 张牌 (已选${selectedIndices.length}/${drawRequest.card_count})`
                        : subtitle}
                    </p>
```

- [ ] **Step 4: 构建验证 + Commit**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/frontend && npm run build`
Expected: 构建成功(默认值保证既有调用零改动)

```bash
git add frontend/src/components/TarotCardDrawer.tsx
git commit -m "feat(daily): 选牌器支持定制文案/单张即选即确认/揭示开关"
```

---

### Task 8: DailyCalendarStrip 两周日历带

**Files:**
- Create: `frontend/src/components/daily/DailyCalendarStrip.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import React from 'react';
import { motion } from 'framer-motion';
import { getCardInfo } from '@/config/tarotCards';
import type { DailyDayView } from '@/types';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface DailyCalendarStripProps {
  history: DailyDayView[]; // 升序,最后一格为今日
  todayDate: string;
  selectedDate: string | null;
  onSelect: (date: string) => void;
}

/** 两周日历带:过往日显示牌面缩略,空日为暗格,今日金边高亮,逐格 stagger 浮现 */
const DailyCalendarStrip: React.FC<DailyCalendarStripProps> = ({
  history,
  todayDate,
  selectedDate,
  onSelect,
}) => (
  <div
    className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1"
    role="listbox"
    aria-label="近两周日运"
  >
    {history.map((day, i) => {
      const d = new Date(`${day.effective_date}T00:00:00`);
      const isToday = day.effective_date === todayDate;
      const isSelected = day.effective_date === selectedDate;
      const img = day.record ? getCardInfo(day.record.card.card_id)?.imageUrl : undefined;
      return (
        <motion.button
          key={day.effective_date}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.35 }}
          onClick={() => onSelect(day.effective_date)}
          className="flex-shrink-0 flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors hover:bg-white/[0.04]"
          style={{
            border: `1px solid ${
              isSelected ? 'var(--gold)' : isToday ? 'rgba(201,169,110,0.5)' : 'transparent'
            }`,
            background: isSelected ? 'rgba(201,169,110,0.08)' : 'transparent',
          }}
          role="option"
          aria-selected={isSelected}
          aria-label={`${day.effective_date}${day.record ? ` ${day.record.card.card_name}` : ' 未抽签'}`}
        >
          <span
            className="text-[9px] tracking-wider"
            style={{ color: isToday ? 'var(--gold)' : 'var(--ivory-dim)' }}
          >
            {isToday ? '今' : WEEKDAYS[d.getDay()]}
          </span>
          <span
            className="w-7 h-11 rounded-[3px] overflow-hidden flex items-center justify-center"
            style={{
              border: '1px solid',
              borderColor: day.record ? 'rgba(201,169,110,0.4)' : 'var(--line)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            {img ? (
              <img
                src={img}
                alt=""
                aria-hidden
                className="w-full h-full object-cover"
                style={{ transform: day.record!.card.reversed ? 'rotate(180deg)' : 'none' }}
                loading="lazy"
              />
            ) : (
              <span className="text-[10px]" style={{ color: 'var(--line)' }}>
                ·
              </span>
            )}
          </span>
          <span className="text-[9px]" style={{ color: 'var(--ivory-dim)' }}>
            {d.getDate()}
          </span>
        </motion.button>
      );
    })}
  </div>
);

export default DailyCalendarStrip;
```

- [ ] **Step 2: 构建验证 + Commit**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/frontend && npm run build`
Expected: 构建成功

```bash
git add frontend/src/components/daily/DailyCalendarStrip.tsx
git commit -m "feat(daily): 两周日历带组件"
```

---

### Task 9: DailyOracleBanner 殿堂入口横幅

**Files:**
- Create: `frontend/src/components/daily/DailyOracleBanner.tsx`

- [ ] **Step 1: 创建组件(与 GalleryBanner 同构的玻璃面板;未抽=呼吸牌背,已抽=翻为牌面+签语;streak 徽记)**

```tsx
import React from 'react';
import { motion } from 'framer-motion';
import { CARD_BACK_IMAGE, getCardInfo } from '@/config/tarotCards';
import { isEveningDraw } from '@/utils/dailyDate';
import type { DailyOverview } from '@/types';

interface DailyOracleBannerProps {
  overview: DailyOverview | null;
  onOpen: () => void;
}

/** 殿堂主页「每日一签」仪式入口:未抽=呼吸辉光牌背,已抽=今日牌面+签语 */
const DailyOracleBanner: React.FC<DailyOracleBannerProps> = ({ overview, onOpen }) => {
  const [hovered, setHovered] = React.useState(false);
  const record = overview?.today_record ?? null;
  const todayView = overview?.history[overview.history.length - 1];
  const tagline = todayView?.tagline;
  const streak = overview?.streak ?? 0;
  const cardInfo = record ? getCardInfo(record.card.card_id) : undefined;
  const evening = isEveningDraw();

  return (
    <motion.button
      onClick={onOpen}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.65, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
      whileHover={{ y: -3 }}
      className="group relative w-full rounded-2xl overflow-hidden flex items-center gap-5 sm:gap-7 px-5 sm:px-7 py-4 text-left"
      style={{
        background: 'linear-gradient(110deg, rgba(18,18,30,0.7) 0%, rgba(11,11,22,0.5) 100%)',
        border: `1px solid ${hovered ? 'rgba(201,169,110,0.5)' : 'var(--line)'}`,
        boxShadow: hovered
          ? '0 18px 50px rgba(0,0,0,0.5), 0 0 30px rgba(201,169,110,0.1)'
          : '0 10px 30px rgba(0,0,0,0.3)',
        transition: 'border-color .4s, box-shadow .4s',
      }}
    >
      {/* 牌位:未抽=呼吸辉光牌背,已抽=今日牌面 */}
      <span className="relative flex-shrink-0">
        <motion.span
          className="block w-[44px] h-[72px] rounded-md overflow-hidden"
          style={{ border: '1px solid rgba(201,169,110,0.4)' }}
          animate={
            record
              ? { y: 0, boxShadow: '0 6px 16px rgba(0,0,0,0.5)' }
              : {
                  y: hovered ? -4 : 0,
                  boxShadow: [
                    '0 0 10px rgba(201,169,110,0.15)',
                    '0 0 22px rgba(201,169,110,0.45)',
                    '0 0 10px rgba(201,169,110,0.15)',
                  ],
                }
          }
          transition={
            record
              ? { duration: 0.4 }
              : { boxShadow: { duration: 4, repeat: Infinity, ease: 'easeInOut' }, y: { duration: 0.3 } }
          }
        >
          {/* 已抽态用 rotateY 翻面揭示 */}
          <motion.img
            key={record ? 'face' : 'back'}
            initial={record ? { rotateY: 90 } : false}
            animate={{ rotateY: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            src={record ? cardInfo?.imageUrl || CARD_BACK_IMAGE : CARD_BACK_IMAGE}
            alt=""
            aria-hidden
            className="w-full h-full object-cover"
            style={{ transform: record?.card.reversed ? 'rotate(180deg)' : undefined }}
            loading="lazy"
          />
        </motion.span>
      </span>

      {/* 文案 */}
      <span className="flex-1 min-w-0">
        <span
          className="eyebrow block"
          style={{ fontSize: '10px', letterSpacing: '0.3em', color: 'var(--gold)' }}
        >
          DAILY ORACLE
        </span>
        <span
          className="block font-display font-semibold text-lg tracking-[0.1em] mt-1"
          style={{ color: 'var(--ivory)' }}
        >
          {record
            ? `${record.card.card_name} · ${record.card.reversed ? '逆位' : '正位'}`
            : evening
              ? '为明日求一签'
              : '今日一签 · 待启'}
        </span>
        <span
          className="block text-xs mt-1 leading-relaxed truncate"
          style={{ color: 'var(--ivory-dim)' }}
        >
          {record ? tagline || '今日的指引已揭示' : '静心抽取,看看今天的指引'}
        </span>
      </span>

      {/* streak 徽记(N≥2 才显示) */}
      {streak >= 2 && (
        <span
          className="absolute top-3 right-4 sm:right-5 text-[10px] tracking-[0.18em] font-display"
          style={{ color: 'var(--gold)' }}
        >
          连续 {streak} 天 ✦
        </span>
      )}

      {/* affordance */}
      <span
        className="flex-shrink-0 hidden sm:flex items-center gap-1.5 text-sm tracking-[0.18em] font-display transition-transform duration-300 group-hover:translate-x-1"
        style={{ color: 'var(--gold)' }}
      >
        {record ? '查看今日指引 ›' : '抽取 ›'}
      </span>
    </motion.button>
  );
};

export default DailyOracleBanner;
```

- [ ] **Step 2: 构建验证 + Commit**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/frontend && npm run build`
Expected: 构建成功

```bash
git add frontend/src/components/daily/DailyOracleBanner.tsx
git commit -m "feat(daily): 殿堂主页日运入口横幅(呼吸牌背/已抽翻面/streak)"
```

---

### Task 10: DailyOracleModal 弹窗(日历 / 抽牌 / 解读 / 印证 / 旅程)

**Files:**
- Create: `frontend/src/components/daily/DailyOracleModal.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, RefreshCw } from 'lucide-react';
import TarotCardDrawer from '../TarotCardDrawer';
import DailyCalendarStrip from './DailyCalendarStrip';
import Markdown from '../Markdown';
import { conversationApi, dailyApi, tarotApi } from '@/services/api';
import { CARD_BACK_IMAGE, getCardInfo } from '@/config/tarotCards';
import { getEffectiveDate, isEveningDraw } from '@/utils/dailyDate';
import { toast } from '@/stores/useToastStore';
import { MessageRole } from '@/types';
import type { DailyDayView, DailyOverview, DrawCardsRequest } from '@/types';

const DAILY_DRAW_REQUEST: DrawCardsRequest = {
  spread_type: 'single',
  card_count: 1,
  positions: ['今日指引'],
};
// 与后端 services/daily_service.py 的 JOURNEY_MIN_RECORDS 保持一致
const JOURNEY_MIN_RECORDS = 3;

interface DailyOracleModalProps {
  isOpen: boolean;
  userId: string;
  overview: DailyOverview | null;
  onClose: () => void;
  onRefreshOverview: () => Promise<void>;
  onContinueConversation: (conversationId: string) => void;
}

/**
 * 每日一签弹窗:顶部两周日历带 + 今日舞台(抽牌/解读)+ 回顾态(印证)+ 心灵奇旅。
 * 选牌器是纯仪式——真实牌面来自 POST /api/daily/draw 的响应,在本弹窗内翻面揭示。
 */
const DailyOracleModal: React.FC<DailyOracleModalProps> = ({
  isOpen,
  userId,
  overview,
  onClose,
  onRefreshOverview,
  onContinueConversation,
}) => {
  const todayDate = overview?.today_effective_date ?? getEffectiveDate();
  const [selectedDate, setSelectedDate] = useState<string>(todayDate);
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawing, setDrawing] = useState(false);
  // conversation_id → 解读全文;undefined=未加载,null=对话已删除,''=尚无解读
  const [readings, setReadings] = useState<Record<string, string | null>>({});
  const [isReading, setIsReading] = useState(false);
  // 印证表单(回顾态)
  const [verdict, setVerdict] = useState<'hit' | 'miss' | null>(null);
  const [note, setNote] = useState('');
  const [savingFeedback, setSavingFeedback] = useState(false);
  // 心灵奇旅
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [journeyText, setJourneyText] = useState('');
  const [journeyLoading, setJourneyLoading] = useState(false);

  const selectedView: DailyDayView | undefined = overview?.history.find(
    (h) => h.effective_date === selectedDate
  );
  const record = selectedView?.record ?? null;
  const isToday = selectedDate === todayDate;
  const drawnCount = overview?.history.filter((h) => h.record).length ?? 0;
  const reading = record ? readings[record.conversation_id] : undefined;

  // 打开时重置到今日、收起旅程
  useEffect(() => {
    if (isOpen) {
      setSelectedDate(todayDate);
      setJourneyOpen(false);
      setJourneyText('');
    }
  }, [isOpen, todayDate]);

  // 选中某天:同步印证表单 + 懒取该日解读全文
  useEffect(() => {
    const view = overview?.history.find((h) => h.effective_date === selectedDate);
    setVerdict(view?.record?.feedback?.verdict ?? null);
    setNote(view?.record?.feedback?.note ?? '');
    const rec = view?.record;
    if (!rec || readings[rec.conversation_id] !== undefined) return;
    if (!view?.conversation_exists) {
      setReadings((prev) => ({ ...prev, [rec.conversation_id]: null }));
      return;
    }
    conversationApi
      .get(rec.conversation_id)
      .then((conv) => {
        const first = conv.messages.find((m) => m.role === MessageRole.ASSISTANT);
        setReadings((prev) => ({ ...prev, [rec.conversation_id]: first?.content ?? '' }));
      })
      .catch(() => setReadings((prev) => ({ ...prev, [rec.conversation_id]: null })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, overview, isOpen]);

  const streamReading = async (conversationId: string) => {
    setIsReading(true);
    setReadings((prev) => ({ ...prev, [conversationId]: '' }));
    try {
      await tarotApi.sendMessage(
        conversationId,
        '请根据抽牌结果进行解读',
        (chunk) =>
          setReadings((prev) => ({
            ...prev,
            [conversationId]: ((prev[conversationId] as string) || '') + chunk,
          })),
        () => {} // daily 解读不会再触发抽牌
      );
      await onRefreshOverview(); // 刷新签语/横幅
    } catch {
      toast.error('解读生成中断,可点「重新生成解读」再试');
    } finally {
      setIsReading(false);
    }
  };

  const handleCardsDrawn = async () => {
    // 选牌器仪式完成 → 调后端拿真实牌面 → 在弹窗里揭示并流式解读
    setShowDrawer(false);
    setDrawing(true);
    try {
      const eff = getEffectiveDate();
      const res = await dailyApi.draw(userId, eff);
      await onRefreshOverview();
      setSelectedDate(eff);
      await streamReading(res.conversation_id);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error('这一日已抽过签');
        await onRefreshOverview();
      } else {
        toast.error('抽牌失败,请重试');
      }
    } finally {
      setDrawing(false);
    }
  };

  const handleSaveFeedback = async () => {
    if (!verdict) return;
    setSavingFeedback(true);
    try {
      await dailyApi.feedback(userId, selectedDate, verdict, note.trim() || undefined);
      await onRefreshOverview();
      toast.success('已记下你的印证 ✦');
    } catch {
      toast.error('保存失败,请重试');
    } finally {
      setSavingFeedback(false);
    }
  };

  const handleJourney = async (force: boolean) => {
    setJourneyOpen(true);
    setJourneyText('');
    setJourneyLoading(true);
    try {
      await dailyApi.journey(userId, todayDate, force, (chunk) =>
        setJourneyText((prev) => prev + chunk)
      );
    } catch (e) {
      const status = (e as { status?: number })?.status;
      toast.error(status === 400 ? '再积累几天,旅程自会显形' : '旅程生成失败');
      setJourneyOpen(false);
    } finally {
      setJourneyLoading(false);
    }
  };

  const cardInfo = record ? getCardInfo(record.card.card_id) : undefined;

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              className="relative w-full max-w-[560px] max-h-[88vh] overflow-y-auto rounded-2xl px-5 sm:px-7 py-6"
              style={{
                background: 'linear-gradient(160deg, rgba(18,18,30,0.97) 0%, rgba(8,8,18,0.97) 100%)',
                border: '1px solid rgba(201,169,110,0.3)',
                boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <span
                    className="eyebrow block"
                    style={{ fontSize: '10px', letterSpacing: '0.3em', color: 'var(--gold)' }}
                  >
                    DAILY ORACLE
                  </span>
                  <h2
                    className="font-display font-semibold text-xl tracking-[0.08em] mt-0.5"
                    style={{ color: 'var(--ivory)' }}
                  >
                    每日一签 · 心灵奇旅
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => (journeyOpen ? setJourneyOpen(false) : handleJourney(false))}
                    disabled={drawnCount < JOURNEY_MIN_RECORDS}
                    className="hidden sm:inline-flex items-center gap-1.5 text-xs tracking-[0.12em] font-display px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ color: 'var(--gold)' }}
                    title={drawnCount < JOURNEY_MIN_RECORDS ? '再积累几天,旅程自会显形' : '回望这段旅程'}
                  >
                    <Sparkles size={13} />
                    {journeyOpen ? '回到今日' : '回望这段旅程 ✦'}
                  </button>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-lg transition-colors hover:bg-white/[0.05]"
                    style={{ color: 'var(--ivory-dim)' }}
                    aria-label="关闭"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* 日历带 */}
              {overview && (
                <DailyCalendarStrip
                  history={overview.history}
                  todayDate={todayDate}
                  selectedDate={selectedDate}
                  onSelect={(d) => {
                    setJourneyOpen(false);
                    setSelectedDate(d);
                  }}
                />
              )}
              {/* 移动端旅程入口 */}
              <button
                onClick={() => (journeyOpen ? setJourneyOpen(false) : handleJourney(false))}
                disabled={drawnCount < JOURNEY_MIN_RECORDS}
                className="sm:hidden mt-1 mb-1 text-xs tracking-[0.12em] font-display disabled:opacity-40"
                style={{ color: 'var(--gold)' }}
              >
                {journeyOpen ? '回到今日' : '回望这段旅程 ✦'}
              </button>

              {/* 舞台区 */}
              <div className="mt-5 min-h-[260px]">
                {journeyOpen ? (
                  /* ── 心灵奇旅面板 ── */
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="eyebrow" style={{ letterSpacing: '0.28em', color: 'var(--gold)' }}>
                        JOURNEY · 心灵奇旅
                      </span>
                      <button
                        onClick={() => handleJourney(true)}
                        disabled={journeyLoading}
                        className="inline-flex items-center gap-1 text-[11px] transition-colors hover:text-white disabled:opacity-40"
                        style={{ color: 'var(--ivory-dim)' }}
                      >
                        <RefreshCw size={11} />
                        重新生成
                      </button>
                    </div>
                    {journeyText ? (
                      <Markdown content={journeyText} />
                    ) : (
                      <p className="text-sm" style={{ color: 'var(--ivory-dim)' }}>
                        正在回望这段旅程……
                      </p>
                    )}
                  </motion.div>
                ) : !record ? (
                  isToday ? (
                    /* ── 今日未抽 ── */
                    <div className="flex flex-col items-center text-center py-4">
                      <motion.img
                        src={CARD_BACK_IMAGE}
                        alt=""
                        aria-hidden
                        className="w-[110px] h-[180px] rounded-lg object-cover"
                        style={{ border: '1px solid rgba(201,169,110,0.4)' }}
                        animate={{
                          boxShadow: [
                            '0 0 14px rgba(201,169,110,0.15)',
                            '0 0 30px rgba(201,169,110,0.4)',
                            '0 0 14px rgba(201,169,110,0.15)',
                          ],
                        }}
                        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <p className="mt-5 text-sm" style={{ color: 'var(--ivory-dim)' }}>
                        {isEveningDraw() ? '夜色已深,为明日求一签吧' : '一日一签,静心而后抽取'}
                      </p>
                      <button
                        onClick={() => setShowDrawer(true)}
                        disabled={drawing || isReading}
                        className="mt-4 px-7 py-2.5 rounded-xl font-display tracking-[0.15em] text-sm transition-all hover:brightness-110 disabled:opacity-50"
                        style={{
                          color: '#1a1407',
                          background: 'linear-gradient(120deg, #C9A96E, #E2C893)',
                          boxShadow: '0 8px 24px rgba(201,169,110,0.25)',
                        }}
                      >
                        {drawing ? '正在抽取…' : isEveningDraw() ? '静心 · 为明日抽签' : '静心 · 抽取今日指引'}
                      </button>
                    </div>
                  ) : (
                    /* ── 过往空日 ── */
                    <p className="text-center text-sm py-16" style={{ color: 'var(--ivory-dim)' }}>
                      这一日未曾抽签 ·
                    </p>
                  )
                ) : (
                  /* ── 有记录(今日已抽 / 回顾态) ── */
                  <div className="flex flex-col items-center">
                    <motion.div
                      key={record.conversation_id}
                      initial={{ rotateY: 90, opacity: 0 }}
                      animate={{ rotateY: 0, opacity: 1 }}
                      transition={{ duration: 0.55, ease: 'easeOut' }}
                      className="w-[110px] h-[180px] rounded-lg overflow-hidden"
                      style={{
                        border: '1px solid rgba(201,169,110,0.45)',
                        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                      }}
                    >
                      <img
                        src={cardInfo?.imageUrl || CARD_BACK_IMAGE}
                        alt={record.card.card_name}
                        className="w-full h-full object-cover"
                        style={{ transform: record.card.reversed ? 'rotate(180deg)' : 'none' }}
                      />
                    </motion.div>
                    <p
                      className="mt-3 font-display font-semibold tracking-[0.1em]"
                      style={{ color: 'var(--ivory)' }}
                    >
                      {record.card.card_name} · {record.card.reversed ? '逆位' : '正位'}
                    </p>

                    {/* 解读区 */}
                    <div className="w-full mt-4 text-left">
                      {reading === undefined && !isReading ? (
                        <p className="text-sm text-center" style={{ color: 'var(--ivory-dim)' }}>
                          正在取回解读……
                        </p>
                      ) : reading === null ? (
                        <p className="text-sm text-center italic" style={{ color: 'var(--ivory-dim)' }}>
                          这段对话已随风而逝
                        </p>
                      ) : reading === '' && !isReading ? (
                        <div className="text-center">
                          <button
                            onClick={() => streamReading(record.conversation_id)}
                            className="text-sm font-display tracking-[0.1em] underline underline-offset-4"
                            style={{ color: 'var(--gold)' }}
                          >
                            重新生成解读
                          </button>
                        </div>
                      ) : (
                        <Markdown content={(reading as string) || ''} />
                      )}
                      {isReading && (
                        <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom animate-pulse" style={{ background: 'var(--gold)' }} />
                      )}
                    </div>

                    {/* 印证控件(仅过往日) */}
                    {!isToday && (
                      <div
                        className="w-full mt-5 rounded-xl px-4 py-3.5"
                        style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}
                      >
                        <span className="eyebrow block mb-2.5" style={{ letterSpacing: '0.24em' }}>
                          这一日的指引,应验了吗?
                        </span>
                        <div className="flex items-center gap-2">
                          {(['hit', 'miss'] as const).map((v) => (
                            <button
                              key={v}
                              onClick={() => setVerdict(v)}
                              className="px-3.5 py-1.5 rounded-full text-xs font-display tracking-[0.1em] transition-all"
                              style={{
                                border: `1px solid ${verdict === v ? 'var(--gold)' : 'var(--line)'}`,
                                color: verdict === v ? 'var(--gold)' : 'var(--ivory-dim)',
                                background: verdict === v ? 'rgba(201,169,110,0.1)' : 'transparent',
                              }}
                            >
                              {v === 'hit' ? '应验了 ✓' : '没感觉 ◦'}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-2.5">
                          <input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="想补一句吗?(可选)"
                            className="flex-1 bg-transparent text-sm px-3 py-1.5 rounded-lg outline-none placeholder:text-white/25"
                            style={{ border: '1px solid var(--line)', color: 'var(--ivory)' }}
                          />
                          <button
                            onClick={handleSaveFeedback}
                            disabled={!verdict || savingFeedback}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-display tracking-[0.1em] transition-all disabled:opacity-40"
                            style={{ border: '1px solid var(--gold)', color: 'var(--gold)' }}
                          >
                            {savingFeedback ? '…' : '记下'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 继续对话 */}
                    {selectedView?.conversation_exists && !isReading && reading !== undefined && reading !== null && reading !== '' && (
                      <button
                        onClick={() => onContinueConversation(record.conversation_id)}
                        className="mt-5 px-7 py-2.5 rounded-xl font-display tracking-[0.15em] text-sm transition-all hover:brightness-110"
                        style={{
                          color: '#1a1407',
                          background: 'linear-gradient(120deg, #C9A96E, #E2C893)',
                          boxShadow: '0 8px 24px rgba(201,169,110,0.25)',
                        }}
                      >
                        {isToday ? '继续这段对话 ›' : '查看当日对话 ›'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 全屏选牌器(z-50,盖在弹窗之上;纯仪式,真实牌面由 /api/daily/draw 决定) */}
      <TarotCardDrawer
        isOpen={showDrawer}
        drawRequest={DAILY_DRAW_REQUEST}
        onClose={() => setShowDrawer(false)}
        onCardsDrawn={handleCardsDrawn}
        title="每日一签"
        subtitle="静心凝神,为今天抽取一张指引"
        revealOnConfirm={false}
      />
    </>
  );
};

export default DailyOracleModal;
```

- [ ] **Step 2: 构建验证 + Commit**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/frontend && npm run build`
Expected: 构建成功

```bash
git add frontend/src/components/daily/DailyOracleModal.tsx
git commit -m "feat(daily): 日运弹窗(日历/抽牌/流式解读/印证/心灵奇旅)"
```

---

### Task 11: App 接线 + daily 会话类型适配(Sidebar/TopBar/ChatMessage)

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Sidebar.tsx:48-49`
- Modify: `frontend/src/components/TopBar.tsx:16-18,47`
- Modify: `frontend/src/components/ChatMessage.tsx:67-69`

- [ ] **Step 1: App.tsx — import、状态、加载与聚焦刷新**

import 区追加:

```tsx
import DailyOracleBanner from './components/daily/DailyOracleBanner';
import DailyOracleModal from './components/daily/DailyOracleModal';
import { dailyApi } from './services/api';
import { getEffectiveDate } from './utils/dailyDate';
import type { DailyOverview } from './types';
```

(`dailyApi` 并入现有 `import { userApi, conversationApi, ... } from './services/api';`;`DailyOverview` 并入现有 type import。)

状态区(`const [sidebarOpen, ...]` 附近)追加:

```tsx
  const [dailyOverview, setDailyOverview] = useState<DailyOverview | null>(null);
  const [showDailyModal, setShowDailyModal] = useState(false);

  const refreshDailyOverview = React.useCallback(async () => {
    const uid = useAuthStore.getState().user?.user_id;
    if (!uid) return;
    try {
      setDailyOverview(await dailyApi.overview(uid, getEffectiveDate()));
    } catch (error) {
      console.error('[Daily] 加载日运概览失败:', error);
    }
  }, []);
```

effects 区(钱包加载 effect 之后)追加:

```tsx
  // 日运概览:用户就绪时加载;窗口聚焦时重算生效日(跨天/跨 18:00 边界)并刷新
  useEffect(() => {
    if (user?.user_id) refreshDailyOverview();
  }, [user?.user_id, refreshDailyOverview]);

  useEffect(() => {
    const onFocus = () => refreshDailyOverview();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshDailyOverview]);
```

- [ ] **Step 2: App.tsx — 继续对话处理器**

`handleCardsDrawn` 之后追加:

```tsx
  // 「继续这段对话」:关弹窗,把 daily 对话设为当前会话(后续消息走 tarot 链路)
  const handleContinueDailyConversation = async (conversationId: string) => {
    setShowDailyModal(false);
    try {
      const conv = await conversationApi.get(conversationId);
      await loadUserConversations(); // 让新建的日运对话出现在侧边栏
      setCurrentConversation(conv);
    } catch (error) {
      console.error('[Daily] 打开日运对话失败:', error);
      toast.error('打开对话失败');
    }
  };
```

- [ ] **Step 3: App.tsx — JSX 挂载**

殿堂区(line ~897)改为:

```tsx
            <div className="w-full max-w-2xl mt-12 space-y-6">
              <GalleryBanner />
              <DailyOracleBanner overview={dailyOverview} onOpen={() => setShowDailyModal(true)} />
            </div>
```

`<TarotCardDrawer .../>`(line ~1045)之后追加:

```tsx
        {user && (
          <DailyOracleModal
            isOpen={showDailyModal}
            userId={user.user_id}
            overview={dailyOverview}
            onClose={() => setShowDailyModal(false)}
            onRefreshOverview={refreshDailyOverview}
            onContinueConversation={handleContinueDailyConversation}
          />
        )}
```

- [ ] **Step 4: Sidebar / TopBar / ChatMessage 的 daily 适配**

Sidebar.tsx line 48-49:

```tsx
  const accentFor = (s: SessionType) => (s === 'tarot' || s === 'daily' ? 'var(--gold)' : 'var(--moon)');
  const iconFor = (s: SessionType) => (s === 'tarot' || s === 'daily' ? '/assets/avatar_tarot.png' : '/assets/avatar.png');
```

TopBar.tsx line 16 与 eyebrow(line 47):

```tsx
  const isTarot = conversation.session_type === 'tarot' || conversation.session_type === 'daily';
```

```tsx
            {conversation.session_type === 'daily'
              ? 'DAILY ORACLE · 每日一签'
              : isTarot
                ? 'TAROT · 塔罗占卜'
                : 'ASTROLOGY · 占星'}
```

ChatMessage.tsx line 69:

```tsx
    sessionType === 'tarot' || sessionType === 'daily' ? '/assets/avatar_tarot.png' : '/assets/avatar.png';
```

(line 67 的 `oracleAccent` 无需改:daily 非 astrology,自然落金色。)

- [ ] **Step 5: 构建 + 测试验证**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/frontend && npm test && npm run build`
Expected: 测试 PASS + 构建成功

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Sidebar.tsx frontend/src/components/TopBar.tsx frontend/src/components/ChatMessage.tsx
git commit -m "feat(daily): 殿堂接入日运入口与弹窗,daily 会话类型全局适配"
```

---

### Task 12: 端到端手动验收(spec 验收清单)

**Files:** 无新增(发现问题就地修复后补 commit)

- [ ] **Step 1: 起服**

```bash
cd /Users/zhanfan/PycharmProjects/tarot-astro && make dev
```

(后端 :8000,前端 :5173;需要 GEMINI_API_KEY 已配置。)

- [ ] **Step 2: 逐项执行 spec 验收清单**

1. **首抽**:殿堂横幅呼吸态 → 点入口 → 弹窗 → 「静心 · 抽取今日指引」→ 选牌器选 1 张即关闭 → 弹窗内牌面翻转揭示 + 解读流式打出 → 横幅变为牌面+签语,日历今日格有牌。
2. **同日重抽被拒**:另开标签页重复抽 → toast「这一日已抽过签」,状态自洽。
3. **18:00 边界**:把系统时钟拨到 17:59 与 18:01 各试一次(或临时改 `EVENING_CUTOVER_HOUR`)→ 生效日分别为今天/明天,横幅文案变「为明日求一签」。
4. **次日印证进上下文**:手动把 `backend/data/daily_draws.json` 里记录的 effective_date 改成昨天 → 刷新 → 日历点昨日 → 印证「应验了」+附言 → 今天再抽 → 看后端日志中渲染后的系统提示词包含昨日行与附言。
5. **继续聊天 + notebook**:「继续这段对话」→ 进入聊天界面(TopBar 显示「DAILY ORACLE · 每日一签」,侧边栏有该对话)→ 聊几句 → 切走对话 → 确认 `backend/data/notebooks/` 生成笔记。
6. **journey**:记录 <3 时入口置灰;手动造 3 天记录后可生成;同日二次点击秒回(命中缓存);「重新生成」走 force。
7. **模板热加载**:编辑 `backend/prompts/daily_oracle_system.md`(如在风格区加一句口头禅)→ 不重启 → 在 daily 对话里发一条消息 → 回复风格立即变化。
8. **删除降级**:侧边栏删除某 daily 对话 → 弹窗回看该日 → 牌面/反馈仍在,解读区显示「这段对话已随风而逝」。
9. **移动端**:DevTools 切 375px 宽 → 横幅、弹窗、日历横滑、选牌器、印证控件全链路可用。

- [ ] **Step 3: 最终回归**

Run: `cd /Users/zhanfan/PycharmProjects/tarot-astro/backend && ../venv/bin/python -m pytest tests/ -q && cd ../frontend && npm test && npm run build`
Expected: 全部通过

- [ ] **Step 4: 修复项(如有)单独提交**

```bash
git add -A && git commit -m "fix(daily): E2E 验收修复"
```

---

## Self-Review 结论(已执行)

- **Spec 覆盖**:决策表 10 项、4 个 API、横幅两态+streak、弹窗四区、选牌器三项定制、6 条边界、9 条验收 → 均有对应任务(Task 1-12)。
- **类型一致性**:`DailyDrawRecord/DailyDayView/DailyOverviewResponse` 前后端字段一致;`dailyApi.journey(userId, date, force, onChunk)` 与 Modal 调用一致;`revealOnConfirm/title/subtitle` 与 Task 7 props 一致;`JOURNEY_MIN_RECORDS=3` 前后端各自定义并注释对齐。
- **无占位符**:所有代码块完整可落盘。
