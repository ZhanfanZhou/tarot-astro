"""每日一签 / 心灵奇旅：都是单次生成，没有对话历史，也没有用户发言要回。

  · 抽签：服务端抽牌、落记录，立刻返回牌；解读另走 /reading，落成第一条 assistant（牌挂在它上面）
  · 心灵奇旅：整段提示词就是全部输入，一次生成，整段推给前端

两者都不再拿一条编出来的用户发言（「请根据抽牌结果进行解读」「请回望我最近的旅程」）
去触发 Agent Loop。走真实 HTTP + 临时库 + 临时日运文件；LLM 换成替身。
"""
import asyncio
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import MessageRole, User, UserProfile, UserType  # noqa: E402
from services.notebook_service import notebook_service  # noqa: E402

USER_ID = "user_daily"


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
            user_id=USER_ID, user_type=UserType.REGISTERED, username="d",
            password_hash="x", profile=UserProfile(nickname="阿岚"),
        ))

    asyncio.run(_init())
    client = TestClient(app)
    client.headers.update({"Authorization": f"Bearer {create_access_token(USER_ID, UserType.REGISTERED)}"})
    return client


class _Provider:
    def __init__(self, text):
        self.text = text
        self.prompts = []

    async def generate_text(self, prompt, *, temperature=1.0, max_tokens=None, timeout=8):
        self.prompts.append(prompt)
        return self.text


def _install(monkeypatch, text):
    from services import llm
    prov = _Provider(text)
    monkeypatch.setattr(llm, "get_provider", lambda agent: prov)
    return prov


def _usage():
    from services.rate_limit_service import get_today_usage
    _, day = get_today_usage()
    return day.get(USER_ID, 0)


def _draw(env, today):
    """抽签 + 解读，和前端的顺序一样。返回 conversation_id。"""
    conv_id = env.post(f"/api/daily/{USER_ID}/draw", json={"effective_date": today}).json()["conversation_id"]
    assert env.post(f"/api/daily/{USER_ID}/reading", json={"effective_date": today}).status_code == 200
    return conv_id


def test_draw_returns_the_card_before_any_reading(env, monkeypatch):
    """抽签只抽牌、落记录：不调 LLM、不计费，牌立刻返回，前端先翻开。"""
    prov = _install(monkeypatch, "星星在今夜为你点灯。")
    today = date.today().isoformat()

    resp = env.post(f"/api/daily/{USER_ID}/draw", json={"effective_date": today})
    assert resp.status_code == 200
    body = resp.json()
    assert body["record"]["effective_date"] == today
    assert "reading" not in body
    assert prov.prompts == [] and _usage() == 0

    # 记录已经落了，同一天不能再抽；对话建好了，还没有任何记录
    overview = env.get(f"/api/daily/{USER_ID}/overview", params={"date": today}).json()
    assert overview["today_record"]["card"] == body["record"]["card"]
    assert overview["history"][-1]["conversation_exists"] is True
    assert overview["history"][-1]["tagline"] is None
    conv = env.get(f"/api/conversations/{body['conversation_id']}").json()
    assert conv["messages"] == [] and conv["has_drawn_cards"] is True
    assert env.post(f"/api/daily/{USER_ID}/draw", json={"effective_date": today}).status_code == 409


def test_reading_is_generated_and_stored_with_the_card(env, monkeypatch):
    prov = _install(monkeypatch, "星星在今夜为你点灯。它提醒你保持希望。")
    today = date.today().isoformat()
    drawn = env.post(f"/api/daily/{USER_ID}/draw", json={"effective_date": today}).json()

    resp = env.post(f"/api/daily/{USER_ID}/reading", json={"effective_date": today})
    assert resp.status_code == 200
    assert resp.json() == {"reading": "星星在今夜为你点灯。它提醒你保持希望。"}

    # 提示词里带着这张牌；这是唯一一次 LLM 调用，计费一次
    assert len(prov.prompts) == 1
    assert drawn["record"]["card"]["card_name"] in prov.prompts[0]
    assert _usage() == 1

    # 会话：只有一条 assistant，牌挂在它上面；没有 system / user / tool 记录
    conv = env.get(f"/api/conversations/{drawn['conversation_id']}").json()
    assert [m["role"] for m in conv["messages"]] == ["assistant"]
    assert conv["messages"][0]["content"] == "星星在今夜为你点灯。它提醒你保持希望。"
    assert conv["messages"][0]["tarot_cards"] == [drawn["record"]["card"]]

    # 概览里的签语就是解读首句
    overview = env.get(f"/api/daily/{USER_ID}/overview", params={"date": today}).json()
    assert overview["history"][-1]["tagline"] == "星星在今夜为你点灯"

    # 写好了再来要（比如刷新了页面）：直接给写好的那段，不再调模型、不再计费
    again = env.post(f"/api/daily/{USER_ID}/reading", json={"effective_date": today})
    assert again.json() == {"reading": "星星在今夜为你点灯。它提醒你保持希望。"}
    assert len(prov.prompts) == 1 and _usage() == 1


def test_reading_failure_keeps_the_card_and_can_be_retried(env, monkeypatch):
    """生成失败 → 503，对话里什么都不落；牌和记录照旧，再请一次就好。"""
    from services import llm

    class _Boom:
        async def generate_text(self, *a, **k):
            raise RuntimeError("provider down")

    today = date.today().isoformat()
    assert env.post(f"/api/daily/{USER_ID}/reading", json={"effective_date": today}).status_code == 404

    drawn = env.post(f"/api/daily/{USER_ID}/draw", json={"effective_date": today}).json()
    monkeypatch.setattr(llm, "get_provider", lambda agent: _Boom())
    resp = env.post(f"/api/daily/{USER_ID}/reading", json={"effective_date": today})
    assert resp.status_code == 503

    overview = env.get(f"/api/daily/{USER_ID}/overview", params={"date": today}).json()
    assert overview["today_record"]["card"] == drawn["record"]["card"]
    assert env.get(f"/api/conversations/{drawn['conversation_id']}").json()["messages"] == []

    _install(monkeypatch, "星星在今夜为你点灯。")
    assert env.post(f"/api/daily/{USER_ID}/reading", json={"effective_date": today}).json() == {
        "reading": "星星在今夜为你点灯。"}


def test_asking_while_it_is_being_written_waits_for_the_same_one(env, monkeypatch):
    """写的时候页面刷新了，重载后又来要：等正在写的那一份写完一起拿，
    不另起一份——模型只调一次、只计一次费、对话里只有一条解读。"""
    import httpx
    from services import llm
    from main import app

    today = date.today().isoformat()
    conv_id = env.post(f"/api/daily/{USER_ID}/draw", json={"effective_date": today}).json()["conversation_id"]

    class _Slow:
        calls = 0

        async def generate_text(self, *a, **k):
            _Slow.calls += 1
            await asyncio.sleep(0.2)
            return "星星在今夜为你点灯。"

    monkeypatch.setattr(llm, "get_provider", lambda agent: _Slow())

    async def ask_twice():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://test", headers=dict(env.headers)) as c:
            return await asyncio.gather(*(
                c.post(f"/api/daily/{USER_ID}/reading", json={"effective_date": today})
                for _ in range(2)
            ))

    first, second = asyncio.run(ask_twice())
    assert first.json() == second.json() == {"reading": "星星在今夜为你点灯。"}
    assert _Slow.calls == 1 and _usage() == 1
    conv = env.get(f"/api/conversations/{conv_id}").json()
    assert [m["content"] for m in conv["messages"]] == ["星星在今夜为你点灯。"]


def test_followup_chat_in_a_daily_conversation_continues_from_the_reading(env, monkeypatch):
    """抽签之后「继续这段对话」：历史就是那条解读，用户发言是本轮输入，走普通一轮。"""
    from services import gemini_service as gs, tool_turns

    _install(monkeypatch, "今天的星星提醒你保持希望。")
    today = date.today().isoformat()
    conv_id = _draw(env, today)

    seen = {}

    async def _fake_stream(self, messages, user, **kwargs):
        seen["messages"] = list(messages)
        seen["override"] = kwargs.get("system_prompt_override")
        yield {"content": "先别急，星星说……"}
        yield {"message": tool_turns.assistant_message("先别急，星星说……")}
        yield {"done": True}

    monkeypatch.setattr(gs.GeminiService, "stream_response", _fake_stream)

    resp = env.post("/api/tarot/message", json={"conversation_id": conv_id, "content": "那我今天该怎么做？"})
    assert resp.status_code == 200
    assert [m.role for m in seen["messages"]] == [MessageRole.ASSISTANT, MessageRole.USER]
    assert "今日指引" in seen["override"] or "指引牌" in seen["override"]   # 日运提示词，含今日牌

    conv = env.get(f"/api/conversations/{conv_id}").json()
    assert [m["role"] for m in conv["messages"]] == ["assistant", "user", "assistant"]
    assert conv["title"].endswith("每日一签")   # 标题不被用户首句覆盖


def test_journey_is_a_single_generation_pushed_whole(env, monkeypatch):
    from services.daily_service import DailyService

    async def _prompt(*a, **k):
        return "（心灵奇旅提示词）"

    monkeypatch.setattr(DailyService, "build_journey_prompt", _prompt)
    prov = _install(monkeypatch, "你从一张宝剑三出发……")
    today = date.today().isoformat()

    resp = env.post(f"/api/daily/{USER_ID}/journey", params={"date": today})
    assert resp.status_code == 200
    payloads = [json.loads(l[6:]) for l in resp.text.splitlines() if l.startswith("data: ") and l != "data: [DONE]"]
    assert payloads == [{"content": "你从一张宝剑三出发……"}]
    assert prov.prompts == ["（心灵奇旅提示词）"]   # 提示词就是全部输入，没有附加的用户发言
    assert _usage() == 1

    # 同日缓存命中：不再调 LLM、不计费
    resp2 = env.post(f"/api/daily/{USER_ID}/journey", params={"date": today})
    assert resp2.status_code == 200 and len(prov.prompts) == 1 and _usage() == 1


def test_journeys_are_kept_for_reading_back(env, monkeypatch):
    """写过的每一篇都留着可回顾；一天只写一篇，同一天再请求就是回放，不重写。"""
    from services.daily_service import DailyService

    async def _prompt(*a, **k):
        return "（心灵奇旅提示词）"

    monkeypatch.setattr(DailyService, "build_journey_prompt", _prompt)
    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    _install(monkeypatch, "昨天写下的那一篇。")
    env.post(f"/api/daily/{USER_ID}/journey", params={"date": yesterday})
    _install(monkeypatch, "今天写下的那一篇。")
    env.post(f"/api/daily/{USER_ID}/journey", params={"date": today})
    prov = _install(monkeypatch, "今天重写的那一篇。")
    again = env.post(f"/api/daily/{USER_ID}/journey", params={"date": today})
    assert "今天写下的那一篇。" in again.text and prov.prompts == []

    body = env.get(f"/api/daily/{USER_ID}/journeys", params={"date": today}).json()
    assert [(e["generated_on"], e["text"]) for e in body["entries"]] == [
        (today, "今天写下的那一篇。"),       # 新→旧
        (yesterday, "昨天写下的那一篇。"),
    ]
    assert _usage() == 2


def test_reading_and_journey_are_not_blocked_when_quota_exhausted(env, monkeypatch):
    """日签解读、心灵奇旅都是一天一次的单次生成：额度用完也放行，只是照样记一次。"""
    import services.rate_limit_service as rl_mod
    from services.daily_service import DailyService

    async def _prompt(*a, **k):
        return "（心灵奇旅提示词）"

    monkeypatch.setattr(rl_mod, "USER_DAILY_MESSAGE_LIMIT", 0)
    monkeypatch.setattr(DailyService, "build_journey_prompt", _prompt)
    _install(monkeypatch, "星星在今夜为你点灯。")
    today = date.today().isoformat()

    assert env.post(f"/api/daily/{USER_ID}/draw", json={"effective_date": today}).status_code == 200
    assert env.post(f"/api/daily/{USER_ID}/reading", json={"effective_date": today}).status_code == 200
    assert env.post(f"/api/daily/{USER_ID}/journey", params={"date": today}).status_code == 200
    assert _usage() == 2


def test_journeys_flag_today_conversations_not_yet_archived(env, monkeypatch):
    """今天抽完签又聊了几句：笔记要 12 小时后才写，这一篇看不到，界面上得说一声。"""
    from services.daily_service import DailyService

    async def _prompt(*a, **k):
        return "（心灵奇旅提示词）"

    monkeypatch.setattr(DailyService, "build_journey_prompt", _prompt)
    monkeypatch.setattr(notebook_service, "get_notes", lambda user_id: [])
    today = date.today().isoformat()

    assert env.get(f"/api/daily/{USER_ID}/journeys", params={"date": today}).json()["pending_today"] is False

    _install(monkeypatch, "星星在今夜为你点灯。")
    conv_id = _draw(env, today)
    # 只抽了签没聊：那张牌本来就在素材里，不算没归档
    assert env.get(f"/api/daily/{USER_ID}/journeys", params={"date": today}).json()["pending_today"] is False

    from models import Message
    from services.conversation_service import ConversationService
    asyncio.run(ConversationService.append_message(
        conv_id, Message(role=MessageRole.USER, content="今天确实有点累")))
    assert env.get(f"/api/daily/{USER_ID}/journeys", params={"date": today}).json()["pending_today"] is True


def test_journey_counts_readings_that_drew_cards(env, monkeypatch):
    """门槛是日运记录加上抽过牌的普通占卜，合起来满 3 条；没抽牌的对话不算。
    写出来的提示词里，每场占卜一行，列出抽到的牌。"""
    from models import Conversation, Message, SessionType, TarotCard
    from services.storage_service import StorageService

    monkeypatch.setattr(notebook_service, "get_notes", lambda user_id: [])
    today = date.today().isoformat()

    def ready():
        overview = env.get(f"/api/daily/{USER_ID}/overview", params={"date": today}).json()
        listed = env.get(f"/api/daily/{USER_ID}/journeys", params={"date": today}).json()
        assert overview["journey_ready"] == listed["ready"]   # 首页入口和卷宗页说的是同一件事
        return listed["ready"]

    def save(conv_id, cards):
        asyncio.run(StorageService.save_conversation(Conversation(
            conversation_id=conv_id, user_id=USER_ID, session_type=SessionType.TAROT,
            created_at=f"{today}T12:00:00", has_drawn_cards=bool(cards),
            messages=[Message(role=MessageRole.USER, content="想问问工作")]
            + ([Message(role=MessageRole.TOOL, content="{}", tool_call_id="c1", tarot_cards=cards)]
               if cards else []),
        )))

    _install(monkeypatch, "星星在今夜为你点灯。")
    _draw(env, today)
    save("tarot_1", [TarotCard(card_id=0, card_name="愚者")])
    save("no_cards", [])
    assert ready() is False      # 1 签 + 1 场抽过牌的占卜；没抽牌那场不算

    save("tarot_2", [TarotCard(card_id=3, card_name="女皇", reversed=True)])
    assert ready() is True

    prov = _install(monkeypatch, "这两周……")
    assert env.post(f"/api/daily/{USER_ID}/journey", params={"date": today}).status_code == 200
    prompt = prov.prompts[0]
    assert "| 塔罗 | 抽到:愚者·正位" in prompt
    assert "| 塔罗 | 抽到:女皇·逆位" in prompt


def test_feedback_note_is_limited_to_30_chars(env, monkeypatch):
    """附言原样进提示词：30 字以内收下，多一个字整条拒收，旧附言不被覆盖。"""
    _install(monkeypatch, "星星在今夜为你点灯。")
    today = date.today().isoformat()
    _draw(env, today)

    ok = env.post(f"/api/daily/{USER_ID}/feedback",
                  json={"effective_date": today, "verdict": "hit", "note": "准" * 30})
    assert ok.status_code == 200 and ok.json()["feedback"]["note"] == "准" * 30

    too_long = env.post(f"/api/daily/{USER_ID}/feedback",
                        json={"effective_date": today, "verdict": "hit", "note": "准" * 31})
    assert too_long.status_code == 422
    days = env.get(f"/api/daily/{USER_ID}/overview", params={"date": today}).json()
    assert days["today_record"]["feedback"]["note"] == "准" * 30
