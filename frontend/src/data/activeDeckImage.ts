import type { CSSProperties } from 'react';
import { STORE_DECKS } from './storeDecks';
import { hexA } from '../components/deckstore/coverArt';

export interface ResolvedCardImage {
  src: string;
  tint: CSSProperties | null;  // 占位牌组的 duotone 叠加层样式；null = 无叠加
}

// 把 classic-rws 的卡面图按「当前应用牌组」(active_deck_id) 解析。
// - classic-rws：原图。
// - 有自己图片目录的真实牌组：把路径里的 classic-rws 换成该牌组 id。
// - 占位牌组（暂无真实美术）：沿用 classic-rws 图，叠加该牌组 accent 的 duotone。
export function resolveActiveCardImage(classicUrl: string, activeDeckId: string): ResolvedCardImage {
  if (!activeDeckId || activeDeckId === 'classic-rws') return { src: classicUrl, tint: null };
  const deck = STORE_DECKS.find((d) => d.id === activeDeckId);
  if (deck?.liveDeckId && deck.liveDeckId !== 'classic-rws') {
    return { src: classicUrl.replace('/classic-rws/', `/${deck.liveDeckId}/`), tint: null };
  }
  const accent = deck?.accent ?? '#C9A96E';
  return { src: classicUrl, tint: { background: hexA(accent, 0.45), mixBlendMode: 'color' } };
}
