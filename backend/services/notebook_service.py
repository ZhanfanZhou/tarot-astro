"""
笔记本服务
为每个用户维护独立的笔记本：一场一条的占卜笔记，外加一份逐次修订的用户画像
"""
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, get_args

from pydantic import BaseModel, ValidationError

from config import DATA_DIR
from models import Conversation, User, UserType, Message, MessageRole
from services import llm, prompt_service, tool_turns


class NoteEntry:
    """一条占卜笔记：一场占卜一条。

    「一场一条」是笔记本的追加粒度：一场对话在笔记本里永远只占一条，位置按第一次写入的先后排。
    同一场对话后来又续聊，这一条会拿新的整份对话稿重写（整条覆盖，不是在旧内容后面接），位置不变。

    start_time / end_time 由系统按对话的开始、最后更新时间写（start_time 就是占卜时间）；
    question（问题与背景）、cards_drawn、summary、user_feedback 由记忆 Agent 写，对话没涉及的留空。
    2026-09-17 之前的旧笔记不回填：question 是用户第一句话的前 100 字，user_feedback 为空。
    """
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
    def from_dict(cls, data: Dict) -> "NoteEntry":
        return cls(
            conversation_id=data["conversation_id"],
            start_time=data["start_time"],
            question=data.get("question", ""),
            cards_drawn=data.get("cards_drawn", []),
            summary=data.get("summary", ""),
            user_feedback=data.get("user_feedback", ""),
            end_time=data.get("end_time", "")  # 兼容旧数据
        )


def notebook_enabled(user: Optional[User]) -> bool:
    """笔记本只对注册用户开放：游客离场不写笔记也不写画像，占卜师也读不到笔记本。"""
    return user is not None and user.user_type == UserType.REGISTERED


# ── 用户画像 ───────────────────────────────────────────────────────────
#
# 一人一份，和笔记同一个目录、同一个开关。笔记是追加（一场一条，续聊就整条重写），
# 画像是增量：结构由代码固定，记忆 Agent 每场只回它要改的字段，写了哪个就回写哪个，
# 没写的原样留着——让模型重写整份 JSON，没变的部分也会被改脏。
#
# 每个字段带一个 confirmed_at：这个字段最后一次被写的那场对话的结束时间，由代码写。
# 模型不写时间——它不知道今天几号，让它写必编。时间是用来判断这条还新不新的。
#
# 稳定资料（昵称/性别/出生日期…）不进画像：那是用户填的表单，有唯一出处（User.profile），
# 抄一份进来只会和表单对不上。

class _PortraitPatch(BaseModel):
    """画像补丁：只出现这场要改的字段，没出现的保持原样。

    这个类是画像结构在代码里的唯一一份声明：画像文件的骨架（PORTRAIT_FIELDS）、
    合并时保留哪些字段、模型返回的 JSON 收下哪些字段，全从这里推出来。
    加字段只改这里，加完再照着改提示词（表格 + JSON 示例）——两边必须对得上，
    test_prompt_and_code_agree_on_the_portrait_fields 会比对，漏改哪边都会红。
    """
    recent: Optional[str] = None              # 生活近况
    people_and_events: Optional[str] = None   # 近期重要的人与事
    understanding: Optional[str] = None       # 累积认识
    preferences: Optional[str] = None         # 交流偏好

    def as_dict(self) -> Dict:
        """摊成普通字典，只留模型真写了的字段（写 null 的当没写）。"""
        return {name: getattr(self, name) for name in PORTRAIT_FIELDS
                if name in self.model_fields_set and getattr(self, name) is not None}


PORTRAIT_FIELDS = tuple(_PortraitPatch.model_fields)


def empty_portrait() -> Dict:
    """空画像：字段齐全、值全空。没有画像的用户就是这个，它同时也是模板本身。"""
    return {name: {"text": "", "confirmed_at": ""} for name in PORTRAIT_FIELDS}


def merge_portrait(portrait: Dict, patch: Dict, confirmed_time: str) -> Dict:
    """把补丁并进画像：补丁里有的字段覆盖、记下时间，没有的连内容带时间原样留着。

    字段给 "" 就是清空——值可以为空，字段不会少：整份骨架由 empty_portrait 固定，
    模型改不了结构，读进来的旧文件缺哪项也会在这里补齐。
    """
    merged = {}
    for name in PORTRAIT_FIELDS:
        old = portrait.get(name) or {}
        merged[name] = ({"text": patch[name], "confirmed_at": confirmed_time} if name in patch
                        else {"text": old.get("text", ""),
                              "confirmed_at": old.get("confirmed_at", "")})
    return merged


# ── 对话稿：会话记录 → 记忆 Agent 读的文字 ─────────────────────────────
#
# 只换格式，不丢内容：每条记录按发生顺序转一段，JSON 换成「标签：值」，工具名换成动作。
# 唯一不写的是纯管道信息——tool_call_id（调用和结果的对应关系由先后顺序体现）、
# 抽牌结果里和 content 重复的展示字段、结果里的 success=true、记录条数（正文里已有）。
# 认不出的字段按原键名照写，新工具、新字段不会被悄悄吞掉。

_LABELS = {
    "question": "问题", "context": "背景", "route": "起手", "spread_type": "牌阵",
    "positions": "位置", "reason": "原因", "required_fields": "需要的资料",
    "missing_fields": "缺", "nickname": "昵称", "gender": "性别", "birth_date": "出生日期",
    "birth_time": "出生时间", "birth_city": "出生地", "message": "说明",
}
_FIELD_LISTS = {"required_fields", "missing_fields"}   # 值是资料字段名，一并换成中文

_CALL_LABELS = {
    "draw_tarot_cards": "占卜师请用户抽牌",
    "request_user_profile": "占卜师请用户填写资料",
    "submit_reading_brief": "后台·开场确认了本场占卜",
    "get_astrology_chart": "后台·占卜师取用户的本命星盘",
    "read_divination_notes": "后台·占卜师翻看以前的占卜记录",
}
_FAILED_LABELS = {
    "get_astrology_chart": "后台·取星盘没有成功：",
    "read_divination_notes": "后台·翻以前的占卜记录没有成功：",
}
_NOT_DONE = {   # 对话停在一次还没有结果的 interrupt 调用上
    "draw_tarot_cards": "[到这里为止，用户还没有抽牌]",
    "request_user_profile": "[到这里为止，用户还没有填写资料]",
}


def _fields(values: dict) -> str:
    parts = []
    for key, value in values.items():
        if isinstance(value, (list, tuple)):
            if key in _FIELD_LISTS:
                value = [_LABELS.get(v, v) for v in value]
            value = " / ".join(str(v) for v in value)
        parts.append(f"{_LABELS.get(key, key)}：{value}")
    return "；".join(parts)


def _cards(label: str, cards, draw_request) -> str:
    positions = (draw_request.positions if draw_request else None) or []
    return f"[{label}] " + "；".join(
        f"{positions[i] if i < len(positions) else f'第{i + 1}张'}：{c.card_name}（{'逆位' if c.reversed else '正位'}）"
        for i, c in enumerate(cards)
    )


def _call(call) -> str:
    label = _CALL_LABELS.get(call.name, f"后台·占卜师调用 {call.name}")
    return f"[{label}]" + (f" {_fields(call.args)}" if call.args else "")


def _tool_result(msg: Message) -> List[str]:
    rest = json.loads(msg.content) if msg.content else {}
    name = msg.tool_name
    if rest.pop("success", True) is False:
        line = f"[{_FAILED_LABELS.get(name, '')}{rest.pop('error', '')}]"
    elif name == "draw_tarot_cards":
        line = "[用户抽了牌] " + "；".join(
            f"{c['position']}：{c['card']}（{c['orientation']}）" for c in rest.pop("cards"))
    elif name == "request_user_profile":
        # 本场第一次补资料的结果不带值（值在 <用户资料> 里，见 tool_turns.profile_result），
        # 只剩 message 那一句；再补一次带的是那一次的值。两样都照写，由下面的 rest 兜住。
        filled = rest.pop("profile", None)
        line = "[用户填写了资料]" + (f" {_fields(filled)}" if filled else "")
    elif name == "get_astrology_chart":
        line = f"[后台·星盘数据]\n{rest.pop('data')}"
    elif name == "read_divination_notes":
        rest.pop("note_count", None)
        body = rest.pop("notes", None) or rest.pop("message")
        line = f"[后台·以前的占卜记录]\n{body}"
    elif rest:
        line = f"[后台·{name} 的结果]"
    else:
        return []   # 只有 success=true（如交单），没有内容
    if rest:
        line += f" {_fields(rest)}"
    return [line]


def _record(msg: Message) -> List[str]:
    if msg.role == MessageRole.USER:
        return [f"用户：{msg.content}"]
    if msg.role == MessageRole.TOOL:
        return _tool_result(msg)
    if msg.role == MessageRole.SYSTEM:   # 旧格式会话：抽牌 / 星盘结果套在系统消息里
        lines = [f"[系统记录] {msg.content}"]
        if msg.tarot_cards:
            lines.append(_cards("抽牌", msg.tarot_cards, msg.draw_request))
        return lines
    lines = []
    if msg.reasoning:
        lines.append(f"[后台·占卜师的思考] {msg.reasoning}")
    if msg.tarot_cards:   # 每日一签：服务端抽的今日牌挂在解读上
        lines.append(_cards("今日签", msg.tarot_cards, msg.draw_request))
    if msg.content.strip():
        lines.append(f"占卜师：{msg.content}")
    lines += [_call(call) for call in msg.tool_calls or []]
    return lines


def build_transcript(conversation: Conversation) -> str:
    """记忆 Agent 读的整场对话：每条记录按发生顺序转成文字，带时间（UTC），不截断。"""
    lines, day = [], None
    for msg in conversation.messages:
        record = _record(msg)
        if not record:
            continue
        stamp = datetime.fromisoformat(msg.timestamp)
        if stamp.date() != day:
            day = stamp.date()
            lines.append(f"—— {day.isoformat()} ——")
        lines += [f"[{stamp:%H:%M}] {item}" for item in record]
    pending = tool_turns.pending_interrupt(conversation)
    if pending:
        lines.append(_NOT_DONE[pending.name])
    return "\n".join(lines)


def notebook_prompt_parts(conversation: Conversation, portrait: Dict) -> List[prompt_service.Part]:
    """记忆 Agent 的整段输入：提示词 + 整场对话 + 当前画像（replace 渲染，正文 JSON 花括号安全）。

    画像原样发它要打补丁的那个 JSON —— 形状一眼可见，不用另写一段说明。
    """
    return prompt_service.render_prompt_parts("notebook_system.md", {
        "conversation_content": build_transcript(conversation),
        "portrait_content": json.dumps(portrait, ensure_ascii=False, indent=2),
    })


NOTE_ATTEMPTS = 3   # 记忆 Agent 返回的 JSON 不合格时，连同第一次一共最多生成几次


class _NoteOutput(BaseModel):
    """这场占卜的笔记。字段都允许为空；多出来的键忽略。"""
    question: Optional[str] = None
    cards_drawn: Optional[List[str]] = None
    summary: Optional[str] = None
    user_feedback: Optional[str] = None


class _NotebookOutput(BaseModel):
    """记忆 Agent 一次调用的全部输出：这场的笔记 + 画像补丁（这场没什么可更新的就没有）。"""
    note: Optional[_NoteOutput] = None
    portrait: Optional[_PortraitPatch] = None


class NotebookService:
    """笔记本管理服务：一场一条的占卜笔记 + 一人一份的用户画像"""
    
    NOTEBOOK_DIR = DATA_DIR / "notebooks"

    def __init__(self):
        # 确保笔记本目录存在
        self.NOTEBOOK_DIR.mkdir(exist_ok=True)
    
    def _notes_path(self, user_id: str) -> Path:
        """用户的占卜笔记文件路径"""
        return self.NOTEBOOK_DIR / f"note_{user_id}.log"
    
    def _load_notes(self, user_id: str) -> List[NoteEntry]:
        """加载用户的占卜笔记"""
        path = self._notes_path(user_id)
        if not path.exists():
            return []
        
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return [NoteEntry.from_dict(entry) for entry in data]
        except Exception as e:
            print(f"[Notebook] 加载笔记失败 {user_id}: {e}")
            return []
    
    def _save_notes(self, user_id: str, entries: List[NoteEntry]):
        """保存用户的占卜笔记"""
        path = self._notes_path(user_id)
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump([entry.to_dict() for entry in entries], f, ensure_ascii=False, indent=2)
            print(f"[Notebook] 笔记已保存: {user_id}, 共 {len(entries)} 条记录")
        except Exception as e:
            print(f"[Notebook] 保存笔记失败 {user_id}: {e}")

    def _portrait_path(self, user_id: str) -> Path:
        """用户的画像文件路径"""
        return self.NOTEBOOK_DIR / f"portrait_{user_id}.json"

    def _load_portrait(self, user_id: str) -> Dict:
        """加载用户画像；还没有画像就返回空画像。

        读不出来就让它抛：画像只有这一份，读坏了当成「这人没有画像」，下一次保存就把它覆盖没了。
        抛出去的结果是这次不生成，任务记下错误移除，用户下次离开对话时重新登记，文件原样留着。
        """
        path = self._portrait_path(user_id)
        if not path.exists():
            return empty_portrait()
        with open(path, "r", encoding="utf-8") as f:
            return merge_portrait(json.load(f), {}, "")

    def _save_portrait(self, user_id: str, portrait: Dict):
        """保存用户画像"""
        with open(self._portrait_path(user_id), "w", encoding="utf-8") as f:
            json.dump(portrait, f, ensure_ascii=False, indent=2)

    async def generate_update(self, conversation: Conversation, portrait: Dict) -> Dict:
        """记忆 Agent 读整场占卜和当前画像，写这场的笔记 + 画像补丁。

        返回 {"note": 笔记的四个字段, "portrait": 这场要改的画像字段}（模型没写或写 null 的
        笔记字段按空处理；画像补丁可以是空的——这场没什么可更新的是常态）。

        只有「回来的不是合格 JSON」才重新生成（解析不了、不是对象、字段类型不对、没有笔记），
        一共最多 NOTE_ATTEMPTS 次——JSON 不合格就是写不回去，除了重摇没有别的办法。
        内容本身不做检查：字数上限只在提示词里说，模型写长了照收，不为这个丢掉一条好笔记。
        都不合格或 provider 报错就抛，不写假笔记：定时任务记下错误并移除任务，
        用户下次离开这场对话时会重新登记。
        """
        prompt = prompt_service.join(notebook_prompt_parts(conversation, portrait))
        provider = llm.get_provider("memory")
        for attempt in range(1, NOTE_ATTEMPTS + 1):
            print(f"[Notebook] 为对话 {conversation.conversation_id} 生成笔记（第 {attempt} 次）...")
            raw = await provider.generate_json(prompt)
            try:
                out = _NotebookOutput.model_validate_json(raw)
            except ValidationError as e:
                print(f"[Notebook] 第 {attempt} 次返回的 JSON 不合格: {e}")
                continue
            if out.note is None or not out.note.model_fields_set:
                # DeepSeek 的 JSON 模式偶尔只回 {"type": "json_object"}，不是一条笔记
                print(f"[Notebook] 第 {attempt} 次返回的 JSON 里没有笔记: {raw[:200]}")
                continue
            return {
                "note": {
                    "question": out.note.question or "",
                    "cards_drawn": out.note.cards_drawn or [],
                    "summary": out.note.summary or "",
                    "user_feedback": out.note.user_feedback or "",
                },
                "portrait": out.portrait.as_dict() if out.portrait else {},
            }
        raise ValueError(f"记忆 Agent 连续 {NOTE_ATTEMPTS} 次返回的 JSON 不合格")
    
    async def generate_and_save(
        self,
        user_id: str,
        conversation: Conversation,
        user: Optional[User] = None
    ) -> Dict[str, any]:
        """
        直接生成并保存这场的笔记，顺带把画像的改动并进去（供定时任务调用）
        不进行时间和变化检查
        
        Args:
            user_id: 用户ID
            conversation: 对话对象
            user: 用户对象（可选）
            
        Returns:
            包含生成状态的字典
        """
        # 加载现有笔记和画像
        entries = self._load_notes(user_id)
        portrait = self._load_portrait(user_id)
        
        # 查找是否已有该对话的记录
        existing_entry_idx = None
        for i, entry in enumerate(entries):
            if entry.conversation_id == conversation.conversation_id:
                existing_entry_idx = i
                break
        
        generated = await self.generate_update(conversation, portrait)
        new_entry = NoteEntry(
            conversation_id=conversation.conversation_id,
            start_time=conversation.created_at,
            end_time=conversation.updated_at,
            **generated["note"],
        )
        
        # 更新或添加条目
        if existing_entry_idx is not None:
            entries[existing_entry_idx] = new_entry
            print(f"[Notebook] 更新条目: {conversation.conversation_id}")
        else:
            entries.append(new_entry)
            print(f"[Notebook] 新增条目: {conversation.conversation_id}")
        
        # 保存笔记本
        self._save_notes(user_id, entries)
        
        # 画像：这场没有要改的就不动文件（多数场次都不会改）
        patch = generated["portrait"]
        if patch:
            self._save_portrait(user_id, merge_portrait(portrait, patch, conversation.updated_at))
            print(f"[Notebook] 画像已更新: {user_id}, 改了 {'、'.join(patch)}")
        
        return {
            "notebook_updated": True,
            "entry": new_entry.to_dict(),
            "portrait_updated": sorted(patch),
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
        entries = self._load_notes(user_id)
        
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
        删除用户的笔记本：笔记和画像（游客登出时使用）
        
        Args:
            user_id: 用户ID
        """
        for path in (self._notes_path(user_id), self._portrait_path(user_id)):
            if path.exists():
                try:
                    os.remove(path)
                    print(f"[Notebook] 已删除: {path.name}")
                except Exception as e:
                    print(f"[Notebook] 删除失败 {path.name}: {e}")
    
    def get_notes(self, user_id: str) -> List[Dict]:
        """
        获取用户的占卜笔记（用于调试或展示）
        
        Args:
            user_id: 用户ID
            
        Returns:
            笔记条目列表
        """
        entries = self._load_notes(user_id)
        return [entry.to_dict() for entry in entries]
    
    def get_portrait(self, user_id: str) -> Dict:
        """
        获取用户画像；还没有画像的用户返回空画像（字段齐全、值全空）
        
        Args:
            user_id: 用户ID
            
        Returns:
            画像字典
        """
        return self._load_portrait(user_id)


# 全局服务实例
notebook_service = NotebookService()

