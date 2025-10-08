import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Star, MessageCircle } from 'lucide-react';
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
      icon: Sparkles,
      label: '塔罗占卜',
      gradient: 'from-purple-500 to-pink-500',
    },
    {
      type: 'astrology' as SessionType,
      icon: Star,
      label: '星座',
      gradient: 'from-blue-500 to-cyan-500',
      comingSoon: false,
    },
    {
      type: 'chat' as SessionType,
      icon: MessageCircle,
      label: '聊愈',
      gradient: 'from-green-500 to-teal-500',
      comingSoon: true,
    },
  ];

  return (
    <div className="flex gap-4 justify-center">
      {buttons.map((button) => (
        <motion.button
          key={button.type}
          onClick={() => !button.comingSoon && onSelectSession(button.type)}
          disabled={disabled || button.comingSoon}
          whileHover={!button.comingSoon ? { scale: 1.05, y: -5 } : {}}
          whileTap={!button.comingSoon ? { scale: 0.95 } : {}}
          className={`relative group flex flex-col items-center gap-2 p-6 rounded-2xl bg-dark-surface border-2 border-dark-border transition-all ${
            button.comingSoon
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:border-primary cursor-pointer'
          }`}
        >
          <div
            className={`w-16 h-16 rounded-xl bg-gradient-to-br ${button.gradient} flex items-center justify-center`}
          >
            <button.icon size={32} />
          </div>
          <span className="font-medium">{button.label}</span>
          {button.comingSoon && (
            <span className="text-xs text-gray-500">即将推出</span>
          )}
        </motion.button>
      ))}
    </div>
  );
};

export default SessionButtons;




