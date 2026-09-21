"""牌阵目录：一副牌阵一份 .md，文件头是机器读的，正文是发给解读 Agent 的。

这里守住的是「位置只有一份」：开场只交牌阵 ID，位置、张数、牌阵名全从文件头来。
文件头一旦读不出来（管理页改坏了、新加的阵忘了写 positions），抽牌就没有槽位——
所以宁可当场抛，也不给任何默认值。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import prompt_service, spread_service  # noqa: E402


@pytest.fixture
def ps(tmp_path, monkeypatch):
    """覆盖版写到临时目录，绝不碰 backend/data/prompts。"""
    monkeypatch.setattr(prompt_service, "PROMPT_OVERRIDES_DIR", tmp_path / "overrides")
    return prompt_service


def test_catalog_is_exactly_the_registered_spread_prompts():
    """可用牌阵 = 注册表里的 spread_*.md。加一副阵只有两步：放文件、登记。"""
    registered = [name for name in prompt_service.PROMPT_REGISTRY if name.startswith("spread_")]
    assert [spread_service.prompt_name(i) for i in spread_service.SPREAD_IDS] == registered
    assert len(spread_service.SPREAD_IDS) == 5


def test_every_spread_parses_into_name_positions_and_detail():
    """五副阵都读得出来，而且位置非空——位置个数就是要抽的张数。"""
    for spread in spread_service.all_spreads():
        assert spread.name and not spread.name.startswith("#")
        assert spread.positions and all(p.strip() for p in spread.positions)
        assert spread.card_count == len(spread.positions)
        assert spread.detail.strip()


def test_detail_drops_the_front_matter_and_the_title_line():
    """发给模型的正文里不该有文件头，也不该有和块标题打架的一级标题。"""
    spread = spread_service.require("development_five")
    assert spread.name == "五张发展牌阵"
    assert spread.positions == ("前期开端", "中期发展", "阻碍", "后期结果", "建议")
    assert not spread.detail.startswith("---")
    assert not spread.detail.startswith("# ")
    assert "id: development_five" not in spread.detail
    assert spread.detail.startswith("## 牌阵属性")


def test_positions_keep_their_full_width_colons():
    """位置含义里带全角冒号，不能被当成文件头的字段名吃掉。"""
    assert spread_service.require("three_card_state").positions == (
        "左牌：共同回答本次问题", "中牌：共同回答本次问题", "右牌：共同回答本次问题")


def test_unknown_id_is_none_and_require_raises():
    assert spread_service.get("celtic_cross") is None
    assert spread_service.get(None) is None
    assert spread_service.get("") is None
    with pytest.raises(KeyError):
        spread_service.require("celtic_cross")


def test_override_takes_effect_without_restart(ps):
    """管理页改了这副阵，下一次取牌阵就是新的——和别的提示词同一套热加载。"""
    ps.save_override("spread_choice_two.md",
                     "---\nid: choice_two\nname: 改过的名字\npositions:\n  - 甲\n  - 乙\n---\n正文。\n")
    spread = spread_service.require("choice_two")
    assert spread.name == "改过的名字"
    assert spread.positions == ("甲", "乙")
    assert spread.detail == "正文。"


@pytest.mark.parametrize("broken,reason", [
    ("没有文件头，直接正文。\n", "缺少 --- 文件头"),
    ("---\nid: choice_two\nname: 只有名字\n---\n正文。\n", "没写 positions"),
    ("---\nid: choice_two\npositions:\n  - 甲\n---\n正文。\n", "没写 name"),
    ("---\nid: two_choice\nname: 名\npositions:\n  - 甲\n---\n正文。\n", "必须和文件名一致"),
])
def test_broken_front_matter_fails_loudly(ps, broken, reason):
    """文件头改坏了当场抛。给个默认位置反而更糟：用户会按一副谁都没选过的阵抽牌。"""
    ps.save_override("spread_choice_two.md", broken)
    with pytest.raises(ValueError, match=reason):
        spread_service.require("choice_two")
