"""GeminiProvider：中性输入 → 复刻今天的 start_chat/send_message SDK 用法。全程 mock genai。"""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _fc_part(name, args):
    return SimpleNamespace(function_call=SimpleNamespace(name=name, args=args), text="")

def _text_part(text):
    return SimpleNamespace(function_call=None, text=text)

def _resp(parts):
    return SimpleNamespace(parts=parts)


def test_send_user_returns_text():
    from services.llm.gemini_provider import GeminiProvider
    chat = MagicMock()
    chat.send_message_async = AsyncMock(return_value=_resp([_text_part("你好")]))
    model = MagicMock(start_chat=MagicMock(return_value=chat))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", return_value=model):
        sess = GeminiProvider("gemini-x").open_session("SYS", [], tools=None)
        r = asyncio.run(sess.send_user("在吗"))
    assert r.text == "你好"
    assert r.tool_calls == []


def test_send_user_returns_tool_call():
    from services.llm.gemini_provider import GeminiProvider
    from services.llm import tools
    chat = MagicMock()
    chat.send_message_async = AsyncMock(
        return_value=_resp([_fc_part("submit_reading_brief", {"user_goal": "求认同"})]))
    model = MagicMock(start_chat=MagicMock(return_value=chat))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", return_value=model):
        sess = GeminiProvider("gemini-x").open_session(
            "SYS", [], tools=tools.specs_by_names(["submit_reading_brief"]))
        r = asyncio.run(sess.send_user("他冷淡了"))
    assert r.tool_calls[0].name == "submit_reading_brief"
    assert r.tool_calls[0].args["user_goal"] == "求认同"


def test_force_tool_sets_mode_any():
    from services.llm.gemini_provider import GeminiProvider
    from services.llm import tools
    captured = {}
    def fake_model(**kwargs):
        captured.update(kwargs)
        chat = MagicMock()
        chat.send_message_async = AsyncMock(return_value=_resp([_text_part("x")]))
        return MagicMock(start_chat=MagicMock(return_value=chat))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", side_effect=fake_model):
        GeminiProvider("gemini-x").open_session(
            "SYS", [], tools=tools.specs_by_names(["submit_reading_brief"]),
            force_tool="submit_reading_brief")
    tc = captured["tool_config"]["function_calling_config"]
    assert tc["mode"] == "ANY"
    assert tc["allowed_function_names"] == ["submit_reading_brief"]


def test_history_maps_to_start_chat():
    """系统提示词 → user+『我明白了。』；历史文本轮按角色映射（复刻今天格式）。"""
    from services.llm.gemini_provider import GeminiProvider
    captured = {}
    def fake_model(**kwargs):
        chat = MagicMock()
        chat.send_message_async = AsyncMock(return_value=_resp([_text_part("ok")]))
        m = MagicMock()
        m.start_chat = MagicMock(side_effect=lambda history: captured.update(history=history) or chat)
        return m
    with patch("services.llm.gemini_provider.genai.GenerativeModel", side_effect=fake_model):
        sess = GeminiProvider("gemini-x").open_session(
            "SYS", [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "yo"}], tools=None)
        asyncio.run(sess.send_user("next"))
    hist = captured["history"]
    assert hist[0]["role"] == "user" and "SYS" in hist[0]["parts"][0]["text"]
    assert hist[1]["role"] == "model" and hist[1]["parts"][0]["text"] == "我明白了。"
    assert hist[2] == {"role": "user", "parts": [{"text": "hi"}]}
    assert hist[3] == {"role": "model", "parts": [{"text": "yo"}]}


def test_send_tool_result_feeds_function_response():
    from services.llm.gemini_provider import GeminiProvider
    chat = MagicMock()
    chat.send_message_async = AsyncMock(return_value=_resp([_text_part("解读中")]))
    model = MagicMock(start_chat=MagicMock(return_value=chat))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", return_value=model):
        sess = GeminiProvider("gemini-x").open_session("SYS", [], tools=None)
        asyncio.run(sess.send_user("抽牌"))
        r = asyncio.run(sess.send_tool_result("draw_tarot_cards", {"success": True}))
    assert r.text == "解读中"
    # 第二次 send 传的是 FunctionResponse Part（list），不是纯文本
    args, _ = chat.send_message_async.call_args_list[1]
    assert isinstance(args[0], list)


def test_generate_json_and_text():
    from services.llm.gemini_provider import GeminiProvider
    model = MagicMock()
    model.generate_content_async = AsyncMock(return_value=SimpleNamespace(text='{"summary":"s","cards_drawn":[]}'))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", return_value=model):
        out = asyncio.run(GeminiProvider("gemini-x").generate_json("p"))
    assert '"summary"' in out
