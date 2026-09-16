"""真 key 联通性自检：三个 Agent 各打一次真实请求，验 .env 配的 provider 能不能用。

用法：source venv/bin/activate && python backend/scripts/check_providers.py

只读，不碰 data/，不写库。按风险从低到高逐项验——这正是多 provider 那期计划里
「mock 看不见」的三个点：
  1. memory  → generate_json：JSON 模式能不能出合法 JSON
  2. opening → 工具调用：tool_call 的参数格式（enum / array / int 能不能原样回来）
  3. opening → force_tool：tool_choice 指定函数（守卫第 2 层所依赖）支不支持
  4. reading → 纯文本：解读 Agent 的普通对话往返
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
from services.llm import agent_config, catalog, tools   # noqa: E402

OK, BAD, SKIP = "✅", "❌", "⏭️"


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
    prov = llm.get_provider("opening")
    session = prov.open_session(
        "你是占卜师。用户的问题已经清楚了，立刻调用 submit_reading_brief 交单，"
        "route 填 tarot，牌阵用三张，positions 三个位置含义。不要说话。",
        [],
        tools.specs_by_names(tools.OPENING_TOOL_NAMES),
    )
    result = await session.send_user("我该不该接这个外地的 offer？")
    assert result.tool_calls, f"没有触发工具调用，只返回了文本：{result.text[:80]!r}"
    call = result.tool_calls[0]
    assert call.name == "submit_reading_brief", f"调错了工具：{call.name}"
    args = call.args
    assert args.get("route") in ("tarot", "astrology"), f"route 取值非法：{args.get('route')!r}"
    detail = f"route={args.get('route')} spread={args.get('spread_type')!r}"
    positions = args.get("positions")
    # 数组参数是 provider 差异最大的地方：这里要的是纯 list，不是 SDK 的私有类型
    assert isinstance(positions, list), f"positions 不是 list：{type(positions).__name__}"
    detail += f" positions={len(positions)}张 {positions}"
    return detail


class Skipped(Exception):
    """这一项在当前配置下不适用——不是失败。"""


async def check_force_tool():
    """守卫第 2 层：tool_choice 指定函数。

    不是每个模型都有这个能力（Kimi 全系没有），清单里标了的就跳过——这正是
    catalog.supports_forced_tool 的用途，跳过属于预期，不该算作未通过。
    """
    provider_name, model, _ = agent_config.resolve("opening")
    if not catalog.supports_forced_tool(provider_name, model):
        raise Skipped(f"{provider_name}/{model} 不支持，守卫第 2 层自动降级（第 3 层仍兜底）")

    prov = llm.get_provider("opening")
    session = prov.open_session(
        "你是占卜师。", [],
        tools.specs_by_names(tools.OPENING_TOOL_NAMES),
        force_tool="submit_reading_brief",
    )
    result = await session.send_user("不知道欸，说不上来")
    assert result.tool_calls, "强制模式下仍未调用工具"
    return f"强制交单生效（{result.tool_calls[0].name}）"


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
    ("opening · force_tool 强制交单", check_force_tool),
    ("reading · 纯文本往返", check_reading_text),
]


async def main():
    print("配置（管理页覆盖优先，否则 .env）：")
    for agent in llm.AGENT_CONFIG:
        provider, model, source = agent_config.resolve(agent)
        forced = "可强制交单" if catalog.supports_forced_tool(provider, model) else "无强制交单"
        print(f"  {agent:8s} {provider:10s} {model:24s} [{source}] {forced}")
    print()

    failed = 0
    for label, fn in CHECKS:
        try:
            _line(OK, label, await fn())
        except Skipped as e:
            _line(SKIP, label, str(e))
        except Exception as e:                      # noqa: BLE001 —— 自检要把错误打全
            failed += 1
            _line(BAD, label, f"{type(e).__name__}: {e}")
    print()
    print("全部通过，可以开始联调。" if not failed else f"{failed} 项未通过。")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
