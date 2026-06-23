from fastapi import APIRouter, HTTPException, Depends, Body
from models import (
    User, UserProfile, UserRegister, UserLogin,
    ConvertGuestToRegisteredRequest, AuthResponse,
)
from services.user_service import UserService
from services.auth_service import create_access_token
from dependencies import get_current_user, ensure_owner

router = APIRouter(prefix="/api/users", tags=["users"])


def _auth_response(user: User) -> AuthResponse:
    """统一签发 token 并隐藏密码哈希。"""
    user.password_hash = None
    token = create_access_token(user.user_id, user.user_type)
    return AuthResponse(user=user, access_token=token)


@router.post("/guest", response_model=AuthResponse)
async def create_guest(profile: UserProfile = Body(default=None)):
    """创建游客用户并签发 token"""
    try:
        user = await UserService.create_guest_user(profile)
        return _auth_response(user)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/register", response_model=AuthResponse)
async def register(register_data: UserRegister):
    """用户注册并签发 token"""
    try:
        user = await UserService.create_registered_user(register_data)
        return _auth_response(user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/login", response_model=AuthResponse)
async def login(login_data: UserLogin):
    """用户登录并签发 token"""
    try:
        user = await UserService.authenticate_user(
            login_data.username,
            login_data.password
        )
        return _auth_response(user)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{user_id}/token", response_model=AuthResponse)
async def issue_migration_token(user_id: str):
    """无密码签发 token（仅供首次部署 JWT 机制时迁移旧会话）。
    user_id 为 UUID，不可枚举，安全性足够个人应用。"""
    try:
        user = await UserService.get_user(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="用户不存在")
    return _auth_response(user)


@router.get("/{user_id}", response_model=User)
async def get_user(user_id: str, current_user: User = Depends(get_current_user)):
    """获取用户信息（仅本人）"""
    ensure_owner(current_user, user_id)
    current_user.password_hash = None
    return current_user


@router.put("/{user_id}/profile", response_model=User)
async def update_profile(
    user_id: str,
    profile: UserProfile,
    current_user: User = Depends(get_current_user),
):
    """更新用户资料（仅本人）"""
    ensure_owner(current_user, user_id)
    try:
        user = await UserService.update_user_profile(user_id, profile)
        user.password_hash = None
        return user
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/convert-guest", response_model=AuthResponse)
async def convert_guest_to_registered(
    request: ConvertGuestToRegisteredRequest,
    current_user: User = Depends(get_current_user),
):
    """将游客转换为注册用户（仅本人），并签发反映新身份的 token"""
    ensure_owner(current_user, request.user_id)
    try:
        user = await UserService.convert_guest_to_registered(
            request.user_id,
            request.username,
            request.password
        )
        return _auth_response(user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{user_id}")
async def delete_user(user_id: str, current_user: User = Depends(get_current_user)):
    """删除用户及其所有对话（仅本人）"""
    ensure_owner(current_user, user_id)
    try:
        await UserService.delete_user_and_conversations(user_id)
        return {"message": "用户及其对话已删除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
