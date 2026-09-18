from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime
from enum import Enum


class UserType(str, Enum):
    GUEST = "guest"
    REGISTERED = "registered"


class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"
    PREFER_NOT_SAY = "prefer_not_say"


class UserProfile(BaseModel):
    nickname: Optional[str] = None
    gender: Optional[Gender] = None
    birth_year: Optional[int] = None
    birth_month: Optional[int] = None
    birth_day: Optional[int] = None
    birth_hour: Optional[int] = None
    birth_minute: Optional[int] = None
    birth_city: Optional[str] = None  # 出生地城市（用于星盘解读）


class User(BaseModel):
    user_id: str
    user_type: UserType
    username: Optional[str] = None  # For registered users
    password_hash: Optional[str] = None  # For registered users
    profile: Optional[UserProfile] = None
    # 基本星盘：1 到 12 宫的落座和宫里的星体（AstrologyService.format_chart_houses），放进 <用户资料>。
    # 第一次调 get_astrology_chart 时存下；出生资料一改就删掉（UserService.update_user_profile）。
    # 详细星盘不存，解读时仍由 get_astrology_chart 调接口取。不回给前端。
    natal_chart: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class AuthResponse(BaseModel):
    """登录/注册/游客创建的统一返回：用户信息 + 访问令牌。"""
    user: User
    access_token: str
    token_type: str = "bearer"


class UserLogin(BaseModel):
    username: str
    password: str


class UserRegister(BaseModel):
    username: str
    password: str
    profile: Optional[UserProfile] = None


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"       # 一次工具调用的结果（对应前一条 ASSISTANT 上的 tool_calls）
    # 旧版本的记录才有：2026-09 之前抽牌/星盘结果套在这个壳里。新代码不再写它；
    # 含有它的会话是旧格式，只能查看（见 services/tool_turns.is_legacy）。
    SYSTEM = "system"


class TarotCard(BaseModel):
    card_id: int  # 0-77 (78张塔罗牌)
    card_name: str
    reversed: bool = False  # 是否逆位


class DrawCardsRequest(BaseModel):
    spread_type: str
    # 牌阵中每个位置的含义。长度就是抽牌张数——牌阵由位置定义，再单独存一个
    # card_count 只会和它对不上（那个字段已删，存量记录里的会被忽略）。
    # 仍可空：2026-07 之前的记录有 positions=null，要能读回来。新请求一律带。
    positions: Optional[List[str]] = None


class ToolCallRecord(BaseModel):
    """模型发起的一次工具调用。id 由 provider 给（OpenAI）或本地生成（Gemini 没有 id），
    随后那条 TOOL 记录用 tool_call_id 对上它——OpenAI 的 tool_call_id、Gemini 的
    functionResponse 都靠这一对还原。"""
    id: str
    name: str
    args: dict = {}


class Message(BaseModel):
    """一轮记录，三种角色和官方 API 的消息形状一一对应：

        USER       用户发言
        ASSISTANT  模型的一轮：content 是它说的话，tool_calls 是它同时发起的调用
        TOOL       某次调用的结果：tool_call_id 指向调用，content 是结果 JSON

    重建历史时逐条映射即可（gemini_service._build_neutral），不做任何推断。

    tarot_cards / draw_request 是给界面画牌用的展示数据：抽牌的 TOOL 记录上带着抽出的
    牌；每日一签的解读（服务端直接生成，没有工具调用）把当日的牌挂在 ASSISTANT 上。
    """
    role: MessageRole
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    tool_calls: Optional[List[ToolCallRecord]] = None   # ASSISTANT
    reasoning: Optional[str] = None                      # ASSISTANT：思考模型那一轮的推理内容，
                                                         # 只在带 tool_calls 时记（喂回结果时 provider 要）
    tool_call_id: Optional[str] = None                   # TOOL
    tool_name: Optional[str] = None                      # TOOL（Gemini functionResponse 要名字）
    tarot_cards: Optional[List[TarotCard]] = None
    draw_request: Optional[DrawCardsRequest] = None


class SessionType(str, Enum):
    TAROT = "tarot"
    ASTROLOGY = "astrology"
    CHAT = "chat"
    DAILY = "daily"  # 每日一签


class Conversation(BaseModel):
    conversation_id: str
    user_id: str
    session_type: SessionType
    title: str = "新对话"
    messages: List[Message] = []
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    is_completed: bool = False  # 是否已完成占卜（已抽牌且解读完毕）
    has_drawn_cards: bool = False  # 是否已抽过牌
    # 相位状态位：opening=前置占卜师读人中，reading=解读 Agent 工作中。
    # 默认 reading 即存量迁移——老会话 data JSON 无此字段，反序列化自动补 reading，
    # 确定性路由到解读 Agent，行为与改动前一致。
    phase: str = "reading"
    # 策略单（前置 Agent 交付物）。None = 无策略增强，会话照常运转（存量会话即如此）。
    strategy: Optional[dict] = None


class SendMessageRequest(BaseModel):
    conversation_id: str
    content: str


class ResumeRequest(BaseModel):
    """「用户在界面上做完了动作（抽完牌 / 填完资料），请接着跑」。不带 content——它不是发言。"""
    conversation_id: str


class DrawCardsResponse(BaseModel):
    cards: List[TarotCard]
    conversation_id: str


class CreateConversationRequest(BaseModel):
    session_type: SessionType


class UpdateConversationTitleRequest(BaseModel):
    conversation_id: str
    title: str


class ConvertGuestToRegisteredRequest(BaseModel):
    user_id: str
    username: str
    password: str


# ── 每日一签 ──────────────────────────────────────────────────────

class DailyFeedback(BaseModel):
    verdict: Optional[Literal["hit", "miss"]] = None  # 应验了 / 没感觉
    note: Optional[str] = None                         # 一句话附言,存全文不截断
    fed_back_at: Optional[str] = None


class DailyDrawRecord(BaseModel):
    effective_date: str            # "YYYY-MM-DD",用户本地生效日
    card: TarotCard
    conversation_id: str
    drawn_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    feedback: DailyFeedback = Field(default_factory=DailyFeedback)


class DailyDrawRequest(BaseModel):
    effective_date: str


class DailyFeedbackRequest(BaseModel):
    effective_date: str
    verdict: Optional[Literal["hit", "miss"]] = None
    note: Optional[str] = None


class DailyDayView(BaseModel):
    effective_date: str
    record: Optional[DailyDrawRecord] = None
    tagline: Optional[str] = None          # 解读首句(懒取自对话,不落库)
    conversation_exists: bool = False


class DailyOverviewResponse(BaseModel):
    today_effective_date: str
    today_record: Optional[DailyDrawRecord] = None
    streak: int = 0
    history: List[DailyDayView] = []       # 升序 14 天,最后一项为今日


class DailyDrawResponse(BaseModel):
    record: DailyDrawRecord
    conversation_id: str
    reading: str    # 今日解读：抽签时服务端直接生成，随响应返回

