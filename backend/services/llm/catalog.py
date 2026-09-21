"""三家 provider 的可选模型清单 —— 唯一真源。

管理页的 provider / model 下拉用它（用户不该手敲模型名）。

核对于 2026-09。
"""

PROVIDERS = {
    "gemini": {
        "label": "Gemini",
        "key_attr": "GEMINI_API_KEY",
        "base_url_attr": None,          # 官方 SDK，不走 base_url
        "models": [
            {"id": "gemini-3.1-flash-lite", "label": "3.1 Flash Lite · 快且便宜"},
            {"id": "gemini-3-pro",          "label": "3 Pro · 最强"},
            {"id": "gemini-2.5-flash",      "label": "2.5 Flash · 均衡"},
        ],
    },
    "deepseek": {
        "label": "DeepSeek",
        "key_attr": "DEEPSEEK_API_KEY",
        "base_url_attr": "DEEPSEEK_BASE_URL",
        "models": [
            {"id": "deepseek-flash",  "label": "V4.1 Flash · 快且便宜"},
            {"id": "deepseek-v4-pro", "label": "V4 Pro · 最强"},
        ],
    },
    "kimi": {
        "label": "Kimi",
        "key_attr": "KIMI_API_KEY",
        "base_url_attr": "KIMI_BASE_URL",
        "models": [
            {"id": "kimi-k3",   "label": "K3 · 最强"},
            {"id": "kimi-k2.6", "label": "K2.6 · 便宜"},
        ],
    },
}


def model_ids(provider: str) -> list:
    return [m["id"] for m in PROVIDERS.get(provider, {}).get("models", [])]


def as_options() -> list:
    """给管理页的下拉数据（不含 key/base_url 这类配置项名）。"""
    return [
        {
            "provider": name,
            "label": meta["label"],
            "models": [dict(m) for m in meta["models"]],
        }
        for name, meta in PROVIDERS.items()
    ]
