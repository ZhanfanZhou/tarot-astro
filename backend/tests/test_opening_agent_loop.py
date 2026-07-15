"""前置 Agent 的 Loop 行为：工具集按相位隔离、守卫 force_tool、相位提示词、同轮移交。

Agent Loop 已接 provider 抽象——不再直连 genai。全程 patch `services.llm.get_provider`
返回按脚本吐 TurnResult 的假 provider（不发真实请求、不花钱）。
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Message, MessageRole, SessionType  # noqa: E402
from tests._fake_llm import FakeProvider, TurnResult, ToolCall, tool_names  # noqa: E402


# --- TurnResult 构造小工具 -------------------------------------------------

def _text(t):
    return TurnResult(text=t)


def _call(name, args):
    return TurnResult(tool_calls=[ToolCall(name=name, args=args)])


def _text_call(t, name, args):
    return TurnResult(text=t, tool_calls=[ToolCall(name=name, args=args)])


def _install(monkeypatch, scripts):
    """patch get_provider → 单个 FakeProvider（移交时切 provider 也命中它，按 open_session 顺序取脚本）。"""
    from services import llm
    prov = FakeProvider(scripts)
    monkeypatch.setattr(llm, "get_provider", lambda agent: prov)
    return prov


async def _collect(agen):
    return [event async for event in agen]


def _run(agen):
    """本仓测试不装 pytest-asyncio，沿用 asyncio.run 的既有约定。"""
    return asyncio.run(_collect(agen))


BRIEF = {
    "question_topic": "感情", "user_goal": "求认同",
    "emotional_intensity": "高", "reading_strategy": "验证式",
}


async def _ok_executor(name, args):
    return {"success": True}


# ---------------------------------------------------------------------------
# 工具集组成（中性真源 services.llm.tools 的名单——与改动前一字不差）
# ---------------------------------------------------------------------------

def test_opening_tools_contain_only_submit_reading_brief():
    """开场相位看不见抽牌/星盘工具——机械杜绝『没读人先抽牌』。"""
    from services.llm import tools
    assert tools.OPENING_TOOL_NAMES == ["submit_reading_brief"]


def test_reading_tools_contain_submit_reading_brief_for_midway_revision():
    """解读相位仍带交单工具 = 用户中途换问题时可覆盖改判。"""
    from services.llm import tools
    assert "submit_reading_brief" in tools.READING_TOOL_NAMES
    assert "draw_tarot_cards" in tools.READING_TOOL_NAMES


def test_daily_tools_exclude_submit_reading_brief():
    """每日一签/心灵奇旅永远不该交单：工具集与改动前一字不差，不新增暴露面。"""
    from services.llm import tools
    names = set(tools.DAILY_TOOL_NAMES)
    assert "submit_reading_brief" not in names
    assert names == {
        "draw_tarot_cards", "get_astrology_chart",
        "request_user_profile", "read_divination_notebook",
    }


def test_daily_session_gets_daily_tools_not_tarot_tools(monkeypatch):
    """选工具集时 DAILY/CHAT 走 daily 工具集——锁住选择逻辑，不只是锁名单。"""
    from services.gemini_service import GeminiService

    for session_type in (SessionType.DAILY, SessionType.CHAT):
        prov = _install(monkeypatch, [[_text("今日宜静。")]])
        _run(GeminiService().stream_response(
            messages=[Message(role=MessageRole.USER, content="今天怎么样")],
            user=None,
            session_type=session_type,
            system_prompt_override="（日运提示词）",
        ))
        names = tool_names(prov.sessions[0].tools)
        assert "submit_reading_brief" not in names
        assert "draw_tarot_cards" in names


# ---------------------------------------------------------------------------
# 提示词与工具集必须同源：override > 相位 > 会话类型（两处优先级一字不差）
#
# _build_neutral 的优先级是 override > phase，_tool_specs 也必须认同 —— 一旦给塔罗会话
# 传 override，就绝不能得到「提示词是 override、工具集却只有 submit_reading_brief」的分裂。
# ---------------------------------------------------------------------------

def test_override_wins_over_phase_for_tools_not_just_prompt(monkeypatch):
    """override + opening 相位：提示词走 override → 工具集也必须跟着走，不能留在开场工具集。"""
    from services.gemini_service import GeminiService

    prov = _install(monkeypatch, [[_text("今日宜静。")]])
    _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="今天怎么样")],
        user=None,
        session_type=SessionType.TAROT,   # 塔罗 + 开场相位 —— 但调用方自带提示词
        system_prompt_override="（日运提示词，压根不认识 submit_reading_brief）",
        phase="opening",
    ))

    names = tool_names(prov.sessions[0].tools)
    assert "submit_reading_brief" not in names
    assert names != ["submit_reading_brief"]
    assert "draw_tarot_cards" in names
    # 系统提示词确实是 override（证明分裂的另一半成立，测的是同一次调用）
    assert prov.sessions[0].system.startswith("（日运提示词")


def test_override_never_arms_force_brief_guard(monkeypatch):
    """override 下守卫不许上膛：mode=ANY 指名一个不在工具集里的函数 = 必然的 API 错误。"""
    from services.gemini_service import GeminiService

    prov = _install(monkeypatch, [[_text("今日宜静。")]])
    _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="嗯")],
        user=None,
        session_type=SessionType.TAROT,
        system_prompt_override="（日运提示词）",
        phase="opening",
        force_brief=True,
    ))

    assert prov.sessions[0].force_tool is None
    assert "submit_reading_brief" not in tool_names(prov.sessions[0].tools)


def test_override_in_reading_phase_also_drops_submit_tool(monkeypatch):
    """override + reading：同理——自带提示词的会话没有开场幕语义，不该看见交单工具。"""
    from services.gemini_service import GeminiService

    prov = _install(monkeypatch, [[_text("今日宜静。")]])
    _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="嗯")],
        user=None,
        session_type=SessionType.TAROT,
        system_prompt_override="（心灵奇旅提示词）",
        phase="reading",
    ))

    assert "submit_reading_brief" not in tool_names(prov.sessions[0].tools)


def test_no_override_keeps_phase_authority(monkeypatch):
    """回归护栏：不传 override 时，相位仍是唯一权威（开场 → 只有交单工具）。"""
    from services.gemini_service import GeminiService

    prov = _install(monkeypatch, [[_text("坐吧。")]])
    _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="嗯")],
        user=None,
        session_type=SessionType.TAROT,
        phase="opening",
    ))

    assert tool_names(prov.sessions[0].tools) == ["submit_reading_brief"]


# ---------------------------------------------------------------------------
# 中性工具规格 & 相位提示词
# ---------------------------------------------------------------------------

def test_submit_reading_brief_schema_has_nine_fields():
    from services.llm import tools

    params = tools.SUBMIT_READING_BRIEF["parameters"]
    expected = {
        "question_topic", "user_goal", "emotional_intensity",
        "context_summary", "desired_takeaway", "tool_route",
        "suggested_spread", "reading_strategy", "pacing",
    }
    assert set(params["properties"].keys()) == expected
    # 四个必填：读人的最小结论集，其余可空
    assert set(params["required"]) == {
        "question_topic", "user_goal", "emotional_intensity", "reading_strategy",
    }


def test_opening_phase_system_prompt_is_opening_not_tarot():
    """开场相位注入 opening_system.md，而不是塔罗大提示词。"""
    from services.gemini_service import GeminiService

    system, _history, _last = GeminiService()._build_neutral(
        messages=[Message(role=MessageRole.USER, content="他上周冷淡了")],
        user=None,
        session_type=SessionType.TAROT,
        phase="opening",
        relationship_block="<关系上下文>\n首次来访",
    )
    assert "submit_reading_brief" in system
    assert "首次来访" in system


def test_reading_phase_system_prompt_includes_strategy_block():
    from services.gemini_service import GeminiService

    system, _history, _last = GeminiService()._build_neutral(
        messages=[Message(role=MessageRole.USER, content="请解读")],
        user=None,
        session_type=SessionType.TAROT,
        phase="reading",
        strategy={"user_goal": "求认同", "suggested_spread": "三张关系阵"},
    )
    assert "求认同" in system
    assert "绝不向用户外露" in system


def test_reading_phase_without_strategy_is_unchanged():
    """存量会话（strategy=None）→ 系统提示词就是原来的塔罗提示词，行为不变。"""
    from services.gemini_service import GeminiService

    system, _history, _last = GeminiService()._build_neutral(
        messages=[Message(role=MessageRole.USER, content="请解读")],
        user=None,
        session_type=SessionType.TAROT,
        phase="reading",
        strategy=None,
    )
    assert "本场策略单" not in system


def test_build_neutral_splits_last_user_from_history():
    """中性拆分：history 不含最后一条待发 user；last_user 是那条文本。"""
    from services.gemini_service import GeminiService

    _system, history, last_user = GeminiService()._build_neutral(
        messages=[
            Message(role=MessageRole.ASSISTANT, content="坐吧。"),
            Message(role=MessageRole.USER, content="他上周冷淡了"),
        ],
        user=None,
        session_type=SessionType.TAROT,
        phase="opening",
    )
    assert last_user == "他上周冷淡了"
    assert history == [{"role": "assistant", "content": "坐吧。"}]


# ---------------------------------------------------------------------------
# 同轮移交 & Agent Loop 行为（provider 全程替身，零请求零花费）
# ---------------------------------------------------------------------------

def test_opening_handoff_swaps_tools_and_draws_in_same_reply(monkeypatch):
    """同轮移交：开场交单后，同一次 SSE 回复内换成解读工具集并抽牌。

    用户最后一句澄清答完 → 抽牌按钮直接出现，不需要多回一句。
    """
    from services.gemini_service import GeminiService

    scripts = [
        # session1（开场 Agent，只有交单工具）：直接交单，不说话
        [_call("submit_reading_brief", BRIEF)],
        # session2（解读 Agent，移交后重建）：过渡语 + 抽牌，再收尾
        [
            _text_call("我懂了，让牌来说话。", "draw_tarot_cards",
                       {"spread_type": "three_card", "card_count": 3}),
            _text("静下来，抽三张。"),
        ],
    ]
    prov = _install(monkeypatch, scripts)

    executed = []

    async def executor(name, args):
        executed.append(name)
        return {"success": True}

    events = _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="他上周开始冷淡了")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=executor,
        phase="opening",
        relationship_block="<关系上下文>\n首次来访",
    ))

    # 开场 session 只有交单工具；移交后的 session 拿到完整工具集
    assert tool_names(prov.sessions[0].tools) == ["submit_reading_brief"]
    assert "draw_tarot_cards" in tool_names(prov.sessions[1].tools)

    # 交单是纯后台工具，绝不推给前端；抽牌才推
    pushed = [e["function_call"]["name"] for e in events if "function_call" in e]
    assert pushed == ["draw_tarot_cards"]

    # 策略单已注入移交后的系统提示词
    assert "求认同" in prov.sessions[1].system
    assert "本场策略单" in prov.sessions[1].system

    # 交单确实执行、解读 Agent 的过渡语已流式吐出
    assert executed == ["submit_reading_brief", "draw_tarot_cards"]
    assert "".join(e.get("content", "") for e in events).startswith("我懂了")


def test_force_brief_passes_force_tool_to_opening_session(monkeypatch):
    """守卫开启时，force_tool='submit_reading_brief' 真的传给了 opening session。"""
    from services.gemini_service import GeminiService

    scripts = [
        [_call("submit_reading_brief", {
            "question_topic": "事业", "user_goal": "辅助决策",
            "emotional_intensity": "中", "reading_strategy": "决策式"})],
        [_text("好，我们开始。")],
    ]
    prov = _install(monkeypatch, scripts)

    _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="嗯")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=_ok_executor,
        phase="opening",
        force_brief=True,
    ))

    assert prov.sessions[0].force_tool == "submit_reading_brief"
    # 移交后的解读 session 绝不带守卫（否则解读 Agent 也被逼着只能交单）
    assert prov.sessions[1].force_tool is None


def test_done_is_emitted_exactly_once_when_last_iteration_is_plain_text(monkeypatch):
    """done 只能有一个——router 的 `elif "done" in event` 会 add_message(ASSISTANT)。

    边界：前 (max-1) 轮都调工具，把预算烧到只剩最后一轮，最后一轮恰好返回纯文本。
    移交会多吃一次迭代，离这个天花板更近，必须锁死。
    """
    from services.gemini_service import GeminiService

    svc = GeminiService()
    max_iterations = svc.MAX_AGENT_ITERATIONS

    responses = [
        _call("read_divination_notebook", {"reason": f"第{i}次"})
        for i in range(max_iterations - 1)
    ]
    responses.append(_text("就这样，牌已经说清楚了。"))
    _install(monkeypatch, [responses])

    events = _run(svc.stream_response(
        messages=[Message(role=MessageRole.USER, content="帮我看看")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=_ok_executor,
        phase="reading",
    ))

    dones = [e for e in events if "done" in e]
    assert len(dones) == 1, f"done 发了 {len(dones)} 次 → assistant 消息会重复落库"
    assert events[-1] == {"done": True}
    assert "".join(e.get("content", "") for e in events) == "就这样，牌已经说清楚了。"


def test_done_is_emitted_once_when_iterations_are_exhausted(monkeypatch):
    """另一侧边界：迭代烧完仍在调工具（无自然收尾）→ 仍要有且只有一个 done。"""
    from services.gemini_service import GeminiService

    svc = GeminiService()
    responses = [
        _call("read_divination_notebook", {"reason": f"第{i}次"})
        for i in range(svc.MAX_AGENT_ITERATIONS)
    ]
    _install(monkeypatch, [responses])

    events = _run(svc.stream_response(
        messages=[Message(role=MessageRole.USER, content="帮我看看")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=_ok_executor,
        phase="reading",
    ))

    assert len([e for e in events if "done" in e]) == 1
    assert events[-1] == {"done": True}


def test_reading_phase_submit_brief_does_not_trigger_handoff(monkeypatch):
    """中途改判：解读相位再次交单 → 结果照常喂回原 session，绝不触发移交/换提示词。"""
    from services.gemini_service import GeminiService

    scripts = [[
        _call("submit_reading_brief", {
            "question_topic": "事业", "user_goal": "辅助决策",
            "emotional_intensity": "中", "reading_strategy": "决策式"}),
        _text("好，换个方向重新看。"),
    ]]
    prov = _install(monkeypatch, scripts)

    events = _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="其实我想问工作")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=_ok_executor,
        phase="reading",
        strategy={"user_goal": "求认同"},
    ))

    # 只开了一个 session：没有重建 = 没有移交
    assert len(prov.sessions) == 1
    # 函数结果被喂回同一个 session（第二次发送是 tool result）
    assert len(prov.sessions[0].sent) == 2
    assert prov.sessions[0].sent[1][0] == "tool"
    assert events[-1] == {"done": True}


def test_function_executor_none_yields_call_and_no_done(monkeypatch):
    """日运心灵奇旅（无 executor）：遇到 tool_call → yield function_call 后 return，绝不吐 done。"""
    from services.gemini_service import GeminiService

    scripts = [[_call("draw_tarot_cards", {"spread_type": "single", "card_count": 1})]]
    _install(monkeypatch, scripts)

    events = _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="今天运势")],
        user=None,
        session_type=SessionType.CHAT,
        function_executor=None,
        system_prompt_override="（心灵奇旅提示词）",
    ))

    assert any("function_call" in e for e in events)
    assert not any("done" in e for e in events)
