from dataclasses import dataclass, field
from typing import Protocol, Optional

@dataclass
class ToolCall:
    name: str
    # 纯 python 值（str/int/float/bool/list/dict），由 provider 在解析时负责转换。
    # 下游可以直接 json.dumps、直接索引，不需要再判 SDK 的私有类型。
    args: dict
    id: str = ""            # OpenAI 需要；Gemini 用 name 兜

@dataclass
class TurnResult:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)

# NeutralMsg 就是普通 dict：{"role": "user"|"assistant", "content": str}
NeutralMsg = dict

class LLMSession(Protocol):
    async def send_user(self, text: str) -> "TurnResult": ...
    async def send_tool_result(self, name: str, result: dict, call_id: str = "") -> "TurnResult": ...

class LLMProvider(Protocol):
    def open_session(
        self,
        system_prompt: str,
        history: list[NeutralMsg],      # 纯文本轮，不含最后一条待发的 user
        tools: Optional[list[dict]],    # 中性工具规格 [{name, description, parameters}]
        force_tool: Optional[str] = None,
    ) -> LLMSession: ...
    async def generate_json(self, prompt: str) -> str: ...
    async def generate_text(self, prompt: str, *, temperature: float = 1.0,
                            max_tokens: Optional[int] = None, timeout: int = 8) -> str: ...
