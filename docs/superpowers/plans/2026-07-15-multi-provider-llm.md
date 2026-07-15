# 三 Agent 多 Provider（Gemini / DeepSeek / Kimi）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让前置 / 解读 / 记忆三个 Agent 各自在 `.env` 里独立选 provider（gemini / deepseek / kimi）与 model；不配则全部沿用今天的 Gemini 行为，零变化。

**Architecture:** 引入一层 **session 形态**的 provider 抽象（`services/llm/`）。GeminiSession 内部保持今天 `start_chat + send_message_async + FunctionResponse proto` 那套**字节级不变**的 SDK 用法——Gemini 路径零回归；OpenAICompatSession 用 `openai` SDK 维护 messages 数组，DeepSeek 与 Kimi **共用**它（仅 base_url/key/model 不同）。多轮工具循环的状态由 session 持有。`gemini_service.stream_response` 的 Agent Loop 改为 provider-agnostic：按 phase 取对应 Agent 的 provider（移交时从 opening provider 切到 reading provider）。记忆 Agent（notebook）与开场白各走一次 `provider.generate_json` / `generate_text`。

**Tech Stack:** FastAPI + google-generativeai（Gemini 原生）+ openai SDK（DeepSeek/Kimi，OpenAI 兼容）+ pytest。

**关键事实（已核实）：**
- `stream_response` 内部 `stream=False`（gemini_service.py:455）——对前端的流式是拿全文手动切块，provider 只需非流式"一轮"能力。
- 今天的 gemini 历史全是**纯文本**（`_format_messages_for_gemini` 把抽牌结果/星盘也转成了文本 + model 确认语）；function_call / function_response **从不进初始历史**，只在一次 `stream_response` 的 live chat 里被线程化。→ 抽象里 **NeutralMsg 只需 `{role, content}` 纯文本**，工具调用/结果由 session 方法线程化，完全对应今天。
- 现有 152 测试里 3 个文件 patch `genai.GenerativeModel` / `start_chat`：`test_opening_agent_loop.py` / `test_opening_service.py` / `test_opening_handoff_e2e.py`。重构后 patch 点迁到 **provider 边界**（更干净的测试）。

**测试 mock 铁律：** 全程 mock provider/session，**绝不发真实 DeepSeek/Kimi/Gemini 请求**，绝不碰 `backend/data/`。

**任务依赖图：**
```
Task 1 (config) ─┐
Task 2 (llm/base 中性类型+工具规格) ─┬─► Task 3 (GeminiProvider) ─┐
                                     └─► Task 4 (OpenAICompatProvider) ─┼─► Task 5 (factory)
                                                                        │
Task 5 ─► Task 6 (stream_response 接 provider + 迁移3个测试) ─► Task 7 (notebook) ─► Task 8 (greeting) ─► Task 9 (requirements/.env.example)
```
Task 1 与 Task 2 可并行起步；Task 3/4 依赖 2；其余串行。

---

## 中性契约（贯穿全程，Task 2 落地，后续任务引用）

```python
# services/llm/base.py
from dataclasses import dataclass, field
from typing import Protocol, Optional

@dataclass
class ToolCall:
    name: str
    args: dict
    id: str = ""            # OpenAI 需要；Gemini 用 name 兜

@dataclass
class TurnResult:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)

# NeutralMsg 就是普通 dict：{"role": "user"|"assistant", "content": str}
NeutralMsg = dict

class LLMSession(Protocol):
    async def send_user(self, text: str) -> "TurnResult": ...
    async def send_tool_result(self, name: str, result: dict, call_id: str = "") -> "TurnResult": ...

class LLMProvider(Protocol):
    def open_session(
        self,
        system_prompt: str,
        history: list[NeutralMsg],      # 纯文本轮，不含最后一条待发的 user
        tools: Optional[list[dict]],    # 中性工具规格 [{name, description, parameters}]
        force_tool: Optional[str] = None,
    ) -> LLMSession: ...
    async def generate_json(self, prompt: str) -> str: ...
    async def generate_text(self, prompt: str, *, temperature: float = 1.0,
                            max_tokens: int = 200, timeout: int = 8) -> str: ...
```

**中性工具规格**（Task 2 从现有 5 个 FunctionDeclaration 转成的 plain dict）：
`{"name": str, "description": str, "parameters": {json schema dict}}`。

---

### Task 1: config —— 三 Agent 的 provider/model + 两个新 provider 的 key

**Files:** Modify `backend/config.py`（GEMINI_MODEL 之后追加）；Test：无独立测试（Task 5 factory 覆盖）。

- [ ] **Step 1: 追加配置**

`backend/config.py` 在 `GEMINI_MODEL = ...`（约 59 行）之后追加：

```python

# ===== 多 Provider LLM（前置/解读/记忆 三个 Agent 各自独立选 provider+model）=====
# 不配任何一项 → 三个 Agent 全部沿用 Gemini 现状，行为零变化。
# DeepSeek / Kimi 均为 OpenAI 兼容 API，key 按 provider 配一次（同一家不重复填）。
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
KIMI_API_KEY = os.getenv("KIMI_API_KEY", "")
KIMI_BASE_URL = os.getenv("KIMI_BASE_URL", "https://api.moonshot.cn/v1")

# 每个 Agent：provider ∈ {gemini, deepseek, kimi}，model 为该 provider 下的模型名
OPENING_PROVIDER = os.getenv("OPENING_PROVIDER", "gemini")
OPENING_MODEL = os.getenv("OPENING_MODEL", GEMINI_MODEL)
READING_PROVIDER = os.getenv("READING_PROVIDER", "gemini")
READING_MODEL = os.getenv("READING_MODEL", GEMINI_MODEL)
MEMORY_PROVIDER = os.getenv("MEMORY_PROVIDER", "gemini")
MEMORY_MODEL = os.getenv("MEMORY_MODEL", "gemini-2.5-flash")   # notebook 现用值
```

- [ ] **Step 2: 验证导入**

```bash
source venv/bin/activate && cd backend && python -c "import config; print(config.OPENING_PROVIDER, config.READING_MODEL, config.MEMORY_MODEL, config.DEEPSEEK_BASE_URL)"
```
Expected: `gemini gemini-3.1-flash-lite gemini-2.5-flash https://api.deepseek.com`

- [ ] **Step 3: Commit**

```bash
git add backend/config.py
git commit -m "feat(config): 三 Agent 独立 provider/model + DeepSeek/Kimi key"
```

---

### Task 2: llm/base —— 中性类型 + 工具规格 registry

**Files:** Create `backend/services/llm/__init__.py`（暂空或仅注释）、`backend/services/llm/base.py`、`backend/services/llm/tools.py`；Test：`backend/tests/test_llm_tools.py`。

- [ ] **Step 1: Write failing test**

`backend/tests/test_llm_tools.py`：

```python
"""中性工具规格：与旧 FunctionDeclaration 同名同字段，可被两种 provider 转换。"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_tool_specs_cover_all_five_tools():
    from services.llm import tools
    names = {t["name"] for t in tools.ALL_TOOL_SPECS}
    assert names == {
        "draw_tarot_cards", "get_astrology_chart",
        "request_user_profile", "read_divination_notebook",
        "submit_reading_brief",
    }


def test_each_spec_has_name_desc_params():
    from services.llm import tools
    for t in tools.ALL_TOOL_SPECS:
        assert t["name"] and t["description"]
        assert t["parameters"]["type"] == "object"
        assert "properties" in t["parameters"]


def test_named_toolsets_are_subsets():
    from services.llm import tools
    all_names = {t["name"] for t in tools.ALL_TOOL_SPECS}
    assert set(tools.OPENING_TOOL_NAMES) == {"submit_reading_brief"}
    assert "draw_tarot_cards" in tools.READING_TOOL_NAMES
    assert "submit_reading_brief" in tools.READING_TOOL_NAMES
    assert "submit_reading_brief" not in tools.DAILY_TOOL_NAMES
    assert set(tools.DAILY_TOOL_NAMES) <= all_names


def test_specs_by_names_helper():
    from services.llm import tools
    subset = tools.specs_by_names(tools.OPENING_TOOL_NAMES)
    assert [t["name"] for t in subset] == ["submit_reading_brief"]
```

- [ ] **Step 2: Run → fail**

```bash
source venv/bin/activate && cd backend && pytest tests/test_llm_tools.py -v
```
Expected: ModuleNotFoundError。

- [ ] **Step 3: 实现 base.py**

`backend/services/llm/base.py`：粘贴上文「中性契约」代码块（ToolCall / TurnResult / NeutralMsg / LLMSession / LLMProvider）。

- [ ] **Step 4: 实现 tools.py**

`backend/services/llm/tools.py`：把 `gemini_service.py` 里 5 个 `FunctionDeclaration` 的 `name` / `description` / `parameters` **逐字**搬成 plain dict（不要改任何描述文案——它们是调好的）。结构：

```python
"""中性工具规格：唯一真源。GeminiProvider 转成 FunctionDeclaration，
OpenAICompatProvider 转成 OpenAI tool。描述文案与旧 FunctionDeclaration 逐字一致。"""

DRAW_TAROT_CARDS = {
    "name": "draw_tarot_cards",
    "description": "……逐字搬 gemini_service.TOOL_DRAW_TAROT_CARDS.description……",
    "parameters": { ……逐字搬…… },
}
GET_ASTROLOGY_CHART = { … }
REQUEST_USER_PROFILE = { … }
READ_DIVINATION_NOTEBOOK = { … }
SUBMIT_READING_BRIEF = {
    "name": "submit_reading_brief",
    "description": "……",
    "parameters": {
        "type": "object",
        "properties": { …9 字段逐字搬… },
        "required": ["question_topic", "user_goal", "emotional_intensity", "reading_strategy"],
    },
}

ALL_TOOL_SPECS = [DRAW_TAROT_CARDS, GET_ASTROLOGY_CHART, REQUEST_USER_PROFILE,
                  READ_DIVINATION_NOTEBOOK, SUBMIT_READING_BRIEF]

# 与 gemini_service._select_tools 现有语义一一对应
DAILY_TOOL_NAMES = ["draw_tarot_cards", "get_astrology_chart",
                    "request_user_profile", "read_divination_notebook"]
READING_TOOL_NAMES = DAILY_TOOL_NAMES + ["submit_reading_brief"]
OPENING_TOOL_NAMES = ["submit_reading_brief"]

_BY_NAME = {t["name"]: t for t in ALL_TOOL_SPECS}

def specs_by_names(names):
    return [_BY_NAME[n] for n in names]
```

> 搬运时打开 `gemini_service.py:17-181`，把四个工具（DRAW/CHART/PROFILE/NOTEBOOK）与 SUBMIT 的三段字段**原样复制**。可用 `python -c` 临时打印 `GeminiService.TOOL_X.parameters` 辅助核对，但最终以源码文本为准。

- [ ] **Step 5: Run → pass**

```bash
source venv/bin/activate && cd backend && pytest tests/test_llm_tools.py -v
```
Expected: 4 passed。

- [ ] **Step 6: Commit**

```bash
git add backend/services/llm/__init__.py backend/services/llm/base.py backend/services/llm/tools.py backend/tests/test_llm_tools.py
git commit -m "feat(llm): 中性 provider 契约 + 工具规格唯一真源"
```

---

### Task 3: GeminiProvider —— 包住今天的 SDK 用法，零回归

**Files:** Create `backend/services/llm/gemini_provider.py`；Test：`backend/tests/test_gemini_provider.py`（全 mock genai）。

**要点**：GeminiSession 内部**必须**复刻今天 `stream_response` 的 SDK 用法——`model.start_chat(history=...)` + `chat.send_message_async(text_or_parts, stream=False)`，工具结果用 `genai.protos.Part(function_response=...)`。这样 Gemini 行为字节级不变。

- [ ] **Step 1: Write failing test**

`backend/tests/test_gemini_provider.py`：

```python
"""GeminiProvider：中性输入 → 复刻今天的 start_chat/send_message SDK 用法。全程 mock genai。"""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _fc_part(name, args):
    return SimpleNamespace(function_call=SimpleNamespace(name=name, args=args), text="")

def _text_part(text):
    return SimpleNamespace(function_call=None, text=text)

def _resp(parts):
    return SimpleNamespace(parts=parts)


def test_send_user_returns_text():
    from services.llm.gemini_provider import GeminiProvider
    chat = MagicMock()
    chat.send_message_async = AsyncMock(return_value=_resp([_text_part("你好")]))
    model = MagicMock(start_chat=MagicMock(return_value=chat))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", return_value=model):
        sess = GeminiProvider("gemini-x").open_session("SYS", [], tools=None)
        r = asyncio.run(sess.send_user("在吗"))
    assert r.text == "你好"
    assert r.tool_calls == []


def test_send_user_returns_tool_call():
    from services.llm.gemini_provider import GeminiProvider
    from services.llm import tools
    chat = MagicMock()
    chat.send_message_async = AsyncMock(
        return_value=_resp([_fc_part("submit_reading_brief", {"user_goal": "求认同"})]))
    model = MagicMock(start_chat=MagicMock(return_value=chat))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", return_value=model):
        sess = GeminiProvider("gemini-x").open_session(
            "SYS", [], tools=tools.specs_by_names(["submit_reading_brief"]))
        r = asyncio.run(sess.send_user("他冷淡了"))
    assert r.tool_calls[0].name == "submit_reading_brief"
    assert r.tool_calls[0].args["user_goal"] == "求认同"


def test_force_tool_sets_mode_any():
    from services.llm.gemini_provider import GeminiProvider
    from services.llm import tools
    captured = {}
    def fake_model(**kwargs):
        captured.update(kwargs)
        chat = MagicMock()
        chat.send_message_async = AsyncMock(return_value=_resp([_text_part("x")]))
        return MagicMock(start_chat=MagicMock(return_value=chat))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", side_effect=fake_model):
        GeminiProvider("gemini-x").open_session(
            "SYS", [], tools=tools.specs_by_names(["submit_reading_brief"]),
            force_tool="submit_reading_brief")
    tc = captured["tool_config"]["function_calling_config"]
    assert tc["mode"] == "ANY"
    assert tc["allowed_function_names"] == ["submit_reading_brief"]


def test_history_maps_to_start_chat():
    """系统提示词 → user+『我明白了。』；历史文本轮按角色映射（复刻今天格式）。"""
    from services.llm.gemini_provider import GeminiProvider
    captured = {}
    def fake_model(**kwargs):
        chat = MagicMock()
        chat.send_message_async = AsyncMock(return_value=_resp([_text_part("ok")]))
        m = MagicMock()
        m.start_chat = MagicMock(side_effect=lambda history: captured.update(history=history) or chat)
        return m
    with patch("services.llm.gemini_provider.genai.GenerativeModel", side_effect=fake_model):
        sess = GeminiProvider("gemini-x").open_session(
            "SYS", [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "yo"}], tools=None)
        asyncio.run(sess.send_user("next"))
    hist = captured["history"]
    assert hist[0]["role"] == "user" and "SYS" in hist[0]["parts"][0]["text"]
    assert hist[1]["role"] == "model" and hist[1]["parts"][0]["text"] == "我明白了。"
    assert hist[2] == {"role": "user", "parts": [{"text": "hi"}]}
    assert hist[3] == {"role": "model", "parts": [{"text": "yo"}]}


def test_send_tool_result_feeds_function_response():
    from services.llm.gemini_provider import GeminiProvider
    chat = MagicMock()
    chat.send_message_async = AsyncMock(return_value=_resp([_text_part("解读中")]))
    model = MagicMock(start_chat=MagicMock(return_value=chat))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", return_value=model):
        sess = GeminiProvider("gemini-x").open_session("SYS", [], tools=None)
        asyncio.run(sess.send_user("抽牌"))
        r = asyncio.run(sess.send_tool_result("draw_tarot_cards", {"success": True}))
    assert r.text == "解读中"
    # 第二次 send 传的是 FunctionResponse Part（list），不是纯文本
    args, _ = chat.send_message_async.call_args_list[1]
    assert isinstance(args[0], list)


def test_generate_json_and_text():
    from services.llm.gemini_provider import GeminiProvider
    model = MagicMock()
    model.generate_content_async = AsyncMock(return_value=SimpleNamespace(text='{"summary":"s","cards_drawn":[]}'))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", return_value=model):
        out = asyncio.run(GeminiProvider("gemini-x").generate_json("p"))
    assert '"summary"' in out
```

- [ ] **Step 2: Run → fail**

```bash
source venv/bin/activate && cd backend && pytest tests/test_gemini_provider.py -v
```

- [ ] **Step 3: 实现 gemini_provider.py**

```python
"""GeminiProvider：中性契约的 Gemini 原生实现。

会话内部复刻今天 gemini_service 的 SDK 用法（start_chat + send_message_async +
FunctionResponse proto），保证 Gemini 路径字节级零回归。
"""
import json
import google.generativeai as genai
from typing import Optional
from google.generativeai.types import FunctionDeclaration, Tool

import config
from services.llm.base import ToolCall, TurnResult

genai.configure(api_key=config.GEMINI_API_KEY)

_GEN_CONFIG = {"temperature": 0.9, "top_p": 0.95, "top_k": 40, "max_output_tokens": 8192}


def _to_history(system_prompt: str, history: list) -> list:
    """系统提示词 → user 首轮 + model『我明白了。』确认语；其余文本轮按角色映射。
    与今天 _format_messages_for_gemini 的框架逐字一致。"""
    out = [
        {"role": "user", "parts": [{"text": system_prompt}]},
        {"role": "model", "parts": [{"text": "我明白了。"}]},
    ]
    for m in history:
        role = "user" if m["role"] == "user" else "model"
        out.append({"role": role, "parts": [{"text": m["content"]}]})
    return out


def _parse(response) -> TurnResult:
    text, calls = "", []
    for part in response.parts:
        if getattr(part, "function_call", None) and part.function_call:
            fc = part.function_call
            calls.append(ToolCall(name=fc.name, args=dict(fc.args), id=fc.name))
        elif getattr(part, "text", None):
            text += part.text
    return TurnResult(text=text, tool_calls=calls)


class _GeminiSession:
    def __init__(self, model_name, system_prompt, history, tools, force_tool):
        gtools = None
        if tools:
            gtools = [Tool(function_declarations=[FunctionDeclaration(**t) for t in tools])]
        kwargs = {}
        if force_tool:
            kwargs["tool_config"] = {"function_calling_config": {
                "mode": "ANY", "allowed_function_names": [force_tool]}}
        model = genai.GenerativeModel(
            model_name=model_name, generation_config=_GEN_CONFIG, tools=gtools, **kwargs)
        self._chat = model.start_chat(history=_to_history(system_prompt, history))

    async def send_user(self, text: str) -> TurnResult:
        return _parse(await self._chat.send_message_async(text, stream=False))

    async def send_tool_result(self, name: str, result: dict, call_id: str = "") -> TurnResult:
        payload = [genai.protos.Part(function_response=genai.protos.FunctionResponse(
            name=name, response=result))]
        return _parse(await self._chat.send_message_async(payload, stream=False))


class GeminiProvider:
    def __init__(self, model: str):
        self.model = model

    def open_session(self, system_prompt, history, tools, force_tool=None):
        return _GeminiSession(self.model, system_prompt, history, tools, force_tool)

    async def generate_json(self, prompt: str) -> str:
        cfg = {"temperature": 0.7, "response_mime_type": "application/json"}
        model = genai.GenerativeModel(model_name=self.model, generation_config=cfg)
        resp = await model.generate_content_async(prompt)
        return (resp.text or "").strip()

    async def generate_text(self, prompt, *, temperature=1.0, max_tokens=200, timeout=8) -> str:
        model = genai.GenerativeModel(model_name=self.model, generation_config={
            "temperature": temperature, "top_p": 0.95, "max_output_tokens": max_tokens})
        resp = await model.generate_content_async(prompt, request_options={"timeout": timeout})
        return resp.text or ""
```

- [ ] **Step 4: Run → pass**；全量 `pytest -q`（应 152 + 新增，全绿）。

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm/gemini_provider.py backend/tests/test_gemini_provider.py
git commit -m "feat(llm): GeminiProvider——复刻现有 SDK 用法，零回归"
```

---

### Task 4: OpenAICompatProvider —— DeepSeek / Kimi 共用

**Files:** Create `backend/services/llm/openai_provider.py`；Test：`backend/tests/test_openai_provider.py`（mock openai client）。

- [ ] **Step 1: Write failing test**

`backend/tests/test_openai_provider.py`：

```python
"""OpenAICompatProvider：中性输入 → OpenAI Chat Completions 形状。全程 mock openai client。"""
import sys, json, asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _msg(content=None, tool_calls=None):
    return SimpleNamespace(content=content, tool_calls=tool_calls)

def _completion(message):
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])

def _tc(id, name, args):
    return SimpleNamespace(id=id, function=SimpleNamespace(name=name, arguments=json.dumps(args)))


def _patched_client(create_mock):
    client = MagicMock()
    client.chat = MagicMock()
    client.chat.completions = MagicMock()
    client.chat.completions.create = create_mock
    return client


def test_send_user_text():
    from services.llm.openai_provider import OpenAICompatProvider
    create = AsyncMock(return_value=_completion(_msg(content="你好")))
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        sess = OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session("SYS", [], None)
        r = asyncio.run(sess.send_user("在吗"))
    assert r.text == "你好" and r.tool_calls == []
    # system 进了 messages
    _, kwargs = create.call_args
    assert kwargs["messages"][0] == {"role": "system", "content": "SYS"}


def test_send_user_tool_call():
    from services.llm.openai_provider import OpenAICompatProvider
    from services.llm import tools
    create = AsyncMock(return_value=_completion(_msg(tool_calls=[_tc("id1", "submit_reading_brief", {"user_goal": "求认同"})])))
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        sess = OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session(
            "SYS", [], tools.specs_by_names(["submit_reading_brief"]))
        r = asyncio.run(sess.send_user("他冷淡了"))
    assert r.tool_calls[0].name == "submit_reading_brief"
    assert r.tool_calls[0].args["user_goal"] == "求认同"
    assert r.tool_calls[0].id == "id1"
    # 工具被转成 OpenAI tools 形状
    _, kwargs = create.call_args
    assert kwargs["tools"][0]["type"] == "function"
    assert kwargs["tools"][0]["function"]["name"] == "submit_reading_brief"


def test_force_tool_sets_tool_choice():
    from services.llm.openai_provider import OpenAICompatProvider
    from services.llm import tools
    create = AsyncMock(return_value=_completion(_msg(tool_calls=[_tc("i", "submit_reading_brief", {})])))
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session(
            "SYS", [], tools.specs_by_names(["submit_reading_brief"]),
            force_tool="submit_reading_brief").send_user  # open only
        # 触发一次 create
        sess = OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session(
            "SYS", [], tools.specs_by_names(["submit_reading_brief"]), force_tool="submit_reading_brief")
        asyncio.run(sess.send_user("x"))
    _, kwargs = create.call_args
    assert kwargs["tool_choice"] == {"type": "function", "function": {"name": "submit_reading_brief"}}


def test_tool_result_roundtrip_and_single_toolcall_kept():
    """只保留第一个 tool_call（与 Agent Loop『处理第一个函数调用』一致），
    避免 OpenAI 要求每个 tool_call 都要有对应 tool 响应而报错。"""
    from services.llm.openai_provider import OpenAICompatProvider
    first = _completion(_msg(tool_calls=[
        _tc("a", "draw_tarot_cards", {}), _tc("b", "draw_tarot_cards", {})]))
    second = _completion(_msg(content="解读中"))
    create = AsyncMock(side_effect=[first, second])
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        sess = OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session("SYS", [], None)
        r1 = asyncio.run(sess.send_user("抽牌"))
        r2 = asyncio.run(sess.send_tool_result("draw_tarot_cards", {"success": True}, "a"))
    assert len(r1.tool_calls) == 1          # 只留第一个
    assert r2.text == "解读中"
    _, kwargs = create.call_args            # 第二次 create 的 messages 里有 tool 结果
    roles = [m["role"] for m in kwargs["messages"]]
    assert "tool" in roles


def test_generate_json_uses_json_response_format():
    from services.llm.openai_provider import OpenAICompatProvider
    create = AsyncMock(return_value=_completion(_msg(content='{"summary":"s"}')))
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        out = asyncio.run(OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").generate_json("p"))
    assert out == '{"summary":"s"}'
    _, kwargs = create.call_args
    assert kwargs["response_format"] == {"type": "json_object"}
```

- [ ] **Step 2: Run → fail**（ModuleNotFoundError 或 openai 未安装——先做 Task 9 装 openai 或此处 `pip install openai`）。

> **注意**：本任务依赖 `openai` 包。若未安装，先 `source venv/bin/activate && pip install openai`（Task 9 会把它写进 requirements）。

- [ ] **Step 3: 实现 openai_provider.py**

```python
"""OpenAICompatProvider：DeepSeek / Kimi 共用（均 OpenAI 兼容，仅 base_url/key/model 不同）。"""
import json
from typing import Optional
from openai import AsyncOpenAI

from services.llm.base import ToolCall, TurnResult


def _to_openai_tools(tools):
    if not tools:
        return None
    return [{"type": "function", "function": {
        "name": t["name"], "description": t["description"], "parameters": t["parameters"],
    }} for t in tools]


def _parse(message) -> TurnResult:
    calls = []
    for tc in (getattr(message, "tool_calls", None) or [])[:1]:   # 只留第一个，对齐 Agent Loop
        try:
            args = json.loads(tc.function.arguments or "{}")
        except json.JSONDecodeError:
            args = {}
        calls.append(ToolCall(name=tc.function.name, args=args, id=tc.id))
    return TurnResult(text=message.content or "", tool_calls=calls)


class _OpenAISession:
    def __init__(self, client, model, system_prompt, history, tools, force_tool):
        self._client = client
        self._model = model
        self._tools = _to_openai_tools(tools)
        self._force = ({"type": "function", "function": {"name": force_tool}}
                       if force_tool else None)
        self._messages = [{"role": "system", "content": system_prompt}]
        for m in history:
            self._messages.append({"role": m["role"], "content": m["content"]})
        # 记住上一轮的 tool_call_id（send_tool_result 需要）
        self._last_call_id = None

    async def _create(self):
        kwargs = {"model": self._model, "messages": self._messages}
        if self._tools:
            kwargs["tools"] = self._tools
            if self._force:
                kwargs["tool_choice"] = self._force
        resp = await self._client.chat.completions.create(**kwargs)
        msg = resp.choices[0].message
        result = _parse(msg)
        # 把 assistant 轮写回 messages（只保留第一个 tool_call，保证后面只需一条 tool 响应）
        assistant = {"role": "assistant", "content": msg.content or ""}
        if result.tool_calls:
            c = result.tool_calls[0]
            assistant["tool_calls"] = [{
                "id": c.id, "type": "function",
                "function": {"name": c.name, "arguments": json.dumps(c.args, ensure_ascii=False)},
            }]
            self._last_call_id = c.id
        self._messages.append(assistant)
        return result

    async def send_user(self, text: str) -> TurnResult:
        self._messages.append({"role": "user", "content": text})
        return await self._create()

    async def send_tool_result(self, name, result, call_id="") -> TurnResult:
        self._messages.append({
            "role": "tool",
            "tool_call_id": call_id or self._last_call_id or name,
            "content": json.dumps(result, ensure_ascii=False),
        })
        return await self._create()


class OpenAICompatProvider:
    def __init__(self, model: str, base_url: str, api_key: str, label: str = ""):
        self.model = model
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)

    def open_session(self, system_prompt, history, tools, force_tool=None):
        return _OpenAISession(self._client, self.model, system_prompt, history, tools, force_tool)

    async def generate_json(self, prompt: str) -> str:
        resp = await self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        return (resp.choices[0].message.content or "").strip()

    async def generate_text(self, prompt, *, temperature=1.0, max_tokens=200, timeout=8) -> str:
        resp = await self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature, max_tokens=max_tokens, timeout=timeout,
        )
        return resp.choices[0].message.content or ""
```

- [ ] **Step 4: Run → pass**；全量回归全绿。

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm/openai_provider.py backend/tests/test_openai_provider.py
git commit -m "feat(llm): OpenAICompatProvider——DeepSeek/Kimi 共用"
```

---

### Task 5: factory —— 按 Agent 取 provider

**Files:** Modify `backend/services/llm/__init__.py`；Test：`backend/tests/test_llm_factory.py`。

- [ ] **Step 1: Write failing test**

`backend/tests/test_llm_factory.py`：

```python
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_default_all_gemini():
    from services import llm
    from services.llm.gemini_provider import GeminiProvider
    for agent in ("opening", "reading", "memory"):
        assert isinstance(llm.get_provider(agent), GeminiProvider)


def test_reading_can_be_deepseek():
    import config
    from services import llm
    from services.llm.openai_provider import OpenAICompatProvider
    with patch.object(config, "READING_PROVIDER", "deepseek"), \
         patch.object(config, "DEEPSEEK_API_KEY", "k"):
        p = llm.get_provider("reading")
    assert isinstance(p, OpenAICompatProvider)
    assert p.model == config.READING_MODEL


def test_memory_can_be_kimi():
    import config
    from services import llm
    from services.llm.openai_provider import OpenAICompatProvider
    with patch.object(config, "MEMORY_PROVIDER", "kimi"), \
         patch.object(config, "KIMI_API_KEY", "k"):
        assert isinstance(llm.get_provider("memory"), OpenAICompatProvider)


def test_unknown_provider_raises():
    import config
    from services import llm
    with patch.object(config, "OPENING_PROVIDER", "bogus"):
        try:
            llm.get_provider("opening"); assert False
        except ValueError:
            pass
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: 实现 `backend/services/llm/__init__.py`**

```python
"""多 provider LLM 层：按 Agent 取配置好的 provider。"""
import config
from services.llm.base import ToolCall, TurnResult, LLMProvider, LLMSession
from services.llm.gemini_provider import GeminiProvider
from services.llm.openai_provider import OpenAICompatProvider

_AGENT_CONFIG = {
    "opening": ("OPENING_PROVIDER", "OPENING_MODEL"),
    "reading": ("READING_PROVIDER", "READING_MODEL"),
    "memory":  ("MEMORY_PROVIDER", "MEMORY_MODEL"),
}


def get_provider(agent: str) -> LLMProvider:
    prov_attr, model_attr = _AGENT_CONFIG[agent]
    provider = getattr(config, prov_attr).lower().strip()
    model = getattr(config, model_attr)
    if provider == "gemini":
        return GeminiProvider(model)
    if provider == "deepseek":
        return OpenAICompatProvider(model, config.DEEPSEEK_BASE_URL, config.DEEPSEEK_API_KEY, "deepseek")
    if provider == "kimi":
        return OpenAICompatProvider(model, config.KIMI_BASE_URL, config.KIMI_API_KEY, "kimi")
    raise ValueError(f"未知 provider: {provider}（agent={agent}）。支持 gemini/deepseek/kimi")


__all__ = ["get_provider", "ToolCall", "TurnResult", "LLMProvider", "LLMSession"]
```

- [ ] **Step 4: Run → pass**；全量回归。

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm/__init__.py backend/tests/test_llm_factory.py
git commit -m "feat(llm): factory——按 Agent 取 provider（默认全 gemini）"
```

---

### Task 6: stream_response 接 provider（前置+解读 Agent 换 provider）+ 迁移 3 个测试

**这是最大、风险最高的一步。** Files: Modify `backend/services/gemini_service.py`；迁移 `test_opening_agent_loop.py` / `test_opening_service.py` / `test_opening_handoff_e2e.py` 的 mock 点。

**改法**：Agent Loop 不再自己建 `genai.GenerativeModel` / `start_chat`，改为 `provider.open_session(...)` + `session.send_user` / `session.send_tool_result`。provider 按 phase 取：opening 用 `get_provider("opening")`，reading 用 `get_provider("reading")`，移交时切换。工具改用中性规格。系统提示词/历史拆分沿用 `_format_messages_for_gemini` 的逻辑，但**产出中性形状**。

- [ ] **Step 1: 加中性消息构建器**

在 `gemini_service.py` 里新增 `_build_neutral(...)`——复制 `_format_messages_for_gemini` 的**系统提示词拼装分支**（override / opening / reading 三分支，一字不动）与**历史转换逻辑**（SYSTEM 抽牌/星盘 → 文本+确认语；user/assistant → 文本），但产出：
```python
def _build_neutral(self, messages, user, session_type, system_prompt_override,
                   phase="reading", strategy=None, relationship_block="", force_brief=False):
    """返回 (system_prompt: str, history: list[{role,content}], last_user: str|None)。
    history 是除最后一条待发 user 外的全部文本轮；last_user 为最后一条 user 文本。
    抽牌结果/星盘 SYSTEM 消息按今天的规则转成 user 文本 + model 确认语两条。"""
```
system_prompt 分支 = 今天 `_format_messages_for_gemini` 的那段（调 `context_service.build_opening_prompt` / `build_reading_prompt`）。历史转换 = 今天 for 循环那段，但 append 成 `{"role","content"}`。最后把末尾的 user 轮拆成 `last_user`（若末尾不是 user 则 last_user=None，理论上不会发生——发消息时末尾必是 user）。

保留旧 `_format_messages_for_gemini` 暂不删（Task 结束确认无引用后删，或本步直接删并让 `_build_neutral` 完全取代——**推荐直接替换**，因为除 stream_response 外无其他调用方，用 `grep -rn "_format_messages_for_gemini" backend/` 确认）。

- [ ] **Step 2: 重写 stream_response 的循环体**

保留签名与所有既有语义（override 门控、`is_opening`、force_brief、"submit_reading_brief 不推前端"、同轮移交、done 唯一出口、function_executor=None 的外部执行分支）。骨架：

```python
async def stream_response(self, messages, user=None, session_type=SessionType.TAROT,
                          function_executor=None, system_prompt_override=None,
                          phase="reading", strategy=None, relationship_block="", force_brief=False):
    from services import llm
    from services.llm import tools as toolspecs

    has_override = system_prompt_override is not None
    is_opening = (not has_override) and phase == context_service.PHASE_OPENING

    def _tool_specs(for_opening):
        if has_override or session_type in (SessionType.DAILY, SessionType.CHAT):
            return toolspecs.specs_by_names(toolspecs.DAILY_TOOL_NAMES)
        if for_opening:
            return toolspecs.specs_by_names(toolspecs.OPENING_TOOL_NAMES)
        return toolspecs.specs_by_names(toolspecs.READING_TOOL_NAMES)

    provider = llm.get_provider("opening" if is_opening else "reading")
    system, history, last_user = self._build_neutral(
        messages, user, session_type, system_prompt_override,
        phase=phase, strategy=strategy, relationship_block=relationship_block, force_brief=force_brief)
    force = "submit_reading_brief" if (is_opening and force_brief) else None
    session = provider.open_session(system, history, _tool_specs(is_opening), force)

    # pending = 下一次要对 session 发的动作。每次 provider 往返都算一轮，
    # 总往返 ≤ MAX_AGENT_ITERATIONS（与今天 while iteration<max 的预算一致）。
    pending = ("user", last_user)
    for _ in range(self.MAX_AGENT_ITERATIONS):
        if pending[0] == "user":
            result = await session.send_user(pending[1])
        else:
            name, fn_result, cid = pending[1]
            result = await session.send_tool_result(name, fn_result, cid)

        if result.text:
            for i in range(0, len(result.text), 50):
                yield {"content": result.text[i:i+50]}
        if not result.tool_calls:
            yield {"done": True}
            return

        call = result.tool_calls[0]
        if function_executor is None:
            # daily/journey 外部执行分支：通知外部、return，本轮不算完成，绝不吐 done
            yield {"function_call": {"name": call.name, "args": call.args}}
            return
        if call.name != "submit_reading_brief":
            yield {"function_call": {"name": call.name, "args": call.args}}
        fn_result = await function_executor(call.name, call.args)

        if is_opening and call.name == "submit_reading_brief" and fn_result.get("success", True):
            # 同轮移交：切到 reading provider + 解读工具集，重建 session
            is_opening = False
            phase = context_service.PHASE_READING
            provider = llm.get_provider("reading")
            system2, history2, _ = self._build_neutral(
                messages, user, session_type, system_prompt_override,
                phase=phase, strategy=call.args)
            # 角色交替：history2 末尾若是 user，补一条 assistant 确认语收口
            if history2 and history2[-1]["role"] == "user":
                history2.append({"role": "assistant", "content": "（策略单已提交。）"})
            session = provider.open_session(system2, history2, _tool_specs(False), None)
            pending = ("user",
                "（开场读人已完成，策略单已就位。现在以占卜师的身份接续这段对话："
                "先用一句自然的过渡语收住开场，然后按策略单直接开始工作——"
                "该抽牌就调用抽牌工具，不要复述策略单，不要向用户解释你的判断，"
                "不要重新问已经问过的问题。）")
            continue

        pending = ("tool", (call.name, fn_result, call.id))

    yield {"done": True}
```

> 注意语义保真：①`function_executor is None`（daily/journey 外部执行，如 `routers/daily.py:155` 的心灵奇旅）路径 return，不吐 done；②`submit_reading_brief` 不推前端 function_call；③done 是唯一出口；④移交后 `is_opening=False`，之后的 submit 不再触发移交（与今天一致）；⑤`MAX_AGENT_ITERATIONS` 循环上限保持。删掉旧的 `_build_model` / `genai.GenerativeModel` / `build_force_brief_tool_config`（后者逻辑移进 GeminiProvider）/ `_select_tools` / 5 个 `FunctionDeclaration` 常量 / `TOOL_*`（已搬去 tools.py）/ 文件顶部 `genai.configure`（移进 provider）。`_build_user_context` 保留（`_build_neutral` 要用）。

- [ ] **Step 3: 迁移三个测试文件的 mock 点**

这三个文件现在 patch `services.gemini_service.genai.GenerativeModel` / 假 chat。重构后 gemini_service 不再直接调 genai。改为 **patch `services.llm.get_provider`** 返回一个假 provider，其 `open_session` 返回一个按脚本吐 `TurnResult` 的假 session。提供一个共用 helper（放进各测试文件或新建 `tests/_fake_llm.py`）：

```python
# tests/_fake_llm.py
from services.llm.base import TurnResult, ToolCall

class FakeSession:
    def __init__(self, script):     # script: list[TurnResult]
        self._script = list(script); self.sent = []
    async def send_user(self, text):
        self.sent.append(("user", text)); return self._script.pop(0)
    async def send_tool_result(self, name, result, call_id=""):
        self.sent.append(("tool", name, result)); return self._script.pop(0)

class FakeProvider:
    def __init__(self, script_by_session):   # list of scripts, one per open_session
        self._scripts = list(script_by_session); self.sessions = []
    def open_session(self, system, history, tools, force_tool=None):
        s = FakeSession(self._scripts.pop(0)); s.system = system; s.history = history
        s.tools = tools; s.force_tool = force_tool; self.sessions.append(s); return s
```

用它重写：
- `test_opening_agent_loop.py`：原来断言「工具集只有 submit_reading_brief」「reading 含 draw_tarot_cards」等——改为断言 `_tool_specs` 的产出（可直接单测 `services.llm.tools` 的名单，或断言 FakeProvider.open_session 收到的 tools 名单）。`build_force_brief_tool_config` 的断言 → 移到 `test_gemini_provider.py`（已在 Task 3 覆盖 mode=ANY），此处改为断言 opening+force_brief 时 `open_session` 收到 `force_tool="submit_reading_brief"`。
- `test_opening_handoff_e2e.py`：把 patch `genai.GenerativeModel` 换成 patch `services.gemini_service.llm.get_provider`（或 `services.llm.get_provider`，取决于引用点——用 `get_provider` 在 stream_response 内 `from services import llm; llm.get_provider`，则 patch `services.gemini_service` 里引用的 `llm`。最稳：`patch("services.llm.get_provider", ...)` 若 stream_response 内是 `from services import llm; llm.get_provider(...)` 则要 patch `services.llm.get_provider`）。用 FakeProvider 编排两个 session（opening 吐 submit_reading_brief 的 TurnResult；reading 吐过渡语文本 + draw_tarot_cards 的 TurnResult）。三个既有 e2e（移交、hard_exit、澄清轮、force_brief 接线）逐一改造，**断言不变**（SSE 事件、落库、phase）。
- `test_opening_service.py`：它 patch 的是 `opening_service._generate_greeting_via_llm`——Task 8 会改这个函数内部走 provider，但函数名保留。此文件多半**无需改**（patch 点还在）；跑一下确认，若红则按 Task 8 调整。

- [ ] **Step 4: 跑测试**

```bash
source venv/bin/activate && cd backend && pytest tests/test_opening_agent_loop.py tests/test_opening_handoff_e2e.py tests/test_opening_service.py -v
source venv/bin/activate && cd backend && pytest -q     # 全绿
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/gemini_service.py backend/tests/_fake_llm.py backend/tests/test_opening_agent_loop.py backend/tests/test_opening_handoff_e2e.py backend/tests/test_opening_service.py
git commit -m "refactor(agent): Agent Loop 接 provider 抽象——前置/解读 Agent 可独立换 provider"
```

---

### Task 7: 记忆 Agent（notebook）接 MEMORY provider

**Files:** Modify `backend/services/notebook_service.py`；Test：`backend/tests/test_notebook_provider.py`。

- [ ] **Step 1: Write failing test**

`backend/tests/test_notebook_provider.py`：断言 notebook 生成摘要时走 `llm.get_provider("memory").generate_json`，而非直接 `genai.GenerativeModel`。用 patch `services.llm.get_provider` 返回一个假 provider，其 `generate_json` 返回 `'{"summary":"测试摘要","cards_drawn":["愚者"]}'`，断言解析出 summary/cards。（构造最小 Conversation；若需要走完整 generate_and_save_entry，mock 掉存储；只测摘要生成那段——把它抽成可单测的方法或直接测 `_generate_summary`。读 notebook_service 现有结构决定测哪一层，**不要发真实请求**。）

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: 改 notebook_service**

把 `notebook_service.py:163-183` 那段（建 `genai.GenerativeModel` + `generate_content_async` + 解析 JSON）改为：
```python
from services import llm
...
provider = llm.get_provider("memory")
result_text = await provider.generate_json(prompt)
result = json.loads(result_text)
summary = result.get("summary", "")
cards_drawn = result.get("cards_drawn", [])
```
删掉 `NOTEBOOK_MODEL` 常量、`genai.configure` / `import genai`（若本文件其他地方不再用）。`NOTEBOOK_GENERATION_CONFIG` 的 temperature 等：generate_json 内部已设 temperature，若需保留特定值，评估是否要给 generate_json 加参数——**保持简单，用 provider 默认**（除非现值有特殊意义，读注释判断）。

- [ ] **Step 4: Run → pass**；全量回归。

- [ ] **Step 5: Commit**

```bash
git add backend/services/notebook_service.py backend/tests/test_notebook_provider.py
git commit -m "feat(memory): notebook 记忆 Agent 接 MEMORY provider"
```

---

### Task 8: 开场白接 OPENING provider

**Files:** Modify `backend/services/opening_service.py`；Test：更新 `test_opening_service.py` 相关用例（若 Task 6 已处理则确认）。

- [ ] **Step 1: 改 `_generate_greeting_via_llm`**

`backend/services/opening_service.py:111-127` 改为走 provider：
```python
async def _generate_greeting_via_llm(prompt: str) -> str:
    """无工具的轻量调用：只要一两句迎接语。带超时（第一印象不能永久转圈）。"""
    from services import llm
    provider = llm.get_provider("opening")
    return await provider.generate_text(
        prompt, temperature=1.0, max_tokens=200,
        timeout=config.OPENING_GREETING_TIMEOUT_SECONDS)
```
删掉本文件里对 `genai` / `GEMINI_MODEL` 的直接依赖（若不再用）。

- [ ] **Step 2: 测试**

`test_opening_service.py` 现有用例 patch 的是 `opening_service._generate_greeting_via_llm`（函数级），签名/行为不变 → 应仍绿。补一个用例：`_generate_greeting_via_llm` 内部调用了 `llm.get_provider("opening").generate_text`（patch provider，断言 timeout 传了 `config.OPENING_GREETING_TIMEOUT_SECONDS`）。跑：
```bash
source venv/bin/activate && cd backend && pytest tests/test_opening_service.py -v
```

- [ ] **Step 3: 全量回归 + Commit**

```bash
source venv/bin/activate && cd backend && pytest -q
git add backend/services/opening_service.py backend/tests/test_opening_service.py
git commit -m "feat(opening): 开场白接 OPENING provider"
```

---

### Task 9: 依赖 + .env 示例 + 收尾验证

**Files:** Modify 根目录 `requirements.txt`（已核实在仓库根，**不是** backend/）；Create 根目录 `.env.example`（已核实不存在——新建，只放示例占位，**绝不碰真实 `.env`**）。

> **前置**：`openai` 包尚未安装（已核实）。Task 4 开始前需 `source venv/bin/activate && pip install "openai>=1.40.0"`，否则 Task 4 的 import 会失败。

- [ ] **Step 1: 加 openai 依赖**

根 `requirements.txt` 追加：
```
openai>=1.40.0
```
`source venv/bin/activate && pip install "openai>=1.40.0"` 并 `python -c "import openai"` 确认。

- [ ] **Step 2: .env.example（新建）**

新建根目录 `.env.example`（若担心覆盖，先确认它不存在；只写占位与注释，不含真实 key）。补：
```bash
# ===== 多 Provider LLM（不配则三个 Agent 全走 Gemini）=====
# DEEPSEEK_API_KEY=sk-...
# KIMI_API_KEY=sk-...
# OPENING_PROVIDER=gemini      # gemini | deepseek | kimi
# OPENING_MODEL=gemini-3.1-flash-lite
# READING_PROVIDER=gemini
# READING_MODEL=gemini-3.1-flash-lite
# MEMORY_PROVIDER=gemini
# MEMORY_MODEL=gemini-2.5-flash
# 示例：DeepSeek 跑记忆 Agent → MEMORY_PROVIDER=deepseek / MEMORY_MODEL=deepseek-chat
# 示例：Kimi 跑解读 Agent   → READING_PROVIDER=kimi / READING_MODEL=moonshot-v1-8k
```

- [ ] **Step 3: 全量验证**

```bash
source venv/bin/activate && cd backend && pytest -q          # 全绿
cd frontend && npm run build                                 # 成功（前端零改动，护栏）
grep -rn "genai.GenerativeModel\|start_chat" backend/services/*.py   # 除 llm/gemini_provider.py 外应为空
```
最后一条确认：所有 genai 直连都已收进 provider 层。

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt .env.example   # 按实际路径
git commit -m "chore(llm): openai 依赖 + .env 多 provider 示例"
```

---

## 联调验收（人工，代码完成后）

- [ ] **默认零回归**：不改 `.env`，跑一遍完整塔罗占卜（开场→读人→交单→抽牌→解读）、每日一签、退出生成笔记——行为与今天一致。
- [ ] **记忆 Agent 换 DeepSeek**：`MEMORY_PROVIDER=deepseek MEMORY_MODEL=deepseek-chat` + `DEEPSEEK_API_KEY` → 触发笔记生成，看摘要 JSON 是否正常解析入库。（这是零 FC 风险项，最先验。）
- [ ] **解读 Agent 换 Kimi/DeepSeek**：观察 function calling（draw_tarot_cards）是否被正确触发、参数是否合法。**这是 FC 可靠性的关键验证点**——若模型不调工具或调错，记录下来，可能需要在对应 provider 上调 prompt 或退回 Gemini。
- [ ] **前置 Agent 换 provider + mode=ANY 守卫**：连发含糊消息触发强制交单，看非 Gemini provider 是否尊重 `tool_choice: required`（DeepSeek/Kimi 支持度参差，重点验）。
- [ ] **跨 provider 移交**：opening=Gemini、reading=DeepSeek（或反之），验证同轮移交后 reading provider 拿到完整历史、过渡语自然、抽牌正常。

## 已知风险（写入交付说明）

1. **DeepSeek/Kimi 的 FC 可靠性未经验证**——前置/解读 Agent 换过去后，读人交单/抽牌的准确率是未知数，尤其 `mode=ANY`（强制交单守卫第 2 层）对应的 `tool_choice: required` 支持度两家参差。记忆 Agent（纯 JSON）零风险。
2. **测试全程 mock provider**——真实 DeepSeek/Kimi 的 tool_call 参数格式、`tool_choice: required` 行为、连续 tool 消息约束在 mock 下看不见，**必须真 key 联调**。
3. Gemini 路径由「复刻既有 SDK 用法 + 152 回归测试」双保险，风险最低。
