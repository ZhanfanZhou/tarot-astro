"""记忆 Agent（notebook）走 MEMORY provider，而非直接建 genai.GenerativeModel。

一次调用出两样东西：这场的占卜笔记（追加一条）和用户画像的改动（增量并进去）。
全程 mock services.llm.get_provider，绝不发真实请求、绝不碰 backend/data/。
"""
import asyncio
import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Conversation, Message, MessageRole, SessionType  # noqa: E402
# 这两个模块导入时会建 asyncio.Lock（Python 3.9 要求当时有事件循环），
# 必须在任何测试跑过 asyncio.run 之前导入
from services import notebook_task_scheduler  # noqa: E402
from services.notebook_service import (  # noqa: E402
    _PortraitPatch, empty_portrait, merge_portrait,
)
from services.turn_service import _read_notes  # noqa: E402


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


def test_saved_entry_takes_fields_from_memory_agent(tmp_path, monkeypatch):
    """记忆 Agent 写问题与背景 / 牌 / 记录 / 反馈；它没写的字段存成空；占卜时间由系统按对话写。"""
    from services.notebook_service import notebook_service

    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)
    fake_provider = _FakeProvider(
        '{"note":{"question":"感情不顺，想知道原因","cards_drawn":["愚者（正位）"],"summary":"记录"}}')
    conv = _conv()

    with patch("services.llm.get_provider", return_value=fake_provider) as get_provider:
        asyncio.run(notebook_service.generate_and_save("u1", conv, user=None))

    get_provider.assert_called_once_with("memory")
    assert notebook_service.get_notes("u1") == [{
        "conversation_id": "c1",
        "start_time": conv.created_at,
        "question": "感情不顺，想知道原因",
        "cards_drawn": ["愚者（正位）"],
        "summary": "记录",
        "user_feedback": "",
        "end_time": conv.updated_at,
    }]


def test_failed_generation_writes_nothing(tmp_path, monkeypatch):
    """provider 报错直接抛，不写一条假笔记——下次离开这场对话时会重新登记。"""
    import pytest
    from services.notebook_service import notebook_service

    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)
    fake_provider = _FakeProvider("")
    fake_provider.generate_json = AsyncMock(side_effect=RuntimeError("provider down"))

    with patch("services.llm.get_provider", return_value=fake_provider), pytest.raises(RuntimeError):
        asyncio.run(notebook_service.generate_and_save("u1", _conv(), user=None))

    fake_provider.generate_json.assert_awaited_once()
    assert notebook_service.get_notes("u1") == []
    assert not (tmp_path / "portrait_u1.json").exists()


def test_malformed_json_is_regenerated_right_away():
    """解析不了、一个笔记字段都没有（DeepSeek 偶尔只回 {"type": "json_object"}）都算不合格，
    当场重新生成；有字段但写 null 按空处理。"""
    from services.notebook_service import notebook_service

    fake_provider = _FakeProvider("")
    fake_provider.generate_json = AsyncMock(side_effect=[
        "不是 JSON", '{"type": "json_object"}',
        '{"note": {"summary": "记录", "question": null}, "type": "json_object"}',
    ])
    with patch("services.llm.get_provider", return_value=fake_provider):
        out = asyncio.run(notebook_service.generate_update(_conv(), empty_portrait()))

    assert fake_provider.generate_json.await_count == 3
    assert out == {"note": {"question": "", "cards_drawn": [], "summary": "记录", "user_feedback": ""},
                   "portrait": {}}


def test_generation_gives_up_after_three_malformed_replies(tmp_path, monkeypatch):
    import pytest
    from services.notebook_service import NOTE_ATTEMPTS, notebook_service

    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)
    fake_provider = _FakeProvider("")
    fake_provider.generate_json = AsyncMock(side_effect=[
        "[]", '{"note": {"cards_drawn": "愚者"}}', "{", '{"note": {"summary": "第四次"}}'])
    with patch("services.llm.get_provider", return_value=fake_provider), pytest.raises(ValueError):
        asyncio.run(notebook_service.generate_and_save("u1", _conv(), user=None))

    assert NOTE_ATTEMPTS == 3
    assert fake_provider.generate_json.await_count == 3
    assert notebook_service.get_notes("u1") == []


def _long_tarot_session():
    """一场超过 20 条记录的完整占卜：开场、追问、交单、抽牌、解读、多轮追问、补抽被跳过、再补抽。"""
    from models import DrawCardsRequest, TarotCard, ToolCallRecord
    from services import tool_turns

    brief = ToolCallRecord(id="b1", name="submit_reading_brief",
                           args={"question": "该不该接这个 offer", "route": "tarot"})
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


def _content_lines(transcript: str):
    """去掉日期行和每条记录开头的 [HH:MM]，只比内容（时间另有测试）。"""
    return [re.sub(r"^\[\d\d:\d\d\] ", "", line)
            for line in transcript.splitlines() if not line.startswith("—— ")]


def test_transcript_is_the_whole_conversation_in_order():
    """整场对话按顺序转写、不截断（反馈往往在最后）：开场确认的问题、牌阵、抽到的牌都在。"""
    from services.notebook_service import build_transcript

    lines = _content_lines(build_transcript(_long_tarot_session()))
    assert lines[:7] == [
        "占卜师：坐吧。",
        "用户：该不该接这个 offer",
        "占卜师：好，抽牌看看。",
        "[后台·开场确认了本场占卜] 问题：该不该接这个 offer；起手：tarot",
        "[占卜师请用户抽牌] 牌阵：two_choice；位置：现状 / 走向",
        "[用户抽了牌] 现状：愚者（正位）；走向：高塔（逆位）",
        "占卜师：愚者说……",
    ]
    assert lines[-9:] == [
        "占卜师：再抽一张。",
        "[占卜师请用户抽牌] 牌阵：single；位置：补充",
        "[用户没有抽牌，直接继续了对话]",
        "用户：先不抽了，我想想",
        "占卜师：好，那还是抽一张吧。",
        "[占卜师请用户抽牌] 牌阵：single；位置：补充",
        "[用户抽了牌] 补充：星星（正位）",
        "占卜师：星星说……",
        "用户：谢谢，准了",
    ]
    assert len(lines) == 7 + 16 + 9      # 中间 8 轮追问一条不少


def test_transcript_keeps_every_kind_of_record():
    """调用参数、失败原因、填的资料、星盘、翻到的笔记、占卜师的思考、停在半路的请求，都照写。"""
    from models import ToolCallRecord
    from services import tool_turns
    from services.notebook_service import build_transcript

    chart_fail = ToolCallRecord(id="g1", name="get_astrology_chart", args={"reason": "本命盘"})
    ask = ToolCallRecord(id="p1", name="request_user_profile",
                         args={"reason": "看本命盘要出生信息", "required_fields": ["birth_time", "birth_city"]})
    chart = ToolCallRecord(id="g2", name="get_astrology_chart", args={"reason": "本命盘"})
    notes = ToolCallRecord(id="n1", name="read_divination_notes", args={"reason": "看看以前问过什么"})
    draw = ToolCallRecord(id="d1", name="draw_tarot_cards", args={"spread_type": "single", "positions": ["事业"]})
    conv = Conversation(conversation_id="a", user_id="u", session_type=SessionType.ASTROLOGY, messages=[
        Message(role=MessageRole.USER, content="看看本命盘"),
        tool_turns.assistant_message("", [chart_fail], reasoning="资料不全，先试着取盘"),
        tool_turns.tool_message(chart_fail, {"success": False, "error": "用户的出生信息不完整",
                                             "missing_fields": ["birth_time", "birth_city"]}),
        tool_turns.assistant_message("先填一下出生信息。", [ask]),
        tool_turns.tool_message(ask, {"success": True, "profile": {"nickname": "小夏", "birth_date": "1995-03-08"}}),
        tool_turns.assistant_message("", [chart]),
        tool_turns.tool_message(chart, {"success": True, "data": "【行星落座】\n太阳：落在双鱼座"}),
        tool_turns.assistant_message("", [notes]),
        tool_turns.tool_message(notes, {"success": True, "note_count": 1, "notes": "【记录 1】问过工作"}),
        Message(role=MessageRole.ASSISTANT, content="你的太阳在双鱼……"),
        Message(role=MessageRole.USER, content="那事业呢"),
        tool_turns.assistant_message("我们抽一张看看。", [draw]),
    ])
    assert _content_lines(build_transcript(conv)) == [
        "用户：看看本命盘",
        "[后台·占卜师的思考] 资料不全，先试着取盘",
        "[后台·占卜师取用户的本命星盘] 原因：本命盘",
        "[后台·取星盘没有成功：用户的出生信息不完整] 缺：出生时间 / 出生地",
        "占卜师：先填一下出生信息。",
        "[占卜师请用户填写资料] 原因：看本命盘要出生信息；需要的资料：出生时间 / 出生地",
        "[用户填写了资料] 昵称：小夏；出生日期：1995-03-08",
        "[后台·占卜师取用户的本命星盘] 原因：本命盘",
        "[后台·星盘数据]",
        "【行星落座】",
        "太阳：落在双鱼座",
        "[后台·占卜师翻看以前的占卜记录] 原因：看看以前问过什么",
        "[后台·以前的占卜记录]",
        "【记录 1】问过工作",
        "占卜师：你的太阳在双鱼……",
        "用户：那事业呢",
        "占卜师：我们抽一张看看。",
        "[占卜师请用户抽牌] 牌阵：single；位置：事业",
        "[到这里为止，用户还没有抽牌]",
    ]


def test_transcript_records_the_first_fill_as_an_event_without_values():
    """本场第一次补资料的结果不带值（值在 <用户资料> 里）→ 转写成「填了」这件事本身。

    资料是每场都一样的固定信息，笔记不该逐场再抄一遍；这一行要的是「他在这里补了资料」。
    """
    from models import ToolCallRecord
    from services import tool_turns
    from services.notebook_service import build_transcript

    ask = ToolCallRecord(id="p1", name="request_user_profile", args={"reason": "要排盘"})
    conv = Conversation(conversation_id="p", user_id="u", session_type=SessionType.ASTROLOGY, messages=[
        tool_turns.assistant_message("先填一下出生信息。", [ask]),
        tool_turns.tool_message(ask, {"success": True, "message": "用户已经填好资料，最新的一份见 <用户资料>"}),
    ])
    assert _content_lines(build_transcript(conv)) == [
        "占卜师：先填一下出生信息。",
        "[占卜师请用户填写资料] 原因：要排盘",
        "[用户填写了资料] 说明：用户已经填好资料，最新的一份见 <用户资料>",
    ]


def test_transcript_writes_unrecognized_fields_instead_of_dropping_them():
    from models import ToolCallRecord
    from services import tool_turns
    from services.notebook_service import build_transcript

    new_tool = ToolCallRecord(id="x1", name="future_tool", args={"topic": "工作"})
    conv = Conversation(conversation_id="x", user_id="u", session_type=SessionType.TAROT, messages=[
        tool_turns.assistant_message("", [new_tool]),
        tool_turns.tool_message(new_tool, {"success": True, "hint": "新字段"}),
    ])
    assert _content_lines(build_transcript(conv)) == [
        "[后台·占卜师调用 future_tool] topic：工作",
        "[后台·future_tool 的结果] hint：新字段",
    ]


def test_transcript_marks_time_and_day_changes():
    from services.notebook_service import build_transcript

    conv = Conversation(conversation_id="t", user_id="u", session_type=SessionType.TAROT, messages=[
        Message(role=MessageRole.USER, content="在吗", timestamp="2026-09-15T08:24:27.100000"),
        Message(role=MessageRole.ASSISTANT, content="在。", timestamp="2026-09-15T08:24:31.900000"),
        Message(role=MessageRole.USER, content="昨天说的应验了", timestamp="2026-09-17T10:03:00"),
    ])
    assert build_transcript(conv).splitlines() == [
        "—— 2026-09-15 ——",
        "[08:24] 用户：在吗",
        "[08:24] 占卜师：在。",
        "—— 2026-09-17 ——",
        "[10:03] 用户：昨天说的应验了",
    ]


def test_note_prompt_carries_the_full_transcript_and_the_current_portrait():
    from services.notebook_service import build_transcript, notebook_service

    conv = _long_tarot_session()
    portrait = merge_portrait(empty_portrait(), {"understanding": "做决定前会想很久"}, "2026-09-01T00:00:00")
    fake_provider = _FakeProvider('{"note":{"summary":"s"}}')
    with patch("services.llm.get_provider", return_value=fake_provider):
        asyncio.run(notebook_service.generate_update(conv, portrait))

    prompt = fake_provider.generate_json.await_args.args[0]
    assert build_transcript(conv) in prompt
    assert "做决定前会想很久" in prompt            # 要改画像，先得看见现在的画像


def test_transcript_for_daily_and_legacy_records():
    from models import DrawCardsRequest, TarotCard
    from services.notebook_service import build_transcript

    daily = Conversation(conversation_id="d", user_id="u", session_type=SessionType.DAILY, messages=[
        Message(role=MessageRole.ASSISTANT, content="今天的圣杯二……",
                tarot_cards=[TarotCard(card_name="圣杯二", card_id=37, reversed=False)],
                draw_request=DrawCardsRequest(spread_type="single", positions=["今日指引"])),
        Message(role=MessageRole.USER, content="那我该怎么做"),
    ])
    assert _content_lines(build_transcript(daily)) == [
        "[今日签] 今日指引：圣杯二（正位）",
        "占卜师：今天的圣杯二……",
        "用户：那我该怎么做",
    ]

    legacy = Conversation(conversation_id="l", user_id="u", session_type=SessionType.TAROT, messages=[
        Message(role=MessageRole.SYSTEM, content="用户已完成抽牌",
                tarot_cards=[TarotCard(card_name="宝剑五", card_id=54, reversed=True)],
                draw_request=DrawCardsRequest(spread_type="single", positions=None)),
    ])
    assert _content_lines(build_transcript(legacy)) == [
        "[系统记录] 用户已完成抽牌",
        "[抽牌] 第1张：宝剑五（逆位）",
    ]


def test_notebook_is_for_registered_users_only():
    from models import User, UserType
    from services.notebook_service import notebook_enabled

    guest = User(user_id="guest_1", user_type=UserType.GUEST)
    assert not notebook_enabled(guest)
    assert not notebook_enabled(None)
    assert notebook_enabled(User(user_id="user_1", user_type=UserType.REGISTERED))
    assert _read_notes(guest)["success"] is False


def test_scheduler_does_not_write_notes_for_guests(monkeypatch):
    """限制上线前给游客排下的任务，到点只移除、不生成。"""
    from models import User, UserType
    from services.notebook_service import notebook_service
    sched = notebook_task_scheduler

    scheduler = sched.NotebookTaskScheduler()
    monkeypatch.setattr(scheduler, "remove_task", AsyncMock())
    generate = AsyncMock()
    monkeypatch.setattr(notebook_service, "generate_and_save", generate)
    with patch("services.conversation_service.ConversationService.get_conversation",
               AsyncMock(return_value=_conv())), \
         patch("services.storage_service.StorageService.get_user",
               AsyncMock(return_value=User(user_id="guest_1", user_type=UserType.GUEST))):
        asyncio.run(scheduler._process_task(sched.NotebookTask(
            conversation_id="c1", user_id="guest_1", scheduled_time="", created_at="")))

    generate.assert_not_called()
    scheduler.remove_task.assert_awaited_once_with("c1")


# ── 用户画像 ───────────────────────────────────────────────────────────

def test_prompt_and_code_agree_on_the_portrait_fields():
    """画像的字段代码里一份、提示词里一份，漏改哪边都不报错、只会静默丢字段——这里拦住。

    漏改的三种后果都是安静的：提示词加了字段但代码没加，模型写了也收不下；代码加了提示词没加，
    那个字段永远是空的；两边名字不一样，等于都没加。谁都不会抛异常，日志照常打「画像已更新」。
    """
    import json
    from services import prompt_service
    from services.notebook_service import PORTRAIT_FIELDS

    text = prompt_service.get_default("notebook_system.md")   # 只比对仓库里的默认版
    example = json.loads(re.search(r"按 JSON 格式输出：\n(\{.*\})", text, re.S).group(1))["portrait"]

    assert set(example) == set(PORTRAIT_FIELDS)
    for name in PORTRAIT_FIELDS:              # 上面的表格里也得讲到
        assert f"`{name}`" in text, f"提示词里没讲 {name}"


def test_patch_only_touches_the_fields_the_agent_wrote():
    """补丁里有的字段覆盖，没有的原样留着；给 "" 是清空，字段本身不会少。"""
    before = merge_portrait(empty_portrait(), {
        "recent": "在上海做设计", "people_and_events": "男友在杭州", "preferences": "话说直一点",
    }, "2026-09-01T00:00:00")

    after = merge_portrait(before, {
        "recent": "月底搬去杭州",     # 只改这一个字段
        "preferences": "",           # 清空
    }, "2026-09-18T12:00:00")

    assert after["recent"] == {"text": "月底搬去杭州", "confirmed_at": "2026-09-18T12:00:00"}
    assert after["people_and_events"] == {"text": "男友在杭州",              # 没写的连时间一起没动
                                          "confirmed_at": "2026-09-01T00:00:00"}
    assert after["preferences"] == {"text": "", "confirmed_at": "2026-09-18T12:00:00"}
    assert set(after) == {"recent", "people_and_events", "understanding", "preferences"}


def test_confirmed_at_is_written_by_the_code_not_the_agent():
    """时间由代码写，模型碰不到：写了哪个字段，那个字段就记这场对话的结束时间，别的不动。"""
    before = merge_portrait(empty_portrait(),
                            {"understanding": "旧的认识", "recent": "在上海"}, "2026-09-01T00:00:00")

    after = merge_portrait(before, {"understanding": "新的认识"}, "2026-09-18T12:00:00")
    assert after["understanding"] == {"text": "新的认识", "confirmed_at": "2026-09-18T12:00:00"}
    assert after["recent"] == {"text": "在上海", "confirmed_at": "2026-09-01T00:00:00"}

    # 模型写的时间一律进不来：补丁里只有字段名 → 一段文字
    assert "confirmed" not in str(_PortraitPatch.model_fields)


def test_agent_written_patch_is_merged_and_saved(tmp_path, monkeypatch):
    """一次调用两样东西都落地：笔记追加一条，画像按补丁并进去（时间用这场对话的结束时间）。"""
    from services.notebook_service import notebook_service

    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)
    conv = _conv()
    fake_provider = _FakeProvider(
        '{"note": {"summary": "记录"},'
        ' "portrait": {"recent": "刚换了工作", "understanding": "问的常是该不该"}}')

    with patch("services.llm.get_provider", return_value=fake_provider):
        result = asyncio.run(notebook_service.generate_and_save("u1", conv, user=None))

    assert result["portrait_updated"] == ["recent", "understanding"]
    assert notebook_service.get_portrait("u1") == {
        "recent": {"text": "刚换了工作", "confirmed_at": conv.updated_at},
        "people_and_events": {"text": "", "confirmed_at": ""},
        "understanding": {"text": "问的常是该不该", "confirmed_at": conv.updated_at},
        "preferences": {"text": "", "confirmed_at": ""},
    }
    assert len(notebook_service.get_notes("u1")) == 1


def test_no_patch_leaves_the_portrait_file_alone(tmp_path, monkeypatch):
    """这场没什么可记的是常态：画像文件不动，笔记照写。"""
    from services.notebook_service import notebook_service

    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)
    fake_provider = _FakeProvider('{"note": {"summary": "记录"}, "portrait": {}}')
    with patch("services.llm.get_provider", return_value=fake_provider):
        result = asyncio.run(notebook_service.generate_and_save("u1", _conv(), user=None))

    assert result["portrait_updated"] == []
    assert not (tmp_path / "portrait_u1.json").exists()
    assert len(notebook_service.get_notes("u1")) == 1


def test_long_portrait_field_is_kept_as_written():
    """字数上限只在提示词里说，代码不检查：模型写长了照收，不为这个丢掉一条好笔记。"""
    from services.notebook_service import notebook_service

    long_text = "太" * 900
    fake_provider = _FakeProvider(
        '{"note": {"summary": "记录"}, "portrait": {"understanding": "%s"}}' % long_text)
    with patch("services.llm.get_provider", return_value=fake_provider):
        out = asyncio.run(notebook_service.generate_update(_conv(), empty_portrait()))

    assert fake_provider.generate_json.await_count == 1
    assert out["portrait"] == {"understanding": long_text}


def test_guest_logout_deletes_both_files(tmp_path, monkeypatch):
    from services.notebook_service import notebook_service

    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)
    (tmp_path / "note_guest_1.log").write_text("[]", encoding="utf-8")
    notebook_service._save_portrait("guest_1", empty_portrait())

    notebook_service.delete_notebook("guest_1")

    assert list(tmp_path.iterdir()) == []
