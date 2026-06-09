import { describe, it, expect } from 'vitest';
import { hexA, badgeFor, ctaFor } from './coverArt';
import { StoreDeck, DeckState } from '../../data/storeDecks';

function deck(overrides: Partial<StoreDeck> = {}): StoreDeck {
  return {
    id: 'demo',
    name: 'Demo',
    tagline: '',
    artist: '',
    style: '',
    description: '',
    price: 1000,
    accent: '#A8D8EA',
    state: 'available' as DeckState,
    previewCards: [],
    ...overrides,
  };
}

describe('hexA', () => {
  it('formats a 6-digit hex as rgba', () => {
    expect(hexA('#C9A96E', 0.5)).toBe('rgba(201, 169, 110, 0.5)');
  });
});

describe('badgeFor', () => {
  it('marks owned decks regardless of state', () => {
    expect(badgeFor(deck(), true).label).toBe('✓ 已拥有');
  });
  it('labels available decks', () => {
    expect(badgeFor(deck({ state: 'available' }), false).label).toBe('可获取');
  });
  it('shows progress for partial decks', () => {
    expect(badgeFor(deck({ state: 'partial', completed: 32 }), false).label).toBe('设计中 · 32/78');
  });
  it('labels coming-soon decks', () => {
    expect(badgeFor(deck({ state: 'coming-soon' }), false).label).toBe('即将上架');
  });
});

describe('ctaFor', () => {
  it('enters the gallery for an owned deck with a live id', () => {
    expect(ctaFor(deck({ liveDeckId: 'classic-rws' }), true).kind).toBe('enter');
  });
  it('notifies for an owned deck without a live id', () => {
    expect(ctaFor(deck({ liveDeckId: undefined }), true).kind).toBe('notify');
  });
  it('notifies for a coming-soon deck', () => {
    expect(ctaFor(deck({ state: 'coming-soon' }), false).kind).toBe('notify');
  });
  it('buys an available deck', () => {
    expect(ctaFor(deck({ state: 'available' }), false).kind).toBe('buy');
  });
  it('buys (early access) a partial deck', () => {
    expect(ctaFor(deck({ state: 'partial', completed: 10 }), false).kind).toBe('buy');
  });
});
