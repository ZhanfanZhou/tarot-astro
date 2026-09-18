import sys
from pathlib import Path
from unittest.mock import patch

import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_default_all_gemini():
    import config
    from services import llm
    from services.llm.gemini_provider import GeminiProvider
    with patch.object(config, "GEMINI_API_KEY", "k"):
        for agent in ("opening", "reading", "memory"):
            assert isinstance(llm.get_provider(agent), GeminiProvider)


def test_reading_can_be_deepseek():
    import config
    from services import llm
    from services.llm.openai_provider import OpenAICompatProvider
    with patch.object(config, "READING_PROVIDER", "deepseek"), \
         patch.object(config, "DEEPSEEK_API_KEY", "k"):
        p = llm.get_provider("reading")
    assert isinstance(p, OpenAICompatProvider)
    assert p.model == config.READING_MODEL


def test_memory_can_be_kimi():
    import config
    from services import llm
    from services.llm.openai_provider import OpenAICompatProvider
    with patch.object(config, "MEMORY_PROVIDER", "kimi"), \
         patch.object(config, "KIMI_API_KEY", "k"):
        assert isinstance(llm.get_provider("memory"), OpenAICompatProvider)


def test_unknown_provider_raises():
    import config
    from services import llm
    with patch.object(config, "OPENING_PROVIDER", "bogus"):
        try:
            llm.get_provider("opening"); assert False
        except ValueError:
            pass


def test_openai_compat_provider_without_key_says_which_var_to_fill(monkeypatch):
    """空 key 必须报出本项目的变量名。

    交给 openai SDK 会得到「请设置 OPENAI_API_KEY」——本项目根本没有这个变量，
    足够让人往错误方向查半天。
    """
    import config
    from services import llm

    monkeypatch.setattr(config, "OPENING_PROVIDER", "deepseek")
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "")

    with pytest.raises(ValueError) as exc:
        llm.get_provider("opening")
    assert "DEEPSEEK_API_KEY" in str(exc.value)
    assert "OPENAI_API_KEY" not in str(exc.value)


def test_kimi_gets_the_configured_reasoning_effort():
    """.env 的档位要真的落到 provider 上（_effort 为空 = 不发这个参数）。"""
    import config
    from services import llm
    with patch.object(config, "OPENING_PROVIDER", "kimi"), \
         patch.object(config, "OPENING_MODEL", "kimi-k3"), \
         patch.object(config, "OPENING_REASONING_EFFORT", "low"), \
         patch.object(config, "KIMI_API_KEY", "k"):
        assert llm.get_provider("opening")._effort == "low"


def test_reasoning_effort_is_not_sent_to_other_providers():
    """DeepSeek 不认 reasoning_effort（它关思考用的是另一套字段）：配了也不发过去。"""
    import config
    from services import llm
    with patch.object(config, "READING_PROVIDER", "deepseek"), \
         patch.object(config, "READING_REASONING_EFFORT", "low"), \
         patch.object(config, "DEEPSEEK_API_KEY", "k"):
        assert llm.get_provider("reading")._effort == ""
