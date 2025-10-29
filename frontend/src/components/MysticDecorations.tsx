import React from 'react';
import { motion } from 'framer-motion';

// 神秘符号装饰
export const MysticSymbol: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <motion.circle
        cx="50"
        cy="50"
        r="40"
        stroke="url(#mysticGrad)"
        strokeWidth="2"
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
      />
      <motion.path
        d="M50 10 L50 90 M10 50 L90 50"
        stroke="url(#mysticGrad)"
        strokeWidth="1"
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
      />
      <motion.polygon
        points="50,20 60,40 50,35 40,40"
        fill="url(#mysticGrad)"
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 3, repeat: Infinity }}
      />
      <defs>
        <linearGradient id="mysticGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>
    </svg>
  );
};

// 星星装饰
export const StarDecoration: React.FC<{ 
  className?: string;
  delay?: number;
}> = ({ className, delay = 0 }) => {
  return (
    <motion.svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      initial={{ opacity: 0, scale: 0 }}
      animate={{ 
        opacity: [0.3, 1, 0.3],
        scale: [0.8, 1.2, 0.8],
      }}
      transition={{
        duration: 2,
        repeat: Infinity,
        delay: delay,
      }}
    >
      <path
        d="M12 2L14.09 8.26L20 10L14.09 11.74L12 18L9.91 11.74L4 10L9.91 8.26L12 2Z"
        fill="currentColor"
      />
    </motion.svg>
  );
};

// 月亮相位装饰
export const MoonPhase: React.FC<{ 
  phase?: number; // 0-1
  className?: string;
}> = ({ phase = 0.5, className }) => {
  return (
    <motion.svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      animate={{ rotate: 360 }}
      transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
    >
      <circle cx="50" cy="50" r="45" fill="rgba(255, 255, 255, 0.1)" />
      <circle
        cx={50 + (phase - 0.5) * 40}
        cy="50"
        r="45"
        fill="rgba(19, 19, 26, 0.8)"
      />
      <circle cx="50" cy="50" r="43" fill="none" stroke="rgba(255, 215, 0, 0.3)" strokeWidth="1" />
    </motion.svg>
  );
};

// 塔罗牌边框装饰
export const TarotCardBorder: React.FC<{ children: React.ReactNode; className?: string }> = ({ 
  children, 
  className = '' 
}) => {
  return (
    <div className={`relative ${className}`}>
      {/* 四角装饰 */}
      <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-mystic-gold opacity-60" />
      <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-mystic-gold opacity-60" />
      <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-mystic-gold opacity-60" />
      <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-mystic-gold opacity-60" />
      
      {children}
    </div>
  );
};

// 神秘光环
export const MysticAura: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <motion.div
      className={`absolute inset-0 ${className}`}
      style={{
        background: 'radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, transparent 70%)',
      }}
      animate={{
        scale: [1, 1.2, 1],
        opacity: [0.3, 0.6, 0.3],
      }}
      transition={{
        duration: 3,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
};

// 粒子效果
export const ParticleEffect: React.FC<{ count?: number }> = ({ count = 20 }) => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full"
          style={{
            background: `rgba(${139 + Math.random() * 100}, ${92 + Math.random() * 100}, 246, 0.6)`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
          }}
          animate={{
            y: [0, -100, 0],
            opacity: [0, 1, 0],
            scale: [0, 1, 0],
          }}
          transition={{
            duration: 3 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 2,
          }}
        />
      ))}
    </div>
  );
};

// 占星符号
export const AstroSymbol: React.FC<{ 
  symbol: 'sun' | 'moon' | 'star' | 'planet';
  className?: string;
}> = ({ symbol, className }) => {
  const symbols = {
    sun: (
      <circle cx="12" cy="12" r="5" fill="currentColor">
        <animate attributeName="r" values="5;6;5" dur="2s" repeatCount="indefinite" />
      </circle>
    ),
    moon: (
      <path d="M12 3a9 9 0 1 0 9 9c0-5-4-9-9-9z" fill="currentColor" />
    ),
    star: (
      <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z" fill="currentColor" />
    ),
    planet: (
      <circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.6" />
    ),
  };

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {symbols[symbol]}
    </svg>
  );
};

// 神秘分割线
export const MysticDivider: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-mystic-gold to-transparent opacity-30" />
      <StarDecoration className="w-4 h-4 text-mystic-gold" />
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-mystic-gold to-transparent opacity-30" />
    </div>
  );
};

export default {
  MysticSymbol,
  StarDecoration,
  MoonPhase,
  TarotCardBorder,
  MysticAura,
  ParticleEffect,
  AstroSymbol,
  MysticDivider,
};

