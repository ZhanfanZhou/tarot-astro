"""后台管理接口。

- 功能开关：env ADMIN_PASSWORD 未配置时全部路由 404。
- 鉴权：POST /login 换 role=admin 的 JWT；require_admin 只认 admin role。
- 防爆破：进程内失败计数，连续 5 次错锁 60 秒（单 worker 部署下可靠）。
注意：本模块必须通过 `config.ADMIN_PASSWORD` 属性访问（运行时求值），
不能 `from config import ADMIN_PASSWORD` 快照——测试与热改 env 都依赖这点。
"""
import secrets
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

import config
from services import prompt_service
from services.auth_service import create_admin_token, decode_access_token
from services.rate_limit_service import get_today_usage, reset_user_usage
from services.storage_service import StorageService

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


@router.get("/stats")
async def admin_stats(_: None = Depends(require_admin)):
    return await StorageService.get_admin_stats()


@router.get("/conversations")
async def admin_conversations(
    limit: int = 20,
    offset: int = 0,
    session_type: Optional[str] = None,
    user_id: Optional[str] = None,
    _: None = Depends(require_admin),
):
    limit = max(1, min(limit, 100))
    items, total = await StorageService.list_conversations_admin(
        limit, offset, session_type, user_id)
    users = await StorageService.get_users_brief([it["user_id"] for it in items])
    for it in items:
        u = users.get(it["user_id"], {})
        it["username"] = u.get("username")
        it["nickname"] = u.get("nickname")
        it["user_type"] = u.get("user_type")
    return {"items": items, "total": total}


@router.get("/conversations/{conversation_id}")
async def admin_conversation_detail(
    conversation_id: str, _: None = Depends(require_admin)
):
    conversation = await StorageService.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")
    return conversation


@router.get("/users")
async def admin_users(
    limit: int = 50,
    offset: int = 0,
    q: Optional[str] = None,
    user_type: Optional[str] = None,
    active_from: Optional[str] = None,
    active_to: Optional[str] = None,
    _: None = Depends(require_admin),
):
    limit = max(1, min(limit, 200))
    ut = user_type if user_type in ("guest", "registered") else None
    items, total = await StorageService.list_users_admin(
        limit, offset,
        q=(q or None), user_type=ut,
        active_from=(active_from or None), active_to=(active_to or None),
    )
    return {"items": items, "total": total}


@router.get("/usage")
async def admin_usage(_: None = Depends(require_admin)):
    today, day = get_today_usage()
    users = await StorageService.get_users_brief(list(day.keys()))
    entries = []
    for uid, used in sorted(day.items(), key=lambda kv: -kv[1]):
        u = users.get(uid, {})
        entries.append({
            "user_id": uid, "used": used,
            "username": u.get("username"), "nickname": u.get("nickname"),
            "user_type": u.get("user_type"),
        })
    return {
        "date": today,
        "entries": entries,
        "guest_daily_limit": config.GUEST_DAILY_MESSAGE_LIMIT,
        "user_daily_limit": config.USER_DAILY_MESSAGE_LIMIT,
    }


@router.delete("/usage/{user_id}")
async def admin_usage_reset(user_id: str, _: None = Depends(require_admin)):
    """清零某用户今日已用次数（当天恢复满额度）。幂等。"""
    await reset_user_usage(user_id)
    return {"ok": True}


class PromptSaveRequest(BaseModel):
    content: str


@router.get("/prompts")
async def admin_prompts(_: None = Depends(require_admin)):
    try:
        return {"items": prompt_service.list_prompts()}
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/prompts/{name}")
async def admin_prompt_detail(name: str, _: None = Depends(require_admin)):
    try:
        info = prompt_service.get_prompt_info(name)
        return {
            **info,
            "content": prompt_service.get_prompt(name),
            "default_content": prompt_service.get_default(name),
        }
    except KeyError:
        raise HTTPException(status_code=404, detail="提示词不存在")
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/prompts/{name}")
async def admin_prompt_save(
    name: str, request: PromptSaveRequest, _: None = Depends(require_admin)
):
    try:
        return prompt_service.save_override(name, request.content)
    except KeyError:
        raise HTTPException(status_code=404, detail="提示词不存在")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/prompts/{name}")
async def admin_prompt_reset(name: str, _: None = Depends(require_admin)):
    try:
        return prompt_service.reset_override(name)
    except KeyError:
        raise HTTPException(status_code=404, detail="提示词不存在")
