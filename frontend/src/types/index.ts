export enum UserType {
  GUEST = 'guest',
  REGISTERED = 'registered',
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
  PREFER_NOT_SAY = 'prefer_not_say',
}

export interface UserProfile {
  nickname?: string;
  gender?: Gender;
  birth_year?: number;
  birth_month?: number;
  birth_day?: number;
  birth_hour?: number;
  birth_minute?: number;
  birth_city?: string;  // 出生城市（用于星盘解读）
}

export interface User {
  user_id: string;
  user_type: UserType;
  username?: string;
  profile?: UserProfile;
  created_at: string;
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',       // 某次工具调用的结果（对应前一条 assistant 的 tool_calls）；抽牌的牌挂在这条上
  SYSTEM = 'system',   // 仅旧版本对话有；含它的对话只能查看
}

/** 模型发起的一次工具调用；随后那条 tool 记录用 tool_call_id 指回来 */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export enum SessionType {
  TAROT = 'tarot',
  ASTROLOGY = 'astrology',
  CHAT = 'chat',
  DAILY = 'daily',
}

export interface TarotCard {
  card_id: number;
  card_name: string;
  reversed: boolean;
}

export interface DrawCardsRequest {
  spread_type: string;
  /** 牌阵每个位置的含义。长度即抽牌张数——牌阵由位置定义，没有单独的张数字段。
   *  可空只为读 2026-07 之前的历史消息；新的抽牌请求一定带。 */
  positions?: string[];
}

export interface Message {
  role: MessageRole;
  content: string;
  timestamp: string;
  tool_calls?: ToolCallRecord[];   // assistant
  reasoning?: string;              // assistant：思考模型的推理内容（不渲染）
  tool_call_id?: string;           // tool
  tool_name?: string;              // tool
  /** 展示用的牌面：抽牌的 tool 记录上带牌；每日一签的解读把当日的牌挂在 assistant 上 */
  tarot_cards?: TarotCard[];
  draw_request?: DrawCardsRequest;
}

export interface Conversation {
  conversation_id: string;
  user_id: string;
  session_type: SessionType;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
  is_completed: boolean;
  has_drawn_cards: boolean;
}

// ── 每日一签 ──────────────────────────────────────────────────────

export interface DailyFeedback {
  verdict?: 'hit' | 'miss' | null;
  note?: string | null;
  fed_back_at?: string | null;
}

export interface DailyDrawRecord {
  effective_date: string;
  card: TarotCard;
  conversation_id: string;
  drawn_at: string;
  feedback: DailyFeedback;
}

export interface DailyDayView {
  effective_date: string;
  record?: DailyDrawRecord | null;
  tagline?: string | null;
  conversation_exists: boolean;
}

export interface DailyOverview {
  today_effective_date: string;
  today_record?: DailyDrawRecord | null;
  streak: number;
  history: DailyDayView[]; // 升序 14 天,最后一项为今日
  journey_ready: boolean;  // 素材够不够写新的一篇心灵奇旅
  journey_count: number;   // 已经写下几卷
}

/** 一篇写过的心灵奇旅:一天一篇,只读,不可续写 */
export interface JourneyEntry {
  generated_on: string;
  date_range: string;
  text: string;
  generated_at: string;
}

export interface JourneyList {
  entries: JourneyEntry[]; // 新→旧
  ready: boolean;
  pending_today: boolean;  // 今天聊过但笔记还没归档,这一篇里看不到
}
