"""一次性迁移：把 2026-09 之前的会话改写成工具轮的官方形状。

旧格式（三处伪造，都是为了绕开「工具结果被当成聊天消息」这一件事）：
  · 抽牌结果 / 星盘数据套在 SYSTEM 消息里（content「用户已完成抽牌」/「[星盘数据]…」）
  · 前端发一条假的用户发言当触发语（「请根据抽牌结果进行解读」等四句），渲染时按内容藏掉
  · 后端把牌复制一份到解读那条 assistant 上
  · 每日一签：第一条 SYSTEM 是服务端抽的今日牌，之后同样一条假用户发言

新格式：ASSISTANT(tool_calls=[…]) → TOOL(tool_call_id=同一个 id)。调用当初没有记录，这里
从结果反推一次（这是唯一允许反推的地方——一次性、可备份、可校验，不进运行时）：
  · SYSTEM 抽牌 → 并进前一条 assistant 的 tool_calls（没有就补一条空 assistant），结果写 TOOL
  · SYSTEM 星盘 → 同上，name=get_astrology_chart
  · 触发语用户消息 → 删除
  · assistant 上复制的牌 → 删除（牌只在 TOOL 上）
  · 每日一签的今日牌 → 挂到第一条 assistant（解读）上，SYSTEM 删除
不运行也可以：含旧格式的会话在运行时是只读的（services/tool_turns.is_legacy），新会话不受影响。

用法（仓库根目录，已激活 venv；先备份 app.db 再改，逐条校验，任一不符 exit(1)）::

    python backend/scripts/migrate_tool_turns.py            # 迁移生产库
    python backend/scripts/migrate_tool_turns.py --db /path/test.db --dry-run
"""
import argparse
import asyncio
import json
import shutil
import sys
import uuid
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import aiosqlite  # noqa: E402

import config  # noqa: E402
from models import Conversation, MessageRole  # noqa: E402
from services import tool_turns  # noqa: E402

TRIGGER_LINES = {
    "请根据抽牌结果进行解读",
    "资料补充好了，我的星盘信息已经准备好了",
    "星盘数据已准备好，请继续解读",
    "我已经填写好出生信息了",
}
CHART_PREFIX = "[星盘数据]"


def _call(name, args):
    return {"id": f"migrated-{name}-{uuid.uuid4().hex[:8]}", "name": name, "args": args}


def _attach_call(out: list, call: dict) -> None:
    """调用并进前一条 assistant（它当初就是在那一轮既说了话又发起了调用）；没有就补一条。"""
    if out and out[-1]["role"] == "assistant" and not out[-1].get("tool_calls"):
        out[-1]["tool_calls"] = [call]
    else:
        out.append({"role": "assistant", "content": "", "timestamp": _ts(out), "tool_calls": [call]})


def _ts(out: list) -> str:
    return out[-1]["timestamp"] if out else datetime.utcnow().isoformat()


def _tool(call: dict, result: dict, msg: dict) -> dict:
    return {
        "role": "tool", "content": json.dumps(result, ensure_ascii=False),
        "timestamp": msg.get("timestamp") or datetime.utcnow().isoformat(),
        "tool_call_id": call["id"], "tool_name": call["name"],
        "tarot_cards": msg.get("tarot_cards"), "draw_request": msg.get("draw_request"),
    }


def _cards_result(msg: dict) -> dict:
    positions = (msg.get("draw_request") or {}).get("positions") or []
    return {"cards": [{
        "position": positions[i] if i < len(positions) else f"第{i + 1}张",
        "card": c["card_name"],
        "orientation": "逆位" if c.get("reversed") else "正位",
    } for i, c in enumerate(msg.get("tarot_cards") or [])]}


def convert(raw: dict) -> dict:
    """旧格式会话 dict → 新格式 dict。已是新格式的原样返回。"""
    msgs = raw.get("messages") or []
    if not any(m["role"] == "system" or (m["role"] == "tool" and not m.get("tool_call_id")) for m in msgs):
        return raw

    is_daily = raw.get("session_type") == "daily"
    out: list = []
    daily_card = None
    for i, m in enumerate(msgs):
        role = m["role"]
        if role == "user":
            if m["content"] in TRIGGER_LINES:
                continue
            out.append(dict(m))
        elif role == "assistant":
            m = dict(m)
            if daily_card is not None:
                # 今日签：挂到解读上，之后不再挂
                m["tarot_cards"], m["draw_request"] = daily_card["tarot_cards"], daily_card.get("draw_request")
                daily_card = None
            else:
                m.pop("tarot_cards", None)   # 后端复制过去的副本
                m.pop("draw_request", None)
            out.append(m)
        elif role in ("system", "tool"):
            if m.get("tarot_cards"):
                if is_daily and i == 0:
                    daily_card = m          # 服务端直接抽的，不是模型调的
                    continue
                call = _call("draw_tarot_cards", {
                    "spread_type": (m.get("draw_request") or {}).get("spread_type") or "custom",
                    "positions": (m.get("draw_request") or {}).get("positions") or [],
                })
                _attach_call(out, call)
                out.append(_tool(call, _cards_result(m), m))
            elif m["content"].startswith(CHART_PREFIX) or m.get("tool_name") == "get_astrology_chart":
                chart = m["content"]
                if chart.startswith(CHART_PREFIX):
                    chart = chart[len(CHART_PREFIX):].lstrip()
                call = _call("get_astrology_chart", {})
                _attach_call(out, call)
                out.append(_tool(call, {"success": True, "data": chart}, m))
            # 其余 SYSTEM（无牌无盘）不是任何记录，丢弃
    new = dict(raw)
    new["messages"] = out
    return new


def verify(new: dict) -> None:
    conv = Conversation(**new)          # 模型可重建
    assert not tool_turns.is_legacy(conv), "仍含旧格式记录"
    pending = None
    for m in conv.messages:
        if m.role == MessageRole.TOOL:
            assert pending and m.tool_call_id == pending, "TOOL 没有对上前面的调用"
            pending = None
        else:
            assert pending is None, "调用后面没有紧跟结果"
            if m.role == MessageRole.ASSISTANT and m.tool_calls:
                pending = m.tool_calls[0].id
    # 末尾允许挂着一次没结果的 interrupt 调用（用户当时没抽牌就走了）；运行时会记成「没做」
    for m in conv.messages:
        assert m.role != MessageRole.USER or m.content not in TRIGGER_LINES


async def migrate(db_path: Path, dry_run: bool) -> int:
    if not db_path.exists():
        print(f"{db_path} 不存在，没有可迁移的数据")
        return 0
    if not dry_run:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = db_path.with_suffix(db_path.suffix + f".bak.{stamp}")
        shutil.copy2(db_path, backup)
        print(f"已备份 → {backup}")

    changed = 0
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("SELECT conversation_id, data FROM conversations")
        for row in rows:
            raw = json.loads(row["data"])
            new = convert(raw)
            if new is raw:
                continue
            verify(new)
            before = sum(1 for m in raw["messages"] if m["role"] in ("user", "assistant")
                         and m["content"] not in TRIGGER_LINES)
            after = sum(1 for m in new["messages"] if m["role"] in ("user", "assistant"))
            assert before == after, f"{row['conversation_id']}: 对话文本轮数变了 {before}→{after}"
            changed += 1
            print(f"  {row['conversation_id']}: {len(raw['messages'])} 条 → {len(new['messages'])} 条")
            if not dry_run:
                await db.execute("UPDATE conversations SET data=? WHERE conversation_id=?",
                                 (json.dumps(new, ensure_ascii=False), row["conversation_id"]))
        if not dry_run:
            await db.commit()
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(config.DB_FILE))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    n = asyncio.run(migrate(Path(args.db), args.dry_run))
    print(f"{'将改写' if args.dry_run else '已改写'} {n} 场会话")


if __name__ == "__main__":
    main()
