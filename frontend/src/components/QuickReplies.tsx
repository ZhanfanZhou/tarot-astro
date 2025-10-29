import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
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

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-4"
    >


      {/* 快速回复按钮 */}
      <div className="flex flex-wrap gap-2">
        {replies.map((reply, index) => (
          <motion.button
            key={index}
            onClick={() => onReplyClick(reply)}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.03 }}
            whileHover={{ 
              scale: 1.05,
              boxShadow: '0 0 20px rgba(255, 215, 0, 0.3)',
            }}
            whileTap={{ scale: 0.95 }}
            className="group relative px-4 py-2 text-sm font-display
                     glass-morphism border border-dark-border/50
                     hover:border-mystic-gold/50
                     rounded-full
                     transition-all duration-300
                     overflow-hidden"
          >
            {/* 悬停时的光效 */}
            <motion.div
              className="absolute inset-0 bg-mystic-gradient opacity-0 group-hover:opacity-10 transition-opacity"
              initial={false}
            />
            
            {/* 文字 */}
            <span className="relative z-10 text-gray-300 group-hover:text-white transition-colors">
              {reply}
            </span>

            {/* 装饰性光点 */}
            <motion.div
              className="absolute top-1 right-1 w-1 h-1 rounded-full bg-mystic-gold opacity-0 group-hover:opacity-100"
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
              }}
            />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
};

export default QuickReplies;

