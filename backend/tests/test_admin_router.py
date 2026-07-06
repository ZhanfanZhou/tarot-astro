"""admin router 测试。config.ADMIN_PASSWORD 用 monkeypatch 注入（admin.py 必须
运行时经 config.ADMIN_PASSWORD 属性访问，不能 from config import 快照）。
存储指向 tmp_path 临时库，照例不碰 backend/data/。"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jose import jwt

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import User, UserType  # noqa: E402
from services.auth_service import (  # noqa: E402
    create_access_token, create_admin_token, decode_access_token,
)

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


class TestSecurityProperties:
    """把设计声明变成测试保证：token 混淆/过期/伪造/功能开关。"""

    def test_admin_token_rejected_by_user_endpoint(self, client):
        # admin token 的 sub='admin' 不对应任何真实用户：误用于用户接口时
        # get_current_user 查库必失败 → 401（create_admin_token 的设计声明）
        token = create_admin_token()
        resp = client.get("/api/users/admin", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401

    def test_expired_admin_token_401(self, client):
        import config
        now = datetime.now(timezone.utc)
        expired = jwt.encode(
            {
                "sub": "admin",
                "role": "admin",
                "iat": now - timedelta(hours=2),
                "exp": now - timedelta(hours=1),
            },
            config.SECRET_KEY,
            algorithm=config.ALGORITHM,
        )
        resp = client.get("/api/admin/ping", headers={"Authorization": f"Bearer {expired}"})
        assert resp.status_code == 401

    def test_forged_role_wrong_key_401(self, client):
        # 攻击者不知道 SECRET_KEY，自签 role=admin 的 token 必须被拒
        import config
        now = datetime.now(timezone.utc)
        forged = jwt.encode(
            {"sub": "admin", "role": "admin", "exp": now + timedelta(hours=1)},
            "wrong-key",
            algorithm=config.ALGORITHM,
        )
        resp = client.get("/api/admin/ping", headers={"Authorization": f"Bearer {forged}"})
        assert resp.status_code == 401

    def test_ping_404_when_password_unset(self, client, monkeypatch):
        import config
        # 先在功能开启时拿到合法 admin token，再关闭开关：即使 token 有效也应 404
        headers = _admin_headers(client)
        monkeypatch.setattr(config, "ADMIN_PASSWORD", "")
        assert client.get("/api/admin/ping", headers=headers).status_code == 404
