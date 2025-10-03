from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import List
from backend.models import (
    SendMessageRequest, DrawCardsRequest, DrawCardsResponse,
    TarotCard, MessageRole
)
from backend.services.conversation_service import ConversationService
from backend.services.gemini_service import GeminiService
from backend.services.tarot_service import TarotService
from backend.services.user_service import UserService
import json

router = APIRouter(prefix="/api/tarot", tags=["tarot"])

gemini_service = GeminiService()


@router.post("/message")
async def send_message(request: SendMessageRequest):
    """发送消息并获取AI流式回复"""
    try:
        # 获取对话
        conversation = await ConversationService.get_conversation(request.conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        
        # 添加用户消息
        conversation = await ConversationService.add_message(
            request.conversation_id,
            MessageRole.USER,
            request.content
        )
        
        # 获取用户信息（用于个性化回复）
        user = None
        try:
            user = await UserService.get_user(conversation.user_id)
        except:
            pass
        
        # 流式生成AI回复
        async def generate():
            full_response = ""
            async for chunk in gemini_service.stream_response(conversation.messages, user):
                full_response += chunk
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            
            # 检查是否包含抽牌指令
            draw_instruction = GeminiService.extract_draw_cards_instruction(full_response)
            
            if draw_instruction:
                # 移除抽牌标签后保存AI消息
                clean_response = GeminiService.remove_draw_cards_tags(full_response)
                
                # 创建DrawCardsRequest对象
                draw_request = DrawCardsRequest(**draw_instruction)
                
                await ConversationService.add_message(
                    request.conversation_id,
                    MessageRole.ASSISTANT,
                    clean_response,
                    draw_request=draw_request
                )
                
                # 发送抽牌指令
                yield f"data: {json.dumps({'draw_cards': draw_instruction})}\n\n"
            else:
                # 保存完整的AI回复
                await ConversationService.add_message(
                    request.conversation_id,
                    MessageRole.ASSISTANT,
                    full_response
                )
            
            yield "data: [DONE]\n\n"
        
        return StreamingResponse(
            generate(),
            media_type="text/event-stream"
        )
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/draw", response_model=DrawCardsResponse)
async def draw_cards(
    conversation_id: str,
    draw_request: DrawCardsRequest
):
    """抽取塔罗牌"""
    try:
        # 检查对话是否存在
        conversation = await ConversationService.get_conversation(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        
        # 检查是否已经抽过牌
        if conversation.has_drawn_cards:
            raise HTTPException(status_code=400, detail="已经抽过牌，不能再次抽牌")
        
        # 抽牌
        cards = TarotService.draw_cards(draw_request)
        
        # 保存抽牌结果
        await ConversationService.add_message(
            conversation_id,
            MessageRole.SYSTEM,
            "用户已完成抽牌",
            tarot_cards=cards,
            draw_request=draw_request
        )
        
        # 标记已抽牌
        await ConversationService.mark_cards_drawn(conversation_id)
        
        return DrawCardsResponse(
            cards=cards,
            conversation_id=conversation_id
        )
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cards", response_model=List[str])
async def get_all_cards():
    """获取所有塔罗牌"""
    return TarotService.get_all_cards()




