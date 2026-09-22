import json
from datetime import datetime
from typing import List, Optional, Tuple

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
    async def archive_conversation(conversation_id: str):
        """用户删掉的对话挪进归档表：用户那边从此查不到，后台管理还看得到。
        同一个事务里先抄过去再删，不会两边都有或两边都没有。"""
        async with get_db() as db:
            await db.execute(
                "INSERT INTO archived_conversations"
                "(conversation_id, user_id, updated_at, archived_at, data) "
                "SELECT conversation_id, user_id, updated_at, ?, data "
                "FROM conversations WHERE conversation_id=?",
                (datetime.utcnow().isoformat(), conversation_id),
            )
            await db.execute(
                "DELETE FROM conversations WHERE conversation_id=?",
                (conversation_id,),
            )
            await db.commit()

    @staticmethod
    async def get_archived_conversation(
        conversation_id: str,
    ) -> Optional[Tuple[Conversation, str]]:
        """归档表里的一场对话和它的归档时间（仅后台管理用）。"""
        async with get_db() as db:
            async with db.execute(
                "SELECT data, archived_at FROM archived_conversations WHERE conversation_id=?",
                (conversation_id,),
            ) as cur:
                row = await cur.fetchone()
        return (Conversation(**json.loads(row["data"])), row["archived_at"]) if row else None

    # ── 点赞 / 点踩 ───────────────────────────────────────────────────────
    @staticmethod
    async def set_message_feedback(
        conversation_id: str, message_index: int, message_timestamp: str,
        user_id: str, rating: Optional[str],
    ):
        """记下（rating 为 up/down）或取消（None）对某条回复的评价。只动 message_feedback。"""
        async with get_db() as db:
            if rating is None:
                await db.execute(
                    "DELETE FROM message_feedback WHERE conversation_id=? AND message_index=?",
                    (conversation_id, message_index),
                )
            else:
                await db.execute(
                    "INSERT INTO message_feedback"
                    "(conversation_id, message_index, message_timestamp, user_id, rating, updated_at) "
                    "VALUES(?,?,?,?,?,?) "
                    "ON CONFLICT(conversation_id, message_index) DO UPDATE SET "
                    "message_timestamp=excluded.message_timestamp, user_id=excluded.user_id, "
                    "rating=excluded.rating, updated_at=excluded.updated_at",
                    (conversation_id, message_index, message_timestamp, user_id, rating,
                     datetime.utcnow().isoformat()),
                )
            await db.commit()

    @staticmethod
    async def get_conversation_feedback(conversation_id: str) -> dict:
        """{message_index: 'up' | 'down'}，没评价过的消息不在里面。"""
        async with get_db() as db:
            async with db.execute(
                "SELECT message_index, rating FROM message_feedback WHERE conversation_id=?",
                (conversation_id,),
            ) as cur:
                rows = await cur.fetchall()
        return {r["message_index"]: r["rating"] for r in rows}

    # ── 后台管理只读查询 ──────────────────────────────────────────────────
    @staticmethod
    async def get_admin_stats() -> dict:
        """概览指标。今日按 UTC 日界（与 created_at/updated_at 的 utcnow 一致）。"""
        from datetime import datetime
        today = datetime.utcnow().date().isoformat()
        async with get_db() as db:
            async def _one(sql: str, *params):
                async with db.execute(sql, params) as cur:
                    return (await cur.fetchone())[0]

            total_users = await _one("SELECT COUNT(*) FROM users")
            guest_users = await _one(
                "SELECT COUNT(*) FROM users WHERE json_extract(data,'$.user_type')='guest'")
            total_conversations = await _one("SELECT COUNT(*) FROM conversations")
            today_new = await _one(
                "SELECT COUNT(*) FROM conversations WHERE json_extract(data,'$.created_at')>=?",
                today)
            today_messages = 0
            async with db.execute(
                "SELECT data FROM conversations WHERE updated_at>=?", (today,)
            ) as cur:
                async for row in cur:
                    for m in json.loads(row["data"]).get("messages", []):
                        if m.get("timestamp", "") >= today:
                            today_messages += 1
        return {
            "total_users": total_users,
            "guest_users": guest_users,
            "registered_users": total_users - guest_users,
            "total_conversations": total_conversations,
            "today_new_conversations": today_new,
            "today_messages": today_messages,
        }

    @staticmethod
    async def list_conversations_admin(
        limit: int = 20, offset: int = 0,
        session_type: Optional[str] = None, user_id: Optional[str] = None,
    ) -> tuple:
        """全局会话摘要（不含消息全文），updated_at 倒序。返回 (items, total)。

        用户删掉后归档的也在里面，和正常会话按同一个顺序排，带 archived_at（正常会话为 None）。
        feedback_up / feedback_down 是这一场里被点赞 / 点踩的回复条数。"""
        where, params = [], []
        if session_type:
            where.append("json_extract(data,'$.session_type')=?")
            params.append(session_type)
        if user_id:
            where.append("user_id=?")
            params.append(user_id)
        w = ("WHERE " + " AND ".join(where)) if where else ""
        src = """(SELECT conversation_id, user_id, updated_at, data, NULL AS archived_at
                    FROM conversations
                  UNION ALL
                  SELECT conversation_id, user_id, updated_at, data, archived_at
                    FROM archived_conversations)"""
        async with get_db() as db:
            async with db.execute(
                f"SELECT COUNT(*) FROM {src} {w}", params
            ) as cur:
                total = (await cur.fetchone())[0]
            async with db.execute(
                f"""SELECT conversation_id, user_id, updated_at, archived_at,
                           json_extract(data,'$.session_type') AS session_type,
                           json_extract(data,'$.title')        AS title,
                           json_extract(data,'$.created_at')   AS created_at,
                           COALESCE(json_array_length(data,'$.messages'),0) AS message_count,
                           COALESCE(json_extract(data,'$.phase'),'reading') AS phase,
                           (SELECT COUNT(*) FROM message_feedback f
                             WHERE f.conversation_id = s.conversation_id
                               AND f.rating = 'up')   AS feedback_up,
                           (SELECT COUNT(*) FROM message_feedback f
                             WHERE f.conversation_id = s.conversation_id
                               AND f.rating = 'down') AS feedback_down
                    FROM {src} AS s {w}
                    ORDER BY updated_at DESC LIMIT ? OFFSET ?""",
                params + [limit, offset],
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows], total

    @staticmethod
    async def get_users_brief(user_ids: List[str]) -> dict:
        """{user_id: {username, nickname, user_type}}，供列表联查显示。"""
        ids = list(set(user_ids))
        if not ids:
            return {}
        qs = ",".join("?" * len(ids))
        async with get_db() as db:
            async with db.execute(
                f"""SELECT user_id, username,
                           json_extract(data,'$.user_type')        AS user_type,
                           json_extract(data,'$.profile.nickname') AS nickname
                    FROM users WHERE user_id IN ({qs})""",
                ids,
            ) as cur:
                rows = await cur.fetchall()
        return {r["user_id"]: dict(r) for r in rows}

    @staticmethod
    async def list_users_admin(
        limit: int = 50, offset: int = 0,
        q: Optional[str] = None, user_type: Optional[str] = None,
        active_from: Optional[str] = None, active_to: Optional[str] = None,
    ) -> tuple:
        """用户列表 + 会话数 + 最后活跃，活跃倒序。返回 (items, total)。

        筛选：q 模糊搜(用户名/昵称/ID)；user_type='guest'|'registered'；
        active_from/active_to 按「最后活跃」的日期(YYYY-MM-DD)闭区间过滤
        （从未活跃即 last_active 为 NULL 的用户在设了时间范围时不计入）。
        """
        where, params = [], []
        if q:
            like = f"%{q}%"
            where.append(
                "(u.username LIKE ? OR json_extract(u.data,'$.profile.nickname') "
                "LIKE ? OR u.user_id LIKE ?)")
            params += [like, like, like]
        if user_type == "guest":
            where.append("json_extract(u.data,'$.user_type')='guest'")
        elif user_type == "registered":
            where.append("json_extract(u.data,'$.user_type')<>'guest'")
        w = ("WHERE " + " AND ".join(where)) if where else ""

        having, hparams = [], []
        if active_from:
            having.append("substr(last_active,1,10) >= ?")
            hparams.append(active_from)
        if active_to:
            having.append("substr(last_active,1,10) <= ?")
            hparams.append(active_to)
        h = ("HAVING " + " AND ".join(having)) if having else ""

        base = f"""SELECT u.user_id, u.username,
                          json_extract(u.data,'$.user_type')        AS user_type,
                          json_extract(u.data,'$.profile.nickname') AS nickname,
                          json_extract(u.data,'$.created_at')       AS created_at,
                          COUNT(c.conversation_id)                  AS conversation_count,
                          MAX(c.updated_at)                         AS last_active
                   FROM users u
                   LEFT JOIN conversations c ON c.user_id = u.user_id
                   {w}
                   GROUP BY u.user_id
                   {h}"""
        async with get_db() as db:
            async with db.execute(
                f"SELECT COUNT(*) FROM ({base})", params + hparams
            ) as cur:
                total = (await cur.fetchone())[0]
            async with db.execute(
                f"""{base}
                    ORDER BY (last_active IS NULL), last_active DESC
                    LIMIT ? OFFSET ?""",
                params + hparams + [limit, offset],
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows], total
