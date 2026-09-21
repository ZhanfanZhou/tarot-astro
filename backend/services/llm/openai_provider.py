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
    return TurnResult(text=message.content or "", tool_calls=calls,
                      reasoning=getattr(message, "reasoning_content", None) or "")


class _OpenAISession:
    def __init__(self, client, model, system_prompt, history, tools,
                 is_deepseek=False, reasoning_effort=""):
        self._client = client
        self._model = model
        self._tools = _to_openai_tools(tools)
        self._is_deepseek = is_deepseek
        self._effort = reasoning_effort
        self._messages = [{"role": "system", "content": system_prompt}]
        for m in history:
            if m["role"] == "tool_result":
                self._messages.append({
                    "role": "tool",
                    "tool_call_id": m["id"],
                    "content": json.dumps(m["result"], ensure_ascii=False),
                })
                continue
            msg = {"role": m["role"], "content": m["content"]}
            if m.get("tool_calls"):
                self._attach_reasoning(msg, m.get("reasoning") or "")
            if m.get("tool_calls"):
                msg["tool_calls"] = [{
                    "id": c["id"], "type": "function",
                    "function": {"name": c["name"],
                                 "arguments": json.dumps(c["args"], ensure_ascii=False)},
                } for c in m["tool_calls"]]
            self._messages.append(msg)

    def _attach_reasoning(self, msg: dict, reasoning: str) -> None:
        """带 tool_calls 的 assistant 轮附上推理内容。

        DeepSeek 思考模式：本轮（喂回结果之前）的每个 tool_calls 轮都必须带
        reasoning_content 字段，缺了就 400「must be passed back」；空串它接受（harness
        替解读 Agent 发起的抽牌调用没有推理），往轮的可带可不带（2026-09 对真 API 验证）。
        其他 OpenAI 兼容端未必认这个字段，只在真有内容时才带。
        """
        if reasoning or self._is_deepseek:
            msg["reasoning_content"] = reasoning

    async def _create(self):
        kwargs = {"model": self._model, "messages": self._messages}
        if self._effort:
            kwargs["reasoning_effort"] = self._effort
        if self._tools:
            kwargs["tools"] = self._tools
        resp = await self._client.chat.completions.create(**kwargs)
        msg = resp.choices[0].message
        result = _parse(msg)
        # 把 assistant 轮写回 messages（只保留第一个 tool_call，保证后面只需一条 tool 响应）
        assistant = {"role": "assistant", "content": msg.content or ""}
        if result.tool_calls:
            self._attach_reasoning(assistant, result.reasoning)
            c = result.tool_calls[0]
            assistant["tool_calls"] = [{
                "id": c.id, "type": "function",
                "function": {"name": c.name, "arguments": json.dumps(c.args, ensure_ascii=False)},
            }]
        self._messages.append(assistant)
        return result

    async def send_user(self, text: str) -> TurnResult:
        self._messages.append({"role": "user", "content": text})
        return await self._create()

    async def send_tool_result(self, name, result, call_id="") -> TurnResult:
        # tool_call_id 必须和前一条 assistant.tool_calls[].id 对上——resume 时那条
        # assistant 来自重建的历史，id 就是当初落库的那个
        self._messages.append({
            "role": "tool",
            "tool_call_id": call_id,
            "content": json.dumps(result, ensure_ascii=False),
        })
        return await self._create()


class OpenAICompatProvider:
    def __init__(self, model: str, base_url: str, api_key: str, label: str = "",
                 reasoning_effort: str = ""):
        self.model = model
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        # 工厂已经按配置里的 provider 名建的实例，直接用它，不必再去猜 base_url
        self._is_deepseek = label == "deepseek"
        # 思考强度（Kimi 的 reasoning_effort）。工厂只在这家认的时候传进来，
        # 所以这里不必再判 provider：有值就发，空就不发。
        self._effort = reasoning_effort

    def open_session(self, system_prompt, history, tools):
        return _OpenAISession(self._client, self.model, system_prompt, history,
                              tools, self._is_deepseek, self._effort)

    def _effort_kwargs(self) -> dict:
        return {"reasoning_effort": self._effort} if self._effort else {}

    async def generate_json(self, prompt: str) -> str:
        resp = await self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            **self._effort_kwargs(),
        )
        return (resp.choices[0].message.content or "").strip()

    async def generate_text(self, prompt, *, temperature=1.0, max_tokens=None, timeout=8) -> str:
        # 不传 max_tokens 就不设上限：思考模型的 max_tokens 是「思考 + 正文」的总预算，
        # 给小了会被思考吃光、正文回空串。让模型自己收尾，超时由 timeout 兜底。
        kwargs = {"max_tokens": max_tokens} if max_tokens is not None else {}
        resp = await self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature, timeout=timeout, **self._effort_kwargs(), **kwargs,
        )
        return resp.choices[0].message.content or ""
