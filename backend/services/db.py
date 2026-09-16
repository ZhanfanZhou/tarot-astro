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

_initialized = False

# ⚠️ 这个锁必须惰性创建，不能写成模块级 `_init_lock = asyncio.Lock()`。
# Python 3.9 的 asyncio.Lock 在「构造时」就把 get_event_loop() 的结果存进 self._loop，
# 而本模块是在 uvicorn 建好自己的 loop 之前被 import 的 —— 锁绑的是另一个 loop。
# 无争用时 acquire() 直接返回、碰不到 loop，所以串行请求一路正常；一旦两个请求同时
# 进来（浏览器首屏并发打 conversations / daily / wallet 就是这样），后到的那个要
# self._loop.create_future() 排队，于是 500：
#     RuntimeError: ... got Future <Future pending> attached to a different loop
# 按当前正在跑的 loop 创建/重建，既修了它，也让测试里反复 asyncio.run() 各自拿到自己的锁。
_init_lock = None
_init_lock_loop = None


def _get_init_lock() -> asyncio.Lock:
    global _init_lock, _init_lock_loop
    loop = asyncio.get_running_loop()
    # 单线程事件循环里 check-then-set 之间没有 await，不会被其他协程插入
    if _init_lock is None or _init_lock_loop is not loop:
        _init_lock = asyncio.Lock()
        _init_lock_loop = loop
    return _init_lock


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
    async with _get_init_lock():
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
