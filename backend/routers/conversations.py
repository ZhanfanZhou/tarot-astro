from fastapi import APIRouter, HTTPException
from typing import List
from models import (
    Conversation, CreateConversationRequest, 
    UpdateConversationTitleRequest
)
from services.conversation_service import ConversationService
from services.notebook_service import notebook_service
from services.storage_service import StorageService

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.post("", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest, user_id: str):
    """创建新对话"""
    try:
        conversation = await ConversationService.create_conversation(
            user_id=user_id,
            session_type=request.session_type
        )
        return conversation
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """获取对话详情"""
    conversation = await ConversationService.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")
    return conversation


@router.get("/user/{user_id}", response_model=List[Conversation])
async def get_user_conversations(user_id: str):
    """获取用户的所有对话"""
    try:
        conversations = await ConversationService.get_user_conversations(user_id)
        return conversations
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/title", response_model=Conversation)
async def update_title(request: UpdateConversationTitleRequest):
    """更新对话标题"""
    try:
        conversation = await ConversationService.update_conversation_title(
            request.conversation_id,
            request.title
        )
        return conversation
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """删除对话"""
    try:
        await ConversationService.delete_conversation(conversation_id)
        return {"message": "对话已删除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{conversation_id}/exit")
async def exit_conversation(conversation_id: str):
    """
    对话退出时的处理
    检查是否需要生成占卜笔记
    
    触发条件：
    1. 对话内容有新增（消息数 > 1）
    2. 对话中抽过塔罗牌
    """
    try:
        # 获取对话
        conversation = await ConversationService.get_conversation(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        
        # 检查是否满足生成笔记的条件
        # 条件1: 消息数 > 1（至少有用户消息和助手回复）
        has_content = len(conversation.messages) > 1
        
        # 条件2: 抽过塔罗牌
        has_drawn_cards = conversation.has_drawn_cards or any(
            msg.tarot_cards for msg in conversation.messages
        )
        
        print(f"[ConversationExit] 对话 {conversation_id} 退出检查:")
        print(f"  - 有内容: {has_content} (消息数: {len(conversation.messages)})")
        print(f"  - 抽过牌: {has_drawn_cards}")
        
        if has_content and has_drawn_cards:
            # 获取用户信息
            user = await StorageService.get_user(conversation.user_id)
            
            # 生成并更新笔记
            await notebook_service.update_entry(
                user_id=conversation.user_id,
                conversation=conversation,
                user=user
            )
            
            print(f"[ConversationExit] 已为对话 {conversation_id} 生成笔记")
            return {"message": "笔记已保存", "notebook_updated": True}
        else:
            print(f"[ConversationExit] 对话 {conversation_id} 不满足生成笔记的条件")
            return {"message": "不需要生成笔记", "notebook_updated": False}
    
    except Exception as e:
        print(f"[ConversationExit] 处理对话退出失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))



