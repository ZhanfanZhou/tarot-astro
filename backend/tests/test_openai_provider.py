"""OpenAICompatProvider：中性输入 → OpenAI Chat Completions 形状。全程 mock openai client。"""
import sys, json, asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _msg(content=None, tool_calls=None):
    return SimpleNamespace(content=content, tool_calls=tool_calls)

def _completion(message):
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])

def _tc(id, name, args):
    return SimpleNamespace(id=id, function=SimpleNamespace(name=name, arguments=json.dumps(args)))


def _patched_client(create_mock):
    client = MagicMock()
    client.chat = MagicMock()
    client.chat.completions = MagicMock()
    client.chat.completions.create = create_mock
    return client


def test_send_user_text():
    from services.llm.openai_provider import OpenAICompatProvider
    create = AsyncMock(return_value=_completion(_msg(content="你好")))
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        sess = OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session("SYS", [], None)
        r = asyncio.run(sess.send_user("在吗"))
    assert r.text == "你好" and r.tool_calls == []
    # system 进了 messages
    _, kwargs = create.call_args
    assert kwargs["messages"][0] == {"role": "system", "content": "SYS"}


def test_send_user_tool_call():
    from services.llm.openai_provider import OpenAICompatProvider
    from services.llm import tools
    create = AsyncMock(return_value=_completion(_msg(tool_calls=[_tc("id1", "submit_reading_brief", {"user_goal": "求认同"})])))
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        sess = OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session(
            "SYS", [], tools.specs_by_names(["submit_reading_brief"]))
        r = asyncio.run(sess.send_user("他冷淡了"))
    assert r.tool_calls[0].name == "submit_reading_brief"
    assert r.tool_calls[0].args["user_goal"] == "求认同"
    assert r.tool_calls[0].id == "id1"
    # 工具被转成 OpenAI tools 形状
    _, kwargs = create.call_args
    assert kwargs["tools"][0]["type"] == "function"
    assert kwargs["tools"][0]["function"]["name"] == "submit_reading_brief"


def test_force_tool_sets_tool_choice():
    from services.llm.openai_provider import OpenAICompatProvider
    from services.llm import tools
    create = AsyncMock(return_value=_completion(_msg(tool_calls=[_tc("i", "submit_reading_brief", {})])))
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session(
            "SYS", [], tools.specs_by_names(["submit_reading_brief"]),
            force_tool="submit_reading_brief").send_user  # open only
        # 触发一次 create
        sess = OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session(
            "SYS", [], tools.specs_by_names(["submit_reading_brief"]), force_tool="submit_reading_brief")
        asyncio.run(sess.send_user("x"))
    _, kwargs = create.call_args
    assert kwargs["tool_choice"] == {"type": "function", "function": {"name": "submit_reading_brief"}}


def test_tool_result_roundtrip_and_single_toolcall_kept():
    """只保留第一个 tool_call（与 Agent Loop『处理第一个函数调用』一致），
    避免 OpenAI 要求每个 tool_call 都要有对应 tool 响应而报错。"""
    from services.llm.openai_provider import OpenAICompatProvider
    first = _completion(_msg(tool_calls=[
        _tc("a", "draw_tarot_cards", {}), _tc("b", "draw_tarot_cards", {})]))
    second = _completion(_msg(content="解读中"))
    create = AsyncMock(side_effect=[first, second])
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        sess = OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").open_session("SYS", [], None)
        r1 = asyncio.run(sess.send_user("抽牌"))
        r2 = asyncio.run(sess.send_tool_result("draw_tarot_cards", {"success": True}, "a"))
    assert len(r1.tool_calls) == 1          # 只留第一个
    assert r2.text == "解读中"
    _, kwargs = create.call_args            # 第二次 create 的 messages 里有 tool 结果
    roles = [m["role"] for m in kwargs["messages"]]
    assert "tool" in roles


def test_generate_json_uses_json_response_format():
    from services.llm.openai_provider import OpenAICompatProvider
    create = AsyncMock(return_value=_completion(_msg(content='{"summary":"s"}')))
    with patch("services.llm.openai_provider.AsyncOpenAI", return_value=_patched_client(create)):
        out = asyncio.run(OpenAICompatProvider("deepseek-chat", "http://x", "k", "deepseek").generate_json("p"))
    assert out == '{"summary":"s"}'
    _, kwargs = create.call_args
    assert kwargs["response_format"] == {"type": "json_object"}
