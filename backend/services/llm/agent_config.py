"""三个 Agent 的 provider/model/思考强度：.env 是默认，管理页可在线覆盖。

与提示词那套同构（见 prompt_service）：
  默认层  backend/config.py 从 .env 读的 *_PROVIDER / *_MODEL / *_REASONING_EFFORT
  覆盖层  backend/data/llm_agents.json（管理页写，gitignored，git pull 不冲掉）
每次 get_provider 实时读盘 —— 管理页改完下一次请求即生效，无需重启。

覆盖只存「改过的 Agent」。没改过的不写进去，这样 .env 换了默认值，没被覆盖的
Agent 会跟着动，不会被一份陈旧快照钉死。
"""
import json
import os
from pathlib import Path
from uuid import uuid4

import config
from services.llm import catalog

# 与 TAROT_DB_FILE 同一套约定：默认落 data/，测试指向临时文件。
# 不给出口的话，用过一次管理页之后整个测试套就会去读线上配置。
_STORE = Path(os.getenv("TAROT_LLM_CONFIG_FILE", str(config.DATA_DIR / "llm_agents.json")))

AGENT_LABELS = {
    "opening": "前置（开场定义占卜、交单）",
    "reading": "解读（抽牌/取盘、解读对话）",
    "memory":  "记忆（会话结束写笔记本：占卜笔记 + 用户画像，只出 JSON）",
}

# Agent → (provider 配置项, model 配置项)
AGENT_ENV_ATTRS = {
    "opening": ("OPENING_PROVIDER", "OPENING_MODEL"),
    "reading": ("READING_PROVIDER", "READING_MODEL"),
    "memory":  ("MEMORY_PROVIDER", "MEMORY_MODEL"),
}

# Agent → 思考强度配置项（.env 默认层；覆盖层条目里的 reasoning_effort 优先）
AGENT_EFFORT_ATTRS = {
    "opening": "OPENING_REASONING_EFFORT",
    "reading": "READING_REASONING_EFFORT",
    "memory":  "MEMORY_REASONING_EFFORT",
}


def _read_overrides() -> dict:
    """读覆盖层。文件不存在或坏了都当「没有覆盖」——配置读不出来不该让整个应用起不来。"""
    if not _STORE.exists():
        return {}
    try:
        data = json.loads(_STORE.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:
        print(f"[LLMConfig] ⚠️ 覆盖文件读取失败，回退 .env：{e}")
        return {}
    return data if isinstance(data, dict) else {}


def _write_overrides(data: dict) -> None:
    """原子写：先落 tmp 再 replace，中途挂掉不会留下半个文件。"""
    _STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STORE.with_suffix(f".{os.getpid()}.{uuid4().hex}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, _STORE)


def _resolve(agent: str) -> tuple:
    """(provider, model, 配置的思考强度, source)。

    覆盖条目里没有 reasoning_effort 这个键（管理页能设思考强度之前写下的）就沿用 .env，
    这样老条目的行为不变；键在、值为空 = 管理页明确选了「不发」。
    """
    prov_attr, model_attr = AGENT_ENV_ATTRS[agent]
    env_effort = getattr(config, AGENT_EFFORT_ATTRS[agent], "")
    entry = _read_overrides().get(agent)
    if isinstance(entry, dict) and entry.get("provider") and entry.get("model"):
        effort = entry["reasoning_effort"] if "reasoning_effort" in entry else env_effort
        return entry["provider"].lower().strip(), entry["model"].strip(), effort, "override"
    return getattr(config, prov_attr).lower().strip(), getattr(config, model_attr), env_effort, "env"


def resolve(agent: str) -> tuple:
    """(provider, model, source) —— source ∈ {"override", "env"}，给管理页显示用。"""
    provider, model, _, source = _resolve(agent)
    return provider, model, source


def reasoning_effort(agent: str) -> str:
    """该 Agent 这次要发的思考强度（""=不发）。

    配置的档位只有当前模型认才发：.env 那一层对哪个模型都能填，模型不认的档位就当没配。
    """
    provider, model, effort, _ = _resolve(agent)
    return effort if effort in catalog.efforts(provider, model) else ""


def validate(provider: str, model: str, reasoning_effort: str = "") -> None:
    """管理页写入前的校验。放行一个配错的组合 = 从管理页把线上聊天弄挂。"""
    meta = catalog.PROVIDERS.get(provider)
    if meta is None:
        raise ValueError(f"未知 provider：{provider}")
    if model not in catalog.model_ids(provider):
        raise ValueError(
            f"{meta['label']} 没有这个模型：{model}。可选：{'、'.join(catalog.model_ids(provider))}"
        )
    if not getattr(config, meta["key_attr"], ""):
        raise ValueError(f"{meta['label']} 的 {meta['key_attr']} 没配，先在 .env 填好再切过来")
    supported = catalog.efforts(provider, model)
    if reasoning_effort and reasoning_effort not in supported:
        raise ValueError(
            f"{model} 不支持思考强度 {reasoning_effort}。"
            + (f"可选：{'、'.join(supported)}" if supported else "这个模型不能设思考强度")
        )


def set_agent(agent: str, provider: str, model: str, reasoning_effort: str = "") -> None:
    """reasoning_effort 为空 = 不发这个参数，用模型自己的默认档。"""
    if agent not in AGENT_ENV_ATTRS:
        raise ValueError(f"未知 Agent：{agent}")
    provider = (provider or "").lower().strip()
    model = (model or "").strip()
    reasoning_effort = (reasoning_effort or "").lower().strip()
    validate(provider, model, reasoning_effort)
    data = _read_overrides()
    data[agent] = {"provider": provider, "model": model, "reasoning_effort": reasoning_effort}
    _write_overrides(data)
    print(f"[LLMConfig] {agent} → {provider} / {model} / 思考强度 {reasoning_effort or '模型默认'}")


def reset_agent(agent: str) -> None:
    """删掉覆盖，回到 .env 的值。"""
    if agent not in AGENT_ENV_ATTRS:
        raise ValueError(f"未知 Agent：{agent}")
    data = _read_overrides()
    if data.pop(agent, None) is not None:
        _write_overrides(data)
        print(f"[LLMConfig] {agent} 已恢复 .env 默认")


def describe() -> dict:
    """管理页要的全部：每个 Agent 的现状 + 可选项。"""
    agents = []
    for agent in AGENT_ENV_ATTRS:
        provider, model, source = resolve(agent)
        prov_attr, model_attr = AGENT_ENV_ATTRS[agent]
        meta = catalog.PROVIDERS.get(provider)
        agents.append({
            "agent": agent,
            "label": AGENT_LABELS[agent],
            "provider": provider,
            "model": model,
            # 这次实际发的档位（""=不发，模型用 effort_default）
            "reasoning_effort": reasoning_effort(agent),
            "source": source,
            "env_provider": getattr(config, prov_attr),
            "env_model": getattr(config, model_attr),
            "env_reasoning_effort": getattr(config, AGENT_EFFORT_ATTRS[agent], ""),
            "key_ready": bool(getattr(config, meta["key_attr"], "")) if meta else False,
            "in_catalog": meta is not None and model in catalog.model_ids(provider),
        })
    return {"agents": agents, "providers": catalog.as_options()}
