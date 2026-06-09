import { create } from 'zustand';
import { walletApi } from '../services/api';

// 后端是钱包的唯一可信来源（余额 / 已拥有牌组 / 当前应用牌组）。本 store 只做
// 「拉取一次 + 缓存 + 变更后回填」。不再用 localStorage 种子，避免双源不一致。

interface WalletState {
  userId: string | null;
  balance: number;
  ownedDeckIds: string[];
  activeDeckId: string;
  loaded: boolean;
  loading: boolean;
  /** 按 user_id 拉取钱包（用户就绪时调用一次；user_id 变化时重新拉取）。*/
  load: (userId: string) => Promise<void>;
  /** 重新拉取当前用户钱包（如充值到账后）。*/
  refresh: () => Promise<void>;
  /** 用星尘解锁牌组；success=false 时 reason ∈ insufficient_balance / not_purchasable / ...。*/
  purchase: (deckId: string) => Promise<{ success: boolean; reason?: string }>;
  /** 应用牌组到实际占卜（须已拥有）。*/
  setActiveDeck: (deckId: string) => Promise<{ success: boolean; reason?: string }>;
}

function applyWallet(set: (p: Partial<WalletState>) => void, w: { balance: number; owned_deck_ids: string[]; active_deck_id: string }) {
  set({ balance: w.balance, ownedDeckIds: w.owned_deck_ids, activeDeckId: w.active_deck_id });
}

export const useDeckWallet = create<WalletState>((set, get) => ({
  userId: null,
  balance: 0,
  ownedDeckIds: [],
  activeDeckId: 'classic-rws',
  loaded: false,
  loading: false,

  load: async (userId) => {
    if (get().loading) return;
    set({ userId, loading: true });
    try {
      const w = await walletApi.get(userId);
      applyWallet(set, w);
      set({ loaded: true });
    } catch {
      // 后端不可达：保持空钱包，loaded 仍置 true 以免无限重试
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  refresh: async () => {
    const { userId } = get();
    if (!userId) return;
    try {
      const w = await walletApi.get(userId);
      applyWallet(set, w);
    } catch {
      /* 忽略瞬时失败 */
    }
  },

  purchase: async (deckId) => {
    const { userId } = get();
    if (!userId) return { success: false, reason: 'no_user' };
    const res = await walletApi.purchase(userId, deckId);
    if (res.wallet) applyWallet(set, res.wallet);
    return { success: res.success, reason: res.reason ?? undefined };
  },

  setActiveDeck: async (deckId) => {
    const { userId } = get();
    if (!userId) return { success: false, reason: 'no_user' };
    const res = await walletApi.setActiveDeck(userId, deckId);
    if (res.wallet) applyWallet(set, res.wallet);
    return { success: res.success, reason: res.reason ?? undefined };
  },
}));
