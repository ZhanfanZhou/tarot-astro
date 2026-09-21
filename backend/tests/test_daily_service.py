from datetime import date
from typing import List, Optional

import pytest

from models import Conversation, DailyDrawRecord, DailyFeedback, Message, MessageRole, SessionType, TarotCard
from services.daily_service import (
    build_history_block,
    build_journey_block,
    compute_streak,
    extract_tagline,
    journey_date_range,
    journey_window_readings,
    note_summaries,
    select_history_records,
)


def make_record(effective_date: str, card_name: str = "星星 (The Star)", reversed_: bool = False,
                verdict: Optional[str] = None, note: Optional[str] = None,
                conversation_id: str = "conv_x") -> DailyDrawRecord:
    return DailyDrawRecord(
        effective_date=effective_date,
        card=TarotCard(card_id=17, card_name=card_name, reversed=reversed_),
        conversation_id=conversation_id,
        drawn_at="2026-06-11T00:00:00",
        feedback=DailyFeedback(verdict=verdict, note=note),
    )


class TestComputeStreak:
    def test_today_drawn_consecutive(self):
        dates = {"2026-06-11", "2026-06-10", "2026-06-09"}
        assert compute_streak(dates, date(2026, 6, 11)) == 3

    def test_today_not_drawn_counts_from_yesterday(self):
        dates = {"2026-06-10", "2026-06-09"}
        assert compute_streak(dates, date(2026, 6, 11)) == 2

    def test_gap_breaks_streak(self):
        dates = {"2026-06-11", "2026-06-09"}
        assert compute_streak(dates, date(2026, 6, 11)) == 1

    def test_empty(self):
        assert compute_streak(set(), date(2026, 6, 11)) == 0


class TestSelectHistoryRecords:
    def test_caps_at_five_draws(self):
        records = {f"2026-06-{d:02d}": make_record(f"2026-06-{d:02d}") for d in range(1, 11)}  # 6/1..6/10
        picked = select_history_records(records, date(2026, 6, 11))
        assert len(picked) == 5
        assert picked[0].effective_date == "2026-06-06"   # 升序,最近 5 次
        assert picked[-1].effective_date == "2026-06-10"

    def test_fourteen_day_cutoff(self):
        records = {
            "2026-05-27": make_record("2026-05-27"),  # 距 6/11 已 15 天,超窗
            "2026-05-29": make_record("2026-05-29"),
            "2026-06-10": make_record("2026-06-10"),
        }
        picked = select_history_records(records, date(2026, 6, 11))
        assert [r.effective_date for r in picked] == ["2026-05-29", "2026-06-10"]

    def test_skips_future_dates_keeps_anchor_day(self):
        records = {
            "2026-06-12": make_record("2026-06-12"),  # 晚间抽的明日签,不进上下文
            "2026-06-11": make_record("2026-06-11"),
            "2026-06-10": make_record("2026-06-10"),
        }
        picked = select_history_records(records, date(2026, 6, 11))
        assert [r.effective_date for r in picked] == ["2026-06-10", "2026-06-11"]

    def test_fewer_than_five_uses_actual(self):
        records = {"2026-06-10": make_record("2026-06-10")}
        assert len(select_history_records(records, date(2026, 6, 11))) == 1


class TestBuildHistoryBlock:
    def test_empty_is_first_draw(self):
        assert "第一签" in build_history_block([])

    def test_line_format(self):
        rec = make_record("2026-06-10", card_name="宝剑三", reversed_=True, verdict="hit", note="确实和同事起了争执")
        block = build_history_block([rec])
        assert block == "6月10日 | 宝剑三·逆位 | 印证:应验了 | 附言:确实和同事起了争执"

    def test_no_feedback_and_miss(self):
        no_fb = make_record("2026-06-09")
        miss = make_record("2026-06-10", verdict="miss")
        block = build_history_block([no_fb, miss])
        lines = block.split("\n")
        assert "未印证" in lines[0]
        assert "印证:没感觉" in lines[1]
        assert "附言" not in block

    def test_note_summary_follows_its_day(self):
        """那天聊下去过、已经写成笔记的,牌那行下面紧跟一行笔记;没笔记的日子只有牌那行。"""
        chatted = make_record("2026-06-09", conversation_id="conv_a")
        silent = make_record("2026-06-10", conversation_id="conv_b")
        block = build_history_block([chatted, silent], {"conv_a": "聊到想给自己放个假。"})
        assert block.split("\n") == [
            "6月9日 | 星星 (The Star)·正位 | 未印证",
            "  笔记:聊到想给自己放个假。",
            "6月10日 | 星星 (The Star)·正位 | 未印证",
        ]


class TestNoteSummaries:
    def test_only_these_days_and_only_summary(self):
        """只认这几天日签对话自己的笔记,别的会话不进来;取到的就只有 summary。"""
        history = [make_record("2026-06-10", conversation_id="conv_a")]
        notes = [
            {"conversation_id": "conv_a", "summary": "这一场", "question": "问题", "cards_drawn": ["星星"]},
            {"conversation_id": "conv_other", "summary": "别的会话"},
        ]
        assert note_summaries(notes, history) == {"conv_a": "这一场"}

    def test_skips_empty_summary(self):
        history = [make_record("2026-06-10", conversation_id="conv_a")]
        assert note_summaries([{"conversation_id": "conv_a", "summary": ""}], history) == {}


def make_reading(conversation_id: str, created_at: str, cards: List[TarotCard],
                 session_type: SessionType = SessionType.TAROT) -> Conversation:
    """一场普通占卜：抽过牌的话，牌挂在抽牌那条 TOOL 记录上。"""
    messages = [Message(role=MessageRole.USER, content="想问问工作")]
    if cards:
        messages.append(Message(role=MessageRole.TOOL, content="{}", tool_call_id="c1", tarot_cards=cards))
    return Conversation(
        conversation_id=conversation_id, user_id="u1", session_type=session_type,
        messages=messages, created_at=created_at, has_drawn_cards=bool(cards),
    )


FOOL = TarotCard(card_id=0, card_name="愚者")
EMPRESS = TarotCard(card_id=3, card_name="女皇", reversed=True)


class TestJourneyWindowReadings:
    def test_only_readings_that_drew_cards_within_fourteen_days(self):
        anchor = date(2026, 6, 20)
        drew = make_reading("drew", "2026-06-10T09:00:00", [FOOL])
        astro = make_reading("astro", "2026-06-12T09:00:00", [FOOL], SessionType.ASTROLOGY)
        no_cards = make_reading("no_cards", "2026-06-11T09:00:00", [])
        too_old = make_reading("too_old", "2026-06-05T09:00:00", [FOOL])      # 距 6/20 已 15 天
        later = make_reading("later", "2026-06-21T09:00:00", [FOOL])          # 晚于锚点
        daily = make_reading("daily", "2026-06-13T09:00:00", [FOOL], SessionType.DAILY)  # 由日运记录代表
        picked = journey_window_readings([astro, no_cards, too_old, later, daily, drew], anchor)
        assert [c.conversation_id for c in picked] == ["drew", "astro"]

    def test_date_range_spans_records_and_readings(self):
        records = [make_record("2026-06-12"), make_record("2026-06-15")]
        readings = [make_reading("r", "2026-06-10T09:00:00", [FOOL])]
        assert journey_date_range(records, readings) == "2026-06-10 ~ 2026-06-15"


class TestBuildJourneyBlock:
    def test_records_and_readings_in_one_timeline_notes_follow_their_line(self):
        """日签和占卜排成一张表；哪一场有笔记，下面就跟一行笔记，别的只有那一行。"""
        records = [
            make_record("2026-06-09", card_name="宝剑三", verdict="hit", conversation_id="d9"),
            make_record("2026-06-11", conversation_id="d11"),
        ]
        readings = [make_reading("r10", "2026-06-10T13:00:00", [FOOL, EMPRESS])]
        block = build_journey_block(records, readings, {"r10": "纠结要不要换工作。", "d11": "想放个假。"})
        assert block.split("\n") == [
            "6月9日 | 宝剑三·正位 | 印证:应验了",
            "6月10日 | 塔罗 | 抽到:愚者·正位、女皇·逆位",
            "  笔记:纠结要不要换工作。",
            "6月11日 | 星星 (The Star)·正位 | 未印证",
            "  笔记:想放个假。",
        ]

    def test_note_summaries_cover_readings_too(self):
        readings = [make_reading("r10", "2026-06-10T13:00:00", [FOOL])]
        notes = [{"conversation_id": "r10", "summary": "这一场"}, {"conversation_id": "other", "summary": "别的"}]
        assert note_summaries(notes, readings) == {"r10": "这一场"}


def make_conversation(messages: List[Message]) -> Conversation:
    return Conversation(
        conversation_id="conv_x", user_id="u1",
        session_type=SessionType.DAILY, title="t", messages=messages,
    )


class TestExtractTagline:
    def test_first_sentence_of_first_assistant_message(self):
        conv = make_conversation([
            Message(role=MessageRole.ASSISTANT, content="星星在今夜为你点灯。它提醒你保持希望。"),
        ])
        assert extract_tagline(conv) == "星星在今夜为你点灯"

    def test_caps_at_40_chars(self):
        conv = make_conversation([Message(role=MessageRole.ASSISTANT, content="无" * 80)])
        assert len(extract_tagline(conv)) == 40

    def test_none_cases(self):
        assert extract_tagline(None) is None
        assert extract_tagline(make_conversation([])) is None


class TestRenderTemplate:
    """每日一签模板经 prompt_service.render_prompt_parts 渲染(默认+覆盖双层热加载,且按白名单校验 name)。
    用已注册的模板名(daily_oracle_system.md)验证，monkeypatch 真正读盘的
    services.prompt_service.PROMPTS_DIR/PROMPT_OVERRIDES_DIR。"""

    def test_replaces_placeholders_and_hot_reads(self, tmp_path, monkeypatch):
        import services.prompt_service as ps
        monkeypatch.setattr(ps, "PROMPTS_DIR", tmp_path)
        monkeypatch.setattr(ps, "PROMPT_OVERRIDES_DIR", tmp_path / "overrides")
        (tmp_path / "daily_oracle_system.md").write_text(
            "你好 {nickname},今天是 {today_date}。{孤立花括号不崩}", encoding="utf-8"
        )
        out = ps.join(ps.render_prompt_parts("daily_oracle_system.md", {"nickname": "小x", "today_date": "2026-06-11"}))
        assert out == "你好 小x,今天是 2026-06-11。{孤立花括号不崩}"
        # 热加载:改文件后再次渲染立即生效
        (tmp_path / "daily_oracle_system.md").write_text("新版 {nickname}", encoding="utf-8")
        assert ps.join(ps.render_prompt_parts("daily_oracle_system.md", {"nickname": "小x"})) == "新版 小x"

    def test_missing_template_raises(self, tmp_path, monkeypatch):
        import services.prompt_service as ps
        monkeypatch.setattr(ps, "PROMPTS_DIR", tmp_path)
        monkeypatch.setattr(ps, "PROMPT_OVERRIDES_DIR", tmp_path / "overrides")
        with pytest.raises(FileNotFoundError):
            ps.join(ps.render_prompt_parts("daily_oracle_system.md", {}))
