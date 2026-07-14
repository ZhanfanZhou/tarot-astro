# 前置占卜师 Agent（开场幕分幕接力）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个前置占卜师 Agent 接管开场幕（迎接 → 共情 → 叙事性澄清），读人完成后产出结构化策略单并在同一轮 SSE 内无缝移交给解读 Agent，消灭硬编码打招呼的 AI 感。

**Architecture:** 会话新增显式状态位 `phase`（opening/reading，默认 reading = 存量会话零迁移）。opening 相位用独立小提示词 `opening_system.md` + 唯一工具 `submit_reading_brief`；模型交单后 harness 落库策略单、翻转 phase，并在同一个 Agent Loop 内用解读提示词+完整工具集重建 chat 续跑。三层守卫（提示词纪律 / Gemini `tool_config` mode=ANY 机械强制 / harness 兜底翻 phase）保证不会卡死在开场幕。前端零改动。

**Tech Stack:** FastAPI + Pydantic + aiosqlite(SQLite/WAL) + google-generativeai (Gemini Function Calling) + pytest。

**Spec:** `docs/superpowers/specs/2026-07-14-opening-agent-design.md`

**关键实现事实（已核实，勿推翻）：**
- `conversations` 表是文档型存储：整个 `Conversation` 对象 JSON 存在 `data` 列，`conversation_id/user_id/updated_at` 只是索引影子列。加字段 = 改 Pydantic 模型即可，**无 SQL 迁移**。
- `gemini_service._format_messages_for_gemini()`（backend/services/gemini_service.py:204-243）把历史消息**全部转为纯文本**，function_call/function_response 从不进历史。因此移交时重建 chat **不涉及工具调用配对**，安全。
- `chat = model.start_chat(history=…)` 是纯客户端状态，重建零成本。

**任务依赖图（用于并行下发 subagent）：**
```
Task 1 (models+phase初值) ─┬─► Task 4 (context_service) ─► Task 5 (gemini_service) ─► Task 6 (routers) ─► Task 7 (集成测试)
Task 2 (config 阈值)      ─┤
Task 3 (prompt 文案+注册) ─┘
        └────────────────► Task 7b (admin 会话面板)   ← 只依赖 Task 1，可与 4/5/6 并行
```
Task 1 / 2 / 3 互不依赖，**可并行下发**。Task 4 起串行；Task 7b 在 Task 1 完成后即可与主线并行。

**前端改动范围澄清**：主流程（塔罗/占星对话）前端**零改动**——SSE 契约、抽牌事件、空消息触发开场白的约定全部不变。唯一的前端改动是 **Task 7b 的后台管理页**（`pages/admin/`，独立 chunk，不影响用户端）。Prompt 管理面板由 `PROMPT_REGISTRY` 驱动，Task 3 登记后自动生效，无需前端改动。

---

### Task 1: Conversation 模型加 phase / strategy 字段

**Files:**
- Modify: `backend/models.py:97-107`（`class Conversation`）
- Modify: `backend/services/conversation_service.py:14-24`（`create_conversation`）
- Test: `backend/tests/test_conversation_phase.py`（新建）

- [ ] **Step 1: Write the failing test**

创建 `backend/tests/test_conversation_phase.py`：

```python
"""会话相位状态位：新建初值、存量会话默认值、往返持久化。

全程临时库（monkeypatch services.db.DB_FILE），绝不触碰 backend/data/*。
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Conversation, SessionType  # noqa: E402


@pytest.fixture
def db_env(tmp_path, monkeypatch):
    import services.db as db_mod
    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True

    asyncio.run(_init())
    return db_mod


def test_tarot_conversation_starts_in_opening_phase(db_env):
    from services.conversation_service import ConversationService

    conv = asyncio.run(
        ConversationService.create_conversation("u1", SessionType.TAROT)
    )
    assert conv.phase == "opening"
    assert conv.strategy is None


def test_astrology_conversation_starts_in_opening_phase(db_env):
    from services.conversation_service import ConversationService

    conv = asyncio.run(
        ConversationService.create_conversation("u1", SessionType.ASTROLOGY)
    )
    assert conv.phase == "opening"


def test_daily_conversation_starts_in_reading_phase(db_env):
    """每日一签/闲聊不走前置 Agent。"""
    from services.conversation_service import ConversationService

    for st in (SessionType.DAILY, SessionType.CHAT):
        conv = asyncio.run(ConversationService.create_conversation("u1", st))
        assert conv.phase == "reading", st


def test_legacy_conversation_without_phase_defaults_to_reading():
    """存量会话的 data JSON 没有 phase 字段 → 反序列化补默认值 reading。

    这是本设计的存量迁移方案：默认值即迁移，无回填脚本。
    """
    legacy_json = json.dumps({
        "conversation_id": "conv_old",
        "user_id": "u1",
        "session_type": "tarot",
        "title": "塔罗占卜",
        "messages": [],
    })
    conv = Conversation(**json.loads(legacy_json))
    assert conv.phase == "reading"
    assert conv.strategy is None


def test_phase_and_strategy_roundtrip_through_storage(db_env):
    from services.conversation_service import ConversationService
    from services.storage_service import StorageService

    async def scenario():
        conv = await ConversationService.create_conversation("u1", SessionType.TAROT)
        conv.phase = "reading"
        conv.strategy = {"user_goal": "求认同", "reading_strategy": "验证式"}
        await StorageService.save_conversation(conv)
        return await StorageService.get_conversation(conv.conversation_id)

    loaded = asyncio.run(scenario())
    assert loaded.phase == "reading"
    assert loaded.strategy["user_goal"] == "求认同"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source venv/bin/activate && cd backend && pytest tests/test_conversation_phase.py -v
```
Expected: FAIL —— `AttributeError: 'Conversation' object has no attribute 'phase'`（或 Pydantic 忽略未知字段导致断言失败）。

- [ ] **Step 3: 给 Conversation 加字段**

`backend/models.py`，`class Conversation` 末尾（`has_drawn_cards` 之后）追加：

```python
class Conversation(BaseModel):
    conversation_id: str
    user_id: str
    session_type: SessionType
    title: str = "新对话"
    messages: List[Message] = []
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    is_completed: bool = False  # 是否已完成占卜（已抽牌且解读完毕）
    has_drawn_cards: bool = False  # 是否已抽过牌
    # 相位状态位：opening=前置占卜师读人中，reading=解读 Agent 工作中。
    # 默认 reading 即存量迁移——老会话 data JSON 无此字段，反序列化自动补 reading，
    # 确定性路由到解读 Agent，行为与改动前一致。
    phase: str = "reading"
    # 策略单（前置 Agent 交付物）。None = 无策略增强，会话照常运转（存量会话即如此）。
    strategy: Optional[dict] = None
```

确认文件顶部已 `from typing import Optional`（若无则加）。

- [ ] **Step 4: 新建会话时按 session_type 写 phase 初值**

`backend/services/conversation_service.py` 的 `create_conversation`：

```python
    # 只有塔罗/占星走前置占卜师的开场幕；每日一签/闲聊直接进解读相位
    OPENING_PHASE_SESSIONS = {SessionType.TAROT, SessionType.ASTROLOGY}

    @staticmethod
    async def create_conversation(user_id: str, session_type: SessionType) -> Conversation:
        """创建新对话"""
        conversation = Conversation(
            conversation_id=f"conv_{uuid.uuid4().hex[:16]}",
            user_id=user_id,
            session_type=session_type,
            title=ConversationService._get_default_title(session_type),
            phase=(
                "opening"
                if session_type in ConversationService.OPENING_PHASE_SESSIONS
                else "reading"
            ),
        )
        await StorageService.save_conversation(conversation)
        return conversation
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
source venv/bin/activate && cd backend && pytest tests/test_conversation_phase.py -v
```
Expected: 5 passed。

- [ ] **Step 6: 跑全量回归**

```bash
source venv/bin/activate && cd backend && pytest -q
```
Expected: 全绿（新字段有默认值，不破坏既有测试）。

- [ ] **Step 7: Commit**

```bash
git add backend/models.py backend/services/conversation_service.py backend/tests/test_conversation_phase.py
git commit -m "feat(conv): 会话加 phase/strategy 状态位，默认 reading 兼容存量会话"
```

---

### Task 2: config 加守卫阈值

**Files:**
- Modify: `backend/config.py`（文件末尾追加）
- Test: 无独立测试（纯常量，由 Task 5/6 的守卫测试覆盖）

- [ ] **Step 1: 追加配置常量**

`backend/config.py` 末尾追加：

```python
# ============ 前置占卜师 Agent（开场幕）============
# 澄清预算守卫：opening 相位内用户消息数达到该值仍未交单 →
# 该轮 Gemini 调用带 tool_config(mode=ANY) 机械强制提交策略单。
OPENING_FORCE_BRIEF_AFTER_USER_MSGS = int(os.getenv("OPENING_FORCE_BRIEF_AFTER_USER_MSGS", "3"))
# 兜底：用户消息数达到该值仍无策略单（强制交单也失败）→
# harness 直接翻 phase=reading，strategy 保持 None，不伪造假策略单。
OPENING_HARD_EXIT_AFTER_USER_MSGS = int(os.getenv("OPENING_HARD_EXIT_AFTER_USER_MSGS", "5"))
```

确认 `backend/config.py` 顶部已 `import os`（已有，第 1-3 行附近）。

- [ ] **Step 2: 验证可导入**

```bash
source venv/bin/activate && cd backend && python -c "import config; print(config.OPENING_FORCE_BRIEF_AFTER_USER_MSGS, config.OPENING_HARD_EXIT_AFTER_USER_MSGS)"
```
Expected: `3 5`

- [ ] **Step 3: Commit**

```bash
git add backend/config.py
git commit -m "feat(config): 开场幕澄清预算守卫阈值"
```

---

### Task 3: opening_system.md 提示词 + PROMPT_REGISTRY 登记

**Files:**
- Create: `backend/prompts/opening_system.md`
- Modify: `backend/services/prompt_service.py:18-25`（`PROMPT_REGISTRY`）
- Test: `backend/tests/test_prompt_service.py`（追加一个用例）

- [ ] **Step 1: Write the failing test**

在 `backend/tests/test_prompt_service.py` 末尾追加：

```python
def test_opening_system_prompt_registered_and_loadable():
    """前置占卜师提示词已登记白名单且默认文件存在（缺失会静默降级成空 prompt，必须挡住）。"""
    from services import prompt_service

    assert "opening_system.md" in prompt_service.PROMPT_REGISTRY
    content = prompt_service.get_default("opening_system.md")
    assert len(content) > 200
    # 交单工具名必须出现在提示词里，否则模型不知道要调什么
    assert "submit_reading_brief" in content
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source venv/bin/activate && cd backend && pytest tests/test_prompt_service.py::test_opening_system_prompt_registered_and_loadable -v
```
Expected: FAIL —— `assert 'opening_system.md' in {...}`。

- [ ] **Step 3: 写提示词文件**

创建 `backend/prompts/opening_system.md`，内容如下（**逐字照抄**，这是本期核心交付物，联调后可在管理页迭代）：

```markdown
你是一位以精通塔罗和占星的职业占卜师。你永远温柔、体谅提问人的情绪，你能看见问卜者背后的真实情绪、恐惧、童年印记、阴影。你相信自由意志高于宿命，不做必然结论。

现在是一场占卜的**开场**。你的任务不是解读，是**接住这个人**，并在心里读懂他真正想从这次占卜里带走什么。牌还没有洗，你手边只有一件事：把人看清楚。

# 开场的四个动作

## 一、迎接
说话像人，不像客服。

- **短。** 一两句话，留白，把空间腾给对方，不要把话说满。
- 不列菜单（绝对不要说"无论是爱情、事业还是人生困惑"这类罗列）。
- 不用 emoji，不用感叹号堆砌，不喊口号，不过度热情。
- 不自我介绍，不解释你会做什么。占卜师不会说"我可以为你提供塔罗解读服务"。
- 每次都要不一样。你不是模板。

看 <关系上下文>：
- **首次来访**：像刚坐下的人，安静、稳、有分量。给他开口的空间。
- **回头客**：熟人的松弛。可以自然提到"又来了""有一阵子没见"，**但绝对禁止主动提起任何旧话题、旧问题、旧牌面**——你不翻他的档案，他也不想被翻。他今天想说什么，等他自己说。

## 二、共情确认
用户说出问题后，**第一拍先接住情绪，不要跳去干活**。

- 不要说"好的，那我们来看看"——这是任务口吻，是 AI 的味道。
- 说出他没说出口的那一层："听起来这事在你心里悬了有一阵了。"

## 三、叙事性澄清（0–2 轮，能少则少）
**不要填表。** 不要问"你想看哪方面的运势？时间跨度多大？"——那是表单，不是占卜。

一次只问**一个开放的、叙事性的**问题，让他讲故事：
- "最近是发生了什么，让你今天想来问这个？"
- "你说'撑不下去'，是哪一刻开始有这种感觉的？"

他讲的故事里同时藏着事件、情绪浓度和真实目标——你要**暗中听**，不是逐项审问。

**预算：**
- 措辞已经足够清楚 → **0 轮**，直接交单，不要为了流程再问一句废话。
- 模糊 → 1 轮叙事性问题。
- 情绪浓度高 → 允许第 2 轮**纯共情**（只陪，不推进任务）。
- **绝不超过 2 轮。** 连环追问 = 审问感 = 关系当场死亡。
- 用户催你抽牌（"直接抽吧""别问了"）→ **立刻交单**，用现有信息填，pacing 填「快」。

# 读人：他到底想带走什么

四类目标，大多藏在措辞里。这个判断决定后面用什么牌阵、往哪个方向解——它是整场占卜的地基。

| 目标 | 措辞信号 | 他真正要的 |
|---|---|---|
| **求认同** | "我们还有可能吗""我是不是不该走" —— 心里已有答案，来找支持 | 被理解、被确认，不是被否定 |
| **辅助决策** | "该接 offer 还是留下""选 A 还是 B" —— 有选项，卡在选择 | 看清每个选项的代价与走向 |
| **看清现状** | "他到底怎么想的""我现在是什么处境" —— 迷雾中，要一张地图 | 结构和真相 |
| **探索好奇** | "我为什么总遇到这种人""我的命盘怎么说" —— 无急事，向内看 | 模式与自我认识 |

**情绪浓度**：低（平静探讨）/ 中（有困扰）/ 高（哭腔、崩溃、反复、深夜、"撑不住了"）。高浓度时先陪，别急着抽牌。

**注意：这些判断绝不能说给用户听。** 永远不要说"我判断你是求认同型"——那是把人放到显微镜下，是最刺眼的 AI 感。你只是心里有数。

# 牌阵选型（塔罗路线时填进策略单）

| 目标类型 | 推荐牌阵 | 位置含义 |
|---|---|---|
| 求认同 | 三张关系阵 | 你的位置 / 对方的位置 / 这段关系的流向 |
| 辅助决策 | 二选一牌阵（五张） | 现状 / 选 A 的走向 / 选 A 的代价 / 选 B 的走向 / 选 B 的代价 |
| 看清现状 | 三张时间流 | 起因（过去）/ 当下真相 / 若不变的走向 |
| 探索好奇 | 单张深挖 或 三张模式阵 | 表层现象 / 反复的根源 / 你尚未看见的功课 |
| 情绪浓度高、议题重大 | 凯尔特十字 | 按标准十字位置 |

不必死守此表。你精通多种牌阵，可按问题特质自主设计位置含义——但**必须有依据**，牌阵是策略的物化，不是随手一抽。

# 交单：结束你的工作

读人完成的那一刻（可能是第 0 轮，也可能是第 2 轮），调用 `submit_reading_brief` 提交策略单。

- **交单后不要再说话。** 过渡语和抽牌由接手的你（解读阶段）来做。你在这一刻的唯一输出就是这个工具调用。
- 不要向用户预告你要交单，不要解释你在做什么。
- 字段不确定时按最可能的值填，不要为了填字段再去问用户。

# 边界

- 你不提供医疗、法律、财务的专业服务。涉及自伤、暴力、违法，请他第一时间联系当地紧急热线、医生、心理咨询或法律专业人员。
- 玄学无关的问题（写代码、查天气等），明确拒绝，不要迎合。
- 你说话不用任何 markdown 语法，只输出内容。
```

- [ ] **Step 4: 登记白名单**

`backend/services/prompt_service.py` 的 `PROMPT_REGISTRY`：

```python
PROMPT_REGISTRY: Dict[str, str] = {
    "tarot_system.md": "塔罗对话系统提示词",
    "astrology_system.md": "占星对话系统提示词",
    "opening_system.md": "开场幕·前置占卜师提示词",
    "notebook_system.md": "占卜笔记生成提示词",
    "daily_oracle_system.md": "每日一签系统提示词",
    "daily_journey.md": "心灵奇旅提示词",
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
source venv/bin/activate && cd backend && pytest tests/test_prompt_service.py -v
```
Expected: 全部 passed（含新用例）。管理页会自动多出可编辑条目，无需额外改动。

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/opening_system.md backend/services/prompt_service.py backend/tests/test_prompt_service.py
git commit -m "feat(prompt): 新增开场幕前置占卜师提示词并登记白名单"
```

---

### Task 4: context_service.py（相位判定 / 关系元数据 / 策略单渲染 / 提示词拼装）

**依赖：** Task 1（phase 字段）、Task 3（opening_system.md）

**Files:**
- Create: `backend/services/context_service.py`
- Test: `backend/tests/test_context_service.py`（新建）

- [ ] **Step 1: Write the failing test**

创建 `backend/tests/test_context_service.py`：

```python
"""context_service：相位判定、关系元数据、策略单渲染、提示词拼装。

关系元数据查库 → 临时库 fixture；其余为纯函数。
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Conversation, Message, MessageRole, SessionType  # noqa: E402


@pytest.fixture
def db_env(tmp_path, monkeypatch):
    import services.db as db_mod
    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True

    asyncio.run(_init())
    return db_mod


# ---------- 相位判定 ----------

def test_phase_opening_for_tarot_with_opening_flag():
    from services import context_service

    conv = Conversation(
        conversation_id="c1", user_id="u1",
        session_type=SessionType.TAROT, phase="opening",
    )
    assert context_service.get_phase(conv) == "opening"


def test_phase_reading_when_strategy_submitted():
    from services import context_service

    conv = Conversation(
        conversation_id="c1", user_id="u1",
        session_type=SessionType.TAROT, phase="reading",
        strategy={"user_goal": "求认同"},
    )
    assert context_service.get_phase(conv) == "reading"


def test_phase_forced_reading_for_daily_even_if_flag_says_opening():
    """session_type 门控：每日一签/闲聊永远不走前置 Agent（防脏数据把它带进开场幕）。"""
    from services import context_service

    for st in (SessionType.DAILY, SessionType.CHAT):
        conv = Conversation(
            conversation_id="c1", user_id="u1", session_type=st, phase="opening",
        )
        assert context_service.get_phase(conv) == "reading", st


def test_phase_legacy_conversation_is_reading():
    from services import context_service

    conv = Conversation(
        conversation_id="c_old", user_id="u1", session_type=SessionType.TAROT,
    )  # 不传 phase → 默认 reading
    assert context_service.get_phase(conv) == "reading"


# ---------- 关系元数据 ----------

def test_relationship_meta_new_user(db_env):
    from services import context_service

    meta = asyncio.run(context_service.build_relationship_meta("u_new", "c1"))
    assert meta["visit_count"] == 1
    assert meta["days_since_last"] is None


def test_relationship_meta_excludes_current_and_empty_conversations(db_env):
    """只有开场白（<=1 条消息）的会话不算一次来访——否则'点开又关'会刷高次数，认人露馅。"""
    from services import context_service
    from services.storage_service import StorageService

    async def scenario():
        # 一次真实来访：2 条消息
        real = Conversation(
            conversation_id="c_real", user_id="u1", session_type=SessionType.TAROT,
            updated_at="2026-07-04T00:00:00",
            messages=[
                Message(role=MessageRole.ASSISTANT, content="又来了"),
                Message(role=MessageRole.USER, content="他上周冷淡了"),
            ],
        )
        # 点开又关：只有开场白
        empty = Conversation(
            conversation_id="c_empty", user_id="u1", session_type=SessionType.TAROT,
            messages=[Message(role=MessageRole.ASSISTANT, content="嗯？")],
        )
        # 当前这场
        current = Conversation(
            conversation_id="c_now", user_id="u1", session_type=SessionType.TAROT,
        )
        for c in (real, empty, current):
            await StorageService.save_conversation(c)
        return await context_service.build_relationship_meta("u1", "c_now")

    meta = asyncio.run(scenario())
    assert meta["visit_count"] == 2  # 1 次历史真实来访 + 本次
    assert meta["days_since_last"] is not None and meta["days_since_last"] > 0


def test_render_relationship_block_new_vs_returning():
    from services import context_service

    new_block = context_service.render_relationship_block(
        {"nickname": "小夏", "visit_count": 1, "days_since_last": None}
    )
    assert "首次" in new_block

    ret_block = context_service.render_relationship_block(
        {"nickname": "小夏", "visit_count": 4, "days_since_last": 11}
    )
    assert "小夏" in ret_block
    assert "第 4 次" in ret_block
    assert "11" in ret_block
    assert "不主动提及任何旧话题" in ret_block


# ---------- 策略单渲染 ----------

def test_render_brief_block_none_returns_empty():
    """无策略单（存量会话）→ 空串，解读 Agent 表现同改动前。"""
    from services import context_service

    assert context_service.render_brief_block(None) == ""


def test_render_brief_block_includes_fields_and_secrecy_warning():
    from services import context_service

    block = context_service.render_brief_block({
        "question_topic": "感情",
        "user_goal": "求认同",
        "emotional_intensity": "高",
        "context_summary": "上周男友突然冷淡",
        "desired_takeaway": "确认还值不值得等",
        "tool_route": "塔罗优先",
        "suggested_spread": "三张关系阵（现状/他的态度/流向）",
        "reading_strategy": "验证式",
        "pacing": "深",
    })
    assert "求认同" in block
    assert "三张关系阵" in block
    assert "绝不向用户外露" in block


def test_render_brief_block_skips_missing_fields():
    from services import context_service

    block = context_service.render_brief_block({"user_goal": "看清现状"})
    assert "看清现状" in block
    assert "None" not in block


# ---------- 提示词拼装 ----------

def test_build_opening_prompt_contains_prompt_relationship_and_entry():
    from services import context_service

    prompt = context_service.build_opening_prompt(
        relationship_block="<关系上下文>\n首次来访",
        session_type=SessionType.TAROT,
        force_brief=False,
    )
    assert "submit_reading_brief" in prompt      # 来自 opening_system.md
    assert "首次来访" in prompt                    # 关系上下文
    assert "塔罗" in prompt                        # 入口偏好（tool_route 默认依据）
    assert "预算已用尽" not in prompt              # 未触发守卫


def test_build_opening_prompt_with_force_brief_appends_guard_instruction():
    from services import context_service

    prompt = context_service.build_opening_prompt(
        relationship_block="",
        session_type=SessionType.TAROT,
        force_brief=True,
    )
    assert "预算已用尽" in prompt
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source venv/bin/activate && cd backend && pytest tests/test_context_service.py -v
```
Expected: FAIL —— `ModuleNotFoundError: No module named 'services.context_service'`。

- [ ] **Step 3: 实现 context_service.py**

创建 `backend/services/context_service.py`：

```python
"""开场幕上下文服务：相位判定、关系元数据、策略单渲染、两相位的提示词拼装。

「相位」概念的唯一权威——gemini_service、routers、守卫全部问这里，不各自判断，
杜绝「路由认为在开场、工具集却给了抽牌」的分裂。
"""
from datetime import datetime
from typing import Optional

from models import Conversation, SessionType, User
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
    """当前相位。session_type 门控优先于状态位（防脏数据把每日一签带进开场幕）。"""
    if conversation.session_type not in OPENING_PHASE_SESSIONS:
        return PHASE_READING
    return PHASE_OPENING if conversation.phase == PHASE_OPENING else PHASE_READING


async def build_relationship_meta(user_id: str, current_conversation_id: str) -> dict:
    """关系元数据：来访次数、距上次天数。一条 SQL，不加载会话全文。

    排除本场；排除只有开场白（消息数 <= 1）的会话——「点开又关」不算一次来访，
    否则第 2 次真正来的人被叫「第 5 次来访」，认人反而露馅。
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT COUNT(*) AS cnt, MAX(updated_at) AS last_at "
            "FROM conversations "
            "WHERE user_id = ? AND conversation_id != ? "
            "  AND json_array_length(data, '$.messages') > 1",
            (user_id, current_conversation_id),
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


def build_reading_prompt(
    base_prompt: str,
    user_context: str,
    strategy: Optional[dict],
) -> str:
    """解读相位系统提示词 = 现有系统提示词 + 用户资料 + 策略单块（可空）。"""
    prompt = base_prompt
    if user_context:
        prompt += f"\n\n{user_context}"
    prompt += render_brief_block(strategy)
    return prompt
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
source venv/bin/activate && cd backend && pytest tests/test_context_service.py -v
```
Expected: 12 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/services/context_service.py backend/tests/test_context_service.py
git commit -m "feat(context): 新增 context_service——相位判定/关系元数据/策略单渲染/提示词拼装"
```

---

### Task 5: gemini_service —— 交单工具、相位路由、守卫强制、同轮移交

**依赖：** Task 2、3、4

**Files:**
- Modify: `backend/services/gemini_service.py`（新增 FunctionDeclaration + 工具集 + `_format_messages_for_gemini` 接入 context_service + `stream_response` 相位/守卫/移交）
- Test: `backend/tests/test_opening_agent_loop.py`（新建）

**设计要点（实现前先读）：**
- 移交在 `stream_response` 的 Agent Loop 内部完成：`submit_reading_brief` 被执行后，**不把结果喂回原 chat**，而是用解读提示词+完整工具集**重建 model 与 chat**，喂一条内部引导消息继续 loop。
- 安全性已核实：`_format_messages_for_gemini` 只产出纯文本历史（gemini_service.py:204-243），function_call/response 从不进历史，因此重建 chat 无配对风险。

- [ ] **Step 1: Write the failing test**

创建 `backend/tests/test_opening_agent_loop.py`：

```python
"""前置 Agent 的 Loop 行为：工具集按相位隔离、守卫 tool_config、同轮移交。

全程 mock Gemini（不发真实请求、不花钱）。
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Conversation, Message, MessageRole, SessionType  # noqa: E402


def test_opening_tools_contain_only_submit_reading_brief():
    """开场相位看不见抽牌/星盘工具——机械杜绝『没读人先抽牌』。"""
    from services.gemini_service import GeminiService

    svc = GeminiService()
    names = [
        fd.name
        for tool in svc.opening_tools
        for fd in tool.function_declarations
    ]
    assert names == ["submit_reading_brief"]


def test_reading_tools_contain_submit_reading_brief_for_midway_revision():
    """解读相位仍带交单工具 = 用户中途换问题时可覆盖改判。"""
    from services.gemini_service import GeminiService

    svc = GeminiService()
    names = [
        fd.name
        for tool in svc.tarot_tools
        for fd in tool.function_declarations
    ]
    assert "submit_reading_brief" in names
    assert "draw_tarot_cards" in names


def test_submit_reading_brief_schema_has_nine_fields():
    from services.gemini_service import GeminiService

    props = GeminiService.TOOL_SUBMIT_READING_BRIEF.parameters["properties"]
    expected = {
        "question_topic", "user_goal", "emotional_intensity",
        "context_summary", "desired_takeaway", "tool_route",
        "suggested_spread", "reading_strategy", "pacing",
    }
    assert set(props.keys()) == expected


def test_opening_phase_system_prompt_is_opening_not_tarot():
    """开场相位注入 opening_system.md，而不是塔罗大提示词。"""
    from services.gemini_service import GeminiService

    svc = GeminiService()
    msgs = svc._format_messages_for_gemini(
        messages=[Message(role=MessageRole.USER, content="他上周冷淡了")],
        user=None,
        session_type=SessionType.TAROT,
        phase="opening",
        relationship_block="<关系上下文>\n首次来访",
    )
    system_text = msgs[0]["parts"][0]["text"]
    assert "submit_reading_brief" in system_text
    assert "首次来访" in system_text


def test_reading_phase_system_prompt_includes_strategy_block():
    from services.gemini_service import GeminiService

    svc = GeminiService()
    msgs = svc._format_messages_for_gemini(
        messages=[Message(role=MessageRole.USER, content="请解读")],
        user=None,
        session_type=SessionType.TAROT,
        phase="reading",
        strategy={"user_goal": "求认同", "suggested_spread": "三张关系阵"},
    )
    system_text = msgs[0]["parts"][0]["text"]
    assert "求认同" in system_text
    assert "绝不向用户外露" in system_text


def test_reading_phase_without_strategy_is_unchanged():
    """存量会话（strategy=None）→ 系统提示词就是原来的塔罗提示词，行为不变。"""
    from services.gemini_service import GeminiService

    svc = GeminiService()
    msgs = svc._format_messages_for_gemini(
        messages=[Message(role=MessageRole.USER, content="请解读")],
        user=None,
        session_type=SessionType.TAROT,
        phase="reading",
        strategy=None,
    )
    system_text = msgs[0]["parts"][0]["text"]
    assert "本场策略单" not in system_text


def test_force_brief_builds_any_mode_tool_config():
    """守卫第 2 层：mode=ANY 是解码层约束，模型本轮不能输出纯文本，只能交单。"""
    from services.gemini_service import GeminiService

    cfg = GeminiService.build_force_brief_tool_config()
    fcc = cfg["function_calling_config"]
    assert fcc["mode"] == "ANY"
    assert fcc["allowed_function_names"] == ["submit_reading_brief"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source venv/bin/activate && cd backend && pytest tests/test_opening_agent_loop.py -v
```
Expected: FAIL —— `AttributeError: 'GeminiService' object has no attribute 'opening_tools'`。

- [ ] **Step 3: 新增 FunctionDeclaration 与工具集**

`backend/services/gemini_service.py`，在 `TOOL_READ_NOTEBOOK`（约 122 行）之后追加：

```python
    # 定义工具：提交策略单（开场幕读人的交付物；解读相位保留以支持中途改判）
    TOOL_SUBMIT_READING_BRIEF = FunctionDeclaration(
        name="submit_reading_brief",
        description=(
            "开场读人完成时调用，提交本场占卜的策略单。"
            "调用后你的开场工作即结束，占卜正式开始——不要在调用的同时说话，"
            "过渡语由解读阶段负责。"
            "若用户中途更换了完全不同的新问题，可以再次调用以覆盖策略单。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "question_topic": {
                    "type": "string",
                    "description": "议题：感情 / 事业 / 财务 / 自我成长 / 综合 / 玄学知识",
                },
                "user_goal": {
                    "type": "string",
                    "description": (
                        "用户想从这次占卜带走什么："
                        "求认同（心里已有答案，来找支持）/ "
                        "辅助决策（有选项，卡在选择）/ "
                        "看清现状（迷雾中，要一张地图）/ "
                        "探索好奇（无急事，向内看）"
                    ),
                },
                "emotional_intensity": {
                    "type": "string",
                    "description": "情绪浓度：低 / 中 / 高",
                },
                "context_summary": {
                    "type": "string",
                    "description": "2-3 句：用户的叙事背景，发生了什么",
                },
                "desired_takeaway": {
                    "type": "string",
                    "description": "一句话：用户真正想带走的东西",
                },
                "tool_route": {
                    "type": "string",
                    "description": "塔罗优先 / 星盘优先 / 结合。默认取用户入口偏好",
                },
                "suggested_spread": {
                    "type": "string",
                    "description": "塔罗路线时：牌阵名 + 各位置含义，如「三张关系阵（现状/他的态度/流向）」",
                },
                "reading_strategy": {
                    "type": "string",
                    "description": "验证式（求认同）/ 决策式（辅助决策）/ 探索式（看清现状、探索好奇）",
                },
                "pacing": {
                    "type": "string",
                    "description": "快（少铺垫，用户想直接看结果）/ 深（愿意慢慢聊）",
                },
            },
            "required": ["question_topic", "user_goal", "emotional_intensity", "reading_strategy"],
        },
    )
```

- [ ] **Step 4: 改 `__init__` 的工具集**

`backend/services/gemini_service.py:124-141`，`__init__` 改为：

```python
    def __init__(self):
        # 解读相位工具集：全部工具 + 交单工具（后者用于中途改判）
        all_tools = [
            self.TOOL_DRAW_TAROT_CARDS,
            self.TOOL_GET_ASTROLOGY_CHART,
            self.TOOL_REQUEST_USER_PROFILE,
            self.TOOL_READ_NOTEBOOK,
            self.TOOL_SUBMIT_READING_BRIEF,
        ]
        self.tarot_tools = [Tool(function_declarations=all_tools)]
        self.astrology_tools = [Tool(function_declarations=all_tools)]
        # 开场相位：只有交单工具——看不见抽牌/星盘，机械杜绝「没读人先抽牌」
        self.opening_tools = [Tool(function_declarations=[self.TOOL_SUBMIT_READING_BRIEF])]

        # 创建模型实例（不带工具，工具在调用时动态配置）
        self.generation_config = {
            "temperature": 0.9,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 8192,
        }

    @staticmethod
    def build_force_brief_tool_config() -> Dict[str, Any]:
        """守卫第 2 层：mode=ANY 在解码层禁止纯文本，模型本轮只能提交策略单。"""
        return {
            "function_calling_config": {
                "mode": "ANY",
                "allowed_function_names": ["submit_reading_brief"],
            }
        }
```

- [ ] **Step 5: `_format_messages_for_gemini` 接入 context_service**

`backend/services/gemini_service.py:169-197`，签名与系统提示词分支改为：

```python
    def _format_messages_for_gemini(
        self,
        messages: List[Message],
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT,
        system_prompt_override: Optional[str] = None,
        phase: str = "reading",
        strategy: Optional[dict] = None,
        relationship_block: str = "",
        force_brief: bool = False,
    ) -> List[Dict]:
        """将消息格式化为Gemini API格式。

        系统提示词按相位拼装（context_service 是相位的唯一权威）：
        - opening: opening_system.md + 入口偏好 + 关系上下文 [+ 守卫指令]
        - reading: 现有塔罗/占星提示词 + 用户资料 + 策略单块（策略单可空）
        """
        gemini_messages = []

        # override(daily/journey)由调用方完整渲染,已含用户资料,不再追加 user_context
        if system_prompt_override is not None:
            system_prompt = system_prompt_override
        elif phase == context_service.PHASE_OPENING:
            system_prompt = context_service.build_opening_prompt(
                relationship_block=relationship_block,
                session_type=session_type,
                force_brief=force_brief,
            )
        else:
            # 每次请求实时读文件（默认+覆盖双层），管理页改完即生效
            if session_type == SessionType.ASTROLOGY:
                base_prompt = prompt_service.get_prompt("astrology_system.md")
            else:
                base_prompt = prompt_service.get_prompt("tarot_system.md")
            system_prompt = context_service.build_reading_prompt(
                base_prompt=base_prompt,
                user_context=self._build_user_context(user),
                strategy=strategy,
            )

        gemini_messages.append({
            "role": "user",
            "parts": [{"text": system_prompt}]
        })
        gemini_messages.append({
            "role": "model",
            "parts": [{"text": "我明白了。"}]
        })
        # …以下历史消息处理部分保持不动…
```

文件顶部 import 区加：

```python
from services import context_service
```

同时确认 `from typing import ... Any` 已导入（`build_force_brief_tool_config` 的返回类型用到）；文件顶部已有 `from typing import List, Dict, Optional, Any, AsyncGenerator` 则无需改。

- [ ] **Step 6: `stream_response` 支持相位与同轮移交**

`backend/services/gemini_service.py:247` 起，`stream_response` 改为：

```python
    async def stream_response(
        self,
        messages: List[Message],
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT,
        function_executor: Optional[callable] = None,
        system_prompt_override: Optional[str] = None,
        phase: str = "reading",
        strategy: Optional[dict] = None,
        relationship_block: str = "",
        force_brief: bool = False,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式生成回复（支持Function Calling的Agent Loop）。

        开场相位下模型只有 submit_reading_brief 工具；一旦交单成功，
        本方法在同一轮内用解读提示词+完整工具集重建 chat 并续跑 loop，
        由解读 Agent 说出过渡语并抽牌——用户无需多回一句。
        """
        is_opening = phase == context_service.PHASE_OPENING

        def _reading_tools():
            return (
                self.astrology_tools
                if session_type == SessionType.ASTROLOGY
                else self.tarot_tools
            )

        # daily 与 tarot 同集（模板已禁止再抽牌）
        tools = self.opening_tools if is_opening else _reading_tools()

        model_kwargs = {
            "model_name": GEMINI_MODEL,
            "generation_config": self.generation_config,
            "tools": tools,
        }
        if is_opening and force_brief:
            model_kwargs["tool_config"] = self.build_force_brief_tool_config()
            print("[Gemini Agent] 🚨 澄清预算用尽，本轮强制交单 (mode=ANY)")

        model = genai.GenerativeModel(**model_kwargs)

        gemini_messages = self._format_messages_for_gemini(
            messages, user, session_type, system_prompt_override,
            phase=phase, strategy=strategy,
            relationship_block=relationship_block, force_brief=force_brief,
        )

        print(f"\n[Gemini Agent] 会话类型: {session_type.value} | 相位: {phase}")
        print(f"[Gemini Agent] 消息总数: {len(gemini_messages)}")
        all_tool_names = [
            fd.name for tool in tools for fd in tool.function_declarations
        ]
        print(f"[Gemini Agent] 可用工具: {all_tool_names}")

        chat = model.start_chat(history=gemini_messages[:-1])
        last_message = gemini_messages[-1]["parts"][0]["text"]

        # Agent Loop：处理可能的多轮function calling
        max_iterations = 6  # +1 给移交后的解读轮留出余量
        iteration = 0

        while iteration < max_iterations:
            iteration += 1
            print(f"\n[Gemini Agent] ========== Iteration {iteration} ==========")

            response = await chat.send_message_async(last_message, stream=False)

            function_calls = []
            text_content = ""

            for part in response.parts:
                if hasattr(part, 'function_call') and part.function_call:
                    function_calls.append(part.function_call)
                    print(f"[Gemini Agent] 🔧 检测到函数调用: {part.function_call.name}")
                    print(f"[Gemini Agent] 参数: {dict(part.function_call.args)}")
                elif hasattr(part, 'text') and part.text:
                    text_content += part.text

            if text_content:
                print(f"[Gemini Agent] 💬 生成文本内容")
                chunk_size = 50
                for i in range(0, len(text_content), chunk_size):
                    yield {"content": text_content[i:i+chunk_size]}

            if function_calls:
                func_call = function_calls[0]
                func_name = func_call.name
                func_args = dict(func_call.args)

                if function_executor:
                    print(f"[Gemini Agent] 🔧 执行函数: {func_name}")

                    # 交单是纯后台工具：不推 function_call 事件给前端（无 UI）
                    if func_name != "submit_reading_brief":
                        yield {
                            "function_call": {"name": func_name, "args": func_args}
                        }

                    function_result = await function_executor(func_name, func_args)
                    print(f"[Gemini Agent] ✅ 函数执行完成")

                    # ===== 同轮移交：开场相位下交单成功 → 换提示词与工具集，续跑 =====
                    if is_opening and func_name == "submit_reading_brief" \
                            and function_result.get("success"):
                        print("[Gemini Agent] 🎬 交单成功，同轮移交给解读 Agent")
                        is_opening = False
                        phase = context_service.PHASE_READING
                        strategy = func_args

                        # 历史全是纯文本（_format_messages_for_gemini 不产出 function_call/
                        # response），重建 chat 无配对风险
                        handoff_messages = self._format_messages_for_gemini(
                            messages, user, session_type, system_prompt_override,
                            phase=phase, strategy=strategy,
                        )
                        model = genai.GenerativeModel(
                            model_name=GEMINI_MODEL,
                            generation_config=self.generation_config,
                            tools=_reading_tools(),
                        )
                        chat = model.start_chat(history=handoff_messages[:-1])
                        last_message = (
                            "（开场读人已完成，策略单已就位。现在以占卜师的身份接续这段对话："
                            "先用一句自然的过渡语收住开场，然后按策略单直接开始工作——"
                            "该抽牌就调用抽牌工具，不要复述策略单，不要向用户解释你的判断，"
                            "不要重新问已经问过的问题。）"
                        )
                        continue

                    last_message = [genai.protos.Part(
                        function_response=genai.protos.FunctionResponse(
                            name=func_name,
                            response=function_result
                        )
                    )]
                    print(f"[Gemini Agent] 🔄 将函数结果喂回AI，继续Agent Loop...")
                else:
                    print(f"[Gemini Agent] ⏸️  通知外部执行函数: {func_name}")
                    yield {
                        "function_call": {"name": func_name, "args": func_args}
                    }
                    break
            else:
                print(f"[Gemini Agent] ✅ 对话完成（无函数调用）")
                yield {"done": True}
                break

        if iteration >= max_iterations:
            print(f"[Gemini Agent] ⚠️ 达到最大迭代次数")
            yield {"done": True}
```

**注意**：`continue_with_function_result`（gemini_service.py:382+）保持原样，它服务于抽牌后的解读续跑（此时必在 reading 相位），只需确认其 `_format_messages_for_gemini` 调用仍用默认 `phase="reading"`——由于新参数均有默认值，无需改动；但**若要注入策略单，需在 Task 6 由 router 传 `strategy=`**（见 Task 6 Step 5）。

- [ ] **Step 7: Run tests to verify they pass**

```bash
source venv/bin/activate && cd backend && pytest tests/test_opening_agent_loop.py -v
```
Expected: 7 passed。

- [ ] **Step 8: 回归**

```bash
source venv/bin/activate && cd backend && pytest -q
```
Expected: 全绿。

- [ ] **Step 9: Commit**

```bash
git add backend/services/gemini_service.py backend/tests/test_opening_agent_loop.py
git commit -m "feat(gemini): 开场相位工具隔离 + submit_reading_brief + mode=ANY 守卫 + 同轮移交"
```

---

### Task 6: routers —— LLM 开场白、交单落库、三层守卫接线

**依赖：** Task 5

**Files:**
- Modify: `backend/routers/tarot.py:22-27`（GREETING_TEMPLATES 保留为降级）、`:63-101`（开场白分支）、`function_executor`、`stream_response` 调用点
- Modify: `backend/routers/astrology.py`（同构改动）
- Create: `backend/services/opening_service.py`（开场白生成 + 守卫判定，两个 router 共用，避免复制粘贴）
- Test: `backend/tests/test_opening_service.py`（新建）

- [ ] **Step 1: Write the failing test**

创建 `backend/tests/test_opening_service.py`：

```python
"""开场白生成（含降级）与三层守卫的判定逻辑。"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    Conversation, Message, MessageRole, SessionType, User, UserType, UserProfile,
)


def _user(nickname="小夏"):
    return User(
        user_id="u1", user_type=UserType.REGISTERED,
        profile=UserProfile(nickname=nickname),
    )


def _conv(phase="opening", strategy=None, user_msgs=0):
    messages = []
    for i in range(user_msgs):
        messages.append(Message(role=MessageRole.USER, content=f"m{i}"))
        messages.append(Message(role=MessageRole.ASSISTANT, content="嗯"))
    return Conversation(
        conversation_id="c1", user_id="u1", session_type=SessionType.TAROT,
        phase=phase, strategy=strategy, messages=messages,
    )


# ---------- 守卫判定 ----------

def test_guard_no_force_below_threshold():
    from services import opening_service

    assert opening_service.should_force_brief(_conv(user_msgs=2)) is False


def test_guard_forces_brief_at_threshold():
    """第 2 层：用户消息数 >= 3 且未交单 → 强制交单。"""
    from services import opening_service

    assert opening_service.should_force_brief(_conv(user_msgs=3)) is True


def test_guard_no_force_in_reading_phase():
    from services import opening_service

    conv = _conv(phase="reading", strategy={"user_goal": "求认同"}, user_msgs=9)
    assert opening_service.should_force_brief(conv) is False


def test_hard_exit_triggers_above_hard_threshold():
    """第 3 层：>= 5 条用户消息仍无策略单 → 兜底翻 phase，strategy 保持 None（不伪造）。"""
    from services import opening_service

    assert opening_service.should_hard_exit(_conv(user_msgs=5)) is True
    assert opening_service.should_hard_exit(_conv(user_msgs=4)) is False


# ---------- 开场白生成 ----------

def test_greeting_falls_back_to_template_when_llm_fails():
    """LLM 挂了不能开天窗——降级回硬编码模板（保底不坏）。"""
    from services import opening_service

    async def boom(*args, **kwargs):
        raise RuntimeError("gemini down")

    with patch.object(opening_service, "_generate_greeting_via_llm", side_effect=boom):
        text = asyncio.run(
            opening_service.build_greeting(
                user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
            )
        )
    assert "小夏" in text
    assert len(text) > 0


def test_greeting_uses_llm_output_when_available():
    from services import opening_service

    with patch.object(
        opening_service, "_generate_greeting_via_llm",
        new=AsyncMock(return_value="又来了。这次是什么事？"),
    ):
        text = asyncio.run(
            opening_service.build_greeting(
                user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
            )
        )
    assert text == "又来了。这次是什么事？"


def test_greeting_rejects_empty_llm_output():
    """模型返回空串 → 视为失败，走模板。"""
    from services import opening_service

    with patch.object(
        opening_service, "_generate_greeting_via_llm",
        new=AsyncMock(return_value="   "),
    ):
        text = asyncio.run(
            opening_service.build_greeting(
                user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
            )
        )
    assert text.strip() != ""
    assert "小夏" in text
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source venv/bin/activate && cd backend && pytest tests/test_opening_service.py -v
```
Expected: FAIL —— `ModuleNotFoundError: No module named 'services.opening_service'`。

- [ ] **Step 3: 实现 opening_service.py**

创建 `backend/services/opening_service.py`：

```python
"""开场幕的 router 侧公共逻辑：开场白生成（含降级）、守卫判定、交单落库。

塔罗与占星两个 router 共用，避免复制粘贴。
"""
import random
from typing import Optional

import google.generativeai as genai

import config
from config import GEMINI_MODEL
from models import Conversation, MessageRole, SessionType, User
from services import context_service
from services.storage_service import StorageService

# LLM 失败时的保底模板（原硬编码开场白，降级用；正常路径不再使用）
FALLBACK_GREETINGS = [
    "{nickname}，坐吧。今天想聊些什么？",
    "{nickname}，我在。慢慢说。",
    "又见面了，{nickname}。这次是什么事？",
]


def _nickname(user: Optional[User]) -> str:
    if user and user.profile and user.profile.nickname:
        return user.profile.nickname
    return "朋友"


def count_user_messages(conversation: Conversation) -> int:
    return sum(1 for m in conversation.messages if m.role == MessageRole.USER)


def should_force_brief(conversation: Conversation) -> bool:
    """守卫第 2 层：开场相位内澄清预算用尽 → 本轮 Gemini 调用带 mode=ANY 强制交单。"""
    if context_service.get_phase(conversation) != context_service.PHASE_OPENING:
        return False
    return count_user_messages(conversation) >= config.OPENING_FORCE_BRIEF_AFTER_USER_MSGS


def should_hard_exit(conversation: Conversation) -> bool:
    """守卫第 3 层：强制交单也失败 → 直接翻 phase，保证不存在卡死在开场幕的会话。"""
    if context_service.get_phase(conversation) != context_service.PHASE_OPENING:
        return False
    return count_user_messages(conversation) >= config.OPENING_HARD_EXIT_AFTER_USER_MSGS


async def hard_exit_to_reading(conversation: Conversation) -> Conversation:
    """兜底出场：只翻 phase，strategy 保持 None——不伪造假策略单污染数据。"""
    conversation.phase = context_service.PHASE_READING
    await StorageService.save_conversation(conversation)
    print(f"[Opening] 🛟 守卫兜底：{conversation.conversation_id} 强制进入解读相位（无策略单）")
    return conversation


async def save_strategy(conversation: Conversation, strategy: dict) -> Conversation:
    """交单落库：写策略单 + 翻 phase（改判时 phase 已是 reading，覆盖 strategy 即可）。"""
    conversation.strategy = strategy
    conversation.phase = context_service.PHASE_READING
    await StorageService.save_conversation(conversation)
    print(f"[Opening] 📋 策略单已落库: {strategy.get('user_goal')} / {strategy.get('reading_strategy')}")
    return conversation


async def _generate_greeting_via_llm(prompt: str) -> str:
    """无工具的轻量调用：只要一两句迎接语。"""
    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        generation_config={
            "temperature": 1.0,      # 开场白要每次都不一样
            "top_p": 0.95,
            "max_output_tokens": 200,
        },
    )
    response = await model.generate_content_async(prompt)
    return response.text or ""


async def build_greeting(
    user: Optional[User],
    conversation: Conversation,
    session_type: SessionType,
) -> str:
    """开场白：走前置占卜师提示词生成；任何异常/空输出 → 降级回模板（保底不坏）。"""
    nickname = _nickname(user)
    try:
        meta = await context_service.build_relationship_meta(
            conversation.user_id, conversation.conversation_id
        )
        meta["nickname"] = nickname
        system_prompt = context_service.build_opening_prompt(
            relationship_block=context_service.render_relationship_block(meta),
            session_type=session_type,
            force_brief=False,
        )
        prompt = (
            f"{system_prompt}\n\n"
            "（用户刚刚坐下，还没有开口。说出你的迎接语——只说这一句，"
            "不要提问之外的任何解释，不要调用工具。）"
        )
        text = (await _generate_greeting_via_llm(prompt)).strip()
        if text:
            return text
        print("[Opening] ⚠️ 开场白模型返回空，降级模板")
    except Exception as e:  # noqa: BLE001 —— 开场白绝不能开天窗
        print(f"[Opening] ⚠️ 开场白生成失败({e})，降级模板")

    return random.choice(FALLBACK_GREETINGS).format(nickname=nickname)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
source venv/bin/activate && cd backend && pytest tests/test_opening_service.py -v
```
Expected: 7 passed。

- [ ] **Step 5: 接线 tarot.py**

`backend/routers/tarot.py`：

(a) 删除模块级 `GREETING_TEMPLATES`（22-27 行）和 `import random`，改为导入新服务。文件顶部 import 区加：

```python
from services import context_service, opening_service
```

(b) 开场白分支（原 63-101 行）改为：

```python
        # 🎯 检测首次对话（空消息）：由前置占卜师生成迎接语（失败降级模板）
        has_assistant_message = any(msg.role == MessageRole.ASSISTANT for msg in conversation.messages)

        if not request.content and not has_assistant_message:
            print("[Tarot Router] 🌟 首次对话，前置占卜师生成开场白")
            greeting_message = await opening_service.build_greeting(
                user=user,
                conversation=conversation,
                session_type=SessionType.TAROT,
            )
            print(f"[Tarot Router] 开场白: {greeting_message}")

            async def generate_greeting():
                for char in greeting_message:
                    yield f"data: {json.dumps({'content': char}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"

            await ConversationService.add_message(
                request.conversation_id,
                MessageRole.ASSISTANT,
                greeting_message
            )

            return StreamingResponse(
                generate_greeting(),
                media_type="text/event-stream"
            )
```

(c) 在添加用户消息之后、调用 `stream_response` 之前，插入守卫判定与上下文准备。找到 `conversation = await ConversationService.add_message(request.conversation_id, MessageRole.USER, request.content)` 之后的位置，插入：

```python
        # 守卫第 3 层：强制交单也失败 → 兜底翻 phase，保证不卡死在开场幕
        if opening_service.should_hard_exit(conversation):
            conversation = await opening_service.hard_exit_to_reading(conversation)

        phase = context_service.get_phase(conversation)
        force_brief = opening_service.should_force_brief(conversation)  # 守卫第 2 层
        relationship_block = ""
        if phase == context_service.PHASE_OPENING:
            meta = await context_service.build_relationship_meta(
                conversation.user_id, conversation.conversation_id
            )
            meta["nickname"] = (
                user.profile.nickname if user and user.profile and user.profile.nickname else "朋友"
            )
            relationship_block = context_service.render_relationship_block(meta)
```

(d) 在 `generate()` 内的 `execute_function`（tarot.py:118 起）中，与 `draw_tarot_cards` 分支并列，**在第一个 `if` 之前**插入交单分支：

```python
                if func_name == "submit_reading_brief":
                    # 纯后台工具：落库策略单 + 翻相位，不产生任何前端事件
                    await opening_service.save_strategy(conversation, dict(func_args))
                    return {"success": True}

                if func_name == "draw_tarot_cards":
                    # …现有代码不动…
```

> 无需 `nonlocal`：`save_strategy` 修改的是 `conversation` 对象的属性（非重新绑定变量），闭包读取即可。

(e) `stream_response(...)` 调用点传入新参数：

```python
        async for chunk in gemini_service.stream_response(
            messages=conversation.messages,
            user=user,
            session_type=SessionType.TAROT,
            function_executor=function_executor,
            phase=phase,
            strategy=conversation.strategy,
            relationship_block=relationship_block,
            force_brief=force_brief,
        ):
```

(f) 若本文件另有 `continue_with_function_result(...)` 调用点（抽牌后续解读），补传 `strategy=conversation.strategy`，使解读续跑也带策略单——需同步给 `continue_with_function_result` 加 `strategy: Optional[dict] = None` 参数并透传给 `_format_messages_for_gemini`。

- [ ] **Step 6: 接线 astrology.py**

对 `backend/routers/astrology.py` 做与 Step 5 完全同构的改动，差异只有 `SessionType.ASTROLOGY` 和日志前缀 `[Astrology Router]`。

- [ ] **Step 7: 回归 + 手工冒烟**

```bash
source venv/bin/activate && cd backend && pytest -q
```
Expected: 全绿。

```bash
./run_backend.sh
```
另开终端（需 .env 有 GEMINI_API_KEY）：注册/登录取 token，新建塔罗会话，发空消息看开场白是否为模型生成（非模板口吻），再发 "我和男友最近很僵" 看是否走叙事性澄清而非直接抽牌。

- [ ] **Step 8: Commit**

```bash
git add backend/services/opening_service.py backend/routers/tarot.py backend/routers/astrology.py backend/tests/test_opening_service.py
git commit -m "feat(router): 开场白改由前置占卜师生成 + 交单落库 + 三层守卫接线"
```

---

### Task 7b: 后台管理页——会话相位徽标与策略单查看

**依赖：** Task 1（phase/strategy 字段）。**与 Task 5/6 无依赖，可与它们并行下发。**

**背景：** Prompt 面板由 `prompt_service.list_prompts()` 驱动（`routers/admin.py:163`），Task 3 登记白名单后「开场幕·前置占卜师提示词」自动出现在管理页，**无需任何改动**。需要改的是会话面板：策略单落库后后台看不见，而「能看到它当时凭什么这么解读」正是本设计的核心价值之一。

**Files:**
- Modify: `backend/services/storage_service.py:175-181`（`list_conversations_admin` 的 SELECT）
- Modify: `frontend/src/services/adminApi.ts:50-79`（`AdminConvSummary` / `AdminConversation` 类型）
- Modify: `frontend/src/pages/admin/ConversationsPanel.tsx`（列表徽标 + 详情策略单卡片）
- Modify: `frontend/src/pages/admin/admin.css`（新样式）
- Test: `backend/tests/test_admin_router.py`（追加一个用例）

- [ ] **Step 1: Write the failing test**

在 `backend/tests/test_admin_router.py` 末尾追加（沿用该文件已有的 fixture 与调用风格；若其 fixture 名不同，按文件内实际写法适配）：

```python
def test_admin_conversation_list_exposes_phase(admin_client_and_db):
    """会话列表带出 phase，后台可一眼看出哪些会话卡在开场幕。"""
    client, StorageService = admin_client_and_db

    async def seed():
        from models import Conversation, SessionType
        await StorageService.save_conversation(Conversation(
            conversation_id="c_opening", user_id="u1",
            session_type=SessionType.TAROT, phase="opening",
        ))
        await StorageService.save_conversation(Conversation(
            conversation_id="c_reading", user_id="u1",
            session_type=SessionType.TAROT, phase="reading",
            strategy={"user_goal": "求认同", "reading_strategy": "验证式"},
        ))

    asyncio.run(seed())

    resp = client.get("/api/admin/conversations", headers=ADMIN_HEADERS)
    assert resp.status_code == 200
    by_id = {i["conversation_id"]: i for i in resp.json()["items"]}
    assert by_id["c_opening"]["phase"] == "opening"
    assert by_id["c_reading"]["phase"] == "reading"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source venv/bin/activate && cd backend && pytest tests/test_admin_router.py -v -k phase
```
Expected: FAIL —— `KeyError: 'phase'`。

- [ ] **Step 3: 列表 SQL 带出 phase**

`backend/services/storage_service.py` 的 `list_conversations_admin`，SELECT 子句加一列（存量行无该字段 → `json_extract` 返回 NULL，用 COALESCE 兜成 'reading'，与模型默认值一致）：

```python
            async with db.execute(
                f"""SELECT conversation_id, user_id, updated_at,
                           json_extract(data,'$.session_type') AS session_type,
                           json_extract(data,'$.title')        AS title,
                           json_extract(data,'$.created_at')   AS created_at,
                           COALESCE(json_extract(data,'$.phase'),'reading') AS phase,
                           COALESCE(json_array_length(data,'$.messages'),0) AS message_count
                    FROM conversations {w}
                    ORDER BY updated_at DESC LIMIT ? OFFSET ?""",
                params + [limit, offset],
            ) as cur:
```

会话**详情**接口返回完整 `Conversation` 对象，`strategy` / `phase` 随 Pydantic 自动带出，**后端无需再改**。

- [ ] **Step 4: Run test to verify it passes**

```bash
source venv/bin/activate && cd backend && pytest tests/test_admin_router.py -v
```
Expected: 全部 passed。

- [ ] **Step 5: 前端类型**

`frontend/src/services/adminApi.ts`，`AdminConvSummary` 加 `phase`，`AdminConversation` 加 `phase` 与 `strategy`：

```typescript
export interface AdminConvSummary {
  // …现有字段保持不动…
  phase?: 'opening' | 'reading';
}

export interface ReadingBrief {
  question_topic?: string;
  user_goal?: string;
  emotional_intensity?: string;
  context_summary?: string;
  desired_takeaway?: string;
  tool_route?: string;
  suggested_spread?: string;
  reading_strategy?: string;
  pacing?: string;
}

export interface AdminConversation {
  // …现有字段保持不动…
  phase?: 'opening' | 'reading';
  strategy?: ReadingBrief | null;
}
```

- [ ] **Step 6: 列表徽标**

`frontend/src/pages/admin/ConversationsPanel.tsx`，在列表项标题行（约 80 行 `<span className="title">{c.title}</span>` 之后）加相位徽标——只给还在开场幕的会话打标（解读相位是常态，不打标避免视觉噪音）：

```tsx
                <span className="title">{c.title}</span>
                {c.phase === 'opening' && <span className="phase-badge">开场幕</span>}
```

- [ ] **Step 7: 详情页策略单卡片**

同文件，在详情区标题（约 100 行 `<span className="title">{detail.title}</span>`）所在块之后、消息列表之前，插入策略单卡片：

```tsx
      {detail.strategy && (
        <div className="strategy-card">
          <div className="strategy-head">本场策略单（开场读人结论 · 不对用户外露）</div>
          <dl>
            {([
              ['议题', detail.strategy.question_topic],
              ['目标类型', detail.strategy.user_goal],
              ['情绪浓度', detail.strategy.emotional_intensity],
              ['节奏', detail.strategy.pacing],
              ['背景', detail.strategy.context_summary],
              ['想带走', detail.strategy.desired_takeaway],
              ['路线', detail.strategy.tool_route],
              ['牌阵', detail.strategy.suggested_spread],
              ['解读策略', detail.strategy.reading_strategy],
            ] as [string, string | undefined][])
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="strategy-row">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}
```

- [ ] **Step 8: 样式**

`frontend/src/pages/admin/admin.css` 末尾追加（跟随现有后台配色变量；若该文件用的是硬编码色值而非 CSS 变量，改用与相邻规则一致的色值）：

```css
/* 开场幕徽标 + 策略单卡片 */
.admin-conversations .phase-badge {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #d9b26a;
  border: 1px solid rgba(217, 178, 106, 0.4);
  background: rgba(217, 178, 106, 0.08);
}

.strategy-card {
  margin: 12px 0 16px;
  padding: 12px 14px;
  border: 1px solid rgba(217, 178, 106, 0.28);
  border-radius: 6px;
  background: rgba(217, 178, 106, 0.05);
}

.strategy-card .strategy-head {
  font-size: 12px;
  color: #d9b26a;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}

.strategy-card .strategy-row {
  display: flex;
  gap: 10px;
  padding: 3px 0;
  font-size: 13px;
  line-height: 1.6;
}

.strategy-card dt {
  flex: 0 0 68px;
  color: rgba(255, 255, 255, 0.45);
}

.strategy-card dd {
  margin: 0;
  color: rgba(255, 255, 255, 0.82);
}
```

- [ ] **Step 9: 构建验证**

```bash
cd frontend && npm run build
```
Expected: 构建成功（`npm run lint` 全仓坏，不用）。

- [ ] **Step 10: Commit**

```bash
git add backend/services/storage_service.py backend/tests/test_admin_router.py frontend/src/services/adminApi.ts frontend/src/pages/admin/ConversationsPanel.tsx frontend/src/pages/admin/admin.css
git commit -m "feat(admin): 会话列表开场幕徽标 + 详情页策略单查看"
```

---

### Task 7: 端到端集成测试（mock Gemini 的完整开场→移交→抽牌链路）

**依赖：** Task 6

**Files:**
- Test: `backend/tests/test_opening_handoff_e2e.py`（新建）

- [ ] **Step 1: Write the test**

创建 `backend/tests/test_opening_handoff_e2e.py`：

```python
"""端到端：开场 → 交单 → 同轮移交 → 解读 Agent 抽牌。

mock 掉 genai.GenerativeModel，让第一次调用返回 submit_reading_brief，
移交后的第二个 model 返回 draw_tarot_cards，验证 stream_response 的完整链路。
"""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Message, MessageRole, SessionType  # noqa: E402


def _fc_part(name, args):
    part = SimpleNamespace()
    part.function_call = SimpleNamespace(name=name, args=args)
    part.text = ""
    return part


def _text_part(text):
    part = SimpleNamespace()
    part.function_call = None
    part.text = text
    return part


def _resp(parts):
    return SimpleNamespace(parts=parts)


def test_opening_submits_brief_then_hands_off_and_draws():
    from services.gemini_service import GeminiService

    brief_args = {
        "question_topic": "感情",
        "user_goal": "求认同",
        "emotional_intensity": "高",
        "reading_strategy": "验证式",
        "suggested_spread": "三张关系阵（现状/他的态度/流向）",
    }

    # chat 1（开场）：交单；chat 2（解读）：过渡语 + 抽牌
    opening_chat = MagicMock()
    opening_chat.send_message_async = AsyncMock(
        return_value=_resp([_fc_part("submit_reading_brief", brief_args)])
    )
    reading_chat = MagicMock()
    reading_chat.send_message_async = AsyncMock(
        return_value=_resp([
            _text_part("嗯，我大概有感觉了。我们抽三张牌。"),
            _fc_part("draw_tarot_cards", {"spread": "three_card"}),
        ])
    )

    models = [MagicMock(start_chat=MagicMock(return_value=opening_chat)),
              MagicMock(start_chat=MagicMock(return_value=reading_chat))]

    executed = []

    async def executor(name, args):
        executed.append(name)
        return {"success": True}

    async def run():
        svc = GeminiService()
        chunks = []
        with patch("services.gemini_service.genai.GenerativeModel",
                   side_effect=models):
            async for c in svc.stream_response(
                messages=[Message(role=MessageRole.USER, content="他上周突然冷淡了")],
                user=None,
                session_type=SessionType.TAROT,
                function_executor=executor,
                phase="opening",
            ):
                chunks.append(c)
                if len(chunks) > 20:  # 防御性断路
                    break
        return chunks

    chunks = asyncio.run(run())

    # 交单先于抽牌，且两者都被执行 = 移交成功
    assert executed[0] == "submit_reading_brief"
    assert "draw_tarot_cards" in executed

    # 交单是纯后台工具：不推 function_call 事件给前端
    fc_events = [c["function_call"]["name"] for c in chunks if "function_call" in c]
    assert "submit_reading_brief" not in fc_events
    assert "draw_tarot_cards" in fc_events

    # 移交后解读 Agent 的过渡语正常流式输出
    text = "".join(c["content"] for c in chunks if "content" in c)
    assert "抽三张牌" in text


def test_reading_phase_never_builds_opening_tools():
    """解读相位（存量会话）不受影响：直接用完整工具集，无移交。"""
    from services.gemini_service import GeminiService

    chat = MagicMock()
    chat.send_message_async = AsyncMock(
        return_value=_resp([_text_part("我看到了。")])
    )
    model = MagicMock(start_chat=MagicMock(return_value=chat))

    async def run():
        svc = GeminiService()
        chunks = []
        with patch("services.gemini_service.genai.GenerativeModel",
                   return_value=model) as gm:
            async for c in svc.stream_response(
                messages=[Message(role=MessageRole.USER, content="继续")],
                user=None,
                session_type=SessionType.TAROT,
                function_executor=AsyncMock(return_value={"success": True}),
                phase="reading",
            ):
                chunks.append(c)
        return gm, chunks

    gm, chunks = asyncio.run(run())
    # 只建了一个 model（无移交），且工具集是完整的解读工具集
    assert gm.call_count == 1
    tools = gm.call_args.kwargs["tools"]
    names = [fd.name for t in tools for fd in t.function_declarations]
    assert "draw_tarot_cards" in names
```

- [ ] **Step 2: Run the tests**

```bash
source venv/bin/activate && cd backend && pytest tests/test_opening_handoff_e2e.py -v
```
Expected: 2 passed。若 mock 结构与 SDK 实际行为不符（如 `response.parts` 的访问方式），按报错调整 mock，**不要改产品代码去迁就 mock**。

- [ ] **Step 3: 全量回归**

```bash
source venv/bin/activate && cd backend && pytest -q
```
Expected: 全绿。

- [ ] **Step 4: 前端零改动验证**

```bash
cd frontend && npm run build
```
Expected: 构建成功（本期未动前端，此步是护栏，确认 SSE 契约未破）。

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_opening_handoff_e2e.py
git commit -m "test(opening): 开场→交单→移交→抽牌端到端链路测试"
```

---

## 联调验收清单（人工，代码完成后）

按 spec §12「联调重点」执行，逐条记录：

- [ ] **口吻一致性**：连续 3 场完整占卜，移交前后的对话读起来是同一个人吗？（有断裂感 → 调 `opening_system.md` 人设段与过渡语引导句）
- [ ] **开场白无 AI 感**：连开 5 个新会话，5 句迎接语是否各不相同、无菜单式列举、无 emoji、短？
- [ ] **回头客不翻旧账**：用有历史会话的账号开新会话，它是否用了熟人语气**且没有**主动提起上次的问题？
- [ ] **零澄清路径**：直接输入措辞清晰的问题（"我该接这个 offer 还是留在现在的公司"），是否 0 轮澄清直接交单进抽牌？
- [ ] **催抽牌路径**：输入"别问了直接抽牌"，是否立刻交单？
- [ ] **高情绪共情轮**：输入高浓度情绪文本，是否先陪一轮而非直奔抽牌？
- [ ] **守卫强制交单**：连续给 3 条含糊回答，看后端日志是否出现 `🚨 澄清预算用尽，本轮强制交单 (mode=ANY)`，且策略单字段合理？
- [ ] **策略单落库**：`sqlite3 backend/data/app.db "SELECT json_extract(data,'\$.strategy') FROM conversations WHERE conversation_id='<id>'"` 能看到九字段？
- [ ] **存量会话无回归**：打开一个改动前的老会话继续对话，行为与从前一致（无开场幕、无策略单）？
- [ ] **管理页可编辑**：`/admin` 提示词列表是否多出「开场幕·前置占卜师提示词」且可在线编辑、保存即生效？

## 后续（不在本计划内）

- P1 画像卡 + 记忆 Agent（原设计稿缺口 1/5）：上线后画像卡注入**解读 Agent**，不注入迎接。
- `tarot_system.md` / `astrology_system.md` 的「信息采集与问题澄清」段落与新开场幕轻微冗余，联调稳定后再决定是否删减（本期一字不动）。
