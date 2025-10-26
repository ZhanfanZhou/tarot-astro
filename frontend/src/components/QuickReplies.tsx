import React from 'react';
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
    <div className="mb-3 px-4">
      <div className="flex flex-wrap gap-2 justify-start">
        {replies.map((reply, index) => (
          <button
            key={index}
            onClick={() => onReplyClick(reply)}
            className="px-3 py-1.5 text-sm bg-white/80 hover:bg-white text-gray-700 
                     rounded-full shadow-sm hover:shadow-md transition-all duration-200
                     border border-gray-200 hover:border-purple-300
                     backdrop-blur-sm hover:scale-105"
            title={reply}
          >
            {reply}
          </button>
        ))}
      </div>
    </div>
  );
};

export default QuickReplies;

