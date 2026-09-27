"""基于 token 身份的每日用量控制。

按「身份 + 自然日」计数：游客与注册用户额度不同（见 config）。计数文件每次写入
只保留当天数据，避免无限增长；写入走临时文件 + os.replace 原子替换，配合进程内
asyncio.Lock，避免并发下计数丢失或文件损坏。

每次生成成功才计一次（consume，在生成跑完之后调）：模型 / 网络出错、进程重启丢了的，
用户没拿到回复，不算他的。只有用户开口对话时才拦（check，在开始之前调）：发消息、
新开占卜的开场白。其余调用（抽牌/补资料之后的解读、日签解读、心灵奇旅）次数本就
有限，不拦。

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
    def check(user: User) -> None:
        """今日额度用完了就抛 429，不计数。用户开口说话、开始生成之前看这一道。"""
        limit = _limit_for(user)
        if _read().get(_today(), {}).get(user.user_id, 0) < limit:
            return
        if user.user_type == UserType.GUEST:
            detail = f"今日免费次数已用完（{limit} 次/天），明天再来，或注册账号获取更多次数。"
        else:
            detail = f"今日次数已达上限（{limit} 次/天），请明天再来。"
        raise HTTPException(status_code=429, detail=detail)

    @staticmethod
    async def consume(user: User) -> dict:
        """计一次：生成成功跑完之后调。不拦——开始之前该拦的已经由 check 拦过了。"""
        limit = _limit_for(user)
        today = _today()
        async with _lock:
            data = _read()
            day = data.get(today, {})
            used = day.get(user.user_id, 0) + 1
            day[user.user_id] = used
            # 只落当天，顺手丢弃历史日期，保持文件极小
            _write_atomic({today: day})
        return {"used": used, "limit": limit}

    @staticmethod
    def get_usage(user: User) -> dict:
        """今日已用 / 上限，只读。"""
        return {"used": _read().get(_today(), {}).get(user.user_id, 0), "limit": _limit_for(user)}


def get_today_usage() -> tuple:
    """(今日日期, {user_id: 已用次数})——供后台展示，只读。"""
    today = _today()
    return today, _read().get(today, {})


async def reset_user_usage(user_id: str) -> None:
    """后台手动清零某用户今日已用次数（当天恢复满额度）。

    仅动今天这一格；文件本就只留当天，历史无需处理。锁内读改写，
    与 consume 串行，避免与并发计数丢更新。
    """
    today = _today()
    async with _lock:
        data = _read()
        day = data.get(today, {})
        if day.pop(user_id, None) is not None:
            _write_atomic({today: day})
