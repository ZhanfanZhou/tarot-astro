import uuid
from datetime import datetime
from typing import List, Optional
from backend.models import (
    Conversation, Message, MessageRole, SessionType,
    TarotCard, DrawCardsRequest
)
from backend.services.storage_service import StorageService


class ConversationService:
    """对话管理服务"""
    
    @staticmethod
    async def create_conversation(user_id: str, session_type: SessionType) -> Conversation:
        """创建新对话"""
        conversation = Conversation(
            conversation_id=f"conv_{uuid.uuid4().hex[:16]}",
            user_id=user_id,
            session_type=session_type,
            title=ConversationService._get_default_title(session_type)
        )
        await StorageService.save_conversation(conversation)
        return conversation
    
    @staticmethod
    def _get_default_title(session_type: SessionType) -> str:
        """获取默认标题"""
        title_map = {
            SessionType.TAROT: "塔罗占卜",
            SessionType.ASTROLOGY: "星盘解读",
            SessionType.CHAT: "聊愈对话"
        }
        return title_map.get(session_type, "新对话")
    
    @staticmethod
    async def get_conversation(conversation_id: str) -> Optional[Conversation]:
        """获取对话"""
        return await StorageService.get_conversation(conversation_id)
    
    @staticmethod
    async def get_user_conversations(user_id: str) -> List[Conversation]:
        """获取用户的所有对话"""
        return await StorageService.get_user_conversations(user_id)
    
    @staticmethod
    async def add_message(
        conversation_id: str, 
        role: MessageRole, 
        content: str,
        tarot_cards: Optional[List[TarotCard]] = None,
        draw_request: Optional[DrawCardsRequest] = None
    ) -> Conversation:
        """添加消息到对话"""
        conversation = await StorageService.get_conversation(conversation_id)
        if not conversation:
            raise ValueError("对话不存在")
        
        message = Message(
            role=role,
            content=content,
            tarot_cards=tarot_cards,
            draw_request=draw_request
        )
        
        conversation.messages.append(message)
        conversation.updated_at = datetime.utcnow().isoformat()
        
        # 如果是用户的第一条消息，根据内容更新标题
        if role == MessageRole.USER and len([m for m in conversation.messages if m.role == MessageRole.USER]) == 1:
            conversation.title = ConversationService._generate_title_from_message(content)
        
        await StorageService.save_conversation(conversation)
        return conversation
    
    @staticmethod
    def _generate_title_from_message(content: str) -> str:
        """从消息内容生成标题"""
        # 截取前20个字符作为标题
        title = content[:20]
        if len(content) > 20:
            title += "..."
        return title
    
    @staticmethod
    async def update_conversation_title(conversation_id: str, title: str) -> Conversation:
        """更新对话标题"""
        conversation = await StorageService.get_conversation(conversation_id)
        if not conversation:
            raise ValueError("对话不存在")
        
        conversation.title = title
        conversation.updated_at = datetime.utcnow().isoformat()
        await StorageService.save_conversation(conversation)
        return conversation
    
    @staticmethod
    async def mark_cards_drawn(conversation_id: str) -> Conversation:
        """标记已抽牌"""
        conversation = await StorageService.get_conversation(conversation_id)
        if not conversation:
            raise ValueError("对话不存在")
        
        conversation.has_drawn_cards = True
        await StorageService.save_conversation(conversation)
        return conversation
    
    @staticmethod
    async def mark_completed(conversation_id: str) -> Conversation:
        """标记对话已完成"""
        conversation = await StorageService.get_conversation(conversation_id)
        if not conversation:
            raise ValueError("对话不存在")
        
        conversation.is_completed = True
        await StorageService.save_conversation(conversation)
        return conversation
    
    @staticmethod
    async def delete_conversation(conversation_id: str):
        """删除对话"""
        await StorageService.delete_conversation(conversation_id)



