"""基于 token 身份的每日用量控制。

按「身份 + 自然日」计数：游客与注册用户额度不同（见 config）。计数文件每次写入
只保留当天数据，避免无限增长；写入走临时文件 + os.replace 原子替换，配合进程内
asyncio.Lock，避免并发下计数丢失或文件损坏。

注意：游客身份可被清缓存重置，本层不防此类绕过（按需求暂不做 IP 限流）。它的定位是
「每个身份的公平额度 + 账单兜底」，更强的防滥用应叠加 IP 限流 / 全局预算熔断。
"""
import asyncio
import json
import os
from datetime import date

from fastapi import HTTPException

from config import GUEST_DAILY_MESSAGE_LIMIT, USAGE_FILE, USER_DAILY_MESSAGE_LIMIT
from models import User, UserType

_lock = asyncio.Lock()


def _today() -> str:
    return date.today().isoformat()


def _read() -> dict:
    if not USAGE_FILE.exists():
        return {}
    try:
        with open(USAGE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _write_atomic(data: dict) -> None:
    tmp = USAGE_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, USAGE_FILE)


def _limit_for(user: User) -> int:
    return GUEST_DAILY_MESSAGE_LIMIT if user.user_type == UserType.GUEST else USER_DAILY_MESSAGE_LIMIT


class RateLimitService:
    """每日次数限制。"""

    @staticmethod
    async def check_and_consume(user: User) -> dict:
        """额度足够则计数 +1 并返回用量；超额抛 429。"""
        limit = _limit_for(user)
        today = _today()
        async with _lock:
            data = _read()
            day = data.get(today, {})
            used = day.get(user.user_id, 0)
            if used >= limit:
                if user.user_type == UserType.GUEST:
                    detail = f"今日免费次数已用完（{limit} 次/天），明天再来，或注册账号获取更多次数。"
                else:
                    detail = f"今日次数已达上限（{limit} 次/天），请明天再来。"
                raise HTTPException(status_code=429, detail=detail)
            day[user.user_id] = used + 1
            # 只落当天，顺手丢弃历史日期，保持文件极小
            _write_atomic({today: day})
        return {"used": used + 1, "limit": limit}
