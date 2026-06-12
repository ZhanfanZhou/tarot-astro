import { describe, expect, it } from 'vitest';
import { getEffectiveDate, isEveningDraw } from './dailyDate';

describe('getEffectiveDate(本地时间,18:00 切日)', () => {
  it('18:00 前算今天', () => {
    expect(getEffectiveDate(new Date(2026, 5, 11, 17, 59))).toBe('2026-06-11');
  });
  it('18:00 起算明天', () => {
    expect(getEffectiveDate(new Date(2026, 5, 11, 18, 0))).toBe('2026-06-12');
  });
  it('跨月进位', () => {
    expect(getEffectiveDate(new Date(2026, 0, 31, 20, 30))).toBe('2026-02-01');
  });
});

describe('isEveningDraw', () => {
  it('18:00 为界', () => {
    expect(isEveningDraw(new Date(2026, 5, 11, 17, 59))).toBe(false);
    expect(isEveningDraw(new Date(2026, 5, 11, 18, 0))).toBe(true);
  });
});
