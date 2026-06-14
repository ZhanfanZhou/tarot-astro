from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import List
from models import (
    SendMessageRequest, DrawCardsRequest, DrawCardsResponse,
    TarotCard, MessageRole, SessionType
)
from services.conversation_service import ConversationService
from services.daily_service import DailyService
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
            
            # 定义函数执行器（在Agent Loop内部执行函数）
            async def execute_function(func_name: str, func_args: dict) -> dict:
                """执行函数调用并返回结果"""
                print(f"\n[Function Executor] 执行函数: {func_name}")
                print(f"[Function Executor] 参数: {func_args}")
                
                if func_name == "draw_tarot_cards":
                    # 抽塔罗牌（这个函数只需要返回成功，实际抽牌由前端处理）
                    return {
                        "success": True,
                        "message": "已通知前端显示抽牌器，等待用户抽牌"
                    }
                
                elif func_name == "get_astrology_chart":
                    # 获取星盘数据
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
            
            # daily 对话:每次请求实时渲染日运系统提示词(模板热加载 + history 始终最新)
            system_prompt_override = None
            if conversation.session_type == SessionType.DAILY:
                system_prompt_override = await DailyService.render_daily_system_prompt(conversation, user)

            # 使用Agent Loop处理（函数执行在loop内部）
            async for event in gemini_service.stream_response(
                conversation.messages,
                user,
                session_type=conversation.session_type,
                function_executor=execute_function,
                system_prompt_override=system_prompt_override
            ):
                if "content" in event:
                    # 流式输出文本内容
                    full_text_response += event["content"]
                    yield f"data: {json.dumps({'content': event['content']})}\n\n"
                
                elif "function_call" in event:
                    # 检测到函数调用（函数已在Agent Loop内部执行，这里只通知前端显示UI）
                    func_name = event["function_call"]["name"]
                    func_args = event["function_call"]["args"]
                    
                    print(f"\n[Tarot Router] 🔔 函数调用通知: {func_name}")
                    
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
                        print(f"[Tarot Router] 🎴 已通知前端显示抽牌器")
                    
                    elif func_name == "request_user_profile":
                        # 📋 通知前端显示资料补充按钮
                        serializable_args = json.loads(json.dumps(func_args, default=str))
                        yield f"data: {json.dumps({'need_profile': serializable_args})}\n\n"
                        print(f"[Tarot Router] 📋 已通知前端显示资料补充按钮")
                    
                    # get_astrology_chart 和 read_divination_notebook 不需要前端UI，静默执行即可
                    
                elif "done" in event:
                    # Agent Loop 完成
                    print("[Tarot Router] ✅ Agent Loop 完成")
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




