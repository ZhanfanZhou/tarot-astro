import { create } from 'zustand';

const LS_KEY = 'tarot.deckWallet';
const SEED_OWNED = ['classic-rws']; // classic-rws 作为已拥有锚点
const SEED_BALANCE = 8888;          // 星尘初始余额，充足以保证默认结账成功

interface Persisted {
  ownedDeckIds: string[];
  balance: number;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      return {
        ownedDeckIds: Array.from(new Set([...SEED_OWNED, ...(p.ownedDeckIds ?? [])])),
        balance: typeof p.balance === 'number' ? p.balance : SEED_BALANCE,
      };
    }
  } catch {
    /* 忽略损坏的存储 */
  }
  return { ownedDeckIds: [...SEED_OWNED], balance: SEED_BALANCE };
}

function save(p: Persisted) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}

interface WalletState {
  ownedDeckIds: string[];
  balance: number;
  purchase: (id: string, price: number) => boolean; // false = 余额不足
  topUp: (amount: number) => void;
}

export const useDeckWallet = create<WalletState>((set, get) => {
  const initial = load();
  return {
    ownedDeckIds: initial.ownedDeckIds,
    balance: initial.balance,
    purchase: (id, price) => {
      const s = get();
      if (s.ownedDeckIds.includes(id)) return true; // 已拥有，幂等
      if (s.balance < price) return false;
      const next: Persisted = {
        ownedDeckIds: [...s.ownedDeckIds, id],
        balance: s.balance - price,
      };
      save(next);
      set(next);
      return true;
    },
    topUp: (amount) => {
      const s = get();
      const next: Persisted = { ownedDeckIds: s.ownedDeckIds, balance: s.balance + amount };
      save(next);
      set({ balance: next.balance });
    },
  };
});
