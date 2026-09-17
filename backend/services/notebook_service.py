"""
占卜笔记本服务
为每个用户维护独立的占卜笔记本，记录对话摘要
"""
import json
import os
from pathlib import Path
from typing import Optional, List, Dict
from datetime import datetime

from config import DATA_DIR
from models import Conversation, User, Message, MessageRole
from services import llm, prompt_service


class NotebookEntry:
    """笔记本条目"""
    def __init__(
        self,
        conversation_id: str,
        start_time: str,
        question: str,
        cards_drawn: List[str],
        summary: str,
        user_feedback: str = "",
        end_time: str = ""  # 对话结束时间（updated_at）
    ):
        self.conversation_id = conversation_id
        self.start_time = start_time
        self.question = question
        self.cards_drawn = cards_drawn
        self.summary = summary
        self.user_feedback = user_feedback
        self.end_time = end_time
    
    def to_dict(self) -> Dict:
        return {
            "conversation_id": self.conversation_id,
            "start_time": self.start_time,
            "question": self.question,
            "cards_drawn": self.cards_drawn,
            "summary": self.summary,
            "user_feedback": self.user_feedback,
            "end_time": self.end_time
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> "NotebookEntry":
        return cls(
            conversation_id=data["conversation_id"],
            start_time=data["start_time"],
            question=data.get("question", ""),
            cards_drawn=data.get("cards_drawn", []),
            summary=data.get("summary", ""),
            user_feedback=data.get("user_feedback", ""),
            end_time=data.get("end_time", "")  # 兼容旧数据
        )


def _cards_line(label: str, cards, draw_request) -> str:
    positions = (draw_request.positions if draw_request else None) or []
    return f"[{label}] " + "；".join(
        f"{positions[i] if i < len(positions) else f'第{i + 1}张'}：{c.card_name}（{'逆位' if c.reversed else '正位'}）"
        for i, c in enumerate(cards)
    )


def build_transcript(conversation: Conversation) -> str:
    """记忆 Agent 看到的整场对话：每一句话 + 用户在界面上做过的事，按发生顺序，不截断。

    工具记录只写用户看得见、做过的事（抽了什么牌在什么位置、填了资料、看了星盘、没抽牌
    就接着聊）；交单、翻笔记本、取盘失败这些后台动作不写。星盘原始数据不写——占卜师的
    解读已经把它讲给用户了，笔记记的是这场对话。
    """
    msgs = conversation.messages
    lines = []
    for i, msg in enumerate(msgs):
        if msg.role == MessageRole.USER:
            lines.append(f"用户：{msg.content}")
        elif msg.role == MessageRole.ASSISTANT:
            if msg.tarot_cards:   # 每日一签：服务端抽的今日牌挂在解读上
                lines.append(_cards_line("今日签", msg.tarot_cards, msg.draw_request))
            if msg.content.strip():
                lines.append(f"占卜师：{msg.content}")
            call = msg.tool_calls[0] if msg.tool_calls else None
            if call and i == len(msgs) - 1:   # 对话停在一次没有下文的请求上
                if call.name == "draw_tarot_cards":
                    lines.append("[占卜师请用户抽牌，用户没有抽]")
                elif call.name == "request_user_profile":
                    lines.append("[占卜师请用户补充出生资料，用户没有填]")
        elif msg.role == MessageRole.TOOL:
            result = json.loads(msg.content) if msg.content else {}
            ok = result.get("success", True)
            if msg.tool_name == "draw_tarot_cards":
                lines.append(_cards_line("抽牌", msg.tarot_cards, msg.draw_request) if ok
                             else f"[{result.get('error')}]")
            elif msg.tool_name == "request_user_profile":
                lines.append("[用户补充了出生资料]" if ok else f"[{result.get('error')}]")
            elif msg.tool_name == "get_astrology_chart" and ok:
                lines.append("[占卜师取出了用户的本命星盘]")
    return "\n".join(lines)


class NotebookService:
    """笔记本管理服务"""
    
    NOTEBOOK_DIR = DATA_DIR / "notebooks"

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
        
        conversation_str = build_transcript(conversation)
        print(f"[Notebook] 对话内容: {conversation_str}")
        
        # 格式化时间
        start_time = datetime.fromisoformat(conversation.created_at).strftime("%Y年%m月%d日")
        
        # 构建提示词（热加载文件模板；replace 渲染，正文 JSON 花括号安全）
        prompt = prompt_service.render_prompt("notebook_system.md", {
            "conversation_content": conversation_str,
            "start_time": start_time,
            "question": question,
        })
        
        # 调用AI生成摘要（结构化输出，走记忆 Agent 的 provider）
        try:
            provider = llm.get_provider("memory")

            print(f"[Notebook] 正在为对话 {conversation.conversation_id} 生成摘要...")
            result_text = await provider.generate_json(prompt)

            # 解析JSON响应
            result = json.loads(result_text)
            summary = result.get("summary", "")
            cards_drawn = result.get("cards_drawn", [])
            
            print(f"[Notebook] 摘要生成成功，长度: {len(summary)}, 抽到的牌: {len(cards_drawn)}张")
            return summary, cards_drawn
        except Exception as e:
            print(f"[Notebook] 生成摘要失败: {e}")
            import traceback
            traceback.print_exc()
            # 返回默认值
            return f"我在{start_time}进行了占卜。", []
    
    async def generate_and_save_entry(
        self,
        user_id: str,
        conversation: Conversation,
        user: Optional[User] = None
    ) -> Dict[str, any]:
        """
        直接生成并保存笔记（供定时任务调用）
        不进行时间和变化检查
        
        Args:
            user_id: 用户ID
            conversation: 对话对象
            user: 用户对象（可选）
            
        Returns:
            包含生成状态的字典
        """
        # 加载现有笔记本
        entries = self._load_notebook(user_id)
        
        # 查找是否已有该对话的记录
        existing_entry_idx = None
        for i, entry in enumerate(entries):
            if entry.conversation_id == conversation.conversation_id:
                existing_entry_idx = i
                break
        
        # 生成摘要（AI 会从对话中自动提取抽到的牌）
        summary, cards_drawn = await self.generate_summary(conversation, user)
        
        # 提取问题
        question = "未知问题"
        for msg in conversation.messages:
            if msg.role == MessageRole.USER and msg.content.strip():
                question = msg.content[:100]
                break
        
        # 创建新条目（使用 AI 提取的 cards_drawn）
        new_entry = NotebookEntry(
            conversation_id=conversation.conversation_id,
            start_time=conversation.created_at,
            question=question,
            cards_drawn=cards_drawn,
            summary=summary,
            end_time=conversation.updated_at
        )
        
        # 更新或添加条目
        if existing_entry_idx is not None:
            entries[existing_entry_idx] = new_entry
            print(f"[Notebook] 更新条目: {conversation.conversation_id}")
        else:
            entries.append(new_entry)
            print(f"[Notebook] 新增条目: {conversation.conversation_id}")
        
        # 保存笔记本
        self._save_notebook(user_id, entries)
        
        return {
            "notebook_updated": True,
            "entry": new_entry.to_dict()
        }
    
    async def update_entry(
        self,
        user_id: str,
        conversation: Conversation,
        user: Optional[User] = None
    ) -> Dict[str, any]:
        """
        检查是否需要创建定时任务
        
        Args:
            user_id: 用户ID
            conversation: 对话对象
            user: 用户对象（可选）
            
        Returns:
            包含检查状态的字典
        """
        # 加载现有笔记本
        entries = self._load_notebook(user_id)
        
        # 查找是否已有该对话的记录
        existing_entry = None
        for entry in entries:
            if entry.conversation_id == conversation.conversation_id:
                existing_entry = entry
                break
        
        # 条件1: 检查对话是否有变化
        conversation_changed = True
        if existing_entry and existing_entry.end_time:
            conversation_changed = existing_entry.end_time != conversation.updated_at
        
        # 返回检查结果
        check_result = {
            "conversation_changed": conversation_changed,
            "should_schedule": conversation_changed,  # 只要有变化就应该调度
            "existing_entry": existing_entry is not None
        }
        
        # 如果对话无变化，不需要调度
        if not conversation_changed:
            return check_result
        
        # 创建定时任务
        from services.notebook_task_scheduler import task_scheduler
        task_added = await task_scheduler.add_task(conversation.conversation_id, user_id)
        
        check_result["task_scheduled"] = task_added
        
        return check_result
    
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

