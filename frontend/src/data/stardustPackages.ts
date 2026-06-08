// Simulated stardust top-up packages. Stardust is the in-app sim currency, so a
// "充值" simply grants stardust (+ a cosmetic bonus on larger tiers) — there is
// no real money beneath it.

export interface StardustPackage {
  id: string;
  stardust: number;
  bonus: number;
  tag?: string;
}

export const STARDUST_PACKAGES: StardustPackage[] = [
  { id: 'starter', stardust: 1000, bonus: 0 },
  { id: 'plus', stardust: 3000, bonus: 200 },
  { id: 'popular', stardust: 6000, bonus: 800, tag: '热门' },
  { id: 'value', stardust: 12000, bonus: 2400, tag: '超值' },
];
