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
  JourneyList,
} from '@/types';
import { useAuthStore } from '@/stores/useAuthStore';

// 默认使用同源路径，开发环境下由 Vite 代理转发到后端，避免跨域与预检请求
// 如需直连后端，请在 .env 中设置 VITE_API_URL
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 每个请求自动带上 Bearer token（身份由后端从 token 解析，前端不再可冒充）
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

// token 失效（401）统一登出 —— 触发重新登录弹窗；也用于平滑迁移旧的无 token 会话
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error?.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

// 登录/注册/游客创建的统一返回
export interface AuthResponse {
  user: User;
  access_token: string;
  token_type: string;
}

/** 流式接口用原生 fetch，不走 axios 拦截器，这里手动拼 Authorization */
const authHeaders = (): Record<string, string> => {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** 统一处理流式接口的非 2xx：取出后端 detail；401 顺带登出 */
const streamError = async (response: Response): Promise<Error & { status?: number }> => {
  let detail = '请求失败';
  try {
    const j = await response.json();
    if (j?.detail) detail = j.detail;
  } catch {
    /* 非 JSON 响应，沿用默认文案 */
  }
  if (response.status === 401) useAuthStore.getState().logout();
  const err = new Error(detail) as Error & { status?: number };
  err.status = response.status;
  return err;
};

// 用户相关API
export const userApi = {
  createGuest: async (profile?: UserProfile): Promise<AuthResponse> => {
    const response = await api.post('/api/users/guest', profile || {});
    return response.data;
  },

  register: async (username: string, password: string, profile?: UserProfile): Promise<AuthResponse> => {
    const response = await api.post('/api/users/register', {
      username,
      password,
      ...(profile ? { profile } : {}),  // Only include profile if it's defined
    });
    return response.data;
  },

  login: async (username: string, password: string): Promise<AuthResponse> => {
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

  convertGuestToRegistered: async (userId: string, username: string, password: string): Promise<AuthResponse> => {
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

  /** 迁移旧会话：localStorage 有 user 但无 token 时，用 user_id 静默换取 token */
  migrateToken: async (userId: string): Promise<AuthResponse> => {
    const response = await api.post(`/api/users/${userId}/token`);
    return response.data;
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

  /**
   * 开场白：建完会话单独取。后端整段生成好才进流，所以这里的等待就是模型在想——
   * 和跑一轮回复用同一套流式管线（思考气泡 → 逐块出字）。
   */
  greeting: (conversationId: string, onChunk: (chunk: string) => void): Promise<void> =>
    streamTurn(`${API_BASE_URL}/api/conversations/${conversationId}/greeting`, {}, onChunk),

  exit: async (conversationId: string): Promise<{ notebook_updated: boolean }> => {
    const response = await api.post(`/api/conversations/${conversationId}/exit`);
    return response.data;
  },
};

/**
 * 跑一轮并把正文流式交给 onChunk。body 只有两种形状：
 *   {conversation_id, content}  —— 用户说了一句话（/message）
 *   {conversation_id}           —— 用户在界面上做完了动作（抽完牌 / 填完资料），请接着跑（/resume）
 * 流里只有正文。要不要显示抽牌/补资料按钮，看刷新后会话末尾那条记录的 tool_calls。
 */
async function streamTurn(url: string, body: object, onChunk: (chunk: string) => void): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await streamError(response);
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
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      const parsed = JSON.parse(data);
      if (parsed.content) onChunk(parsed.content);
    }
  }
}

async function drawCards(prefix: string, conversationId: string, drawRequest: DrawCardsRequest): Promise<TarotCard[]> {
  const response = await api.post(`/api/${prefix}/draw`, drawRequest, {
    params: { conversation_id: conversationId },
  });
  return response.data.cards;
}

// 塔罗相关API（/message 与 /resume 两条路径下，塔罗与占星的后端逻辑相同；会话类型由会话本身决定）
export const tarotApi = {
  sendMessage: (conversationId: string, content: string, onChunk: (chunk: string) => void): Promise<void> =>
    streamTurn(`${API_BASE_URL}/api/tarot/message`, { conversation_id: conversationId, content }, onChunk),

  /** 用户抽完牌/填完资料，请模型接着跑。不产生用户消息。 */
  resume: (conversationId: string, onChunk: (chunk: string) => void): Promise<void> =>
    streamTurn(`${API_BASE_URL}/api/tarot/resume`, { conversation_id: conversationId }, onChunk),

  drawCards: (conversationId: string, drawRequest: DrawCardsRequest) =>
    drawCards('tarot', conversationId, drawRequest),

  getAllCards: async (): Promise<string[]> => {
    const response = await api.get('/api/tarot/cards');
    return response.data;
  },
};

// 星盘相关API
export const astrologyApi = {
  sendMessage: (conversationId: string, content: string, onChunk: (chunk: string) => void): Promise<void> =>
    streamTurn(`${API_BASE_URL}/api/astrology/message`, { conversation_id: conversationId, content }, onChunk),

  resume: (conversationId: string, onChunk: (chunk: string) => void): Promise<void> =>
    streamTurn(`${API_BASE_URL}/api/astrology/resume`, { conversation_id: conversationId }, onChunk),

  drawCards: (conversationId: string, drawRequest: DrawCardsRequest) =>
    drawCards('astrology', conversationId, drawRequest),

  checkProfile: async (userId: string): Promise<{
    has_complete_profile: boolean;
    missing_fields: string[];
    profile?: UserProfile;
  }> => {
    const response = await api.get(`/api/astrology/check-profile/${userId}`);
    return response.data;
  },

  getCurrentZodiac: async (): Promise<{ zodiac: string }> => {
    const response = await api.get('/api/astrology/current-zodiac');
    return response.data;
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
  ): Promise<{ record: DailyDrawRecord; conversation_id: string; reading: string }> => {
    // 今日解读在抽签时由服务端直接生成，随响应返回
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

  /** 写过的心灵奇旅(新→旧)+ 能不能再写一篇 + 今天的记录归没归档 */
  journeys: async (userId: string, date: string): Promise<JourneyList> => {
    const r = await api.get(`/api/daily/${userId}/journeys`, { params: { date } });
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
      { method: 'POST', headers: { ...authHeaders() } }
    );
    if (!response.ok) {
      throw await streamError(response);
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
