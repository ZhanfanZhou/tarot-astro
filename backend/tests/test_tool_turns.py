"""工具轮：调用与结果按官方形状落库、逐条映射重建，interrupt 就地收口。

抽牌是 interrupt 式调用——真牌要等用户在抽牌器上动手，跨两个 HTTP 请求产生。
落库形状：ASSISTANT(tool_calls=[draw]) → TOOL(tool_call_id=同一个 id, 牌)。
重建历史时逐条映射（Gemini functionCall/functionResponse、OpenAI tool_calls/role=tool），
不推断、不伪造任何用户/助手台词。
"""
import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    Conversation, DrawCardsRequest, Message, MessageRole, SessionType, TarotCard,
    ToolCallRecord, User, UserProfile, UserType,
)
from services import tool_turns  # noqa: E402
from services.llm.base import ToolCall, TurnResult  # noqa: E402

FABRICATIONS = ["我看到了", "我明白了", "[抽牌结果]如下", "让我为你解读", "请根据抽牌结果进行解读"]

_CARDS = [
    TarotCard(card_name="愚者", card_id=0, reversed=False),
    TarotCard(card_name="高塔", card_id=16, reversed=True),
]
_SPREAD = DrawCardsRequest(spread_type="two_choice", positions=["现状", "走向"])
_DRAW = ToolCallRecord(id="draw-1", name="draw_tarot_cards",
                       args={"spread_type": "two_choice", "positions": ["现状", "走向"]})


def _drawn_pair(text="我们抽牌看看。"):
    """模型发起抽牌 + 用户抽出的牌，落库的那一对。"""
    return [
        tool_turns.assistant_message(text, [_DRAW]),
        tool_turns.tool_message(_DRAW, tool_turns.cards_result(_CARDS, _SPREAD),
                                tarot_cards=_CARDS, draw_request=_SPREAD),
    ]


def _neutral(messages, session_type=SessionType.TAROT, **kw):
    from services.gemini_service import GeminiService
    _, history, pending = GeminiService()._build_neutral(
        messages, user=None, session_type=session_type, **kw)
    return history, pending


# ── _build_neutral：逐条映射 ──────────────────────────────────────

def test_tool_turns_map_one_to_one():
    history, pending = _neutral([
        Message(role=MessageRole.USER, content="我该不该接这个 offer"),
        *_drawn_pair(),
        Message(role=MessageRole.ASSISTANT, content="愚者说……"),
        Message(role=MessageRole.USER, content="继续"),
    ])
    assert history == [
        {"role": "user", "content": "我该不该接这个 offer"},
        {"role": "assistant", "content": "我们抽牌看看。",
         "tool_calls": [{"id": "draw-1", "name": "draw_tarot_cards",
                         "args": {"spread_type": "two_choice", "positions": ["现状", "走向"]}}]},
        {"role": "tool_result", "id": "draw-1", "name": "draw_tarot_cards",
         "result": {"cards": [
             {"position": "现状", "card": "愚者", "orientation": "正位"},
             {"position": "走向", "card": "高塔", "orientation": "逆位"},
         ]}},
        {"role": "assistant", "content": "愚者说……"},
    ]
    assert pending == ("user", "继续")


def test_history_contains_no_fabricated_turns():
    history, _ = _neutral([
        Message(role=MessageRole.USER, content="问题"),
        *_drawn_pair(),
        Message(role=MessageRole.USER, content="继续"),
    ])
    text = " ".join(m.get("content", "") for m in history)
    for phrase in FABRICATIONS:
        assert phrase not in text, f"伪造台词回流了：{phrase}"


def test_resume_pends_the_tool_result():
    """末尾是工具结果 = resume：本轮发的就是这个结果，不发用户发言。"""
    history, pending = _neutral([
        Message(role=MessageRole.USER, content="问题"),
        *_drawn_pair(),
    ])
    kind, (name, result, call_id) = pending
    assert (kind, name, call_id) == ("tool", "draw_tarot_cards", "draw-1")
    assert result["cards"][0] == {"position": "现状", "card": "愚者", "orientation": "正位"}
    assert history[-1]["tool_calls"][0]["id"] == "draw-1"   # 历史以那次调用收尾


def test_daily_reading_carries_cards_without_a_tool_call():
    """每日一签的解读是服务端直接生成的，牌挂在 assistant 上；历史里没有工具轮。"""
    history, pending = _neutral([
        Message(role=MessageRole.ASSISTANT, content="今天这张牌提醒你……",
                tarot_cards=_CARDS[:1], draw_request=DrawCardsRequest(spread_type="single", positions=["今日指引"])),
        Message(role=MessageRole.USER, content="那我该怎么做？"),
    ], session_type=SessionType.DAILY, system_prompt_override="DAILY-PROMPT（已含今日牌）")
    assert history == [{"role": "assistant", "content": "今天这张牌提醒你……"}]
    assert pending == ("user", "那我该怎么做？")


def test_tail_must_be_user_or_tool_result():
    import pytest
    with pytest.raises(ValueError):
        _neutral([Message(role=MessageRole.ASSISTANT, content="坐吧。")])
    with pytest.raises(ValueError):
        _neutral([])


# ── provider 侧：各自翻成原生形状 ────────────────────────────────

def test_gemini_translates_tool_turns_to_function_parts():
    from services.llm.gemini_provider import _to_history

    out = _to_history([
        {"role": "assistant", "content": "我们抽牌看看。",
         "tool_calls": [{"id": "x", "name": "draw_tarot_cards", "args": {"positions": ["运势"]}}]},
        {"role": "tool_result", "id": "x", "name": "draw_tarot_cards", "result": {"cards": []}},
    ])
    # 话和调用同属一个 model 轮的两个 part
    assert len(out) == 2
    assert out[0]["role"] == "model" and len(out[0]["parts"]) == 2
    assert "我们抽牌看看" in str(out[0]["parts"][0])
    assert "function_call" in str(out[0]["parts"][1])
    assert out[1]["role"] == "user" and "function_response" in str(out[1]["parts"][0])


def test_gemini_generates_an_id_per_function_call():
    """Gemini 的 FunctionCall 没有 id；落库要靠 id 配对，provider 生成一个。"""
    from types import SimpleNamespace
    from services.llm.gemini_provider import _parse

    part = SimpleNamespace(function_call=SimpleNamespace(name="draw_tarot_cards", args={}), text="")
    a = _parse(SimpleNamespace(parts=[part])).tool_calls[0].id
    b = _parse(SimpleNamespace(parts=[part])).tool_calls[0].id
    assert a.startswith("draw_tarot_cards-") and a != b


def test_openai_translates_tool_turns_with_matching_ids():
    from services.llm.openai_provider import OpenAICompatProvider

    with patch("services.llm.openai_provider.AsyncOpenAI"):
        sess = OpenAICompatProvider("m", "http://x", "k").open_session(
            "SYS",
            [
                {"role": "assistant", "content": "抽一张。",
                 "tool_calls": [{"id": "c1", "name": "draw_tarot_cards", "args": {"positions": ["A"]}}]},
                {"role": "tool_result", "id": "c1", "name": "draw_tarot_cards", "result": {"cards": [1]}},
                {"role": "assistant", "content": "再抽一张。",
                 "tool_calls": [{"id": "c2", "name": "draw_tarot_cards", "args": {"positions": ["B"]}}]},
                {"role": "tool_result", "id": "c2", "name": "draw_tarot_cards", "result": {"cards": [2]}},
            ],
            tools=None,
        )
    msgs = sess._messages
    assert msgs[0]["role"] == "system"
    calls = [m for m in msgs if m.get("tool_calls")]
    results = [m for m in msgs if m["role"] == "tool"]
    assert [c["tool_calls"][0]["id"] for c in calls] == ["c1", "c2"]
    assert [r["tool_call_id"] for r in results] == ["c1", "c2"]
    assert json.loads(calls[0]["tool_calls"][0]["function"]["arguments"]) == {"positions": ["A"]}
    assert calls[0]["content"] == "抽一张。"


# ── Agent Loop：调用落库、interrupt 就地收口 ───────────────────────

class _Session:
    def __init__(self, script):
        self._script = list(script)
        self.sent = []

    async def send_user(self, text):
        self.sent.append(("user", text))
        return self._script.pop(0)

    async def send_tool_result(self, name, result, call_id=""):
        self.sent.append(("tool", name, result, call_id))
        return self._script.pop(0)


def _run_loop(messages, script, session_type=SessionType.TAROT, executor=None):
    from services.gemini_service import GeminiService

    session = _Session(script)

    class _Provider:
        def open_session(self, *a, **k):
            return session

    async def _default_executor(name, args):
        return {"success": True}

    async def run():
        events = []
        with patch("services.llm.get_provider", return_value=_Provider()):
            async for ev in GeminiService().stream_response(
                messages, user=None, session_type=session_type,
                function_executor=executor or _default_executor,
            ):
                events.append(ev)
        return events

    return asyncio.run(run()), session


def test_loop_records_the_call_and_interrupts_at_draw():
    events, session = _run_loop(
        [Message(role=MessageRole.USER, content="我该不该接这个 offer")],
        [TurnResult(text="我们抽牌看看。",
                    tool_calls=[ToolCall(name="draw_tarot_cards", id="d1",
                                         args={"spread_type": "single", "positions": ["运势"]})])],
    )
    # 模型说的话照常流式输出；Loop 就地收口
    assert "".join(e["content"] for e in events if "content" in e) == "我们抽牌看看。"
    assert events[-1] == {"done": True}
    # 没有把任何结果喂回模型
    assert [s for s in session.sent if s[0] == "tool"] == []
    # 调用落库：话和调用在同一条 assistant 上
    recorded = [e["message"] for e in events if "message" in e]
    assert len(recorded) == 1
    assert recorded[0].role == MessageRole.ASSISTANT
    assert recorded[0].content == "我们抽牌看看。"
    assert recorded[0].tool_calls[0].id == "d1"


def test_loop_records_in_loop_tool_call_and_result_in_order():
    async def executor(name, args):
        return {"success": True, "data": "太阳落双鱼"}

    events, session = _run_loop(
        [Message(role=MessageRole.USER, content="看看我的本命盘")],
        [TurnResult(tool_calls=[ToolCall(name="get_astrology_chart", id="g1", args={"reason": "本命盘"})]),
         TurnResult(text="你的太阳在双鱼。")],
        session_type=SessionType.ASTROLOGY, executor=executor,
    )
    recorded = [e["message"] for e in events if "message" in e]
    assert [m.role for m in recorded] == [MessageRole.ASSISTANT, MessageRole.TOOL, MessageRole.ASSISTANT]
    assert recorded[0].content == "" and recorded[0].tool_calls[0].name == "get_astrology_chart"
    assert recorded[1].tool_call_id == "g1" and json.loads(recorded[1].content)["data"] == "太阳落双鱼"
    assert recorded[2].content == "你的太阳在双鱼。" and recorded[2].tool_calls is None
    # 喂回模型的结果带着同一个 id
    assert session.sent[1] == ("tool", "get_astrology_chart", {"success": True, "data": "太阳落双鱼"}, "g1")


def test_resume_sends_the_tool_result_not_a_user_turn():
    events, session = _run_loop(
        [Message(role=MessageRole.USER, content="问题"), *_drawn_pair()],
        [TurnResult(text="愚者提醒你……")],
    )
    assert [s[0] for s in session.sent] == ["tool"]
    assert session.sent[0][1] == "draw_tarot_cards" and session.sent[0][3] == "draw-1"
    assert "".join(e["content"] for e in events if "content" in e) == "愚者提醒你……"
    assert events[-1] == {"done": True}


def test_loop_interrupts_at_profile_request():
    events, session = _run_loop(
        [Message(role=MessageRole.USER, content="看看我的本命盘")],
        [TurnResult(text="要看星盘，得先知道你的出生时间。",
                    tool_calls=[ToolCall(name="request_user_profile", id="p1",
                                         args={"required_fields": ["birth_time"]})])],
        session_type=SessionType.ASTROLOGY,
    )
    assert [s[0] for s in session.sent] == ["user"]
    recorded = [e["message"] for e in events if "message" in e]
    assert recorded[-1].tool_calls[0].name == "request_user_profile"
    assert events[-1] == {"done": True}


# ── tool_turns：interrupt 的结果 ──────────────────────────────────

def _conv(messages):
    return Conversation(conversation_id="c", user_id="u", session_type=SessionType.TAROT, messages=messages)


def test_pending_interrupt_is_the_unanswered_call_at_the_tail():
    assert tool_turns.pending_interrupt(_conv([tool_turns.assistant_message("抽牌看看", [_DRAW])])) == _DRAW
    assert tool_turns.pending_interrupt(_conv(_drawn_pair())) is None
    assert tool_turns.pending_interrupt(_conv([Message(role=MessageRole.ASSISTANT, content="坐吧")])) is None
    chart = ToolCallRecord(id="g", name="get_astrology_chart", args={})
    assert tool_turns.pending_interrupt(_conv([tool_turns.assistant_message("", [chart])])) is None


def test_profile_result_reports_what_the_user_filled():
    user = User(user_id="u", user_type=UserType.REGISTERED, profile=UserProfile(
        nickname="阿岚", birth_year=1995, birth_month=3, birth_day=8, birth_hour=7, birth_minute=30))
    assert tool_turns.profile_result(user) == {"success": True, "profile": {
        "nickname": "阿岚", "birth_date": "1995-03-08", "birth_time": "07:30"}}   # 没填城市就不出现
    assert tool_turns.profile_result(None)["success"] is False


def test_declined_result_states_the_fact():
    r = tool_turns.declined_result(_DRAW)
    assert r["success"] is False and "没有抽牌" in r["error"]


def test_legacy_conversations_are_detected_structurally():
    assert tool_turns.is_legacy(_conv([Message(role=MessageRole.SYSTEM, content="用户已完成抽牌")]))
    assert tool_turns.is_legacy(_conv([Message(role=MessageRole.TOOL, content="", tool_name="draw_tarot_cards")]))
    assert not tool_turns.is_legacy(_conv(_drawn_pair()))
    assert not tool_turns.is_legacy(_conv([Message(role=MessageRole.USER, content="纯聊天")]))


# ── 思考模型的推理内容：随带 tool_calls 的 assistant 记录落库，喂回结果时原样传回 ──

def test_reasoning_is_recorded_with_the_call_and_replayed_to_openai_compat():
    async def executor(name, args):
        return {"success": True}

    events, _ = _run_loop(
        [Message(role=MessageRole.USER, content="看看我的本命盘")],
        [TurnResult(reasoning="用户要看盘，先取。",
                    tool_calls=[ToolCall(name="get_astrology_chart", id="g1", args={"reason": "本命盘"})]),
         TurnResult(text="你的太阳在双鱼。", reasoning="解读。")],
        session_type=SessionType.ASTROLOGY, executor=executor,
    )
    recorded = [e["message"] for e in events if "message" in e]
    assert recorded[0].reasoning == "用户要看盘，先取。"     # 带调用的那一轮记下
    assert recorded[2].reasoning is None                     # 纯文本轮不记

    history, _ = _neutral([
        Message(role=MessageRole.USER, content="看看我的本命盘"),
        recorded[0], recorded[1], recorded[2],
        Message(role=MessageRole.USER, content="继续"),
    ], session_type=SessionType.ASTROLOGY)
    assert history[1]["reasoning"] == "用户要看盘，先取。"

    from services.llm.openai_provider import OpenAICompatProvider
    with patch("services.llm.openai_provider.AsyncOpenAI"):
        sess = OpenAICompatProvider("m", "http://x", "k").open_session("SYS", history, tools=None)
    calls = [m for m in sess._messages if m.get("tool_calls")]
    assert calls[0]["reasoning_content"] == "用户要看盘，先取。"
    assert "reasoning_content" not in sess._messages[-1]     # 纯文本 assistant 不带


def test_openai_compat_captures_reasoning_content_from_the_response():
    from types import SimpleNamespace
    from services.llm.openai_provider import _parse

    msg = SimpleNamespace(content=None, reasoning_content="想一想。", tool_calls=[
        SimpleNamespace(id="c1", function=SimpleNamespace(name="draw_tarot_cards", arguments="{}"))])
    r = _parse(msg)
    assert r.reasoning == "想一想。" and r.tool_calls[0].id == "c1"
