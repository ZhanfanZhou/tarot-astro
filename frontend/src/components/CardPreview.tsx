import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import type { TarotCard } from '@/types';
import { getCardInfo } from '@/config/tarotCards';
import { useDeckWallet } from '@/stores/useDeckWallet';
import { resolveActiveCardImage } from '@/data/activeDeckImage';

/**
 * 牌面大图（灯箱）：对话里的牌、每日一签舞台上的牌，点一下都开这一个。
 * 原图正着放、逆位另外标出来，不跟着小图倒过来。card 为 null 时不显示。
 */
const CardPreview: React.FC<{ card: TarotCard | null; onClose: () => void }> = ({ card, onClose }) =>
  createPortal(
    <AnimatePresence>{card && <PreviewBody card={card} onClose={onClose} />}</AnimatePresence>,
    document.body,
  );

const PreviewBody: React.FC<{ card: TarotCard; onClose: () => void }> = ({ card, onClose }) => {
  const [imageError, setImageError] = useState(false);
  const cardInfo = getCardInfo(card.card_id);
  const accent = card.reversed ? 'var(--moon)' : 'var(--gold)';
  const name = cardInfo?.name_zh || card.card_name;
  const activeDeckId = useDeckWallet((s) => s.activeDeckId);
  const resolved = cardInfo ? resolveActiveCardImage(cardInfo.imageUrl, activeDeckId) : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/85 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 16 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col items-center"
      >
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ background: 'rgba(6,6,15,0.9)', border: '1px solid var(--line)', color: 'var(--ivory-dim)' }}
          aria-label="关闭预览"
        >
          <X size={17} />
        </button>

        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            border: `1px solid ${accent}`,
            boxShadow: `0 24px 70px rgba(0,0,0,0.6), 0 0 40px ${card.reversed ? 'rgba(168,216,234,0.22)' : 'rgba(201,169,110,0.24)'}`,
          }}
        >
          {cardInfo && !imageError ? (
            <>
              <img
                src={resolved?.src ?? cardInfo.imageUrl}
                alt={name}
                onError={() => setImageError(true)}
                className="block w-auto object-contain"
                style={{ maxHeight: '74vh', maxWidth: '88vw' }}
              />
              {resolved?.tint && <div className="absolute inset-0 pointer-events-none" style={resolved.tint} />}
            </>
          ) : (
            <div
              className="flex flex-col items-center justify-center"
              style={{ width: 'min(320px, 80vw)', aspectRatio: '2 / 3.5', background: 'linear-gradient(160deg, #12121e 0%, #0a0a14 100%)' }}
            >
              <div className="text-5xl mb-4" style={{ color: accent, opacity: 0.85 }}>✦</div>
              <div className="text-lg" style={{ color: 'var(--ivory)' }}>{name}</div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="font-display text-lg tracking-wide" style={{ color: 'var(--ivory)' }}>{name}</span>
          {cardInfo?.name_en && (
            <span className="text-sm tracking-[0.12em]" style={{ color: 'var(--ivory-faint)' }}>{cardInfo.name_en}</span>
          )}
          {card.reversed && (
            <span
              className="px-2.5 py-0.5 rounded-full text-[11px] tracking-wider"
              style={{ color: 'var(--moon)', border: '1px solid rgba(168,216,234,0.4)', background: 'rgba(6,6,15,0.8)' }}
            >
              逆位
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default CardPreview;
