"""三家 provider 的可选模型清单 —— 唯一真源。

管理页的 provider / model / 思考强度下拉用它（用户不该手敲模型名）。

思考强度：模型条目带 efforts = 它认的 reasoning_effort 档位，effort_default = 不发这个
参数时模型自己用哪档。没有 efforts 的模型不发这个参数，管理页也不给选。
  DeepSeek V4 系：reasoning_effort ∈ low/high/max，默认 high
  Kimi K3：reasoning_effort ∈ low/high/max，默认 max（思考关不掉）
  Gemini 3.8 Flash：模型本身有 thinking_level ∈ low/medium/high（默认 medium），但
    google-generativeai 0.8.3 的 GenerationConfig 没有这个字段，发不出去

每家只列现役最新的：deepseek-flash = V4.1 Flash、deepseek-v4-pro = V4-Pro-0813（DeepSeek
账号下只有这两个）；Kimi 只用 K3；Gemini 只用最新的 flash。
核对于 2026-09（模型名对各家 /models 列表、档位对真 API 逐档实测过）。
"""

_EFFORTS = ["low", "high", "max"]

PROVIDERS = {
    "gemini": {
        "label": "Gemini",
        "key_attr": "GEMINI_API_KEY",
        "base_url_attr": None,          # 官方 SDK，不走 base_url
        "models": [
            {"id": "gemini-3.8-flash", "label": "3.8 Flash · 最新"},
        ],
    },
    "deepseek": {
        "label": "DeepSeek",
        "key_attr": "DEEPSEEK_API_KEY",
        "base_url_attr": "DEEPSEEK_BASE_URL",
        "models": [
            {"id": "deepseek-flash",  "label": "V4.1 Flash · 快且便宜",
             "efforts": _EFFORTS, "effort_default": "high"},
            {"id": "deepseek-v4-pro", "label": "V4 Pro · 最强",
             "efforts": _EFFORTS, "effort_default": "high"},
        ],
    },
    "kimi": {
        "label": "Kimi",
        "key_attr": "KIMI_API_KEY",
        "base_url_attr": "KIMI_BASE_URL",
        "models": [
            {"id": "kimi-k3", "label": "K3 · 最强",
             "efforts": _EFFORTS, "effort_default": "max"},
        ],
    },
}


def model_ids(provider: str) -> list:
    return [m["id"] for m in PROVIDERS.get(provider, {}).get("models", [])]


def efforts(provider: str, model: str) -> list:
    """该模型认的思考强度档位；清单外的模型、没有档位的模型都是 []。"""
    for m in PROVIDERS.get(provider, {}).get("models", []):
        if m["id"] == model:
            return list(m.get("efforts", []))
    return []


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
