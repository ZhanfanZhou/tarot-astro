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
    SYSTEM = "system"


class TarotSpread(str, Enum):
    SINGLE = "single"  # 单张牌
    THREE_CARD = "three_card"  # 三张牌
    CELTIC_CROSS = "celtic_cross"  # 凯尔特十字
    CUSTOM = "custom"  # 自定义数量


class TarotCard(BaseModel):
    card_id: int  # 0-77 (78张塔罗牌)
    card_name: str
    reversed: bool = False  # 是否逆位


class DrawCardsRequest(BaseModel):
    spread_type: str
    card_count: int
    positions: Optional[List[str]] = None  # 牌阵中每个位置的含义


class Message(BaseModel):
    role: MessageRole
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
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


class SendMessageRequest(BaseModel):
    conversation_id: str
    content: str


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

