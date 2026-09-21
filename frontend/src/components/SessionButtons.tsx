import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { SessionType } from '@/types';

interface SessionButtonsProps {
  onSelectSession: (sessionType: SessionType) => void;
  disabled?: boolean;
  /** 正在创建的会话类型。建会话只是一次写库、很快，开场白是进对话之后才等的。 */
  pendingType?: SessionType | null;
}

interface SessionDef {
  type: SessionType;
  portrait: string;     // 720px webp，顶栏/对话里的小头像也用这张
  label: string;
  en: string;
  tagline: string;
  accent: string;       // frame / glow color
  badge?: string;       // 名字下的小胶囊：内测中 / 即将推出
  comingSoon?: boolean;
}

// 立绘四边往底色收：原图底色深浅不一（塔罗是暖灰褐，占星近黑），
// 边缘统一压向 --void，三张并排时才像同一个殿堂里的三扇窗。
const VIGNETTE =
  'radial-gradient(ellipse 88% 72% at 50% 36%, transparent 42%, rgba(6,6,15,0.62) 100%),' +
  'linear-gradient(to right, rgba(6,6,15,0.5) 0%, transparent 20%, transparent 80%, rgba(6,6,15,0.5) 100%),' +
  'linear-gradient(to bottom, rgba(6,6,15,0.28) 0%, transparent 22%, transparent 58%, rgba(6,6,15,0.7) 100%)';
// 下沿溶进背景，字排在窗下、不压在图上
const DISSOLVE = 'linear-gradient(to bottom, #000 68%, transparent 100%)';
// 拱框金线只描上半，往下淡出
const FRAME_FADE = 'linear-gradient(to bottom, #000 30%, transparent 78%)';

const SessionButtons: React.FC<SessionButtonsProps> = ({
  onSelectSession,
  disabled = false,
  pendingType = null,
}) => {
  const reduceMotion = useReducedMotion();
  const buttons: SessionDef[] = [
    {
      type: 'tarot' as SessionType,
      portrait: '/assets/avatar-tarot.webp',
      label: '塔罗',
      en: 'TAROT',
      tagline: '于牌阵中窥见命运的纹路',
      accent: '#C9A96E', // antique gold
    },
    {
      type: 'astrology' as SessionType,
      portrait: '/assets/avatar-astrology.webp',
      label: '占星',
      en: 'ASTROLOGY',
      tagline: '聆听星辰絮语般的指引',
      accent: '#A8D8EA', // moonlight blue
      badge: '内测中',
    },
    {
      type: 'chat' as SessionType,
      portrait: '/assets/avatar-solace.webp',
      label: '聊愈',
      en: 'SOLACE',
      tagline: '倾诉心声的静谧港湾',
      accent: '#B98A6E', // warm ember
      badge: '即将推出',
      comingSoon: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-7 gap-y-10 sm:gap-x-9 lg:gap-x-12 w-full max-w-[900px]">
      {buttons.map((button, index) => {
        const isPending = pendingType === button.type;
        // 窄屏两列只放得下两扇拱窗；「即将推出」那张收成整行的小条
        const compact = button.comingSoon;
        return (
        <motion.div
          key={button.type}
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 + index * 0.12, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
          className={`relative ${compact ? 'col-span-2 sm:col-span-1' : ''}`}
        >
          <motion.button
            onClick={() => !button.comingSoon && onSelectSession(button.type)}
            disabled={disabled || button.comingSoon}
            whileHover={!button.comingSoon && !reduceMotion ? { y: -6 } : {}}
            whileTap={!button.comingSoon ? { scale: 0.985 } : {}}
            style={{ '--accent': button.accent } as React.CSSProperties}
            className={`
              group relative w-full flex items-center
              ${compact ? 'flex-row gap-5 text-left sm:flex-col sm:gap-0 sm:text-center' : 'flex-col text-center'}
              ${button.comingSoon ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            {/* arch window */}
            <span className={`relative block aspect-[4/5] ${compact ? 'w-[4.5rem] shrink-0 sm:w-full' : 'w-full'}`}>
              {/* 背光：从拱窗背后透出、往四周晕开。浓的那段落在窗沿以外（窗里被立绘挡住），
                  下沿收在窗高 85% 处，不晕到下面的字上。悬停时亮起并略微外扩。 */}
              <span
                aria-hidden
                className={`absolute -inset-x-12 -top-12 bottom-[15%] blur-2xl transition-[opacity,transform] duration-[900ms] ease-out ${
                  button.comingSoon
                    ? 'opacity-15 scale-95'
                    : 'opacity-25 scale-95 group-hover:opacity-100 group-hover:scale-100 motion-reduce:scale-100'
                }`}
                style={{ background: `radial-gradient(closest-side, ${button.accent}8c 62%, transparent 100%)` }}
              />

              {/* gold hairline arch, set 6px off the art, fading down the sides */}
              <span
                aria-hidden
                className={`absolute -inset-1.5 rounded-t-full border border-b-0 transition-[opacity,filter] duration-700 ${
                  button.comingSoon
                    ? 'opacity-40'
                    : 'opacity-50 group-hover:opacity-100 group-hover:drop-shadow-[0_0_5px_var(--accent)]'
                }`}
                style={{ borderColor: button.accent, WebkitMaskImage: FRAME_FADE, maskImage: FRAME_FADE }}
              />
              {/* keystone */}
              <span
                aria-hidden
                className={`absolute left-1/2 -translate-x-1/2 -top-[22px] text-[10px] leading-none transition-[opacity,transform,text-shadow] duration-700 ${
                  compact ? 'hidden sm:block' : ''
                } ${
                  button.comingSoon
                    ? 'opacity-50'
                    : 'opacity-70 group-hover:opacity-100 group-hover:scale-125 group-hover:[text-shadow:0_0_10px_var(--accent)]'
                }`}
                style={{ color: button.accent }}
              >
                ✦
              </span>

              {/* the portrait: whole image height, bottom dissolving into the void */}
              <span
                className="absolute inset-0 rounded-t-full overflow-hidden"
                style={{ WebkitMaskImage: DISSOLVE, maskImage: DISSOLVE }}
              >
                <img
                  src={button.portrait}
                  alt=""
                  width={720}
                  height={720}
                  decoding="async"
                  className="w-full h-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
                <span aria-hidden className="absolute inset-0" style={{ background: VIGNETTE }} />
                {!button.comingSoon && (
                  <>
                    {/* 选中：拱顶内沿亮起一道光，像光从上方落进窗里 */}
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-t-full opacity-0 transition-opacity duration-700 group-hover:opacity-100"
                      style={{ boxShadow: `inset 0 1px 0 ${button.accent}66, inset 0 22px 40px -22px ${button.accent}80` }}
                    />
                    {/* 选中：背光透进窗里，四周暗角被照亮，人物像站在光前面 */}
                    <span
                      aria-hidden
                      className="absolute inset-0 mix-blend-screen opacity-0 transition-opacity duration-[900ms] ease-out group-hover:opacity-100"
                      style={{ background: `radial-gradient(ellipse 78% 68% at 50% 40%, transparent 52%, ${button.accent}47 100%)` }}
                    />
                  </>
                )}
              </span>
            </span>

            {/* text — below the window, never on it */}
            <span
              className={`relative flex flex-col gap-1.5 ${
                compact ? 'items-start sm:items-center sm:mt-2' : 'items-center mt-2'
              }`}
            >
              <span
                className="text-[10px] tracking-[0.34em] font-display"
                style={{ color: button.comingSoon ? 'var(--ivory-faint)' : button.accent }}
              >
                {button.en}
              </span>
              <span className="font-display font-semibold text-lg sm:text-xl tracking-[0.12em]" style={{ color: 'var(--ivory)' }}>
                {button.label}
              </span>
              <span className="text-xs leading-relaxed text-balance" style={{ color: 'var(--ivory-dim)' }}>
                {button.tagline}
              </span>

              {button.badge && (
                <span
                  className="mt-1 px-2.5 py-1 rounded-full text-[10px] tracking-wider border border-white/10 bg-white/[0.03]"
                  style={{ color: 'var(--ivory-faint)' }}
                >
                  {button.badge}
                </span>
              )}
              {!button.comingSoon && (
                /* enter cue / 落座中：挂在字下面、不占行，拱窗这一行矮一截，殿堂才放得下下面那排入口 */
                <span
                  className={`absolute top-full inset-x-0 mt-1 text-xs tracking-[0.3em] font-display transition-opacity duration-500 ${
                    isPending ? 'opacity-100 animate-pulse' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  style={{ color: button.accent }}
                >
                  {isPending ? '落座中…' : '进入 ›'}
                </span>
              )}
            </span>
          </motion.button>
        </motion.div>
        );
      })}
    </div>
  );
};

export default SessionButtons;
