"""并发首次访问 DB 的回归测试 —— 守 py3.9 下 init 锁跨事件循环那个 500。

历史问题：`_init_lock` 写成模块级 `asyncio.Lock()`，在 uvicorn 建 loop 之前就被
导入并绑定了另一个 loop。无争用时 acquire() 压根不碰 loop，所以串行请求全绿；
浏览器首屏并发打 conversations / daily / wallet 时，后到的请求要在错误的 loop 上
create_future()，整条请求 500：

    RuntimeError: ... got Future <Future pending> attached to a different loop

注意这里**不**预置 `_initialized=True`（test_storage_service 那套 fixture 正是靠
预置来绕开锁的），必须让并发请求真的去抢这把锁，否则测不到东西。
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_concurrent_first_access_does_not_cross_event_loops(tmp_path, monkeypatch):
    import services.db as db_mod

    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "concurrent.db")
    monkeypatch.setattr(db_mod, "_initialized", False)
    # 模拟「模块在别的 loop 里被 import」：留一把绑在旧 loop 上的锁
    stale_loop = asyncio.new_event_loop()
    try:
        monkeypatch.setattr(db_mod, "_init_lock", stale_loop.run_until_complete(_make_lock()))
        monkeypatch.setattr(db_mod, "_init_lock_loop", stale_loop)

        async def touch():
            async with db_mod.get_db() as db:
                cur = await db.execute("SELECT COUNT(*) FROM users")
                return (await cur.fetchone())[0]

        async def main():
            # 三个并发请求同时撞上未初始化的库 —— 这正是首屏的形状
            return await asyncio.gather(*(touch() for _ in range(3)))

        assert asyncio.run(main()) == [0, 0, 0]
        assert db_mod._initialized is True
    finally:
        stale_loop.close()


async def _make_lock():
    return asyncio.Lock()
