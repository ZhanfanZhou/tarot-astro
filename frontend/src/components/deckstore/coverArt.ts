import React from 'react';
import { StoreDeck } from '../../data/storeDecks';

// hex(#rrggbb) → rgba 字符串
export function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 复用 classic-rws 图时叠加的 per-accent duotone 着色层；
// classic-rws（真实牌组，金色）不着色，保持原貌。
export function duotoneOverlay(deck: StoreDeck): React.CSSProperties {
  if (deck.id === 'classic-rws') return { background: 'transparent' };
  return { background: hexA(deck.accent, 0.55), mixBlendMode: 'color' };
}

// 无预览图的牌组（coming-soon）的程序化封面。
export function proceduralCover(deck: StoreDeck): React.CSSProperties {
  return {
    background: `radial-gradient(120% 80% at 50% 0%, ${hexA(deck.accent, 0.3)} 0%, rgba(10,10,22,0.92) 70%)`,
  };
}

export interface Badge {
  label: string;
  fg: string;
  bg: string;
  border: string;
}

// 状态徽章：已拥有优先，其次按 state。
export function badgeFor(deck: StoreDeck, owned: boolean): Badge {
  if (owned) return { label: '✓ 已拥有', fg: '#0e0e1a', bg: '#C9A96E', border: '#C9A96E' };
  switch (deck.state) {
    case 'partial':
      return {
        label: `设计中 · ${deck.completed ?? 0}/78`,
        fg: hexA(deck.accent, 0.95),
        bg: hexA(deck.accent, 0.12),
        border: hexA(deck.accent, 0.5),
      };
    case 'coming-soon':
      return {
        label: '即将上架',
        fg: 'rgba(237,230,214,0.7)',
        bg: 'rgba(255,255,255,0.05)',
        border: 'rgba(255,255,255,0.15)',
      };
    default:
      return {
        label: '可获取',
        fg: hexA(deck.accent, 0.95),
        bg: hexA(deck.accent, 0.12),
        border: hexA(deck.accent, 0.5),
      };
  }
}

export type CtaKind = 'enter' | 'buy' | 'notify';

// 主 CTA 的文案 + 行为类型。owned 但无 liveDeckId（占位牌组买后）→ notify。
export function ctaFor(deck: StoreDeck, owned: boolean): { label: string; kind: CtaKind } {
  if (owned) return deck.liveDeckId ? { label: '进入牌廊 ›', kind: 'enter' } : { label: '已拥有', kind: 'notify' };
  if (deck.state === 'coming-soon') return { label: '通知我', kind: 'notify' };
  if (deck.state === 'partial') return { label: `抢先获取 · ${deck.price} ✦`, kind: 'buy' };
  return { label: `获取 · ${deck.price} ✦`, kind: 'buy' };
}
