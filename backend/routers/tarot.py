from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import List
from models import (
    SendMessageRequest, DrawCardsRequest, DrawCardsResponse,
    TarotCard, MessageRole
)
from services.conversation_service import ConversationService
from services.gemini_service import GeminiService
from services.tarot_service import TarotService
from services.user_service import UserService
from services.notebook_service import notebook_service
import json
import random

router = APIRouter(prefix="/api/tarot", tags=["tarot"])

gemini_service = GeminiService()

# 预设的开场白模板
GREETING_TEMPLATES = [
    "{nickname}！欢迎来到塔罗的神秘世界～ 今天有什么想问的吗？无论是爱情、事业还是人生困惑，塔罗都会为你指引方向。",
    "{nickname}，你好呀！✨ 塔罗牌已经准备好了，想探索什么问题呢？感情、工作、还是内心的迷茫？",
    "嗨，{nickname}！很高兴见到你～ 让塔罗牌为你揭示答案吧！你可以问我关于爱情、事业、决策等任何问题哦！"
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
async def send_message(request: SendMessageRequest):
    """发送消息并获取AI流式回复（支持Function Calling）"""
    try:
        # 获取对话
        conversation = await ConversationService.get_conversation(request.conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        
        # 获取用户信息（用于个性化回复）
        user = None
        try:
            user = await UserService.get_user(conversation.user_id)
        except:
            pass
        
        # 🎯 检测首次对话（空消息）：直接返回预设开场白
        # 改进的判断逻辑：检查是否已经有 assistant 消息
        has_assistant_message = any(msg.role == MessageRole.ASSISTANT for msg in conversation.messages)
        
        if not request.content and not has_assistant_message:
            print("[Tarot Router] 🌟 首次对话，使用预设开场白")
            print(f"[Tarot Router] 当前消息数: {len(conversation.messages)}")
            
            # 获取用户昵称
            nickname = "朋友"  # 默认称呼
            if user and user.profile and user.profile.nickname:
                nickname = user.profile.nickname
            
            # 随机选择一个开场白模板
            greeting_template = random.choice(GREETING_TEMPLATES)
            greeting_message = greeting_template.format(nickname=nickname)
            
            print(f"[Tarot Router] 开场白: {greeting_message}")
            
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
        
        # 添加用户消息
        conversation = await ConversationService.add_message(
            request.conversation_id,
            MessageRole.USER,
            request.content
        )
        
        # 流式生成AI回复（使用Agent Loop）
        async def generate():
            full_text_response = ""
            has_function_call = False
            function_call_data = None
            
            # 第一阶段：获取AI响应（可能包含function call）
            async for event in gemini_service.stream_response(
                conversation.messages, 
                user,
                session_type=conversation.session_type
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
                    
                    print(f"\n[Tarot Router] 🔧 执行函数调用: {func_name}")
                    print(f"[Tarot Router] 参数: {func_args}")
                    
                    # 保存AI的文本回复（如果有）
                    if full_text_response.strip():
                        await ConversationService.add_message(
                            request.conversation_id,
                            MessageRole.ASSISTANT,
                            full_text_response
                        )
                    
                    # 执行函数
                    if func_name == "draw_tarot_cards":
                        # 抽塔罗牌 - 保留原有的用户交互体验（显示抽牌动画窗口）
                        # 注意：移除严格的has_drawn_cards检查，允许用户多次抽牌（如追问）
                        # 系统提示词会引导AI避免不必要的重复抽牌
                        # 🎴 通知前端显示抽牌器（保留用户体验）
                        print(f"[Tarot Router] 🎴 通知前端显示抽牌器，参数: {func_args}")
                        print(f"[Tarot Router] func_args 类型: {type(func_args)}")
                        print(f"[Tarot Router] func_args.spread_type: {func_args.get('spread_type', 'NOT_FOUND')}")
                        print(f"[Tarot Router] func_args.card_count: {func_args.get('card_count', 'NOT_FOUND')}")
                        print(f"[Tarot Router] func_args.positions: {func_args.get('positions', 'NOT_FOUND')}")
                        
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
                        print(f"[Tarot Router] 序列化后的参数: {serializable_args}")
                        print(f"[Tarot Router] positions 类型（序列化前）: {type(func_args.get('positions'))}")
                        print(f"[Tarot Router] positions 值（序列化前）: {func_args.get('positions')}")
                        print(f"[Tarot Router] positions 类型（序列化后）: {type(serializable_args.get('positions'))}")
                        print(f"[Tarot Router] positions 值（序列化后）: {serializable_args.get('positions')}")
                        yield f"data: {json.dumps({'draw_cards': serializable_args})}\n\n"
                        
                        print(f"[Tarot Router] ✅ 函数执行完成: {func_name}")
                        print(f"[Tarot Router] 📋 等待用户点击'我准备好了'按钮...")
                        
                        # ⚠️ 重要修复：不要将函数结果喂回AI！
                        # 原因：AI会认为抽牌已完成，立即开始解读，但用户还没有真正抽牌
                        # 正确流程：
                        # 1. 前端显示"我准备好了"按钮
                        # 2. 用户点击按钮后弹出抽牌器
                        # 3. 用户完成抽牌后调用 /draw 接口
                        # 4. 前端发送"请根据抽牌结果进行解读"消息
                        # 5. AI才开始解读抽牌结果
                        # 
                        # 因此这里不需要继续Agent Loop，直接结束即可
                    
                    elif func_name == "get_astrology_chart":
                        # 获取星盘数据
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
                            else:
                                # 调用星盘API
                                from services.astrology_service import AstrologyService
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
                        
                        print(f"[Tarot Router] ✅ 函数执行完成: {func_name}")
                        print(f"[Tarot Router] 结果: {function_result.get('success', False)}")
                        
                        # 将函数结果喂回AI，获取最终解读
                        print(f"[Tarot Router] 🔄 将函数结果喂回AI...")
                        updated_conv = await ConversationService.get_conversation(request.conversation_id)
                        
                        final_response = ""
                        async for event2 in gemini_service.continue_with_function_result(
                            updated_conv.messages,
                            user,
                            session_type=updated_conv.session_type,
                            function_name=func_name,
                            function_result=function_result
                        ):
                            if "content" in event2:
                                final_response += event2["content"]
                                yield f"data: {json.dumps({'content': event2['content']})}\n\n"
                        
                        # 保存AI的最终解读
                        if final_response.strip():
                            # 检查是否需要附加抽牌结果
                            tarot_cards_to_attach = None
                            draw_request_to_attach = None
                            if await should_attach_tarot_cards(request.conversation_id):
                                latest_conv = await ConversationService.get_conversation(request.conversation_id)
                                tarot_cards_to_attach, draw_request_to_attach = ConversationService.get_latest_tarot_cards(latest_conv)
                            
                            await ConversationService.add_message(
                                request.conversation_id,
                                MessageRole.ASSISTANT,
                                final_response,
                                tarot_cards=tarot_cards_to_attach,
                                draw_request=draw_request_to_attach
                            )
                    
                    elif func_name == "request_user_profile":
                        # 请求用户补充个人信息
                        print(f"[Tarot Router] 📋 请求用户补充信息: {func_args}")
                        
                        # 确保 func_args 完全可序列化（转换所有 protobuf 类型）
                        serializable_args = json.loads(json.dumps(func_args, default=str))
                        # 通知前端显示弹窗
                        yield f"data: {json.dumps({'need_profile': serializable_args})}\n\n"
                        
                        # 构造函数结果（告诉AI已经请求用户填写）
                        function_result = {
                            "success": True,
                            "message": "已向用户显示资料补充表单，等待用户填写"
                        }
                        
                        print(f"[Tarot Router] ✅ 函数执行完成: {func_name}")
                        
                        # 将函数结果喂回AI
                        print(f"[Tarot Router] 🔄 将函数结果喂回AI...")
                        updated_conv = await ConversationService.get_conversation(request.conversation_id)
                        
                        final_response = ""
                        async for event2 in gemini_service.continue_with_function_result(
                            updated_conv.messages,
                            user,
                            session_type=updated_conv.session_type,
                            function_name=func_name,
                            function_result=function_result
                        ):
                            if "content" in event2:
                                final_response += event2["content"]
                                yield f"data: {json.dumps({'content': event2['content']})}\n\n"
                        
                        # 保存AI的最终回复
                        if final_response.strip():
                            # 检查是否需要附加抽牌结果
                            tarot_cards_to_attach = None
                            draw_request_to_attach = None
                            if await should_attach_tarot_cards(request.conversation_id):
                                latest_conv = await ConversationService.get_conversation(request.conversation_id)
                                tarot_cards_to_attach, draw_request_to_attach = ConversationService.get_latest_tarot_cards(latest_conv)
                            
                            await ConversationService.add_message(
                                request.conversation_id,
                                MessageRole.ASSISTANT,
                                final_response,
                                tarot_cards=tarot_cards_to_attach,
                                draw_request=draw_request_to_attach
                            )
                    
                    elif func_name == "read_divination_notebook":
                        # 读取占卜笔记本
                        print(f"[Tarot Router] 📖 读取占卜笔记本: {func_args}")
                        
                        # 获取用户的笔记本
                        notebook_entries = notebook_service.get_notebook(conversation.user_id)
                        
                        if not notebook_entries or len(notebook_entries) == 0:
                            # 笔记本为空
                            function_result = {
                                "success": True,
                                "notebook_count": 0,
                                "message": "笔记本中暂时还没有记录。当你完成占卜并退出对话后，系统会自动生成占卜记录保存在笔记本中。"
                            }
                        else:
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
                            
                            function_result = {
                                "success": True,
                                "notebook_count": len(notebook_entries),
                                "notebook_content": notebook_text
                            }
                        
                        print(f"[Tarot Router] ✅ 函数执行完成: {func_name}")
                        print(f"[Tarot Router] 笔记本记录数: {function_result.get('notebook_count', 0)}")
                        
                        # 将函数结果喂回AI
                        print(f"[Tarot Router] 🔄 将函数结果喂回AI...")
                        updated_conv = await ConversationService.get_conversation(request.conversation_id)
                        
                        final_response = ""
                        async for event2 in gemini_service.continue_with_function_result(
                            updated_conv.messages,
                            user,
                            session_type=updated_conv.session_type,
                            function_name=func_name,
                            function_result=function_result
                        ):
                            if "content" in event2:
                                final_response += event2["content"]
                                yield f"data: {json.dumps({'content': event2['content']})}\n\n"
                        
                        # 保存AI的最终回复
                        if final_response.strip():
                            # 检查是否需要附加抽牌结果
                            tarot_cards_to_attach = None
                            draw_request_to_attach = None
                            if await should_attach_tarot_cards(request.conversation_id):
                                latest_conv = await ConversationService.get_conversation(request.conversation_id)
                                tarot_cards_to_attach, draw_request_to_attach = ConversationService.get_latest_tarot_cards(latest_conv)
                            
                            await ConversationService.add_message(
                                request.conversation_id,
                                MessageRole.ASSISTANT,
                                final_response,
                                tarot_cards=tarot_cards_to_attach,
                                draw_request=draw_request_to_attach
                            )
                
                elif "done" in event:
                    # 对话完成
                    if not has_function_call:
                        # 没有函数调用，保存AI回复
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
        print(f"[Tarot Router] ❌ 错误: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/draw", response_model=DrawCardsResponse)
async def draw_cards(
    draw_request: DrawCardsRequest,
    conversation_id: str = Query(...)
):
    """抽取塔罗牌"""
    try:
        print(f"[Tarot Draw] 收到抽牌请求:")
        print(f"[Tarot Draw] conversation_id: {conversation_id}")
        print(f"[Tarot Draw] draw_request: {draw_request}")
        print(f"[Tarot Draw] draw_request.spread_type: {draw_request.spread_type}")
        print(f"[Tarot Draw] draw_request.card_count: {draw_request.card_count}")
        print(f"[Tarot Draw] draw_request.positions: {draw_request.positions}")
        # 检查对话是否存在
        conversation = await ConversationService.get_conversation(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        
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
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cards", response_model=List[str])
async def get_all_cards():
    """获取所有塔罗牌"""
    return TarotService.get_all_cards()




