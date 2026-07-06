"""prompt_service 测试：默认/覆盖双层、渲染、原子保存、白名单。
覆盖目录全程 monkeypatch 到 tmp_path，不碰 backend/data/。"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def ps(tmp_path, monkeypatch):
    import services.prompt_service as mod
    monkeypatch.setattr(mod, "PROMPT_OVERRIDES_DIR", tmp_path / "overrides")
    return mod


def test_get_prompt_falls_back_to_default(ps):
    text = ps.get_prompt("tarot_system.md")
    assert "职业占卜师" in text  # 仓库默认版


def test_override_takes_priority(ps):
    ps.save_override("tarot_system.md", "OVERRIDE-CONTENT")
    assert ps.get_prompt("tarot_system.md") == "OVERRIDE-CONTENT"
    info = ps.get_prompt_info("tarot_system.md")
    assert info["overridden"] is True


def test_save_writes_bak_of_previous_content(ps):
    default = ps.get_prompt("tarot_system.md")
    ps.save_override("tarot_system.md", "V1")
    bak = ps.PROMPT_OVERRIDES_DIR / "tarot_system.md.bak"
    assert bak.read_text(encoding="utf-8") == default  # 首次保存,备份默认版
    ps.save_override("tarot_system.md", "V2")
    assert bak.read_text(encoding="utf-8") == "V1"     # 再次保存,备份上一版


def test_reset_removes_override(ps):
    ps.save_override("tarot_system.md", "TMP")
    info = ps.reset_override("tarot_system.md")
    assert info["overridden"] is False
    assert "职业占卜师" in ps.get_prompt("tarot_system.md")


def test_unknown_name_rejected(ps):
    with pytest.raises(KeyError):
        ps.get_prompt("../../etc/passwd")
    with pytest.raises(KeyError):
        ps.save_override("evil.md", "x")


def test_empty_or_oversize_content_rejected(ps):
    with pytest.raises(ValueError):
        ps.save_override("tarot_system.md", "   ")
    with pytest.raises(ValueError):
        ps.save_override("tarot_system.md", "x" * (ps.MAX_PROMPT_CHARS + 1))


def test_render_replaces_placeholders_and_tolerates_braces(ps):
    ps.save_override("notebook_system.md", '记录:{conversation_content} 例:{"summary":"x"}')
    out = ps.render_prompt("notebook_system.md", {"conversation_content": "对话内容"})
    assert "对话内容" in out
    assert '{"summary":"x"}' in out  # 孤立花括号不崩、不吞


def test_missing_default_raises(ps, monkeypatch, tmp_path):
    monkeypatch.setattr(ps, "PROMPTS_DIR", tmp_path / "empty")  # 默认目录也指到空处
    with pytest.raises(FileNotFoundError):
        ps.get_prompt("tarot_system.md")


def test_list_prompts_has_all_five(ps):
    names = {p["name"] for p in ps.list_prompts()}
    assert names == {
        "tarot_system.md", "astrology_system.md", "notebook_system.md",
        "daily_oracle_system.md", "daily_journey.md",
    }
