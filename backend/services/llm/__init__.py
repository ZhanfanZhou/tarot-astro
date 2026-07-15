"""多 provider LLM 层：按 Agent 取配置好的 provider。"""
import config
from services.llm.base import ToolCall, TurnResult, LLMProvider, LLMSession
from services.llm.gemini_provider import GeminiProvider
from services.llm.openai_provider import OpenAICompatProvider

_AGENT_CONFIG = {
    "opening": ("OPENING_PROVIDER", "OPENING_MODEL"),
    "reading": ("READING_PROVIDER", "READING_MODEL"),
    "memory":  ("MEMORY_PROVIDER", "MEMORY_MODEL"),
}


def get_provider(agent: str) -> LLMProvider:
    prov_attr, model_attr = _AGENT_CONFIG[agent]
    provider = getattr(config, prov_attr).lower().strip()
    model = getattr(config, model_attr)
    if provider == "gemini":
        return GeminiProvider(model)
    if provider == "deepseek":
        return OpenAICompatProvider(model, config.DEEPSEEK_BASE_URL, config.DEEPSEEK_API_KEY, "deepseek")
    if provider == "kimi":
        return OpenAICompatProvider(model, config.KIMI_BASE_URL, config.KIMI_API_KEY, "kimi")
    raise ValueError(f"未知 provider: {provider}（agent={agent}）。支持 gemini/deepseek/kimi")


__all__ = ["get_provider", "ToolCall", "TurnResult", "LLMProvider", "LLMSession"]
