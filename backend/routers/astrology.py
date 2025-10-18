from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import List
from models import (
    SendMessageRequest, DrawCardsRequest, DrawCardsResponse,
    TarotCard, MessageRole, SessionType
)
from services.conversation_service import ConversationService
from services.gemini_service import GeminiService
from services.astrology_service import AstrologyService
from services.tarot_service import TarotService
from services.user_service import UserService
import json

router = APIRouter(prefix="/api/astrology", tags=["astrology"])

gemini_service = GeminiService()


@router.post("/message")
async def send_message(request: SendMessageRequest):
    """发送消息并获取AI流式回复（星座咨询，支持Function Calling）"""
    try:
        # 获取对话
        conversation = await ConversationService.get_conversation(request.conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        
        # 只有当用户发送了内容时才添加用户消息
        if request.content:
            conversation = await ConversationService.add_message(
                request.conversation_id,
                MessageRole.USER,
                request.content
            )
        
        # 获取用户信息
        user = None
        try:
            user = await UserService.get_user(conversation.user_id)
        except:
            pass
        
        # 流式生成AI回复（使用Agent Loop）
        async def generate():
            full_text_response = ""
            has_function_call = False
            function_call_data = None
            
            # 第一阶段：获取AI响应（可能包含function call）
            async for event in gemini_service.stream_response(
                conversation.messages, 
                user,
                session_type=SessionType.ASTROLOGY
            ):
                if "content" in event:
                    # 流式输出文本内容
                    full_text_response += event["content"]
                    yield f"data: {json.dumps({'content': event['content']})}\n\n"
                
                elif "function_call" in event:
                    # 检测到函数调用
                    has_function_call = True
                    function_call_data = event["function_call"]
                    func_name = function_call_data["name"]
                    func_args = function_call_data["args"]
                    
                    print(f"\n[Astrology Router] 🔧 执行函数调用: {func_name}")
                    print(f"[Astrology Router] 参数: {func_args}")
                    
                    # 保存AI的文本回复（如果有）
                    if full_text_response.strip():
                        await ConversationService.add_message(
                            request.conversation_id,
                            MessageRole.ASSISTANT,
                            full_text_response
                        )
                    
                    # 执行函数：获取星盘数据
                    if func_name == "get_astrology_chart":
                        # 检查用户资料是否完整
                        if not user or not user.profile:
                            function_result = {
                                "success": False,
                                "error": "用户信息不完整，请先补充个人资料"
                            }
                        else:
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
                                function_result = {
                                    "success": False,
                                    "error": "出生信息不完整，需要：出生年月日、出生时间（小时和分钟）、出生城市"
                                }
                                # 通知前端需要补充资料
                                yield f"data: {json.dumps({'need_profile': {'reason': '需要完整的出生信息才能分析星盘'}})}\n\n"
                            else:
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
                                    function_result = {
                                        "success": False,
                                        "error": "获取星盘数据失败，请稍后重试"
                                    }
                                else:
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
                                    
                                    function_result = {
                                        "success": True,
                                        "chart_data": chart_text
                                    }
                        
                        print(f"[Astrology Router] ✅ 函数执行完成: {func_name}")
                        print(f"[Astrology Router] 结果: {function_result.get('success', False)}")
                        
                        # 第二阶段：将函数结果喂回AI，获取最终解读
                        print(f"[Astrology Router] 🔄 将函数结果喂回AI...")
                        
                        # 重新获取对话（包含星盘数据）
                        updated_conv = await ConversationService.get_conversation(request.conversation_id)
                        
                        # 继续Agent Loop
                        final_response = ""
                        async for event2 in gemini_service.continue_with_function_result(
                            updated_conv.messages,
                            user,
                            session_type=SessionType.ASTROLOGY,
                            function_name=func_name,
                            function_result=function_result
                        ):
                            if "content" in event2:
                                final_response += event2["content"]
                                yield f"data: {json.dumps({'content': event2['content']})}\n\n"
                        
                        # 保存AI的最终解读
                        if final_response.strip():
                            await ConversationService.add_message(
                                request.conversation_id,
                                MessageRole.ASSISTANT,
                                final_response
                            )
                    
                    elif func_name == "draw_tarot_cards":
                        # 抽塔罗牌 - 保留原有的用户交互体验（显示抽牌动画窗口）
                        # 检查是否已经抽过牌
                        updated_conv = await ConversationService.get_conversation(request.conversation_id)
                        if updated_conv.has_drawn_cards:
                            # 已经抽过牌，返回错误
                            function_result = {
                                "success": False,
                                "error": "已经抽过牌，不能再次抽牌"
                            }
                            
                            print(f"[Astrology Router] ⚠️ 已经抽过牌，拒绝请求")
                            
                            # 告诉AI结果
                            final_response = ""
                            async for event2 in gemini_service.continue_with_function_result(
                                updated_conv.messages,
                                user,
                                session_type=SessionType.ASTROLOGY,
                                function_name=func_name,
                                function_result=function_result
                            ):
                                if "content" in event2:
                                    final_response += event2["content"]
                                    yield f"data: {json.dumps({'content': event2['content']})}\n\n"
                            
                            if final_response.strip():
                                await ConversationService.add_message(
                                    request.conversation_id,
                                    MessageRole.ASSISTANT,
                                    final_response
                                )
                        else:
                            # 🎴 通知前端显示抽牌器（保留用户体验）
                            print(f"[Astrology Router] 🎴 通知前端显示抽牌器，参数: {func_args}")
                            
                            # 修复：将 RepeatedComposite 类型转换为普通列表
                            # 因为 json.dumps(..., default=str) 会把它转换成字符串
                            if 'positions' in func_args:
                                positions = func_args['positions']
                                if hasattr(positions, '__iter__') and not isinstance(positions, (str, dict)):
                                    func_args['positions'] = list(positions)
                            
                            # 修复：将 card_count 转换为 int（Gemini 返回的是 float）
                            if 'card_count' in func_args and isinstance(func_args['card_count'], float):
                                func_args['card_count'] = int(func_args['card_count'])
                            
                            # 确保 func_args 完全可序列化（转换所有 protobuf 类型）
                            serializable_args = json.loads(json.dumps(func_args, default=str))
                            print(f"[Astrology Router] 序列化后参数: {serializable_args}")
                            print(f"[Astrology Router] positions 类型（序列化前）: {type(func_args.get('positions'))}")
                            print(f"[Astrology Router] positions 值（序列化前）: {func_args.get('positions')}")
                            print(f"[Astrology Router] positions 类型（序列化后）: {type(serializable_args.get('positions'))}")
                            print(f"[Astrology Router] positions 值（序列化后）: {serializable_args.get('positions')}")
                            yield f"data: {json.dumps({'draw_cards': serializable_args})}\n\n"
                            
                            # 告诉AI：已通知用户抽牌，等待用户完成
                            # 注意：实际的抽牌和解读会在用户完成抽牌后由前端触发
                            function_result = {
                                "success": True,
                                "message": "已通知用户打开抽牌器，用户正在选择塔罗牌。用户完成选牌后，我会立即为您解读。请稍候..."
                            }
                            
                            print(f"[Astrology Router] ✅ 函数执行完成: {func_name}")
                            print(f"[Astrology Router] 📋 等待用户在抽牌器中完成选牌...")
                            
                            # 告诉AI当前状态
                            final_response = ""
                            async for event2 in gemini_service.continue_with_function_result(
                                updated_conv.messages,
                                user,
                                session_type=SessionType.ASTROLOGY,
                                function_name=func_name,
                                function_result=function_result
                            ):
                                if "content" in event2:
                                    final_response += event2["content"]
                                    yield f"data: {json.dumps({'content': event2['content']})}\n\n"
                            
                            # 保存AI的提示消息
                            if final_response.strip():
                                await ConversationService.add_message(
                                    request.conversation_id,
                                    MessageRole.ASSISTANT,
                                    final_response
                                )
                    
                    elif func_name == "request_user_profile":
                        # 请求用户补充个人信息
                        print(f"[Astrology Router] 📋 请求用户补充信息: {func_args}")
                        
                        # 确保 func_args 完全可序列化（转换所有 protobuf 类型）
                        serializable_args = json.loads(json.dumps(func_args, default=str))
                        # 通知前端显示弹窗
                        yield f"data: {json.dumps({'need_profile': serializable_args})}\n\n"
                        
                        # 构造函数结果（告诉AI已经请求用户填写）
                        function_result = {
                            "success": True,
                            "message": "已向用户显示资料补充表单，等待用户填写"
                        }
                        
                        print(f"[Astrology Router] ✅ 函数执行完成: {func_name}")
                        
                        # 将函数结果喂回AI
                        print(f"[Astrology Router] 🔄 将函数结果喂回AI...")
                        updated_conv = await ConversationService.get_conversation(request.conversation_id)
                        
                        final_response = ""
                        async for event2 in gemini_service.continue_with_function_result(
                            updated_conv.messages,
                            user,
                            session_type=SessionType.ASTROLOGY,
                            function_name=func_name,
                            function_result=function_result
                        ):
                            if "content" in event2:
                                final_response += event2["content"]
                                yield f"data: {json.dumps({'content': event2['content']})}\n\n"
                        
                        # 保存AI的最终回复
                        if final_response.strip():
                            await ConversationService.add_message(
                                request.conversation_id,
                                MessageRole.ASSISTANT,
                                final_response
                            )
                
                elif "done" in event:
                    # 对话完成
                    if not has_function_call:
                        # 没有函数调用，保存AI回复
                        if full_text_response.strip():
                            await ConversationService.add_message(
                                request.conversation_id,
                                MessageRole.ASSISTANT,
                                full_text_response
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
async def fetch_chart(conversation_id: str = Query(..., description="对话ID")):
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
async def check_user_profile(user_id: str):
    """
    检查用户是否有完整的星盘资料
    
    Args:
        user_id: 用户ID
        
    Returns:
        资料完整性信息
    """
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
    conversation_id: str = Query(...)
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
        print(f"[Astrology Draw] ❌ 错误: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


