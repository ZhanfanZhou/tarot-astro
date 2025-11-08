from fastapi import APIRouter, HTTPException, Depends, Body
from models import User, UserProfile, UserRegister, UserLogin, UserType, ConvertGuestToRegisteredRequest
from services.user_service import UserService

router = APIRouter(prefix="/api/users", tags=["users"])


@router.post("/guest", response_model=User)
async def create_guest(profile: UserProfile = Body(default=None)):
    """创建游客用户"""
    try:
        user = await UserService.create_guest_user(profile)
        return user
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/register", response_model=User)
async def register(register_data: UserRegister):
    """用户注册"""
    try:
        user = await UserService.create_registered_user(register_data)
        # 不返回密码哈希
        user.password_hash = None
        return user
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/login", response_model=User)
async def login(login_data: UserLogin):
    """用户登录"""
    try:
        user = await UserService.authenticate_user(
            login_data.username, 
            login_data.password
        )
        # 不返回密码哈希
        user.password_hash = None
        return user
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{user_id}", response_model=User)
async def get_user(user_id: str):
    """获取用户信息"""
    try:
        user = await UserService.get_user(user_id)
        # 不返回密码哈希
        user.password_hash = None
        return user
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{user_id}/profile", response_model=User)
async def update_profile(user_id: str, profile: UserProfile):
    """更新用户资料"""
    try:
        user = await UserService.update_user_profile(user_id, profile)
        # 不返回密码哈希
        user.password_hash = None
        return user
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/convert-guest", response_model=User)
async def convert_guest_to_registered(request: ConvertGuestToRegisteredRequest):
    """将游客转换为注册用户"""
    try:
        user = await UserService.convert_guest_to_registered(
            request.user_id,
            request.username,
            request.password
        )
        # 不返回密码哈希
        user.password_hash = None
        return user
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{user_id}")
async def delete_user(user_id: str):
    """删除用户及其所有对话"""
    try:
        await UserService.delete_user_and_conversations(user_id)
        return {"message": "用户及其对话已删除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



