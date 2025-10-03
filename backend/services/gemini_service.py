import json
import google.generativeai as genai
from typing import AsyncGenerator, Optional, Dict, List
from backend.config import GEMINI_API_KEY, GEMINI_MODEL
from backend.models import Message, MessageRole, TarotCard, User

# 配置Gemini API
genai.configure(api_key=GEMINI_API_KEY)


class GeminiService:
    """Gemini AI服务"""
    
    TAROT_SYSTEM_PROMPT = """你是一位专业的塔罗占卜师和命理师，拥有深厚的塔罗牌知识和解读经验。

你的职责：
1. 首次对话时，用温暖、神秘的语气欢迎用户，引导他们说出想要占卜的问题
2. 当用户提出问题后，分析问题的性质，决定使用何种牌阵和抽几张牌
3. **仅在第一次**，在<draw_cards>标签中返回抽牌指令，格式如下：
   <draw_cards>
   {
     "spread_type": "three_card",
     "card_count": 3,
     "positions": ["过去", "现在", "未来"]
   }
   </draw_cards>
   spread_type可选值：single（1张）, three_card（3张）, celtic_cross（10张）, custom（自定义）
4. 系统会通过特殊格式告诉你抽牌结果，格式为"[抽牌结果] 位置: 牌名 (正/逆位)"
5. **重要**：当你看到"[抽牌结果]"标记时，说明用户已经完成抽牌，你应该立即基于这些牌进行详细解读，**不要再次返回<draw_cards>指令**
6. 解读要有深度，结合牌意、位置、正逆位，给出具有启发性的建议
7. 解读完毕后，询问用户是否还有疑问，可以继续深入探讨
8. 一旦完成一次抽牌和解读，不能再次抽牌，但可以继续讨论已抽的牌

注意事项：
- 保持神秘、专业的占卜师语气
- 解读要有深度和洞察力，不要过于笼统
- 尊重用户的隐私和感受
- 如果用户资料中有昵称，使用昵称称呼用户
- **每次对话只能抽牌一次，看到抽牌结果后直接解读，不要再要求抽牌**
"""

    def __init__(self):
        self.model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            generation_config={
                "temperature": 0.9,
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 8192,
            }
        )
    
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
        
        if context_parts:
            return "\n用户资料：\n" + "\n".join(context_parts)
        return ""
    
    def _format_messages_for_gemini(
        self, 
        messages: List[Message], 
        user: Optional[User] = None
    ) -> List[Dict]:
        """将消息格式化为Gemini API格式"""
        gemini_messages = []
        
        # 添加系统提示
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
            # 处理系统消息（抽牌结果）
            if msg.role == MessageRole.SYSTEM:
                # 将抽牌结果作为用户消息发送给AI，使用特殊标记
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
        user: Optional[User] = None
    ) -> AsyncGenerator[str, None]:
        """流式生成回复"""
        gemini_messages = self._format_messages_for_gemini(messages, user)
        
        # 创建聊天会话
        chat = self.model.start_chat(history=gemini_messages[:-1])
        last_message = gemini_messages[-1]["parts"][0]["text"]
        
        # 流式生成
        response = await chat.send_message_async(last_message, stream=True)
        
        async for chunk in response:
            if chunk.text:
                yield chunk.text
    
    @staticmethod
    def extract_draw_cards_instruction(text: str) -> Optional[Dict]:
        """从AI回复中提取抽牌指令"""
        import re
        
        # 查找<draw_cards>标签
        pattern = r'<draw_cards>(.*?)</draw_cards>'
        match = re.search(pattern, text, re.DOTALL)
        
        if match:
            try:
                instruction = json.loads(match.group(1).strip())
                return instruction
            except json.JSONDecodeError:
                return None
        
        return None
    
    @staticmethod
    def remove_draw_cards_tags(text: str) -> str:
        """移除抽牌指令标签"""
        import re
        return re.sub(r'<draw_cards>.*?</draw_cards>', '', text, flags=re.DOTALL).strip()



