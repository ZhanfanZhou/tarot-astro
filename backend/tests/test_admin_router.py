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
    import services.prompt_service as ps_mod
    monkeypatch.setattr(ps_mod, "PROMPT_OVERRIDES_DIR", tmp_path / "prompt_overrides")

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


from models import (  # noqa: E402
    Conversation, Message, MessageRole, SessionType, UserProfile,
)
from services.storage_service import StorageService  # noqa: E402


def _seed(client):
    """2 用户（1 游客 1 注册）+ 3 会话。"""
    async def _run():
        await StorageService.save_user(User(user_id="guest_1", user_type=UserType.GUEST,
                                            profile=UserProfile(nickname="小游")))
        await StorageService.save_user(User(user_id="user_1", user_type=UserType.REGISTERED,
                                            username="alice"))
        await StorageService.save_conversation(Conversation(
            conversation_id="c1", user_id="guest_1", session_type=SessionType.TAROT,
            title="塔罗A", updated_at="2026-07-01T10:00:00",
            messages=[Message(role=MessageRole.USER, content="你好")]))
        await StorageService.save_conversation(Conversation(
            conversation_id="c2", user_id="user_1", session_type=SessionType.CHAT,
            title="聊愈B", updated_at="2026-07-03T10:00:00"))
        await StorageService.save_conversation(Conversation(
            conversation_id="c3", user_id="user_1", session_type=SessionType.TAROT,
            title="塔罗C", updated_at="2026-07-02T10:00:00"))
    asyncio.run(_run())


class TestAdminData:
    def test_stats(self, client):
        _seed(client)
        s = client.get("/api/admin/stats", headers=_admin_headers(client)).json()
        assert s["total_users"] == 2 and s["guest_users"] == 1 and s["registered_users"] == 1
        assert s["total_conversations"] == 3

    def test_conversations_sorted_filtered_enriched(self, client):
        _seed(client)
        h = _admin_headers(client)
        r = client.get("/api/admin/conversations", headers=h).json()
        assert r["total"] == 3
        assert [c["conversation_id"] for c in r["items"]] == ["c2", "c3", "c1"]  # updated_at 倒序
        assert r["items"][2]["nickname"] == "小游"          # 用户信息已联查
        assert r["items"][2]["message_count"] == 1
        r2 = client.get("/api/admin/conversations?session_type=tarot", headers=h).json()
        assert r2["total"] == 2
        r3 = client.get("/api/admin/conversations?limit=1&offset=1", headers=h).json()
        assert [c["conversation_id"] for c in r3["items"]] == ["c3"]

    def test_conversation_detail(self, client):
        _seed(client)
        h = _admin_headers(client)
        d = client.get("/api/admin/conversations/c1", headers=h).json()
        assert d["messages"][0]["content"] == "你好"
        assert client.get("/api/admin/conversations/nope", headers=h).status_code == 404

    def test_users_with_counts(self, client):
        _seed(client)
        r = client.get("/api/admin/users", headers=_admin_headers(client)).json()
        assert r["total"] == 2
        by_id = {u["user_id"]: u for u in r["items"]}
        assert by_id["user_1"]["conversation_count"] == 2
        assert by_id["user_1"]["last_active"] == "2026-07-03T10:00:00"
        assert by_id["guest_1"]["user_type"] == "guest"

    def test_users_filters(self, client):
        """用户列表筛选：搜索(用户名/昵称/ID)、类型、最后活跃时间范围。"""
        _seed(client)
        h = _admin_headers(client)

        def ids(query):
            r = client.get(f"/api/admin/users{query}", headers=h).json()
            return r["total"], sorted(u["user_id"] for u in r["items"])

        # 搜索:用户名 / 昵称 / user_id 三处任一命中
        assert ids("?q=alice") == (1, ["user_1"])
        assert ids("?q=小游") == (1, ["guest_1"])
        assert ids("?q=guest_1") == (1, ["guest_1"])
        assert ids("?q=nobody") == (0, [])
        # 类型
        assert ids("?user_type=guest") == (1, ["guest_1"])
        assert ids("?user_type=registered") == (1, ["user_1"])
        # 最后活跃时间范围(闭区间,按日期):guest_1=07-01, user_1=07-03
        assert ids("?active_from=2026-07-02") == (1, ["user_1"])
        assert ids("?active_to=2026-07-01") == (1, ["guest_1"])
        assert ids("?active_from=2026-07-01&active_to=2026-07-03") == (2, ["guest_1", "user_1"])

    def test_usage(self, client, tmp_path, monkeypatch):
        _seed(client)
        import json as _json
        from datetime import date
        import services.rate_limit_service as rl
        usage_file = tmp_path / "usage.json"
        usage_file.write_text(_json.dumps({date.today().isoformat(): {"guest_1": 3}}), encoding="utf-8")
        monkeypatch.setattr(rl, "USAGE_FILE", usage_file)
        r = client.get("/api/admin/usage", headers=_admin_headers(client)).json()
        assert r["entries"][0]["user_id"] == "guest_1" and r["entries"][0]["used"] == 3
        assert r["entries"][0]["nickname"] == "小游"
        assert r["guest_daily_limit"] > 0

    def test_usage_reset_single_user(self, client, tmp_path, monkeypatch):
        """清零单个用户今日额度：只影响该用户,其余保留;幂等。"""
        _seed(client)
        import json as _json
        from datetime import date
        import services.rate_limit_service as rl
        usage_file = tmp_path / "usage.json"
        today = date.today().isoformat()
        usage_file.write_text(
            _json.dumps({today: {"guest_1": 3, "user_1": 5}}), encoding="utf-8")
        monkeypatch.setattr(rl, "USAGE_FILE", usage_file)
        h = _admin_headers(client)

        assert client.delete("/api/admin/usage/guest_1", headers=h).status_code == 200
        left = _json.loads(usage_file.read_text(encoding="utf-8"))[today]
        assert "guest_1" not in left and left["user_1"] == 5   # 只清了 guest_1
        # 幂等:再删一次不报错
        assert client.delete("/api/admin/usage/guest_1", headers=h).status_code == 200
        # 用量接口不再列出被清零的用户
        r = client.get("/api/admin/usage", headers=h).json()
        assert all(e["user_id"] != "guest_1" for e in r["entries"])


class TestAdminDataSafety:
    """安全/健壮性回归：敏感字段零泄漏、脏数据不 500。"""

    def test_password_hash_never_leaks(self, client, tmp_path, monkeypatch):
        """最重要：password_hash 绝不能出现在任何管理接口响应体里。"""
        import json as _json
        from datetime import date
        import services.rate_limit_service as rl

        async def _run():
            await StorageService.save_user(User(
                user_id="user_pw", user_type=UserType.REGISTERED,
                username="bob", password_hash="secret_hash_xyz",
                profile=UserProfile(nickname="鲍勃")))
            await StorageService.save_conversation(Conversation(
                conversation_id="cpw", user_id="user_pw",
                session_type=SessionType.TAROT, title="有密码用户的会话",
                updated_at="2026-07-04T10:00:00"))
        asyncio.run(_run())

        usage_file = tmp_path / "usage.json"
        usage_file.write_text(
            _json.dumps({date.today().isoformat(): {"user_pw": 2}}), encoding="utf-8")
        monkeypatch.setattr(rl, "USAGE_FILE", usage_file)

        h = _admin_headers(client)
        for path in ("/api/admin/users", "/api/admin/usage", "/api/admin/conversations"):
            resp = client.get(path, headers=h)
            assert resp.status_code == 200, path
            assert "secret_hash_xyz" not in resp.text, path
            assert "password_hash" not in resp.text, path

    def test_stats_today_metrics(self, client):
        from datetime import datetime
        now = datetime.utcnow().isoformat()

        async def _run():
            await StorageService.save_user(User(
                user_id="u_today", user_type=UserType.GUEST))
            await StorageService.save_conversation(Conversation(
                conversation_id="c_today", user_id="u_today",
                session_type=SessionType.TAROT, title="今日会话",
                created_at=now, updated_at=now,
                messages=[Message(role=MessageRole.USER, content="今天好",
                                  timestamp=now)]))
        asyncio.run(_run())

        s = client.get("/api/admin/stats", headers=_admin_headers(client)).json()
        assert s["today_new_conversations"] >= 1
        assert s["today_messages"] >= 1

    def test_usage_orphan_user_id(self, client, tmp_path, monkeypatch):
        """usage.json 里存在 users 表查不到的 user_id：接口 200，username 为空。"""
        import json as _json
        from datetime import date
        import services.rate_limit_service as rl
        usage_file = tmp_path / "usage.json"
        usage_file.write_text(
            _json.dumps({date.today().isoformat(): {"ghost_user": 5}}), encoding="utf-8")
        monkeypatch.setattr(rl, "USAGE_FILE", usage_file)
        resp = client.get("/api/admin/usage", headers=_admin_headers(client))
        assert resp.status_code == 200
        entry = resp.json()["entries"][0]
        assert entry["user_id"] == "ghost_user" and entry["used"] == 5
        assert entry["username"] is None

    def test_invalid_session_type_filter(self, client):
        _seed(client)
        r = client.get("/api/admin/conversations?session_type=foo",
                       headers=_admin_headers(client)).json()
        assert r["total"] == 0
        assert r["items"] == []


class TestAdminPrompts:
    def test_list_prompts(self, client):
        r = client.get("/api/admin/prompts", headers=_admin_headers(client)).json()
        assert len(r["items"]) == 5
        assert all(not p["overridden"] for p in r["items"])

    def test_get_save_reset_roundtrip(self, client):
        h = _admin_headers(client)
        d = client.get("/api/admin/prompts/tarot_system.md", headers=h).json()
        assert "职业占卜师" in d["content"]
        assert d["content"] == d["default_content"]

        r = client.put("/api/admin/prompts/tarot_system.md",
                       json={"content": "新版提示词"}, headers=h)
        assert r.status_code == 200 and r.json()["overridden"] is True
        d2 = client.get("/api/admin/prompts/tarot_system.md", headers=h).json()
        assert d2["content"] == "新版提示词"
        assert "职业占卜师" in d2["default_content"]  # 默认版不受影响

        r2 = client.delete("/api/admin/prompts/tarot_system.md", headers=h)
        assert r2.status_code == 200 and r2.json()["overridden"] is False

    def test_unknown_name_404(self, client):
        h = _admin_headers(client)
        assert client.get("/api/admin/prompts/evil.md", headers=h).status_code == 404
        assert client.put("/api/admin/prompts/evil.md", json={"content": "x"}, headers=h).status_code == 404

    def test_empty_content_400(self, client):
        h = _admin_headers(client)
        r = client.put("/api/admin/prompts/tarot_system.md", json={"content": "  "}, headers=h)
        assert r.status_code == 400

    def test_requires_admin(self, client):
        assert client.get("/api/admin/prompts").status_code == 401
