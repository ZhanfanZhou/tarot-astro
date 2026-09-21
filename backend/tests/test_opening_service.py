"""开场白生成与开场上下文拼装。"""
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


# ---------------------------------------------------------------------------
# prepare_opening_context：两个 router 的开场上下文拼装（相位 + 关系块）
# 收归一处 —— 此前塔罗/占星各有一份逐字复制，任何一边改漏都是静默分裂。
# ---------------------------------------------------------------------------

def test_prepare_context_in_opening_phase_returns_relationship_block(db_env):
    """开场相位：<称呼与来访次数> 非空，且昵称走 _nickname（不再由 router 内联第三份）。"""
    from services import opening_service

    conv = _conv(phase="opening", user_msgs=1)
    phase, block = asyncio.run(
        opening_service.prepare_opening_context(conv, _user("小夏"))
    )

    assert phase == "opening"
    assert block != ""
    assert "小夏" in block


def test_prepare_context_falls_back_to_default_nickname(db_env):
    """无资料的游客：昵称兜底为「朋友」，与 _nickname 单一实现保持一致。"""
    from services import opening_service

    phase, block = asyncio.run(
        opening_service.prepare_opening_context(_conv(phase="opening"), None)
    )

    assert phase == "opening"
    assert "朋友" in block


def test_prepare_context_in_reading_phase_returns_empty_block(db_env):
    """解读相位：不查库、不拼关系块 —— 存量会话完全不受开场幕影响。"""
    from services import opening_service

    conv = _conv(phase="reading", strategy={"user_goal": "求认同"}, user_msgs=9)
    phase, block = asyncio.run(
        opening_service.prepare_opening_context(conv, _user())
    )

    assert phase == "reading"
    assert block == ""


def test_greeting_raises_when_llm_fails(db_env):
    """LLM 挂了就是挂了——抛给调用方，不发假问候。

    开场白之后那一轮 Agent Loop 用的是同一个 provider，保底文案只会让用户认真
    打完一个问题再撞同一堵墙。
    """
    from services import opening_service

    async def boom(*args, **kwargs):
        raise RuntimeError("gemini down")

    with patch.object(opening_service, "_generate_greeting_via_llm", side_effect=boom):
        with pytest.raises(opening_service.GreetingUnavailable):
            asyncio.run(
                opening_service.build_greeting(
                    user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
                )
            )


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

        def open_session(self, *args, **kwargs):
            # 开场白这一轮不开 session —— 也就谈不上带任何工具
            raise AssertionError("开场白不该开 session")

    with patch("services.llm.get_provider", return_value=_FakeProvider()) as get_provider:
        text = asyncio.run(opening_service._generate_greeting_via_llm("PROMPT"))

    get_provider.assert_called_once_with("opening")
    assert text == "坐吧。"
    assert captured["timeout"] == config.OPENING_GREETING_TIMEOUT_SECONDS
    assert 0 < config.OPENING_GREETING_TIMEOUT_SECONDS <= 15  # 首屏等待，不能设成一分钟


def test_greeting_raises_on_timeout(db_env):
    """超时同样抛错 —— 建会话接口据此返回 503，让用户重试。"""
    from google.api_core import exceptions as gexc

    from services import opening_service

    async def timeout(*args, **kwargs):
        raise gexc.DeadlineExceeded("504 Deadline Exceeded")

    with patch.object(opening_service, "_generate_greeting_via_llm", side_effect=timeout):
        with pytest.raises(opening_service.GreetingUnavailable):
            asyncio.run(
                opening_service.build_greeting(
                    user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
                )
            )


def test_greeting_rejects_empty_llm_output(db_env):
    """模型返回空串 → 视为失败，抛错（而不是拿模板顶上）。"""
    from services import opening_service

    with patch.object(
        opening_service, "_generate_greeting_via_llm",
        new=AsyncMock(return_value="   "),
    ):
        with pytest.raises(opening_service.GreetingUnavailable):
            asyncio.run(
                opening_service.build_greeting(
                    user=_user(), conversation=_conv(), session_type=SessionType.TAROT,
                )
            )
