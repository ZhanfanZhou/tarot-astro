import axios from 'axios';
import type {
  User,
  UserProfile,
  Conversation,
  SessionType,
  TarotCard,
  DrawCardsRequest,
  DailyOverview,
  DailyDrawRecord,
} from '@/types';

// 默认使用同源路径，开发环境下由 Vite 代理转发到后端，避免跨域与预检请求
// 如需直连后端，请在 .env 中设置 VITE_API_URL
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 用户相关API
export const userApi = {
  createGuest: async (profile?: UserProfile): Promise<User> => {
    const response = await api.post('/api/users/guest', profile || {});
    return response.data;
  },

  register: async (username: string, password: string, profile?: UserProfile): Promise<User> => {
    const response = await api.post('/api/users/register', {
      username,
      password,
      ...(profile ? { profile } : {}),  // Only include profile if it's defined
    });
    return response.data;
  },

  login: async (username: string, password: string): Promise<User> => {
    const response = await api.post('/api/users/login', {
      username,
      password,
    });
    return response.data;
  },

  getUser: async (userId: string): Promise<User> => {
    const response = await api.get(`/api/users/${userId}`);
    return response.data;
  },

  updateProfile: async (userId: string, profile: UserProfile): Promise<User> => {
    const response = await api.put(`/api/users/${userId}/profile`, profile);
    return response.data;
  },

  convertGuestToRegistered: async (userId: string, username: string, password: string): Promise<User> => {
    const response = await api.post('/api/users/convert-guest', {
      user_id: userId,
      username,
      password,
    });
    return response.data;
  },

  deleteUser: async (userId: string): Promise<void> => {
    await api.delete(`/api/users/${userId}`);
  },
};

// 对话相关API
export const conversationApi = {
  create: async (userId: string, sessionType: SessionType): Promise<Conversation> => {
    const response = await api.post(
      `/api/conversations?user_id=${userId}`,
      { session_type: sessionType }
    );
    return response.data;
  },

  get: async (conversationId: string): Promise<Conversation> => {
    const response = await api.get(`/api/conversations/${conversationId}`);
    return response.data;
  },

  getUserConversations: async (userId: string): Promise<Conversation[]> => {
    const response = await api.get(`/api/conversations/user/${userId}`);
    return response.data;
  },

  updateTitle: async (conversationId: string, title: string): Promise<Conversation> => {
    const response = await api.put('/api/conversations/title', {
      conversation_id: conversationId,
      title,
    });
    return response.data;
  },

  delete: async (conversationId: string): Promise<void> => {
    await api.delete(`/api/conversations/${conversationId}`);
  },

  exit: async (conversationId: string): Promise<{ notebook_updated: boolean }> => {
    const response = await api.post(`/api/conversations/${conversationId}/exit`);
    return response.data;
  },
};

// 塔罗相关API
export const tarotApi = {
  sendMessage: async (
    conversationId: string,
    content: string,
    onChunk: (chunk: string) => void,
    onDrawCards: (instruction: DrawCardsRequest) => void,
    onNeedProfile?: (instruction: any) => void,
    onFetchChart?: (instruction: any) => void
  ): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/api/tarot/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        content,
      }),
    });

    if (!response.ok) {
      throw new Error('发送消息失败');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              onChunk(parsed.content);
            } else if (parsed.draw_cards) {
              console.log('[Frontend SSE] 收到抽牌指令:', parsed.draw_cards);
              console.log('[Frontend SSE] parsed.draw_cards.spread_type:', parsed.draw_cards.spread_type);
              console.log('[Frontend SSE] parsed.draw_cards.card_count:', parsed.draw_cards.card_count);
              console.log('[Frontend SSE] parsed.draw_cards.positions:', parsed.draw_cards.positions);
              onDrawCards(parsed.draw_cards);
            } else if (parsed.need_profile && onNeedProfile) {
              onNeedProfile(parsed.need_profile);
            } else if (parsed.fetch_chart && onFetchChart) {
              onFetchChart(parsed.fetch_chart);
            }
          } catch (e) {
            console.error('解析SSE数据失败:', e);
          }
        }
      }
    }
  },

  drawCards: async (
    conversationId: string,
    drawRequest: DrawCardsRequest
  ): Promise<TarotCard[]> => {
    console.log('[Frontend API] 发送抽牌请求:');
    console.log('[Frontend API] conversationId:', conversationId);
    console.log('[Frontend API] drawRequest:', drawRequest);
    console.log('[Frontend API] drawRequest.spread_type:', drawRequest.spread_type);
    console.log('[Frontend API] drawRequest.card_count:', drawRequest.card_count);
    console.log('[Frontend API] drawRequest.positions:', drawRequest.positions);
    
    const response = await api.post('/api/tarot/draw', drawRequest, {
      params: { conversation_id: conversationId },
    });
    return response.data.cards;
  },

  getAllCards: async (): Promise<string[]> => {
    const response = await api.get('/api/tarot/cards');
    return response.data;
  },
};

// 星盘相关API
export const astrologyApi = {
  sendMessage: async (
    conversationId: string,
    content: string,
    onChunk: (chunk: string) => void,
    onNeedProfile?: (instruction: any) => void,
    onFetchChart?: (instruction: any) => void,
    onDrawCards?: (instruction: DrawCardsRequest) => void
  ): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/api/astrology/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        content,
      }),
    });

    if (!response.ok) {
      throw new Error('发送消息失败');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              onChunk(parsed.content);
            } else if (parsed.need_profile && onNeedProfile) {
              onNeedProfile(parsed.need_profile);
            } else if (parsed.fetch_chart && onFetchChart) {
              onFetchChart(parsed.fetch_chart);
            } else if (parsed.draw_cards && onDrawCards) {
              onDrawCards(parsed.draw_cards);
            }
          } catch (e) {
            console.error('解析SSE数据失败:', e);
          }
        }
      }
    }
  },

  checkProfile: async (userId: string): Promise<{
    has_complete_profile: boolean;
    missing_fields: string[];
    profile?: UserProfile;
  }> => {
    const response = await api.get(`/api/astrology/check-profile/${userId}`);
    return response.data;
  },

  fetchChart: async (conversationId: string): Promise<{
    success: boolean;
    chart_text: string;
  }> => {
    const response = await api.post('/api/astrology/fetch-chart', null, {
      params: { conversation_id: conversationId },
    });
    return response.data;
  },

  getCurrentZodiac: async (): Promise<{ zodiac: string }> => {
    const response = await api.get('/api/astrology/current-zodiac');
    return response.data;
  },

  drawCards: async (
    conversationId: string,
    drawRequest: DrawCardsRequest
  ): Promise<TarotCard[]> => {
    console.log('[Frontend API] 发送星座AI抽牌请求:');
    console.log('[Frontend API] conversationId:', conversationId);
    console.log('[Frontend API] drawRequest:', drawRequest);
    console.log('[Frontend API] drawRequest.spread_type:', drawRequest.spread_type);
    console.log('[Frontend API] drawRequest.card_count:', drawRequest.card_count);
    console.log('[Frontend API] drawRequest.positions:', drawRequest.positions);
    
    const response = await api.post('/api/astrology/draw', drawRequest, {
      params: { conversation_id: conversationId },
    });
    return response.data.cards;
  },
};

// ── 牌组商城 / 钱包 / 支付 ──────────────────────────────────────────────────────
export interface WalletDTO {
  user_id: string;
  balance: number;
  owned_deck_ids: string[];
  active_deck_id: string;
  updated_at: string;
}

export interface PurchaseResultDTO {
  success: boolean;
  reason?: string | null;
  wallet: WalletDTO;
}

export interface StoreDeckDTO {
  id: string;
  name: string;
  price: number;
  state: string;
  completed?: number | null;
  accent?: string | null;
  live_deck_id?: string | null;
}

export interface StorePackageDTO {
  id: string;
  stardust: number;
  bonus: number;
  price_cents: number;
  tag?: string | null;
}

export interface PayInstructionDTO {
  type: string;                       // qr | redirect | jsapi | mock
  qr_code?: string | null;
  redirect_url?: string | null;
  params?: Record<string, unknown> | null;
  mock_pay_url?: string | null;
}

export interface TopUpResponseDTO {
  order_id: string;
  out_trade_no: string;
  status: string;
  amount: number;                     // 人民币（分）
  provider: string;
  method: string;
  pay: PayInstructionDTO;
}

export interface PaymentOrderDTO {
  order_id: string;
  status: string;                     // pending | paid | failed | expired
  amount: number;
  credited: boolean;
  stardust: number;
  bonus: number;
}

export const walletApi = {
  get: async (userId: string): Promise<WalletDTO> => {
    const r = await api.get(`/api/wallet/${userId}`);
    return r.data;
  },
  purchase: async (userId: string, deckId: string): Promise<PurchaseResultDTO> => {
    const r = await api.post(`/api/wallet/${userId}/purchase`, { deck_id: deckId });
    return r.data;
  },
  setActiveDeck: async (userId: string, deckId: string): Promise<PurchaseResultDTO> => {
    const r = await api.post(`/api/wallet/${userId}/active-deck`, { deck_id: deckId });
    return r.data;
  },
};

export const storeApi = {
  catalog: async (): Promise<StoreDeckDTO[]> => {
    const r = await api.get('/api/store/catalog');
    return r.data.decks;
  },
  packages: async (): Promise<StorePackageDTO[]> => {
    const r = await api.get('/api/store/packages');
    return r.data.packages;
  },
};

export const paymentsApi = {
  topup: async (body: { user_id: string; package_id: string; provider?: string; method?: string }): Promise<TopUpResponseDTO> => {
    const r = await api.post('/api/payments/topup', body);
    return r.data;
  },
  getOrder: async (orderId: string): Promise<PaymentOrderDTO> => {
    const r = await api.get(`/api/payments/order/${orderId}`);
    return r.data;
  },
  mockPay: async (orderId: string): Promise<PaymentOrderDTO> => {
    const r = await api.post(`/api/payments/mock/pay/${orderId}`);
    return r.data;
  },
};

// ── 每日一签 ──────────────────────────────────────────────────────
export const dailyApi = {
  overview: async (userId: string, date: string): Promise<DailyOverview> => {
    const r = await api.get(`/api/daily/${userId}/overview`, { params: { date } });
    return r.data;
  },

  draw: async (
    userId: string,
    effectiveDate: string
  ): Promise<{ record: DailyDrawRecord; conversation_id: string }> => {
    const r = await api.post(`/api/daily/${userId}/draw`, { effective_date: effectiveDate });
    return r.data;
  },

  feedback: async (
    userId: string,
    effectiveDate: string,
    verdict: 'hit' | 'miss',
    note?: string
  ): Promise<DailyDrawRecord> => {
    const r = await api.post(`/api/daily/${userId}/feedback`, {
      effective_date: effectiveDate,
      verdict,
      note: note || null,
    });
    return r.data;
  },

  /** 心灵奇旅(SSE 流式;解析方式与 tarotApi.sendMessage 一致) */
  journey: async (
    userId: string,
    date: string,
    force: boolean,
    onChunk: (chunk: string) => void
  ): Promise<void> => {
    const response = await fetch(
      `${API_BASE_URL}/api/daily/${userId}/journey?date=${date}&force=${force}`,
      { method: 'POST' }
    );
    if (!response.ok) {
      const err = new Error('旅程生成失败') as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) onChunk(parsed.content);
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    }
  },
};

export default api;
