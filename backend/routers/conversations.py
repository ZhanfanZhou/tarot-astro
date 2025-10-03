from fastapi import APIRouter, HTTPException
from typing import List
from models import (
    Conversation, CreateConversationRequest, 
    UpdateConversationTitleRequest
)
from services.conversation_service import ConversationService

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



