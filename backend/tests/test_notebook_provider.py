"""记忆 Agent（notebook）走 MEMORY provider，而非直接建 genai.GenerativeModel。

全程 mock services.llm.get_provider，绝不发真实请求、绝不碰 backend/data/。
"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Conversation, Message, MessageRole, SessionType  # noqa: E402


def _conv():
    return Conversation(
        conversation_id="c1",
        user_id="u1",
        session_type=SessionType.TAROT,
        messages=[
            Message(role=MessageRole.USER, content="我最近感情不顺"),
            Message(role=MessageRole.ASSISTANT, content="我看到了愚者。"),
        ],
    )


class _FakeProvider:
    def __init__(self, return_value):
        self._return_value = return_value
        self.generate_json = AsyncMock(return_value=return_value)


def test_generate_summary_uses_memory_provider():
    from services.notebook_service import notebook_service

    fake_provider = _FakeProvider('{"summary":"测试摘要","cards_drawn":["愚者"]}')

    with patch("services.llm.get_provider", return_value=fake_provider) as get_provider:
        summary, cards_drawn = asyncio.run(
            notebook_service.generate_summary(_conv(), user=None)
        )

    get_provider.assert_called_once_with("memory")
    fake_provider.generate_json.assert_awaited_once()
    assert summary == "测试摘要"
    assert cards_drawn == ["愚者"]


def test_generate_summary_falls_back_when_provider_fails():
    """降级兜底行为保留：provider 抛异常 → 返回默认摘要 + 空牌列表，不向上抛。"""
    from services.notebook_service import notebook_service

    fake_provider = _FakeProvider("")
    fake_provider.generate_json = AsyncMock(side_effect=RuntimeError("provider down"))

    with patch("services.llm.get_provider", return_value=fake_provider):
        summary, cards_drawn = asyncio.run(
            notebook_service.generate_summary(_conv(), user=None)
        )

    assert cards_drawn == []
    assert summary != ""


def test_generate_summary_falls_back_on_invalid_json():
    """provider 返回非法 JSON → 走同一条降级兜底路径。"""
    from services.notebook_service import notebook_service

    fake_provider = _FakeProvider("不是 JSON")

    with patch("services.llm.get_provider", return_value=fake_provider):
        summary, cards_drawn = asyncio.run(
            notebook_service.generate_summary(_conv(), user=None)
        )

    assert cards_drawn == []
    assert summary != ""
