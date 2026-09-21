"""删除对话：

  · 没接着聊过的每日一签不能删；用户发过言就是普通对话，可以删，那天的日运记录照样留着
  · 删掉的对话如果写过占卜笔记，那一条跟着删，同一个人别的笔记不动
  · 用户在里面说过话的，挪进归档表（后台管理还看得到）；一句没说过的直接删掉

走真实 HTTP + 临时库 + 临时日运文件 + 临时笔记本目录；LLM 换成替身。
"""
import asyncio
import json
import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    Conversation, Message, MessageRole, SessionType, TarotCard, User, UserProfile, UserType,
)
from services.notebook_service import notebook_service  # noqa: E402

USER_ID = "user_delete"


@pytest.fixture
def env(tmp_path, monkeypatch):
    import services.db as db_mod
    import services.rate_limit_service as rl_mod
    import services.daily_service as daily_mod
    from main import app

    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)
    monkeypatch.setattr(rl_mod, "USAGE_FILE", tmp_path / "usage.json")
    monkeypatch.setattr(daily_mod, "DAILY_DRAWS_FILE", tmp_path / "daily_draws.json")
    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)

    from services.auth_service import create_access_token
    from services.storage_service import StorageService

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True
        await StorageService.save_user(User(
            user_id=USER_ID, user_type=UserType.REGISTERED, username="d",
            password_hash="x", profile=UserProfile(nickname="阿岚"),
        ))

    asyncio.run(_init())
    client = TestClient(app)
    client.headers.update({"Authorization": f"Bearer {create_access_token(USER_ID, UserType.REGISTERED)}"})
    return client


class _Provider:
    async def generate_text(self, prompt, *, temperature=1.0, max_tokens=None, timeout=8):
        return "星星在今夜为你点灯。"


def _draw_daily(env, monkeypatch) -> str:
    from services import llm
    monkeypatch.setattr(llm, "get_provider", lambda agent: _Provider())
    today = date.today().isoformat()
    return env.post(f"/api/daily/{USER_ID}/draw", json={"effective_date": today}).json()["conversation_id"]


def _say(conv_id: str, text: str):
    from services.conversation_service import ConversationService
    asyncio.run(ConversationService.append_message(conv_id, Message(role=MessageRole.USER, content=text)))


def _save_tarot(conv_id: str):
    from services.storage_service import StorageService
    asyncio.run(StorageService.save_conversation(Conversation(
        conversation_id=conv_id, user_id=USER_ID, session_type=SessionType.TAROT,
        has_drawn_cards=True,
        messages=[Message(role=MessageRole.TOOL, content="{}", tool_call_id="c1",
                          tarot_cards=[TarotCard(card_id=0, card_name="愚者")])],
    )))


def _write_notes(*conv_ids: str):
    notes = [{"conversation_id": c, "start_time": "2026-09-20T10:00:00", "summary": f"{c} 的笔记"}
             for c in conv_ids]
    (notebook_service.NOTEBOOK_DIR / f"note_{USER_ID}.log").write_text(
        json.dumps(notes, ensure_ascii=False), encoding="utf-8")


def test_daily_conversation_cannot_be_deleted_until_continued(env, monkeypatch):
    conv_id = _draw_daily(env, monkeypatch)

    resp = env.delete(f"/api/conversations/{conv_id}")
    assert resp.status_code == 400
    assert env.get(f"/api/conversations/{conv_id}").status_code == 200   # 还在

    _say(conv_id, "今天确实有点累")   # 接着聊了：成了普通对话
    assert env.delete(f"/api/conversations/{conv_id}").status_code == 200
    assert env.get(f"/api/conversations/{conv_id}").status_code == 404

    # 那天的日运记录留着：日历上还有这张牌，只是对话不在了
    today = date.today().isoformat()
    day = env.get(f"/api/daily/{USER_ID}/overview", params={"date": today}).json()["history"][-1]
    assert day["record"]["conversation_id"] == conv_id
    assert day["conversation_exists"] is False


def test_deleting_a_conversation_deletes_its_note(env):
    _save_tarot("conv_gone")
    _save_tarot("conv_kept")
    _write_notes("conv_gone", "conv_kept")

    assert env.delete("/api/conversations/conv_gone").status_code == 200
    assert [n["conversation_id"] for n in notebook_service.get_notes(USER_ID)] == ["conv_kept"]


def test_deleting_a_conversation_without_a_note_leaves_the_notebook_alone(env):
    _save_tarot("conv_gone")
    _write_notes("conv_kept")
    before = (notebook_service.NOTEBOOK_DIR / f"note_{USER_ID}.log").read_text(encoding="utf-8")

    assert env.delete("/api/conversations/conv_gone").status_code == 200
    assert (notebook_service.NOTEBOOK_DIR / f"note_{USER_ID}.log").read_text(encoding="utf-8") == before


def _save(conv_id: str, messages):
    from services.storage_service import StorageService
    asyncio.run(StorageService.save_conversation(Conversation(
        conversation_id=conv_id, user_id=USER_ID, session_type=SessionType.TAROT, messages=messages,
    )))


def _archived(conv_id: str):
    from services.storage_service import StorageService
    return asyncio.run(StorageService.get_archived_conversation(conv_id))


def test_a_conversation_the_user_spoke_in_is_archived_not_erased(env):
    """用户那边：查不到、列表里也没有；归档表里原样留着，带归档时间。"""
    _save("conv_talked", [Message(role=MessageRole.ASSISTANT, content="来了。坐吧。"),
                          Message(role=MessageRole.USER, content="想问问工作")])

    assert env.delete("/api/conversations/conv_talked").status_code == 200
    assert env.get("/api/conversations/conv_talked").status_code == 404
    assert "conv_talked" not in [c["conversation_id"] for c in env.get(f"/api/conversations/user/{USER_ID}").json()]

    conversation, archived_at = _archived("conv_talked")
    assert [m.content for m in conversation.messages] == ["来了。坐吧。", "想问问工作"]
    assert archived_at


def test_a_conversation_the_user_never_spoke_in_is_erased(env):
    _save("conv_silent", [Message(role=MessageRole.ASSISTANT, content="来了。坐吧。")])

    assert env.delete("/api/conversations/conv_silent").status_code == 200
    assert env.get("/api/conversations/conv_silent").status_code == 404
    assert _archived("conv_silent") is None


def test_guest_permanent_delete_archives_what_they_spoke_in(env):
    """游客退出选「永久删除」：人删掉；对话按同一条规则——说过话的进归档，没说过的直接删。
    别人的对话不动。"""
    from services.auth_service import create_access_token
    from services.storage_service import StorageService

    guest_id = "guest_leaving"
    asyncio.run(StorageService.save_user(User(user_id=guest_id, user_type=UserType.GUEST)))
    for conv_id, messages in (
        ("guest_talked", [Message(role=MessageRole.USER, content="最近好累")]),
        ("guest_silent", [Message(role=MessageRole.ASSISTANT, content="来了。坐吧。")]),
    ):
        asyncio.run(StorageService.save_conversation(Conversation(
            conversation_id=conv_id, user_id=guest_id, session_type=SessionType.TAROT, messages=messages,
        )))
    _save("someone_else", [Message(role=MessageRole.USER, content="想问问工作")])

    headers = {"Authorization": f"Bearer {create_access_token(guest_id, UserType.GUEST)}"}
    assert env.delete(f"/api/users/{guest_id}", headers=headers).status_code == 200

    assert asyncio.run(StorageService.get_user(guest_id)) is None
    assert asyncio.run(StorageService.get_user_conversations(guest_id)) == []
    assert _archived("guest_talked") is not None
    assert _archived("guest_silent") is None
    assert asyncio.run(StorageService.get_conversation("someone_else")) is not None
