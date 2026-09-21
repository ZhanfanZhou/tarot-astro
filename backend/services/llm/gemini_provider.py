"""GeminiProvider：中性契约的 Gemini 原生实现。

会话内部复刻今天 gemini_service 的 SDK 用法（start_chat + send_message_async +
FunctionResponse proto），保证 Gemini 路径字节级零回归。
"""
import json
import uuid
import google.generativeai as genai
from typing import Optional
from google.generativeai.types import FunctionDeclaration, Tool

import config
from services.llm.base import ToolCall, TurnResult

genai.configure(api_key=config.GEMINI_API_KEY)

_GEN_CONFIG = {"temperature": 0.9, "top_p": 0.95, "top_k": 40, "max_output_tokens": 8192}


def _to_history(history: list) -> list:
    """中性历史 → Gemini contents（系统提示词走 GenerativeModel(system_instruction=)）。

    工具轮就是 Gemini 的 functionCall / functionResponse part。Gemini 无状态，重建的
    contents 与当初实时产生的等价；contents 以 model 轮开头（开场白是第一条）、历史里
    含本次未声明的函数、functionResponse 结尾，三种形状都合法（2026-09 对真 API 验证）。
    """
    out = []
    for m in history:
        if m["role"] == "tool_result":
            out.append({"role": "user", "parts": [genai.protos.Part(
                function_response=genai.protos.FunctionResponse(
                    name=m["name"], response=m["result"]))]})
            continue

        if m["role"] == "user":
            out.append({"role": "user", "parts": [genai.protos.Part(text=m["content"])]})
            continue

        # assistant：话和调用是同一个 model 轮里的两个 part
        parts = []
        if m.get("content"):
            parts.append(genai.protos.Part(text=m["content"]))
        for call in m.get("tool_calls") or []:
            parts.append(genai.protos.Part(
                function_call=genai.protos.FunctionCall(name=call["name"], args=call["args"])))
        if parts:
            out.append({"role": "model", "parts": parts})
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
            # Gemini 的 FunctionCall 没有 id；落库要靠 id 把调用和结果对上，这里生成一个
            calls.append(ToolCall(name=fc.name, args=_to_plain(dict(fc.args)),
                                  id=f"{fc.name}-{uuid.uuid4().hex[:8]}"))
        elif getattr(part, "text", None):
            text += part.text
    return TurnResult(text=text, tool_calls=calls)


class _GeminiSession:
    def __init__(self, model_name, system_prompt, history, tools):
        gtools = None
        if tools:
            gtools = [Tool(function_declarations=[FunctionDeclaration(**t) for t in tools])]
        model = genai.GenerativeModel(
            model_name=model_name, generation_config=_GEN_CONFIG, tools=gtools,
            system_instruction=system_prompt)
        self._chat = model.start_chat(history=_to_history(history))

    async def send_user(self, text: str) -> TurnResult:
        return _parse(await self._chat.send_message_async(text, stream=False))

    async def send_tool_result(self, name: str, result: dict, call_id: str = "") -> TurnResult:
        payload = [genai.protos.Part(function_response=genai.protos.FunctionResponse(
            name=name, response=result))]
        return _parse(await self._chat.send_message_async(payload, stream=False))


class GeminiProvider:
    def __init__(self, model: str):
        self.model = model

    def open_session(self, system_prompt, history, tools):
        return _GeminiSession(self.model, system_prompt, history, tools)

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
