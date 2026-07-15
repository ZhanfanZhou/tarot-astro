"""中性工具规格：与旧 FunctionDeclaration 同名同字段，可被两种 provider 转换。"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_tool_specs_cover_all_five_tools():
    from services.llm import tools
    names = {t["name"] for t in tools.ALL_TOOL_SPECS}
    assert names == {
        "draw_tarot_cards", "get_astrology_chart",
        "request_user_profile", "read_divination_notebook",
        "submit_reading_brief",
    }


def test_each_spec_has_name_desc_params():
    from services.llm import tools
    for t in tools.ALL_TOOL_SPECS:
        assert t["name"] and t["description"]
        assert t["parameters"]["type"] == "object"
        assert "properties" in t["parameters"]


def test_named_toolsets_are_subsets():
    from services.llm import tools
    all_names = {t["name"] for t in tools.ALL_TOOL_SPECS}
    assert set(tools.OPENING_TOOL_NAMES) == {"submit_reading_brief"}
    assert "draw_tarot_cards" in tools.READING_TOOL_NAMES
    assert "submit_reading_brief" in tools.READING_TOOL_NAMES
    assert "submit_reading_brief" not in tools.DAILY_TOOL_NAMES
    assert set(tools.DAILY_TOOL_NAMES) <= all_names


def test_specs_by_names_helper():
    from services.llm import tools
    subset = tools.specs_by_names(tools.OPENING_TOOL_NAMES)
    assert [t["name"] for t in subset] == ["submit_reading_brief"]
