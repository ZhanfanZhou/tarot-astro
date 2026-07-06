"""JWT 签发与校验。

登录/注册/游客创建时签发一个带 user_id 的短令牌，前端持有并在后续请求
通过 Authorization: Bearer 携带。服务端据此可信地识别身份（替代过去由客户端
明文声明 user_id 的做法），是用量控制与资源归属校验的基础。
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt

from config import (
    ACCESS_TOKEN_EXPIRE_MINUTES, ADMIN_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY,
)


def create_access_token(user_id: str, user_type) -> str:
    """为指定用户签发 access token。user_type 可为枚举或字符串。"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": getattr(user_type, "value", user_type),
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """解码并校验 token；无效或过期返回 None。"""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def create_admin_token() -> str:
    """后台管理 token：role=admin，与用户 token 同密钥、凭 role 区分。
    sub='admin' 不对应任何真实用户，误用于用户接口时 get_current_user 查库必失败。"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": "admin",
        "role": "admin",
        "iat": now,
        "exp": now + timedelta(minutes=ADMIN_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
