import { describe, it, expect } from 'vitest';
import { ALL_CARD_IMAGES } from './deckCardImages';

function indexOfStem(stem: string): number {
  return ALL_CARD_IMAGES.findIndex((c) => c.id.endsWith(`/${stem}`));
}

describe('ALL_CARD_IMAGES', () => {
  it('contains the full 78-card primary set', () => {
    expect(ALL_CARD_IMAGES).toHaveLength(78);
  });

  it('excludes __alt / __backup variants', () => {
    expect(ALL_CARD_IMAGES.every((c) => !c.id.includes('__'))).toBe(true);
  });

  it('gives every card a thumbUrl and a fullUrl', () => {
    expect(ALL_CARD_IMAGES.every((c) => !!c.thumbUrl && !!c.fullUrl)).toBe(true);
  });

  it('orders major arcana before the minor suits', () => {
    const firstMinor = ALL_CARD_IMAGES.findIndex((c) => c.suit !== 'major');
    const lastMajor = ALL_CARD_IMAGES.map((c) => c.suit).lastIndexOf('major');
    expect(lastMajor).toBeLessThan(firstMinor);
  });

  it('orders major arcana canonically (fool before world)', () => {
    expect(indexOfStem('the-fool')).toBeGreaterThanOrEqual(0);
    expect(indexOfStem('the-fool')).toBeLessThan(indexOfStem('the-world'));
  });

  it('orders minors by rank (ace before king within a suit)', () => {
    expect(indexOfStem('ace-of-cups')).toBeLessThan(indexOfStem('king-of-cups'));
  });
});
