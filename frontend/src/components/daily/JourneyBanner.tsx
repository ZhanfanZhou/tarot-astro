import React from 'react';
import { motion } from 'framer-motion';
import type { DailyOverview } from '@/types';

interface JourneyBannerProps {
  overview: DailyOverview | null;
  isGuest: boolean;
  onOpen: () => void;
}

/** 三颗星连成的一段路:悬停时亮起来 */
const Constellation: React.FC<{ lit: boolean; dim: boolean }> = ({ lit, dim }) => (
  <span aria-hidden className="relative flex-shrink-0 block" style={{ width: 54, height: 22 }}>
    <svg width="54" height="22" viewBox="0 0 54 22" fill="none">
      <motion.path
        d="M4 16 L20 6 L36 15 L50 5"
        stroke="var(--gold)"
        strokeWidth="1"
        strokeLinecap="round"
        initial={false}
        animate={{ opacity: dim ? 0.15 : lit ? 0.75 : 0.35 }}
        transition={{ duration: 0.5 }}
      />
      {[
        [4, 16, 1.8],
        [20, 6, 2.6],
        [36, 15, 1.8],
        [50, 5, 2.2],
      ].map(([cx, cy, r], i) => (
        <motion.circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill={dim ? 'var(--gold-deep)' : 'var(--gold-bright)'}
          initial={false}
          animate={{ opacity: dim ? 0.4 : lit ? 1 : 0.7 }}
          transition={{ duration: 0.4, delay: lit ? i * 0.06 : 0 }}
        />
      ))}
    </svg>
  </span>
);

/**
 * 殿堂主页的心灵奇旅入口,贴在每日一签下面。
 * 做成一条细带而不是第三张卡片:它是日签那段日子的延长线,不该和牌廊、日签抢分量。
 * 游客没有可回望的记录,这里明写「注册专属」并挡住入口。
 */
const JourneyBanner: React.FC<JourneyBannerProps> = ({ overview, isGuest, onOpen }) => {
  const [hovered, setHovered] = React.useState(false);
  const count = overview?.journey_count ?? 0;
  const ready = overview?.journey_ready ?? false;
  // 游客进不去;注册用户只要写过就能回看,没写过则要素材够了才点得动
  const usable = !isGuest && (count > 0 || ready);

  const line = isGuest
    ? '旅程要有你自己的记录才写得出来'
    : count > 0
      ? ready
        ? '这些日子又攒下新的牌,可以再写一篇'
        : '回到卷宗,重读走过的那些日子'
      : ready
        ? '这些日子的牌与占卜,够串成一段了'
        : '再积累几次日签或占卜,旅程自会显形';

  return (
    <motion.button
      onClick={usable ? onOpen : undefined}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.78, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
      disabled={!usable}
      className="group relative w-full flex items-center gap-4 sm:gap-6 px-5 sm:px-7 py-3.5 text-left disabled:cursor-default"
      style={{
        marginTop: 8,                   // 紧贴上面那张日签卡(压掉容器的 space-y-6)
        borderTop: '1px solid var(--line)',
        opacity: usable ? 1 : 0.72,
      }}
    >
      <Constellation lit={usable && hovered} dim={!usable} />

      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span
            className="eyebrow"
            style={{ fontSize: '9px', letterSpacing: '0.3em', color: 'var(--gold)' }}
          >
            JOURNEY
          </span>
          {isGuest && (
            <span
              className="text-[9px] tracking-[0.18em] font-display px-1.5 py-0.5 rounded"
              style={{ color: 'var(--gold-deep)', border: '1px solid rgba(201,169,110,0.25)' }}
            >
              注册专属
            </span>
          )}
          {!isGuest && count > 0 && (
            <span className="text-[10px] tracking-[0.14em]" style={{ color: 'var(--ivory-faint)' }}>
              已写下 {count} 卷
            </span>
          )}
        </span>
        <span
          className="block font-display text-[15px] tracking-[0.1em] mt-1"
          style={{ color: usable ? 'var(--ivory)' : 'var(--ivory-dim)' }}
        >
          心灵奇旅 · 回望这段旅程
        </span>
        <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--ivory-faint)' }}>
          {line}
        </span>
      </span>

      {usable && (
        <span
          className="flex-shrink-0 hidden sm:block text-xs tracking-[0.18em] font-display transition-transform duration-300 group-hover:translate-x-1"
          style={{ color: 'var(--gold)' }}
        >
          {count > 0 ? '翻开 ›' : '写下 ›'}
        </span>
      )}
    </motion.button>
  );
};

export default JourneyBanner;
