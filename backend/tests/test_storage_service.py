"""StorageService（SQLite）往返测试。

全程指向临时库（monkeypatch services.db.DB_FILE），绝不触碰 backend/data/*。
每个测试用一次 asyncio.run 跑完整场景：显式 init_db 后置 _initialized=True，
跳过模块级 init 锁，规避 py3.9 下锁跨事件循环的坑。
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    User, UserType, UserProfile,
    Conversation, Message, MessageRole, SessionType,
    TarotCard, DrawCardsRequest,
)


@pytest.fixture
def StorageService(tmp_path, monkeypatch):
    import services.db as db_mod
    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True  # 后续 get_db 不再走 init 锁

    asyncio.run(_init())
    from services.storage_service import StorageService as S
    return S


def _run(coro):
    return asyncio.run(coro)


def test_user_roundtrip_guest_and_registered(StorageService):
    guest = User(
        user_id="guest_abc", user_type=UserType.GUEST,
        profile=UserProfile(nickname="路人", birth_year=1990, birth_city="北京"),
    )
    reg = User(
        user_id="user_xyz", user_type=UserType.REGISTERED,
        username="alice", password_hash="hash123",
    )

    async def scenario():
        await StorageService.save_user(guest)
        await StorageService.save_user(reg)
        assert await StorageService.get_user("guest_abc") == guest
        assert await StorageService.get_user("user_xyz") == reg
        assert await StorageService.get_user_by_username("alice") == reg
        assert await StorageService.get_user_by_username("nope") is None
        assert await StorageService.get_user("missing") is None

    _run(scenario())


def test_user_upsert_overwrites(StorageService):
    async def scenario():
        u = User(user_id="u1", user_type=UserType.GUEST)
        await StorageService.save_user(u)
        u.user_type = UserType.REGISTERED
        u.username = "bob"
        await StorageService.save_user(u)
        got = await StorageService.get_user("u1")
        assert got.user_type == UserType.REGISTERED
        assert got.username == "bob"
        assert await StorageService.get_user_by_username("bob") == got

    _run(scenario())


def test_conversation_roundtrip_with_messages(StorageService):
    conv = Conversation(
        conversation_id="conv_1", user_id="u1", session_type=SessionType.TAROT,
        title="塔罗占卜",
        messages=[
            Message(role=MessageRole.USER, content="我的感情会怎样？"),
            Message(
                role=MessageRole.ASSISTANT, content="抽到了恋人正位。",
                tarot_cards=[TarotCard(card_id=6, card_name="恋人 (The Lovers)", reversed=False)],
                draw_request=DrawCardsRequest(spread_type="single", card_count=1),
            ),
        ],
        has_drawn_cards=True,
    )

    async def scenario():
        await StorageService.save_conversation(conv)
        got = await StorageService.get_conversation("conv_1")
        assert got == conv  # 全字段深比较，含嵌套 messages / tarot_cards
        assert len(got.messages) == 2
        assert got.messages[1].tarot_cards[0].card_name == "恋人 (The Lovers)"
        assert await StorageService.get_conversation("missing") is None

    _run(scenario())


def test_list_user_conversations_sorted_and_isolated(StorageService):
    async def scenario():
        a = Conversation(conversation_id="a", user_id="u1",
                         session_type=SessionType.CHAT, updated_at="2026-06-01T00:00:00")
        b = Conversation(conversation_id="b", user_id="u1",
                         session_type=SessionType.CHAT, updated_at="2026-06-23T00:00:00")
        other = Conversation(conversation_id="c", user_id="u2",
                             session_type=SessionType.CHAT, updated_at="2026-06-10T00:00:00")
        for c in (a, b, other):
            await StorageService.save_conversation(c)

        u1 = await StorageService.get_user_conversations("u1")
        assert [c.conversation_id for c in u1] == ["b", "a"]  # updated_at 倒序
        u2 = await StorageService.get_user_conversations("u2")
        assert [c.conversation_id for c in u2] == ["c"]  # 用户间隔离

    _run(scenario())


def test_deletes(StorageService):
    async def scenario():
        await StorageService.save_user(User(user_id="u1", user_type=UserType.GUEST))
        for cid in ("x", "y", "z"):
            await StorageService.save_conversation(
                Conversation(conversation_id=cid, user_id="u1",
                             session_type=SessionType.DAILY))
        await StorageService.save_conversation(
            Conversation(conversation_id="keep", user_id="u2",
                         session_type=SessionType.DAILY))

        await StorageService.delete_conversation("x")
        assert await StorageService.get_conversation("x") is None
        assert len(await StorageService.get_user_conversations("u1")) == 2

        await StorageService.delete_user_conversations("u1")
        assert await StorageService.get_user_conversations("u1") == []
        # 不误删他人
        assert await StorageService.get_conversation("keep") is not None

        await StorageService.delete_user("u1")
        assert await StorageService.get_user("u1") is None

    _run(scenario())
