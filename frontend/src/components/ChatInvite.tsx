import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { CARD_BACK_IMAGE } from '@/config/tarotCards';

/**
 * 占卜师在回复里递过来的那一步：抽牌 / 补充资料。
 * 和殿堂那排次级入口（HubStrip）同一套写法——左边一格小图，右边眉题 + 标题 + 一行说明，
 * 外面一圈发丝细框；悬停时背光亮起、框线变亮，小图跟着动一下。
 * 模型还在等用户动手，所以小图一直在轻轻呼吸（同殿堂上还没抽的每日一签）。
 */

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** 抽牌：按牌阵张数扇开几张牌背（最多三张），悬停时再张开一点 */
const MiniSpread: React.FC<{ count: number; hovered: boolean; still: boolean }> = ({ count, hovered, still }) => {
  const n = Math.max(1, Math.min(3, count));
  return (
    <span className="relative flex items-end h-12">
      {Array.from({ length: n }, (_, i) => {
        const off = i - (n - 1) / 2;
        return (
          <motion.span
            key={i}
            className="block w-[26px] h-[42px] rounded-[4px] overflow-hidden"
            style={{
              marginLeft: i ? -13 : 0,
              transformOrigin: 'bottom center',
              border: '1px solid rgba(201,169,110,0.5)',
              zIndex: 5 - Math.abs(off),
            }}
            animate={{
              rotate: off * 11,
              x: hovered ? off * 5 : 0,
              y: hovered ? -3 : 0,
              boxShadow: still
                ? '0 4px 10px rgba(0,0,0,0.5)'
                : ['0 0 6px rgba(201,169,110,0.12)', '0 0 16px rgba(201,169,110,0.5)', '0 0 6px rgba(201,169,110,0.12)'],
            }}
            transition={{
              default: { type: 'spring', stiffness: 220, damping: 20 },
              boxShadow: { duration: 4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.25 },
            }}
          >
            <img src={CARD_BACK_IMAGE} alt="" aria-hidden className="w-full h-full object-cover" draggable={false} />
          </motion.span>
        );
      })}
    </span>
  );
};

/** 补充资料：一枚小星盘，外圈十二宫刻度，几颗行星在呼吸；悬停时转过一宫 */
const MiniChart: React.FC<{ hovered: boolean; still: boolean }> = ({ hovered, still }) => (
  <motion.svg
    width="44"
    height="44"
    viewBox="0 0 44 44"
    fill="none"
    aria-hidden
    animate={{ rotate: hovered ? 30 : 0 }}
    transition={{ type: 'spring', stiffness: 120, damping: 18 }}
  >
    <circle cx="22" cy="22" r="19" stroke="var(--moon)" strokeOpacity="0.55" />
    <circle cx="22" cy="22" r="12.5" stroke="var(--moon)" strokeOpacity="0.28" />
    {Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      return (
        <line
          key={i}
          x1={22 + Math.cos(a) * 12.5}
          y1={22 + Math.sin(a) * 12.5}
          x2={22 + Math.cos(a) * 19}
          y2={22 + Math.sin(a) * 19}
          stroke="var(--moon)"
          strokeOpacity="0.28"
        />
      );
    })}
    {[
      [22 + 15.7 * Math.cos(-1.1), 22 + 15.7 * Math.sin(-1.1), 1.9],
      [22 + 15.7 * Math.cos(2.2), 22 + 15.7 * Math.sin(2.2), 1.5],
      [22 + 15.7 * Math.cos(0.6), 22 + 15.7 * Math.sin(0.6), 1.3],
    ].map(([cx, cy, r], i) => (
      <motion.circle
        key={i}
        cx={cx}
        cy={cy}
        r={r}
        fill="var(--moon-bright)"
        animate={{ opacity: still ? 0.85 : [0.35, 1, 0.35] }}
        transition={still ? { duration: 0 } : { duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.5 }}
      />
    ))}
    <circle cx="22" cy="22" r="1.6" fill="var(--moon)" fillOpacity="0.7" />
  </motion.svg>
);

interface ChatInviteProps {
  kind: 'draw' | 'profile';
  /** 按钮上那一句（用户这一方的话） */
  title: string;
  /** 抽牌：牌阵的位置，写在说明那一行，个数定小图扇几张 */
  positions?: string[];
  /** 前面有正文：先画一道带 ✦ 的金线把它和正文隔开 */
  afterText?: boolean;
  onClick: () => void;
}

const ChatInvite: React.FC<ChatInviteProps> = ({ kind, title, positions = [], afterText = false, onClick }) => {
  const [hovered, setHovered] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const isDraw = kind === 'draw';
  const accent = isDraw ? '#C9A96E' : '#A8D8EA';

  const en = isDraw ? 'The Draw' : 'Birth Chart';
  const tag = isDraw ? (positions.length ? `${positions.length} 张` : '') : '出生资料';
  const line = isDraw
    ? positions.length
      ? positions.join(' · ') // 不断行空格把 · 贴在前一个位置上，折行只落在 · 后面
      : '洗牌之后，凭直觉选牌'
    : '出生日期 · 时间 · 城市，用来排出星盘';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12, duration: 0.5, ease: EASE }}
      className={afterText ? 'mt-5' : ''}
    >
      {afterText && (
        <div aria-hidden className="flex items-center gap-2.5 mb-4">
          <span className="flex-1 h-px" style={{ background: `linear-gradient(to right, transparent, ${accent}59)` }} />
          <span className="text-[9px] leading-none" style={{ color: accent }}>✦</span>
          <span className="flex-1 h-px" style={{ background: `linear-gradient(to left, transparent, ${accent}59)` }} />
        </div>
      )}

      <motion.button
        type="button"
        onClick={onClick}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        whileHover={reduceMotion ? {} : { y: -2 }}
        whileTap={{ scale: 0.985 }}
        // 手机上不设最小宽度：气泡那一列只有 ~300px，17rem 会把气泡撑出屏幕、拖出横向滚动
        className="group relative w-full sm:min-w-[20rem] flex items-center gap-4 pl-3 pr-3.5 py-3 rounded-2xl text-left"
      >
        {/* 背光：从小图那一格透出来，悬停时亮起 */}
        <span
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 w-28 h-28 rounded-full blur-2xl pointer-events-none transition-opacity duration-700 opacity-40 group-hover:opacity-100"
          style={{ background: `radial-gradient(closest-side, ${accent}40, transparent)` }}
        />
        {/* 发丝细框：常态一层淡的，悬停时亮的那层淡入 */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ border: `1px solid ${accent}4d`, background: `linear-gradient(100deg, ${accent}0d, ${accent}03 60%)` }}
        />
        <span
          aria-hidden
          className="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{ border: `1px solid ${accent}b3`, boxShadow: `0 0 26px ${accent}24, inset 0 1px 0 ${accent}33` }}
        />

        <span className="relative flex-shrink-0 w-16 h-12 grid place-items-center">
          {isDraw ? (
            <MiniSpread count={positions.length || 1} hovered={hovered} still={reduceMotion} />
          ) : (
            <MiniChart hovered={hovered && !reduceMotion} still={reduceMotion} />
          )}
        </span>

        <span className="relative flex-1 min-w-0">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="eyebrow" style={{ fontSize: '9px', letterSpacing: '0.3em', color: accent }}>
              {en}
            </span>
            {tag && (
              <span className="text-[9px] tracking-[0.16em] font-display" style={{ color: 'var(--ivory-faint)' }}>
                {tag}
              </span>
            )}
          </span>
          <span className="block font-display text-[15px] tracking-[0.14em] mt-1" style={{ color: 'var(--ivory)' }}>
            {title}
          </span>
          {/* 手机上折行写全牌阵各位置（窄屏截断会把后几个位置吞掉），break-keep 不把「未来」拆成两行；桌面一行截断 */}
          <span className="block text-[11px] mt-0.5 tracking-[0.06em] break-keep sm:truncate" style={{ color: 'var(--ivory-faint)' }}>
            {line}
          </span>
        </span>

        {/* 去向：一枚发丝圆里的箭头，悬停时往前探一点 */}
        <span
          className="relative flex-shrink-0 w-8 h-8 rounded-full grid place-items-center transition-[transform,background-color] duration-300 group-hover:translate-x-0.5"
          style={{ border: `1px solid ${accent}73`, color: accent, background: `${accent}0f` }}
        >
          <ChevronRight size={15} />
        </span>
      </motion.button>
    </motion.div>
  );
};

export default ChatInvite;
