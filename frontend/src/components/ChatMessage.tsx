import React from 'react';
import { motion } from 'framer-motion';
import { User, Bot } from 'lucide-react';
import type { Message, MessageRole } from '@/types';

interface ChatMessageProps {
  message: Message;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // 系统消息不显示
  if (isSystem) {
    return null;
  }

  // 隐藏自动触发解读的消息
  if (isUser && message.content === '请根据抽牌结果进行解读') {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
          isUser ? 'bg-primary' : 'bg-gradient-to-br from-purple-500 to-pink-500'
        }`}
      >
        {isUser ? <User size={20} /> : <Bot size={20} />}
      </div>

      {/* Content */}
      <div className={`flex-1 max-w-3xl ${isUser ? 'text-right' : 'text-left'}`}>
        <div
          className={`inline-block px-4 py-3 rounded-2xl ${
            isUser
              ? 'bg-primary text-white'
              : 'bg-dark-surface border border-dark-border'
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
          
          {/* 显示抽到的牌 */}
          {message.tarot_cards && message.tarot_cards.length > 0 && (
            <div className="mt-3 pt-3 border-t border-dark-border">
              <p className="text-sm font-semibold mb-2">抽到的牌：</p>
              <div className="space-y-1">
                {message.tarot_cards.map((card, idx) => (
                  <div key={idx} className="text-sm">
                    <span className="font-medium">
                      {message.draw_request?.positions?.[idx] || `第${idx + 1}张`}:
                    </span>{' '}
                    {card.card_name} {card.reversed ? '（逆位）' : '（正位）'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-1 px-2">
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </motion.div>
  );
};

export default ChatMessage;




