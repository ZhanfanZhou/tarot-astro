"""一次性迁移：users.json + conversations.json → SQLite app.db。

设计目标：**100% 无损**，游客与注册用户数据一条不丢。

- 对源 JSON **只读**（不删不改），先备份再迁移。
- 存进 SQLite ``data`` 列的是**原始 JSON 字典**（非经模型规范化），任何字段（含模型已
  不再声明的历史字段）都原样保留，与线上读路径 ``Model(**raw)`` 行为一致。
- 迁移后**逐条校验**：集合一致 + 深度字典相等 + 模型可重建 + 消息总数一致；
  任一不符立即 ``exit(1)``，不会谎报成功。
- 幂等：UPSERT，可重复运行不产生重复。

用法（在仓库根目录，已激活 venv）::

    python backend/scripts/migrate_json_to_sqlite.py            # 迁移生产数据
    python backend/scripts/migrate_json_to_sqlite.py --users /path/u.json \
        --conversations /path/c.json --db /path/test.db        # 指定文件（测试用）
"""
import argparse
import asyncio
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

# 让脚本可直接运行：把 backend/ 加入导入路径
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import config  # noqa: E402


def _load_json(path: Path) -> dict:
    if not path.exists():
        print(f"  [跳过] {path} 不存在，按空处理")
        return {}
    text = path.read_text(encoding="utf-8")
    return json.loads(text) if text.strip() else {}


def _backup(path: Path, stamp: str) -> None:
    if path.exists():
        dst = path.with_suffix(path.suffix + f".bak.{stamp}")
        shutil.copy2(path, dst)
        print(f"  备份 {path.name} → {dst.name}")


async def migrate(users_path: Path, convs_path: Path) -> int:
    # db 模块在 import config 之后再 import，确保 DB_FILE 已按 env 解析
    import services.db as db_mod

    print("=" * 64)
    print(f"迁移目标 DB: {db_mod.DB_FILE}")
    print(f"源 users:         {users_path}")
    print(f"源 conversations: {convs_path}")
    print("=" * 64)

    source_users = _load_json(users_path)
    source_convs = _load_json(convs_path)
    src_msg_total = sum(len(c.get("messages", [])) for c in source_convs.values())
    print(f"待迁移：用户 {len(source_users)} 个、对话 {len(source_convs)} 个、"
          f"消息 {src_msg_total} 条")

    # 备份源文件（即便迁移本身只读，也留一份带时间戳的副本）
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    _backup(users_path, stamp)
    _backup(convs_path, stamp)

    await db_mod.init_db()
    async with db_mod.get_db() as db:
        for uid, d in source_users.items():
            await db.execute(
                "INSERT INTO users(user_id, username, data) VALUES(?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET "
                "username=excluded.username, data=excluded.data",
                (uid, d.get("username"), json.dumps(d, ensure_ascii=False)),
            )
        for cid, d in source_convs.items():
            await db.execute(
                "INSERT INTO conversations(conversation_id, user_id, updated_at, data) "
                "VALUES(?,?,?,?) "
                "ON CONFLICT(conversation_id) DO UPDATE SET "
                "user_id=excluded.user_id, updated_at=excluded.updated_at, "
                "data=excluded.data",
                (
                    cid,
                    d.get("user_id", ""),
                    d.get("updated_at") or d.get("created_at") or "",
                    json.dumps(d, ensure_ascii=False),
                ),
            )
        await db.commit()

    # ── 校验：100% 无损 ──────────────────────────────────────────────────
    print("-" * 64)
    print("校验中……")
    from models import User, Conversation  # noqa: E402

    errors: list = []
    async with db_mod.get_db() as db:
        async with db.execute("SELECT user_id, data FROM users") as cur:
            db_users = {r["user_id"]: json.loads(r["data"]) for r in await cur.fetchall()}
        async with db.execute("SELECT conversation_id, data FROM conversations") as cur:
            db_convs = {r["conversation_id"]: json.loads(r["data"])
                        for r in await cur.fetchall()}

    # 集合一致
    if set(db_users) != set(source_users):
        errors.append(f"用户集合不一致：缺 {set(source_users) - set(db_users)}，"
                      f"多 {set(db_users) - set(source_users)}")
    if set(db_convs) != set(source_convs):
        errors.append(f"对话集合不一致：缺 {set(source_convs) - set(db_convs)}，"
                      f"多 {set(db_convs) - set(source_convs)}")

    # 逐条深度相等 + 模型可重建
    for uid, src in source_users.items():
        got = db_users.get(uid)
        if got != src:
            errors.append(f"用户 {uid} 内容不一致")
        else:
            User(**got)  # 不能重建则抛错
    for cid, src in source_convs.items():
        got = db_convs.get(cid)
        if got != src:
            errors.append(f"对话 {cid} 内容不一致")
        else:
            Conversation(**got)

    # 消息总数一致
    db_msg_total = sum(len(c.get("messages", [])) for c in db_convs.values())
    if db_msg_total != src_msg_total:
        errors.append(f"消息总数不一致：源 {src_msg_total} vs 库 {db_msg_total}")

    print("=" * 64)
    if errors:
        print("❌ 校验失败，迁移未通过（源 JSON 未改动，可安全重试）：")
        for e in errors:
            print(f"   - {e}")
        return 1
    print(f"✅ 校验通过：用户 {len(db_users)}/{len(source_users)}、"
          f"对话 {len(db_convs)}/{len(source_convs)}、消息 {db_msg_total}/{src_msg_total}，"
          f"全部一致，零丢失。")
    print(f"   DB 已就绪：{db_mod.DB_FILE}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="迁移 JSON 数据到 SQLite")
    parser.add_argument("--users", type=Path, default=config.USERS_FILE)
    parser.add_argument("--conversations", type=Path, default=config.CONVERSATIONS_FILE)
    parser.add_argument("--db", type=Path, default=None,
                        help="目标 DB 路径（覆盖默认 app.db；测试用）")
    args = parser.parse_args()

    if args.db is not None:
        import services.db as db_mod
        db_mod.DB_FILE = args.db

    code = asyncio.run(migrate(args.users, args.conversations))
    sys.exit(code)


if __name__ == "__main__":
    main()
