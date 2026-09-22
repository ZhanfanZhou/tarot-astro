"""点赞 / 点踩：只写 message_feedback 表，会话记录一个字节不动；后台详情与列表带标记，
归档的会话照样看得到。存储指向 tmp_path 临时库，不碰 backend/data/。"""
import asyncio
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Conversation, Message, MessageRole, SessionType, User, UserType  # noqa: E402
from services.auth_service import create_access_token  # noqa: E402
from services.storage_service import StorageService  # noqa: E402

ADMIN_PW = "test-admin-pw"
CID = "conv_fb"


@pytest.fixture
def client(tmp_path, monkeypatch):
    import config
    import services.db as db_mod
    from main import app  # 先于 asyncio.run 导入，理由见 test_admin_router

    monkeypatch.setattr(config, "ADMIN_PASSWORD", ADMIN_PW)
    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)

    async def _seed():
        await db_mod.init_db()
        db_mod._initialized = True
        for uid in ("owner", "stranger"):
            await StorageService.save_user(User(user_id=uid, user_type=UserType.REGISTERED, username=uid))
        await StorageService.save_conversation(Conversation(
            conversation_id=CID, user_id="owner", session_type=SessionType.TAROT,
            messages=[
                Message(role=MessageRole.ASSISTANT, content="开场白", timestamp="2026-09-22T01:00:00"),
                Message(role=MessageRole.USER, content="我想问工作", timestamp="2026-09-22T01:01:00"),
                Message(role=MessageRole.ASSISTANT, content="", timestamp="2026-09-22T01:02:00",
                        tool_calls=[{"id": "t1", "name": "draw_tarot_cards", "args": {}}]),
                Message(role=MessageRole.TOOL, content="{}", timestamp="2026-09-22T01:03:00",
                        tool_call_id="t1", tool_name="draw_tarot_cards"),
                Message(role=MessageRole.ASSISTANT, content="牌面解读", timestamp="2026-09-22T01:04:00"),
            ],
        ))

    asyncio.run(_seed())
    return TestClient(app)


def _h(user_id="owner") -> dict:
    return {"Authorization": f"Bearer {create_access_token(user_id, UserType.REGISTERED)}"}


def _admin(client) -> dict:
    token = client.post("/api/admin/login", json={"password": ADMIN_PW}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _put(client, idx, ts, rating, who="owner"):
    return client.put(f"/api/conversations/{CID}/feedback", headers=_h(who),
                      json={"message_index": idx, "message_timestamp": ts, "rating": rating})


def _raw_conversation_row(tmp_db: Path) -> str:
    with sqlite3.connect(tmp_db) as con:
        return con.execute("SELECT data FROM conversations WHERE conversation_id=?", (CID,)).fetchone()[0]


class TestUserSide:
    def test_up_switch_cancel_roundtrip(self, client):
        assert client.get(f"/api/conversations/{CID}/feedback", headers=_h()).json() == {"feedback": {}}
        assert _put(client, 4, "2026-09-22T01:04:00", "up").status_code == 200
        assert _put(client, 0, "2026-09-22T01:00:00", "down").status_code == 200
        assert client.get(f"/api/conversations/{CID}/feedback", headers=_h()).json() == {
            "feedback": {"0": "down", "4": "up"}}
        assert _put(client, 4, "2026-09-22T01:04:00", "down").status_code == 200   # 改主意
        assert _put(client, 0, "2026-09-22T01:00:00", None).status_code == 200     # 取消
        assert client.get(f"/api/conversations/{CID}/feedback", headers=_h()).json() == {
            "feedback": {"4": "down"}}

    def test_conversation_record_is_untouched(self, client, tmp_path):
        before = _raw_conversation_row(tmp_path / "test.db")
        _put(client, 4, "2026-09-22T01:04:00", "up")
        _put(client, 0, "2026-09-22T01:00:00", "down")
        _put(client, 0, "2026-09-22T01:00:00", None)
        assert _raw_conversation_row(tmp_path / "test.db") == before
        conv = client.get(f"/api/conversations/{CID}", headers=_h()).json()
        assert "feedback" not in conv and all("feedback" not in m for m in conv["messages"])

    def test_saving_the_conversation_keeps_feedback(self, client):
        """一轮跑完落库（整行覆盖会话）不会冲掉评价，评价也不会冲掉新落的消息。"""
        conv = asyncio.run(StorageService.get_conversation(CID))
        _put(client, 4, "2026-09-22T01:04:00", "up")
        conv.messages.append(Message(role=MessageRole.USER, content="再问一句"))
        asyncio.run(StorageService.save_conversation(conv))
        assert len(asyncio.run(StorageService.get_conversation(CID)).messages) == 6
        assert asyncio.run(StorageService.get_conversation_feedback(CID)) == {4: "up"}

    @pytest.mark.parametrize("idx, ts, status", [
        (1, "2026-09-22T01:01:00", 400),   # 用户自己的发言
        (2, "2026-09-22T01:02:00", 400),   # 只有工具调用、没正文
        (3, "2026-09-22T01:03:00", 400),   # 工具结果
        (9, "2026-09-22T01:04:00", 409),   # 下标越界
        (-1, "2026-09-22T01:04:00", 409),
        (4, "2026-09-22T09:99:99", 409),   # 时间戳对不上
    ])
    def test_rejects_non_replies_and_mismatches(self, client, idx, ts, status):
        assert _put(client, idx, ts, "up").status_code == status
        assert asyncio.run(StorageService.get_conversation_feedback(CID)) == {}

    def test_bad_rating_422(self, client):
        assert _put(client, 4, "2026-09-22T01:04:00", "meh").status_code == 422

    def test_only_owner(self, client):
        assert _put(client, 4, "2026-09-22T01:04:00", "up", who="stranger").status_code == 403
        assert client.get(f"/api/conversations/{CID}/feedback", headers=_h("stranger")).status_code == 403
        assert client.put("/api/conversations/nope/feedback", headers=_h(),
                          json={"message_index": 0, "message_timestamp": "x"}).status_code == 404


class TestAdminSide:
    def test_detail_and_list_carry_marks(self, client):
        _put(client, 4, "2026-09-22T01:04:00", "up")
        _put(client, 0, "2026-09-22T01:00:00", "down")
        h = _admin(client)
        d = client.get(f"/api/admin/conversations/{CID}", headers=h).json()
        assert d["feedback"] == {"0": "down", "4": "up"}
        item = client.get("/api/admin/conversations", headers=h).json()["items"][0]
        assert (item["feedback_up"], item["feedback_down"]) == (1, 1)

    def test_archived_conversation_keeps_marks(self, client):
        _put(client, 4, "2026-09-22T01:04:00", "down")
        asyncio.run(StorageService.archive_conversation(CID))
        h = _admin(client)
        d = client.get(f"/api/admin/conversations/{CID}", headers=h).json()
        assert d["archived_at"] and d["feedback"] == {"4": "down"}
        item = client.get("/api/admin/conversations", headers=h).json()["items"][0]
        assert item["archived_at"] and (item["feedback_up"], item["feedback_down"]) == (0, 1)

    def test_no_feedback_is_empty_not_missing(self, client):
        h = _admin(client)
        assert client.get(f"/api/admin/conversations/{CID}", headers=h).json()["feedback"] == {}
        item = client.get("/api/admin/conversations", headers=h).json()["items"][0]
        assert (item["feedback_up"], item["feedback_down"]) == (0, 0)


def test_existing_db_gains_the_table_without_touching_data(tmp_path, monkeypatch):
    """线上库是旧表结构：启动建表只多出 message_feedback，原有会话照常读写。"""
    import services.db as db_mod
    db_file = tmp_path / "old.db"
    old_schema = db_mod._SCHEMA.split("-- 用户给占卜师")[0]
    assert "message_feedback" not in old_schema
    conv = Conversation(conversation_id=CID, user_id="owner", session_type=SessionType.TAROT,
                        messages=[Message(role=MessageRole.ASSISTANT, content="旧回复")])
    with sqlite3.connect(db_file) as con:
        con.executescript(old_schema)
        con.execute("INSERT INTO conversations VALUES(?,?,?,?)",
                    (CID, "owner", conv.updated_at, conv.model_dump_json()))
    before = _raw_conversation_row(db_file)

    monkeypatch.setattr(db_mod, "DB_FILE", db_file)
    monkeypatch.setattr(db_mod, "_initialized", False)

    async def _run():
        loaded = await StorageService.get_conversation(CID)       # 触发 init_db
        assert loaded.messages[0].content == "旧回复"
        assert await StorageService.get_conversation_feedback(CID) == {}
        await StorageService.set_message_feedback(CID, 0, loaded.messages[0].timestamp, "owner", "up")
        items, _ = await StorageService.list_conversations_admin()
        assert items[0]["feedback_up"] == 1

    asyncio.run(_run())
    assert _raw_conversation_row(db_file) == before
