import React from 'react';
import { motion } from 'framer-motion';
import type { SessionType } from '@/types';

interface SessionButtonsProps {
  onSelectSession: (sessionType: SessionType) => void;
  disabled?: boolean;
}

const SessionButtons: React.FC<SessionButtonsProps> = ({
  onSelectSession,
  disabled = false,
}) => {
  const buttons = [
    {
      type: 'tarot' as SessionType,
      icon: '/assets/avatar_tarot.png',
      label: '塔罗占卜',
      description: '探索命运的奥秘',
      gradient: 'from-purple-600 via-pink-500 to-rose-500',
      glowColor: 'rgba(139, 0, 0, 0.8)', // 暗红色边缘光晕
    },
    {
      type: 'astrology' as SessionType,
      icon: '/assets/avatar.png',
      label: '占星',
      description: '聆听星辰的指引',
      gradient: 'from-blue-600 via-cyan-500 to-teal-500',
      glowColor: 'rgba(218, 165, 32, 0.8)', // 暗金色边缘光晕
      comingSoon: false,
    },
    {
      type: 'chat' as SessionType,
      icon: '💬',
      label: '心灵聊愈',
      description: '倾诉心声的港湾',
      gradient: 'from-green-600 via-emerald-500 to-teal-500',
      glowColor: 'rgba(34, 197, 94, 0.5)',
      comingSoon: true,
    },
  ];

  return (
    <div className="flex gap-6 justify-center flex-wrap px-4">
      {buttons.map((button, index) => (
        <motion.div
          key={button.type}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1, duration: 0.5 }}
          className="relative"
        >
          <motion.button
            onClick={() => !button.comingSoon && onSelectSession(button.type)}
            disabled={disabled || button.comingSoon}
            whileHover={!button.comingSoon ? { scale: 1.05, y: -8 } : {}}
            whileTap={!button.comingSoon ? { scale: 0.95 } : {}}
            className={`
              relative group flex flex-col items-center gap-4 p-8 
              rounded-3xl glass-morphism border-2 
              transition-all duration-300 w-64 overflow-hidden
              ${
                button.comingSoon
                  ? 'opacity-40 cursor-not-allowed border-dark-border'
                  : 'hover:border-mystic-gold cursor-pointer border-dark-border/50'
              }
            `}
          >
            {/* 图标容器 */}
            <motion.div
              className={`
                relative w-20 h-20 rounded-2xl bg-gradient-to-br ${button.gradient} 
                flex items-center justify-center shadow-2xl overflow-hidden
              `}
              animate={{
                boxShadow: !button.comingSoon
                  ? [
                      `0 0 0 2px ${button.glowColor}, 0 0 15px 2px ${button.glowColor}`,
                      `0 0 0 3px ${button.glowColor}, 0 0 25px 4px ${button.glowColor}`,
                      `0 0 0 2px ${button.glowColor}, 0 0 15px 2px ${button.glowColor}`,
                    ]
                  : undefined,
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
              }}
            >
              {/* 装饰性边框 */}
              <div className="absolute inset-1 border border-white/20 rounded-xl" />
              
              {/* 图标 */}
              {button.icon.startsWith('/') ? (
                <img src={button.icon} alt={button.label} className="w-full h-full object-cover rounded-xl" />
              ) : (
                <span className="text-5xl relative z-10">{button.icon}</span>
              )}

              {/* 边缘光晕环 */}
              {!button.comingSoon && (
                <motion.div
                  className="absolute inset-0 rounded-2xl"
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 10,
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                  style={{
                    background: `conic-gradient(from 0deg, transparent 60%, ${button.glowColor} 80%, transparent 100%)`,
                    filter: 'blur(6px)',
                    opacity: 0.6,
                  }}
                />
              )}
            </motion.div>

            {/* 文字内容 */}
            <div className="relative z-10 text-center">
              <h3 className="font-display font-bold text-xl mb-2 text-white">
                {button.label}
              </h3>
              <p className="text-sm text-gray-400 font-display">
                {button.description}
              </p>
            </div>

            {/* 即将推出标签 */}
            {button.comingSoon && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute top-4 right-4 px-3 py-1 bg-dark-elevated rounded-full text-xs text-gray-500 font-medium border border-dark-border"
              >
                即将推出
              </motion.div>
            )}

            {/* 装饰性星星 */}
            {!button.comingSoon && (
              <>
                <motion.div
                  className="absolute top-6 left-6 w-1 h-1 bg-mystic-gold rounded-full"
                  animate={{
                    opacity: [0, 1, 0],
                    scale: [0, 1.5, 0],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    delay: index * 0.3,
                  }}
                />
                <motion.div
                  className="absolute bottom-8 right-8 w-1 h-1 bg-mystic-gold rounded-full"
                  animate={{
                    opacity: [0, 1, 0],
                    scale: [0, 1.5, 0],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    delay: index * 0.3 + 1,
                  }}
                />
              </>
            )}

            {/* 悬停提示箭头 */}
            {!button.comingSoon && (
              <motion.div
                className="absolute bottom-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                animate={{
                  y: [0, 5, 0],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                }}
              >
                <div className="w-6 h-6 border-b-2 border-r-2 border-mystic-gold rotate-45" />
              </motion.div>
            )}
          </motion.button>
        </motion.div>
      ))}
    </div>
  );
};

export default SessionButtons;




