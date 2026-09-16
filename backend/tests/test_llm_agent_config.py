"""Agent 的 provider/model 在线配置 + 「不支持强制调用就不用」的降级。

锁三件事：
  1. 覆盖层优先于 .env，且只存改过的 Agent（没改的仍跟着 .env 走）
  2. 写入前校验：未知 provider / 清单外模型 / 没配 key 的 provider，一律拒绝——
     管理页不该能把线上聊天配挂
  3. 模型不支持指定函数的强制调用时，force_tool 被静默丢弃而不是报错；
     守卫第 3 层还在，代价至多多两轮追问
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


# ── 强制调用能力 ────────────────────────────────────────────────────────────

def test_catalog_knows_which_models_can_force_a_named_tool():
    from services.llm import catalog

    # Kimi 全系不支持：k3 关不掉思考，而 named tool_choice 与思考态互斥（真 key 实测）
    assert catalog.supports_forced_tool("kimi", "kimi-k3") is False
    assert catalog.supports_forced_tool("kimi", "kimi-k2.6") is False
    assert catalog.supports_forced_tool("gemini", "gemini-3-pro") is True
    assert catalog.supports_forced_tool("deepseek", "deepseek-flash") is True
    # 清单外的一律保守：少一层守卫无害，传给不支持的模型会直接报错
    assert catalog.supports_forced_tool("kimi", "kimi-k9-未来款") is False


def test_incapable_model_drops_force_tool_instead_of_erroring(store, monkeypatch):
    """Kimi 收到 named tool_choice 会 400，所以这一层干脆不上膛——静默丢弃，不抛异常。"""
    import config
    from services.llm import agent_config
    from services import llm

    with patch.object(config, "KIMI_API_KEY", "k"):
        agent_config.set_agent("opening", "kimi", "kimi-k3")
        provider = llm.get_provider("opening")
        session = provider.open_session("SYS", [], tools=None,
                                        force_tool="submit_reading_brief")
    assert session._force is None


def test_capable_model_still_forces(store):
    import config
    from services.llm import agent_config
    from services import llm

    with patch.object(config, "DEEPSEEK_API_KEY", "k"):
        agent_config.set_agent("opening", "deepseek", "deepseek-flash")
        provider = llm.get_provider("opening")
        session = provider.open_session("SYS", [], tools=None,
                                        force_tool="submit_reading_brief")
    assert session._force == {"type": "function",
                              "function": {"name": "submit_reading_brief"}}


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
