"""
占卜笔记本服务
为每个用户维护独立的占卜笔记本，记录对话摘要
"""
import json
import os
from pathlib import Path
from typing import Optional, List, Dict
from datetime import datetime
import google.generativeai as genai

from config import DATA_DIR, GEMINI_API_KEY
from models import Conversation, User, Message, MessageRole

# 配置 Gemini API
genai.configure(api_key=GEMINI_API_KEY)


class NotebookEntry:
    """笔记本条目"""
    def __init__(
        self,
        conversation_id: str,
        start_time: str,
        question: str,
        cards_drawn: List[str],
        summary: str,
        user_feedback: str = ""
    ):
        self.conversation_id = conversation_id
        self.start_time = start_time
        self.question = question
        self.cards_drawn = cards_drawn
        self.summary = summary
        self.user_feedback = user_feedback
    
    def to_dict(self) -> Dict:
        return {
            "conversation_id": self.conversation_id,
            "start_time": self.start_time,
            "question": self.question,
            "cards_drawn": self.cards_drawn,
            "summary": self.summary,
            "user_feedback": self.user_feedback
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> "NotebookEntry":
        return cls(
            conversation_id=data["conversation_id"],
            start_time=data["start_time"],
            question=data.get("question", ""),
            cards_drawn=data.get("cards_drawn", []),
            summary=data.get("summary", ""),
            user_feedback=data.get("user_feedback", "")
        )


class NotebookService:
    """笔记本管理服务"""
    
    NOTEBOOK_DIR = DATA_DIR / "notebooks"
    
    # 笔记生成专用模型配置（使用 Gemini-2.5-flash）
    NOTEBOOK_MODEL = "gemini-2.5-flash"
    NOTEBOOK_GENERATION_CONFIG = {
        "temperature": 0.7,
        "top_p": 0.9,
        "top_k": 40,
        "max_output_tokens": 500,  # 限制在300字左右
    }
    
    # 笔记生成提示词
    NOTEBOOK_PROMPT = """你是一位专业的占卜记录员，需要为用户生成简洁的占卜记录。

**重要要求：**
1. 以用户的第一人称视角书写（"我"）
2. 总结要简洁，不超过300字
3. 重点记录：用户经历了什么、抽到了什么牌、用户的感受和反馈
4. 使用温暖、理解的语气
5. 不需要解读牌意，只记录事实和用户的反馈
6. 如果用户没有明确反馈，可以根据对话内容推测用户的态度

**记录格式：**
我[时间]进行了一次占卜。我想了解[问题]。抽到了[牌名]。在这次占卜中，[经历了什么]。[用户的感受/反馈]。

现在请根据以下对话内容，生成占卜记录：

**对话开始时间：** {start_time}
**讨论的问题：** {question}
**抽到的牌：** {cards}

**对话内容：**
{conversation_content}

请生成占卜记录（不超过300字）："""
    
    def __init__(self):
        # 确保笔记本目录存在
        self.NOTEBOOK_DIR.mkdir(exist_ok=True)
    
    def _get_notebook_path(self, user_id: str) -> Path:
        """获取用户笔记本文件路径"""
        return self.NOTEBOOK_DIR / f"note_{user_id}.log"
    
    def _load_notebook(self, user_id: str) -> List[NotebookEntry]:
        """加载用户笔记本"""
        notebook_path = self._get_notebook_path(user_id)
        if not notebook_path.exists():
            return []
        
        try:
            with open(notebook_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return [NotebookEntry.from_dict(entry) for entry in data]
        except Exception as e:
            print(f"[Notebook] 加载笔记本失败 {user_id}: {e}")
            return []
    
    def _save_notebook(self, user_id: str, entries: List[NotebookEntry]):
        """保存用户笔记本"""
        notebook_path = self._get_notebook_path(user_id)
        try:
            with open(notebook_path, "w", encoding="utf-8") as f:
                json.dump([entry.to_dict() for entry in entries], f, ensure_ascii=False, indent=2)
            print(f"[Notebook] 笔记本已保存: {user_id}, 共 {len(entries)} 条记录")
        except Exception as e:
            print(f"[Notebook] 保存笔记本失败 {user_id}: {e}")
    
    async def generate_summary(
        self,
        conversation: Conversation,
        user: Optional[User] = None
    ) -> str:
        """
        使用AI生成对话摘要
        
        Args:
            conversation: 对话对象
            user: 用户对象
            
        Returns:
            生成的摘要文本
        """
        # 提取问题（第一条用户消息）
        question = "未知问题"
        for msg in conversation.messages:
            if msg.role == MessageRole.USER and msg.content.strip():
                question = msg.content[:100]  # 取前100字
                break
        
        # 提取抽到的牌
        cards = []
        for msg in conversation.messages:
            if msg.tarot_cards:
                for card in msg.tarot_cards:
                    reversed_str = "逆位" if card.reversed else "正位"
                    cards.append(f"{card.card_name}（{reversed_str}）")
        
        cards_str = "、".join(cards) if cards else "无"
        
        # 构建对话内容（只取用户和助手的消息，跳过系统消息）
        conversation_content = []
        for msg in conversation.messages:
            if msg.role == MessageRole.USER:
                conversation_content.append(f"用户：{msg.content}")
            elif msg.role == MessageRole.ASSISTANT:
                conversation_content.append(f"占卜师：{msg.content}")
        
        conversation_str = "\n".join(conversation_content[:20])  # 只取前20条消息
        
        # 格式化时间
        start_time = datetime.fromisoformat(conversation.created_at).strftime("%Y年%m月%d日")
        
        # 构建提示词
        prompt = self.NOTEBOOK_PROMPT.format(
            start_time=start_time,
            question=question,
            cards=cards_str,
            conversation_content=conversation_str
        )
        
        # 调用AI生成摘要
        try:
            model = genai.GenerativeModel(
                model_name=self.NOTEBOOK_MODEL,
                generation_config=self.NOTEBOOK_GENERATION_CONFIG
            )
            
            print(f"[Notebook] 正在为对话 {conversation.conversation_id} 生成摘要...")
            response = await model.generate_content_async(prompt)
            summary = response.text.strip()
            
            print(f"[Notebook] 摘要生成成功，长度: {len(summary)}")
            return summary
        except Exception as e:
            print(f"[Notebook] 生成摘要失败: {e}")
            # 返回一个简单的默认摘要
            return f"我在{start_time}进行了占卜，抽到了{cards_str}。"
    
    async def update_entry(
        self,
        user_id: str,
        conversation: Conversation,
        user: Optional[User] = None
    ):
        """
        更新或创建笔记本条目
        
        Args:
            user_id: 用户ID
            conversation: 对话对象
            user: 用户对象（可选）
        """
        # 加载现有笔记本
        entries = self._load_notebook(user_id)
        
        # 查找是否已有该对话的记录
        existing_entry = None
        for i, entry in enumerate(entries):
            if entry.conversation_id == conversation.conversation_id:
                existing_entry = i
                break
        
        # 生成摘要
        summary = await self.generate_summary(conversation, user)
        
        # 提取问题
        question = "未知问题"
        for msg in conversation.messages:
            if msg.role == MessageRole.USER and msg.content.strip():
                question = msg.content[:100]
                break
        
        # 提取抽到的牌
        cards = []
        for msg in conversation.messages:
            if msg.tarot_cards:
                for card in msg.tarot_cards:
                    reversed_str = "逆位" if card.reversed else "正位"
                    cards.append(f"{card.card_name}（{reversed_str}）")
        
        # 创建新条目
        new_entry = NotebookEntry(
            conversation_id=conversation.conversation_id,
            start_time=conversation.created_at,
            question=question,
            cards_drawn=cards,
            summary=summary,
            user_feedback=""
        )
        
        # 更新或添加条目
        if existing_entry is not None:
            entries[existing_entry] = new_entry
            print(f"[Notebook] 更新条目: {conversation.conversation_id}")
        else:
            entries.append(new_entry)
            print(f"[Notebook] 新增条目: {conversation.conversation_id}")
        
        # 保存笔记本
        self._save_notebook(user_id, entries)
    
    def delete_notebook(self, user_id: str):
        """
        删除用户的笔记本（游客登出时使用）
        
        Args:
            user_id: 用户ID
        """
        notebook_path = self._get_notebook_path(user_id)
        if notebook_path.exists():
            try:
                os.remove(notebook_path)
                print(f"[Notebook] 笔记本已删除: {user_id}")
            except Exception as e:
                print(f"[Notebook] 删除笔记本失败 {user_id}: {e}")
    
    def migrate_notebook(self, old_user_id: str, new_user_id: str):
        """
        迁移笔记本（游客转注册用户时使用）
        
        Args:
            old_user_id: 旧用户ID（游客）
            new_user_id: 新用户ID（注册用户）
        """
        old_path = self._get_notebook_path(old_user_id)
        new_path = self._get_notebook_path(new_user_id)
        
        if old_path.exists():
            try:
                # 读取旧笔记本
                entries = self._load_notebook(old_user_id)
                # 保存到新用户
                self._save_notebook(new_user_id, entries)
                # 删除旧笔记本
                os.remove(old_path)
                print(f"[Notebook] 笔记本已迁移: {old_user_id} -> {new_user_id}")
            except Exception as e:
                print(f"[Notebook] 迁移笔记本失败: {e}")
    
    def get_notebook(self, user_id: str) -> List[Dict]:
        """
        获取用户的笔记本（用于调试或展示）
        
        Args:
            user_id: 用户ID
            
        Returns:
            笔记本条目列表
        """
        entries = self._load_notebook(user_id)
        return [entry.to_dict() for entry in entries]


# 全局服务实例
notebook_service = NotebookService()

