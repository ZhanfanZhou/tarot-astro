"""三家 provider 的可选模型清单 —— 唯一真源。

两处用它，所以只能有一份：
  1. 管理页的 provider / model 下拉（用户不该手敲模型名）
  2. 「这个模型支不支持指定函数的强制调用」——守卫第 2 层要不要上膛

`forced_tool` 只影响守卫第 2 层（追问预算用尽时逼开场 Agent 交单）。为 False 时
这一层直接不用，提示词里的 <本轮强制> 照发，守卫第 3 层（第 5 句用户消息硬翻相位）
照样兜底 —— 代价至多是多两轮追问，不影响任何主要功能。

核对于 2026-09（force_tool 一栏为真 key 实测，不是照文档抄的）：
  gemini    tool_config mode=ANY + allowed_function_names，全系支持
  deepseek  支持，但思考态下传 named tool_choice 会 400 —— provider 在这一次调用上
            自动关思考（见 openai_provider._NO_THINKING），对使用者无感
  kimi      全系不支持。k3 实测报
              "tool_choice 'specified' is incompatible with thinking enabled"
            和 DeepSeek 同一个冲突，但 k3「always enables thinking」、没有关闭开关，
            所以绕不过去；k2.6 / k2.7-code 则连 required 都不认。
            文档只写了「k3 支持 required」，没提 named 这一层——以实测为准。
"""

PROVIDERS = {
    "gemini": {
        "label": "Gemini",
        "key_attr": "GEMINI_API_KEY",
        "base_url_attr": None,          # 官方 SDK，不走 base_url
        "models": [
            {"id": "gemini-3.1-flash-lite", "label": "3.1 Flash Lite · 快且便宜", "forced_tool": True},
            {"id": "gemini-3-pro",          "label": "3 Pro · 最强",             "forced_tool": True},
            {"id": "gemini-2.5-flash",      "label": "2.5 Flash · 均衡",         "forced_tool": True},
        ],
    },
    "deepseek": {
        "label": "DeepSeek",
        "key_attr": "DEEPSEEK_API_KEY",
        "base_url_attr": "DEEPSEEK_BASE_URL",
        "models": [
            {"id": "deepseek-flash",  "label": "V4.1 Flash · 快且便宜", "forced_tool": True},
            {"id": "deepseek-v4-pro", "label": "V4 Pro · 最强",        "forced_tool": True},
        ],
    },
    "kimi": {
        "label": "Kimi",
        "key_attr": "KIMI_API_KEY",
        "base_url_attr": "KIMI_BASE_URL",
        "models": [
            {"id": "kimi-k3",   "label": "K3 · 最强",   "forced_tool": False},
            {"id": "kimi-k2.6", "label": "K2.6 · 便宜", "forced_tool": False},
        ],
    },
}


def model_ids(provider: str) -> list:
    return [m["id"] for m in PROVIDERS.get(provider, {}).get("models", [])]


def supports_forced_tool(provider: str, model: str) -> bool:
    """清单外的模型一律按「不支持」处理。

    猜错的两个方向不对称：误判为支持 → 强制那一轮直接报错，整条请求挂；误判为不支持
    → 只是少一层守卫，第 3 层还在。所以未知一律保守，并由调用方打一行日志说明。
    """
    for m in PROVIDERS.get(provider, {}).get("models", []):
        if m["id"] == model:
            return m["forced_tool"]
    return False


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
