"""
后端登录优化功能测试：
- auth_service: JWT 签发与校验
- migration token 端点: POST /api/users/{user_id}/token
- dependencies: get_current_user 鉴权依赖

所有测试通过 mock 隔离 StorageService，不读写 backend/data/*.json。
"""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import User, UserType
from services.auth_service import create_access_token, decode_access_token

FAKE_USER = User(
    user_id="00000000-0000-0000-0000-000000000001",
    user_type=UserType.REGISTERED,
    username="test_user",
    password_hash=None,
    created_at="2026-01-01T00:00:00",
)

FAKE_GUEST = User(
    user_id="00000000-0000-0000-0000-000000000002",
    user_type=UserType.GUEST,
    username=None,
    password_hash=None,
    created_at="2026-01-01T00:00:00",
)


# ---------------------------------------------------------------------------
# auth_service 单元测试
# ---------------------------------------------------------------------------

class TestCreateAccessToken:
    def test_returns_non_empty_string(self):
        token = create_access_token(FAKE_USER.user_id, UserType.REGISTERED)
        assert isinstance(token, str) and len(token) > 0

    def test_token_contains_correct_sub(self):
        token = create_access_token(FAKE_USER.user_id, UserType.REGISTERED)
        payload = decode_access_token(token)
        assert payload is not None
        assert payload["sub"] == FAKE_USER.user_id

    def test_token_contains_correct_type(self):
        token = create_access_token(FAKE_USER.user_id, UserType.REGISTERED)
        payload = decode_access_token(token)
        assert payload["type"] == "registered"

    def test_guest_type_encoded_correctly(self):
        token = create_access_token(FAKE_GUEST.user_id, UserType.GUEST)
        payload = decode_access_token(token)
        assert payload["type"] == "guest"

    def test_type_as_plain_string_accepted(self):
        token = create_access_token(FAKE_USER.user_id, "registered")
        payload = decode_access_token(token)
        assert payload["type"] == "registered"


class TestDecodeAccessToken:
    def test_valid_token_returns_payload(self):
        token = create_access_token(FAKE_USER.user_id, UserType.REGISTERED)
        payload = decode_access_token(token)
        assert payload is not None
        assert "sub" in payload and "exp" in payload

    def test_invalid_token_returns_none(self):
        assert decode_access_token("this.is.garbage") is None

    def test_tampered_token_returns_none(self):
        token = create_access_token(FAKE_USER.user_id, UserType.REGISTERED)
        tampered = token[:-5] + "XXXXX"
        assert decode_access_token(tampered) is None

    def test_round_trip_user_id(self):
        uid = "abcdef12-0000-0000-0000-000000000099"
        token = create_access_token(uid, UserType.GUEST)
        payload = decode_access_token(token)
        assert payload["sub"] == uid


# ---------------------------------------------------------------------------
# migration token 端点集成测试（mock StorageService）
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    """TestClient 挂载真实 router，但 StorageService 全程 mock，不触碰磁盘。"""
    from main import app
    return TestClient(app, raise_server_exceptions=True)


class TestMigrationTokenEndpoint:
    """POST /api/users/{user_id}/token"""

    def test_existing_registered_user_gets_token(self, client):
        with patch(
            "services.storage_service.StorageService.get_user",
            new=AsyncMock(return_value=FAKE_USER),
        ):
            resp = client.post(f"/api/users/{FAKE_USER.user_id}/token")
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
        assert body["user"]["user_id"] == FAKE_USER.user_id

    def test_existing_guest_user_gets_token(self, client):
        with patch(
            "services.storage_service.StorageService.get_user",
            new=AsyncMock(return_value=FAKE_GUEST),
        ):
            resp = client.post(f"/api/users/{FAKE_GUEST.user_id}/token")
        assert resp.status_code == 200
        payload = decode_access_token(resp.json()["access_token"])
        assert payload["type"] == "guest"

    def test_nonexistent_user_returns_404(self, client):
        with patch(
            "services.storage_service.StorageService.get_user",
            new=AsyncMock(return_value=None),
        ):
            resp = client.post("/api/users/nonexistent-id/token")
        assert resp.status_code == 404
        assert "用户不存在" in resp.json()["detail"]

    def test_returned_token_is_valid_jwt(self, client):
        with patch(
            "services.storage_service.StorageService.get_user",
            new=AsyncMock(return_value=FAKE_USER),
        ):
            resp = client.post(f"/api/users/{FAKE_USER.user_id}/token")
        token = resp.json()["access_token"]
        payload = decode_access_token(token)
        assert payload is not None
        assert payload["sub"] == FAKE_USER.user_id

    def test_password_hash_not_exposed(self, client):
        user_with_hash = FAKE_USER.model_copy(update={"password_hash": "hashed_secret"})
        with patch(
            "services.storage_service.StorageService.get_user",
            new=AsyncMock(return_value=user_with_hash),
        ):
            resp = client.post(f"/api/users/{FAKE_USER.user_id}/token")
        assert resp.status_code == 200
        # password_hash 不应出现在响应里（API 响应中隐藏）
        body_str = resp.text
        assert "hashed_secret" not in body_str


# ---------------------------------------------------------------------------
# get_current_user 依赖校验
# ---------------------------------------------------------------------------

class TestGetCurrentUserDependency:
    """通过 GET /api/users/{user_id} 间接测试 get_current_user 依赖。"""

    def test_no_token_returns_401(self, client):
        resp = client.get(f"/api/users/{FAKE_USER.user_id}")
        assert resp.status_code == 401

    def test_invalid_token_returns_401(self, client):
        resp = client.get(
            f"/api/users/{FAKE_USER.user_id}",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert resp.status_code == 401

    def test_valid_token_wrong_owner_returns_403(self, client):
        # 用 FAKE_GUEST 的 token 访问 FAKE_USER 的资源
        token = create_access_token(FAKE_GUEST.user_id, UserType.GUEST)
        with patch(
            "services.storage_service.StorageService.get_user",
            new=AsyncMock(return_value=FAKE_GUEST),
        ):
            resp = client.get(
                f"/api/users/{FAKE_USER.user_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert resp.status_code == 403

    def test_valid_token_correct_owner_returns_200(self, client):
        token = create_access_token(FAKE_USER.user_id, UserType.REGISTERED)
        with patch(
            "services.storage_service.StorageService.get_user",
            new=AsyncMock(return_value=FAKE_USER),
        ):
            resp = client.get(
                f"/api/users/{FAKE_USER.user_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert resp.status_code == 200
        assert resp.json()["user_id"] == FAKE_USER.user_id
