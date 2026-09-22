import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2 } from 'lucide-react';

/**
 * 分享入口的占位弹窗：分享还没做，这里只告诉用户「在筹备中」。
 * 引一句要分享的那段回复，让人知道点的是哪一条。
 */
const ShareDialog: React.FC<{ open: boolean; excerpt: string; onClose: () => void }> = ({ open, excerpt, onClose }) => {
  const titleId = useId();
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl p-6 text-center bg-dark-surface border border-mystic-gold/20 shadow-cosmic"
          >
            <div
              className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center"
              style={{ border: '1px solid var(--line)', background: 'rgba(201,169,110,0.08)', color: 'var(--gold)' }}
              aria-hidden="true"
            >
              <Share2 size={20} />
            </div>
            <h3 id={titleId} className="font-display text-lg font-semibold mb-2" style={{ color: 'var(--ivory)' }}>
              分享这段解读
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ivory-dim)' }}>
              分享功能还在筹备中，敬请期待。
            </p>
            {excerpt && (
              <blockquote
                className="mt-4 px-4 py-3 rounded-xl text-left text-[13px] leading-relaxed line-clamp-3"
                style={{ color: 'var(--ivory-faint)', border: '1px solid var(--line-soft)', background: 'rgba(255,255,255,0.02)' }}
              >
                {excerpt}
              </blockquote>
            )}
            <button
              ref={okRef}
              onClick={onClose}
              className="mt-6 px-6 py-2.5 rounded-xl text-sm tracking-wide font-medium transition-transform hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-mystic-gold focus-visible:ring-offset-2 focus-visible:ring-offset-dark-surface"
              style={{ color: '#1a1407', background: 'linear-gradient(135deg, #8A6D3B, #C9A96E 55%, #F0D090)' }}
            >
              好的
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default ShareDialog;
