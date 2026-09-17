from dataclasses import dataclass, field
from typing import Protocol, Optional

@dataclass
class ToolCall:
    name: str
    # 纯 python 值（str/int/float/bool/list/dict），由 provider 在解析时负责转换。
    # 下游可以直接 json.dumps、直接索引，不需要再判 SDK 的私有类型。
    args: dict
    id: str = ""            # OpenAI 给真 id；Gemini 没有 id，provider 本地生成一个

@dataclass
class TurnResult:
    text: str = ""
    # 思考模型的推理内容（DeepSeek reasoning_content）。它要求这一轮带 tool_calls 时，
    # 喂回工具结果必须连同这段一起传回——resume 跨请求，所以它得随 assistant 记录落库。
    reasoning: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)

# NeutralMsg 是普通 dict，和 Message 三种角色一一对应：
#   {"role": "user", "content": str}
#   {"role": "assistant", "content": str, "tool_calls": [{"id", "name", "args"}], "reasoning": str}
#        tool_calls / reasoning 可缺省；reasoning 是思考模型那一轮的推理内容，OpenAI 兼容端原样传回
#   {"role": "tool_result", "id": str, "name": str, "result": dict}
# provider 各自翻成原生形状：Gemini 是 model[text, functionCall] / user[functionResponse]，
# OpenAI 是 assistant.tool_calls / role=tool。历史里出现未在本次声明的工具（如开场幕的
# submit_reading_brief 出现在解读 Agent 的历史里）两家都接受，2026-09 对真 Gemini 验证过。
NeutralMsg = dict

class LLMSession(Protocol):
    async def send_user(self, text: str) -> "TurnResult": ...
    async def send_tool_result(self, name: str, result: dict, call_id: str = "") -> "TurnResult": ...

class LLMProvider(Protocol):
    def open_session(
        self,
        system_prompt: str,
        history: list[NeutralMsg],      # 不含最后一条待发的 user / tool_result
        tools: Optional[list[dict]],    # 中性工具规格 [{name, description, parameters}]
        force_tool: Optional[str] = None,
    ) -> LLMSession: ...
    async def generate_json(self, prompt: str) -> str: ...
    async def generate_text(self, prompt: str, *, temperature: float = 1.0,
                            max_tokens: Optional[int] = None, timeout: int = 8) -> str: ...
