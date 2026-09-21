"""多 provider LLM 层：按 Agent 取配置好的 provider。"""
import config
from services.llm import agent_config, catalog
from services.llm.base import ToolCall, TurnResult, LLMProvider, LLMSession
from services.llm.gemini_provider import GeminiProvider
from services.llm.openai_provider import OpenAICompatProvider

AGENT_CONFIG = agent_config.AGENT_ENV_ATTRS


def get_provider(agent: str) -> LLMProvider:
    """取该 Agent 当前生效的 provider（管理页覆盖优先，否则 .env）。"""
    provider, model, _ = agent_config.resolve(agent)
    meta = catalog.PROVIDERS.get(provider)
    if meta is None:
        raise ValueError(
            f"未知 provider: {provider}（agent={agent}）。支持 "
            f"{'/'.join(catalog.PROVIDERS)}"
        )

    api_key = getattr(config, meta["key_attr"], "")
    # 空 key 交给 openai SDK 会得到一句「请设置 OPENAI_API_KEY」——指向一个本项目
    # 根本不用的变量，够人查半天。在这里直接说清该填哪一项。
    if not api_key:
        raise ValueError(
            f"{agent} 用的是 {meta['label']}，但 {meta['key_attr']} 为空。"
            f"请在 .env 里填 {meta['key_attr']}，或在管理页换一家。"
        )

    if provider == "gemini":
        return GeminiProvider(model)

    # 思考强度只有 Kimi 有（reasoning_effort ∈ low/high/max，默认 max）。DeepSeek 不认
    # 这个字段，发过去只会多一个它不认识的参数，不发。
    effort = agent_config.reasoning_effort(agent) if provider == "kimi" else ""
    return OpenAICompatProvider(
        model, getattr(config, meta["base_url_attr"]), api_key, provider,
        reasoning_effort=effort,
    )


__all__ = ["get_provider", "ToolCall", "TurnResult", "LLMProvider", "LLMSession"]
