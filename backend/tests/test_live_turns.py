"""生成不跟着请求走，失败不扣额度。

锁住：
  1. 一轮对话跑到一半页面走了（观众断开）：这一轮照样跑完、逐条落库、扣额度；
     重新打开这场对话从 /live 接上，先补已经出来的正文，再接着收后面的
  2. 这一轮还在跑时再发一句 → 409；没有在跑的 → /live 204
  3. 模型出错、用户没拿到回复：流里一条 error，不扣额度（/message、/resume、心灵奇旅）
  4. 心灵奇旅写到一半关了卷宗：卷宗标着「正在写」，再要就接上同一份，只写一次、只扣一次
"""
import asyncio
import json
import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    Conversation, Message, MessageRole, SessionType, ToolCallRecord, User, UserProfile, UserType,
)
from services import tool_turns  # noqa: E402

USER_ID = "user_live"


@pytest.fixture
def env(tmp_path, monkeypatch):
    import services.db as db_mod
    import services.rate_limit_service as rl_mod
    import services.daily_service as daily_mod
    from main import app

    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)
    monkeypatch.setattr(rl_mod, "USAGE_FILE", tmp_path / "usage.json")
    monkeypatch.setattr(daily_mod, "DAILY_DRAWS_FILE", tmp_path / "daily_draws.json")

    from services.auth_service import create_access_token
    from services.storage_service import StorageService

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True
        await StorageService.save_user(User(
            user_id=USER_ID, user_type=UserType.REGISTERED, username="live",
            password_hash="x", profile=UserProfile(nickname="阿岚"),
        ))

    asyncio.run(_init())
    client = TestClient(app)
    client.headers.update({"Authorization": f"Bearer {create_access_token(USER_ID, UserType.REGISTERED)}"})
    return client


def _usage() -> int:
    from services.rate_limit_service import get_today_usage
    _, day = get_today_usage()
    return day.get(USER_ID, 0)


def _save(conv_id, messages):
    from services.storage_service import StorageService
    asyncio.run(StorageService.save_conversation(Conversation(
        conversation_id=conv_id, user_id=USER_ID, session_type=SessionType.TAROT,
        phase="reading", messages=messages,
    )))


def _stored(conv_id):
    from services.storage_service import StorageService
    return asyncio.run(StorageService.get_conversation(conv_id)).messages


def _events(body: str):
    return [json.loads(l[6:]) for l in body.splitlines() if l.startswith("data: ") and l != "data: [DONE]"]


async def _drain(response) -> list:
    """把一个 StreamingResponse 的 SSE 读完，解析成事件。"""
    body = "".join([chunk async for chunk in response.body_iterator])
    return _events(body)


def test_turn_keeps_running_after_the_page_goes_away_and_can_be_followed_again(env, monkeypatch):
    from services import gemini_service as gs, live_turns, turn_service
    from routers import conversations
    from services.storage_service import StorageService

    _save("conv_live", [Message(role=MessageRole.ASSISTANT, content="你想问什么？")])
    release = None   # 在 scenario 的事件循环里建

    async def scenario():
        nonlocal release
        release = asyncio.Event()

        async def _two_rounds(self, messages, user, **kwargs):
            # 先说一句、调一个工具，再说完——前半段在页面还在时就落了库
            call = tool_turns.new_call_id("read_divination_notes")
            yield {"content": "我先翻翻你的笔记。"}
            yield {"message": tool_turns.assistant_message(
                "我先翻翻你的笔记。", [ToolCallRecord(id=call, name="read_divination_notes", args={})])}
            await release.wait()
            yield {"content": "看完了，换工作这件事……"}
            yield {"message": tool_turns.assistant_message("看完了，换工作这件事……")}
            yield {"done": True}

        monkeypatch.setattr(gs.GeminiService, "stream_response", _two_rounds)
        user = await StorageService.get_user(USER_ID)

        resp = await turn_service.stream_turn("conv_live", user, "我该换工作吗？")
        it = resp.body_iterator
        first = json.loads((await it.__anext__())[6:])
        second = json.loads((await it.__anext__())[6:])
        await it.aclose()                      # 页面关了：这个观众走了
        await asyncio.sleep(0.05)

        turn = live_turns.running("conv_live")
        try:
            assert turn is not None            # 这一轮还在跑

            # 这一轮没说完，再发一句 → 409
            with pytest.raises(Exception) as exc:
                await turn_service.stream_turn("conv_live", user, "在吗？")
            assert getattr(exc.value, "status_code", None) == 409

            # 重新打开这场对话：接上
            live = await conversations.follow_live("conv_live", current_user=user)
        finally:
            release.set()
        followed = await _drain(live)
        return first, second, followed

    first, second, followed = asyncio.run(scenario())

    # 发起请求的观众：这一轮从第 2 条记录开始（问候 + 用户这句在它之前），收到了第一段
    assert first == {"start": 2}
    assert second == {"content": "我先翻翻你的笔记。"}
    # 接上的观众：同一个起点，已经出来的正文补上，后面的接着收
    assert followed[0] == {"start": 2}
    assert "".join(e.get("content", "") for e in followed) == "我先翻翻你的笔记。看完了，换工作这件事……"
    assert not any("error" in e for e in followed)

    # 照样跑完落库、扣了一次
    assert [m.role for m in _stored("conv_live")] == [
        MessageRole.ASSISTANT, MessageRole.USER, MessageRole.ASSISTANT, MessageRole.ASSISTANT]
    assert _usage() == 1
    # 跑完了：没有在跑的
    assert env.get("/api/conversations/conv_live/live").status_code == 204


def test_follow_needs_the_owner(env):
    _save("conv_idle", [Message(role=MessageRole.ASSISTANT, content="你想问什么？")])
    assert env.get("/api/conversations/conv_idle/live").status_code == 204
    assert env.get("/api/conversations/nope/live").status_code == 404


@pytest.mark.parametrize("path, messages, content", [
    ("/api/tarot/message", [Message(role=MessageRole.ASSISTANT, content="你想问什么？")], "我该换工作吗？"),
    ("/api/tarot/resume", None, None),
])
def test_failed_turn_is_reported_and_not_charged(env, monkeypatch, path, messages, content):
    from services import gemini_service as gs
    from models import DrawCardsRequest, TarotCard

    async def _boom(self, *args, **kwargs):
        yield {"content": "我看看……"}
        raise RuntimeError("provider down")

    monkeypatch.setattr(gs.GeminiService, "stream_response", _boom)
    if messages is None:   # resume：抽完牌，结果已经落库
        draw = ToolCallRecord(id="d1", name="draw_tarot_cards", args={"spread_type": "single", "positions": ["指引"]})
        cards = [TarotCard(card_id=0, card_name="愚者")]
        spread = DrawCardsRequest(spread_type="single", positions=["指引"])
        messages = [Message(role=MessageRole.USER, content="问题"),
                    tool_turns.assistant_message("抽牌看看。", [draw]),
                    tool_turns.tool_message(draw, tool_turns.cards_result(cards, spread),
                                            tarot_cards=cards, draw_request=spread)]
    _save("conv_fail", messages)

    body = {"conversation_id": "conv_fail"} | ({"content": content} if content else {})
    resp = env.post(path, json=body)
    assert resp.status_code == 200
    events = _events(resp.text)
    assert events[-1] == {"error": "占卜师暂时联系不上，请重试"}
    assert _usage() == 0                         # 用户没拿到回复，不算他的


def test_journey_being_written_is_followed_not_written_twice(env, monkeypatch):
    from services import llm
    from services.daily_service import DailyService
    from services.storage_service import StorageService
    from routers import daily

    async def _prompt(*a, **k):
        return "（心灵奇旅提示词）"

    monkeypatch.setattr(DailyService, "build_journey_prompt", _prompt)
    today = date.today().isoformat()

    async def scenario():
        release = asyncio.Event()
        calls = []

        class _Slow:
            async def generate_text(self, prompt, **k):
                calls.append(prompt)
                await release.wait()
                return "你从一张宝剑三出发……"

        monkeypatch.setattr(llm, "get_provider", lambda agent: _Slow())
        user = await StorageService.get_user(USER_ID)

        first = await daily.generate_journey(USER_ID, today, current_user=user)
        await first.body_iterator.aclose()       # 关了卷宗
        listed = await daily.list_journeys(USER_ID, today, current_user=user)
        again = await daily.generate_journey(USER_ID, today, current_user=user)   # 再打开：接上
        release.set()
        followed = await _drain(again)
        after = await daily.list_journeys(USER_ID, today, current_user=user)
        return calls, listed, followed, after

    calls, listed, followed, after = asyncio.run(scenario())
    assert listed.writing is True
    assert "".join(e.get("content", "") for e in followed) == "你从一张宝剑三出发……"
    assert len(calls) == 1 and _usage() == 1
    assert after.writing is False and [e.text for e in after.entries] == ["你从一张宝剑三出发……"]


def test_failed_journey_is_not_charged(env, monkeypatch):
    from services import llm
    from services.daily_service import DailyService

    async def _prompt(*a, **k):
        return "（心灵奇旅提示词）"

    class _Boom:
        async def generate_text(self, *a, **k):
            raise RuntimeError("provider down")

    monkeypatch.setattr(DailyService, "build_journey_prompt", _prompt)
    monkeypatch.setattr(llm, "get_provider", lambda agent: _Boom())
    today = date.today().isoformat()

    resp = env.post(f"/api/daily/{USER_ID}/journey", params={"date": today})
    assert _events(resp.text)[-1] == {"error": "旅程生成失败，请重试"}
    assert _usage() == 0
    assert env.get(f"/api/daily/{USER_ID}/journeys", params={"date": today}).json()["entries"] == []
