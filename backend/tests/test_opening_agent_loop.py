"""前置 Agent 的 Loop 行为：工具集按相位隔离、守卫 tool_config、相位提示词。

全程 mock Gemini（不发真实请求、不花钱）。
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Message, MessageRole, SessionType  # noqa: E402


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

    # FunctionDeclaration 会把 parameters dict 编译成 proto Schema，用属性访问
    schema = GeminiService.TOOL_SUBMIT_READING_BRIEF.parameters
    expected = {
        "question_topic", "user_goal", "emotional_intensity",
        "context_summary", "desired_takeaway", "tool_route",
        "suggested_spread", "reading_strategy", "pacing",
    }
    assert set(schema.properties.keys()) == expected
    # 四个必填：读人的最小结论集，其余可空
    assert set(schema.required) == {
        "question_topic", "user_goal", "emotional_intensity", "reading_strategy",
    }


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


# ---------------------------------------------------------------------------
# 同轮移交：Agent Loop 的行为测试（Gemini 全程 mock，零请求零花费）
# ---------------------------------------------------------------------------

class _FakeFunctionCall:
    def __init__(self, name, args):
        self.name = name
        self.args = args


class _FakePart:
    """模仿 Gemini 的 part：要么带 function_call，要么带 text。"""

    def __init__(self, text="", function_call=None):
        self.text = text
        self.function_call = function_call


class _FakeResponse:
    def __init__(self, parts):
        self.parts = parts


class _FakeChat:
    def __init__(self, history, responses):
        self.history = history
        self._responses = responses
        self.sent = []

    async def send_message_async(self, message, stream=False):
        self.sent.append(message)
        return self._responses.pop(0)


class _FakeModelFactory:
    """替身 genai.GenerativeModel：记录每次构造用的工具集/tool_config 与 chat 历史。"""

    def __init__(self, response_script):
        self.response_script = response_script  # 按 chat 创建顺序取用
        self.models = []   # [{"tools": [...names], "tool_config": ...}]
        self.chats = []

    def __call__(self, model_name=None, generation_config=None, tools=None, tool_config=None):
        names = [fd.name for tool in tools for fd in tool.function_declarations]
        self.models.append({"tools": names, "tool_config": tool_config})
        factory = self

        class _Model:
            def start_chat(self_inner, history):
                responses = factory.response_script.pop(0)
                chat = _FakeChat(history, responses)
                factory.chats.append(chat)
                return chat

        return _Model()


async def _collect(agen):
    return [event async for event in agen]


def _run(agen):
    """本仓测试不装 pytest-asyncio，沿用 asyncio.run 的既有约定。"""
    return asyncio.run(_collect(agen))


def test_opening_handoff_swaps_tools_and_draws_in_same_reply(monkeypatch):
    """同轮移交：开场交单后，同一次 SSE 回复内换成解读工具集并抽牌。

    用户最后一句澄清答完 → 抽牌按钮直接出现，不需要多回一句。
    """
    from services import gemini_service as gs

    # 第 1 个 chat（开场 Agent）：直接交单，不说话
    # 第 2 个 chat（解读 Agent，移交后重建）：过渡语 + 抽牌
    script = [
        [_FakeResponse([_FakePart(function_call=_FakeFunctionCall(
            "submit_reading_brief",
            {"question_topic": "感情", "user_goal": "求认同",
             "emotional_intensity": "高", "reading_strategy": "验证式"},
        ))])],
        [
            _FakeResponse([
                _FakePart(text="我懂了，让牌来说话。"),
                _FakePart(function_call=_FakeFunctionCall(
                    "draw_tarot_cards", {"spread_type": "three_card", "card_count": 3})),
            ]),
            # 抽牌结果喂回后模型收尾（既有行为：executor 只回「已通知前端」）
            _FakeResponse([_FakePart(text="静下来，抽三张。")]),
        ],
    ]
    factory = _FakeModelFactory(script)
    monkeypatch.setattr(gs.genai, "GenerativeModel", factory)

    executed = []

    async def executor(name, args):
        executed.append(name)
        return {"success": True}

    svc = gs.GeminiService()
    events = _run(svc.stream_response(
        messages=[Message(role=MessageRole.USER, content="他上周开始冷淡了")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=executor,
        phase="opening",
        relationship_block="<关系上下文>\n首次来访",
    ))

    # 开场模型只有交单工具；移交后的模型拿到完整工具集
    assert factory.models[0]["tools"] == ["submit_reading_brief"]
    assert "draw_tarot_cards" in factory.models[1]["tools"]

    # 交单是纯后台工具，绝不推给前端；抽牌才推（前端据此弹抽牌按钮）
    pushed = [e["function_call"]["name"] for e in events if "function_call" in e]
    assert pushed == ["draw_tarot_cards"]

    # 策略单已注入移交后的系统提示词
    handoff_system = factory.chats[1].history[0]["parts"][0]["text"]
    assert "求认同" in handoff_system
    assert "本场策略单" in handoff_system

    # 交单确实落库（executor 被调用），且解读 Agent 的过渡语已流式吐出
    assert executed == ["submit_reading_brief", "draw_tarot_cards"]
    assert "".join(e.get("content", "") for e in events).startswith("我懂了")


def test_force_brief_passes_any_mode_config_to_model(monkeypatch):
    """守卫开启时，tool_config 真的传给了模型（而不只是构造出一个 dict）。"""
    from services import gemini_service as gs

    script = [
        [_FakeResponse([_FakePart(function_call=_FakeFunctionCall(
            "submit_reading_brief",
            {"question_topic": "事业", "user_goal": "辅助决策",
             "emotional_intensity": "中", "reading_strategy": "决策式"},
        ))])],
        [_FakeResponse([_FakePart(text="好，我们开始。")])],
    ]
    factory = _FakeModelFactory(script)
    monkeypatch.setattr(gs.genai, "GenerativeModel", factory)

    async def executor(name, args):
        return {"success": True}

    svc = gs.GeminiService()
    _run(svc.stream_response(
        messages=[Message(role=MessageRole.USER, content="嗯")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=executor,
        phase="opening",
        force_brief=True,
    ))

    assert factory.models[0]["tool_config"] == gs.GeminiService.build_force_brief_tool_config()
    # 移交后的解读模型不带守卫（否则解读 Agent 也被逼着只能交单）
    assert factory.models[1]["tool_config"] is None


def test_reading_phase_submit_brief_does_not_trigger_handoff(monkeypatch):
    """中途改判：解读相位再次交单 → 结果照常喂回原 chat，绝不触发移交/换提示词。"""
    from services import gemini_service as gs

    script = [
        [
            _FakeResponse([_FakePart(function_call=_FakeFunctionCall(
                "submit_reading_brief",
                {"question_topic": "事业", "user_goal": "辅助决策",
                 "emotional_intensity": "中", "reading_strategy": "决策式"},
            ))]),
            _FakeResponse([_FakePart(text="好，换个方向重新看。")]),
        ],
    ]
    factory = _FakeModelFactory(script)
    monkeypatch.setattr(gs.genai, "GenerativeModel", factory)

    async def executor(name, args):
        return {"success": True}

    svc = gs.GeminiService()
    events = _run(svc.stream_response(
        messages=[Message(role=MessageRole.USER, content="其实我想问工作")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=executor,
        phase="reading",
        strategy={"user_goal": "求认同"},
    ))

    # 只建了一个模型、一个 chat：没有重建 = 没有移交
    assert len(factory.models) == 1
    assert len(factory.chats) == 1
    # 函数结果被喂回同一个 chat（第二次 send 是 function_response）
    assert len(factory.chats[0].sent) == 2
    assert events[-1] == {"done": True}
