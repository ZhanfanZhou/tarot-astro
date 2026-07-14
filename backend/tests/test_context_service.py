"""context_service：相位判定、关系元数据、策略单渲染、提示词拼装。

关系元数据查库 → 临时库 fixture；其余为纯函数。
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Conversation, Message, MessageRole, SessionType  # noqa: E402


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


# ---------- 相位判定 ----------

def test_phase_opening_for_tarot_with_opening_flag():
    from services import context_service

    conv = Conversation(
        conversation_id="c1", user_id="u1",
        session_type=SessionType.TAROT, phase="opening",
    )
    assert context_service.get_phase(conv) == "opening"


def test_phase_reading_when_strategy_submitted():
    from services import context_service

    conv = Conversation(
        conversation_id="c1", user_id="u1",
        session_type=SessionType.TAROT, phase="reading",
        strategy={"user_goal": "求认同"},
    )
    assert context_service.get_phase(conv) == "reading"


def test_phase_forced_reading_for_daily_even_if_flag_says_opening():
    """session_type 门控：每日一签/闲聊永远不走前置 Agent（防脏数据把它带进开场幕）。"""
    from services import context_service

    for st in (SessionType.DAILY, SessionType.CHAT):
        conv = Conversation(
            conversation_id="c1", user_id="u1", session_type=st, phase="opening",
        )
        assert context_service.get_phase(conv) == "reading", st


def test_phase_legacy_conversation_is_reading():
    from services import context_service

    conv = Conversation(
        conversation_id="c_old", user_id="u1", session_type=SessionType.TAROT,
    )  # 不传 phase → 默认 reading
    assert context_service.get_phase(conv) == "reading"


def test_phase_unknown_garbage_value_degrades_to_reading():
    """脏数据安全降级：phase 是裸 str（不是 Literal），未知值不能让会话卡死在开场幕。"""
    from services import context_service

    conv = Conversation(
        conversation_id="c1", user_id="u1",
        session_type=SessionType.TAROT, phase="garbage",
    )
    assert context_service.get_phase(conv) == "reading"


# ---------- 关系元数据 ----------

def test_relationship_meta_new_user(db_env):
    from services import context_service

    meta = asyncio.run(context_service.build_relationship_meta("u_new", "c1"))
    assert meta["visit_count"] == 1
    assert meta["days_since_last"] is None


def test_relationship_meta_excludes_current_and_empty_conversations(db_env):
    """只有开场白（<=1 条消息）的会话不算一次来访——否则'点开又关'会刷高次数，认人露馅。"""
    from services import context_service
    from services.storage_service import StorageService

    async def scenario():
        real = Conversation(
            conversation_id="c_real", user_id="u1", session_type=SessionType.TAROT,
            updated_at="2026-07-04T00:00:00",
            messages=[
                Message(role=MessageRole.ASSISTANT, content="又来了"),
                Message(role=MessageRole.USER, content="他上周冷淡了"),
            ],
        )
        empty = Conversation(
            conversation_id="c_empty", user_id="u1", session_type=SessionType.TAROT,
            messages=[Message(role=MessageRole.ASSISTANT, content="嗯？")],
        )
        current = Conversation(
            conversation_id="c_now", user_id="u1", session_type=SessionType.TAROT,
        )
        for c in (real, empty, current):
            await StorageService.save_conversation(c)
        return await context_service.build_relationship_meta("u1", "c_now")

    meta = asyncio.run(scenario())
    assert meta["visit_count"] == 2  # 1 次历史真实来访 + 本次
    assert meta["days_since_last"] is not None and meta["days_since_last"] > 0


def test_render_relationship_block_new_vs_returning():
    from services import context_service

    new_block = context_service.render_relationship_block(
        {"nickname": "小夏", "visit_count": 1, "days_since_last": None}
    )
    assert "首次" in new_block

    ret_block = context_service.render_relationship_block(
        {"nickname": "小夏", "visit_count": 4, "days_since_last": 11}
    )
    assert "小夏" in ret_block
    assert "第 4 次" in ret_block
    assert "11" in ret_block
    assert "不主动提及任何旧话题" in ret_block


# ---------- 策略单渲染 ----------

def test_render_brief_block_none_returns_empty():
    """无策略单（存量会话）→ 空串，解读 Agent 表现同改动前。"""
    from services import context_service

    assert context_service.render_brief_block(None) == ""


def test_render_brief_block_includes_fields_and_secrecy_warning():
    from services import context_service

    block = context_service.render_brief_block({
        "question_topic": "感情",
        "user_goal": "求认同",
        "emotional_intensity": "高",
        "context_summary": "上周男友突然冷淡",
        "desired_takeaway": "确认还值不值得等",
        "tool_route": "塔罗优先",
        "suggested_spread": "三张关系阵（现状/他的态度/流向）",
        "reading_strategy": "验证式",
        "pacing": "深",
    })
    assert "求认同" in block
    assert "三张关系阵" in block
    assert "绝不向用户外露" in block


def test_render_brief_block_skips_missing_fields():
    from services import context_service

    block = context_service.render_brief_block({"user_goal": "看清现状"})
    assert "看清现状" in block
    assert "None" not in block


# ---------- 提示词拼装 ----------

def test_build_opening_prompt_contains_prompt_relationship_and_entry():
    from services import context_service

    prompt = context_service.build_opening_prompt(
        relationship_block="<关系上下文>\n首次来访",
        session_type=SessionType.TAROT,
        force_brief=False,
    )
    assert "submit_reading_brief" in prompt      # 来自 opening_system.md
    assert "首次来访" in prompt                    # 关系上下文
    assert "塔罗" in prompt                        # 入口偏好（tool_route 默认依据）
    assert "预算已用尽" not in prompt              # 未触发守卫


def test_build_opening_prompt_with_force_brief_appends_guard_instruction():
    from services import context_service

    prompt = context_service.build_opening_prompt(
        relationship_block="",
        session_type=SessionType.TAROT,
        force_brief=True,
    )
    assert "预算已用尽" in prompt


def test_build_reading_prompt_without_strategy_is_base_plus_user_context():
    from services import context_service

    prompt = context_service.build_reading_prompt(
        base_prompt="BASE", user_context="<用户资料>昵称：小夏", strategy=None,
    )
    assert prompt.startswith("BASE")
    assert "小夏" in prompt
    assert "本场策略单" not in prompt
