import React from 'react';
import { motion } from 'framer-motion';
import type { Conversation } from '@/types';

interface RecentReadingsProps {
  conversations: Conversation[];
  onSelect: (conversation: Conversation) => void;
}

const relTime = (dateStr: string) => {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
};

/** Welcome-hub strip of the most recent readings for one-tap re-entry. */
const RecentReadings: React.FC<RecentReadingsProps> = ({ conversations, onSelect }) => {
  const recent = [...conversations]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 3);

  if (recent.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.62, duration: 0.7 }}
      className="w-full"
    >
      <div className="flex items-center gap-3 mb-3">
        <span className="eyebrow" style={{ fontSize: '10px', letterSpacing: '0.3em' }}>近期占卜</span>
        <span className="flex-1 h-px" style={{ background: 'linear-gradient(to right, var(--line), transparent)' }} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {recent.map((conv) => {
          const isTarot = conv.session_type === 'tarot';
          const accent = isTarot ? 'var(--gold)' : 'var(--moon)';
          const avatar = isTarot ? '/assets/avatar_tarot.png' : '/assets/avatar.png';
          return (
            <button
              key={conv.conversation_id}
              onClick={() => onSelect(conv)}
              className="group flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all duration-300"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--line-soft)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(201,169,110,0.35)'; e.currentTarget.style.background = 'rgba(201,169,110,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line-soft)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
            >
              <span
                className="flex-shrink-0 w-9 h-9 rounded-full overflow-hidden ring-1 ring-offset-2 ring-offset-dark-bg"
                style={{ '--tw-ring-color': accent } as React.CSSProperties}
              >
                <img src={avatar} alt="" aria-hidden className="w-full h-full object-cover" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate" style={{ color: 'var(--ivory)' }}>{conv.title}</span>
                <span className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] tracking-wide" style={{ color: 'var(--ivory-faint)' }}>{relTime(conv.updated_at)}</span>
                  {conv.has_drawn_cards && <span className="text-[11px]" style={{ color: 'var(--gold)' }}>✦</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
};

export default RecentReadings;
