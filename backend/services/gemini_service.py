import json
import google.generativeai as genai
from typing import AsyncGenerator, Optional, Dict, List, Any
from config import GEMINI_API_KEY, GEMINI_MODEL
from models import Message, MessageRole, TarotCard, User, SessionType
from google.generativeai.types import FunctionDeclaration, Tool
from services import context_service, prompt_service

# 配置Gemini API
genai.configure(api_key=GEMINI_API_KEY)


class GeminiService:
    """Gemini AI服务（支持Function Calling）"""
    
    # 定义工具：塔罗抽牌
    TOOL_DRAW_TAROT_CARDS = FunctionDeclaration(
        name="draw_tarot_cards",
        description=(
        "工具用于抽取塔罗牌。当你认为需要使用这个工具时，不询问用户是否需要抽牌，直接调用即可。"
        "当用户提出需要占卜的问题时，根据问题性质决定使用何种牌阵和抽几张牌。"
        "当塔罗牌作为辅助牌和星座结合时，判断结合的思路，选择适合的抽牌数量和每张牌的意义。"
        "用户追问可以再抽一次牌，以追问抽牌的方式（通常是抽1张），继续解读。"
        "⚠️ 重要：调用此工具后，系统会通知用户准备抽牌，等待用户完成抽牌后，你会收到包含具体塔罗牌的消息，再开始解读。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "spread_type": {
                    "type": "string",
                    "description": "牌阵类型，你需要根据抽牌的目的，准确判断，选择适合的牌阵",
                    # "enum": ["single", "three_card", "celtic_cross", "custom"]
                },
                "card_count": {
                    "type": "integer",
                    "description": "抽牌数量，必须和牌阵类型相匹配，`positions`参数必须和`card_count`参数相匹配。"
                },
                "positions": {
                    "type": "array",
                    "description": "牌阵中每个位置的简要含义，或位置简单描述，例如：['过去', '现在', '未来']，如果是日运，则：['运势']",
                    "items": {"type": "string"}
                }
            },
            "required": ["spread_type", "card_count"]
        }
    )
    
    # 定义工具：获取星盘数据
    TOOL_GET_ASTROLOGY_CHART = FunctionDeclaration(
        name="get_astrology_chart",
        description=(
        "获取用户的本命星盘数据（行星落座、宫位状态、四轴点等）。"
        "当需要对用户的本命盘分析时调用：例如本命盘分析/各行星落座/星座解析/上升星座/黄道十二宫状态/宫位状态/以及和用户黄道十二宫相关的问题回答。"
        "在面对泛化问题/通用问题如（星座解析/星座运势等，可以在解析基本星座知识的基础上，再结合用户星盘数据进行更深入的解析。"
        "在抽取塔罗牌后，或用户询问塔罗牌的含义时，可以结合用户星盘数据进行更个性化的解读。"
        "\n**重要提示**：如果调用此工具时返回 success=False，说明用户信息不完整，你必须立即调用 request_user_profile 工具请求用户补充信息。"
        "不要向用户解释错误或询问用户，直接调用 request_user_profile 工具即可。"
        ),
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
        description=(
        "当需要用户的个人信息（出生日期、出生时间、出生地点）但用户尚未提供时，调用此工具请求用户补充信息。"
        "调用后出现填写资料按钮，点击后会弹出一个表单让用户填写。获取个人信息后，继续调用`get_astrology_chart`获取星盘数据。"
        "用户已填写个人信息时，不调用此工具。"
        "用户主动提出需要补充个人信息时，可以调用"
        "用户拒绝提供个人信息时，只需告知用户可以随时补充，不要反复提醒"
        ),
        
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
    
    # 定义工具：读取占卜笔记本
    TOOL_READ_NOTEBOOK = FunctionDeclaration(
        name="read_divination_notebook",
        description=(
        "读取用户的占卜笔记本，获取用户之前的占卜记录。"
        "当用户想要回顾之前的占卜、查看历史记录、或者想了解过去的占卜内容时调用此工具。"
        "你也可以主动使用此工具，在解读时结合用户的历史占卜记录，提供更有连续性和深度的解读。"
        "笔记本中记录了用户之前的问题、抽到的牌、以及AI生成的占卜摘要。"
        "通过回顾历史记录，你可以发现用户关注的主题、重复出现的模式、以及问题的演变。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "读取笔记本的原因，说明为什么需要查看历史记录"
                }
            },
            "required": ["reason"]
        }
    )

    # 定义工具：提交策略单（开场幕读人的交付物；解读相位保留以支持中途改判）
    TOOL_SUBMIT_READING_BRIEF = FunctionDeclaration(
        name="submit_reading_brief",
        description=(
            "开场读人完成时调用，提交本场占卜的策略单。"
            "调用后你的开场工作即结束，占卜正式开始——不要在调用的同时说话，"
            "过渡语由解读阶段负责。"
            "若用户中途更换了完全不同的新问题，可以再次调用以覆盖策略单。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "question_topic": {
                    "type": "string",
                    "description": "议题：感情 / 事业 / 财务 / 自我成长 / 综合 / 玄学知识",
                },
                "user_goal": {
                    "type": "string",
                    "description": (
                        "用户想从这次占卜带走什么："
                        "求认同（心里已有答案，来找支持）/ "
                        "辅助决策（有选项，卡在选择）/ "
                        "看清现状（迷雾中，要一张地图）/ "
                        "探索好奇（无急事，向内看）"
                    ),
                },
                "emotional_intensity": {
                    "type": "string",
                    "description": "情绪浓度：低 / 中 / 高",
                },
                "context_summary": {
                    "type": "string",
                    "description": "2-3 句：用户的叙事背景，发生了什么",
                },
                "desired_takeaway": {
                    "type": "string",
                    "description": "一句话：用户真正想带走的东西",
                },
                "tool_route": {
                    "type": "string",
                    "description": "塔罗优先 / 星盘优先 / 结合。默认取用户入口偏好",
                },
                "suggested_spread": {
                    "type": "string",
                    "description": "塔罗路线时：牌阵名 + 各位置含义，如「三张关系阵（现状/他的态度/流向）」",
                },
                "reading_strategy": {
                    "type": "string",
                    "description": "验证式（求认同）/ 决策式（辅助决策）/ 探索式（看清现状、探索好奇）",
                },
                "pacing": {
                    "type": "string",
                    "description": "快（少铺垫，用户想直接看结果）/ 深（愿意慢慢聊）",
                },
            },
            "required": ["question_topic", "user_goal", "emotional_intensity", "reading_strategy"],
        },
    )

    def __init__(self):
        # 基础工具集（无交单工具）——每日一签/心灵奇旅没有开场幕，永远不该交单，
        # 给它们看见这把工具只会白白浪费一次 loop 迭代（拿到「未知函数」）
        all_tools = [
            self.TOOL_DRAW_TAROT_CARDS,
            self.TOOL_GET_ASTROLOGY_CHART,
            self.TOOL_REQUEST_USER_PROFILE,
            self.TOOL_READ_NOTEBOOK,
        ]
        self.daily_tools = [Tool(function_declarations=all_tools)]
        # 解读相位工具集：基础工具 + 交单工具（后者用于中途改判）
        reading_tools = all_tools + [self.TOOL_SUBMIT_READING_BRIEF]
        self.tarot_tools = [Tool(function_declarations=reading_tools)]
        self.astrology_tools = [Tool(function_declarations=reading_tools)]
        # 开场相位：只有交单工具——看不见抽牌/星盘，机械杜绝「没读人先抽牌」
        self.opening_tools = [Tool(function_declarations=[self.TOOL_SUBMIT_READING_BRIEF])]

        # 创建模型实例（不带工具，工具在调用时动态配置）
        self.generation_config = {
            "temperature": 0.9,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 8192,
        }

    def _select_tools(self, session_type: SessionType, for_opening: bool = False) -> List[Tool]:
        """选工具集：会话类型优先（daily/chat 无开场幕、不交单），再看相位。"""
        if session_type in (SessionType.DAILY, SessionType.CHAT):
            # 与改动前一致：含 read_divination_notebook;模板已禁止再抽牌
            return self.daily_tools
        if for_opening:
            return self.opening_tools
        if session_type == SessionType.ASTROLOGY:
            return self.astrology_tools
        return self.tarot_tools

    @staticmethod
    def build_force_brief_tool_config() -> Dict[str, Any]:
        """守卫第 2 层：mode=ANY 在解码层禁止纯文本，模型本轮只能提交策略单。"""
        return {
            "function_calling_config": {
                "mode": "ANY",
                "allowed_function_names": ["submit_reading_brief"],
            }
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
            return "\n# <用户资料>\n" + "\n".join(context_parts)
        else:
            return "\n# <用户资料>\n尚未完善（如需星盘分析，请使用 request_user_profile 工具请求用户补充信息）"
    
    def _format_messages_for_gemini(
        self,
        messages: List[Message],
        user: Optional[User] = None,
        session_type: SessionType = SessionType.TAROT,
        system_prompt_override: Optional[str] = None,
        phase: str = "reading",
        strategy: Optional[dict] = None,
        relationship_block: str = "",
        force_brief: bool = False,
    ) -> List[Dict]:
        """将消息格式化为Gemini API格式。

        系统提示词按相位拼装（context_service 是相位的唯一权威）：
        - opening: opening_system.md + 入口偏好 + 关系上下文 [+ 守卫指令]
        - reading: 现有塔罗/占星提示词 + 用户资料 + 策略单块（策略单可空）
        """
        gemini_messages = []

        # override(daily/journey)由调用方完整渲染,已含用户资料,不再追加 user_context
        if system_prompt_override is not None:
            system_prompt = system_prompt_override
        elif phase == context_service.PHASE_OPENING:
            system_prompt = context_service.build_opening_prompt(
                relationship_block=relationship_block,
                session_type=session_type,
                force_brief=force_brief,
            )
        else:
            # 每次请求实时读文件（默认+覆盖双层），管理页改完即生效
            if session_type == SessionType.ASTROLOGY:
                base_prompt = prompt_service.get_prompt("astrology_system.md")
            else:
                base_prompt = prompt_service.get_prompt("tarot_system.md")
            system_prompt = context_service.build_reading_prompt(
                base_prompt=base_prompt,
                user_context=self._build_user_context(user),
                strategy=strategy,
            )

        gemini_messages.append({
            "role": "user",
            "parts": [{"text": system_prompt}]
        })
        gemini_messages.append({
            "role": "model",
            "parts": [{"text": "我明白了。"}]
        })
        
        # 添加历史消息
        for msg in messages:
            # 处理系统消息（抽牌结果或星盘数据）
            if msg.role == MessageRole.SYSTEM:
                # 处理塔罗抽牌结果
                if msg.tarot_cards:
                    cards_desc = "[抽牌结果]如下：\n"
                    for i, card in enumerate(msg.tarot_cards, 1):
                        position = msg.draw_request.positions[i-1] if msg.draw_request and msg.draw_request.positions else f"第{i}张"
                        reversed_str = "（逆位）" if card.reversed else "（正位）"
                        cards_desc += f"{position}: {card.card_name} {reversed_str}\n"
                    gemini_messages.append({
                        "role": "user",
                        "parts": [{"text": cards_desc}]
                    })
                    # 在抽牌结果后添加确认语
                    gemini_messages.append({
                        "role": "model",
                        "parts": [{"text": "我看到了，让我为你解读这些牌。"}]
                    })
                # 处理星盘数据（内容以[星盘数据]开头）
                elif msg.content.startswith("[星盘数据]"):
                    gemini_messages.append({
                        "role": "user",
                        "parts": [{"text": msg.content}]
                    })
                    # 在星盘数据后添加确认语
                    gemini_messages.append({
                        "role": "model",
                        "parts": [{"text": "我看到了你的星盘数据，让我为你解读。"}]
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
        session_type: SessionType = SessionType.TAROT,
        function_executor: Optional[callable] = None,
        system_prompt_override: Optional[str] = None,
        phase: str = "reading",
        strategy: Optional[dict] = None,
        relationship_block: str = "",
        force_brief: bool = False,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        流式生成回复（支持Function Calling的Agent Loop）

        Args:
            messages: 消息历史
            user: 用户信息
            session_type: 会话类型
            function_executor: 函数执行器 async callable(func_name, func_args) -> Dict
            phase: 相位（opening=开场读人 / reading=解读），由 context_service 判定
            strategy: 本场策略单（解读相位注入系统提示词；开场相位为 None）
            relationship_block: 关系上下文块（仅开场相位）
            force_brief: 守卫——澄清预算用尽，本轮强制交单（仅开场相位）

        Yields:
            Dict包含以下可能的键：
            - content: str - 文本内容
            - function_call: Dict - 函数调用请求（仅当 function_executor 为 None 时）
            - done: bool - 是否完成
        """
        is_opening = phase == context_service.PHASE_OPENING

        def _build_model(for_opening: bool, guard: bool):
            """按相位挑工具集建模型。开场相位只给交单工具；守卫开启时叠加 mode=ANY。"""
            tool_set = self._select_tools(session_type, for_opening)

            kwargs = {}
            if for_opening and guard:
                kwargs["tool_config"] = self.build_force_brief_tool_config()
            return genai.GenerativeModel(
                model_name=GEMINI_MODEL,
                generation_config=self.generation_config,
                tools=tool_set,
                **kwargs,
            ), tool_set

        model, tools = _build_model(is_opening, force_brief)

        # 格式化消息
        gemini_messages = self._format_messages_for_gemini(
            messages,
            user,
            session_type,
            system_prompt_override,
            phase=phase,
            strategy=strategy,
            relationship_block=relationship_block,
            force_brief=force_brief,
        )

        # 打印调试信息
        print(f"\n[Gemini Agent] 会话类型: {session_type.value} | 相位: {phase}" + (" | 强制交单" if is_opening and force_brief else ""))
        print(f"[Gemini Agent] 消息总数: {len(gemini_messages)}")
        # 修复：正确显示所有可用工具
        all_tool_names = []
        for tool in tools:
            for func_decl in tool.function_declarations:
                all_tool_names.append(func_decl.name)
        print(f"[Gemini Agent] 可用工具: {all_tool_names}")

        # 创建聊天会话
        chat = model.start_chat(history=gemini_messages[:-1])
        last_message = gemini_messages[-1]["parts"][0]["text"]

        # Agent Loop：处理可能的多轮function calling
        max_iterations = 6  # 最大迭代次数，防止死循环（含移交后的解读轮）
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
                print(f"[Gemini Agent] 💬 生成文本内容")
                # 将文本分块流式输出
                chunk_size = 50
                for i in range(0, len(text_content), chunk_size):
                    chunk = text_content[i:i+chunk_size]
                    yield {"content": chunk}
            
            # 如果有函数调用，处理它们
            if function_calls:
                # 处理第一个函数调用
                func_call = function_calls[0]
                func_name = func_call.name
                func_args = dict(func_call.args)
                
                # 如果提供了函数执行器，在loop内部执行函数
                if function_executor:
                    print(f"[Gemini Agent] 🔧 执行函数: {func_name}")

                    # 通知前端有函数调用（用于显示UI，如抽牌动画、资料补充按钮等）
                    # submit_reading_brief 是纯后台工具（无 UI），不推给前端
                    if func_name != "submit_reading_brief":
                        yield {
                            "function_call": {
                                "name": func_name,
                                "args": func_args
                            }
                        }

                    # 执行函数
                    function_result = await function_executor(func_name, func_args)
                    print(f"[Gemini Agent] ✅ 函数执行完成")
                    print(f"[Gemini Agent] 函数结果详情: {json.dumps(function_result, ensure_ascii=False, indent=2)}")

                    # 同轮移交：开场读人完成 → 换提示词+工具集，解读 Agent 在同一次回复内接手
                    # （历史全是纯文本，function_call/response 从不入历史，重建 chat 无配对问题）
                    if (
                        is_opening
                        and func_name == "submit_reading_brief"
                        and function_result.get("success", True)
                    ):
                        print(f"[Gemini Agent] 🎬 开场幕收束，同轮移交给解读 Agent")
                        is_opening = False
                        phase = context_service.PHASE_READING
                        strategy = func_args

                        handoff_messages = self._format_messages_for_gemini(
                            messages,
                            user,
                            session_type,
                            system_prompt_override,
                            phase=phase,
                            strategy=strategy,
                        )
                        # 保持角色交替：history 的最后一条是用户的澄清回答（user），
                        # 而紧接着要发的移交指令又是一个 user turn —— 连续两个 user 会让
                        # Gemini 可能把移交指令当成用户说的话来回应（「好的，我这就开始」）。
                        # 补一条 model 确认语收口（同本文件既有惯例：系统提示词后的「我明白了。」、
                        # 抽牌结果后的「我看到了…」）。用户最后那句澄清仍原样留在 history 里。
                        if handoff_messages and handoff_messages[-1]["role"] == "user":
                            handoff_messages.append({
                                "role": "model",
                                "parts": [{"text": "（策略单已提交。）"}],
                            })
                        model, tools = _build_model(False, False)
                        chat = model.start_chat(history=handoff_messages)
                        last_message = (
                            "（开场读人已完成，策略单已就位。现在以占卜师的身份接续这段对话："
                            "先用一句自然的过渡语收住开场，然后按策略单直接开始工作——"
                            "该抽牌就调用抽牌工具，不要复述策略单，不要向用户解释你的判断，"
                            "不要重新问已经问过的问题。）"
                        )
                        continue

                    # 将函数结果发送回AI，准备下一轮loop
                    last_message = [genai.protos.Part(
                        function_response=genai.protos.FunctionResponse(
                            name=func_name,
                            response=function_result
                        )
                    )]
                    # 继续loop，AI可能会继续调用其他函数或生成文本
                    print(f"[Gemini Agent] 🔄 将函数结果喂回AI，继续Agent Loop...")
                else:
                    # 没有函数执行器，通知外部执行函数，然后退出
                    print(f"[Gemini Agent] ⏸️  通知外部执行函数: {func_name}")
                    yield {
                        "function_call": {
                            "name": func_name,
                            "args": func_args
                        }
                    }
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
        function_result: Dict[str, Any] = None,
        system_prompt_override: Optional[str] = None,
        strategy: Optional[dict] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        在收到函数执行结果后继续Agent Loop（支持嵌套函数调用）

        Args:
            messages: 消息历史（包含函数调用和结果）
            user: 用户信息
            session_type: 会话类型
            function_name: 函数名称
            function_result: 函数执行结果
            strategy: 本场策略单（抽牌后的解读续跑仍带策略单；恒为解读相位）
        """
        # 选择工具集：续跑恒为解读相位（daily/chat 不含交单工具）
        tools = self._select_tools(session_type)

        # 创建模型实例
        model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            generation_config=self.generation_config,
            tools=tools
        )

        # 格式化消息（包含函数结果）；续跑恒为解读相位，策略单随行
        gemini_messages = self._format_messages_for_gemini(
            messages,
            user,
            session_type,
            system_prompt_override,
            strategy=strategy,
        )
        
        print(f"\n[Gemini Agent] 继续Agent Loop，函数: {function_name}, 结果: {function_result.get('success', 'N/A')}")
        
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
            stream=False  # 改为非流式，以便检测新的函数调用
        )
        
        # 检查响应中是否有新的函数调用或文本内容
        function_calls = []
        text_content = ""
        
        for part in response.parts:
            if hasattr(part, 'function_call') and part.function_call:
                function_calls.append(part.function_call)
                print(f"[Gemini Agent] 🔧 检测到嵌套函数调用: {part.function_call.name}")
                print(f"[Gemini Agent] 参数: {dict(part.function_call.args)}")
            elif hasattr(part, 'text') and part.text:
                text_content += part.text
        
        # 如果有文本内容，流式输出
        if text_content:
            print(f"[Gemini Agent] 💬 生成文本内容")
            # 将文本分块流式输出
            chunk_size = 50
            for i in range(0, len(text_content), chunk_size):
                chunk = text_content[i:i+chunk_size]
                yield {"content": chunk}
        
        # 如果有新的函数调用，通知前端（但不执行，交给 router 层处理）
        if function_calls:
            func_call = function_calls[0]
            print(f"[Gemini Agent] 📢 通知前端有新的函数调用: {func_call.name}")
            yield {
                "function_call": {
                    "name": func_call.name,
                    "args": dict(func_call.args)
                }
            }
            # 注意：这里不继续执行，等待 router 层处理
            # router 层应该执行函数，然后再次调用 continue_with_function_result
        else:
            # 没有新的函数调用，对话完成
            print(f"[Gemini Agent] ✅ Agent Loop 完成")
            yield {"done": True}