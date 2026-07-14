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


def test_relationship_meta_ignores_daily_and_chat_sessions(db_env):
    """每日一签会话不算「来访」——它每天自动建一个（且有 2+ 条消息）。

    不筛 session_type 的话，连续签到 7 天的新用户第一次开塔罗就被渲染成
    「第 8 次来访」，占卜师对陌生人说「又来啦」——正是设计要防的认人露馅。
    """
    from services import context_service
    from services.storage_service import StorageService

    def _msgs():
        return [
            Message(role=MessageRole.ASSISTANT, content="今日签"),
            Message(role=MessageRole.USER, content="什么意思"),
        ]

    async def scenario():
        for i in range(3):
            await StorageService.save_conversation(Conversation(
                conversation_id=f"c_daily_{i}", user_id="u1",
                session_type=SessionType.DAILY, messages=_msgs(),
            ))
        await StorageService.save_conversation(Conversation(
            conversation_id="c_tarot", user_id="u1",
            session_type=SessionType.TAROT, messages=_msgs(),
        ))
        await StorageService.save_conversation(Conversation(
            conversation_id="c_now", user_id="u1", session_type=SessionType.TAROT,
        ))
        return await context_service.build_relationship_meta("u1", "c_now")

    meta = asyncio.run(scenario())
    assert meta["visit_count"] == 2  # 1 次塔罗历史 + 本次；3 个日签会话不算


def test_relationship_meta_counts_astrology_sessions(db_env):
    """塔罗与占星互相算作「来访」——同一个占卜师，跨入口认人。"""
    from services import context_service
    from services.storage_service import StorageService

    async def scenario():
        await StorageService.save_conversation(Conversation(
            conversation_id="c_astro", user_id="u2", session_type=SessionType.ASTROLOGY,
            messages=[
                Message(role=MessageRole.ASSISTANT, content="坐吧"),
                Message(role=MessageRole.USER, content="看看我的星盘"),
            ],
        ))
        await StorageService.save_conversation(Conversation(
            conversation_id="c_now2", user_id="u2", session_type=SessionType.TAROT,
        ))
        return await context_service.build_relationship_meta("u2", "c_now2")

    meta = asyncio.run(scenario())
    assert meta["visit_count"] == 2


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


def test_build_reading_prompt_with_strategy_appends_handoff_constraints():
    """移交后必须压掉基础提示词里「先欢迎用户」「意图模糊则参数化澄清」两条指示。

    tarot_system.md / astrology_system.md 仍在命令「你先用占卜者的语气欢迎他」和
    「如用户说'看下运势'→ 澄清要看哪方面？时间跨度多大？」——开场幕已经把这两件事
    做完了（且后者正是设计要消灭的填表式澄清）。不压掉 = 占卜师二次欢迎、重问旧问题。
    """
    from services import context_service

    prompt = context_service.build_reading_prompt(
        base_prompt="BASE", user_context="",
        strategy={"user_goal": "求认同", "reading_strategy": "验证式"},
    )
    assert "本场策略单" in prompt

    handoff = prompt.split("本场策略单", 1)[1]  # 接场约束必须在策略单之后
    assert "接场" in handoff
    assert "不要再欢迎用户" in handoff
    assert "已失效" in handoff                 # 显式宣告基础提示词的相关指示作废
    assert "时间跨度" in handoff               # 点名要压掉的那条参数化澄清
    assert "submit_reading_brief" in handoff   # 只在彻底换议题时才重新交单


def test_build_reading_prompt_legacy_conversation_has_no_handoff_constraints():
    """存量会话（strategy=None）零影响：不追加任何接场约束，行为与改动前完全一致。"""
    from services import context_service

    prompt = context_service.build_reading_prompt(
        base_prompt="BASE", user_context="<用户资料>昵称：小夏", strategy=None,
    )
    assert "接场" not in prompt
    assert "不要再欢迎用户" not in prompt
    assert "submit_reading_brief" not in prompt
    assert prompt == "BASE\n\n<用户资料>昵称：小夏"
