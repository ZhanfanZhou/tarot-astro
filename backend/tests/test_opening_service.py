"""开场白生成（含降级）与三层守卫的判定逻辑。"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

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
