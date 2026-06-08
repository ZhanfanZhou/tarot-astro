import React from 'react';
import { motion } from 'framer-motion';
import { StoreDeck } from '../../data/storeDecks';
import { useDeckWallet } from '../../stores/useDeckWallet';
import { duotoneOverlay, badgeFor } from './coverArt';
import DeckTile from './DeckTile';

interface StorefrontViewProps {
  decks: StoreDeck[];
  onOpenDeck: (d: StoreDeck) => void;
  onEnterDeck: (liveDeckId: string) => void;
}

export default function StorefrontView({ decks, onOpenDeck, onEnterDeck }: StorefrontViewProps) {
  // 订阅 ownedDeckIds，购买后整页重渲染。
  const ownedIds = useDeckWallet((s) => s.ownedDeckIds);
  const hero = decks.find((d) => d.featured) ?? decks[0];
  const rest = decks.filter((d) => d.id !== hero.id);
  const heroOwned = ownedIds.includes(hero.id);
  const heroBadge = badgeFor(hero, heroOwned);

  return (
    <div className="ds-store">
      {/* 精选 Hero */}
      <motion.div
        className="ds-hero"
        style={{ '--accent': hero.accent } as React.CSSProperties}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="ds-hero-cover">
          <div className="ds-hero-fan">
            {hero.previewCards.slice(0, 5).map((src, i, arr) => {
              const mid = (arr.length - 1) / 2;
              const off = i - mid;
              return (
                <span
                  key={src}
                  className="ds-hero-card"
                  style={{
                    marginLeft: i ? -30 : 0,
                    transform: `rotate(${off * 8}deg) translateY(${Math.abs(off) * 8}px)`,
                    zIndex: 10 - Math.abs(off),
                  }}
                >
                  <img src={src} alt="" onError={(e) => { e.currentTarget.style.opacity = '0'; }} />
                </span>
              );
            })}
          </div>
          <div className="ds-hero-tint" style={duotoneOverlay(hero)} />
        </div>
        <div className="ds-hero-info">
          <span className="ds-eyebrow">FEATURED · 精选</span>
          <h2 className="ds-hero-name">{hero.name}</h2>
          <p className="ds-hero-tagline">{hero.tagline}</p>
          <p className="ds-meta">{hero.artist} · {hero.style}</p>
          <span
            className="ds-badge"
            style={{ color: heroBadge.fg, background: heroBadge.bg, borderColor: heroBadge.border }}
          >
            {heroBadge.label}
          </span>
          <div className="ds-hero-actions">
            {heroOwned && hero.liveDeckId ? (
              <button className="ds-cta" onClick={() => onEnterDeck(hero.liveDeckId!)}>进入牌廊 ›</button>
            ) : (
              <button className="ds-cta" onClick={() => onOpenDeck(hero)}>查看牌组 ›</button>
            )}
          </div>
        </div>
      </motion.div>

      {/* 牌组网格 */}
      <div className="ds-grid">
        {rest.map((d, i) => (
          <DeckTile key={d.id} deck={d} owned={ownedIds.includes(d.id)} index={i} onClick={() => onOpenDeck(d)} />
        ))}
      </div>
    </div>
  );
}
