"""一次性清理：删掉游客的笔记本（笔记本只对注册用户开放）。

只删 data/notebooks/ 下属于游客的 note_<user_id>.log 和 portrait_<user_id>.json。
游客的账号、会话、每日一签、钱包、用量一律不动。

身份按 app.db 里的 user_type 判断，不看文件名：游客转成注册用户后 user_id 不变，
仍是 guest_ 开头。库里找不到对应用户的笔记本文件只列出来，不删。

用法（仓库根目录，已激活 venv；先不带参数看一遍，确认后再加 --apply）::

    python backend/scripts/cleanup_guest_notebooks.py           # 只列出
    python backend/scripts/cleanup_guest_notebooks.py --apply   # 真删
"""
import argparse
import sqlite3
import sys
from pathlib import Path
from typing import List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402

PATTERNS = [("note_", ".log"), ("portrait_", ".json")]   # 笔记本的两份文件：笔记、画像


def find_guest_notebooks(db_file: Path, notebook_dir: Path) -> Tuple[List[Path], List[Path]]:
    """(游客的笔记本文件, 库里找不到用户的笔记本文件)。只读库，不改任何东西。"""
    db = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True)
    try:
        user_types = dict(db.execute(
            "SELECT user_id, json_extract(data, '$.user_type') FROM users").fetchall())
    finally:
        db.close()

    guests, orphans = [], []
    for prefix, suffix in PATTERNS:
        for path in sorted(notebook_dir.glob(f"{prefix}*{suffix}")):
            user_id = path.name[len(prefix):-len(suffix)]
            if user_id not in user_types:
                orphans.append(path)
            elif user_types[user_id] == "guest":
                guests.append(path)
    return guests, orphans


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="真的删除（不带时只列出）")
    args = parser.parse_args()

    guests, orphans = find_guest_notebooks(config.DB_FILE, config.DATA_DIR / "notebooks")
    print(f"游客的笔记本文件：{len(guests)} 个")
    for path in guests:
        print(f"  {path.name}")
    if orphans:
        print(f"库里找不到用户的笔记本文件（不处理）：{len(orphans)} 个")
        for path in orphans:
            print(f"  {path.name}")

    if not args.apply:
        print("\n只列出，没有删除。确认无误后加 --apply。")
        return
    for path in guests:
        path.unlink()
    print(f"\n已删除 {len(guests)} 个游客笔记本文件。")


if __name__ == "__main__":
    main()
