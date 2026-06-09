import { describe, it, expect, beforeEach, vi } from 'vitest';

// 钱包现在以后端为源。mock walletApi，验证 store 的拉取/缓存/回填行为。
const { getMock, purchaseMock, setActiveMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  purchaseMock: vi.fn(),
  setActiveMock: vi.fn(),
}));

vi.mock('../services/api', () => ({
  walletApi: { get: getMock, purchase: purchaseMock, setActiveDeck: setActiveMock },
}));

import { useDeckWallet } from './useDeckWallet';

const WALLET = {
  user_id: 'u1',
  balance: 8888,
  owned_deck_ids: ['classic-rws'],
  active_deck_id: 'classic-rws',
  updated_at: '',
};

beforeEach(() => {
  getMock.mockReset();
  purchaseMock.mockReset();
  setActiveMock.mockReset();
  useDeckWallet.setState({
    userId: null, balance: 0, ownedDeckIds: [], activeDeckId: 'classic-rws', loaded: false, loading: false,
  });
});

describe('useDeckWallet (backend-backed)', () => {
  it('load fetches the wallet and caches it', async () => {
    getMock.mockResolvedValue(WALLET);
    await useDeckWallet.getState().load('u1');
    const s = useDeckWallet.getState();
    expect(getMock).toHaveBeenCalledWith('u1');
    expect(s.userId).toBe('u1');
    expect(s.balance).toBe(8888);
    expect(s.ownedDeckIds).toContain('classic-rws');
    expect(s.activeDeckId).toBe('classic-rws');
    expect(s.loaded).toBe(true);
  });

  it('purchase applies the returned wallet and reports success', async () => {
    getMock.mockResolvedValue(WALLET);
    await useDeckWallet.getState().load('u1');
    purchaseMock.mockResolvedValue({
      success: true, reason: null,
      wallet: { ...WALLET, balance: 8888 - 1280, owned_deck_ids: ['classic-rws', 'lunar-mirage'] },
    });
    const res = await useDeckWallet.getState().purchase('lunar-mirage');
    expect(res.success).toBe(true);
    const s = useDeckWallet.getState();
    expect(s.balance).toBe(8888 - 1280);
    expect(s.ownedDeckIds).toContain('lunar-mirage');
  });

  it('purchase surfaces the failure reason', async () => {
    getMock.mockResolvedValue(WALLET);
    await useDeckWallet.getState().load('u1');
    purchaseMock.mockResolvedValue({ success: false, reason: 'insufficient_balance', wallet: WALLET });
    const res = await useDeckWallet.getState().purchase('pricey');
    expect(res.success).toBe(false);
    expect(res.reason).toBe('insufficient_balance');
  });

  it('purchase without a user does not hit the API', async () => {
    const res = await useDeckWallet.getState().purchase('x');
    expect(res.success).toBe(false);
    expect(purchaseMock).not.toHaveBeenCalled();
  });

  it('setActiveDeck updates activeDeckId from the response', async () => {
    getMock.mockResolvedValue(WALLET);
    await useDeckWallet.getState().load('u1');
    setActiveMock.mockResolvedValue({
      success: true, reason: null,
      wallet: { ...WALLET, active_deck_id: 'lunar-mirage', owned_deck_ids: ['classic-rws', 'lunar-mirage'] },
    });
    const res = await useDeckWallet.getState().setActiveDeck('lunar-mirage');
    expect(res.success).toBe(true);
    expect(useDeckWallet.getState().activeDeckId).toBe('lunar-mirage');
  });
});
