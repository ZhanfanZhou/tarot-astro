"""开场白也是一次真实 LLM 调用 —— 必须计入每日额度。

回归的洞：开场白分支曾在 check_and_consume 之前 return，于是
「建会话（不限流）→ 发空消息拿开场白」可以无限循环白嫖 Gemini。

锁住两条：
  1. 开场白请求会消耗一次额度（且非开场白路径不重复扣，一次请求只扣一次）
  2. 额度耗尽时开场白请求被 429 拒绝，且一个 LLM 调用都不发出去
"""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    Conversation, Message, MessageRole, SessionType, User, UserType, UserProfile,
)

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


def _seed_fresh_conversation(conversation_id: str, session_type=SessionType.TAROT) -> str:
    """全新会话（零消息）→ 命中开场白分支。"""
    from services.storage_service import StorageService

    asyncio.run(StorageService.save_conversation(Conversation(
        conversation_id=conversation_id,
        user_id=USER_ID,
        session_type=session_type,
        phase="opening",
    )))
    return conversation_id


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

@pytest.mark.parametrize("path,session_type", [
    ("/api/tarot/message", SessionType.TAROT),
    ("/api/astrology/message", SessionType.ASTROLOGY),
])
def test_greeting_consumes_one_quota(env, monkeypatch, path, session_type):
    calls = _stub_greeting_llm(monkeypatch)
    conv_id = _seed_fresh_conversation(f"conv_greet_{session_type.value}", session_type)

    resp = env.post(path, json={"conversation_id": conv_id, "content": ""})

    assert resp.status_code == 200
    assert len(calls) == 1                 # 确实发生了 LLM 调用
    assert _usage(env) == 1                # 且被计费


def test_greeting_rejected_when_quota_exhausted_without_llm_call(env, monkeypatch):
    """额度耗尽 → 429，且一次 LLM 调用都不发（这才是堵住白嫖的关键）。"""
    import services.rate_limit_service as rl_mod

    monkeypatch.setattr(rl_mod, "USER_DAILY_MESSAGE_LIMIT", 1)
    calls = _stub_greeting_llm(monkeypatch)

    first = env.post("/api/tarot/message", json={
        "conversation_id": _seed_fresh_conversation("conv_q1"), "content": "",
    })
    assert first.status_code == 200
    assert len(calls) == 1

    second = env.post("/api/tarot/message", json={
        "conversation_id": _seed_fresh_conversation("conv_q2"), "content": "",
    })
    assert second.status_code == 429
    assert len(calls) == 1                 # 没有第二次 LLM 调用
    assert _usage(env) == 1                # 被拒的请求不计费


# ---------------------------------------------------------------------------
# 2. 非开场白路径不能被重复扣费（限流提前后的回归防线）
# ---------------------------------------------------------------------------

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
