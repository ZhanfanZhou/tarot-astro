import React from 'react';
import { motion } from 'framer-motion';
import type { SessionType } from '@/types';

interface SessionButtonsProps {
  onSelectSession: (sessionType: SessionType) => void;
  disabled?: boolean;
}

interface SessionDef {
  type: SessionType;
  icon: string;
  label: string;
  en: string;
  tagline: string;
  accent: string;       // ring / glow color
  comingSoon?: boolean;
}

const SessionButtons: React.FC<SessionButtonsProps> = ({
  onSelectSession,
  disabled = false,
}) => {
  const buttons: SessionDef[] = [
    {
      type: 'tarot' as SessionType,
      icon: '/assets/avatar_tarot.png',
      label: '塔罗占卜',
      en: 'TAROT',
      tagline: '于牌阵中窥见命运的纹路',
      accent: '#C9A96E', // antique gold
    },
    {
      type: 'astrology' as SessionType,
      icon: '/assets/avatar.png',
      label: '占星',
      en: 'ASTROLOGY',
      tagline: '聆听星辰絮语般的指引',
      accent: '#A8D8EA', // moonlight blue
    },
    {
      type: 'chat' as SessionType,
      icon: '/assets/avatar3.png',
      label: '聊愈',
      en: 'SOLACE',
      tagline: '倾诉心声的静谧港湾',
      accent: '#B98A6E', // warm ember
      comingSoon: true,
    },
  ];

  return (
    <div className="flex gap-6 justify-center flex-wrap px-4">
      {buttons.map((button, index) => (
        <motion.div
          key={button.type}
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 + index * 0.12, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
          className="relative"
        >
          <motion.button
            onClick={() => !button.comingSoon && onSelectSession(button.type)}
            disabled={disabled || button.comingSoon}
            whileHover={!button.comingSoon ? { y: -8 } : {}}
            whileTap={!button.comingSoon ? { scale: 0.985 } : {}}
            style={{ '--accent': button.accent } as React.CSSProperties}
            className={`
              group relative flex flex-col items-center gap-5 px-8 pt-9 pb-8
              w-60 rounded-[20px] overflow-hidden text-center
              bg-dark-surface/70 backdrop-blur-xl
              border transition-all duration-500
              ${
                button.comingSoon
                  ? 'opacity-45 cursor-not-allowed border-white/8'
                  : 'cursor-pointer border-white/10 hover:border-[var(--accent)]'
              }
            `}
          >
            {/* hover wash + glow */}
            {!button.comingSoon && (
              <span
                className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background: `radial-gradient(120% 90% at 50% 0%, ${button.accent}1f 0%, transparent 60%)`,
                  boxShadow: `inset 0 0 50px ${button.accent}14`,
                }}
              />
            )}

            {/* avatar in a ringed medallion */}
            <span className="relative">
              <span
                className="absolute -inset-2 rounded-full opacity-0 group-hover:opacity-100 blur-md transition-opacity duration-500"
                style={{ background: `radial-gradient(circle, ${button.accent}33, transparent 70%)` }}
              />
              <span
                className="relative block w-24 h-24 rounded-full overflow-hidden ring-1 ring-offset-4 ring-offset-dark-surface transition-all duration-500"
                style={{ '--tw-ring-color': `${button.accent}66` } as React.CSSProperties}
              >
                <img src={button.icon} alt={button.label} className="w-full h-full object-cover" />
              </span>
            </span>

            {/* text */}
            <span className="relative z-10 flex flex-col items-center gap-2">
              <span
                className="text-[10px] tracking-[0.34em] font-display"
                style={{ color: button.comingSoon ? 'var(--ivory-faint)' : `${button.accent}` }}
              >
                {button.en}
              </span>
              <span className="font-display font-semibold text-xl tracking-[0.12em]" style={{ color: 'var(--ivory)' }}>
                {button.label}
              </span>
              <span className="text-xs leading-relaxed" style={{ color: 'var(--ivory-dim)' }}>
                {button.tagline}
              </span>
            </span>

            {/* coming soon ribbon */}
            {button.comingSoon && (
              <span className="absolute top-4 right-4 px-2.5 py-1 rounded-full text-[10px] tracking-wider border border-white/10 bg-white/[0.03]"
                    style={{ color: 'var(--ivory-faint)' }}>
                即将推出
              </span>
            )}

            {/* enter cue */}
            {!button.comingSoon && (
              <motion.span
                className="relative z-10 mt-1 text-xs tracking-[0.3em] font-display opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ color: button.accent }}
              >
                进入 ›
              </motion.span>
            )}
          </motion.button>
        </motion.div>
      ))}
    </div>
  );
};

export default SessionButtons;
