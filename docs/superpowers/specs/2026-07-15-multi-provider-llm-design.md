# 三 Agent 多 Provider（Gemini / DeepSeek / Kimi）· 设计文档

创建：2026-07-15（原为实施计划）｜ 改写为设计文档：2026-09-15
状态：**代码完成，真 key 验证未完成**。对应总纲缺口 7。

关系：[多 Agent 架构与占卜工作流重构 · 现状总纲](2026-07-14-multi-agent-redesign-design.md) 第 7 项的详细设计。
探索期未识别，实现期临时插入，无独立评审——本文即该项的设计记录。

---

## 1. 动机

三个 Agent 职责与难度差异很大：

| Agent | 职责 | 对模型的要求 |
|---|---|---|
| 前置（opening） | 开场定义占卜、交单 | 重度依赖 function calling，且依赖强制工具调用 |
| 解读（reading） | 抽牌/取盘、解读对话 | 重度依赖 function calling + 长文本质量 |
| 记忆（memory） | 会话结束生成笔记 JSON | 只产 JSON，无工具，便宜模型足够 |

硬绑 Gemini 时这三者只能用同一个模型，无法按 Agent 调成本与质量。

**目标**：每个 Agent 在 `.env` 里独立选 provider 与 model；一项都不配 → 三个 Agent 全部沿用 Gemini，行为逐字不变。

## 2. 架构：session 形态的 provider 抽象

新增 `backend/services/llm/`：

```
services/llm/
  base.py            中性契约：ToolCall / TurnResult / LLMSession / LLMProvider
  tools.py           工具规格唯一真源（5 个工具的 name/description/parameters）
  gemini_provider.py GeminiProvider —— google-generativeai 原生
  openai_provider.py OpenAICompatProvider —— DeepSeek / Kimi 共用
  __init__.py        get_provider(agent) 工厂
```

**为什么是 session 形态而不是无状态单次调用**：多轮工具循环需要携带状态。Gemini 用 `chat.send_message_async` 维护客户端历史，OpenAI 兼容则要自己累积 messages 数组——把状态交给 session 对象持有，两边各自用最自然的方式实现。

### 2.1 中性契约

```python
@dataclass
class ToolCall:
    name: str
    args: dict
    id: str = ""            # OpenAI 需要；Gemini 用 name 兜

@dataclass
class TurnResult:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)

# NeutralMsg 就是普通 dict：{"role": "user"|"assistant", "content": str}

class LLMSession(Protocol):
    async def send_user(self, text: str) -> TurnResult: ...
    async def send_tool_result(self, name: str, result: dict, call_id: str = "") -> TurnResult: ...

class LLMProvider(Protocol):
    def open_session(self, system_prompt: str, history: list[NeutralMsg],
                     tools: Optional[list[dict]], force_tool: Optional[str] = None) -> LLMSession: ...
    async def generate_json(self, prompt: str) -> str: ...
    async def generate_text(self, prompt: str, *, temperature: float = 1.0,
                            max_tokens: int = 200, timeout: int = 8) -> str: ...
```

**中性消息只需 `{role, content}` 纯文本**，这不是简化，是对现状的准确刻画：历史里的抽牌结果与星盘也早已被转成文本 + model 确认语，`function_call` / `function_response` **从不进入初始历史**，只在一次 `stream_response` 的 live session 里被线程化。

**为什么 provider 只需非流式"一轮"能力**：`stream_response` 内部本就是 `stream=False` 取全文后手动切 50 字块推给前端。

### 2.2 三个入口方法的用途

- `open_session` —— Agent Loop（前置 / 解读），带工具与多轮
- `generate_json` —— 记忆 Agent 生成笔记
- `generate_text` —— 开场白（无工具、短输出、带超时）

### 2.3 Gemini 路径零回归

`GeminiSession` 内部复刻改动前 `gemini_service` 的 SDK 用法：`model.start_chat(history=…)` + `chat.send_message_async(…, stream=False)`，工具结果用 `genai.protos.Part(function_response=…)`，系统提示词仍拼成"user 首轮 + model『我明白了。』"。抽象层只是把这套用法包起来，不改写它。

`google.generativeai` 现已**完全收敛在 `gemini_provider.py` 一处**，`services/` 与 `routers/` 其余位置零引用。

### 2.4 OpenAI 兼容路径

DeepSeek 与 Kimi 均为 OpenAI 兼容 API，共用 `OpenAICompatProvider`，仅 `base_url` / `api_key` / `model` 不同。

一个关键约束：**每轮只保留第一个 tool_call**。OpenAI 协议要求每个 `tool_call` 都要有配对的 `tool` 响应消息，而 Agent Loop 本就只处理第一个函数调用——不截断就会在下一轮因缺少配对响应报错。

## 3. 配置

```bash
# 不配任何一项 → 三个 Agent 全部走 Gemini，行为与改动前逐字一致
DEEPSEEK_API_KEY=            # DeepSeek / Kimi 各自一个 key，同一家不重复填
DEEPSEEK_BASE_URL=https://api.deepseek.com
KIMI_API_KEY=
KIMI_BASE_URL=https://api.moonshot.cn/v1

OPENING_PROVIDER=gemini      # gemini | deepseek | kimi
OPENING_MODEL=
READING_PROVIDER=gemini
READING_MODEL=
MEMORY_PROVIDER=gemini
MEMORY_MODEL=
```

工厂 `get_provider(agent)` 按 `_AGENT_CONFIG` 映射取 `{AGENT}_PROVIDER` / `{AGENT}_MODEL`，未知 provider 抛 `ValueError`。

## 4. 接入点

| 位置 | 接入方式 |
|---|---|
| `gemini_service.stream_response` | Agent Loop 按相位取 provider：开场 `get_provider("opening")`，解读 `get_provider("reading")`；星盘移交时从前者切到后者 |
| `notebook_service` | 生成笔记摘要走 `get_provider("memory").generate_json` |
| `opening_service._generate_greeting_via_llm` | 开场白走 `get_provider("opening").generate_text` |

工具规格从 `gemini_service` 里的 5 个 `FunctionDeclaration` 常量搬到 `services/llm/tools.py`，成为唯一真源；两个 provider 各自转成自己的格式（Gemini 的 `FunctionDeclaration` / OpenAI 的 `tools` 数组）。

## 5. 测试

186 个后端测试全绿。原先 patch `genai.GenerativeModel` / `start_chat` 的三个测试文件迁到 **provider 边界**——patch `get_provider` 返回按脚本吐 `TurnResult` 的假 session（`tests/_fake_llm.py`）。这比原来干净：测试断言的是 Agent Loop 的行为，不是 SDK 的调用形状。

**测试全程 mock provider，绝不发真实请求，绝不碰 `backend/data/`。**

## 6. 未完成：真 key 验证

这是本项唯一的未完成部分，也是**唯一的风险所在**——真实 DeepSeek/Kimi 的 tool_call 参数格式、`tool_choice` 支持度在 mock 下完全看不见。

`backend/scripts/check_providers.py` 覆盖四个 mock 看不见的点，按当前 `.env` 配置实跑：

| 检查 | 验什么 | 风险 |
|---|---|---|
| `memory · generate_json` | JSON 模式能否出合法 JSON | 低（纯 JSON，无工具） |
| `reading · 文本生成` | 基本文本往返 | 低 |
| `opening · tool_call` | 工具调用能否触发、参数是否合法 | **高** |
| `opening · force_tool 强制交单` | `tool_choice` 指定函数支不支持——**守卫第 2 层所依赖** | **最高**，DeepSeek/Kimi 支持度参差 |

**任何一次换 provider 或换 model 之后都应重跑此脚本。**

脚本之外仍需人工联调的：跨 provider 移交（opening=Gemini、reading=DeepSeek 或反之，验证星盘路线移交后 reading provider 拿到完整历史、口吻不断裂）。

## 7. 当前实际配置（2026-09-15）

根 `.env` 三个 Agent **均已切到 DeepSeek**（`OPENING/READING/MEMORY_PROVIDER=deepseek`，模型 `deepseek-flash`）。
即：多 provider 路径已经是实际运行路径，不再是待启用的开关——`check_providers.py` 的四项结果因此是当前线上行为的直接依据，不是可选的预验证。
