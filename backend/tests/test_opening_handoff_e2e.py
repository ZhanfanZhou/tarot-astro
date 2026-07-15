"""端到端：开场 → 交单 → 同轮移交 → 解读 Agent 抽牌。

跨 routers/tarot + gemini_service + opening_service + context_service + SQLite 的整条链路，
走真实 HTTP（TestClient）、真实 SSE 编码、真实临时库；只把 LLM 换成剧本替身。

  · 零真实 LLM 请求、零花费（patch services.llm.get_provider → FakeProvider）
  · 绝不触碰 backend/data/（DB → tmp_path；用量计数文件 → tmp_path）

锁住的契约：
  1. 开场相位工具集只有 submit_reading_brief；交单后同一次回复内换成解读工具集并抽牌
  2. submit_reading_brief 是纯后台工具——SSE 里一个字节都不能外泄；draw_cards 必须推
  3. 移交重建的 session 必须带上用户最后一句澄清回答（读人素材，丢了就白读）
  4. 抽牌参数的 wire 契约：card_count 必须是 int、positions 必须是 list（前端据此渲染）
  5. 存量会话（phase=reading）行为不变：单 session、完整工具集、绝不移交
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
from tests._fake_llm import FakeProvider, FakeSession, TurnResult, ToolCall, tool_names  # noqa: E402

USER_ID = "user_e2e"
TRANSITION = "我大概明白你在担心什么了。别急，让牌来说话。"


# ---------------------------------------------------------------------------
# LLM 替身（provider 层；剧本按 open_session 顺序取用，并记录 trace）
# ---------------------------------------------------------------------------

class _FakeRepeated:
    """模仿 proto 的 RepeatedComposite：可迭代但不是 list —— 逼出 router 的转换逻辑。

    若 router 忘了 list(...)，json.dumps(default=str) 会把它糊成一个字符串，测试即失败。
    """

    def __init__(self, items):
        self._items = items

    def __iter__(self):
        return iter(self._items)


def _text(t):
    return TurnResult(text=t)


def _call(name, args):
    return TurnResult(tool_calls=[ToolCall(name=name, args=args)])


def _text_call(t, name, args):
    return TurnResult(text=t, tool_calls=[ToolCall(name=name, args=args)])


class _TracingSession(FakeSession):
    def __init__(self, script, trace):
        super().__init__(script)
        self._trace = trace

    async def send_tool_result(self, name, result, call_id=""):
        # 函数结果被喂回 = 该函数确实被 executor 执行完了
        self._trace.append(f"result:{name}")
        return await super().send_tool_result(name, result, call_id)


class _TracingProvider(FakeProvider):
    """FakeProvider + trace：记录 open_session（chat:N）与 tool result 喂回（result:name）的真实顺序。"""

    def __init__(self, scripts, trace):
        super().__init__(scripts)
        self.trace = trace

    def open_session(self, system, history, tools, force_tool=None):
        index = len(self.sessions) + 1
        self.trace.append(f"chat:{index}")
        s = _TracingSession(self._scripts.pop(0), self.trace)
        s.system = system
        s.history = history
        s.tools = tools
        s.force_tool = force_tool
        self.sessions.append(s)
        return s


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


def _seed_conversation(
    phase: str, messages, strategy=None, session_type=SessionType.TAROT
) -> Conversation:
    """直接落库一个会话（含历史消息），绕过开场白分支。"""
    from services.storage_service import StorageService

    conv = Conversation(
        conversation_id=f"conv_{session_type.value}_{phase}_{len(messages)}",
        user_id=USER_ID,
        session_type=session_type,
        phase=phase,
        strategy=strategy,
        messages=messages,
    )
    asyncio.run(StorageService.save_conversation(conv))
    return conv


# 塔罗与占星的 router 有约 20 行逐字复制的接线（交单分支、守卫、relationship_block、
# 抽牌 wire 转换）。复制粘贴出错不会被任何只打塔罗的测试抓到 —— 主链路按入口参数化，
# 两个 router 跑同一套断言。
ROUTES = [
    pytest.param(SessionType.TAROT, "/api/tarot/message", id="tarot"),
    pytest.param(SessionType.ASTROLOGY, "/api/astrology/message", id="astrology"),
]


def _get_conversation(conversation_id: str) -> Conversation:
    from services.storage_service import StorageService

    return asyncio.run(StorageService.get_conversation(conversation_id))


def _install_gemini(monkeypatch, scripts):
    """装上 LLM provider 替身，并给交单落库挂钩子——两者共用一条 trace，得到真实的执行顺序。"""
    from services import llm
    from services import gemini_service as gs
    from services import opening_service as op_mod

    trace = []
    prov = _TracingProvider(scripts, trace)
    # 移交时切 provider 也命中同一个替身（按 open_session 顺序取脚本）
    monkeypatch.setattr(llm, "get_provider", lambda agent: prov)

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
    prov.agent_events = agent_events
    return prov


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


def _sse_text(events) -> str:
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

@pytest.mark.parametrize("session_type,endpoint", ROUTES)
def test_opening_submits_brief_then_hands_off_and_draws(env, monkeypatch, session_type, endpoint):
    """一次 SSE 回复内：开场 Agent 交单 → 解读 Agent 接手说过渡语 → 抽牌按钮出现。

    塔罗与占星两个 router 跑同一套断言：占星那 20 行是从塔罗复制过去的，
    只测塔罗等于没测它。
    """
    conv = _seed_conversation(
        "opening", _greeting_and_user("他上周开始冷淡了"), session_type=session_type
    )

    scripts = [
        # session1（开场 Agent，只有交单工具）：读完人，直接交单，不说话
        [_call("submit_reading_brief", BRIEF_ARGS)],
        # session2（移交后重建的解读 Agent）：过渡语 + 抽牌，然后收尾
        [
            _text_call(TRANSITION, "draw_tarot_cards", {
                "spread_type": "three_card",
                "card_count": 3.0,  # proto 数字常以 float 到手
                "positions": _FakeRepeated(["过去", "现在", "未来"]),
            }),
            _text("静下心来，抽三张。"),
        ],
    ]
    prov = _install_gemini(monkeypatch, scripts)

    resp = env.post(endpoint, json={
        "conversation_id": conv.conversation_id,
        "content": "上周三他突然不回我消息了，我是不是该主动一点？",
    })
    assert resp.status_code == 200
    events, done = _sse(resp.text)

    # —— 移交确实发生了：交单先执行，随后才重建 session，抽牌在新 session 里完成 ——
    assert prov.trace == [
        "chat:1",                        # 开场 Agent
        "exec:submit_reading_brief",     # 交单落库（opening_service.save_strategy 被调用）
        "chat:2",                        # 同轮移交：解读 Agent 重建
        "result:draw_tarot_cards",       # 抽牌工具执行完，结果喂回解读 Agent
    ]

    # —— 工具集按相位隔离 ——
    assert tool_names(prov.sessions[0].tools) == ["submit_reading_brief"]
    assert "draw_tarot_cards" in tool_names(prov.sessions[1].tools)

    # —— 交单是纯后台工具：Agent Loop 根本不 yield 它的 function_call；抽牌才 yield ——
    pushed = [e["function_call"]["name"] for e in prov.agent_events if "function_call" in e]
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
    assert TRANSITION in _sse_text(events)
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
# 1b. 澄清轮（开场幕的正常路径）：不交单，只回一个叙事性问题
# ---------------------------------------------------------------------------

def test_opening_clarifying_turn_stays_in_opening_and_persists_reply(env, monkeypatch):
    """前置 Agent 不交单、只追问一句 → 留在开场相位，回复照常落库，绝不误翻相位。

    这是 0–2 轮澄清预算的**正常路径**（守卫尚未触发）。
    """
    conv = _seed_conversation("opening", [
        Message(role=MessageRole.ASSISTANT, content="坐吧，阿岚。今天想聊些什么？"),
    ])

    question = "你说「乱」——是事情本身乱，还是你心里乱？"
    prov = _install_gemini(monkeypatch, [[_text(question)]])

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": "最近有点乱，不知道从哪说起",
    })
    assert resp.status_code == 200
    events, done = _sse(resp.text)

    # —— 单 session：没交单就没有移交 ——
    assert len(prov.sessions) == 1
    # 仍是开场工具集，且守卫未上膛（预算没用尽，不该强制交单）
    assert tool_names(prov.sessions[0].tools) == ["submit_reading_brief"]
    assert prov.sessions[0].force_tool is None

    # —— 追问正常流式吐给用户，且没有任何工具事件外泄 ——
    assert _sse_text(events) == question
    assert not any("draw_cards" in e or "function_call" in e for e in events)
    assert done

    # —— 相位/策略单纹丝不动，assistant 追问已落库 ——
    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "opening"
    assert saved.strategy is None
    assert saved.messages[-1].role == MessageRole.ASSISTANT
    assert saved.messages[-1].content == question
    assert saved.messages[-2].role == MessageRole.USER

    # —— 下一轮仍走开场提示词：用户回答追问后，系统提示词依旧是开场幕那份 ——
    prov2 = _install_gemini(monkeypatch, [[_text("嗯，继续说。")]])
    resp2 = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": "心里乱吧",
    })
    assert resp2.status_code == 200

    assert tool_names(prov2.sessions[0].tools) == ["submit_reading_brief"]
    system_text = prov2.sessions[0].system
    assert "关系上下文" in system_text          # 开场幕提示词（含关系块）
    assert "本场策略单" not in system_text      # 而不是解读相位那份
    assert _get_conversation(conv.conversation_id).phase == "opening"


# ---------------------------------------------------------------------------
# 2. 存量会话：解读相位不移交
# ---------------------------------------------------------------------------

def test_reading_phase_never_hands_off(env, monkeypatch):
    """phase=reading（存量会话）→ 单 session、完整解读工具集、不重建。"""
    conv = _seed_conversation(
        "reading",
        [Message(role=MessageRole.ASSISTANT, content="你想问什么？")],
    )

    scripts = [[
        _text_call("我们来看看。", "draw_tarot_cards",
                   {"spread_type": "single", "card_count": 1}),
        _text("抽一张吧。"),
    ]]
    prov = _install_gemini(monkeypatch, scripts)

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": "我最近该不该换工作？",
    })
    assert resp.status_code == 200
    events, done = _sse(resp.text)

    # 只开了一个 session = 没有移交
    assert len(prov.sessions) == 1

    # 工具集是完整解读工具集（含抽牌；交单仍在，供中途改判）
    from services.llm import tools
    assert tool_names(prov.sessions[0].tools) == tools.READING_TOOL_NAMES
    assert "draw_tarot_cards" in tools.READING_TOOL_NAMES
    assert prov.sessions[0].force_tool is None  # 解读相位绝不带强制交单守卫

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
    """用户最后一句是读人的关键素材：移交重建 session 时它必须在 history 里，不能被丢。

    非移交路径下 last_user = 最后一条用户消息、history 不含它；移交路径把它整个塞进
    history、待发消息换成移交指令 —— 一旦写错就是「占卜师听不见用户最后那句话」。
    """
    last_user_line = "上周三他突然不回我消息了，我是不是该主动一点？"
    conv = _seed_conversation("opening", _greeting_and_user("我想问感情"))

    scripts = [
        [_call("submit_reading_brief", BRIEF_ARGS)],
        [_text(TRANSITION)],
    ]
    prov = _install_gemini(monkeypatch, scripts)

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": last_user_line,
    })
    assert resp.status_code == 200

    handoff = prov.sessions[1]
    flat = [(m["role"], m["content"]) for m in handoff.history]
    history_text = "\n".join(c for _, c in flat)

    # 用户最后那句澄清回答在移交后的历史里，且角色是 user
    assert last_user_line in history_text
    assert ("user", last_user_line) in flat
    # 之前的对话也一句不少
    assert "我想问感情" in history_text
    assert "坐吧，阿岚。今天想聊些什么？" in history_text
    # 移交后发给模型的第一条不是用户消息，而是移交指令（用户消息已在 history）
    kind, sent_text = handoff.sent[0]
    assert kind == "user"
    assert last_user_line not in sent_text
    # 策略单已注入解读 Agent 的系统提示词
    assert "本场策略单" in handoff.system and "求认同" in handoff.system


def test_handoff_history_has_no_two_consecutive_user_turns(env, monkeypatch):
    """移交后角色必须交替：history 以 assistant 收尾，紧接着的移交指令（user）才不会撞车。

    移交时 history 的最后一条是用户的澄清回答（user），而移交指令又是一个 user turn
    —— 连续两个 user，模型可能把移交指令当成用户说的话来回应。补一条 assistant 确认语
    保持交替（本文件既有惯例：系统提示词后的「我明白了。」、抽牌结果后的「我看到了…」）。
    """
    last_user_line = "上周三他突然不回我消息了"
    conv = _seed_conversation("opening", _greeting_and_user("我想问感情"))

    scripts = [
        [_call("submit_reading_brief", BRIEF_ARGS)],
        [_text(TRANSITION)],
    ]
    prov = _install_gemini(monkeypatch, scripts)

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id, "content": last_user_line,
    })
    assert resp.status_code == 200

    history = prov.sessions[1].history
    roles = [m["role"] for m in history]

    # 1) history 内部无连续两个 user
    assert not any(a == b == "user" for a, b in zip(roles, roles[1:])), roles
    # 2) history 以 assistant 收尾 —— 下一条（移交指令，user）接上去仍是交替
    assert roles[-1] == "assistant", roles
    # 3) 移交指令确实是紧随其后的那个 user turn
    kind, _sent_text = prov.sessions[1].sent[0]
    assert kind == "user"
    # 4) 为了交替而补的 assistant 确认语，不能把用户最后那句澄清挤掉
    flat = [(m["role"], m["content"]) for m in history]
    assert ("user", last_user_line) in flat


# ---------------------------------------------------------------------------
# 3b. 守卫第 2 层（router 侧接线）：澄清预算用尽 → 本轮 force_tool 强制交单
# ---------------------------------------------------------------------------

def test_force_brief_guard_reaches_model_as_force_tool(env, monkeypatch):
    """用户连发含糊消息到预算上限 → 传给 provider 的 force_tool 必须是 submit_reading_brief。

    补测理由：should_force_brief 有单测、GeminiProvider 的 mode=ANY 编码有单测，但
    「router 真的把 force_brief 传下去、opening session 因此拿到 force_tool」这段**接线**
    此前只在第 3 层（hard_exit）上做过 e2e。第 2 层是防「开场幕无限澄清」的主闸门。
    """
    import config

    # 库里已有 (FORCE_BRIEF - 1) 条含糊的用户消息，加上本轮这条正好把预算用尽
    history = _greeting_and_user(
        *[f"不知道欸{i}" for i in range(config.OPENING_FORCE_BRIEF_AFTER_USER_MSGS - 1)]
    )
    conv = _seed_conversation("opening", history)

    scripts = [
        # 守卫上膛后，模型在解码层已无法输出纯文本 —— 只能交单
        [_call("submit_reading_brief", BRIEF_ARGS)],
        # 交单 → 同轮移交给解读 Agent
        [_text(TRANSITION)],
    ]
    prov = _install_gemini(monkeypatch, scripts)

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": "还是说不上来",
    })
    assert resp.status_code == 200

    # —— 核心断言：守卫真的到达了 provider（不是只在 service 里算了个 bool） ——
    assert prov.sessions[0].force_tool == "submit_reading_brief"
    # 允许的函数必须真在本轮工具集里，否则 mode=ANY 指名一个不存在的函数 = API 报错
    assert tool_names(prov.sessions[0].tools) == ["submit_reading_brief"]

    # —— 移交后的解读 session 绝不能继续带着守卫（否则解读 Agent 也被逼着只能交单） ——
    assert prov.sessions[1].force_tool is None
    assert "draw_tarot_cards" in tool_names(prov.sessions[1].tools)

    # —— 守卫达成了它的目的：本轮收到策略单，会话离开开场幕 ——
    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "reading"
    assert saved.strategy == BRIEF_ARGS


# ---------------------------------------------------------------------------
# 4. 守卫第 3 层（router 侧接线）：开场超预算 → 兜底翻相位，不卡死
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("session_type,endpoint", ROUTES)
def test_hard_exit_guard_forces_reading_phase_when_opening_overruns(
    env, monkeypatch, session_type, endpoint
):
    """澄清轮数超硬上限 → router 兜底翻 phase：本轮直接拿完整解读工具集，绝不再困在开场。

    补测理由：守卫的判定函数有单测，但「router 真的调用它并因此改变了本轮工具集/相位」
    这段接线此前无人覆盖 —— 它是「会话永久卡死在开场幕」的唯一防线。
    """
    import config

    # 库里已有 (HARD_EXIT - 1) 条用户消息，加上本轮这条正好触顶
    history = _greeting_and_user(
        *[f"第{i}句" for i in range(config.OPENING_HARD_EXIT_AFTER_USER_MSGS - 1)]
    )
    conv = _seed_conversation("opening", history, session_type=session_type)

    prov = _install_gemini(monkeypatch, [[_text("好，我们直接开始。")]])

    resp = env.post(endpoint, json={
        "conversation_id": conv.conversation_id,
        "content": "就这样吧",
    })
    assert resp.status_code == 200

    # 本轮已按解读相位建 session：拿到抽牌工具，且没有强制交单守卫
    assert "draw_tarot_cards" in tool_names(prov.sessions[0].tools)
    assert prov.sessions[0].force_tool is None

    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "reading"
    assert saved.strategy is None  # 兜底不伪造假策略单
