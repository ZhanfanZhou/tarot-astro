import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, MoreHorizontal, Copy, ArrowDownToLine, Trash2 } from 'lucide-react';
import type { Conversation } from '@/types';

interface TopBarProps {
  conversation: Conversation;
  onToggleSidebar: () => void;
  onCopyAll: () => void;
  onScrollToLatest: () => void;
  onDelete: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ conversation, onToggleSidebar, onCopyAll, onScrollToLatest, onDelete }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const isTarot = conversation.session_type === 'tarot' || conversation.session_type === 'daily';
  const accent = isTarot ? 'var(--gold)' : 'var(--moon)';
  const avatar = isTarot ? '/assets/avatar_tarot.png' : '/assets/avatar.png';

  const items = [
    { label: '复制全部解读', icon: <Copy size={15} />, action: onCopyAll },
    { label: '回到最新', icon: <ArrowDownToLine size={15} />, action: onScrollToLatest },
    { label: '删除对话', icon: <Trash2 size={15} />, action: onDelete, danger: true },
  ];

  return (
    <div className="px-4 sm:px-6 py-3.5 border-b border-mystic-gold/12 bg-dark-bg/45 backdrop-blur-xl">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="flex-shrink-0 p-2 -ml-1 rounded-lg transition-colors hover:bg-white/[0.05]"
          style={{ color: 'var(--ivory-dim)' }}
          aria-label="切换侧边栏"
        >
          <Menu size={19} />
        </button>

        <div className="w-9 h-9 rounded-full overflow-hidden ring-1 ring-offset-2 ring-offset-dark-bg flex-shrink-0" style={{ '--tw-ring-color': accent } as React.CSSProperties}>
          <img src={avatar} alt="" aria-hidden className="w-full h-full object-cover" />
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="font-display font-semibold text-base sm:text-lg tracking-wide truncate" style={{ color: 'var(--ivory)' }}>
            {conversation.title}
          </h2>
          <p className="eyebrow" style={{ letterSpacing: '0.24em', fontSize: '9px' }}>
            {conversation.session_type === 'daily'
              ? 'DAILY ORACLE · 每日一签'
              : isTarot
                ? 'TAROT · 塔罗占卜'
                : 'ASTROLOGY · 占星'}
          </p>
        </div>

        {/* overflow menu */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 rounded-lg transition-colors hover:bg-white/[0.05]"
            style={{ color: 'var(--ivory-dim)' }}
            aria-label="更多操作"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={19} />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.16 }}
                  className="absolute right-0 mt-2 w-44 z-50 rounded-xl overflow-hidden py-1.5"
                  style={{ background: 'rgba(11,11,22,0.96)', border: '1px solid var(--line)', boxShadow: '0 18px 44px rgba(0,0,0,0.55)' }}
                >
                  {items.map((it) => (
                    <button
                      key={it.label}
                      onClick={() => { setMenuOpen(false); it.action(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.05]"
                      style={{ color: it.danger ? '#E5897E' : 'var(--ivory-dim)' }}
                    >
                      {it.icon}
                      {it.label}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default TopBar;
