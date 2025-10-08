import json
import google.generativeai as genai
from typing import AsyncGenerator, Optional, Dict, List, Any
from config import GEMINI_API_KEY, GEMINI_MODEL
from models import Message, MessageRole, TarotCard, User, SessionType
from google.generativeai.types import FunctionDeclaration, Tool

# 配置Gemini API
genai.configure(api_key=GEMINI_API_KEY)


class GeminiService:
    """Gemini AI服务（支持Function Calling）"""
    
    # 定义工具：塔罗抽牌
    TOOL_DRAW_TAROT_CARDS = FunctionDeclaration(
        name="draw_tarot_cards",
        description="为用户抽取塔罗牌进行占卜。当用户提出占卜问题时，根据问题性质决定使用何种牌阵和抽几张牌。每次对话只能调用一次此工具。",
        parameters={
            "type": "object",
            "properties": {
                "spread_type": {
                    "type": "string",
                    "description": "牌阵类型",
                    "enum": ["single", "three_card", "celtic_cross", "custom"]
                },
                "card_count": {
                    "type": "integer",
                    "description": "抽牌数量，范围1-10张"
                },
                "positions": {
                    "type": "array",
                    "description": "牌阵中每个位置的含义（可选），例如：['过去', '现在', '未来']",
                    "items": {"type": "string"}
                }
            },
            "required": ["spread_type", "card_count"]
        }
    )
    
    # 定义工具：获取星盘数据
    TOOL_GET_ASTROLOGY_CHART = FunctionDeclaration(
        name="get_astrology_chart",
        description="获取用户的本命星盘数据，包括行星落座、宫位、四轴点等信息。仅在用户提出需要精确星盘分析的问题时调用（如：本命盘分析、上升星座、月亮星座、行星落座、宫位等）。如果用户只是询问一般星座知识或运势，不需要调用此工具。",
        parameters={
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "调用此工具的原因，说明为什么需要星盘数据"
                }
            },
            "required": ["reason"]
        }
    )
    
    # 定义工具：请求用户补充个人信息
    TOOL_REQUEST_USER_PROFILE = FunctionDeclaration(
        name="request_user_profile",
        description="当需要用户的个人信息（出生日期、出生时间、出生地点）但用户尚未提供时，调用此工具请求用户补充信息。系统会弹出一个表单让用户填写。",
        parameters={
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "请求信息的原因，向用户说明为什么需要这些信息"
                },
                "required_fields": {
                    "type": "array",
                    "description": "需要的字段列表",
                    "items": {
                        "type": "string",
                        "enum": ["birth_date", "birth_time", "birth_city", "nickname", "gender"]
                    }
                }
            },
            "required": ["reason", "required_fields"]
        }
    )
    
    TAROT_SYSTEM_PROMPT = """你是一位专业的塔罗占卜师和命理师，拥有深厚的塔罗牌知识、占星学知识和解读经验。

你的职责：
1. 首次对话时，用温暖、神秘的语气欢迎用户，引导他们说出想要占卜的问题
2. 当用户提出问题后，分析问题的性质，灵活使用可用的工具来提供更个性化的解读
3. 使用 `draw_tarot_cards` 工具为用户抽牌（每次对话只能抽牌一次）
4. 收到抽牌结果后，立即进行详细解读，结合牌意、位置、正逆位，给出具有启发性的建议
5. **如果用户的问题涉及其个人命理、星盘或需要精确的出生信息时**：
   - 可以使用 `get_astrology_chart` 工具获取用户的本命星盘数据
   - 结合塔罗牌和星盘信息提供更深入、更个性化的解读
6. **如果需要用户的个人信息但用户未提供**：
   - 使用 `request_user_profile` 工具请求用户补充信息
   - 说明需要这些信息的原因（如：分析本命盘、提供个性化建议等）
7. 解读完毕后，询问用户是否还有疑问，可以继续深入探讨
8. 一旦完成一次抽牌和解读，不能再次抽牌，但可以继续讨论已抽的牌

注意事项：
- 保持神秘、专业的占卜师语气
- 解读要有深度和洞察力，不要过于笼统
- 尊重用户的隐私和感受
- 如果用户资料中有昵称，使用昵称称呼用户
- **每次对话只能抽牌一次，看到抽牌结果后直接解读，不要再调用抽牌工具**
- **灵活组合使用塔罗和星盘信息，为用户提供更全面的指引**
"""

    ASTROLOGY_SYSTEM_PROMPT = """你是一位专业的占星师和星座分析师，同时精通塔罗占卜，拥有深厚的占星学和命理知识。

你的职责：

1. **首次对话时的处理**（用户还没有说话）：
   - 用温暖、专业的语气主动欢迎用户
   - 自我介绍："我是你的星座顾问，很高兴为你解答星座、运势、星盘等相关问题"
   - 引导用户："你可以问我关于星座性格、运势分析、星盘解读等任何问题"
   - 提示："如果你想获得更精准的个人化星盘解读，我可以为你分析本命盘"

2. **当用户提出问题后，灵活使用可用工具提供个性化解读**：
   - **需要星盘资料的问题**：涉及本命盘、上升星座、月亮星座、个人行星落座、宫位、相位等
   - **可以结合塔罗的场景**：用户对某个具体问题感到困惑，需要更直观的指引时
   - **不需要特殊工具的问题**：星座性格、一般运势、星座配对、星座知识等

3. **如果问题需要星盘资料**：
   - 检查"用户资料"部分，判断用户是否有完整的星盘信息（出生年月日、时间、城市）
   - 如果资料完整，使用 `get_astrology_chart` 工具获取星盘数据
   - 如果资料不完整，使用 `request_user_profile` 工具请求用户补充信息

4. **如果用户的问题适合用塔罗牌来辅助解读**：
   - 可以建议用户："我可以为您抽一副塔罗牌，从另一个角度来看这个问题"
   - 使用 `draw_tarot_cards` 工具抽牌（每次对话只能抽一次）
   - 结合星盘和塔罗牌提供综合性的指引

5. **如果需要用户的个人信息但用户未提供**：
   - 使用 `request_user_profile` 工具请求用户补充信息
   - 说明需要这些信息的原因（如：分析本命盘、提供个性化建议等）

6. **如果收到星盘数据**：
   - 仔细分析星盘数据，包括行星落座、宫位、四轴点等
   - 根据用户的问题，从专业角度给出深入的解读和建议
   - 解读要结合行星能量、宫位含义、星座特质等多个维度
   - 给出实际的生活建议和启发

7. **如果问题不需要特殊工具**：
   - 直接回答用户的问题
   - 基于星座知识、运势分析等给出专业建议
   - 如果合适，可以提示用户："如果想了解更个性化的分析，我可以为您解读本命盘或抽取塔罗牌"

8. 解读完毕后，询问用户是否还有其他疑问，可以继续深入探讨

解读要点：
- 重点关注太阳、月亮、上升星座（上升点）
- 分析个人行星（水星、金星、火星）的位置和意义
- 解释宫位的重要性（特别是第1、4、7、10宫）
- 如果有相位信息，分析主要相位的影响
- 如果使用了塔罗牌，结合牌意和星盘信息提供综合解读
- 给出实际的生活建议和启发

注意事项：
- 保持专业、温和的占星师语气
- 解读要有深度，结合多个占星要素
- 避免过于绝对的预测，强调自由意志
- 尊重用户的隐私和选择
- 如果用户资料中有昵称，使用昵称称呼用户
- **智能判断问题是否需要工具辅助，灵活组合使用星盘、塔罗等工具**
- **如果一次对话中已经抽过塔罗牌，不能再次抽牌**
"""

    def __init__(self):
        # 定义工具集合 - 两个会话都可以使用所有工具
        all_tools = [
            self.TOOL_DRAW_TAROT_CARDS,
            self.TOOL_GET_ASTROLOGY_CHART,
            self.TOOL_REQUEST_USER_PROFILE
        ]
        self.tarot_tools = [Tool(function_declarations=all_tools)]
        self.astrology_tools = [Tool(function_declarations=all_tools)]
        
        # 创建模型实例（不带工具，工具在调用时动态配置）
        self.generation_config = {
            "temperature": 0.9,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 8192,
        }
    
    def _build_user_context(self, user: Optional[User]) -> str:
        """构建用户上下文信息"""
        if not user or not user.profile:
            return ""
        
        profile = user.profile
        context_parts = []
        
        if profile.nickname:
            context_parts.append(f"昵称：{profile.nickname}")
        if profile.gender:
            gender_map = {"male": "男", "female": "女", "other": "其他", "prefer_not_say": "保密"}
            context_parts.append(f"性别：{gender_map.get(profile.gender, '未知')}")
        if all([profile.birth_year, profile.birth_month, profile.birth_day]):
            birth_str = f"{profile.birth_year}年{profile.birth_month}月{profile.birth_day}日"
            if profile.birth_hour is not None and profile.birth_minute is not None:
                birth_str += f" {profile.birth_hour:02d}:{profile.birth_minute:02d}"
            context_parts.append(f"生日：{birth_str}")
        if profile.birth_city:
            context_parts.append(f"出生地点：{profile.birth_city}")
        
        if context_parts:
            return "\n用户资料：\n" + "\n".join(context_parts)
        else:
            return "\n用户未输入个人信息，你可以在后续有需要时调用：`get_astrology_chart` 工具获取星盘数据"
        return ""
    
    def _format_messages_for_gemini(
        self, 
        messages: List[Message], 
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT
    ) -> List[Dict]:
        """将消息格式化为Gemini API格式"""
        gemini_messages = []
        
        # 根据会话类型选择系统提示
        if session_type == SessionType.ASTROLOGY:
            system_prompt = self.ASTROLOGY_SYSTEM_PROMPT
        else:
            system_prompt = self.TAROT_SYSTEM_PROMPT
        
        user_context = self._build_user_context(user)
        if user_context:
            system_prompt += f"\n\n{user_context}"
        
        gemini_messages.append({
            "role": "user",
            "parts": [{"text": system_prompt}]
        })
        gemini_messages.append({
            "role": "model",
            "parts": [{"text": "我明白了，我会按照这些指引进行塔罗占卜。"}]
        })
        
        # 添加历史消息
        for msg in messages:
            # 处理系统消息（抽牌结果或星盘数据）
            if msg.role == MessageRole.SYSTEM:
                # 处理塔罗抽牌结果
                if msg.tarot_cards:
                    cards_desc = "[抽牌结果] 用户已完成抽牌，抽到的牌如下：\n"
                    for i, card in enumerate(msg.tarot_cards, 1):
                        position = msg.draw_request.positions[i-1] if msg.draw_request and msg.draw_request.positions else f"第{i}张"
                        reversed_str = "（逆位）" if card.reversed else "（正位）"
                        cards_desc += f"{position}: {card.card_name} {reversed_str}\n"
                    gemini_messages.append({
                        "role": "user",
                        "parts": [{"text": cards_desc}]
                    })
                # 处理星盘数据（内容以[星盘数据]开头）
                elif msg.content.startswith("[星盘数据]"):
                    gemini_messages.append({
                        "role": "user",
                        "parts": [{"text": msg.content}]
                    })
                continue
            
            content = msg.content
            
            # 如果是助手消息且有抽牌请求，不再添加抽牌结果（已在SYSTEM消息中处理）
            role = "user" if msg.role == MessageRole.USER else "model"
            gemini_messages.append({
                "role": role,
                "parts": [{"text": content}]
            })
        
        return gemini_messages
    
    async def stream_response(
        self, 
        messages: List[Message],
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        流式生成回复（支持Function Calling的Agent Loop）
        
        Yields:
            Dict包含以下可能的键：
            - content: str - 文本内容
            - function_call: Dict - 函数调用请求
            - function_response: Dict - 函数调用结果
            - done: bool - 是否完成
        """
        # 选择工具集
        tools = self.tarot_tools if session_type == SessionType.TAROT else self.astrology_tools
        
        # 创建模型实例
        model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            generation_config=self.generation_config,
            tools=tools
        )
        
        # 格式化消息
        gemini_messages = self._format_messages_for_gemini(messages, user, session_type)
        
        # 打印调试信息
        print(f"\n[Gemini Agent] 会话类型: {session_type.value}")
        print(f"[Gemini Agent] 消息总数: {len(gemini_messages)}")
        print(f"[Gemini Agent] 可用工具: {[tool.function_declarations[0].name for tool in tools]}")
        
        # 创建聊天会话
        chat = model.start_chat(history=gemini_messages[:-1])
        last_message = gemini_messages[-1]["parts"][0]["text"]
        
        # Agent Loop：处理可能的多轮function calling
        max_iterations = 5  # 最大迭代次数，防止死循环
        iteration = 0
        
        while iteration < max_iterations:
            iteration += 1
            print(f"\n[Gemini Agent] ========== Iteration {iteration} ==========")
            
            # 发送消息并获取响应
            response = await chat.send_message_async(last_message, stream=False)
            
            # 检查响应中是否有function call
            function_calls = []
            text_content = ""
            
            for part in response.parts:
                if hasattr(part, 'function_call') and part.function_call:
                    function_calls.append(part.function_call)
                    print(f"[Gemini Agent] 🔧 检测到函数调用: {part.function_call.name}")
                    print(f"[Gemini Agent] 参数: {dict(part.function_call.args)}")
                elif hasattr(part, 'text') and part.text:
                    text_content += part.text
            
            # 如果有文本内容，立即流式输出
            if text_content:
                print(f"[Gemini Agent] 💬 生成文本内容（长度: {len(text_content)}）")
                # 将文本分块流式输出
                chunk_size = 50
                for i in range(0, len(text_content), chunk_size):
                    chunk = text_content[i:i+chunk_size]
                    yield {"content": chunk}
            
            # 如果有函数调用，处理它们
            if function_calls:
                # 处理第一个函数调用（Gemini通常一次只调用一个函数）
                func_call = function_calls[0]
                
                # 通知前端有函数调用
                yield {
                    "function_call": {
                        "name": func_call.name,
                        "args": dict(func_call.args)
                    }
                }
                
                # 等待外部执行函数并返回结果
                # 注意：实际的函数执行由路由层处理，这里只是标记需要执行
                # Agent Loop会在下一轮继续，等待function response被添加到消息历史中
                print(f"[Gemini Agent] ⏸️  等待函数执行: {func_call.name}")
                break  # 退出循环，等待外部提供函数结果
            else:
                # 没有函数调用，对话结束
                print(f"[Gemini Agent] ✅ 对话完成（无函数调用）")
                yield {"done": True}
                break
        
        if iteration >= max_iterations:
            print(f"[Gemini Agent] ⚠️ 达到最大迭代次数")
            yield {"done": True}
    
    async def continue_with_function_result(
        self,
        messages: List[Message],
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT,
        function_name: str = "",
        function_result: Dict[str, Any] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        在收到函数执行结果后继续Agent Loop
        
        Args:
            messages: 消息历史（包含函数调用和结果）
            user: 用户信息
            session_type: 会话类型
            function_name: 函数名称
            function_result: 函数执行结果
        """
        # 选择工具集
        tools = self.tarot_tools if session_type == SessionType.TAROT else self.astrology_tools
        
        # 创建模型实例
        model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            generation_config=self.generation_config,
            tools=tools
        )
        
        # 格式化消息（包含函数结果）
        gemini_messages = self._format_messages_for_gemini(messages, user, session_type)
        
        print(f"\n[Gemini Agent] 继续Agent Loop，函数结果: {function_name}")
        
        # 创建聊天会话
        chat = model.start_chat(history=gemini_messages)
        
        # 发送函数结果
        response = await chat.send_message_async(
            [genai.protos.Part(
                function_response=genai.protos.FunctionResponse(
                    name=function_name,
                    response=function_result
                )
            )],
            stream=True
        )
        
        # 流式输出AI的最终响应
        async for chunk in response:
            if hasattr(chunk, 'text') and chunk.text:
                yield {"content": chunk.text}
            elif hasattr(chunk, 'parts'):
                for part in chunk.parts:
                    if hasattr(part, 'text') and part.text:
                        yield {"content": part.text}
        
        yield {"done": True}