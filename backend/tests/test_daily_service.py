from datetime import date
from typing import List, Optional

import pytest

from models import Conversation, DailyDrawRecord, DailyFeedback, Message, MessageRole, SessionType, TarotCard
from services.daily_service import (
    build_history_block,
    compute_streak,
    extract_tagline,
    render_template,
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
    def test_caps_at_seven_draws(self):
        records = {f"2026-06-{d:02d}": make_record(f"2026-06-{d:02d}") for d in range(1, 11)}  # 6/1..6/10
        picked = select_history_records(records, date(2026, 6, 11))
        assert len(picked) == 7
        assert picked[0].effective_date == "2026-06-04"   # 升序,最近 7 次
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

    def test_fewer_than_seven_uses_actual(self):
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


def make_conversation(messages: List[Message]) -> Conversation:
    return Conversation(
        conversation_id="conv_x", user_id="u1",
        session_type=SessionType.DAILY, title="t", messages=messages,
    )


class TestExtractTagline:
    def test_first_sentence_of_first_assistant_message(self):
        conv = make_conversation([
            Message(role=MessageRole.SYSTEM, content="用户已完成抽牌"),
            Message(role=MessageRole.USER, content="请根据抽牌结果进行解读"),
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
    def test_replaces_placeholders_and_hot_reads(self, tmp_path, monkeypatch):
        import services.daily_service as ds
        monkeypatch.setattr(ds, "PROMPTS_DIR", tmp_path)
        (tmp_path / "t.md").write_text("你好 {nickname},今天是 {today_date}。{孤立花括号不崩}", encoding="utf-8")
        out = render_template("t.md", {"nickname": "小x", "today_date": "2026-06-11"})
        assert out == "你好 小x,今天是 2026-06-11。{孤立花括号不崩}"
        # 热加载:改文件后再次渲染立即生效
        (tmp_path / "t.md").write_text("新版 {nickname}", encoding="utf-8")
        assert render_template("t.md", {"nickname": "小x"}) == "新版 小x"

    def test_missing_template_raises(self, tmp_path, monkeypatch):
        import services.daily_service as ds
        monkeypatch.setattr(ds, "PROMPTS_DIR", tmp_path)
        with pytest.raises(FileNotFoundError):
            render_template("nope.md", {})
