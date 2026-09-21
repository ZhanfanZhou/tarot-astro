"""真 key 联通性自检：三个 Agent 各打一次真实请求，验 .env 配的 provider 能不能用。

用法：source venv/bin/activate && python backend/scripts/check_providers.py

只读，不碰 data/，不写库。按风险从低到高逐项验——这正是多 provider 那期计划里
「mock 看不见」的三个点：
  1. memory  → generate_json：JSON 模式能不能出合法 JSON
  2. opening → 工具调用：tool_call 的参数格式（交单的 enum、抽牌的 array 能不能原样回来）
  3. reading → 纯文本：解读 Agent 的普通对话往返
"""
import asyncio
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT.parent / ".env")

import config                                      # noqa: E402
from services import llm                           # noqa: E402
from services import spread_service                 # noqa: E402
from services.llm import agent_config, tools   # noqa: E402

OK, BAD = "✅", "❌"


def _line(status, label, detail=""):
    print(f"{status} {label}" + (f" —— {detail}" if detail else ""))


async def check_memory():
    prov = llm.get_provider("memory")
    raw = await prov.generate_json(
        '用 JSON 回答，只输出一个对象：{"summary": "一句话", "cards_drawn": []}'
    )
    data = json.loads(raw)
    assert "summary" in data, f"缺 summary 字段: {data}"
    return f"JSON 模式可用，返回 {list(data.keys())}"


async def check_opening_tool_call():
    """enum 与 array 两种参数各验一次，都在 opening 那个 provider 上。

    交单只出 enum（route / spread_type 都锁死取值）；array 挪到了抽牌工具上，
    所以第二次往返带上 draw_tarot_cards —— 数组参数是 provider 差异最大的地方，
    少验一次，某家 SDK 回私有类型就要等线上抽牌时才发现。
    """
    prov = llm.get_provider("opening")
    session = prov.open_session(
        "你是占卜师。用户的问题已经清楚了，立刻调用 submit_reading_brief 交单，"
        "route 填 tarot，牌阵从 spread_type 允许的取值里挑一个。不要说话。",
        [],
        tools.specs_by_names(tools.OPENING_TOOL_NAMES),
    )
    result = await session.send_user("我该不该接这个外地的 offer？")
    assert result.tool_calls, f"没有触发工具调用，只返回了文本：{result.text[:80]!r}"
    call = result.tool_calls[0]
    assert call.name == "submit_reading_brief", f"调错了工具：{call.name}"
    args = call.args
    assert args.get("route") in ("tarot", "astrology"), f"route 取值非法：{args.get('route')!r}"
    spread = args.get("spread_type")
    assert spread in spread_service.SPREAD_IDS, (
        f"spread_type 不在牌阵目录里：{spread!r}（可选 {spread_service.SPREAD_IDS}）")
    detail = f"route={args.get('route')} spread={spread!r}"

    session = prov.open_session(
        "你是占卜师。立刻调用 draw_tarot_cards 抽三张牌，不要说话。", [],
        tools.specs_by_names(["draw_tarot_cards"]),
    )
    result = await session.send_user("帮我看看接下来会怎么发展")
    assert result.tool_calls, "抽牌工具没有被调用"
    positions = result.tool_calls[0].args.get("positions")
    assert isinstance(positions, list), f"positions 不是 list：{type(positions).__name__}"
    return detail + f" ｜ array 参数回来了 {len(positions)} 项"


async def check_reading_text():
    prov = llm.get_provider("reading")
    session = prov.open_session(
        "你是占卜师，说话简短。", [],
        tools.specs_by_names(tools.READING_TOOL_NAMES),
    )
    result = await session.send_user("用一句话打个招呼，不要调用任何工具。")
    assert result.text.strip(), "返回空文本"
    return repr(result.text.strip()[:40])


CHECKS = [
    ("memory  · generate_json", check_memory),
    ("opening · 工具调用参数", check_opening_tool_call),
    ("reading · 纯文本往返", check_reading_text),
]


async def main():
    print("配置（管理页覆盖优先，否则 .env）：")
    for agent in llm.AGENT_CONFIG:
        provider, model, source = agent_config.resolve(agent)
        print(f"  {agent:8s} {provider:10s} {model:24s} [{source}]")
    print()

    failed = 0
    for label, fn in CHECKS:
        try:
            _line(OK, label, await fn())
        except Exception as e:                      # noqa: BLE001 —— 自检要把错误打全
            failed += 1
            _line(BAD, label, f"{type(e).__name__}: {e}")
    print()
    print("全部通过，可以开始联调。" if not failed else f"{failed} 项未通过。")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
