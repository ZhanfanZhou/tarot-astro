import { describe, it, expect } from 'vitest';
import { STARDUST_PACKAGES } from './stardustPackages';

describe('STARDUST_PACKAGES', () => {
  it('offers several packages', () => {
    expect(STARDUST_PACKAGES.length).toBeGreaterThanOrEqual(3);
  });

  it('has positive stardust, non-negative bonus, and unique ids', () => {
    const ids = new Set<string>();
    for (const p of STARDUST_PACKAGES) {
      expect(p.stardust).toBeGreaterThan(0);
      expect(p.bonus).toBeGreaterThanOrEqual(0);
      ids.add(p.id);
    }
    expect(ids.size).toBe(STARDUST_PACKAGES.length);
  });

  it('marks at least one package with a tag', () => {
    expect(STARDUST_PACKAGES.some((p) => !!p.tag)).toBe(true);
  });
});
