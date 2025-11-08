import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Sparkles } from 'lucide-react';
import type { Message, SessionType } from '@/types';
import { getCardInfo } from '@/config/tarotCards';

interface ChatMessageProps {
  message: Message;
  isThinking?: boolean;
  sessionType?: SessionType;
  showDrawButton?: boolean; // 是否显示抽牌按钮
  onReadyToDraw?: () => void; // 点击抽牌按钮的回调
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

const ChatMessage: React.FC<ChatMessageProps> = ({ 
  message, 
  isThinking = false, 
  sessionType, 
  showDrawButton = false,
  onReadyToDraw 
}) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const trimmedContent = message.content?.trim() ?? '';

  // 获取 AI 头像路径
  const getAIAvatarPath = () => {
    return sessionType === 'tarot' ? '/assets/avatar_tarot.png' : '/assets/avatar.png';
  };

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
        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-mystic-gradient shadow-mystic overflow-hidden">
          <img src={getAIAvatarPath()} alt="AI Avatar" className="w-full h-full object-cover" />
        </div>

        {/* Thinking Indicator */}
        <div className="flex-1 max-w-3xl">
          <div className="inline-block px-5 py-4 rounded-2xl glass-morphism border border-primary/20">
            <div className="flex items-center gap-2">
              {/* Animated dots */}
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{
                      scale: [1, 1.3, 1],
                      opacity: [0.6, 1, 0.6],
                    }}
                    transition={{
                      duration: 1.4,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                    className="w-2 h-2 bg-mystic-gradient rounded-full"
                  />
                ))}
              </div>
              {/* Thinking text */}
              <span className="text-gray-300 ml-2 font-display">{thinkingText}</span>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-2 px-3 font-display">
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
      <motion.div
        whileHover={{ scale: 1.1, rotate: 5 }}
        className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center shadow-lg overflow-hidden ${
          isUser 
            ? 'bg-gradient-to-br from-cyan-500 to-blue-600' 
            : 'bg-mystic-gradient shadow-mystic'
        }`}
      >
        {isUser ? (
          <User size={22} className="text-white" />
        ) : (
          <img src={getAIAvatarPath()} alt="AI Avatar" className="w-full h-full object-cover" />
        )}
      </motion.div>

      {/* Content */}
      <div className={`flex-1 max-w-3xl ${isUser ? 'text-right' : 'text-left'}`}>
        <motion.div
          initial={{ scale: 0.95 }}
          animate={{ scale: 1 }}
          className={`inline-block px-5 py-4 rounded-2xl backdrop-blur-sm ${
            isUser
              ? 'bg-gradient-to-br from-cyan-500/90 to-blue-600/90 text-white shadow-lg'
              : 'glass-morphism border border-primary/20 shadow-cosmic'
          }`}
        >
          {trimmedContent && (
            <p className="whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
          )}
          
          {/* 抽牌按钮 */}
          {!isUser && showDrawButton && onReadyToDraw && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onReadyToDraw}
              className={`${trimmedContent ? 'mt-4' : ''} px-6 py-3 bg-mystic-gradient text-white font-display font-semibold rounded-xl shadow-mystic hover:shadow-mystic-lg transition-all duration-300 flex items-center gap-2 mx-auto`}
            >
              <Sparkles size={18} className="animate-pulse" />
              {trimmedContent ? '我准备好了' : '点我抽牌'}
              <Sparkles size={18} className="animate-pulse" />
            </motion.button>
          )}
          
          {/* 显示抽到的牌 */}
          {message.tarot_cards && message.tarot_cards.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-6 pt-6 border-t border-mystic-gold/20"
            >
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={16} className="text-mystic-gold" />
                <p className="text-sm font-display font-semibold text-mystic-gold">
                  抽到的牌
                </p>
                <Sparkles size={16} className="text-mystic-gold" />
              </div>
              
              <div className="flex flex-wrap gap-4 justify-center">
                {message.tarot_cards.map((card, idx) => {
                  const cardInfo = getCardInfo(card.card_id);

                  return (
                    <TarotCardDisplay
                      key={idx}
                      card={card}
                      cardInfo={cardInfo}
                      position={message.draw_request?.positions?.[idx]}
                      index={idx}
                    />
                  );
                })}
              </div>
            </motion.div>
          )}
        </motion.div>
        
        <div className="text-xs text-gray-500 mt-2 px-3 font-display">
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </motion.div>
  );
};

// 单独的塔罗牌显示组件
const TarotCardDisplay: React.FC<{
  card: any;
  cardInfo: any;
  position?: string;
  index: number;
}> = ({ card, cardInfo, position, index }) => {
  const [imageError, setImageError] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, rotateY: 180 }}
      animate={{ opacity: 1, scale: 1, rotateY: 0 }}
      transition={{ 
        delay: index * 0.2,
        type: 'spring',
        stiffness: 100,
      }}
      className="relative group"
      style={{ width: '140px' }}
    >
      {/* 卡牌容器 */}
      <motion.div
        whileHover={{ 
          scale: 1.05, 
          y: -10,
        }}
        className={`
          relative w-full aspect-[2/3.5] rounded-xl overflow-hidden
          shadow-2xl border-2 transition-all duration-300
          ${
            card.reversed
              ? 'border-purple-400 shadow-purple-500/50'
              : 'border-mystic-gold shadow-mystic-gold/30'
          }
        `}
        style={{
          transform: card.reversed ? 'rotate(180deg)' : 'rotate(0deg)',
        }}
      >
        {/* 逆位标记 */}
        {card.reversed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute top-2 right-2 z-10 bg-purple-600/90 text-white text-xs px-2 py-1 rounded-lg font-medium shadow-lg"
            style={{
              transform: 'rotate(180deg)', // 逆位标记需要反转回来
            }}
          >
            逆位
          </motion.div>
        )}
        
        {/* 卡牌图片或占位符 */}
        {cardInfo && !imageError ? (
          <img
            src={cardInfo.imageUrl}
            alt={cardInfo.name_zh}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
            loading="lazy"
          />
        ) : (
          // 占位符样式
          <div className={`
            w-full h-full flex flex-col items-center justify-center p-3
            bg-gradient-to-br
            ${
              card.reversed
                ? 'from-indigo-600 via-purple-600 to-purple-700'
                : 'from-purple-500 via-pink-500 to-pink-600'
            }
          `}>
            {/* 装饰性边框 */}
            <div className="absolute inset-3 border border-white/20 rounded-lg" />
            <div className="absolute inset-4 border border-white/10 rounded-lg" />
            
            {/* 图标 */}
            <motion.div
              animate={{ 
                rotate: card.reversed ? [0, 180, 360] : [0, -10, 10, 0],
                scale: [1, 1.1, 1],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
              }}
              className="text-5xl mb-3 opacity-90"
            >
              {card.reversed ? '🔮' : '✨'}
            </motion.div>
            
            {/* 卡牌名称 */}
            <div className="text-white font-bold text-center text-sm leading-tight break-words px-2">
              {cardInfo?.name_zh || card.card_name}
            </div>
            
            {/* 英文名称 */}
            {cardInfo && (
              <div className="text-white/70 text-xs mt-1 text-center">
                {cardInfo.name_en}
              </div>
            )}
          </div>
        )}
        
        {/* 悬停光效 */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        />
      </motion.div>
      
      {/* 位置标签 */}
      {position && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: index * 0.2 + 0.3 }}
          className="mt-2 text-xs text-center font-display"
        >
          <div className="inline-block px-3 py-1 bg-dark-elevated/80 rounded-full text-mystic-gold border border-mystic-gold/30">
            {position}
          </div>
        </motion.div>
      )}
      
      {/* 悬停提示 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileHover={{ opacity: 1, y: 0 }}
        className="absolute -bottom-8 left-0 right-0 text-center text-xs text-gray-400 font-display opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {cardInfo?.name_zh || card.card_name}
      </motion.div>
    </motion.div>
  );
};

export default ChatMessage;
