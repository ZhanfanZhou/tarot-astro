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
        strategy={"question": "他还回来吗"},
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


def test_render_relationship_block_is_facts_only():
    """关系块只出事实：语气指令已搬进 opening_system.md，代码里不再藏文案。"""
    from services import context_service

    new_block = context_service.render_relationship_block(
        {"nickname": "小夏", "visit_count": 1, "days_since_last": None}
    )
    assert "第 1 次" in new_block
    assert "距上次" not in new_block   # 首次来访没有「上次」

    ret_block = context_service.render_relationship_block(
        {"nickname": "小夏", "visit_count": 4, "days_since_last": 11}
    )
    assert "小夏" in ret_block
    assert "第 4 次" in ret_block
    assert "11" in ret_block


# ---------- 策略单渲染 ----------

def test_render_brief_block_none_returns_empty():
    """无策略单（存量会话）→ 空串，解读 Agent 表现同改动前。"""
    from services import context_service

    assert context_service.render_brief_block(None) == ""


def test_render_brief_block_is_heading_plus_fields_only():
    from services import context_service

    block = context_service.render_brief_block({
        "question": "该不该接这个外地的 offer",
        "context": "换城市的 offer，家里反对",
        "route": "tarot",
        "spread_type": "two_choice",
        "positions": ["现状", "选 A 的走向", "选 A 的代价", "选 B 的走向", "选 B 的代价"],
    })
    assert "该不该接这个外地的 offer" in block
    assert "two_choice" in block
    assert "选 A 的代价" in block          # 列表字段要摊平，不能渲染成 python repr
    assert "['" not in block
    # 只有标题和数据行；怎么对待这份记录由 reading_handoff.md 说
    assert block.startswith("\n\n# <本场起手>\n问题：")


def test_render_brief_block_skips_missing_fields():
    from services import context_service

    block = context_service.render_brief_block({"question": "他还回来吗"})
    assert "他还回来吗" in block
    assert "None" not in block


# ---------- 用户画像块 ----------

def _portrait(**fields):
    from services.notebook_service import empty_portrait, merge_portrait

    return merge_portrait(empty_portrait(), fields, "2026-09-10T14:20:00")


def test_render_portrait_block_lists_only_the_items_that_have_been_written():
    """写过的项带日期列出来；空项一行都不占——空骨架对模型没有用处，只占篇幅。"""
    from services import context_service

    block = context_service.render_portrait_block(_portrait(preferences="希望话说直一点。"))
    assert block == "# <用户画像>\n交流偏好（2026-09-10 记）：希望话说直一点。"
    assert "生活近况" not in block
    assert "confirmed_at" not in block and "text" not in block   # 不是把 JSON 倒进去


def test_render_portrait_block_puts_multiline_items_on_their_own_lines():
    """人与事常是分条写的：第二条起顶格就看不出还属于这一项。"""
    from services import context_service

    block = context_service.render_portrait_block(
        _portrait(people_and_events="- 男友在杭州\n- 团队年后有调整"))
    assert "近期的人与事（2026-09-10 记）：\n- 男友在杭州\n- 团队年后有调整" in block


def test_render_portrait_block_empty_portrait_says_so_in_one_line():
    """一项都没写过也照样出这一块：模型要知道「还没有画像」是正常状态，不是这块没渲染。"""
    from services.notebook_service import empty_portrait
    from services import context_service

    block = context_service.render_portrait_block(empty_portrait())
    assert block.splitlines() == ["# <用户画像>", "还没有形成印象。"]


def test_build_portrait_context_guest_has_no_portrait():
    """游客没有笔记本，画像块整个不出现（连同它的使用须知）。"""
    from models import User, UserType
    from services import context_service

    assert context_service.build_portrait_context(
        User(user_id="g", user_type=UserType.GUEST)) == ""
    assert context_service.build_portrait_context(None) == ""


def test_build_portrait_context_reads_the_saved_portrait(tmp_path, monkeypatch):
    from models import User, UserType
    from services import context_service
    from services.notebook_service import notebook_service

    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)
    notebook_service._save_portrait("u1", _portrait(recent="在上海做设计"))

    block = context_service.build_portrait_context(
        User(user_id="u1", user_type=UserType.REGISTERED))
    assert "生活近况（2026-09-10 记）：在上海做设计" in block


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
    assert "塔罗" in prompt                        # 入口偏好（route 默认依据）
    assert "预算已用尽" not in prompt              # 未触发守卫


def test_build_opening_prompt_with_force_brief_appends_guard_instruction():
    from services import context_service

    prompt = context_service.build_opening_prompt(
        relationship_block="",
        session_type=SessionType.TAROT,
        force_brief=True,
    )
    assert "预算已用尽" in prompt


@pytest.fixture
def base_prompt(monkeypatch):
    """解读相位的底稿换成固定串，断言只看拼接。"""
    from services import prompt_service

    real = prompt_service.get_prompt
    monkeypatch.setattr(
        prompt_service, "get_prompt",
        lambda name: f"BASE:{name}" if name.endswith("_system.md") else real(name),
    )


def test_build_reading_prompt_without_strategy_is_base_plus_user_context(base_prompt):
    from services import context_service

    prompt = context_service.build_reading_prompt(
        session_type=SessionType.TAROT, user_context="<用户资料>昵称：小夏", strategy=None,
    )
    assert prompt.startswith("BASE:tarot_system.md")
    assert "小夏" in prompt
    assert "本场起手" not in prompt


def test_build_reading_prompt_with_strategy_appends_handoff_constraints(base_prompt):
    """移交后追加接场约束：这一场的开场已经有人做过了，别从头再来一遍。"""
    from services import context_service

    prompt = context_service.build_reading_prompt(
        session_type=SessionType.TAROT, user_context="",
        strategy={"question": "该不该接 offer", "route": "tarot"},
    )
    assert "本场起手" in prompt

    handoff = prompt.split("本场起手", 1)[1]  # 接场约束必须在起手单之后
    assert "接场" in handoff
    assert "不要再欢迎用户" in handoff


def test_reading_prompts_carry_no_opening_phase_instructions():
    """解读提示词只留解读的活：迎接、澄清问题、采集背景与诉求都归开场幕。

    两份提示词各自完整、互不重叠，接场约束才只需要说「接着往下走」，
    而不是去宣告另一份里的哪几条作废。
    """
    from services import prompt_service

    for name in ("tarot_system.md", "astrology_system.md"):
        text = prompt_service.get_prompt(name)
        assert "语气欢迎他" not in text, name        # 迎接
        assert "时间跨度多大" not in text, name      # 填表式澄清
        assert "优先澄清问题" not in text, name      # 问题澄清
        assert "期望，诉求" not in text, name        # 背景与诉求采集


def test_build_reading_prompt_legacy_conversation_has_no_handoff_constraints(base_prompt):
    """存量会话（strategy=None）零影响：不追加任何接场约束，行为与改动前完全一致。"""
    from services import context_service

    prompt = context_service.build_reading_prompt(
        session_type=SessionType.ASTROLOGY, user_context="<用户资料>昵称：小夏", strategy=None,
    )
    assert "接场" not in prompt
    assert "不要再欢迎用户" not in prompt
    assert "submit_reading_brief" not in prompt
    assert prompt == "BASE:astrology_system.md\n\n<用户资料>昵称：小夏"


def test_both_phases_carry_the_portrait_and_its_usage_rules(base_prompt):
    """画像每轮无条件注入，开场和解读都有：接在用户资料后面，后面跟它的使用须知。"""
    from services import context_service

    portrait = context_service.render_portrait_block(_portrait(recent="在上海做设计"))
    prompts = [
        context_service.build_opening_prompt(
            relationship_block="<关系上下文>\n第 4 次", session_type=SessionType.TAROT,
            user_context="\n# <用户资料>\n昵称：小夏", portrait_context=portrait,
        ),
        context_service.build_reading_prompt(
            session_type=SessionType.TAROT, user_context="\n# <用户资料>\n昵称：小夏",
            strategy=None, portrait_context=portrait,
        ),
    ]
    for prompt in prompts:
        assert prompt.index("# <用户资料>") < prompt.index("# <用户画像>")
        usage = prompt.split("# <用户画像>", 1)[1]
        assert "在上海做设计" in usage
        assert "不是这个人此刻的事实" in usage      # portrait_usage.md：这些是过去的印象
        assert "不要拿它给人下定义" in usage


def test_no_portrait_leaves_both_phases_byte_identical(base_prompt):
    """游客（没有画像块）拼出来的提示词和加这块之前一字不差。"""
    from services import context_service

    assert context_service.build_reading_prompt(
        session_type=SessionType.TAROT, user_context="<用户资料>昵称：小夏",
        strategy=None, portrait_context="",
    ) == "BASE:tarot_system.md\n\n<用户资料>昵称：小夏"

    opening = context_service.build_opening_prompt(
        relationship_block="<关系上下文>\n首次来访", session_type=SessionType.TAROT,
        user_context="\n# <用户资料>\n昵称：小夏", portrait_context="",
    )
    assert "用户画像" not in opening and "画像怎么用" not in opening
