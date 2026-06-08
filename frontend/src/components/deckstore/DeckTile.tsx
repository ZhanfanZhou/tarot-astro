import React from 'react';
import { motion } from 'framer-motion';
import { StoreDeck } from '../../data/storeDecks';
import { duotoneOverlay, proceduralCover, badgeFor } from './coverArt';

interface DeckTileProps {
  deck: StoreDeck;
  owned: boolean;
  index: number;
  onClick: () => void;
}

export default function DeckTile({ deck, owned, index, onClick }: DeckTileProps) {
  const badge = badgeFor(deck, owned);
  const hasArt = deck.previewCards.length > 0;

  return (
    <motion.button
      className="ds-tile"
      style={{ '--accent': deck.accent } as React.CSSProperties}
      onClick={onClick}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(index * 0.05, 0.3) }}
      whileHover={{ y: -4 }}
    >
      <div className="ds-tile-cover" style={!hasArt ? proceduralCover(deck) : undefined}>
        {hasArt ? (
          <>
            <img
              className="ds-tile-img"
              src={deck.previewCards[0]}
              alt={deck.name}
              loading="lazy"
              onError={(e) => { e.currentTarget.style.opacity = '0'; }}
            />
            <div className="ds-tile-tint" style={duotoneOverlay(deck)} />
          </>
        ) : (
          <span className="ds-tile-lock">✦</span>
        )}
        <span
          className="ds-badge ds-tile-badge"
          style={{ color: badge.fg, background: badge.bg, borderColor: badge.border }}
        >
          {badge.label}
        </span>
      </div>
      <div className="ds-tile-info">
        <span className="ds-tile-name">{deck.name}</span>
        <span className="ds-tile-artist">{deck.artist} · {deck.style}</span>
        <div className="ds-tile-foot">
          {!owned && deck.state !== 'coming-soon' ? (
            <span className="ds-tile-price">{deck.price} ✦</span>
          ) : (
            <span className="ds-tile-price muted">{owned ? '已拥有' : '敬请期待'}</span>
          )}
          <span className="ds-tile-go">›</span>
        </div>
      </div>
    </motion.button>
  );
}
