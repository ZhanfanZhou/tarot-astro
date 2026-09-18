"""补资料从头到尾：填进去 → 存回用户库 → 下一轮系统提示词的 <用户资料> 是新值。

补上来的资料回写的是**固定位置**（每轮现算的 <用户资料> 块），不是留在对话里那一句。
所以要锁的就是「每轮都现算」这件事——它一旦退化成缓存/只写一次，模型会拿着旧资料
继续解读，而且没有任何报错。

走真实 HTTP（TestClient）、真实 SSE、真实临时库；只把 LLM 换成剧本替身（零真实请求）。
锁住四条：
  1. 一个字段都没填过的用户：<用户资料> 照样出现，写明尚未完善、星盘缺哪几项
  2. 解读相位填完资料 → 落库到用户表，且同一轮的系统提示词已是新值；
     工具结果里的那一份也是同一个值
  3. 再填一次（改出生资料）→ 固定位置跟着变，旧的基本星盘作废
  4. 开场相位一样能要资料：工具集里有 request_user_profile，填完回到开场相位接着跑
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    Conversation, Message, MessageRole, SessionType, ToolCallRecord, User, UserType,
)
from services import tool_turns  # noqa: E402
from tests._fake_llm import FakeProvider, TurnResult, ToolCall, tool_names  # noqa: E402

USER_ID = "user_profile_e2e"

# 前端那张表单要求出生信息填全了才能提交，所以一次提交就是一份完整的出生资料
PROFILE_FULL = {
    "nickname": "阿岚", "gender": "female",
    "birth_year": 1996, "birth_month": 3, "birth_day": 12,
    "birth_hour": 8, "birth_minute": 30, "birth_city": "上海",
}
PROFILE_MOVED = {**PROFILE_FULL, "birth_city": "北京"}

ASK_PROFILE = ToolCallRecord(
    id="p1", name="request_user_profile",
    args={"reason": "要排盘", "required_fields": ["birth_date", "birth_time", "birth_city"]},
)


def _text(t):
    return TurnResult(text=t)


def _call(name, args):
    return TurnResult(tool_calls=[ToolCall(name=name, args=args)])


@pytest.fixture
def env(tmp_path, monkeypatch):
    import services.db as db_mod
    import services.rate_limit_service as rl_mod
    # 先导入 main（早于任何 asyncio.run），见 test_opening_handoff_e2e 的同一条注释
    from main import app

    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)
    monkeypatch.setattr(rl_mod, "USAGE_FILE", tmp_path / "usage.json")
    # 画像每轮都要读一次笔记本目录 —— 指到临时目录，绝不读 backend/data/notebooks/
    from services.notebook_service import notebook_service

    notebooks = tmp_path / "notebooks"
    notebooks.mkdir()
    monkeypatch.setattr(type(notebook_service), "NOTEBOOK_DIR", notebooks)

    from services.auth_service import create_access_token
    from services.storage_service import StorageService

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True
        # profile 整个是 None：注册/游客时一个字段都没填的那种用户（线上真实存在）
        await StorageService.save_user(User(
            user_id=USER_ID, user_type=UserType.REGISTERED,
            username="profile_e2e", password_hash="x",
        ))

    asyncio.run(_init())

    client = TestClient(app)
    client.headers.update({"Authorization": f"Bearer {create_access_token(USER_ID, UserType.REGISTERED)}"})
    return client


def _install_llm(monkeypatch, scripts):
    from services import llm

    prov = FakeProvider(scripts)
    monkeypatch.setattr(llm, "get_provider", lambda agent: prov)
    return prov


def _seed(conv_id, messages, *, phase="reading", session_type=SessionType.ASTROLOGY):
    from services.storage_service import StorageService

    asyncio.run(StorageService.save_conversation(Conversation(
        conversation_id=conv_id, user_id=USER_ID, session_type=session_type,
        phase=phase, messages=messages,
    )))


def _get_conversation(conv_id):
    from services.storage_service import StorageService

    return asyncio.run(StorageService.get_conversation(conv_id))


def _get_user():
    from services.storage_service import StorageService

    return asyncio.run(StorageService.get_user(USER_ID))


def _profile_block(system: str) -> str:
    """系统提示词里的 <用户资料> 块（到下一个一级标题为止）。"""
    assert "# <用户资料>" in system, system
    body = system.split("# <用户资料>", 1)[1]
    return body.split("\n#", 1)[0].strip()


# ---------------------------------------------------------------------------
# 1 + 2. 解读相位：缺 → 填 → 固定位置刷新
# ---------------------------------------------------------------------------

def test_filling_profile_mid_reading_refreshes_the_fixed_block_and_the_user_record(
    env, monkeypatch
):
    """解读到一半补资料：存回用户表，同一轮的 <用户资料> 就已经是新值。

    「补回固定位置」的全部含义就在这里——补的资料没有被写成对话里的一句话，而是下一次
    调用重新渲染的那一块。
    """
    _seed("conv_reading", [
        Message(role=MessageRole.USER, content="看看我的本命盘"),
        tool_turns.assistant_message("先告诉我出生日期、时间和地点。", [ASK_PROFILE]),
    ])
    prov = _install_llm(monkeypatch, [[_text("好，我看看你的盘。")]])

    # —— 填之前：块在，但写明什么都没有 ——
    before = _profile_block(_render_system("conv_reading"))
    assert before == "尚未完善\n本命星盘：无法排盘（缺出生日期、出生时间、出生地点）"

    # —— 用户提交表单：前端就是这两步，先 PUT 资料，再 resume ——
    assert env.put(f"/api/users/{USER_ID}/profile", json=PROFILE_FULL).status_code == 200
    assert env.post("/api/astrology/resume", json={"conversation_id": "conv_reading"}).status_code == 200

    # 1) 存回用户库
    saved = _get_user().profile
    assert (saved.birth_year, saved.birth_month, saved.birth_day) == (1996, 3, 12)
    assert (saved.birth_hour, saved.birth_minute, saved.birth_city) == (8, 30, "上海")
    assert saved.nickname == "阿岚"

    # 2) 这一轮发给模型的固定位置已经是新值（不是下一轮才生效）
    assert _profile_block(prov.sessions[0].system) == (
        "昵称：阿岚\n性别：女\n生日：1996年3月12日 08:30\n出生地点：上海\n"
        "本命星盘：未保存（出生资料齐全，可以排盘）"
    )

    # 3) 对话里那条结果只指向固定位置，不抄一份值：正本那边刚好从「尚未完善」变成真资料，
    #    对话里再抄一遍就是同一件事存两处，而对话里那处不会跟着用户后来的修改走
    conv = _get_conversation("conv_reading")
    assert [m.role for m in conv.messages] == [
        MessageRole.USER, MessageRole.ASSISTANT, MessageRole.TOOL, MessageRole.ASSISTANT]
    assert json.loads(conv.messages[2].content) == {
        "success": True, "message": "用户已经填好资料，最新的一份见 <用户资料>"}
    assert "上海" not in conv.messages[2].content


def test_second_fill_in_one_conversation_inserts_the_values_below_the_old_record(
    env, monkeypatch
):
    """同一场里再补一次：这次带值，往下插一条；上一条原样留着，不回头改写。

    历史是「当时真实发生了什么」的记录，不是当前状态的镜子——当前状态在 <用户资料>。
    """
    first = ToolCallRecord(id="p1", name="request_user_profile", args={"reason": "要排盘"})
    first_result = {"success": True, "message": "用户已经填好资料，最新的一份见 <用户资料>"}
    _seed("conv_twice", [
        Message(role=MessageRole.USER, content="看看我的本命盘"),
        tool_turns.assistant_message("先填一下出生信息。", [first]),
        tool_turns.tool_message(first, first_result),
        Message(role=MessageRole.ASSISTANT, content="（解读了一段）"),
        Message(role=MessageRole.USER, content="等等，出生地我填错了"),
        tool_turns.assistant_message("那再填一次。", [ASK_PROFILE]),
    ])
    assert env.put(f"/api/users/{USER_ID}/profile", json=PROFILE_FULL).status_code == 200
    prov = _install_llm(monkeypatch, [[_text("好，重新排一次盘。")]])

    assert env.put(f"/api/users/{USER_ID}/profile", json=PROFILE_MOVED).status_code == 200
    assert env.post("/api/astrology/resume", json={"conversation_id": "conv_twice"}).status_code == 200

    conv = _get_conversation("conv_twice")
    assert json.loads(conv.messages[2].content) == first_result          # 旧的那条没被动过
    second = json.loads(conv.messages[-2].content)                       # 新的插在下面
    assert second["profile"]["birth_city"] == "北京"
    assert second["message"] == "用户又补了一次资料，这是最新的一份"
    assert "出生地点：北京" in _profile_block(prov.sessions[0].system)   # 固定位置同样是新值


def test_filling_profile_again_refreshes_the_block_and_drops_the_saved_chart(env, monkeypatch):
    """第二次填（改了出生地）：固定位置跟着改，上次存的基本星盘作废。

    刷新不是「第一次填才生效」——每轮现算，填几次刷几次。
    """
    from services.storage_service import StorageService

    assert env.put(f"/api/users/{USER_ID}/profile", json=PROFILE_FULL).status_code == 200
    # 假装已经排过一次盘（get_astrology_chart 成功后会存下 12 宫落座）
    user = _get_user()
    user.natal_chart = "1宫：白羊座"
    asyncio.run(StorageService.save_user(user))

    _seed("conv_again", [Message(role=MessageRole.ASSISTANT, content="想聊什么？")])
    prov = _install_llm(monkeypatch, [[_text("好。")]])

    assert env.put(f"/api/users/{USER_ID}/profile", json=PROFILE_MOVED).status_code == 200
    assert env.post("/api/astrology/message", json={
        "conversation_id": "conv_again", "content": "我出生地填错了，改成北京",
    }).status_code == 200

    assert _get_user().natal_chart is None      # 出生资料变了，旧盘作废
    block = _profile_block(prov.sessions[0].system)
    assert "出生地点：北京" in block and "上海" not in block
    assert block.endswith("本命星盘：未保存（出生资料齐全，可以排盘）")
    assert "1宫：白羊座" not in prov.sessions[0].system


# ---------------------------------------------------------------------------
# 3. 开场相位：一样能要资料
# ---------------------------------------------------------------------------

def test_opening_can_ask_for_the_profile_and_resume_in_the_same_phase(env, monkeypatch):
    """开场相位也拿得到 request_user_profile：问了就收口，填完回到开场相位接着跑。

    开场不是「什么都不能干」——用户想走星盘那条路，前置占卜师得能当场把出生信息要到手，
    否则它没法判断这条路走不走得通。
    """
    _seed("conv_opening", [
        Message(role=MessageRole.ASSISTANT, content="坐吧。今天想聊些什么？"),
    ], phase="opening", session_type=SessionType.ASTROLOGY)
    prov = _install_llm(monkeypatch, [
        [_call("request_user_profile", {"reason": "要排盘",
                                        "required_fields": ["birth_date", "birth_time", "birth_city"]})],
        [_text("好，那我们从你的盘开始。")],
    ])

    assert env.post("/api/astrology/message", json={
        "conversation_id": "conv_opening", "content": "我想看看我的本命盘",
    }).status_code == 200

    # 开场的工具集里确实有它；这一轮看到的资料是「什么都没有」
    assert tool_names(prov.sessions[0].tools) == ["submit_reading_brief", "request_user_profile"]
    assert "尚未完善" in _profile_block(prov.sessions[0].system)

    # interrupt 收口：调用停在会话末尾（前端据此显示填资料按钮），相位没动
    conv = _get_conversation("conv_opening")
    assert conv.phase == "opening"
    assert conv.messages[-1].tool_calls[0].name == "request_user_profile"

    # 填完 → resume：还在开场相位（工具集仍是开场那两个），固定位置已是新值
    assert env.put(f"/api/users/{USER_ID}/profile", json=PROFILE_FULL).status_code == 200
    assert env.post("/api/astrology/resume", json={"conversation_id": "conv_opening"}).status_code == 200

    assert tool_names(prov.sessions[1].tools) == ["submit_reading_brief", "request_user_profile"]
    assert "生日：1996年3月12日 08:30" in _profile_block(prov.sessions[1].system)
    conv = _get_conversation("conv_opening")
    assert conv.phase == "opening"
    assert json.loads(conv.messages[-2].content) == {
        "success": True, "message": "用户已经填好资料，最新的一份见 <用户资料>"}


# ---------------------------------------------------------------------------
# 工具：不打模型也要看到系统提示词（填之前那一眼）
# ---------------------------------------------------------------------------

def _render_system(conv_id: str) -> str:
    """按会话现在的状态渲染一次系统提示词——和这一轮真发出去的是同一个函数。"""
    from services import context_service

    conv = _get_conversation(conv_id)
    return context_service.build_reading_prompt(
        session_type=conv.session_type,
        user_context=context_service.build_user_context(_get_user()),
        strategy=conv.strategy,
        portrait_context=context_service.build_portrait_context(_get_user()),
    )
