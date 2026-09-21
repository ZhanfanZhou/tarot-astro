"""前置 Agent 的 Loop 行为：工具集按相位隔离、相位提示词、同轮移交。

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


# 开场只交牌阵 ID；位置与张数由牌阵目录展开（spread_three_card_state.md 的文件头）
BRIEF = {
    "question": "他还会回来吗", "context": "上周开始冷淡",
    "route": "tarot", "spread_type": "three_card_state",
}
BRIEF_POSITIONS = ["左牌：共同回答本次问题", "中牌：共同回答本次问题", "右牌：共同回答本次问题"]

BRIEF_ASTRO = {"question": "我这两年的事业格局", "route": "astrology"}


async def _ok_executor(name, args):
    return {"success": True}


# ---------------------------------------------------------------------------
# 工具集组成（中性真源 services.llm.tools 的名单——与改动前一字不差）
# ---------------------------------------------------------------------------

def test_opening_tools_exclude_drawing_and_chart():
    """开场相位看不见抽牌/星盘工具——机械杜绝『没定义问题先抽牌』。

    要资料是为星盘路线自己判断走不走得通；翻笔记是为了接上「上次那件事」，
    两样都不产生前端以外的副作用。
    """
    from services.llm import tools
    assert tools.OPENING_TOOL_NAMES == [
        "submit_reading_brief", "request_user_profile", "read_divination_notes"]


def test_reading_tools_drop_submit_reading_brief():
    """起手单是一次性记录，解读相位不该再持有交单工具。

    解读中要换牌阵/补抽，直接调 draw_tarot_cards；留着交单只是多一个会被误调的工具。
    """
    from services.llm import tools
    assert "submit_reading_brief" not in tools.READING_TOOL_NAMES
    assert "draw_tarot_cards" in tools.READING_TOOL_NAMES


def test_daily_tools_exclude_submit_reading_brief():
    """每日一签/心灵奇旅永远不该交单：工具集与改动前一字不差，不新增暴露面。"""
    from services.llm import tools
    names = set(tools.DAILY_TOOL_NAMES)
    assert "submit_reading_brief" not in names
    assert names == {
        "draw_tarot_cards", "get_astrology_chart",
        "request_user_profile", "read_divination_notes",
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
            function_executor=_ok_executor,
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
        function_executor=_ok_executor,
    ))

    names = tool_names(prov.sessions[0].tools)
    assert "submit_reading_brief" not in names
    assert names != ["submit_reading_brief"]
    assert "draw_tarot_cards" in names
    # 系统提示词确实是 override（证明分裂的另一半成立，测的是同一次调用）
    assert prov.sessions[0].system.startswith("（日运提示词")


def test_override_in_reading_phase_also_drops_submit_tool(monkeypatch):
    """override + reading：同理——自带提示词的会话没有开场幕语义，不该看见交单工具。"""
    from services.gemini_service import GeminiService

    prov = _install(monkeypatch, [[_text("今日宜静。")]])
    _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="嗯")],
        user=None,
        session_type=SessionType.TAROT,
        system_prompt_override="（日运提示词）",
        phase="reading",
        function_executor=_ok_executor,
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
        function_executor=_ok_executor,
    ))

    assert tool_names(prov.sessions[0].tools) == [
        "submit_reading_brief", "request_user_profile", "read_divination_notes"]


# ---------------------------------------------------------------------------
# 中性工具规格 & 相位提示词
# ---------------------------------------------------------------------------

def test_submit_reading_brief_schema_is_execution_only():
    """起手单只装执行必需：问题 + 起手方式 + 牌阵 ID，不含任何关于人的判词。"""
    from services import spread_service
    from services.llm import tools

    params = tools.SUBMIT_READING_BRIEF["parameters"]
    assert set(params["properties"].keys()) == {
        "question", "context", "route", "spread_type",
    }
    assert set(params["required"]) == {"question", "route"}
    # route 必须 enum 锁死：不锁的话模型会照抄 description 里的括号说明
    assert params["properties"]["route"]["enum"] == ["tarot", "astrology"]
    # 牌阵同理，而且只交 ID：位置不是模型填的字段，它填了也没地方收
    assert params["properties"]["spread_type"]["enum"] == spread_service.SPREAD_IDS
    assert "positions" not in params["properties"]


def test_opening_phase_system_prompt_is_opening_not_tarot():
    """开场相位注入 opening_system.md，而不是塔罗大提示词。"""
    from services.gemini_service import GeminiService

    system, _history, _last = GeminiService()._build_neutral(
        messages=[Message(role=MessageRole.USER, content="他上周冷淡了")],
        user=None,
        session_type=SessionType.TAROT,
        phase="opening",
        relationship_block="# <称呼与来访次数>\n首次来访",
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
        strategy={"question": "他还会回来吗", "route": "tarot",
                  "spread_type": "三张关系阵"},
    )
    assert "他还会回来吗" in system
    assert "不要再欢迎用户" in system      # 接场约束（reading_handoff.md）随起手单一起进来


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
    # 塔罗提示词正文里也提到 <本场起手>，所以只看注入的那一块在不在
    assert "# <本场起手>" not in system


def test_both_phases_inject_the_users_portrait(tmp_path, monkeypatch):
    """画像每轮无条件进系统提示词，开场和解读都进——不再指望模型自己去翻笔记本。"""
    from models import User, UserType
    from services.gemini_service import GeminiService
    from services.notebook_service import empty_portrait, merge_portrait, notebook_service

    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)
    notebook_service._save_portrait("u1", merge_portrait(
        empty_portrait(), {"preferences": "希望话说直一点"}, "2026-09-10T14:20:00"))
    user = User(user_id="u1", user_type=UserType.REGISTERED)

    for phase in ("opening", "reading"):
        system, _history, _last = GeminiService()._build_neutral(
            messages=[Message(role=MessageRole.USER, content="他上周冷淡了")],
            user=user, session_type=SessionType.TAROT, phase=phase,
        )
        assert "# <用户画像>" in system, phase
        assert "希望话说直一点" in system, phase
        assert "不是这个人此刻的事实" in system, phase   # portrait_usage.md 跟着一起进来


def test_guest_gets_no_portrait_block(tmp_path, monkeypatch):
    """游客没有笔记本：画像块和它的使用规则整个不出现。"""
    from models import User, UserType
    from services.gemini_service import GeminiService
    from services.notebook_service import notebook_service

    monkeypatch.setattr(notebook_service, "NOTEBOOK_DIR", tmp_path)
    system, _history, _last = GeminiService()._build_neutral(
        messages=[Message(role=MessageRole.USER, content="他上周冷淡了")],
        user=User(user_id="g1", user_type=UserType.GUEST),
        session_type=SessionType.TAROT, phase="reading",
    )
    assert "用户画像" not in system


def test_build_neutral_splits_last_user_from_history():
    """中性拆分：history 不含最后一条待发 user；pending 是「本轮发什么」。"""
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
    assert last_user == ("user", "他上周冷淡了")
    assert history == [{"role": "assistant", "content": "坐吧。"}]


# ---------------------------------------------------------------------------
# 同轮移交 & Agent Loop 行为（provider 全程替身，零请求零花费）
# ---------------------------------------------------------------------------

def test_tarot_route_draws_straight_from_the_brief(monkeypatch):
    """塔罗路线：交单即抽牌。

    牌阵参数已经在起手单里，harness 直接推抽牌器收口，不再叫解读 Agent 出来说一句
    过渡语——那是一次纯浪费的往返，而且它会自己另选一副牌阵，跟单子上写的对不上。
    """
    from services.gemini_service import GeminiService

    # 只有开场 session；解读 session 根本不该被开出来
    prov = _install(monkeypatch, [[_text_call("好，这件事我们抽牌看。",
                                              "submit_reading_brief", BRIEF)]])

    executed = []

    async def executor(name, args):
        executed.append((name, args))
        return {"success": True}

    events = _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="他上周开始冷淡了")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=executor,
        phase="opening",
        relationship_block="# <称呼与来访次数>\n称呼：小夏 ｜ 来访：第 1 次",
    ))

    # 全程只开了开场 session —— 没有第二次 provider 往返
    assert len(prov.sessions) == 1
    assert tool_names(prov.sessions[0].tools) == [
        "submit_reading_brief", "request_user_profile", "read_divination_notes"]

    # 事件只有正文、记录、收口——没有另开的「推给前端」通道
    assert all(set(e) <= {"content", "message", "done"} for e in events)

    # 只执行了交单；抽牌是 interrupt，没有可执行的东西
    assert [name for name, _ in executed] == ["submit_reading_brief"]
    # 过渡语照常流式吐出，然后收口等用户抽牌
    assert "".join(e.get("content", "") for e in events) == "好，这件事我们抽牌看。"
    assert events[-1] == {"done": True}

    # 落库形状：开场 Agent 的一轮（话 + 交单调用）→ 交单结果 → harness 替解读 Agent
    # 发起的抽牌调用。抽牌结果由 /draw 用同一个 id 补上。
    recorded = [e["message"] for e in events if "message" in e]
    assert [m.role.value for m in recorded] == ["assistant", "tool", "assistant"]
    assert recorded[0].content == "好，这件事我们抽牌看。"
    assert recorded[0].tool_calls[0].name == "submit_reading_brief"
    assert recorded[1].tool_call_id == recorded[0].tool_calls[0].id
    assert recorded[2].content == "" and recorded[2].tool_calls[0].name == "draw_tarot_cards"
    # 抽牌参数 = 起手单上那个牌阵 ID 展开出来的位置
    assert recorded[2].tool_calls[0].args == {
        "spread_type": "three_card_state",
        "positions": BRIEF_POSITIONS,
    }


def test_opening_can_read_notes_then_submit_in_one_turn(monkeypatch):
    """翻旧记录不是 interrupt：结果当场回给模型，同一轮里接着交单。

    开场拿到 read_divination_notes 就是为了这条路——用户说「上次那件事」时，
    背景由它自己接上，而不是让用户重讲一遍、也不用等解读 Agent 上场再查。
    """
    from services.gemini_service import GeminiService

    prov = _install(monkeypatch, [[
        _call("read_divination_notes", {"reason": "他说的上次是哪一场"}),
        _text_call("嗯，那件事我记得。", "submit_reading_brief", BRIEF),
    ]])

    executed = []

    async def executor(name, args):
        executed.append(name)
        return {"success": True, "note_count": 1}

    events = _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="上次问的那件事后来没成，再看看")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=executor,
        phase="opening",
    ))

    # 同一个 session 跑完两轮：翻记录不切 provider、不收口
    assert len(prov.sessions) == 1
    assert executed == ["read_divination_notes", "submit_reading_brief"]

    # 落库形状：翻记录的调用 + 结果 → 交单那一轮 + 结果 → harness 发起的抽牌
    recorded = [e["message"] for e in events if "message" in e]
    assert [m.role.value for m in recorded] == [
        "assistant", "tool", "assistant", "tool", "assistant"]
    assert recorded[0].tool_calls[0].name == "read_divination_notes"
    assert recorded[1].tool_call_id == recorded[0].tool_calls[0].id
    assert recorded[-1].tool_calls[0].name == "draw_tarot_cards"


def test_failed_brief_does_not_close_the_opening(monkeypatch):
    """交单被打回（牌阵 ID 不认识）→ 开场没有结束：不抽牌、不移交，结果回给模型重来。

    收束的判据是交单「成功了」，不是「调用过」。判错的话，一份没落库的起手单也会把
    相位翻过去，用户会拿到一副谁都没选过的牌阵。
    """
    from services.gemini_service import GeminiService

    prov = _install(monkeypatch, [[
        _call("submit_reading_brief", dict(BRIEF, spread_type="celtic_cross")),
        _text("那我们换一副阵。"),
    ]])

    async def rejecting(name, args):
        return {"success": False, "error": "spread_type 必须是目录里的牌阵 ID"}

    events = _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="他还会回来吗")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=rejecting,
        phase="opening",
    ))

    calls = [e["message"].tool_calls[0].name for e in events
             if "message" in e and e["message"].tool_calls]
    assert "draw_tarot_cards" not in calls          # 没抽牌
    assert len(prov.sessions) == 1                  # 没移交给解读 Agent
    assert tool_names(prov.sessions[0].tools) == [
        "submit_reading_brief", "request_user_profile", "read_divination_notes"]


def test_astrology_route_hands_off_to_reading_agent(monkeypatch):
    """星盘路线：不需要用户动手，同一次回复里换成解读 Agent 续跑取盘并解读。"""
    from services.gemini_service import GeminiService

    scripts = [
        [_call("submit_reading_brief", BRIEF_ASTRO)],
        [
            _call("get_astrology_chart", {"reason": "本命盘"}),
            _text("你的土星在十宫。"),
        ],
    ]
    prov = _install(monkeypatch, scripts)

    executed = []

    async def executor(name, args):
        executed.append(name)
        return {"success": True, "chart_data": "（星盘）"}

    events = _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="我这两年的事业怎么走")],
        user=None,
        session_type=SessionType.ASTROLOGY,
        function_executor=executor,
        phase="opening",
    ))

    # 移交后的 session 拿到完整解读工具集，但不再带交单工具
    assert "get_astrology_chart" in tool_names(prov.sessions[1].tools)
    assert "submit_reading_brief" not in tool_names(prov.sessions[1].tools)

    # 起手单已注入移交后的系统提示词
    assert "我这两年的事业格局" in prov.sessions[1].system
    assert "本场起手" in prov.sessions[1].system

    assert executed == ["submit_reading_brief", "get_astrology_chart"]
    assert "".join(e.get("content", "") for e in events) == "你的土星在十宫。"


def test_done_is_emitted_exactly_once_when_last_iteration_is_plain_text(monkeypatch):
    """done 只能有一个——router 的 `elif "done" in event` 会 add_message(ASSISTANT)。

    边界：前 (max-1) 轮都调工具，把预算烧到只剩最后一轮，最后一轮恰好返回纯文本。
    移交会多吃一次迭代，离这个天花板更近，必须锁死。
    """
    from services.gemini_service import GeminiService

    svc = GeminiService()
    max_iterations = svc.MAX_AGENT_ITERATIONS

    responses = [
        _call("read_divination_notes", {"reason": f"第{i}次"})
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
        _call("read_divination_notes", {"reason": f"第{i}次"})
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
    """解读相位收到交单调用 → 照常喂回原 session，绝不触发移交/换提示词。

    工具集里已经没有 submit_reading_brief 了，正常不会发生；这条是防回归——
    移交只认「开场相位的那一次交单」，否则解读到一半会被重置成新开场。
    """
    from services.gemini_service import GeminiService

    scripts = [[
        _call("submit_reading_brief", {"question": "其实我想问工作", "route": "tarot"}),
        _text("好，换个方向重新看。"),
    ]]
    prov = _install(monkeypatch, scripts)

    events = _run(GeminiService().stream_response(
        messages=[Message(role=MessageRole.USER, content="其实我想问工作")],
        user=None,
        session_type=SessionType.TAROT,
        function_executor=_ok_executor,
        phase="reading",
        strategy={"question": "他还会回来吗", "route": "tarot"},
    ))

    # 只开了一个 session：没有重建 = 没有移交
    assert len(prov.sessions) == 1
    # 函数结果被喂回同一个 session（第二次发送是 tool result）
    assert len(prov.sessions[0].sent) == 2
    assert prov.sessions[0].sent[1][0] == "tool"
    assert events[-1] == {"done": True}
