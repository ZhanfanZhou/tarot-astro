"""admin router 测试。config.ADMIN_PASSWORD 用 monkeypatch 注入（admin.py 必须
运行时经 config.ADMIN_PASSWORD 属性访问，不能 from config import 快照）。
存储指向 tmp_path 临时库，照例不碰 backend/data/。"""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import User, UserType  # noqa: E402
from services.auth_service import create_access_token, decode_access_token  # noqa: E402

ADMIN_PW = "test-admin-pw"


@pytest.fixture
def client(tmp_path, monkeypatch):
    import config
    import services.db as db_mod
    import routers.admin as admin_mod
    # 提前导入 main（先于下面的 asyncio.run）：main -> routers.tarot ->
    # rate_limit_service 会在模块级创建 asyncio.Lock()，py3.9 下 asyncio.run()
    # 结束时会清空当前线程的 event loop，若 main 尚未被任何测试导入过，
    # 此后首次 `from main import app` 会在无 running loop 时构造 Lock 而报错。
    # 提前导入让该模块级副作用在 loop 状态被清空前完成（同一进程内 import 只执行一次）。
    from main import app

    monkeypatch.setattr(config, "ADMIN_PASSWORD", ADMIN_PW)
    monkeypatch.setattr(db_mod, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_initialized", False)

    async def _init():
        await db_mod.init_db()
        db_mod._initialized = True

    asyncio.run(_init())
    # 重置登录失败计数（进程内状态，测试间隔离）
    admin_mod._login_fails.update({"count": 0, "locked_until": 0.0})

    return TestClient(app)


def _admin_headers(client) -> dict:
    token = client.post("/api/admin/login", json={"password": ADMIN_PW}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestAdminLogin:
    def test_disabled_when_password_unset(self, client, monkeypatch):
        import config
        monkeypatch.setattr(config, "ADMIN_PASSWORD", "")
        assert client.post("/api/admin/login", json={"password": "x"}).status_code == 404

    def test_wrong_password_401(self, client):
        assert client.post("/api/admin/login", json={"password": "nope"}).status_code == 401

    def test_correct_password_returns_admin_token(self, client):
        resp = client.post("/api/admin/login", json={"password": ADMIN_PW})
        assert resp.status_code == 200
        payload = decode_access_token(resp.json()["access_token"])
        assert payload["role"] == "admin"
        assert payload["sub"] == "admin"

    def test_lockout_after_5_fails(self, client):
        for _ in range(5):
            assert client.post("/api/admin/login", json={"password": "no"}).status_code == 401
        # 第 6 次（即使密码正确）也被锁
        assert client.post("/api/admin/login", json={"password": ADMIN_PW}).status_code == 429


class TestRequireAdmin:
    """经无业务依赖的受保护端点 GET /api/admin/ping 测试门卫（数据端点 Task 5 才有）。"""

    def test_no_token_401(self, client):
        assert client.get("/api/admin/ping").status_code == 401

    def test_user_token_403(self, client):
        user_token = create_access_token("user_abc", UserType.REGISTERED)
        resp = client.get("/api/admin/ping", headers={"Authorization": f"Bearer {user_token}"})
        assert resp.status_code == 403

    def test_admin_token_ok(self, client):
        resp = client.get("/api/admin/ping", headers=_admin_headers(client))
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
