import uuid
from datetime import datetime
from typing import List, Optional
from models import (
    Conversation, Message, MessageRole, SessionType,
    TarotCard, DrawCardsRequest
)
from services import context_service
from services.storage_service import StorageService


class ConversationService:
    """对话管理服务"""

    @staticmethod
    async def create_conversation(user_id: str, session_type: SessionType) -> Conversation:
        """创建新对话。

        相位初值只问 context_service（相位的唯一权威）——不在这里另存一份会话类型集合：
        两份分叉时故障是静默的（会话以 opening 落库、get_phase 却说 reading → 永不交单）。
        """
        conversation = Conversation(
            conversation_id=f"conv_{uuid.uuid4().hex[:16]}",
            user_id=user_id,
            session_type=session_type,
            title=ConversationService._get_default_title(session_type),
            phase=(
                context_service.PHASE_OPENING
                if session_type in context_service.OPENING_PHASE_SESSIONS
                else context_service.PHASE_READING
            ),
        )
        await StorageService.save_conversation(conversation)
        return conversation
    
    @staticmethod
    def _get_default_title(session_type: SessionType) -> str:
        """获取默认标题"""
        title_map = {
            SessionType.TAROT: "塔罗占卜",
            SessionType.ASTROLOGY: "星盘解读",
            SessionType.CHAT: "聊愈对话",
            SessionType.DAILY: "每日一签",
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
    async def append_message(conversation_id: str, message: Message) -> Conversation:
        """把一条记录追加到对话末尾（用户发言 / 模型的一轮 / 工具结果都走这里）。"""
        conversation = await StorageService.get_conversation(conversation_id)
        if not conversation:
            raise ValueError("对话不存在")

        conversation.messages.append(message)
        conversation.updated_at = datetime.utcnow().isoformat()

        # 如果是用户的第一条消息，根据内容更新标题（daily 对话标题固定为日期，不覆盖）
        if (
            message.role == MessageRole.USER
            and conversation.session_type != SessionType.DAILY
            and len([m for m in conversation.messages if m.role == MessageRole.USER]) == 1
        ):
            conversation.title = ConversationService._generate_title_from_message(message.content)

        await StorageService.save_conversation(conversation)
        return conversation

    @staticmethod
    async def add_message(
        conversation_id: str,
        role: MessageRole,
        content: str,
        tarot_cards: Optional[List[TarotCard]] = None,
        draw_request: Optional[DrawCardsRequest] = None,
    ) -> Conversation:
        """追加一条纯文本记录（开场白、每日解读）。工具轮用 append_message 传完整 Message。"""
        return await ConversationService.append_message(conversation_id, Message(
            role=role, content=content, tarot_cards=tarot_cards, draw_request=draw_request,
        ))
    
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
    def deletable(conversation: Conversation) -> bool:
        """每日一签的对话不能删；接着聊过（用户发过言）就是普通对话了，可以删。
        删掉的只是对话，那天的日运记录（牌面、印证）照样留着。"""
        return conversation.session_type != SessionType.DAILY or any(
            m.role == MessageRole.USER for m in conversation.messages
        )

    @staticmethod
    async def delete_conversation(conversation_id: str):
        """删除对话"""
        await StorageService.delete_conversation(conversation_id)
    



