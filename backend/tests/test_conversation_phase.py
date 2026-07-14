"""会话相位状态位：新建初值、存量会话默认值、往返持久化。

全程临时库（monkeypatch services.db.DB_FILE），绝不触碰 backend/data/*。
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Conversation, SessionType  # noqa: E402


@pytest.fixture
def db_env(tmp_path, monkeypatch):
    import services.db as db_mod
    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True

    asyncio.run(_init())
    return db_mod


def test_tarot_conversation_starts_in_opening_phase(db_env):
    from services.conversation_service import ConversationService

    conv = asyncio.run(
        ConversationService.create_conversation("u1", SessionType.TAROT)
    )
    assert conv.phase == "opening"
    assert conv.strategy is None


def test_astrology_conversation_starts_in_opening_phase(db_env):
    from services.conversation_service import ConversationService

    conv = asyncio.run(
        ConversationService.create_conversation("u1", SessionType.ASTROLOGY)
    )
    assert conv.phase == "opening"


def test_daily_conversation_starts_in_reading_phase(db_env):
    """每日一签/闲聊不走前置 Agent。"""
    from services.conversation_service import ConversationService

    for st in (SessionType.DAILY, SessionType.CHAT):
        conv = asyncio.run(ConversationService.create_conversation("u1", st))
        assert conv.phase == "reading", st


def test_opening_phase_sessions_has_single_source_of_truth():
    """相位的唯一权威是 context_service —— conversation_service 不许再存一份。

    两份常量分叉时故障是静默的：会话以 opening 落库、get_phase 却说 reading，
    于是永远不交单。这里不许它长回来。
    """
    from services import context_service
    from services.conversation_service import ConversationService

    assert not hasattr(ConversationService, "OPENING_PHASE_SESSIONS")
    assert context_service.OPENING_PHASE_SESSIONS == {
        SessionType.TAROT, SessionType.ASTROLOGY,
    }


def test_created_phase_agrees_with_get_phase_for_every_session_type(db_env):
    """落库时写的 phase 与 get_phase 的判定必须一致——这正是常量分叉会打破的不变量。"""
    from services import context_service
    from services.conversation_service import ConversationService

    for st in SessionType:
        conv = asyncio.run(ConversationService.create_conversation("u1", st))
        assert context_service.get_phase(conv) == conv.phase, st


def test_legacy_conversation_without_phase_defaults_to_reading():
    """存量会话的 data JSON 没有 phase 字段 → 反序列化补默认值 reading。

    这是本设计的存量迁移方案：默认值即迁移，无回填脚本。
    """
    legacy_json = json.dumps({
        "conversation_id": "conv_old",
        "user_id": "u1",
        "session_type": "tarot",
        "title": "塔罗占卜",
        "messages": [],
    })
    conv = Conversation(**json.loads(legacy_json))
    assert conv.phase == "reading"
    assert conv.strategy is None


def test_phase_and_strategy_roundtrip_through_storage(db_env):
    from services.conversation_service import ConversationService
    from services.storage_service import StorageService

    async def scenario():
        conv = await ConversationService.create_conversation("u1", SessionType.TAROT)
        conv.phase = "reading"
        conv.strategy = {"user_goal": "求认同", "reading_strategy": "验证式"}
        await StorageService.save_conversation(conv)
        return await StorageService.get_conversation(conv.conversation_id)

    loaded = asyncio.run(scenario())
    assert loaded.phase == "reading"
    assert loaded.strategy["user_goal"] == "求认同"
