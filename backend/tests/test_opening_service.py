"""开场白生成（含降级）与三层守卫的判定逻辑。"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
from models import (  # noqa: E402
    Conversation, Message, MessageRole, SessionType, User, UserType, UserProfile,
)


@pytest.fixture
def db_env(tmp_path, monkeypatch):
    """关系元数据要查库 → 指向临时库，绝不触碰 backend/data/app.db。"""
    import services.db as db_mod
    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True

    asyncio.run(_init())
    return db_mod


def _user(nickname="小夏"):
    return User(
        user_id="u1", user_type=UserType.REGISTERED,
        profile=UserProfile(nickname=nickname),
    )


def _conv(phase="opening", strategy=None, user_msgs=0):
    messages = []
    for i in range(user_msgs):
        messages.append(Message(role=MessageRole.USER, content=f"m{i}"))
        messages.append(Message(role=MessageRole.ASSISTANT, content="嗯"))
    return Conversation(
        conversation_id="c1", user_id="u1", session_type=SessionType.TAROT,
        phase=phase, strategy=strategy, messages=messages,
    )


def test_guard_no_force_below_threshold():
    from services import opening_service

    assert opening_service.should_force_brief(_conv(user_msgs=2)) is False


def test_guard_forces_brief_at_threshold():
    """第 2 层：用户消息数 >= 3 且未交单 → 强制交单。"""
    from services import opening_service

    assert opening_service.should_force_brief(_conv(user_msgs=3)) is True


def test_guard_no_force_in_reading_phase():
    from services import opening_service

    conv = _conv(phase="reading", strategy={"user_goal": "求认同"}, user_msgs=9)
    assert opening_service.should_force_brief(conv) is False


def test_hard_exit_triggers_above_hard_threshold():
    """第 3 层：>= 5 条用户消息仍无策略单 → 兜底翻 phase，strategy 保持 None（不伪造）。"""
    from services import opening_service

    assert opening_service.should_hard_exit(_conv(user_msgs=5)) is True
    assert opening_service.should_hard_exit(_conv(user_msgs=4)) is False


# ---------------------------------------------------------------------------
# prepare_opening_context：两个 router 的开场上下文拼装（守卫 + 相位 + 关系块）
# 收归一处 —— 此前塔罗/占星各有一份逐字复制，任何一边改漏都是静默分裂。
# ---------------------------------------------------------------------------

def test_prepare_context_in_opening_phase_returns_relationship_block(db_env):
    """开场相位：关系上下文非空，且昵称走 _nickname（不再由 router 内联第三份）。"""
    from services import opening_service

    conv = _conv(phase="opening", user_msgs=1)
    phase, force_brief, block = asyncio.run(
        opening_service.prepare_opening_context(conv, _user("小夏"))
    )

    assert phase == "opening"
    assert force_brief is False
    assert block != ""
    assert "小夏" in block


def test_prepare_context_falls_back_to_default_nickname(db_env):
    """无资料的游客：昵称兜底为「朋友」，与 _nickname 单一实现保持一致。"""
    from services import opening_service

    phase, _, block = asyncio.run(
        opening_service.prepare_opening_context(_conv(phase="opening"), None)
    )

    assert phase == "opening"
    assert "朋友" in block


def test_prepare_context_in_reading_phase_returns_empty_block(db_env):
    """解读相位：不查库、不拼关系块、不开守卫 —— 存量会话完全不受开场幕影响。"""
    from services import opening_service

    conv = _conv(phase="reading", strategy={"user_goal": "求认同"}, user_msgs=9)
    phase, force_brief, block = asyncio.run(
        opening_service.prepare_opening_context(conv, _user())
    )

    assert phase == "reading"
    assert force_brief is False
    assert block == ""


def test_prepare_context_opens_force_brief_guard_at_threshold(db_env):
    """守卫第 2 层：澄清预算用尽 → force_brief=True，但仍在开场相位（本轮强制交单）。"""
    from services import opening_service

    conv = _conv(phase="opening", user_msgs=config.OPENING_FORCE_BRIEF_AFTER_USER_MSGS)
    phase, force_brief, block = asyncio.run(
        opening_service.prepare_opening_context(conv, _user())
    )

    assert phase == "opening"
    assert force_brief is True
    assert block != ""


def test_prepare_context_hard_exits_and_flips_phase(db_env):
    """守卫第 3 层：超硬上限 → 就地翻相位（落库），本轮即以解读相位返回，绝不卡死。"""
    from services import opening_service
    from services.storage_service import StorageService

    conv = _conv(phase="opening", user_msgs=config.OPENING_HARD_EXIT_AFTER_USER_MSGS)
    asyncio.run(StorageService.save_conversation(conv))

    phase, force_brief, block = asyncio.run(
        opening_service.prepare_opening_context(conv, _user())
    )

    assert phase == "reading"
    assert force_brief is False   # 已不在开场相位，不该再强制交单
    assert block == ""
    # 就地改写 + 落库：router 后续用同一个对象取 strategy
    assert conv.phase == "reading"
    saved = asyncio.run(StorageService.get_conversation(conv.conversation_id))
    assert saved.phase == "reading"
    assert saved.strategy is None  # 兜底不伪造假策略单


def test_greeting_falls_back_to_template_when_llm_fails(db_env):
    """LLM 挂了不能开天窗——降级回硬编码模板（保底不坏）。"""
    from services import opening_service

    async def boom(*args, **kwargs):
        raise RuntimeError("gemini down")

    with patch.object(opening_service, "_generate_greeting_via_llm", side_effect=boom):
        text = asyncio.run(
            opening_service.build_greeting(
                user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
            )
        )
    assert "小夏" in text
    assert len(text) > 0


def test_greeting_uses_llm_output_when_available(db_env):
    from services import opening_service

    with patch.object(
        opening_service, "_generate_greeting_via_llm",
        new=AsyncMock(return_value="又来了。这次是什么事？"),
    ):
        text = asyncio.run(
            opening_service.build_greeting(
                user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
            )
        )
    assert text == "又来了。这次是什么事？"


def test_greeting_llm_call_sets_timeout(db_env):
    """开场白是全 App 的第一印象：Gemini 卡住必须超时抛错，绝不让用户永久转圈。"""
    from services import opening_service

    captured = {}

    class _FakeProvider:
        async def generate_text(self, prompt, **kwargs):
            captured.update(kwargs)
            return "坐吧。"

    with patch("services.llm.get_provider", return_value=_FakeProvider()) as get_provider:
        text = asyncio.run(opening_service._generate_greeting_via_llm("PROMPT"))

    get_provider.assert_called_once_with("opening")
    assert text == "坐吧。"
    assert captured["timeout"] == config.OPENING_GREETING_TIMEOUT_SECONDS
    assert 0 < config.OPENING_GREETING_TIMEOUT_SECONDS <= 15  # 首屏等待，不能设成一分钟


def test_greeting_falls_back_to_template_on_timeout(db_env):
    """超时异常 → 现有 try/except 接住 → 降级模板（用户永远拿得到一句开场白）。"""
    from google.api_core import exceptions as gexc

    from services import opening_service

    async def timeout(*args, **kwargs):
        raise gexc.DeadlineExceeded("504 Deadline Exceeded")

    with patch.object(opening_service, "_generate_greeting_via_llm", side_effect=timeout):
        text = asyncio.run(
            opening_service.build_greeting(
                user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
            )
        )

    assert "小夏" in text
    assert text in [t.format(nickname="小夏") for t in opening_service.FALLBACK_GREETINGS]


def test_greeting_rejects_empty_llm_output(db_env):
    """模型返回空串 → 视为失败，走模板。"""
    from services import opening_service

    with patch.object(
        opening_service, "_generate_greeting_via_llm",
        new=AsyncMock(return_value="   "),
    ):
        text = asyncio.run(
            opening_service.build_greeting(
                user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
            )
        )
    assert text.strip() != ""
    assert "小夏" in text
