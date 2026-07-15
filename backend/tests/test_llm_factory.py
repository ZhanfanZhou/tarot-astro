import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_default_all_gemini():
    from services import llm
    from services.llm.gemini_provider import GeminiProvider
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
