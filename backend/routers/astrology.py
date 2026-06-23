from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from typing import List
from models import (
    SendMessageRequest, DrawCardsRequest, DrawCardsResponse,
    TarotCard, MessageRole, SessionType, User,
)
from services.conversation_service import ConversationService
from services.gemini_service import GeminiService
from services.astrology_service import AstrologyService
from services.tarot_service import TarotService
from services.user_service import UserService
from services.notebook_service import notebook_service
from services.rate_limit_service import RateLimitService
from dependencies import get_current_user, ensure_owner
import json
import random

router = APIRouter(prefix="/api/astrology", tags=["astrology"])

gemini_service = GeminiService()

# 预设的开场白模板
GREETING_TEMPLATES = [
    "{nickname}！今天有什么想问的？我可以帮你看星座、运势、星盘等任何问题～",
    "{nickname}，你好呀！✨ 想聊聊你的星座、运势，还是想深入了解你的本命盘？",
    "嗨，{nickname}！很高兴见到你～ 今天想探索什么呢？星座、塔罗还是星盘分析都可以哦！"
]


async def should_attach_tarot_cards(conversation_id: str) -> bool:
    """
    检查当前是否应该在AI回复中附加抽牌结果
    规则：如果用户最后一条消息是"请根据抽牌结果进行解读"，则附加
    """
    conversation = await ConversationService.get_conversation(conversation_id)
    if not conversation or not conversation.messages:
        return False
    
    # 找到最后一条用户消息
    for message in reversed(conversation.messages):
        if message.role == MessageRole.USER:
            return message.content == "请根据抽牌结果进行解读"
    
    return False


@router.post("/message")
async def send_message(
    request: SendMessageRequest,
    current_user: User = Depends(get_current_user),
):
    """发送消息并获取AI流式回复（星座咨询，支持Function Calling）"""
    try:
        # 获取对话
        conversation = await ConversationService.get_conversation(request.conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        ensure_owner(current_user, conversation.user_id)

        # 用户即当前登录身份（对话归属已校验）
        user = current_user
        
        # 🎯 检测首次对话（空消息）：直接返回预设开场白
        # 改进的判断逻辑：检查是否已经有 assistant 消息
        has_assistant_message = any(msg.role == MessageRole.ASSISTANT for msg in conversation.messages)
        
        if not request.content and not has_assistant_message:
            print("[Astrology Router] 🌟 首次对话，使用预设开场白")
            print(f"[Astrology Router] 当前消息数: {len(conversation.messages)}")
            
            # 获取用户昵称
            nickname = "朋友"  # 默认称呼
            if user and user.profile and user.profile.nickname:
                nickname = user.profile.nickname
            
            # 随机选择一个开场白模板
            greeting_template = random.choice(GREETING_TEMPLATES)
            greeting_message = greeting_template.format(nickname=nickname)
            
            print(f"[Astrology Router] 开场白: {greeting_message}")
            
            # 生成流式响应
            async def generate_greeting():
                # 模拟流式输出（逐字输出）
                for char in greeting_message:
                    yield f"data: {json.dumps({'content': char}, ensure_ascii=False)}\n\n"
                
                # 完成标记
                yield "data: [DONE]\n\n"
            
            # 保存开场白到对话
            await ConversationService.add_message(
                request.conversation_id,
                MessageRole.ASSISTANT,
                greeting_message
            )
            
            return StreamingResponse(
                generate_greeting(),
                media_type="text/event-stream"
            )
        
        # 用量控制：真正触发 LLM 解读前按身份扣减额度（开场白分支已提前返回，不计）
        await RateLimitService.check_and_consume(current_user)

        # 只有当用户发送了内容时才添加用户消息
        if request.content:
            conversation = await ConversationService.add_message(
                request.conversation_id,
                MessageRole.USER,
                request.content
            )

        # 流式生成AI回复（使用Agent Loop）
        async def generate():
            full_text_response = ""
            
            # 定义函数执行器（在Agent Loop内部执行函数）
            async def execute_function(func_name: str, func_args: dict) -> dict:
                """执行函数调用并返回结果"""
                print(f"\n[Function Executor] 执行函数: {func_name}")
                print(f"[Function Executor] 参数: {func_args}")
                
                if func_name == "get_astrology_chart":
                    # 获取星盘数据
                    # 检查用户资料是否完整
                    if not user or not user.profile:
                        print(f"[Function Executor] ❌ 用户没有个人信息，返回失败结果")
                        result = {
                            "success": False,
                            "error": "用户尚未提供任何个人信息",
                            "required_action": "你必须先调用 request_user_profile 工具，请求用户补充出生日期、出生时间和出生城市，然后才能获取星盘数据。请立即调用 request_user_profile 工具。"
                        }
                        print(f"[Function Executor] 返回结果: {result}")
                        return result
                    
                    profile = user.profile
                    if not all([
                        profile.birth_year,
                        profile.birth_month,
                        profile.birth_day,
                        profile.birth_hour is not None,
                        profile.birth_minute is not None,
                        profile.birth_city
                    ]):
                        # 检查具体缺少哪些字段
                        missing_fields = []
                        if not profile.birth_year or not profile.birth_month or not profile.birth_day:
                            missing_fields.append("birth_date")
                        if profile.birth_hour is None or profile.birth_minute is None:
                            missing_fields.append("birth_time")
                        if not profile.birth_city:
                            missing_fields.append("birth_city")
                        
                        return {
                            "success": False,
                            "error": "用户的出生信息不完整",
                            "missing_fields": missing_fields,
                            "required_action": f"你必须先调用 request_user_profile 工具，请求用户补充缺少的信息：{', '.join(missing_fields)}。请立即调用 request_user_profile 工具，并在 required_fields 参数中指定这些缺少的字段。"
                        }
                    
                    # 调用星盘API
                    print(f"[Function Executor] 用户信息完整，开始获取星盘数据")
                    chart_data = await AstrologyService.fetch_natal_chart(
                        birth_year=profile.birth_year,
                        birth_month=profile.birth_month,
                        birth_day=profile.birth_day,
                        birth_hour=profile.birth_hour,
                        birth_minute=profile.birth_minute,
                        city=profile.birth_city
                    )
                    
                    if not chart_data:
                        return {
                            "success": False,
                            "error": "获取星盘数据失败，请稍后重试"
                        }
                    
                    # 格式化星盘数据为文字
                    user_info = {
                        "birth_year": profile.birth_year,
                        "birth_month": profile.birth_month,
                        "birth_day": profile.birth_day,
                        "birth_hour": profile.birth_hour,
                        "birth_minute": profile.birth_minute,
                        "city": profile.birth_city
                    }
                    chart_text = AstrologyService.format_chart_data_to_text(chart_data, user_info)
                    
                    # 保存星盘数据到对话
                    chart_message = f"[星盘数据]\n{chart_text}"
                    await ConversationService.add_message(
                        request.conversation_id,
                        MessageRole.SYSTEM,
                        chart_message
                    )
                    
                    return {
                        "success": True,
                        "chart_data": chart_text
                    }
                
                elif func_name == "request_user_profile":
                    # 请求用户补充个人信息（这个函数只需要返回成功，实际动作由前端处理）
                    return {
                        "success": True,
                        "message": "已向用户显示资料补充表单，等待用户填写"
                    }
                
                elif func_name == "draw_tarot_cards":
                    # 抽塔罗牌（这个函数只需要返回成功，实际抽牌由前端处理）
                    return {
                        "success": True,
                        "message": "已通知前端显示抽牌器，等待用户抽牌"
                    }
                
                elif func_name == "read_divination_notebook":
                    # 读取占卜笔记本
                    notebook_entries = notebook_service.get_notebook(conversation.user_id)
                    
                    if not notebook_entries or len(notebook_entries) == 0:
                        return {
                            "success": True,
                            "notebook_count": 0,
                            "message": "笔记本中暂时还没有记录。当你完成占卜并退出对话后，系统会自动生成占卜记录保存在笔记本中。"
                        }
                    
                    # 格式化笔记本内容
                    notebook_text = f"用户的占卜笔记本（共 {len(notebook_entries)} 条记录）：\n\n"
                    for i, entry in enumerate(notebook_entries, 1):
                        from datetime import datetime
                        try:
                            start_time = datetime.fromisoformat(entry['start_time']).strftime("%Y年%m月%d日")
                        except:
                            start_time = entry.get('start_time', '未知时间')
                        
                        cards_str = "、".join(entry.get('cards_drawn', [])) if entry.get('cards_drawn') else "无"
                        
                        notebook_text += f"【记录 {i}】\n"
                        notebook_text += f"时间：{start_time}\n"
                        notebook_text += f"问题：{entry.get('question', '无')}\n"
                        notebook_text += f"抽到的牌：{cards_str}\n"
                        notebook_text += f"记录：{entry.get('summary', '无')}\n"
                        if entry.get('user_feedback'):
                            notebook_text += f"用户反馈：{entry.get('user_feedback')}\n"
                        notebook_text += "\n"
                    
                    return {
                        "success": True,
                        "notebook_count": len(notebook_entries),
                        "notebook_content": notebook_text
                    }
                
                else:
                    return {
                        "success": False,
                        "error": f"未知的函数: {func_name}"
                    }
            
            # 使用Agent Loop处理（函数执行在loop内部）
            async for event in gemini_service.stream_response(
                conversation.messages, 
                user,
                session_type=SessionType.ASTROLOGY,
                function_executor=execute_function
            ):
                if "content" in event:
                    # 流式输出文本内容
                    full_text_response += event["content"]
                    yield f"data: {json.dumps({'content': event['content']})}\n\n"
                
                elif "function_call" in event:
                    # 检测到函数调用（函数已在Agent Loop内部执行，这里只通知前端显示UI）
                    func_name = event["function_call"]["name"]
                    func_args = event["function_call"]["args"]
                    
                    print(f"\n[Astrology Router] 🔔 函数调用通知: {func_name}")
                    
                    # 根据函数类型通知前端显示相应UI
                    if func_name == "draw_tarot_cards":
                        # 🎴 通知前端显示抽牌器
                        # 修复：将 RepeatedComposite 类型转换为普通列表
                        if 'positions' in func_args:
                            positions = func_args['positions']
                            if hasattr(positions, '__iter__') and not isinstance(positions, (str, dict)):
                                func_args['positions'] = list(positions)
                        
                        # 修复：将 card_count 转换为 int
                        if 'card_count' in func_args and isinstance(func_args['card_count'], float):
                            func_args['card_count'] = int(func_args['card_count'])
                        
                        # 确保完全可序列化
                        serializable_args = json.loads(json.dumps(func_args, default=str))
                        yield f"data: {json.dumps({'draw_cards': serializable_args})}\n\n"
                        print(f"[Astrology Router] 🎴 已通知前端显示抽牌器")
                    
                    elif func_name == "request_user_profile":
                        # 📋 通知前端显示资料补充按钮
                        serializable_args = json.loads(json.dumps(func_args, default=str))
                        yield f"data: {json.dumps({'need_profile': serializable_args})}\n\n"
                        print(f"[Astrology Router] 📋 已通知前端显示资料补充按钮")
                    
                    # get_astrology_chart 和 read_divination_notebook 不需要前端UI，静默执行即可
                    
                elif "done" in event:
                    # Agent Loop 完成
                    print("[Astrology Router] ✅ Agent Loop 完成")
                    # 保存最终回复（如果有）
                    if full_text_response.strip():
                        # 检查是否需要附加抽牌结果
                        tarot_cards_to_attach = None
                        draw_request_to_attach = None
                        if await should_attach_tarot_cards(request.conversation_id):
                            latest_conv = await ConversationService.get_conversation(request.conversation_id)
                            tarot_cards_to_attach, draw_request_to_attach = ConversationService.get_latest_tarot_cards(latest_conv)
                        
                        await ConversationService.add_message(
                            request.conversation_id,
                            MessageRole.ASSISTANT,
                            full_text_response,
                            tarot_cards=tarot_cards_to_attach,
                            draw_request=draw_request_to_attach
                        )
            
            yield "data: [DONE]\n\n"
        
        return StreamingResponse(
            generate(),
            media_type="text/event-stream"
        )
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Astrology Router] ❌ 错误: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fetch-chart")
async def fetch_chart(
    conversation_id: str = Query(..., description="对话ID"),
    current_user: User = Depends(get_current_user),
):
    """
    获取用户的星盘数据并添加到对话中

    Args:
        conversation_id: 对话ID（查询参数）

    Returns:
        星盘数据文字描述
    """
    try:
        # 获取对话
        conversation = await ConversationService.get_conversation(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        ensure_owner(current_user, conversation.user_id)

        # 获取用户信息
        user = await UserService.get_user(conversation.user_id)
        if not user or not user.profile:
            raise HTTPException(status_code=400, detail="用户信息不完整")
        
        profile = user.profile
        
        # 检查是否有完整的出生信息
        if not all([
            profile.birth_year,
            profile.birth_month,
            profile.birth_day,
            profile.birth_hour is not None,
            profile.birth_minute is not None,
            profile.birth_city
        ]):
            raise HTTPException(status_code=400, detail="出生信息不完整，请补充完整的出生日期、时间和地点")
        
        # 调用星盘API
        chart_data = await AstrologyService.fetch_natal_chart(
            birth_year=profile.birth_year,
            birth_month=profile.birth_month,
            birth_day=profile.birth_day,
            birth_hour=profile.birth_hour,
            birth_minute=profile.birth_minute,
            city=profile.birth_city
        )
        
        if not chart_data:
            raise HTTPException(status_code=500, detail="获取星盘数据失败")
        
        # 格式化星盘数据为文字
        user_info = {
            "birth_year": profile.birth_year,
            "birth_month": profile.birth_month,
            "birth_day": profile.birth_day,
            "birth_hour": profile.birth_hour,
            "birth_minute": profile.birth_minute,
            "city": profile.birth_city
        }
        chart_text = AstrologyService.format_chart_data_to_text(chart_data, user_info)
        
        # 打印格式化后的星盘数据（用于调试）
        print("\n" + "="*60)
        print("【星盘数据获取成功】")
        print("="*60)
        print(f"用户ID: {conversation.user_id}")
        print(f"对话ID: {conversation_id}")
        print(f"出生信息: {profile.birth_year}-{profile.birth_month:02d}-{profile.birth_day:02d} "
              f"{profile.birth_hour:02d}:{profile.birth_minute:02d} @ {profile.birth_city}")
        print("\n格式化后的星盘文本数据：")
        print("-"*60)
        print(chart_text)
        print("-"*60)
        print("\n")
        
        # 将星盘数据作为SYSTEM消息添加到对话中
        chart_message = f"[星盘数据]\n{chart_text}"
        await ConversationService.add_message(
            conversation_id,
            MessageRole.SYSTEM,
            chart_message
        )
        
        return {
            "success": True,
            "chart_text": chart_text
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@router.post("/draw", response_model=DrawCardsResponse)
async def draw_cards(
    draw_request: DrawCardsRequest,
    conversation_id: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """抽取塔罗牌（星座AI辅助解读用）"""
    try:
        print(f"[Astrology Draw] 收到抽牌请求:")
        print(f"[Astrology Draw] conversation_id: {conversation_id}")
        print(f"[Astrology Draw] draw_request: {draw_request}")
        print(f"[Astrology Draw] draw_request.spread_type: {draw_request.spread_type}")
        print(f"[Astrology Draw] draw_request.card_count: {draw_request.card_count}")
        print(f"[Astrology Draw] draw_request.positions: {draw_request.positions}")

        # 检查对话是否存在
        conversation = await ConversationService.get_conversation(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        ensure_owner(current_user, conversation.user_id)

        # 注意：移除has_drawn_cards的严格检查，允许用户多次抽牌（追问）
        # 系统提示词会引导AI避免不必要的重复抽牌
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
        
        # 标记已抽牌（但这不会阻止后续抽牌）
        await ConversationService.mark_cards_drawn(conversation_id)
        
        return DrawCardsResponse(
            cards=cards,
            conversation_id=conversation_id
        )
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Astrology Draw] ❌ 错误: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


