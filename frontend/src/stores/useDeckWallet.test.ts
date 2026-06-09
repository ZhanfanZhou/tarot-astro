import { describe, it, expect, beforeEach } from 'vitest';

const LS_KEY = 'tarot.deckWallet';

// useDeckWallet is a module singleton that reads localStorage at import time, so
// each test resets the registry + storage and re-imports for a fresh store.
async function freshWallet() {
  const mod = await import('./useDeckWallet');
  return mod.useDeckWallet;
}

beforeEach(async () => {
  localStorage.clear();
  const { vi } = await import('vitest');
  vi.resetModules();
});

describe('useDeckWallet', () => {
  it('seeds classic-rws as owned and balance 8888', async () => {
    const wallet = await freshWallet();
    const s = wallet.getState();
    expect(s.ownedDeckIds).toContain('classic-rws');
    expect(s.balance).toBe(8888);
  });

  it('purchase deducts balance and adds the deck id', async () => {
    const wallet = await freshWallet();
    const ok = wallet.getState().purchase('lunar-mirage', 1280);
    expect(ok).toBe(true);
    const s = wallet.getState();
    expect(s.balance).toBe(8888 - 1280);
    expect(s.ownedDeckIds).toContain('lunar-mirage');
  });

  it('is idempotent when the deck is already owned (no double charge)', async () => {
    const wallet = await freshWallet();
    wallet.getState().purchase('lunar-mirage', 1280);
    const balanceAfterFirst = wallet.getState().balance;
    const ok = wallet.getState().purchase('lunar-mirage', 1280);
    expect(ok).toBe(true);
    expect(wallet.getState().balance).toBe(balanceAfterFirst);
  });

  it('returns false and does not change state when balance is insufficient', async () => {
    const wallet = await freshWallet();
    const ok = wallet.getState().purchase('pricey', 99999);
    expect(ok).toBe(false);
    const s = wallet.getState();
    expect(s.balance).toBe(8888);
    expect(s.ownedDeckIds).not.toContain('pricey');
  });

  it('topUp increases the balance', async () => {
    const wallet = await freshWallet();
    wallet.getState().topUp(5000);
    expect(wallet.getState().balance).toBe(8888 + 5000);
  });

  it('persists owned ids and balance to localStorage and reloads them', async () => {
    const wallet = await freshWallet();
    wallet.getState().purchase('lunar-mirage', 1280);

    const raw = localStorage.getItem(LS_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.balance).toBe(8888 - 1280);
    expect(parsed.ownedDeckIds).toContain('lunar-mirage');

    // re-import: a fresh store instance must hydrate from localStorage
    const { vi } = await import('vitest');
    vi.resetModules();
    const reloaded = await freshWallet();
    const s = reloaded.getState();
    expect(s.balance).toBe(8888 - 1280);
    expect(s.ownedDeckIds).toContain('lunar-mirage');
    expect(s.ownedDeckIds).toContain('classic-rws');
  });
});
