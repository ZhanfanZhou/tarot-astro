"""GeminiProvider：中性契约的 Gemini 原生实现。

会话内部复刻今天 gemini_service 的 SDK 用法（start_chat + send_message_async +
FunctionResponse proto），保证 Gemini 路径字节级零回归。
"""
import json
import google.generativeai as genai
from typing import Optional
from google.generativeai.types import FunctionDeclaration, Tool

import config
from services.llm.base import ToolCall, TurnResult

genai.configure(api_key=config.GEMINI_API_KEY)

_GEN_CONFIG = {"temperature": 0.9, "top_p": 0.95, "top_k": 40, "max_output_tokens": 8192}


def _to_history(system_prompt: str, history: list) -> list:
    """系统提示词 → user 首轮 + model『我明白了。』确认语；其余文本轮按角色映射。
    与今天 _format_messages_for_gemini 的框架逐字一致。"""
    out = [
        {"role": "user", "parts": [{"text": system_prompt}]},
        {"role": "model", "parts": [{"text": "我明白了。"}]},
    ]
    for m in history:
        role = "user" if m["role"] == "user" else "model"
        out.append({"role": role, "parts": [{"text": m["content"]}]})
    return out


def _to_plain(value):
    """proto 值 → 纯 python。

    Gemini 的 function_call.args 里，数组是 RepeatedComposite、整数常以 float 到手。
    这里是 proto 进入本项目的唯一入口，所以转换只在这里做一次——下游（落库、拼提示词、
    推给前端）拿到的一律是纯 python，不必各自再判一遍类型。
    """
    if isinstance(value, (str, bytes)) or value is None:
        return value
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, dict):
        return {k: _to_plain(v) for k, v in value.items()}
    if hasattr(value, "__iter__"):
        return [_to_plain(v) for v in value]
    return value


def _parse(response) -> TurnResult:
    text, calls = "", []
    for part in response.parts:
        if getattr(part, "function_call", None) and part.function_call:
            fc = part.function_call
            calls.append(ToolCall(name=fc.name, args=_to_plain(dict(fc.args)), id=fc.name))
        elif getattr(part, "text", None):
            text += part.text
    return TurnResult(text=text, tool_calls=calls)


class _GeminiSession:
    def __init__(self, model_name, system_prompt, history, tools, force_tool):
        gtools = None
        if tools:
            gtools = [Tool(function_declarations=[FunctionDeclaration(**t) for t in tools])]
        kwargs = {}
        if force_tool:
            kwargs["tool_config"] = {"function_calling_config": {
                "mode": "ANY", "allowed_function_names": [force_tool]}}
        model = genai.GenerativeModel(
            model_name=model_name, generation_config=_GEN_CONFIG, tools=gtools, **kwargs)
        self._chat = model.start_chat(history=_to_history(system_prompt, history))

    async def send_user(self, text: str) -> TurnResult:
        return _parse(await self._chat.send_message_async(text, stream=False))

    async def send_tool_result(self, name: str, result: dict, call_id: str = "") -> TurnResult:
        payload = [genai.protos.Part(function_response=genai.protos.FunctionResponse(
            name=name, response=result))]
        return _parse(await self._chat.send_message_async(payload, stream=False))


class GeminiProvider:
    def __init__(self, model: str, supports_forced_tool: bool = True):
        self.model = model
        self._can_force = supports_forced_tool

    def open_session(self, system_prompt, history, tools, force_tool=None):
        if force_tool and not self._can_force:
            # 见 catalog.supports_forced_tool：这个模型传了会报错，干脆不传
            print(f"[LLM] {self.model} 不支持强制调用 {force_tool}，守卫第 2 层本轮降级")
            force_tool = None
        return _GeminiSession(self.model, system_prompt, history, tools, force_tool)

    async def generate_json(self, prompt: str) -> str:
        cfg = {"temperature": 0.7, "response_mime_type": "application/json"}
        model = genai.GenerativeModel(model_name=self.model, generation_config=cfg)
        resp = await model.generate_content_async(prompt)
        return (resp.text or "").strip()

    async def generate_text(self, prompt, *, temperature=1.0, max_tokens=None, timeout=8) -> str:
        cfg = {"temperature": temperature, "top_p": 0.95}
        if max_tokens is not None:
            cfg["max_output_tokens"] = max_tokens
        model = genai.GenerativeModel(model_name=self.model, generation_config=cfg)
        resp = await model.generate_content_async(prompt, request_options={"timeout": timeout})
        return resp.text or ""
