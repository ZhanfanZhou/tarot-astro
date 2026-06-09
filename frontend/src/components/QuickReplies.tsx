import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SessionType } from '../types';

interface QuickRepliesProps {
  conversationType: SessionType;
  onReplyClick: (text: string) => void;
}

const TAROT_QUICK_REPLIES = [
  '确实是这样，你继续说',
  '好像是有点这种感觉',
  '我可以问什么问题？',
  '塔罗算得准吗？',
  '你最擅长什么问题？',
  '看看我下半年的感情运势',
  '我下个月的事业运怎么样？',
  '帮我看看最近的运势',
  '我该怎么做决定？',
  '能再详细解释一下吗？',
];

const ASTROLOGY_QUICK_REPLIES = [
  '确实是这样，你继续说',
  '好像是有点这种感觉',
  '我可以问什么问题？',
  '星盘是什么意思？准吗？',
  '你最擅长什么问题？',
  '看看我下半年的感情运势',
  '我下个月的事业运怎么样？',
  '分析一下我的性格特点',
  '我和什么星座最配？',
  '能再详细解释一下吗？',
];

const QuickReplies: React.FC<QuickRepliesProps> = ({ conversationType, onReplyClick }) => {
  const replies = conversationType === SessionType.TAROT ? TAROT_QUICK_REPLIES : ASTROLOGY_QUICK_REPLIES;
  const [open, setOpen] = useState(true);

  const chipBase: React.CSSProperties = {
    border: '1px solid var(--line-soft)',
    background: 'rgba(255,255,255,0.02)',
    color: 'var(--ivory-dim)',
  };

  return (
    <div className="flex items-start gap-2">
      {/* 灵感 toggle (stays put as chips wrap) */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] tracking-[0.12em] transition-colors"
        style={{ border: '1px solid rgba(201,169,110,0.35)', color: 'var(--gold)', background: 'rgba(201,169,110,0.06)' }}
        aria-expanded={open}
      >
        <span style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .25s', display: 'inline-block' }}>✦</span>
        灵感
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            // 仅淡入淡出：动画 height:auto 会让 framer 在换行的 flex 容器上反复测量，
            // 触发整列对话每帧重排（页面卡死/崩溃）。透明度动画走合成层，不引发回流。
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex-1 min-w-0"
          >
            <div className="flex flex-wrap gap-2 pb-0.5">
              {replies.map((reply, index) => (
                <button
                  key={index}
                  onClick={() => onReplyClick(reply)}
                  className="px-3.5 py-1.5 text-[13px] rounded-full transition-all duration-200 whitespace-nowrap"
                  style={chipBase}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(201,169,110,0.45)';
                    e.currentTarget.style.color = 'var(--ivory)';
                    e.currentTarget.style.background = 'rgba(201,169,110,0.07)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--line-soft)';
                    e.currentTarget.style.color = 'var(--ivory-dim)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                  }}
                >
                  {reply}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default QuickReplies;
