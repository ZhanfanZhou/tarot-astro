import React from 'react';
import { motion } from 'framer-motion';
import { User, Bot } from 'lucide-react';
import type { Message, MessageRole } from '@/types';

interface ChatMessageProps {
  message: Message;
  isThinking?: boolean;
}

const THINKING_MESSAGES = [
  '思考中...',
  '灵感收集中...',
  '星辰共鸣中...',
  '牌运流转中...',
  '宇宙指引中...',
  '深层解读中...',
  '命运显现中...',
  '智慧连接中...',
];

const ChatMessage: React.FC<ChatMessageProps> = ({ message, isThinking = false }) => {
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
  
  // 隐藏自动触发星盘解读的消息
  if (isUser && (
    message.content === '资料补充好了，我的星盘信息已经准备好了' ||
    message.content === '星盘数据已准备好，请继续解读' ||
    message.content === '我已经填写好出生信息了'
  )) {
    return null;
  }

  // 思考状态消息
  if (isThinking) {
    const thinkingText = THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)];
    
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex gap-4"
      >
        {/* Avatar */}
        <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500">
          <Bot size={20} />
        </div>

        {/* Thinking Indicator */}
        <div className="flex-1 max-w-3xl">
          <div className="inline-block px-4 py-3 rounded-2xl bg-dark-surface border border-dark-border">
            <div className="flex items-center gap-2">
              {/* Animated dots */}
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.6, 1, 0.6],
                    }}
                    transition={{
                      duration: 1.4,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                    className="w-2 h-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                  />
                ))}
              </div>
              {/* Thinking text */}
              <span className="text-gray-300 ml-2">{thinkingText}</span>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-1 px-2">
            {new Date().toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      </motion.div>
    );
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




