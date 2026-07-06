import axios from 'axios';

// 与用户态完全隔离:独立 token key + 独立 axios 实例(只有管理页使用)
const ADMIN_TOKEN_KEY = 'tarot_admin_token';

export const getAdminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY);
export const setAdminToken = (t: string) => localStorage.setItem(ADMIN_TOKEN_KEY, t);
export const clearAdminToken = () => localStorage.removeItem(ADMIN_TOKEN_KEY);

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '' });

api.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error?.response?.status === 401) clearAdminToken();
    return Promise.reject(error);
  }
);

export const errMsg = (e: unknown): string => {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : '请求失败';
};

export const isAuthError = (e: unknown): boolean => {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 401 || status === 403;
};

export interface AdminStats {
  total_users: number;
  guest_users: number;
  registered_users: number;
  total_conversations: number;
  today_new_conversations: number;
  today_messages: number;
}

export interface AdminConvSummary {
  conversation_id: string;
  user_id: string;
  updated_at: string;
  created_at: string;
  session_type: string;
  title: string;
  message_count: number;
  username: string | null;
  nickname: string | null;
  user_type: string | null;
}

export interface AdminMessage {
  role: string;
  content: string;
  timestamp?: string;
  tarot_cards?: Array<{ card_id: number; card_name: string; reversed: boolean }> | null;
}

export interface AdminConversation {
  conversation_id: string;
  user_id: string;
  session_type: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: AdminMessage[];
}

export interface AdminUser {
  user_id: string;
  username: string | null;
  nickname: string | null;
  user_type: string;
  created_at: string;
  conversation_count: number;
  last_active: string | null;
}

export interface AdminUsage {
  date: string;
  entries: Array<{
    user_id: string; used: number;
    username: string | null; nickname: string | null; user_type: string | null;
  }>;
  guest_daily_limit: number;
  user_daily_limit: number;
}

export interface PromptInfo {
  name: string;
  label: string;
  overridden: boolean;
  chars: number;
  updated_at: string | null;
}

export interface PromptDetail extends PromptInfo {
  content: string;
  default_content: string;
}

export const displayName = (u: {
  username?: string | null; nickname?: string | null; user_id: string;
}) => u.nickname || u.username || u.user_id.slice(0, 12);

export const adminApi = {
  login: async (password: string): Promise<string> =>
    (await api.post('/api/admin/login', { password })).data.access_token,
  stats: async (): Promise<AdminStats> => (await api.get('/api/admin/stats')).data,
  conversations: async (params: {
    limit?: number; offset?: number; session_type?: string;
  }): Promise<{ items: AdminConvSummary[]; total: number }> =>
    (await api.get('/api/admin/conversations', { params })).data,
  conversation: async (id: string): Promise<AdminConversation> =>
    (await api.get(`/api/admin/conversations/${id}`)).data,
  users: async (params: { limit?: number; offset?: number }): Promise<{ items: AdminUser[]; total: number }> =>
    (await api.get('/api/admin/users', { params })).data,
  usage: async (): Promise<AdminUsage> => (await api.get('/api/admin/usage')).data,
  prompts: async (): Promise<{ items: PromptInfo[] }> => (await api.get('/api/admin/prompts')).data,
  prompt: async (name: string): Promise<PromptDetail> => (await api.get(`/api/admin/prompts/${name}`)).data,
  savePrompt: async (name: string, content: string): Promise<PromptInfo> =>
    (await api.put(`/api/admin/prompts/${name}`, { content })).data,
  resetPrompt: async (name: string): Promise<PromptInfo> =>
    (await api.delete(`/api/admin/prompts/${name}`)).data,
};
