"""三个 Agent 的 provider/model：.env 是默认，管理页可在线覆盖。

与提示词那套同构（见 prompt_service）：
  默认层  backend/config.py 从 .env 读的 *_PROVIDER / *_MODEL
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
    "memory":  "记忆（会话结束生成笔记，只出 JSON）",
}

# Agent → (provider 配置项, model 配置项)
AGENT_ENV_ATTRS = {
    "opening": ("OPENING_PROVIDER", "OPENING_MODEL"),
    "reading": ("READING_PROVIDER", "READING_MODEL"),
    "memory":  ("MEMORY_PROVIDER", "MEMORY_MODEL"),
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


def resolve(agent: str) -> tuple:
    """(provider, model, source) —— source ∈ {"override", "env"}，给管理页显示用。"""
    prov_attr, model_attr = AGENT_ENV_ATTRS[agent]
    entry = _read_overrides().get(agent)
    if isinstance(entry, dict) and entry.get("provider") and entry.get("model"):
        return entry["provider"].lower().strip(), entry["model"].strip(), "override"
    return getattr(config, prov_attr).lower().strip(), getattr(config, model_attr), "env"


def validate(provider: str, model: str) -> None:
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


def set_agent(agent: str, provider: str, model: str) -> None:
    if agent not in AGENT_ENV_ATTRS:
        raise ValueError(f"未知 Agent：{agent}")
    provider = (provider or "").lower().strip()
    model = (model or "").strip()
    validate(provider, model)
    data = _read_overrides()
    data[agent] = {"provider": provider, "model": model}
    _write_overrides(data)
    print(f"[LLMConfig] {agent} → {provider} / {model}")


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
            "source": source,
            "env_provider": getattr(config, prov_attr),
            "env_model": getattr(config, model_attr),
            "key_ready": bool(getattr(config, meta["key_attr"], "")) if meta else False,
            "forced_tool": catalog.supports_forced_tool(provider, model),
            "in_catalog": meta is not None and model in catalog.model_ids(provider),
        })
    return {"agents": agents, "providers": catalog.as_options()}
