"""SQLite 连接与建表（aiosqlite + WAL），替代原 JSON 文件存储的底层。

单文件 backend/data/app.db。WAL 模式带来：并发读、崩溃安全（不会半截损坏整库）、
写只动单行（告别全量重写）。连接按操作开/关——本地小库开销亚毫秒，且避免跨协程
共享一个连接的并发陷阱；对低流量个人应用（T3 nano、单 uvicorn worker）足够。

测试通过环境变量 TAROT_DB_FILE 或 monkeypatch ``services.db.DB_FILE`` 指向临时库，
绝不触碰生产数据。
"""
import asyncio
from contextlib import asynccontextmanager

import aiosqlite

import config

# 模块级路径变量：默认取 config.DB_FILE，测试可 monkeypatch 本变量后重置 _initialized。
DB_FILE = config.DB_FILE

# 整库以「完整对象 JSON」存在 data 列里（messages 也在其中），另把需要查询/排序的字段
# 冗余成影子列建索引。读取时只从 data 还原 → 任何字段（含未来新增）都不会在迁移中丢。
_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id  TEXT PRIMARY KEY,
    username TEXT,
    data     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    data            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_user_updated
    ON conversations(user_id, updated_at);
"""

_init_lock = asyncio.Lock()
_initialized = False


async def init_db() -> None:
    """建表 + 开 WAL（幂等）。WAL 是写进库头的持久设置，设一次即可。"""
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.executescript(_SCHEMA)
        await db.commit()


async def _ensure_initialized() -> None:
    global _initialized
    if _initialized:
        return
    async with _init_lock:
        if not _initialized:
            await init_db()
            _initialized = True


@asynccontextmanager
async def get_db():
    """打开一个配置好的连接（每操作一个）。

    row_factory=Row 便于按列名取值；busy_timeout 避免偶发 ``database is locked``；
    synchronous=NORMAL 是 WAL 下耐久/速度的甜点。
    """
    await _ensure_initialized()
    db = await aiosqlite.connect(DB_FILE)
    try:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA busy_timeout=5000")
        await db.execute("PRAGMA synchronous=NORMAL")
        yield db
    finally:
        await db.close()
