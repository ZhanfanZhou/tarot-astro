import axios from 'axios';
import type {
  User,
  UserProfile,
  Conversation,
  SessionType,
  TarotCard,
  DrawCardsRequest,
} from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 用户相关API
export const userApi = {
  createGuest: async (profile?: UserProfile): Promise<User> => {
    const response = await api.post('/api/users/guest', profile);
    return response.data;
  },

  register: async (username: string, password: string, profile?: UserProfile): Promise<User> => {
    const response = await api.post('/api/users/register', {
      username,
      password,
      profile,
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
};

// 塔罗相关API
export const tarotApi = {
  sendMessage: async (
    conversationId: string,
    content: string,
    onChunk: (chunk: string) => void,
    onDrawCards: (instruction: DrawCardsRequest) => void
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
              onDrawCards(parsed.draw_cards);
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
    onFetchChart?: (instruction: any) => void
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
};

export default api;




