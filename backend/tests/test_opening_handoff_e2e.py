"""端到端：开场 → 交单 → 同轮移交 → 解读 Agent 抽牌。

跨 routers/tarot + gemini_service + opening_service + context_service + SQLite 的整条链路，
走真实 HTTP（TestClient）、真实 SSE 编码、真实临时库；只把 LLM 换成剧本替身。

  · 零真实 LLM 请求、零花费（patch services.llm.get_provider → FakeProvider）
  · 绝不触碰 backend/data/（DB → tmp_path；用量计数文件 → tmp_path）

锁住的契约：
  1. 开场相位工具集只有 submit_reading_brief；交单后同一次回复内换成解读工具集并抽牌
  2. submit_reading_brief 是纯后台工具——SSE 里一个字节都不能外泄；SSE 只有正文。
     抽牌调用落库在会话末尾，前端据此显示抽牌按钮（不另开事件通道）
  3. 移交重建的 session 必须带上用户最后一句澄清回答（读人素材，丢了就白读）
  4. 抽牌参数的 wire 契约：positions 必须是 list，前端据此渲染槽位（个数=张数）
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
from services import context_service  # noqa: E402
from tests._fake_llm import FakeProvider, FakeSession, TurnResult, ToolCall, tool_names  # noqa: E402

USER_ID = "user_e2e"
TRANSITION = "我大概明白你在担心什么了。别急，让牌来说话。"


# ---------------------------------------------------------------------------
# LLM 替身（provider 层；剧本按 open_session 顺序取用，并记录 trace）
# ---------------------------------------------------------------------------

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


# provider 交出来的就是纯 python（proto 转换在 GeminiProvider 内部，见
# test_gemini_provider.test_tool_call_args_come_back_as_plain_python）。
# 抽几张由 positions 的个数决定，没有单独的张数字段。
BRIEF_ARGS = {
    "question": "他还会回头吗",
    "context": "上周三他突然不回消息",
    "route": "tarot",
    "spread_type": "three_card",
    "positions": ["过去", "现在", "未来"],
}

# 星盘路线：不需要用户动手，交单后同轮移交给解读 Agent 取盘
BRIEF_ASTRO = {"question": "我这两年的事业格局", "route": "astrology"}


# ---------------------------------------------------------------------------
# 1. 主链路：开场 → 交单 → 同轮移交 → 抽牌
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("session_type,endpoint", ROUTES)
def test_opening_submits_brief_then_draws_straight_from_it(
    env, monkeypatch, session_type, endpoint
):
    """一次 SSE 回复内：开场 Agent 一句过渡语 + 交单 → 抽牌按钮直接出现。

    牌阵参数已经在起手单里，harness 照单推抽牌器，不再叫解读 Agent 出来重念一遍。
    塔罗与占星两个 router 跑同一套断言：占星那 20 行是从塔罗复制过去的，
    只测塔罗等于没测它。
    """
    conv = _seed_conversation(
        "opening", _greeting_and_user("他上周开始冷淡了"), session_type=session_type
    )

    # 只有开场 session —— 解读 session 根本不该被开出来
    prov = _install_gemini(
        monkeypatch, [[_text_call(TRANSITION, "submit_reading_brief", BRIEF_ARGS)]]
    )

    resp = env.post(endpoint, json={
        "conversation_id": conv.conversation_id,
        "content": "上周三他突然不回我消息了，我是不是该主动一点？",
    })
    assert resp.status_code == 200
    events, done = _sse(resp.text)

    # —— 交单先落库，随后 harness 自己执行抽牌，全程一次 provider 往返 ——
    # 只有一次 chat —— 交单之后 harness 自己把抽牌做掉了，没有第二次 provider 往返
    assert prov.trace == [
        "chat:1",                        # 开场 Agent
        "exec:submit_reading_brief",     # 交单落库（opening_service.save_strategy 被调用）
    ]
    assert len(prov.sessions) == 1
    assert tool_names(prov.sessions[0].tools) == [
        "submit_reading_brief", "request_user_profile"]

    # —— SSE 只有正文：交单、起手单内容、抽牌指令都不在流里 ——
    assert all(set(e) == {"content"} for e in events)
    assert "submit_reading_brief" not in resp.text
    assert "他还会回头吗" not in resp.text

    # —— 过渡语正常流式输出 ——
    assert _sse_text(events) == TRANSITION
    assert done

    # —— 落库：起手单 + 相位翻转 + 这一轮的记录（话+交单 → 交单结果 → 抽牌调用） ——
    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "reading"
    assert saved.strategy["question"] == "他还会回头吗"
    assert saved.strategy["route"] == "tarot"
    tail = saved.messages[-3:]
    assert [m.role for m in tail] == [MessageRole.ASSISTANT, MessageRole.TOOL, MessageRole.ASSISTANT]
    assert tail[0].content == TRANSITION and tail[0].tool_calls[0].name == "submit_reading_brief"
    assert tail[1].tool_call_id == tail[0].tool_calls[0].id
    # 抽牌调用停在会话末尾，前端据此显示抽牌按钮；/draw 用同一个 id 写结果。
    # 牌阵参数逐字取自起手单（positions 是 list，个数即张数）
    assert tail[2].tool_calls[0].name == "draw_tarot_cards"
    assert tail[2].tool_calls[0].args == {"spread_type": "three_card", "positions": ["过去", "现在", "未来"]}


# ---------------------------------------------------------------------------
# 1a. 交单那一轮一个字没说：照样正常收场，不替模型编话
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("session_type,endpoint", ROUTES)
def test_silent_submit_pushes_the_drawer_without_inventing_a_line(
    env, monkeypatch, session_type, endpoint
):
    """模型只调工具、不说正文 —— 那是它的选择，harness 不塞话进去。

    说与不说都必须能正常收场：这里锁的是「没说话」那一半——抽牌器照推、SSE 照常
    收尾、不落一条空的助手消息。
    """
    conv = _seed_conversation(
        "opening", _greeting_and_user("他上周开始冷淡了"), session_type=session_type
    )
    prov = _install_gemini(monkeypatch, [[_call("submit_reading_brief", BRIEF_ARGS)]])

    resp = env.post(endpoint, json={
        "conversation_id": conv.conversation_id,
        "content": "上周三他突然不回我消息了，我是不是该主动一点？",
    })
    assert resp.status_code == 200
    events, done = _sse(resp.text)
    assert done
    assert prov.trace == ["chat:1", "exec:submit_reading_brief"]

    # 没有凭空冒出来的文案
    assert _sse_text(events) == ""

    # 没话就没话：落库的两条 assistant 都只有调用、没有正文，没有替它编的台词；
    # 抽牌调用照常停在末尾（前端据此显示抽牌按钮）
    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "reading"
    assistants = [m for m in saved.messages if m.role == MessageRole.ASSISTANT and m.tool_calls]
    assert [m.tool_calls[0].name for m in assistants] == ["submit_reading_brief", "draw_tarot_cards"]
    assert all(m.content == "" for m in assistants)


@pytest.mark.parametrize("session_type,endpoint", ROUTES)
def test_model_line_streams_through_untouched(env, monkeypatch, session_type, endpoint):
    """模型说了话 —— 原样流式输出，并和交单调用落在同一条 assistant 上。说话那一半的锁。"""
    conv = _seed_conversation(
        "opening", _greeting_and_user("他上周开始冷淡了"), session_type=session_type
    )
    _install_gemini(
        monkeypatch, [[_text_call(TRANSITION, "submit_reading_brief", BRIEF_ARGS)]]
    )

    resp = env.post(endpoint, json={
        "conversation_id": conv.conversation_id,
        "content": "我是不是该主动一点？",
    })
    events, _ = _sse(resp.text)
    assert _sse_text(events) == TRANSITION
    saved = _get_conversation(conv.conversation_id)
    said = next(m for m in saved.messages if m.tool_calls and m.tool_calls[0].name == "submit_reading_brief")
    assert said.content == TRANSITION
    assert saved.messages[-1].tool_calls[0].name == "draw_tarot_cards"


# ---------------------------------------------------------------------------
# 1b. 澄清轮（开场幕的正常路径）：不交单，只回一个叙事性问题
# ---------------------------------------------------------------------------

def test_opening_clarifying_turn_stays_in_opening_and_persists_reply(env, monkeypatch):
    """前置 Agent 不交单、只追问一句 → 留在开场相位，回复照常落库，绝不误翻相位。

    这是追问预算的**正常路径**（守卫尚未触发）。
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
    assert tool_names(prov.sessions[0].tools) == [
        "submit_reading_brief", "request_user_profile"]
    assert prov.sessions[0].force_tool is None

    # —— 追问正常流式吐给用户，且没有任何工具事件外泄 ——
    assert _sse_text(events) == question
    assert all(set(e) == {"content"} for e in events)
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

    assert tool_names(prov2.sessions[0].tools) == [
        "submit_reading_brief", "request_user_profile"]
    system_text = prov2.sessions[0].system
    assert "关系上下文" in system_text          # 开场幕提示词（含关系块）
    assert "本场起手" not in system_text        # 而不是解读相位那份
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
                   {"spread_type": "single", "positions": ["今日指引"]}),
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

    # 工具集是完整解读工具集（含抽牌；不含交单——起手单是一次性记录）
    from services.llm import tools
    assert tool_names(prov.sessions[0].tools) == tools.READING_TOOL_NAMES
    assert "draw_tarot_cards" in tools.READING_TOOL_NAMES
    assert prov.sessions[0].force_tool is None  # 解读相位绝不带强制交单守卫

    assert done
    # 抽牌调用落在末尾，等用户抽
    assert _get_conversation(conv.conversation_id).messages[-1].tool_calls[0].name == "draw_tarot_cards"

    # 相位/策略单不因一次普通解读而改变
    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "reading"
    assert saved.strategy is None


# ---------------------------------------------------------------------------
# 3. 移交后的历史必须完整（尤其是用户最后一句澄清回答）
# ---------------------------------------------------------------------------

def test_handoff_preserves_full_history_including_last_user_message(env, monkeypatch):
    """用户最后一句必须原样进入解读 Agent 的历史 —— 开场 Agent 这一轮没回他，那句话还悬着。

    移交后的 session 看到的就是落库的历史：之前的对话、用户最后那句、开场 Agent 交单的
    那一轮。待发的是交单的结果——和它下一次请求从库里读到的完全一样，不另造移交指令。
    """
    last_user_line = "上周三他突然不回我消息了，我是不是该主动一点？"
    conv = _seed_conversation("opening", _greeting_and_user("我想问事业"),
                              session_type=SessionType.ASTROLOGY)

    scripts = [
        [_call("submit_reading_brief", BRIEF_ASTRO)],
        [_text(TRANSITION)],
    ]
    prov = _install_gemini(monkeypatch, scripts)

    resp = env.post("/api/astrology/message", json={
        "conversation_id": conv.conversation_id,
        "content": last_user_line,
    })
    assert resp.status_code == 200

    handoff = prov.sessions[1]
    history_text = "\n".join(m.get("content", "") for m in handoff.history)

    # 之前的对话一句不少，用户最后那句也在
    assert "我想问事业" in history_text
    assert "坐吧，阿岚。今天想聊些什么？" in history_text
    assert last_user_line in history_text
    # 历史以交单调用收尾，待发的是它的结果（id 对得上）
    assert handoff.history[-1]["tool_calls"][0]["name"] == "submit_reading_brief"
    assert handoff.sent[0][:3] == ("tool", "submit_reading_brief", {"success": True})
    assert handoff.sent[0][3] == handoff.history[-1]["tool_calls"][0]["id"]
    # 策略单已注入解读 Agent 的系统提示词
    assert "本场起手" in handoff.system and "我这两年的事业格局" in handoff.system

    # 落库：用户那句 → 交单调用 → 交单结果 → 解读 Agent 的回复
    saved = _get_conversation(conv.conversation_id)
    assert [m.role for m in saved.messages[-4:]] == [
        MessageRole.USER, MessageRole.ASSISTANT, MessageRole.TOOL, MessageRole.ASSISTANT]
    assert saved.messages[-1].content == TRANSITION


def test_handoff_history_has_no_two_consecutive_user_turns(env, monkeypatch):
    """移交后角色必须交替，且不靠任何补进去的占位发言。"""
    last_user_line = "上周三他突然不回我消息了"
    conv = _seed_conversation("opening", _greeting_and_user("我想问事业"),
                              session_type=SessionType.ASTROLOGY)

    scripts = [
        [_call("submit_reading_brief", BRIEF_ASTRO)],
        [_text(TRANSITION)],
    ]
    prov = _install_gemini(monkeypatch, scripts)

    resp = env.post("/api/astrology/message", json={
        "conversation_id": conv.conversation_id, "content": last_user_line,
    })
    assert resp.status_code == 200

    history = prov.sessions[1].history
    roles = [m["role"] for m in history]

    # 1) history 内部无连续两个 user
    assert not any(a == b == "user" for a, b in zip(roles, roles[1:])), roles
    # 2) history 以 assistant（交单调用）收尾，紧接着发的是它的结果
    assert roles[-1] == "assistant", roles
    # 3) assistant 轮全是真实发生过的：两句追问 + 交单那一轮（无正文）
    assert [m["content"] for m in history if m["role"] == "assistant"] == [
        "坐吧，阿岚。今天想聊些什么？", "嗯，再说说。", ""]


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
    conv = _seed_conversation("opening", history, session_type=SessionType.ASTROLOGY)

    scripts = [
        # 守卫上膛后，模型在解码层已无法输出纯文本 —— 只能交单
        # 走星盘路线，这样移交后的解读 session 会被开出来，能一并验它没被守卫污染
        [_call("submit_reading_brief", BRIEF_ASTRO)],
        [_text(TRANSITION)],
    ]
    prov = _install_gemini(monkeypatch, scripts)

    resp = env.post("/api/astrology/message", json={
        "conversation_id": conv.conversation_id,
        "content": "还是说不上来",
    })
    assert resp.status_code == 200

    # —— 核心断言：守卫真的到达了 provider（不是只在 service 里算了个 bool） ——
    assert prov.sessions[0].force_tool == "submit_reading_brief"
    # 允许的函数必须真在本轮工具集里，否则 mode=ANY 指名一个不存在的函数 = API 报错
    assert "submit_reading_brief" in tool_names(prov.sessions[0].tools)

    # —— 移交后的解读 session 绝不能继续带着守卫（否则解读 Agent 也被逼着只能交单） ——
    assert prov.sessions[1].force_tool is None
    assert "draw_tarot_cards" in tool_names(prov.sessions[1].tools)

    # —— 守卫达成了它的目的：本轮收到策略单，会话离开开场幕 ——
    saved = _get_conversation(conv.conversation_id)
    assert saved.phase == "reading"
    assert saved.strategy == BRIEF_ASTRO


def test_forced_brief_speaks_for_the_model_before_the_drawer(env, monkeypatch):
    """守卫上膛（mode=ANY）+ 塔罗路线 → 抽牌器前面补一句。

    这是整条链路上唯一需要 harness 代言的地方：force 上膛时模型在解码层只能输出
    函数调用，一个字也发不出来 —— 那个沉默不是它的选择。别的路径一律不补。
    """
    import config

    history = _greeting_and_user(
        *[f"不知道欸{i}" for i in range(config.OPENING_FORCE_BRIEF_AFTER_USER_MSGS - 1)]
    )
    conv = _seed_conversation("opening", history)
    prov = _install_gemini(monkeypatch, [[_call("submit_reading_brief", BRIEF_ARGS)]])

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": "还是说不上来",
    })
    assert resp.status_code == 200
    events, done = _sse(resp.text)
    assert done

    # 守卫确实上膛了（否则这个测试测的是别的东西）
    assert prov.sessions[0].force_tool == "submit_reading_brief"

    # 代言的那句话流式推给用户，并和抽牌调用落在同一条 assistant 上
    assert _sse_text(events) == context_service.forced_brief_handoff_line()
    saved = _get_conversation(conv.conversation_id)
    assert saved.messages[-1].role == MessageRole.ASSISTANT
    assert saved.messages[-1].content == context_service.forced_brief_handoff_line()
    assert saved.messages[-1].tool_calls[0].name == "draw_tarot_cards"


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


# ---------------------------------------------------------------------------
# 7. 张数完全由 positions 决定——没有单独的张数字段可以和它对不上
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("positions", [
    pytest.param(["今日指引"], id="1张"),
    pytest.param(["现状", "阻碍", "流向"], id="3张"),
    pytest.param(["现状", "A 的走向", "A 的代价", "B 的走向", "B 的代价"], id="5张"),
    pytest.param([f"第{i}位" for i in range(1, 11)], id="10张·凯尔特十字"),
])
def test_any_number_of_positions_survives_the_whole_round_trip(env, monkeypatch, positions):
    """起手单写几个位置，前端就收到几个位置，抽牌就抽几张。

    这里锁的是「一个事实只有一份」：牌阵由位置定义，张数是它的长度。曾经张数是独立
    字段，模型填 5 张却只给 3 个位置时，前端会画出 5 个槽位配「位置4 / 位置5」，
    落库之后每次重放历史还会按位置索引越界 —— 那条路现在从数据形状上就不存在了。
    """
    from services.tarot_service import TarotService
    from models import DrawCardsRequest

    conv = _seed_conversation("opening", _greeting_and_user("想问问这件事"))
    brief = {"question": "他还会回头吗", "route": "tarot",
             "spread_type": "custom", "positions": positions}
    _install_gemini(monkeypatch, [[_call("submit_reading_brief", brief)]])

    resp = env.post("/api/tarot/message", json={
        "conversation_id": conv.conversation_id,
        "content": "上周三他突然不回我消息了",
    })
    assert resp.status_code == 200

    # 落库的抽牌调用（前端据此画槽位）= 起手单里的位置，逐字一致
    draw = _get_conversation(conv.conversation_id).messages[-1].tool_calls[0]
    assert draw.name == "draw_tarot_cards"
    assert draw.args["positions"] == positions

    # 真正抽牌时张数也随之而来，不需要任何地方再声明一次
    cards = TarotService.draw_cards(DrawCardsRequest(**draw.args))
    assert len(cards) == len(positions)

    # 落库的起手单同样只有位置
    saved = _get_conversation(conv.conversation_id)
    assert saved.strategy["positions"] == positions
    assert "card_count" not in saved.strategy


# ---------------------------------------------------------------------------
# 8. 空消息只在「开场那一次」有意义
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("session_type,endpoint", ROUTES)
def test_empty_content_after_the_greeting_is_rejected(env, monkeypatch, session_type, endpoint):
    """开场白已经给过之后再收到空 content —— 这个请求不成立，直接 400。

    放它过去的后果两个 router 各不相同（一边往对话里塞空的用户气泡、一边把 None 发给
    模型），因为空 content 本来就是「请开场」的暗号，不是一条消息。前端只在新建会话后
    发一次，正常流程走不到这里。
    """
    conv = _seed_conversation("reading", _greeting_and_user(), session_type=session_type)
    prov = _install_gemini(monkeypatch, [[_text("不该被调用")]])

    resp = env.post(endpoint, json={"conversation_id": conv.conversation_id, "content": ""})

    assert resp.status_code == 400
    assert prov.sessions == []          # 一次模型调用都不该发生

    # 对话原样不动：没有空消息落库
    saved = _get_conversation(conv.conversation_id)
    assert [m.content for m in saved.messages] == [m.content for m in conv.messages]
