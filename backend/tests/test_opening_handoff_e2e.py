"""端到端：开场 → 交单 → 同轮移交 → 解读 Agent 抽牌。

跨 routers/tarot + gemini_service + opening_service + context_service + SQLite 的整条链路，
走真实 HTTP（TestClient）、真实 SSE 编码、真实临时库；只把 Gemini 换成剧本替身。

  · 零真实 Gemini 请求、零花费（monkeypatch genai.GenerativeModel）
  · 绝不触碰 backend/data/（DB → tmp_path；用量计数文件 → tmp_path）

锁住的契约：
  1. 开场相位工具集只有 submit_reading_brief；交单后同一次回复内换成解读工具集并抽牌
  2. submit_reading_brief 是纯后台工具——SSE 里一个字节都不能外泄；draw_cards 必须推
  3. 移交重建的 chat 必须带上用户最后一句澄清回答（读人素材，丢了就白读）
  4. 抽牌参数的 wire 契约：card_count 必须是 int、positions 必须是 list（前端据此渲染）
  5. 存量会话（phase=reading）行为不变：单模型、完整工具集、绝不移交
  6. 守卫第 3 层：开场澄清超预算 → 兜底翻相位，不存在卡死在开场幕的会话
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    Conversation, Message, MessageRole, SessionType, User, UserType, UserProfile,
)

USER_ID = "user_e2e"
TRANSITION = "我大概明白你在担心什么了。别急，让牌来说话。"


# ---------------------------------------------------------------------------
# Gemini 替身（剧本按 chat 创建顺序取用）
# ---------------------------------------------------------------------------

class _FakeFunctionCall:
    def __init__(self, name, args):
        self.name = name
        self.args = args


class _FakePart:
    def __init__(self, text="", function_call=None):
        self.text = text
        self.function_call = function_call


class _FakeResponse:
    def __init__(self, parts):
        self.parts = parts


class _FakeRepeated:
    """模仿 proto 的 RepeatedComposite：可迭代但不是 list —— 逼出 router 的转换逻辑。

    若 router 忘了 list(...)，json.dumps(default=str) 会把它糊成一个字符串，测试即失败。
    """

    def __init__(self, items):
        self._items = items

    def __iter__(self):
        return iter(self._items)


def _function_response_name(message):
    """从「喂回模型的函数结果」里取函数名；普通文本消息返回 None。"""
    if isinstance(message, list) and message and hasattr(message[0], "function_response"):
        return message[0].function_response.name or None
    return None


class _FakeChat:
    def __init__(self, index, history, responses, trace):
        self.index = index
        self.history = history
        self.sent = []
        self._responses = responses
        self._trace = trace

    async def send_message_async(self, message, stream=False):
        self.sent.append(message)
        name = _function_response_name(message)
        if name:
            # 函数结果被喂回 = 该函数确实被 executor 执行完了
            self._trace.append(f"result:{name}")
        return self._responses.pop(0)


class _FakeModelFactory:
    """替身 genai.GenerativeModel：记录每次构造的工具集/tool_config、每个 chat 的历史。"""

    def __init__(self, response_script, trace):
        self.response_script = response_script
        self.trace = trace
        self.models = []   # [{"tools": [名字...], "tool_config": ...}]
        self.chats = []

    def __call__(self, model_name=None, generation_config=None, tools=None, tool_config=None):
        names = [fd.name for tool in (tools or []) for fd in tool.function_declarations]
        self.models.append({"tools": names, "tool_config": tool_config})
        factory = self

        class _Model:
            def start_chat(self_inner, history):
                index = len(factory.chats) + 1
                factory.trace.append(f"chat:{index}")
                chat = _FakeChat(index, history, factory.response_script.pop(0), factory.trace)
                factory.chats.append(chat)
                return chat

        return _Model()


# ---------------------------------------------------------------------------
# 环境：临时库 + 临时用量文件 + 真实 token
# ---------------------------------------------------------------------------

@pytest.fixture
def env(tmp_path, monkeypatch):
    import services.db as db_mod
    import services.rate_limit_service as rl_mod
    # 先导入 main（早于任何 asyncio.run）：py3.9 下 asyncio.run 会清空线程的 event loop，
    # 而 main -> routers.tarot -> rate_limit_service 在模块级构造 asyncio.Lock()。详见 test_admin_router。
    from main import app

    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)
    # 用量计数落临时文件，绝不写 backend/data/usage.json
    monkeypatch.setattr(rl_mod, "USAGE_FILE", tmp_path / "usage.json")

    from services.auth_service import create_access_token
    from services.storage_service import StorageService

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True
        await StorageService.save_user(User(
            user_id=USER_ID,
            user_type=UserType.REGISTERED,
            username="e2e",
            password_hash="x",
            profile=UserProfile(nickname="阿岚"),
        ))

    asyncio.run(_init())

    client = TestClient(app)
    token = create_access_token(USER_ID, UserType.REGISTERED)
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


def _seed_conversation(phase: str, messages, strategy=None) -> Conversation:
    """直接落库一个会话（含历史消息），绕过开场白分支。"""
    from services.storage_service import StorageService

    conv = Conversation(
        conversation_id=f"conv_{phase}_{len(messages)}",
        user_id=USER_ID,
        session_type=SessionType.TAROT,
        phase=phase,
        strategy=strategy,
        messages=messages,
    )
    asyncio.run(StorageService.save_conversation(conv))
    return conv


def _get_conversation(conversation_id: str) -> Conversation:
    from services.storage_service import StorageService

    return asyncio.run(StorageService.get_conversation(conversation_id))


def _install_gemini(monkeypatch, script):
    """装上 Gemini 替身，并给交单落库挂钩子——两者共用一条 trace，得到真实的执行顺序。"""
    from services import gemini_service as gs
    from services import opening_service as op_mod

    trace = []
    factory = _FakeModelFactory(script, trace)
    monkeypatch.setattr(gs.genai, "GenerativeModel", factory)

    original_save = op_mod.save_strategy

    async def _spy_save_strategy(conversation, strategy):
        # executor 执行 submit_reading_brief 的唯一副作用，即交单被执行的铁证
        trace.append("exec:submit_reading_brief")
        return await original_save(conversation, strategy)

    monkeypatch.setattr(op_mod, "save_strategy", _spy_save_strategy)

    # 录下 Agent Loop yield 出去的原始事件。router 对未知函数名是静默的（只认 draw_cards /
    # need_profile），所以「交单不外泄」在 wire 上看不出来——必须在这一层验，否则
    # gemini_service 哪天把 submit_reading_brief 推出去了，SSE 断言也照样绿。
    original_stream = gs.GeminiService.stream_response
    agent_events = []

    async def _wrapped_stream(self, *args, **kwargs):
        async for event in original_stream(self, *args, **kwargs):
            agent_events.append(event)
            yield event

    monkeypatch.setattr(gs.GeminiService, "stream_response", _wrapped_stream)
    factory.agent_events = agent_events
    return factory


def _sse(body: str):
    """解析 SSE：返回 (事件字典列表, 是否以 [DONE] 收尾)。"""
    events, done = [], False
    for line in body.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[len("data: "):]
        if payload == "[DONE]":
            done = True
            continue
        events.append(json.loads(payload))
    return events, done


def _text(events) -> str:
    return "".join(e["content"] for e in events if "content" in e)


def _greeting_and_user(*user_texts):
    """开场白 + 若干轮（用户说 → 占卜师追问）。"""
    msgs = [Message(role=MessageRole.ASSISTANT, content="坐吧，阿岚。今天想聊些什么？")]
    for t in user_texts:
        msgs.append(Message(role=MessageRole.USER, content=t))
        msgs.append(Message(role=MessageRole.ASSISTANT, content="嗯，再说说。"))
    return msgs


BRIEF_ARGS = {
    "question_topic": "感情",
    "user_goal": "求认同",
    "emotional_intensity": "高",
    "reading_strategy": "先接住情绪，再验证她的直觉",
}


# ---------------------------------------------------------------------------
# 1. 主链路：开场 → 交单 → 同轮移交 → 抽牌
# ---------------------------------------------------------------------------

def test_opening_submits_brief_then_hands_off_and_draws(env, monkeypatch):
    """一次 SSE 回复内：开场 Agent 交单 → 解读 Agent 接手说过渡语 → 抽牌按钮出现。"""
    conv = _seed_conversation("opening", _greeting_and_user("他上周开始冷淡了"))

    script = [
        # chat1（开场 Agent，只有交单工具）：读完人，直接交单，不说话
        [_FakeResponse([_FakePart(function_call=_FakeFunctionCall(
            "submit_reading_brief", BRIEF_ARGS))])],
        # chat2（移交后重建的解读 Agent）：过渡语 + 抽牌，然后收尾
        [
            _FakeResponse([
                _FakePart(text=TRANSITION),
                _FakePart(function_call=_FakeFunctionCall("draw_tarot_cards", {
                    "spread_type": "three_card",
                    "card_count": 3.0,  # proto 数字常以 float 到手
                    "positions": _FakeRepeated(["过去", "现在", "未来"]),
                })),
            ]),
            _FakeResponse([_FakePart(text="静下心来，抽三张。")]),
        ],
    ]
    factory = _install_gemini(monkeypatch, script)

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": "上周三他突然不回我消息了，我是不是该主动一点？",
    })
    assert resp.status_code == 200
    events, done = _sse(resp.text)

    # —— 移交确实发生了：交单先执行，随后才重建 chat，抽牌在新 chat 里完成 ——
    assert factory.trace == [
        "chat:1",                        # 开场 Agent
        "exec:submit_reading_brief",     # 交单落库（opening_service.save_strategy 被调用）
        "chat:2",                        # 同轮移交：解读 Agent 重建
        "result:draw_tarot_cards",       # 抽牌工具执行完，结果喂回解读 Agent
    ]

    # —— 工具集按相位隔离 ——
    assert factory.models[0]["tools"] == ["submit_reading_brief"]
    assert "draw_tarot_cards" in factory.models[1]["tools"]

    # —— 交单是纯后台工具：Agent Loop 根本不 yield 它的 function_call；抽牌才 yield ——
    pushed = [e["function_call"]["name"] for e in factory.agent_events if "function_call" in e]
    assert pushed == ["draw_tarot_cards"]

    # —— 一路到 SSE 也一个字节都不外泄（连策略单内容也不能漏给前端） ——
    assert "submit_reading_brief" not in resp.text
    assert "求认同" not in resp.text
    assert not any("function_call" in e for e in events)

    # —— 抽牌必须推给前端，且 wire 契约成立（card_count=int / positions=list） ——
    draws = [e["draw_cards"] for e in events if "draw_cards" in e]
    assert len(draws) == 1
    assert draws[0]["spread_type"] == "three_card"
    assert draws[0]["card_count"] == 3 and isinstance(draws[0]["card_count"], int)
    assert draws[0]["positions"] == ["过去", "现在", "未来"]

    # —— 解读 Agent 的过渡语正常流式输出，且先于抽牌事件到达 ——
    assert TRANSITION in _text(events)
    assert done
    first_draw = next(i for i, e in enumerate(events) if "draw_cards" in e)
    assert "content" in events[0] and first_draw > 0

    # —— 落库：策略单 + 相位翻转 + 回复入库 ——
    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "reading"
    assert saved.strategy == BRIEF_ARGS
    assert TRANSITION in saved.messages[-1].content
    assert saved.messages[-1].role == MessageRole.ASSISTANT


# ---------------------------------------------------------------------------
# 2. 存量会话：解读相位不移交
# ---------------------------------------------------------------------------

def test_reading_phase_never_hands_off(env, monkeypatch):
    """phase=reading（存量会话）→ 单模型、完整解读工具集、不重建 chat。"""
    conv = _seed_conversation(
        "reading",
        [Message(role=MessageRole.ASSISTANT, content="你想问什么？")],
    )

    script = [[
        _FakeResponse([
            _FakePart(text="我们来看看。"),
            _FakePart(function_call=_FakeFunctionCall(
                "draw_tarot_cards", {"spread_type": "single", "card_count": 1})),
        ]),
        _FakeResponse([_FakePart(text="抽一张吧。")]),
    ]]
    factory = _install_gemini(monkeypatch, script)

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": "我最近该不该换工作？",
    })
    assert resp.status_code == 200
    events, done = _sse(resp.text)

    # 只建了一个模型 / 一个 chat = 没有移交
    assert len(factory.models) == 1
    assert len(factory.chats) == 1

    # 工具集是完整解读工具集（含抽牌；交单仍在，供中途改判）
    from services.gemini_service import GeminiService
    expected = [fd.name for tool in GeminiService().tarot_tools for fd in tool.function_declarations]
    assert factory.models[0]["tools"] == expected
    assert "draw_tarot_cards" in expected
    assert factory.models[0]["tool_config"] is None  # 解读相位绝不带强制交单守卫

    assert [e for e in events if "draw_cards" in e]
    assert done

    # 相位/策略单不因一次普通解读而改变
    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "reading"
    assert saved.strategy is None


# ---------------------------------------------------------------------------
# 3. 移交后的历史必须完整（尤其是用户最后一句澄清回答）
# ---------------------------------------------------------------------------

def test_handoff_preserves_full_history_including_last_user_message(env, monkeypatch):
    """用户最后一句是读人的关键素材：移交重建 chat 时它必须在 history 里，不能被丢。

    非移交路径下 last_message = 最后一条用户消息、history 不含它；移交路径把它整个塞进
    history、last_message 换成移交指令 —— 一旦写错就是「占卜师听不见用户最后那句话」。
    """
    last_user_line = "上周三他突然不回我消息了，我是不是该主动一点？"
    conv = _seed_conversation("opening", _greeting_and_user("我想问感情"))

    script = [
        [_FakeResponse([_FakePart(function_call=_FakeFunctionCall(
            "submit_reading_brief", BRIEF_ARGS))])],
        [_FakeResponse([_FakePart(text=TRANSITION)])],
    ]
    factory = _install_gemini(monkeypatch, script)

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": last_user_line,
    })
    assert resp.status_code == 200

    handoff_history = factory.chats[1].history
    flat = [
        (m["role"], part.get("text", ""))
        for m in handoff_history
        for part in m["parts"]
    ]
    history_text = "\n".join(t for _, t in flat)

    # 用户最后那句澄清回答在移交后的历史里，且角色是 user
    assert last_user_line in history_text
    assert ("user", last_user_line) in flat
    # 之前的对话也一句不少
    assert "我想问感情" in history_text
    assert "坐吧，阿岚。今天想聊些什么？" in history_text
    # 移交后发给模型的第一条不是用户消息，而是移交指令（用户消息已在 history）
    assert isinstance(factory.chats[1].sent[0], str)
    assert last_user_line not in factory.chats[1].sent[0]
    # 策略单已注入解读 Agent 的系统提示词
    assert "本场策略单" in flat[0][1] and "求认同" in flat[0][1]


# ---------------------------------------------------------------------------
# 4. 守卫第 3 层（router 侧接线）：开场超预算 → 兜底翻相位，不卡死
# ---------------------------------------------------------------------------

def test_hard_exit_guard_forces_reading_phase_when_opening_overruns(env, monkeypatch):
    """澄清轮数超硬上限 → router 兜底翻 phase：本轮直接拿完整解读工具集，绝不再困在开场。

    补测理由：守卫的判定函数有单测，但「router 真的调用它并因此改变了本轮工具集/相位」
    这段接线此前无人覆盖 —— 它是「会话永久卡死在开场幕」的唯一防线。
    """
    import config

    # 库里已有 (HARD_EXIT - 1) 条用户消息，加上本轮这条正好触顶
    history = _greeting_and_user(
        *[f"第{i}句" for i in range(config.OPENING_HARD_EXIT_AFTER_USER_MSGS - 1)]
    )
    conv = _seed_conversation("opening", history)

    script = [[_FakeResponse([_FakePart(text="好，我们直接开始。")])]]
    factory = _install_gemini(monkeypatch, script)

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": "就这样吧",
    })
    assert resp.status_code == 200

    # 本轮已按解读相位建模：拿到抽牌工具，且没有 mode=ANY 强制交单守卫
    assert "draw_tarot_cards" in factory.models[0]["tools"]
    assert factory.models[0]["tool_config"] is None

    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "reading"
    assert saved.strategy is None  # 兜底不伪造假策略单
