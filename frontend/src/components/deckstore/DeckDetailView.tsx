import React from 'react';
import { StoreDeck } from '../../data/storeDecks';
import { useDeckWallet } from '../../stores/useDeckWallet';
import { duotoneOverlay, proceduralCover, badgeFor, ctaFor } from './coverArt';
import { toast } from '../../stores/useToastStore';

interface DeckDetailViewProps {
  deck: StoreDeck;
  onBuy: () => void;
  onEnterDeck: (liveDeckId: string) => void;
}

export default function DeckDetailView({ deck, onBuy, onEnterDeck }: DeckDetailViewProps) {
  const ownedIds = useDeckWallet((s) => s.ownedDeckIds);
  const owned = ownedIds.includes(deck.id);
  const badge = badgeFor(deck, owned);
  const cta = ctaFor(deck, owned);
  const hasArt = deck.previewCards.length > 0;
  // partial 牌组：预览条在已完成卡之后补几个「设计中」占位。
  const placeholders = deck.state === 'partial' ? 3 : 0;

  const handleCta = () => {
    if (cta.kind === 'enter') { onEnterDeck(deck.liveDeckId!); return; }
    if (cta.kind === 'buy') { onBuy(); return; }
    toast.info(owned ? '该牌组即将上线，敬请期待 ✦' : '已记录，上线时第一时间通知你 ✦');
  };

  return (
    <div className="ds-detail" style={{ '--accent': deck.accent } as React.CSSProperties}>
      <div className="ds-detail-left">
        <div className="ds-detail-cover" style={!hasArt ? proceduralCover(deck) : undefined}>
          {hasArt ? (
            <>
              <img src={deck.previewCards[0]} alt={deck.name} onError={(e) => { e.currentTarget.style.opacity = '0'; }} />
              <div className="ds-tile-tint" style={duotoneOverlay(deck)} />
            </>
          ) : (
            <span className="ds-detail-lock">✦</span>
          )}
        </div>
        {hasArt && (
          <div className="ds-detail-strip">
            {deck.previewCards.map((src) => (
              <span key={src} className="ds-detail-thumb">
                <img src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.opacity = '0'; }} />
                <div className="ds-tile-tint" style={duotoneOverlay(deck)} />
              </span>
            ))}
            {Array.from({ length: placeholders }).map((_, i) => (
              <span key={`ph-${i}`} className="ds-detail-thumb ds-detail-thumb-todo">设计中</span>
            ))}
          </div>
        )}
      </div>

      <div className="ds-detail-info">
        <span className="ds-eyebrow">{deck.style}</span>
        <h2 className="ds-detail-name">{deck.name}</h2>
        <span className="ds-badge" style={{ color: badge.fg, background: badge.bg, borderColor: badge.border }}>
          {badge.label}
        </span>
        <p className="ds-detail-desc">{deck.description}</p>
        <p className="ds-meta">绘者 {deck.artist}</p>
        {deck.state === 'partial' && (
          <div className="ds-progress">
            <div className="ds-progress-bar">
              <div className="ds-progress-fill" style={{ width: `${Math.round(((deck.completed ?? 0) / 78) * 100)}%` }} />
            </div>
            <span className="ds-progress-label">{deck.completed}/78 已绘制</span>
          </div>
        )}
        <button className="ds-cta ds-cta-lg" onClick={handleCta}>{cta.label}</button>
      </div>
    </div>
  );
}
