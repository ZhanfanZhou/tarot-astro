import json
from typing import List, Optional

from models import User, Conversation
from services.db import get_db


class StorageService:
    """SQLite 存储服务（aiosqlite + WAL）。

    对外接口与原 JSON 文件版本完全一致——上层 service / router / 测试 mock 均无需改动。
    整个对象以 JSON 存进 ``data`` 列，读取时 ``Model(**json.loads(data))`` 还原，与旧版
    ``Model(**raw_dict)`` 行为一致（多余字段同样按 Pydantic 默认忽略）。
    """

    # ── 用户 ──────────────────────────────────────────────────────────────
    @staticmethod
    async def get_user(user_id: str) -> Optional[User]:
        """获取用户"""
        async with get_db() as db:
            async with db.execute(
                "SELECT data FROM users WHERE user_id=?", (user_id,)
            ) as cur:
                row = await cur.fetchone()
        return User(**json.loads(row["data"])) if row else None

    @staticmethod
    async def get_user_by_username(username: str) -> Optional[User]:
        """通过用户名获取用户"""
        async with get_db() as db:
            async with db.execute(
                "SELECT data FROM users WHERE username=?", (username,)
            ) as cur:
                row = await cur.fetchone()
        return User(**json.loads(row["data"])) if row else None

    @staticmethod
    async def save_user(user: User):
        """保存用户（插入或更新）"""
        payload = json.dumps(user.model_dump(), ensure_ascii=False)
        async with get_db() as db:
            await db.execute(
                "INSERT INTO users(user_id, username, data) VALUES(?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET "
                "username=excluded.username, data=excluded.data",
                (user.user_id, user.username, payload),
            )
            await db.commit()

    @staticmethod
    async def delete_user(user_id: str):
        """删除用户"""
        async with get_db() as db:
            await db.execute("DELETE FROM users WHERE user_id=?", (user_id,))
            await db.commit()

    # ── 对话 ──────────────────────────────────────────────────────────────
    @staticmethod
    async def get_conversation(conversation_id: str) -> Optional[Conversation]:
        """获取对话"""
        async with get_db() as db:
            async with db.execute(
                "SELECT data FROM conversations WHERE conversation_id=?",
                (conversation_id,),
            ) as cur:
                row = await cur.fetchone()
        return Conversation(**json.loads(row["data"])) if row else None

    @staticmethod
    async def get_user_conversations(user_id: str) -> List[Conversation]:
        """获取用户的所有对话（按更新时间倒序，ISO 时间串字典序即时间序）"""
        async with get_db() as db:
            async with db.execute(
                "SELECT data FROM conversations WHERE user_id=? "
                "ORDER BY updated_at DESC",
                (user_id,),
            ) as cur:
                rows = await cur.fetchall()
        return [Conversation(**json.loads(r["data"])) for r in rows]

    @staticmethod
    async def save_conversation(conversation: Conversation):
        """保存对话（插入或更新，只动这一行）"""
        payload = json.dumps(conversation.model_dump(), ensure_ascii=False)
        async with get_db() as db:
            await db.execute(
                "INSERT INTO conversations(conversation_id, user_id, updated_at, data) "
                "VALUES(?,?,?,?) "
                "ON CONFLICT(conversation_id) DO UPDATE SET "
                "user_id=excluded.user_id, updated_at=excluded.updated_at, "
                "data=excluded.data",
                (
                    conversation.conversation_id,
                    conversation.user_id,
                    conversation.updated_at,
                    payload,
                ),
            )
            await db.commit()

    @staticmethod
    async def delete_conversation(conversation_id: str):
        """删除对话"""
        async with get_db() as db:
            await db.execute(
                "DELETE FROM conversations WHERE conversation_id=?",
                (conversation_id,),
            )
            await db.commit()

    @staticmethod
    async def delete_user_conversations(user_id: str):
        """删除用户的所有对话"""
        async with get_db() as db:
            await db.execute(
                "DELETE FROM conversations WHERE user_id=?", (user_id,)
            )
            await db.commit()
