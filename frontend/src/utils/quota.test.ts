import { describe, it, expect } from 'vitest';
import { energyPercent } from './quota';

describe('energyPercent', () => {
  it('is the share of today’s quota still left, rounded', () => {
    expect(energyPercent({ used: 0, limit: 15 })).toBe(100);
    expect(energyPercent({ used: 3, limit: 15 })).toBe(80);
    expect(energyPercent({ used: 14, limit: 15 })).toBe(7);
    expect(energyPercent({ used: 1, limit: 50 })).toBe(98);
    expect(energyPercent({ used: 15, limit: 15 })).toBe(0);
  });

  it('stays at 0 when uncapped calls push used past the limit', () => {
    expect(energyPercent({ used: 17, limit: 15 })).toBe(0);
  });
});
