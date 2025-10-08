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
  SYSTEM = 'system',
}

export enum SessionType {
  TAROT = 'tarot',
  ASTROLOGY = 'astrology',
  CHAT = 'chat',
}

export enum TarotSpread {
  SINGLE = 'single',
  THREE_CARD = 'three_card',
  CELTIC_CROSS = 'celtic_cross',
  CUSTOM = 'custom',
}

export interface TarotCard {
  card_id: number;
  card_name: string;
  reversed: boolean;
}

export interface DrawCardsRequest {
  spread_type: TarotSpread;
  card_count: number;
  positions?: string[];
}

export interface Message {
  role: MessageRole;
  content: string;
  timestamp: string;
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




