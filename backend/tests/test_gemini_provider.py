"""GeminiProvider：中性输入 → 复刻今天的 start_chat/send_message SDK 用法。全程 mock genai。"""
import json
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


class _FakeRepeated:
    """模仿 proto 的 RepeatedComposite：可迭代，但不是 list。"""

    def __init__(self, items):
        self._items = items

    def __iter__(self):
        return iter(self._items)


def test_tool_call_args_come_back_as_plain_python():
    """proto 只在这一层出现，转换也只在这一层做。

    下游（落库 json.dumps、拼提示词、SSE 推前端）拿到的必须已经是纯 python：
    RepeatedComposite 漏下去会让 json.dumps 当场抛 TypeError，float 漏下去会让
    起手单里的张数显示成「3.0」。
    """
    from services.llm.gemini_provider import GeminiProvider
    from services.llm import tools
    raw = {
        "route": "tarot",
        "positions": _FakeRepeated(["过去", "现在", "未来"]),
        "nested": {"n": 5.0, "deep": _FakeRepeated([1.0, 2.0])},
        "ratio": 0.5,          # 真正的小数不该被截成 int
        "flag": True,          # bool 是 int 的子类，不能被数字分支吃掉
    }
    chat = MagicMock()
    chat.send_message_async = AsyncMock(
        return_value=_resp([_fc_part("submit_reading_brief", raw)]))
    model = MagicMock(start_chat=MagicMock(return_value=chat))
    with patch("services.llm.gemini_provider.genai.GenerativeModel", return_value=model):
        sess = GeminiProvider("gemini-x").open_session(
            "SYS", [], tools=tools.specs_by_names(["submit_reading_brief"]))
        r = asyncio.run(sess.send_user("他冷淡了"))

    args = r.tool_calls[0].args
    assert args["positions"] == ["过去", "现在", "未来"]
    assert args["nested"] == {"n": 5, "deep": [1, 2]}
    assert args["ratio"] == 0.5
    assert args["flag"] is True
    json.dumps(args)   # 落库这一步不能炸


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
