from fastapi import APIRouter, Depends, HTTPException, Query
from models import DrawCardsRequest, DrawCardsResponse, ResumeRequest, SendMessageRequest, User
from services import turn_service
from services.astrology_service import AstrologyService
from services.user_service import UserService
from dependencies import get_current_user, ensure_owner

router = APIRouter(prefix="/api/astrology", tags=["astrology"])


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
    """抽取塔罗牌（星盘会话里的辅助牌）：作为模型上一轮 draw_tarot_cards 调用的结果落库。"""
    return await turn_service.record_draw(conversation_id, current_user, draw_request)


@router.get("/check-profile/{user_id}")
async def check_user_profile(
    user_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    检查用户是否有完整的星盘资料（仅本人）

    Args:
        user_id: 用户ID

    Returns:
        资料完整性信息
    """
    ensure_owner(current_user, user_id)
    try:
        # 获取用户信息
        user = await UserService.get_user(user_id)
        if not user or not user.profile:
            return {
                "has_complete_profile": False,
                "missing_fields": ["所有字段"]
            }
        
        profile = user.profile
        missing_fields = []
        
        if not profile.birth_year:
            missing_fields.append("出生年份")
        if not profile.birth_month:
            missing_fields.append("出生月份")
        if not profile.birth_day:
            missing_fields.append("出生日期")
        if profile.birth_hour is None:
            missing_fields.append("出生小时")
        if profile.birth_minute is None:
            missing_fields.append("出生分钟")
        if not profile.birth_city:
            missing_fields.append("出生城市")
        
        return {
            "has_complete_profile": len(missing_fields) == 0,
            "missing_fields": missing_fields,
            "profile": {
                "birth_year": profile.birth_year,
                "birth_month": profile.birth_month,
                "birth_day": profile.birth_day,
                "birth_hour": profile.birth_hour,
                "birth_minute": profile.birth_minute,
                "birth_city": profile.birth_city
            } if len(missing_fields) == 0 else None
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/current-zodiac")
async def get_current_zodiac():
    """获取当前时间对应的星座"""
    zodiac = AstrologyService.get_current_zodiac_sign()
    return {
        "zodiac": zodiac
    }
