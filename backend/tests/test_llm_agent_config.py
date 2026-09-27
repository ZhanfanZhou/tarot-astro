"""Agent 的 provider/model 在线配置。

锁两件事：
  1. 覆盖层优先于 .env，且只存改过的 Agent（没改的仍跟着 .env 走）
  2. 写入前校验：未知 provider / 清单外模型 / 没配 key 的 provider，一律拒绝——
     管理页不该能把线上聊天配挂
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def store(tmp_path, monkeypatch):
    """把覆盖文件指到临时路径 —— 绝不碰 backend/data/。"""
    from services.llm import agent_config

    path = tmp_path / "llm_agents.json"
    monkeypatch.setattr(agent_config, "_STORE", path)
    return path


# ── 覆盖层 ──────────────────────────────────────────────────────────────────

def test_env_is_the_default_when_nothing_is_overridden(store):
    import config
    from services.llm import agent_config

    with patch.object(config, "READING_PROVIDER", "gemini"), \
         patch.object(config, "READING_MODEL", "gemini-3-pro"):
        assert agent_config.resolve("reading") == ("gemini", "gemini-3-pro", "env")


def test_override_wins_and_only_stores_the_agent_you_changed(store):
    import config
    from services.llm import agent_config

    with patch.object(config, "KIMI_API_KEY", "k"):
        agent_config.set_agent("reading", "kimi", "kimi-k3")

    assert agent_config.resolve("reading") == ("kimi", "kimi-k3", "override")
    # 没动过的 Agent 不该被写进覆盖文件——否则 .env 换了默认值它也跟不上
    assert set(json.loads(store.read_text(encoding="utf-8"))) == {"reading"}
    with patch.object(config, "OPENING_PROVIDER", "gemini"), \
         patch.object(config, "OPENING_MODEL", "gemini-2.5-flash"):
        assert agent_config.resolve("opening")[2] == "env"


def test_reset_falls_back_to_env(store):
    import config
    from services.llm import agent_config

    with patch.object(config, "KIMI_API_KEY", "k"):
        agent_config.set_agent("memory", "kimi", "kimi-k2.6")
    agent_config.reset_agent("memory")

    with patch.object(config, "MEMORY_PROVIDER", "gemini"), \
         patch.object(config, "MEMORY_MODEL", "gemini-2.5-flash"):
        assert agent_config.resolve("memory") == ("gemini", "gemini-2.5-flash", "env")


def test_unreadable_store_falls_back_to_env_instead_of_crashing(store):
    """配置文件坏了不该让整个应用起不来——读不出来就当没覆盖。"""
    import config
    from services.llm import agent_config

    store.write_text("{ 这不是 json", encoding="utf-8")
    with patch.object(config, "READING_PROVIDER", "gemini"), \
         patch.object(config, "READING_MODEL", "gemini-3-pro"):
        assert agent_config.resolve("reading") == ("gemini", "gemini-3-pro", "env")


# ── 写入校验 ────────────────────────────────────────────────────────────────

def test_rejects_model_that_is_not_in_the_catalog(store):
    import config
    from services.llm import agent_config

    with patch.object(config, "DEEPSEEK_API_KEY", "k"):
        with pytest.raises(ValueError) as exc:
            agent_config.set_agent("reading", "deepseek", "deepseek-chat")  # 已退役
    assert "deepseek-chat" in str(exc.value)
    assert not store.exists()


def test_rejects_provider_whose_key_is_not_configured(store):
    """没配 key 就切过去 = 从管理页把线上聊天弄挂。"""
    import config
    from services.llm import agent_config

    with patch.object(config, "KIMI_API_KEY", ""):
        with pytest.raises(ValueError) as exc:
            agent_config.set_agent("reading", "kimi", "kimi-k3")
    assert "KIMI_API_KEY" in str(exc.value)
    assert not store.exists()


def test_rejects_unknown_provider_and_agent(store):
    from services.llm import agent_config

    with pytest.raises(ValueError):
        agent_config.set_agent("reading", "bogus", "x")
    with pytest.raises(ValueError):
        agent_config.set_agent("bogus_agent", "gemini", "gemini-3-pro")


def test_get_provider_honours_the_override(store):
    import config
    from services.llm import agent_config
    from services import llm
    from services.llm.openai_provider import OpenAICompatProvider

    with patch.object(config, "DEEPSEEK_API_KEY", "k"):
        agent_config.set_agent("memory", "deepseek", "deepseek-v4-pro")
        provider = llm.get_provider("memory")
    assert isinstance(provider, OpenAICompatProvider)
    assert provider.model == "deepseek-v4-pro"


def test_reasoning_effort_rejects_an_unknown_level(monkeypatch):
    """档位写错要在读配置时就炸：留到请求时才 400，看到的会是一条 provider 的报错。"""
    import config
    import pytest as _pytest

    monkeypatch.setenv("OPENING_REASONING_EFFORT", "turbo")
    with _pytest.raises(ValueError):
        config._reasoning_effort("OPENING_REASONING_EFFORT")


def test_reasoning_effort_reads_the_agent_env_value(store, monkeypatch):
    import config
    from services.llm import agent_config

    monkeypatch.setattr(config, "MEMORY_PROVIDER", "kimi")
    monkeypatch.setattr(config, "MEMORY_MODEL", "kimi-k3")
    monkeypatch.setattr(config, "MEMORY_REASONING_EFFORT", "max")
    assert agent_config.reasoning_effort("memory") == "max"


def test_env_effort_is_dropped_when_the_model_has_no_levels(store, monkeypatch):
    """.env 的档位对哪个模型都能填；模型不认（Gemini 走的旧 SDK 发不出、K2.6 没有档）就不发。"""
    import config
    from services.llm import agent_config

    monkeypatch.setattr(config, "OPENING_PROVIDER", "gemini")
    monkeypatch.setattr(config, "OPENING_MODEL", "gemini-3.1-flash-lite")
    monkeypatch.setattr(config, "OPENING_REASONING_EFFORT", "low")
    assert agent_config.reasoning_effort("opening") == ""


# ── 思考强度的覆盖 ──────────────────────────────────────────────────────────

def test_override_stores_the_reasoning_effort(store, monkeypatch):
    import config
    from services.llm import agent_config

    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "k")
    monkeypatch.setattr(config, "READING_REASONING_EFFORT", "max")
    agent_config.set_agent("reading", "deepseek", "deepseek-v4-pro", "low")

    assert agent_config.reasoning_effort("reading") == "low"
    assert json.loads(store.read_text(encoding="utf-8"))["reading"]["reasoning_effort"] == "low"


def test_override_with_empty_effort_means_do_not_send(store, monkeypatch):
    """覆盖条目里 reasoning_effort 为空串：压过 .env 的档位，这个参数不发。"""
    import config
    from services.llm import agent_config

    monkeypatch.setattr(config, "KIMI_API_KEY", "k")
    monkeypatch.setattr(config, "OPENING_REASONING_EFFORT", "low")
    agent_config.set_agent("opening", "kimi", "kimi-k3", "")
    assert agent_config.reasoning_effort("opening") == ""


def test_override_written_before_effort_existed_keeps_the_env_effort(store, monkeypatch):
    """管理页能设思考强度之前写下的条目只有 provider/model：沿用 .env 的档位，行为不变。"""
    import config
    from services.llm import agent_config

    store.write_text(json.dumps({"opening": {"provider": "kimi", "model": "kimi-k3"}}), encoding="utf-8")
    monkeypatch.setattr(config, "OPENING_REASONING_EFFORT", "low")
    assert agent_config.reasoning_effort("opening") == "low"


@pytest.mark.parametrize("provider,model,key_attr", [
    ("kimi", "kimi-k2.6", "KIMI_API_KEY"),
    ("gemini", "gemini-2.5-flash", "GEMINI_API_KEY"),
])
def test_rejects_effort_for_a_model_without_levels(store, monkeypatch, provider, model, key_attr):
    import config
    from services.llm import agent_config

    monkeypatch.setattr(config, key_attr, "k")
    with pytest.raises(ValueError) as exc:
        agent_config.set_agent("reading", provider, model, "low")
    assert model in str(exc.value)
    assert not store.exists()


def test_rejects_an_effort_level_the_model_does_not_have(store, monkeypatch):
    import config
    from services.llm import agent_config

    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "k")
    with pytest.raises(ValueError) as exc:
        agent_config.set_agent("reading", "deepseek", "deepseek-flash", "medium")
    assert "low、high、max" in str(exc.value)
    assert not store.exists()


def test_describe_reports_effective_effort_and_the_levels(store, monkeypatch):
    import config
    from services.llm import agent_config

    monkeypatch.setattr(config, "KIMI_API_KEY", "k")
    agent_config.set_agent("opening", "kimi", "kimi-k3", "high")
    d = agent_config.describe()
    opening = next(a for a in d["agents"] if a["agent"] == "opening")
    assert opening["reasoning_effort"] == "high"
    kimi = next(p for p in d["providers"] if p["provider"] == "kimi")
    k3 = next(m for m in kimi["models"] if m["id"] == "kimi-k3")
    assert (k3["efforts"], k3["effort_default"]) == (["low", "high", "max"], "max")
    assert "efforts" not in next(m for m in kimi["models"] if m["id"] == "kimi-k2.6")
