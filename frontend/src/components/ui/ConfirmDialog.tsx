import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConfirmStore } from '@/stores/useConfirmStore';

/** Themed confirmation modal — replaces window.confirm(). */
const ConfirmDialog: React.FC = () => {
  const { request, resolve } = useConfirmStore();
  const danger = request?.tone === 'danger';

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resolve(false);
      else if (e.key === 'Enter') resolve(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, resolve]);

  return (
    <AnimatePresence>
      {request && (
        <motion.div
          key={request.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
          onClick={() => resolve(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl p-6 bg-dark-surface border border-mystic-gold/20 shadow-cosmic"
          >
            {request.title && (
              <h3 className="font-display text-lg font-semibold mb-2" style={{ color: 'var(--ivory)' }}>
                {request.title}
              </h3>
            )}
            <p className="text-sm leading-relaxed mb-6 whitespace-pre-line" style={{ color: 'var(--ivory-dim)' }}>
              {request.message}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => resolve(false)}
                className="px-5 py-2.5 rounded-xl text-sm tracking-wide transition-colors hover:bg-white/[0.05]"
                style={{ color: 'var(--ivory-dim)', border: '1px solid var(--line-soft)' }}
              >
                {request.cancelText ?? '取消'}
              </button>
              <button
                onClick={() => resolve(true)}
                className="px-5 py-2.5 rounded-xl text-sm tracking-wide font-medium transition-transform hover:scale-[1.03]"
                style={
                  danger
                    ? { color: '#F2C4BC', background: 'rgba(229,137,126,0.14)', border: '1px solid rgba(229,137,126,0.4)' }
                    : { color: '#1a1407', background: 'linear-gradient(135deg, #8A6D3B, #C9A96E 55%, #F0D090)' }
                }
              >
                {request.confirmText ?? '确定'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ConfirmDialog;
