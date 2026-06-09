import React, { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { StoreDeck } from '../../data/storeDecks';
import { useDeckWallet } from '../../stores/useDeckWallet';
import { duotoneOverlay, proceduralCover, badgeFor, ctaFor } from './coverArt';
import { ALL_CARD_IMAGES } from '../../data/deckCardImages';
import { toast } from '../../stores/useToastStore';
import CardZoomLightbox from './CardZoomLightbox';

interface DeckDetailViewProps {
  deck: StoreDeck;
  onBuy: () => void;
  onEnterDeck: (liveDeckId: string) => void;
}

export default function DeckDetailView({ deck, onBuy, onEnterDeck }: DeckDetailViewProps) {
  const ownedIds = useDeckWallet((s) => s.ownedDeckIds);
  const activeDeckId = useDeckWallet((s) => s.activeDeckId);
  const setActiveDeck = useDeckWallet((s) => s.setActiveDeck);
  const owned = ownedIds.includes(deck.id);
  const isActive = activeDeckId === deck.id;
  const badge = badgeFor(deck, owned);
  const cta = ctaFor(deck, owned);

  const applyDeck = async () => {
    const { success, reason } = await setActiveDeck(deck.id);
    if (success) toast.success(`已将「${deck.name}」应用到占卜`);
    else toast.error(reason === 'not_owned' ? '尚未拥有该牌组' : '应用失败，请重试');
  };
  const hasArt = deck.previewCards.length > 0;
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);

  // 可浏览卡牌：coming-soon → 无；available/owned → 全部；partial → 前 completed 张
  // 已绘制（可点开放大），其余显示「设计中」占位。
  const total = ALL_CARD_IMAGES.length;
  const browsable = deck.state === 'coming-soon' ? [] : ALL_CARD_IMAGES;
  const unlockedCount = deck.state === 'partial' ? Math.min(deck.completed ?? 0, total) : browsable.length;
  const unlocked = browsable.slice(0, unlockedCount);
  const tint = duotoneOverlay(deck);

  const handleCta = () => {
    if (cta.kind === 'enter') { onEnterDeck(deck.liveDeckId!); return; }
    if (cta.kind === 'buy') { onBuy(); return; }
    toast.info(owned ? '该牌组即将上线，敬请期待 ✦' : '已记录，上线时第一时间通知你 ✦');
  };

  return (
    <div className="ds-detail" style={{ '--accent': deck.accent } as React.CSSProperties}>
      <div className="ds-detail-head">
        <div className="ds-detail-cover" style={!hasArt ? proceduralCover(deck) : undefined}>
          {hasArt ? (
            <>
              <img src={deck.previewCards[0]} alt={deck.name} onError={(e) => { e.currentTarget.style.opacity = '0'; }} />
              <div className="ds-tile-tint" style={tint} />
            </>
          ) : (
            <span className="ds-detail-lock">✦</span>
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
          <div className="ds-detail-actions">
            <button className="ds-cta ds-cta-lg" onClick={handleCta}>{cta.label}</button>
            {owned && (
              isActive
                ? <span className="ds-active-tag">✓ 当前占卜牌组</span>
                : <button className="ds-apply" onClick={applyDeck}>应用到占卜</button>
            )}
          </div>
        </div>
      </div>

      {browsable.length > 0 && (
        <div className="ds-cards">
          <div className="ds-cards-head">
            <span className="ds-cards-title">牌面一览</span>
            <span className="ds-cards-count">
              {deck.state === 'partial' ? `已绘制 ${unlockedCount} 张 · 点击放大` : `${total} 张 · 点击放大`}
            </span>
          </div>
          <div className="ds-cards-grid">
            {browsable.map((card, idx) => {
              const locked = idx >= unlockedCount;
              return (
                <button
                  key={card.id}
                  className={`ds-card-cell ${locked ? 'locked' : ''}`}
                  disabled={locked}
                  onClick={() => { if (!locked) setZoomIndex(idx); }}
                  title={card.name}
                >
                  <div className="ds-card-thumb">
                    <img src={card.thumbUrl} alt={card.name} loading="lazy" onError={(e) => { e.currentTarget.style.opacity = '0'; }} />
                    <div className="ds-tile-tint" style={tint} />
                    {locked && <span className="ds-card-todo">设计中</span>}
                  </div>
                  <span className="ds-card-name">{card.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <AnimatePresence>
        {zoomIndex !== null && (
          <CardZoomLightbox
            cards={unlocked}
            index={zoomIndex}
            tint={tint}
            accent={deck.accent}
            onClose={() => setZoomIndex(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
