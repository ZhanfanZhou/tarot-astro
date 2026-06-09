import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore, type ToastKind } from '@/stores/useToastStore';

const ACCENT: Record<ToastKind, string> = {
  success: 'var(--gold)',
  error: '#E5897E',
  info: 'var(--moon)',
};

const ICON: Record<ToastKind, React.ReactNode> = {
  success: <Check size={15} />,
  error: <AlertTriangle size={15} />,
  info: <Info size={15} />,
};

/** Themed toast stack — replaces native alert() for transient feedback. */
const Toaster: React.FC = () => {
  const { toasts, dismiss } = useToastStore();

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2.5 pointer-events-none w-[min(92vw,420px)]">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="pointer-events-auto w-full flex items-center gap-3 px-4 py-3 rounded-2xl backdrop-blur-xl"
            style={{
              background: 'rgba(11,11,22,0.86)',
              border: `1px solid ${ACCENT[t.kind]}40`,
              boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
            }}
          >
            <span
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
              style={{ color: ACCENT[t.kind], background: `${ACCENT[t.kind]}1f` }}
            >
              {ICON[t.kind]}
            </span>
            <span className="flex-1 text-sm leading-snug" style={{ color: 'var(--ivory)' }}>
              {t.message}
            </span>
            <button
              onClick={() => dismiss(t.id)}
              className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: 'var(--ivory)' }}
              aria-label="关闭"
            >
              <X size={15} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default Toaster;
