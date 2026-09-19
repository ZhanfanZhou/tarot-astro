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


def test_save_strips_bom(ps):
    ps.save_override("tarot_system.md", "﻿BOM内容")
    saved = ps.get_prompt("tarot_system.md")
    assert "﻿" not in saved
    assert saved == "BOM内容"


def test_empty_or_oversize_content_rejected(ps):
    with pytest.raises(ValueError):
        ps.save_override("tarot_system.md", "   ")
    with pytest.raises(ValueError):
        ps.save_override("tarot_system.md", "x" * (ps.MAX_PROMPT_CHARS + 1))


def test_render_replaces_placeholders_and_tolerates_braces(ps):
    ps.save_override("notebook_system.md", '记录:{conversation_content} 例:{"summary":"x"}')
    out = ps.join(ps.render_prompt_parts("notebook_system.md", {"conversation_content": "对话内容"}))
    assert "对话内容" in out
    assert '{"summary":"x"}' in out  # 孤立花括号不崩、不吞


def test_render_parts_mark_file_text_and_variables(ps):
    ps.save_override("notebook_system.md", "前{conversation_content}后{question}")
    parts = ps.render_prompt_parts("notebook_system.md", {
        "conversation_content": "用户：{question}", "question": "Q",
    })
    assert [(p.prompt, p.variable, p.label, p.text) for p in parts] == [
        ("notebook_system.md", False, "", "前"),
        ("notebook_system.md", True, "{conversation_content}", "用户：{question}"),  # 值里的占位符不替换
        ("notebook_system.md", False, "", "后"),
        ("notebook_system.md", True, "{question}", "Q"),
    ]
    assert ps.join(ps.render_prompt_parts("notebook_system.md", {
        "conversation_content": "用户：{question}", "question": "Q",
    })) == "前用户：{question}后Q"


def test_missing_default_raises(ps, monkeypatch, tmp_path):
    monkeypatch.setattr(ps, "PROMPTS_DIR", tmp_path / "empty")  # 默认目录也指到空处
    with pytest.raises(FileNotFoundError):
        ps.get_prompt("tarot_system.md")


def test_list_prompts_covers_registry(ps):
    names = {p["name"] for p in ps.list_prompts()}
    assert names == set(ps.PROMPT_REGISTRY)


# ---------------------------------------------------------------------------
# 接线测试：三个服务确实从 prompt_service 取词（覆盖版生效 = 证明走了文件）
# ---------------------------------------------------------------------------
from models import Message, MessageRole, SessionType  # noqa: E402


def test_gemini_selects_prompt_file_by_session_type(ps):
    ps.save_override("tarot_system.md", "TAROT-FILE-PROMPT")
    ps.save_override("astrology_system.md", "ASTRO-FILE-PROMPT")
    from services.gemini_service import GeminiService
    svc = GeminiService()
    # 带一条待发的用户消息：_build_neutral 的契约是「这一轮发什么」，空会话没得发
    msgs = [Message(role=MessageRole.USER, content="问题")]
    tarot_system, _, _ = svc._build_neutral(msgs, user=None, session_type=SessionType.TAROT)
    astro_system, _, _ = svc._build_neutral(msgs, user=None, session_type=SessionType.ASTROLOGY)
    assert tarot_system.startswith("TAROT-FILE-PROMPT")
    assert astro_system.startswith("ASTRO-FILE-PROMPT")


def test_gemini_hardcoded_prompts_removed(ps):
    from services.gemini_service import GeminiService
    assert not hasattr(GeminiService, "TAROT_SYSTEM_PROMPT")
    assert not hasattr(GeminiService, "ASTROLOGY_SYSTEM_PROMPT")


def test_notebook_hardcoded_prompt_removed(ps):
    from services.notebook_service import NotebookService
    assert not hasattr(NotebookService, "NOTEBOOK_PROMPT")


def test_daily_prompt_reads_prompt_service(ps):
    """每日一签也走热加载；用户资料是塔罗/占星那一份，只是不带本命星盘。"""
    from datetime import date
    from models import User, UserProfile, UserType
    from services import daily_service
    user = User(user_id="u", user_type=UserType.REGISTERED,
                profile=UserProfile(nickname="小x", birth_year=1996, birth_month=3, birth_day=12))
    ps.save_override("daily_oracle_system.md", "DAILY:{user_context}")
    parts = daily_service.daily_oracle_prompt_parts(user, None, [], date.today())
    assert ps.join(parts) == "DAILY:\n# <用户资料>\n昵称：小x\n生日：1996年3月12日"


def test_prompts_only_name_tools_that_exist():
    """提示词里写的工具名必须真有其工具——默认版和当前生效版都查。

    改工具名时最容易漏的就是这里：代码改完、测试全绿，模型却照着提示词去调一个不存在的
    函数，而且两份提示词（仓库默认版 + backend/data/prompts/ 的在线覆盖版）要各改各的，
    只改一份线上就还是旧名字。工具名的前缀就那几个动词，照着扫。
    """
    import re
    from services import prompt_service
    from services.llm import tools as toolspecs

    known = {spec["name"] for spec in toolspecs.ALL_TOOL_SPECS}
    pattern = re.compile(r"\b(?:read|draw|get|submit|request)_[a-z_]+\b")
    for name in prompt_service.PROMPT_REGISTRY:
        for label, text in (("默认版", prompt_service.get_default(name)),
                            ("生效版", prompt_service.get_prompt(name))):
            unknown = {t for t in pattern.findall(text) if t not in known}
            assert not unknown, f"{name}（{label}）写了不存在的工具：{sorted(unknown)}"


def test_opening_system_prompt_registered_and_loadable():
    """前置占卜师提示词已登记白名单且默认文件存在（缺失会静默降级成空 prompt，必须挡住）。"""
    from services import prompt_service

    assert "opening_system.md" in prompt_service.PROMPT_REGISTRY
    content = prompt_service.get_default("opening_system.md")
    assert len(content) > 200
    # 交单工具名必须出现在提示词里，否则模型不知道要调什么
    assert "submit_reading_brief" in content
