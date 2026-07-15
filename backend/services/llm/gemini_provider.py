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


def _parse(response) -> TurnResult:
    text, calls = "", []
    for part in response.parts:
        if getattr(part, "function_call", None) and part.function_call:
            fc = part.function_call
            calls.append(ToolCall(name=fc.name, args=dict(fc.args), id=fc.name))
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
    def __init__(self, model: str):
        self.model = model

    def open_session(self, system_prompt, history, tools, force_tool=None):
        return _GeminiSession(self.model, system_prompt, history, tools, force_tool)

    async def generate_json(self, prompt: str) -> str:
        cfg = {"temperature": 0.7, "response_mime_type": "application/json"}
        model = genai.GenerativeModel(model_name=self.model, generation_config=cfg)
        resp = await model.generate_content_async(prompt)
        return (resp.text or "").strip()

    async def generate_text(self, prompt, *, temperature=1.0, max_tokens=200, timeout=8) -> str:
        model = genai.GenerativeModel(model_name=self.model, generation_config={
            "temperature": temperature, "top_p": 0.95, "max_output_tokens": max_tokens})
        resp = await model.generate_content_async(prompt, request_options={"timeout": timeout})
        return resp.text or ""
