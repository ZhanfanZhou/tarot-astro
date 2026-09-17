from fastapi import APIRouter, Depends, Query
from typing import List
from models import DrawCardsRequest, DrawCardsResponse, ResumeRequest, SendMessageRequest, User
from services import turn_service
from services.tarot_service import TarotService
from dependencies import get_current_user

router = APIRouter(prefix="/api/tarot", tags=["tarot"])


@router.post("/message")
async def send_message(
    request: SendMessageRequest,
    current_user: User = Depends(get_current_user),
):
    """用户发言，流式回复（Function Calling Agent Loop）。开场白由 POST /api/conversations 生成。"""
    return await turn_service.stream_turn(request.conversation_id, current_user, request.content)


@router.post("/resume")
async def resume(
    request: ResumeRequest,
    current_user: User = Depends(get_current_user),
):
    """用户在界面上做完了动作（抽完牌 / 填完资料），请模型接着往下跑。不产生用户消息。"""
    return await turn_service.stream_turn(request.conversation_id, current_user, None)


@router.post("/draw", response_model=DrawCardsResponse)
async def draw_cards(
    draw_request: DrawCardsRequest,
    conversation_id: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """抽取塔罗牌：作为模型上一轮 draw_tarot_cards 调用的结果落库。"""
    return await turn_service.record_draw(conversation_id, current_user, draw_request)


@router.get("/cards", response_model=List[str])
async def get_all_cards():
    """获取所有塔罗牌"""
    return TarotService.get_all_cards()
