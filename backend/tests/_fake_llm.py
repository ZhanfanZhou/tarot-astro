"""共用替身：假 LLM provider / session，按脚本吐 TurnResult。

用于 stream_response 的 Agent Loop 测试——patch `services.llm.get_provider` 返回 FakeProvider，
就能在不发任何真实请求的前提下，验证 Loop 的相位/工具集/移交/流式/done 语义。
"""
from services.llm.base import TurnResult, ToolCall  # noqa: F401  (ToolCall 供测试构造用)


def tool_names(specs):
    """从中性工具规格列表取名字，方便断言工具集名单。"""
    return [t["name"] for t in (specs or [])]


class FakeSession:
    def __init__(self, script):
        # script: list[TurnResult]，每次 send_* 弹一个
        self._script = list(script)
        self.sent = []          # [("user", text)] / [("tool", name, result, call_id)]

    async def send_user(self, text):
        self.sent.append(("user", text))
        return self._script.pop(0)

    async def send_tool_result(self, name, result, call_id=""):
        self.sent.append(("tool", name, result, call_id))
        return self._script.pop(0)


class FakeProvider:
    def __init__(self, scripts):
        # scripts: list[list[TurnResult]]，每次 open_session 取一个（按 session 创建顺序）
        self._scripts = list(scripts)
        self.sessions = []      # 记录每个 open_session 的 system/history/tools

    def open_session(self, system, history, tools):
        s = FakeSession(self._scripts.pop(0))
        s.system = system
        s.history = history
        s.tools = tools
        self.sessions.append(s)
        return s
