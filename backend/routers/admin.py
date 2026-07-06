"""后台管理接口。

- 功能开关：env ADMIN_PASSWORD 未配置时全部路由 404。
- 鉴权：POST /login 换 role=admin 的 JWT；require_admin 只认 admin role。
- 防爆破：进程内失败计数，连续 5 次错锁 60 秒（单 worker 部署下可靠）。
注意：本模块必须通过 `config.ADMIN_PASSWORD` 属性访问（运行时求值），
不能 `from config import ADMIN_PASSWORD` 快照——测试与热改 env 都依赖这点。
"""
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

import config
from services.auth_service import create_admin_token, decode_access_token

router = APIRouter(prefix="/api/admin", tags=["admin"])
security = HTTPBearer(auto_error=False)

_login_fails = {"count": 0, "locked_until": 0.0}
MAX_FAILS = 5
LOCK_SECONDS = 60.0


def _ensure_enabled() -> None:
    if not config.ADMIN_PASSWORD:
        raise HTTPException(status_code=404, detail="Not Found")


async def require_admin(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> None:
    """管理接口统一门卫：无 token 401，非 admin token 403。"""
    _ensure_enabled()
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="未登录")
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权访问")


class AdminLoginRequest(BaseModel):
    password: str


@router.post("/login")
async def admin_login(request: AdminLoginRequest):
    _ensure_enabled()
    now = time.monotonic()
    if now < _login_fails["locked_until"]:
        raise HTTPException(status_code=429, detail="尝试过于频繁，请 1 分钟后再试")
    if not secrets.compare_digest(request.password, config.ADMIN_PASSWORD):
        _login_fails["count"] += 1
        if _login_fails["count"] >= MAX_FAILS:
            _login_fails["count"] = 0
            _login_fails["locked_until"] = now + LOCK_SECONDS
        raise HTTPException(status_code=401, detail="密码错误")
    _login_fails["count"] = 0
    _login_fails["locked_until"] = 0.0
    return {"access_token": create_admin_token(), "token_type": "bearer"}


@router.get("/ping")
async def admin_ping(_: None = Depends(require_admin)):
    """探活/鉴权自检（前端进入管理页时校验 token 是否仍有效）。"""
    return {"ok": True}
