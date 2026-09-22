"""GET /api/users/{user_id}/quota：前端在用户要对话时查今日额度，用完就提示、禁用输入框。

锁住四条：
  1. 返回 {used, limit}，limit 按身份（游客 / 注册用户）取
  2. 只能查自己的
  3. used 就是扣额度的那份计数：发一句话 +1
  4. 游客转正后同一个 user_id 的上限当场换成注册用户的，已用次数照算——
     前端转正后再查一次，输入框就能按额度解禁
"""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Conversation, Message, MessageRole, SessionType, User, UserType  # noqa: E402

GUEST_ID = "user_quota_guest"
OTHER_ID = "user_quota_other"


@pytest.fixture
def env(tmp_path, monkeypatch):
    import services.db as db_mod
    import services.rate_limit_service as rl_mod
    from main import app

    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)
    monkeypatch.setattr(rl_mod, "USAGE_FILE", tmp_path / "usage.json")
    monkeypatch.setattr(rl_mod, "GUEST_DAILY_MESSAGE_LIMIT", 2)
    monkeypatch.setattr(rl_mod, "USER_DAILY_MESSAGE_LIMIT", 5)

    from services.auth_service import create_access_token
    from services.storage_service import StorageService

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True
        await StorageService.save_user(User(user_id=GUEST_ID, user_type=UserType.GUEST))
        await StorageService.save_user(User(user_id=OTHER_ID, user_type=UserType.GUEST))

    asyncio.run(_init())
    client = TestClient(app)
    client.headers.update({"Authorization": f"Bearer {create_access_token(GUEST_ID, UserType.GUEST)}"})
    return client


def _quota(env):
    resp = env.get(f"/api/users/{GUEST_ID}/quota")
    assert resp.status_code == 200
    return resp.json()


def _send(env, monkeypatch, conv_id="conv_q"):
    from services import gemini_service as gs
    from services.storage_service import StorageService

    async def _fake_stream(self, *args, **kwargs):
        yield {"content": "好的。"}
        yield {"done": True}

    monkeypatch.setattr(gs.GeminiService, "stream_response", _fake_stream)
    asyncio.run(StorageService.save_conversation(Conversation(
        conversation_id=conv_id, user_id=GUEST_ID, session_type=SessionType.TAROT,
        phase="reading", messages=[Message(role=MessageRole.ASSISTANT, content="你想问什么？")],
    )))
    return env.post("/api/tarot/message", json={"conversation_id": conv_id, "content": "我该换工作吗？"})


def test_fresh_guest_has_nothing_used(env):
    assert _quota(env) == {"used": 0, "limit": 2}


def test_only_the_owner_can_read_it(env):
    assert env.get(f"/api/users/{OTHER_ID}/quota").status_code == 403


def test_used_is_the_same_count_messages_consume(env, monkeypatch):
    assert _send(env, monkeypatch).status_code == 200
    assert _quota(env) == {"used": 1, "limit": 2}
    assert _send(env, monkeypatch).status_code == 200
    assert _quota(env) == {"used": 2, "limit": 2}
    assert _send(env, monkeypatch).status_code == 429      # 查到用完，服务端也拒
    assert _quota(env) == {"used": 2, "limit": 2}          # 被拒的不计


def test_converting_raises_the_limit_and_keeps_what_was_used(env, monkeypatch):
    _send(env, monkeypatch)
    _send(env, monkeypatch)
    assert _quota(env) == {"used": 2, "limit": 2}

    resp = env.post("/api/users/convert-guest", json={
        "user_id": GUEST_ID, "username": "quota_conv", "password": "secret1"})
    assert resp.status_code == 200

    assert _quota(env) == {"used": 2, "limit": 5}
    assert _send(env, monkeypatch).status_code == 200      # 转正当天就能接着聊
