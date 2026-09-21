# 三 Agent 多 Provider

三个 Agent 各自独立选 provider 与 model：

| Agent | 职责 | 对模型的要求 |
|---|---|---|
| **opening** 前置 | 开场定义占卜、交单 | 重度依赖 function calling |
| **reading** 解读 | 抽牌 / 取盘、解读对话 | 重度依赖 function calling + 长文本质量 |
| **memory** 记忆 | 会话结束写笔记本 | 只产 JSON、无工具，便宜模型足够 |

---

## 1. 架构：session 形态的 provider 抽象

```
services/llm/
  base.py             中性契约：ToolCall / TurnResult / LLMSession / LLMProvider
  tools.py            工具规格唯一真源（含 INTERRUPT_TOOL_NAMES 与三套工具集）
  gemini_provider.py  GeminiProvider —— google-generativeai 原生
  openai_provider.py  OpenAICompatProvider —— DeepSeek / Kimi 共用
  agent_config.py     每个 Agent 用哪个 provider/model（.env + 管理页覆盖层）
  catalog.py          可选 provider / model 清单
  __init__.py         get_provider(agent) 工厂
```

**为什么是 session 而不是无状态单次调用**：多轮工具循环要带状态。
Gemini 用 `chat.send_message_async` 维护客户端历史，OpenAI 兼容要自己累积 messages 数组——
把状态交给 session 对象持有，两边各自用最自然的方式实现。

```python
@dataclass
class ToolCall:
    name: str; args: dict; id: str = ""     # OpenAI 需要；Gemini 用 name 兜

@dataclass
class TurnResult:
    text: str = ""; tool_calls: list[ToolCall] = ...

class LLMSession(Protocol):
    async def send_user(self, text) -> TurnResult: ...
    async def send_tool_result(self, name, result, call_id="") -> TurnResult: ...

class LLMProvider(Protocol):
    def open_session(self, system_prompt, history, tools) -> LLMSession: ...
    async def generate_json(self, prompt) -> str: ...
    async def generate_text(self, prompt, *, temperature=1.0, max_tokens=200, timeout=8) -> str: ...
```

三个入口方法的用途：`open_session` 给 Agent Loop（前置 / 解读）；
`generate_json` 给记忆 Agent；`generate_text` 给开场白、每日一签的当日解读、心灵奇旅。

**provider 只需非流式「一轮」能力**：SSE 那一层本就是取到全文后手动切块推给前端。

### OpenAI 兼容路径的一个硬约束

**每轮只保留第一个 tool_call。** OpenAI 协议要求每个 `tool_call` 都要有配对的 `tool` 响应消息，
而 Agent Loop 本就只处理第一个函数调用——不截断就会在下一轮因缺少配对响应报错。

---

## 2. 配置

```bash
DEEPSEEK_API_KEY= ; DEEPSEEK_BASE_URL=https://api.deepseek.com
KIMI_API_KEY=     ; KIMI_BASE_URL=https://api.moonshot.cn/v1
GEMINI_API_KEY=

OPENING_PROVIDER / OPENING_MODEL      # provider ∈ gemini | deepseek | kimi
READING_PROVIDER / READING_MODEL
MEMORY_PROVIDER / MEMORY_MODEL
```

**provider 和 model 成对出现，换 provider 就要一起换 model**——两行是一组，不要只改一行。
未知 provider 抛 `ValueError`。管理页可在线覆盖（见 [后台管理](admin-panel.md) §4）。

**思考强度** `OPENING_/READING_/MEMORY_REASONING_EFFORT` ∈ `low | high | max`，
留空 = 不发这个参数。**目前只有 Kimi 认**：K3 的思考关不掉而默认就是 max，
一句问候语它也要想两百多个 token、十几秒才回。这一项只在 `.env`，管理页不覆盖。

---

## 3. 接入点

| 位置 | 接入方式 |
|---|---|
| `gemini_service.stream_response` | Agent Loop 按相位取 provider：开场 `opening`，解读 `reading`；星盘移交时从前者切到后者 |
| `notebook_service` | `memory` 的 `generate_json` |
| `opening_service.build_greeting` | `opening` 的 `generate_text` |
| `routers/daily.py` | 当日解读与心灵奇旅走 `reading` 的 `generate_text` |

`google.generativeai` 完全收敛在 `gemini_provider.py` 一处，`services/` 与 `routers/` 其余位置零引用。

---

## 4. 真 key 自检

真实 provider 的 tool_call 参数格式在 mock 下完全看不见。
`backend/scripts/check_providers.py` 覆盖这三个点：

| 检查 | 验什么 | 风险 |
|---|---|---|
| `memory · generate_json` | JSON 模式能否出合法 JSON | 低 |
| `reading · 文本生成` | 基本文本往返 | 低 |
| `opening · tool_call` | 工具调用能否触发、参数是否合法 | **高** |

**换 provider 或换 model 之后都要重跑这个脚本。**
脚本之外仍需人工联调的只有跨 provider 移交（开场与解读配不同家时，
验证移交后解读 provider 拿到完整历史、口吻不断裂）。

单元测试全程 mock provider（`tests/_fake_llm.py` 按脚本吐 `TurnResult`），
断言的是 Agent Loop 的行为而不是 SDK 的调用形状，**绝不发真实请求**。
