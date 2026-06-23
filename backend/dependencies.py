"""FastAPI 鉴权依赖：从 Bearer token 解析出可信身份，并提供资源归属校验。

- get_current_user: 受保护接口的统一入口；token 缺失/失效一律 401（前端据此登出重登）。
- ensure_owner: 校验「当前用户 == 资源所属用户」，不匹配 403，修复越权访问（IDOR）。
"""
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from models import User
from services.auth_service import decode_access_token
from services.storage_service import StorageService

# auto_error=False：缺失 token 时不抛 403，由我们统一抛 401，便于前端区分「重登」与「越权」
security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    """校验 token 并返回对应用户；失败抛 401。"""
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="未登录或登录已失效，请重新登录")

    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")

    user = await StorageService.get_user(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    return user


def ensure_owner(current_user: User, target_user_id: str) -> None:
    """确认当前用户即资源所属用户，否则 403。"""
    if current_user.user_id != target_user_id:
        raise HTTPException(status_code=403, detail="无权访问该资源")
