"""OpenAICompatProvider：DeepSeek / Kimi 共用（均 OpenAI 兼容，仅 base_url/key/model 不同）。"""
import json
from typing import Optional
from openai import AsyncOpenAI

from services.llm.base import ToolCall, TurnResult


def _to_openai_tools(tools):
    if not tools:
        return None
    return [{"type": "function", "function": {
        "name": t["name"], "description": t["description"], "parameters": t["parameters"],
    }} for t in tools]


def _parse(message) -> TurnResult:
    calls = []
    for tc in (getattr(message, "tool_calls", None) or [])[:1]:   # 只留第一个，对齐 Agent Loop
        try:
            args = json.loads(tc.function.arguments or "{}")
        except json.JSONDecodeError:
            args = {}
        calls.append(ToolCall(name=tc.function.name, args=args, id=tc.id))
    return TurnResult(text=message.content or "", tool_calls=calls)


# DeepSeek 的思考模型（deepseek-flash / deepseek-v4-pro）在思考态下不接受
# tool_choice，指定函数会直接 400：
#     "Thinking mode does not support this tool_choice"
# 两者是互斥的，只能二选一 —— 而强制交单这一次调用的全部意义就是「必须调这个工具」，
# 所以这里关思考。普通轮次（不指定 tool_choice）不受影响，照常思考。
# 非 DeepSeek 的 OpenAI 兼容端（Kimi 等）不认这个字段，所以只对 DeepSeek 发。
_NO_THINKING = {"thinking": {"type": "disabled"}}


class _OpenAISession:
    def __init__(self, client, model, system_prompt, history, tools, force_tool, no_think=False):
        self._client = client
        self._model = model
        self._no_think = no_think
        self._tools = _to_openai_tools(tools)
        self._force = ({"type": "function", "function": {"name": force_tool}}
                       if force_tool else None)
        self._messages = [{"role": "system", "content": system_prompt}]
        for m in history:
            self._messages.append({"role": m["role"], "content": m["content"]})
        # 记住上一轮的 tool_call_id（send_tool_result 需要）
        self._last_call_id = None

    async def _create(self):
        kwargs = {"model": self._model, "messages": self._messages}
        if self._tools:
            kwargs["tools"] = self._tools
            if self._force:
                kwargs["tool_choice"] = self._force
        if self._force and self._no_think:
            kwargs["extra_body"] = dict(_NO_THINKING)
        resp = await self._client.chat.completions.create(**kwargs)
        msg = resp.choices[0].message
        result = _parse(msg)
        # 把 assistant 轮写回 messages（只保留第一个 tool_call，保证后面只需一条 tool 响应）
        assistant = {"role": "assistant", "content": msg.content or ""}
        if result.tool_calls:
            c = result.tool_calls[0]
            assistant["tool_calls"] = [{
                "id": c.id, "type": "function",
                "function": {"name": c.name, "arguments": json.dumps(c.args, ensure_ascii=False)},
            }]
            self._last_call_id = c.id
        self._messages.append(assistant)
        return result

    async def send_user(self, text: str) -> TurnResult:
        self._messages.append({"role": "user", "content": text})
        return await self._create()

    async def send_tool_result(self, name, result, call_id="") -> TurnResult:
        self._messages.append({
            "role": "tool",
            "tool_call_id": call_id or self._last_call_id or name,
            "content": json.dumps(result, ensure_ascii=False),
        })
        return await self._create()


class OpenAICompatProvider:
    def __init__(self, model: str, base_url: str, api_key: str, label: str = "",
                 supports_forced_tool: bool = True):
        self.model = model
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        # 工厂已经按配置里的 provider 名建的实例，直接用它，不必再去猜 base_url
        self._is_deepseek = label == "deepseek"
        self._can_force = supports_forced_tool

    def open_session(self, system_prompt, history, tools, force_tool=None):
        if force_tool and not self._can_force:
            # 见 catalog.supports_forced_tool：这个模型传了会报错，干脆不传
            print(f"[LLM] {self.model} 不支持强制调用 {force_tool}，守卫第 2 层本轮降级")
            force_tool = None
        return _OpenAISession(self._client, self.model, system_prompt, history,
                              tools, force_tool, self._is_deepseek)

    async def generate_json(self, prompt: str) -> str:
        resp = await self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        return (resp.choices[0].message.content or "").strip()

    async def generate_text(self, prompt, *, temperature=1.0, max_tokens=None, timeout=8) -> str:
        # 不传 max_tokens 就不设上限：思考模型的 max_tokens 是「思考 + 正文」的总预算，
        # 给小了会被思考吃光、正文回空串。让模型自己收尾，超时由 timeout 兜底。
        kwargs = {"max_tokens": max_tokens} if max_tokens is not None else {}
        resp = await self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature, timeout=timeout, **kwargs,
        )
        return resp.choices[0].message.content or ""
