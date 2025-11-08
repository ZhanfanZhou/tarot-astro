import json
import aiofiles
from pathlib import Path
from typing import List, Optional
from models import User, Conversation
from config import USERS_FILE, CONVERSATIONS_FILE


class StorageService:
    """本地JSON文件存储服务"""
    
    @staticmethod
    async def _read_json(file_path: Path) -> dict:
        """读取JSON文件"""
        if not file_path.exists():
            return {}
        
        async with aiofiles.open(file_path, 'r', encoding='utf-8') as f:
            content = await f.read()
            return json.loads(content) if content else {}
    
    @staticmethod
    async def _write_json(file_path: Path, data: dict):
        """写入JSON文件"""
        async with aiofiles.open(file_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(data, ensure_ascii=False, indent=2))
    
    # 用户相关操作
    @staticmethod
    async def get_user(user_id: str) -> Optional[User]:
        """获取用户"""
        users = await StorageService._read_json(USERS_FILE)
        user_data = users.get(user_id)
        return User(**user_data) if user_data else None
    
    @staticmethod
    async def get_user_by_username(username: str) -> Optional[User]:
        """通过用户名获取用户"""
        users = await StorageService._read_json(USERS_FILE)
        for user_data in users.values():
            if user_data.get('username') == username:
                return User(**user_data)
        return None
    
    @staticmethod
    async def save_user(user: User):
        """保存用户"""
        users = await StorageService._read_json(USERS_FILE)
        users[user.user_id] = user.model_dump()
        await StorageService._write_json(USERS_FILE, users)
    
    @staticmethod
    async def delete_user(user_id: str):
        """删除用户"""
        users = await StorageService._read_json(USERS_FILE)
        if user_id in users:
            del users[user_id]
            await StorageService._write_json(USERS_FILE, users)
    
    # 对话相关操作
    @staticmethod
    async def get_conversation(conversation_id: str) -> Optional[Conversation]:
        """获取对话"""
        conversations = await StorageService._read_json(CONVERSATIONS_FILE)
        conv_data = conversations.get(conversation_id)
        return Conversation(**conv_data) if conv_data else None
    
    @staticmethod
    async def get_user_conversations(user_id: str) -> List[Conversation]:
        """获取用户的所有对话"""
        conversations = await StorageService._read_json(CONVERSATIONS_FILE)
        user_convs = []
        for conv_data in conversations.values():
            if conv_data.get('user_id') == user_id:
                user_convs.append(Conversation(**conv_data))
        # 按更新时间倒序排序
        user_convs.sort(key=lambda x: x.updated_at, reverse=True)
        return user_convs
    
    @staticmethod
    async def save_conversation(conversation: Conversation):
        """保存对话"""
        conversations = await StorageService._read_json(CONVERSATIONS_FILE)
        conversations[conversation.conversation_id] = conversation.model_dump()
        await StorageService._write_json(CONVERSATIONS_FILE, conversations)
    
    @staticmethod
    async def delete_conversation(conversation_id: str):
        """删除对话"""
        conversations = await StorageService._read_json(CONVERSATIONS_FILE)
        if conversation_id in conversations:
            del conversations[conversation_id]
            await StorageService._write_json(CONVERSATIONS_FILE, conversations)
    
    @staticmethod
    async def delete_user_conversations(user_id: str):
        """删除用户的所有对话"""
        conversations = await StorageService._read_json(CONVERSATIONS_FILE)
        # 过滤掉该用户的所有对话
        filtered_conversations = {
            conv_id: conv_data
            for conv_id, conv_data in conversations.items()
            if conv_data.get('user_id') != user_id
        }
        await StorageService._write_json(CONVERSATIONS_FILE, filtered_conversations)



