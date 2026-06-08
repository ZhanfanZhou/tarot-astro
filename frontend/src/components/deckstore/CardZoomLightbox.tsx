import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CardImage } from '../../data/deckCardImages';

interface CardZoomLightboxProps {
  cards: CardImage[];
  index: number;                 // starting index
  tint: React.CSSProperties;     // per-deck duotone overlay (transparent for classic-rws)
  accent: string;
  onClose: () => void;
}

/** Zoom view for a deck's cards, with ‹ › paging and Esc. Rendered inside the
 *  store overlay; tagged [data-ds-zoom] so DeckStore's Esc handler yields to it. */
export default function CardZoomLightbox({ cards, index, tint, accent, onClose }: CardZoomLightboxProps) {
  const [i, setI] = useState(index);
  const step = useCallback((d: 1 | -1) => setI((p) => (p + d + cards.length) % cards.length), [cards.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  const card = cards[i];
  if (!card) return null;

  return (
    <motion.div
      className="ds-zoom-backdrop"
      data-ds-zoom
      style={{ '--accent': accent } as React.CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      {cards.length > 1 && (
        <button className="ds-zoom-arrow prev" onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label="上一张">‹</button>
      )}

      <motion.div
        className="ds-zoom-stage"
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 300 }}
      >
        <div className="ds-zoom-img-wrap">
          <AnimatePresence mode="wait">
            <motion.img
              key={card.fullUrl}
              src={card.fullUrl}
              alt={card.name}
              className="ds-zoom-img"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onError={(e) => { if (e.currentTarget.src !== card.thumbUrl) e.currentTarget.src = card.thumbUrl; }}
            />
          </AnimatePresence>
          <div className="ds-zoom-tint" style={tint} />
        </div>
        <div className="ds-zoom-info">
          <span className="ds-zoom-name">{card.name}</span>
          {cards.length > 1 && <span className="ds-zoom-counter">{i + 1} / {cards.length}</span>}
        </div>
      </motion.div>

      {cards.length > 1 && (
        <button className="ds-zoom-arrow next" onClick={(e) => { e.stopPropagation(); step(1); }} aria-label="下一张">›</button>
      )}
      <button className="ds-zoom-close" onClick={onClose} aria-label="关闭">✕</button>
    </motion.div>
  );
}
