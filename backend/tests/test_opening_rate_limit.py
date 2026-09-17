"""开场白也是一次真实 LLM 调用 —— 必须计入每日额度。

开场白在 POST /api/conversations 里生成，所以计费也在那里。这个接口曾经完全不限流
（那时开场白还挂在 /message 的空 content 分支上），现在它会打 LLM，必须扣额度，
否则「反复建会话」就是无限白嫖。

锁住三条：
  1. 建塔罗/占星会话会消耗一次额度，且开场白落成第一条消息
  2. 额度耗尽时建会话被 429 拒绝，且一个 LLM 调用都不发出去
  3. 无开场幕的会话类型（每日一签/闲聊）不打 LLM、不扣额度
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    Conversation, DrawCardsRequest, Message, MessageRole, SessionType, TarotCard,
    ToolCallRecord, User, UserType, UserProfile,
)
from services import tool_turns  # noqa: E402

_DRAW = ToolCallRecord(id="draw-1", name="draw_tarot_cards",
                       args={"spread_type": "single", "positions": ["指引"]})
_CARDS = [TarotCard(card_name="愚者", card_id=0, reversed=False)]
_SPREAD = DrawCardsRequest(spread_type="single", positions=["指引"])


def _drawn_pair(text="我们抽牌看看。"):
    return [
        tool_turns.assistant_message(text, [_DRAW]),
        tool_turns.tool_message(_DRAW, tool_turns.cards_result(_CARDS, _SPREAD),
                                tarot_cards=_CARDS, draw_request=_SPREAD),
    ]

USER_ID = "user_rl"


@pytest.fixture
def env(tmp_path, monkeypatch):
    import services.db as db_mod
    import services.rate_limit_service as rl_mod
    from main import app  # 先导入 main（早于 asyncio.run），见 test_opening_handoff_e2e

    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)
    monkeypatch.setattr(rl_mod, "USAGE_FILE", tmp_path / "usage.json")

    from services.auth_service import create_access_token
    from services.storage_service import StorageService

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True
        await StorageService.save_user(User(
            user_id=USER_ID,
            user_type=UserType.REGISTERED,
            username="rl",
            password_hash="x",
            profile=UserProfile(nickname="阿岚"),
        ))

    asyncio.run(_init())

    client = TestClient(app)
    token = create_access_token(USER_ID, UserType.REGISTERED)
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


def _stub_greeting_llm(monkeypatch):
    """替换开场白的 LLM 调用，记录被调用次数（零真实 Gemini 请求）。"""
    from services import opening_service as op_mod

    calls = []

    async def _fake(prompt):
        calls.append(prompt)
        return "坐吧，阿岚。今天想聊些什么？"

    monkeypatch.setattr(op_mod, "_generate_greeting_via_llm", _fake)
    return calls


def _usage(env_client) -> int:
    from services.rate_limit_service import get_today_usage

    _, day = get_today_usage()
    return day.get(USER_ID, 0)


# ---------------------------------------------------------------------------
# 1. 开场白计费
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("session_type", [SessionType.TAROT, SessionType.ASTROLOGY])
def test_create_conversation_generates_greeting_and_consumes_one_quota(
    env, monkeypatch, session_type
):
    calls = _stub_greeting_llm(monkeypatch)

    resp = env.post("/api/conversations", json={"session_type": session_type.value})

    assert resp.status_code == 200
    body = resp.json()
    # 开场白随创建响应一起回来，客户端不必再发一条消息去换它
    assert [m["role"] for m in body["messages"]] == ["assistant"]
    assert body["messages"][0]["content"] == "坐吧，阿岚。今天想聊些什么？"
    assert len(calls) == 1                 # 确实发生了 LLM 调用
    assert _usage(env) == 1                # 且被计费


def test_create_conversation_rejected_when_quota_exhausted_without_llm_call(env, monkeypatch):
    """额度耗尽 → 429，且一次 LLM 调用都不发（这才是堵住白嫖的关键）。"""
    import services.rate_limit_service as rl_mod

    monkeypatch.setattr(rl_mod, "USER_DAILY_MESSAGE_LIMIT", 1)
    calls = _stub_greeting_llm(monkeypatch)

    first = env.post("/api/conversations", json={"session_type": "tarot"})
    assert first.status_code == 200
    assert len(calls) == 1

    second = env.post("/api/conversations", json={"session_type": "tarot"})
    assert second.status_code == 429
    assert len(calls) == 1                 # 没有第二次 LLM 调用
    assert _usage(env) == 1                # 被拒的请求不计费


@pytest.mark.parametrize("session_type", ["daily", "chat"])
def test_create_conversation_without_opening_phase_is_free(env, monkeypatch, session_type):
    """每日一签/闲聊没有开场幕：不打 LLM，也就不该扣额度。"""
    calls = _stub_greeting_llm(monkeypatch)

    resp = env.post("/api/conversations", json={"session_type": session_type})

    assert resp.status_code == 200
    assert resp.json()["messages"] == []
    assert calls == []
    assert _usage(env) == 0


def test_greeting_failure_returns_503_not_a_canned_line(env, monkeypatch):
    """provider 挂了 → 503 让用户重试，绝不塞一句假问候把会话开起来。"""
    from services import opening_service as op_mod

    async def _boom(prompt):
        raise RuntimeError("gemini down")

    monkeypatch.setattr(op_mod, "_generate_greeting_via_llm", _boom)

    resp = env.post("/api/conversations", json={"session_type": "tarot"})
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# 2. 非开场白路径不能被重复扣费（限流提前后的回归防线）
# ---------------------------------------------------------------------------

def test_empty_content_message_is_rejected(env, monkeypatch):
    """空 content 不再是「请开场」的暗号，就是一条无效请求。"""
    from services.storage_service import StorageService

    asyncio.run(StorageService.save_conversation(Conversation(
        conversation_id="conv_empty", user_id=USER_ID,
        session_type=SessionType.TAROT, phase="opening",
    )))

    resp = env.post("/api/tarot/message", json={
        "conversation_id": "conv_empty", "content": "   ",
    })
    assert resp.status_code == 400
    assert _usage(env) == 0  # 请求不成立，不计费


def test_normal_message_consumes_exactly_one_quota(env, monkeypatch):
    from services import gemini_service as gs
    from services.storage_service import StorageService

    async def _fake_stream(self, *args, **kwargs):
        yield {"content": "好的。"}
        yield {"done": True}

    monkeypatch.setattr(gs.GeminiService, "stream_response", _fake_stream)

    asyncio.run(StorageService.save_conversation(Conversation(
        conversation_id="conv_normal", user_id=USER_ID,
        session_type=SessionType.TAROT, phase="reading",
        messages=[Message(role=MessageRole.ASSISTANT, content="你想问什么？")],
    )))

    resp = env.post("/api/tarot/message", json={
        "conversation_id": "conv_normal", "content": "我该换工作吗？",
    })
    assert resp.status_code == 200
    assert _usage(env) == 1  # 一次请求只扣一次


# ---------------------------------------------------------------------------
# 3. resume：用户在界面上做完了动作，不是一条发言
# ---------------------------------------------------------------------------

def _stub_stream(monkeypatch, text):
    from services import gemini_service as gs

    async def _fake_stream(self, *args, **kwargs):
        yield {"content": text}
        yield {"message": tool_turns.assistant_message(text)}
        yield {"done": True}

    monkeypatch.setattr(gs.GeminiService, "stream_response", _fake_stream)


def _save(conv_id, messages, session_type=SessionType.TAROT):
    from services.storage_service import StorageService
    asyncio.run(StorageService.save_conversation(Conversation(
        conversation_id=conv_id, user_id=USER_ID, session_type=session_type,
        phase="reading", messages=messages,
    )))


def _roles(conv_id):
    from services.storage_service import StorageService
    return [m.role for m in asyncio.run(StorageService.get_conversation(conv_id)).messages]


def test_resume_after_draw_runs_a_turn_without_writing_a_user_message(env, monkeypatch):
    """抽完牌请模型接着跑 —— 不产生用户消息，也就没有气泡要藏。"""
    _stub_stream(monkeypatch, "愚者提醒你……")
    _save("conv_resume", [Message(role=MessageRole.USER, content="我该不该接这个 offer"), *_drawn_pair()])

    resp = env.post("/api/tarot/resume", json={"conversation_id": "conv_resume"})
    assert resp.status_code == 200
    assert "\\u611a\\u8005" in resp.text   # SSE 里是 JSON 转义的「愚者」

    assert _roles("conv_resume") == [
        MessageRole.USER, MessageRole.ASSISTANT, MessageRole.TOOL, MessageRole.ASSISTANT]
    assert _usage(env) == 1  # resume 也是一次 LLM 调用，照常计费


def test_draw_records_the_result_of_the_pending_call(env):
    """/draw 把真牌写成那次 draw_tarot_cards 调用的结果，id 对上。"""
    _save("conv_draw", [Message(role=MessageRole.USER, content="问题"),
                        tool_turns.assistant_message("抽牌看看。", [_DRAW])])

    resp = env.post("/api/tarot/draw", params={"conversation_id": "conv_draw"},
                    json={"spread_type": "single", "positions": ["指引"]})
    assert resp.status_code == 200

    from services.storage_service import StorageService
    conv = asyncio.run(StorageService.get_conversation("conv_draw"))
    tail = conv.messages[-1]
    assert tail.role == MessageRole.TOOL and tail.tool_call_id == "draw-1"
    assert len(tail.tarot_cards) == 1
    assert conv.has_drawn_cards
    # 牌只有一份，在 TOOL 记录上
    assert len([m for m in conv.messages if m.tarot_cards]) == 1


def test_draw_without_a_pending_call_is_rejected(env):
    _save("conv_nodraw", [Message(role=MessageRole.USER, content="问题"),
                          Message(role=MessageRole.ASSISTANT, content="坐吧。")])
    resp = env.post("/api/tarot/draw", params={"conversation_id": "conv_nodraw"},
                    json={"spread_type": "single", "positions": ["指引"]})
    assert resp.status_code == 409


def test_resume_after_profile_writes_the_profile_as_the_result(env, monkeypatch):
    """填完资料 → resume：服务端从用户当前 profile 写 request_user_profile 的结果，
    模型接着自己调 get_astrology_chart（工具描述就是这么写的），前端不替它取盘。"""
    _stub_stream(monkeypatch, "好，我看看你的盘。")
    ask = ToolCallRecord(id="p1", name="request_user_profile", args={"required_fields": ["birth_time"]})
    _save("conv_profile", [Message(role=MessageRole.USER, content="看看我的本命盘"),
                           tool_turns.assistant_message("先告诉我出生时间。", [ask])],
          session_type=SessionType.ASTROLOGY)

    resp = env.post("/api/astrology/resume", json={"conversation_id": "conv_profile"})
    assert resp.status_code == 200

    from services.storage_service import StorageService
    conv = asyncio.run(StorageService.get_conversation("conv_profile"))
    assert [m.role for m in conv.messages] == [
        MessageRole.USER, MessageRole.ASSISTANT, MessageRole.TOOL, MessageRole.ASSISTANT]
    result = conv.messages[2]
    assert result.tool_call_id == "p1"
    assert json.loads(result.content) == {"success": True, "profile": {"nickname": "阿岚"}}


def test_resume_with_undrawn_cards_is_rejected(env):
    _save("conv_undrawn", [Message(role=MessageRole.USER, content="问题"),
                           tool_turns.assistant_message("抽牌看看。", [_DRAW])])
    resp = env.post("/api/tarot/resume", json={"conversation_id": "conv_undrawn"})
    assert resp.status_code == 400
    assert _usage(env) == 0


def test_message_while_a_call_is_pending_records_the_decline_first(env, monkeypatch):
    """模型要求抽牌，用户没抽、直接打字 → 先把「没抽」记成那次调用的结果，再记用户发言。
    两家 API 都要求每个调用后面跟着结果，历史里不能悬着一次没有结果的调用。"""
    _stub_stream(monkeypatch, "好，那先聊聊。")
    _save("conv_decline", [Message(role=MessageRole.USER, content="问题"),
                           tool_turns.assistant_message("抽牌看看。", [_DRAW])])

    resp = env.post("/api/tarot/message", json={"conversation_id": "conv_decline", "content": "等等，我先想想"})
    assert resp.status_code == 200

    from services.storage_service import StorageService
    conv = asyncio.run(StorageService.get_conversation("conv_decline"))
    assert [m.role for m in conv.messages] == [
        MessageRole.USER, MessageRole.ASSISTANT, MessageRole.TOOL, MessageRole.USER, MessageRole.ASSISTANT]
    declined = json.loads(conv.messages[2].content)
    assert declined["success"] is False and "没有抽牌" in declined["error"]
    assert conv.messages[2].tool_call_id == "draw-1"
    assert conv.messages[3].content == "等等，我先想想"


def test_legacy_conversation_is_read_only(env, monkeypatch):
    """旧格式（SYSTEM 里套着抽牌结果）：/message 与 /resume 都 409，不计费。"""
    _stub_stream(monkeypatch, "不该到这里")
    _save("conv_legacy", [
        Message(role=MessageRole.USER, content="问题"),
        Message(role=MessageRole.SYSTEM, content="用户已完成抽牌", tarot_cards=_CARDS, draw_request=_SPREAD),
        Message(role=MessageRole.USER, content="请根据抽牌结果进行解读"),
        Message(role=MessageRole.ASSISTANT, content="愚者……", tarot_cards=_CARDS),
    ])
    assert env.post("/api/tarot/message", json={"conversation_id": "conv_legacy", "content": "再问"}).status_code == 409
    assert env.post("/api/tarot/resume", json={"conversation_id": "conv_legacy"}).status_code == 409
    assert _usage(env) == 0
    # 仍可查看
    assert env.get("/api/conversations/conv_legacy").status_code == 200
