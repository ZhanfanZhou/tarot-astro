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


def _long_tarot_session():
    """一场超过 20 条记录的完整占卜：开场、追问、交单、抽牌、解读、多轮追问、补抽被跳过、再补抽。"""
    from models import DrawCardsRequest, TarotCard, ToolCallRecord
    from services import tool_turns

    brief = ToolCallRecord(id="b1", name="submit_reading_brief", args={"route": "tarot"})
    draw = ToolCallRecord(id="d1", name="draw_tarot_cards",
                          args={"spread_type": "two_choice", "positions": ["现状", "走向"]})
    redraw = ToolCallRecord(id="d2", name="draw_tarot_cards", args={"spread_type": "single", "positions": ["补充"]})
    redraw2 = ToolCallRecord(id="d3", name="draw_tarot_cards", args={"spread_type": "single", "positions": ["补充"]})
    spread = DrawCardsRequest(spread_type="two_choice", positions=["现状", "走向"])
    cards = [TarotCard(card_name="愚者", card_id=0, reversed=False),
             TarotCard(card_name="高塔", card_id=16, reversed=True)]
    one = DrawCardsRequest(spread_type="single", positions=["补充"])
    star = [TarotCard(card_name="星星", card_id=17, reversed=False)]

    msgs = [
        Message(role=MessageRole.ASSISTANT, content="坐吧。"),
        Message(role=MessageRole.USER, content="该不该接这个 offer"),
        tool_turns.assistant_message("好，抽牌看看。", [brief]),
        tool_turns.tool_message(brief, {"success": True}),
        tool_turns.assistant_message("", [draw]),
        tool_turns.tool_message(draw, tool_turns.cards_result(cards, spread), tarot_cards=cards, draw_request=spread),
        Message(role=MessageRole.ASSISTANT, content="愚者说……"),
    ]
    for i in range(8):
        msgs += [Message(role=MessageRole.USER, content=f"追问{i}"),
                 Message(role=MessageRole.ASSISTANT, content=f"回答{i}")]
    msgs += [
        tool_turns.assistant_message("再抽一张。", [redraw]),
        tool_turns.tool_message(redraw, tool_turns.declined_result(redraw)),
        Message(role=MessageRole.USER, content="先不抽了，我想想"),
        tool_turns.assistant_message("好，那还是抽一张吧。", [redraw2]),
        tool_turns.tool_message(redraw2, tool_turns.cards_result(star, one), tarot_cards=star, draw_request=one),
        Message(role=MessageRole.ASSISTANT, content="星星说……"),
        Message(role=MessageRole.USER, content="谢谢，准了"),
    ]
    return Conversation(conversation_id="c2", user_id="u1", session_type=SessionType.TAROT, messages=msgs)


def test_transcript_is_the_whole_conversation_in_order():
    """记忆 Agent 看到整场对话：不截断（反馈往往在最后），牌带位置，用户做过的事都在。"""
    from services.notebook_service import build_transcript

    lines = build_transcript(_long_tarot_session()).splitlines()
    assert len(lines) > 20
    assert lines[:5] == [
        "占卜师：坐吧。",
        "用户：该不该接这个 offer",
        "占卜师：好，抽牌看看。",
        "[抽牌] 现状：愚者（正位）；走向：高塔（逆位）",
        "占卜师：愚者说……",
    ]
    assert lines[-7:-1] == [
        "占卜师：再抽一张。",
        "[用户没有抽牌，直接继续了对话]",
        "用户：先不抽了，我想想",
        "占卜师：好，那还是抽一张吧。",
        "[抽牌] 补充：星星（正位）",
        "占卜师：星星说……",
    ]
    assert lines[-1] == "用户：谢谢，准了"       # 最后的反馈没被截掉
    # 后台动作不进笔记
    assert not any("submit_reading_brief" in l or "success" in l for l in lines)


def test_summary_prompt_carries_the_full_transcript():
    from services.notebook_service import notebook_service

    conv = _long_tarot_session()
    fake_provider = _FakeProvider('{"summary":"s","cards_drawn":["愚者","高塔","星星"]}')
    with patch("services.llm.get_provider", return_value=fake_provider):
        asyncio.run(notebook_service.generate_summary(conv, user=None))

    prompt = fake_provider.generate_json.await_args.args[0]
    from services.notebook_service import build_transcript
    assert build_transcript(conv) in prompt


def test_transcript_for_astrology_and_daily():
    from models import DrawCardsRequest, TarotCard, ToolCallRecord
    from services import tool_turns
    from services.notebook_service import build_transcript

    ask = ToolCallRecord(id="p1", name="request_user_profile", args={})
    chart = ToolCallRecord(id="g1", name="get_astrology_chart", args={"reason": "本命盘"})
    astro = Conversation(conversation_id="a", user_id="u", session_type=SessionType.ASTROLOGY, messages=[
        Message(role=MessageRole.USER, content="看看本命盘"),
        tool_turns.assistant_message("先填一下出生信息。", [ask]),
        tool_turns.tool_message(ask, {"success": True, "profile": {"birth_date": "1995-03-08"}}),
        tool_turns.assistant_message("", [chart]),
        tool_turns.tool_message(chart, {"success": True, "data": "（很长的星盘原始数据）"}),
        Message(role=MessageRole.ASSISTANT, content="你的太阳在双鱼……"),
        Message(role=MessageRole.USER, content="那事业呢"),
        tool_turns.assistant_message("我们抽一张看看。", [ToolCallRecord(id="d", name="draw_tarot_cards", args={})]),
    ])
    assert build_transcript(astro).splitlines() == [
        "用户：看看本命盘",
        "占卜师：先填一下出生信息。",
        "[用户补充了出生资料]",
        "[占卜师取出了用户的本命星盘]",
        "占卜师：你的太阳在双鱼……",
        "用户：那事业呢",
        "占卜师：我们抽一张看看。",
        "[占卜师请用户抽牌，用户没有抽]",
    ]

    daily = Conversation(conversation_id="d", user_id="u", session_type=SessionType.DAILY, messages=[
        Message(role=MessageRole.ASSISTANT, content="今天的圣杯二……",
                tarot_cards=[TarotCard(card_name="圣杯二", card_id=37, reversed=False)],
                draw_request=DrawCardsRequest(spread_type="single", positions=["今日指引"])),
        Message(role=MessageRole.USER, content="那我该怎么做"),
        Message(role=MessageRole.ASSISTANT, content="先放松。"),
    ])
    assert build_transcript(daily).splitlines() == [
        "[今日签] 今日指引：圣杯二（正位）",
        "占卜师：今天的圣杯二……",
        "用户：那我该怎么做",
        "占卜师：先放松。",
    ]
