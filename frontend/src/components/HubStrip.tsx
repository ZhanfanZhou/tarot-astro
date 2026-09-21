import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { CARD_BACK_IMAGE, getCardInfo } from '@/config/tarotCards';
import { isEveningDraw } from '@/utils/dailyDate';
import type { DailyOverview } from '@/types';

/**
 * 殿堂拱窗下的一排次级入口：塔罗牌廊 / 每日一签 / 心灵奇旅。
 * 一条金线分出三栏，不做卡片，和拱窗同宽，让三个主入口和它们一起落在一屏里。
 */

const FAN = ['the-high-priestess', 'the-star', 'the-moon'].map(
  (id) => `/tarot-images/decks/classic-rws/major/${id}.thumb.webp`
);

/** 牌廊：三张小牌扇开，悬停时再张开一点 */
const MiniFan: React.FC<{ hovered: boolean }> = ({ hovered }) => (
  <span className="relative flex items-end h-12" style={{ paddingLeft: 4 }}>
    {FAN.map((src, i) => {
      const off = i - 1;
      return (
        <motion.span
          key={src}
          className="block w-[26px] h-[42px] rounded-[4px] overflow-hidden"
          style={{
            marginLeft: i ? -13 : 0,
            transformOrigin: 'bottom center',
            border: '1px solid rgba(201,169,110,0.4)',
            boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
            zIndex: 5 - Math.abs(off),
          }}
          animate={{ rotate: off * 11, x: hovered ? off * 5 : 0, y: hovered ? -3 : 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        >
          <img
            src={src}
            alt=""
            aria-hidden
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => (e.currentTarget.style.opacity = '0')}
          />
        </motion.span>
      );
    })}
  </span>
);

/** 每日一签：未抽 = 呼吸辉光的牌背，已抽 = 今日牌面（逆位倒过来） */
const MiniDaily: React.FC<{ overview: DailyOverview | null; hovered: boolean }> = ({ overview, hovered }) => {
  const record = overview?.today_record ?? null;
  const face = record ? getCardInfo(record.card.card_id)?.imageUrl : undefined;
  return (
    <motion.span
      className="block w-[28px] h-[46px] rounded-[4px] overflow-hidden"
      style={{ border: '1px solid rgba(201,169,110,0.45)' }}
      animate={
        record
          ? { y: hovered ? -3 : 0, boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }
          : {
              y: hovered ? -3 : 0,
              boxShadow: ['0 0 8px rgba(201,169,110,0.15)', '0 0 18px rgba(201,169,110,0.5)', '0 0 8px rgba(201,169,110,0.15)'],
            }
      }
      transition={record ? { duration: 0.3 } : { boxShadow: { duration: 4, repeat: Infinity, ease: 'easeInOut' }, y: { duration: 0.3 } }}
    >
      <motion.img
        key={record ? 'face' : 'back'}
        initial={record ? { rotateY: 90 } : false}
        animate={{ rotateY: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        src={face || CARD_BACK_IMAGE}
        alt=""
        aria-hidden
        className="w-full h-full object-cover"
        style={{ transform: record?.card.reversed ? 'rotate(180deg)' : undefined }}
        loading="lazy"
      />
    </motion.span>
  );
};

/** 心灵奇旅：几颗星连成的一段路，悬停时亮起来 */
const MiniConstellation: React.FC<{ lit: boolean; dim: boolean }> = ({ lit, dim }) => (
  <svg width="48" height="22" viewBox="0 0 54 22" fill="none" aria-hidden>
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
);

const Cell: React.FC<{
  en: string;
  title: string;
  line: string;
  tag?: React.ReactNode;
  disabled?: boolean;
  visual: (hovered: boolean) => React.ReactNode;
  onClick: () => void;
}> = ({ en, title, line, tag, disabled = false, visual, onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.button
      onClick={disabled ? undefined : onClick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      disabled={disabled}
      className="group relative flex items-center gap-4 px-5 py-3 text-left disabled:cursor-default"
      style={{ opacity: disabled ? 0.72 : 1 }}
    >
      {/* 悬停时从小图那一格透出一点金光 */}
      <span
        aria-hidden
        className={`absolute left-3 top-1/2 -translate-y-1/2 w-20 h-20 rounded-full blur-2xl transition-opacity duration-700 opacity-0 ${
          disabled ? '' : 'group-hover:opacity-100'
        }`}
        style={{ background: 'radial-gradient(closest-side, rgba(201,169,110,0.28), transparent)' }}
      />
      <span className="relative flex-shrink-0 w-16 h-12 grid place-items-center">{visual(hovered && !disabled)}</span>
      <span className="relative flex-1 min-w-0">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className="eyebrow" style={{ fontSize: '9px', letterSpacing: '0.3em', color: 'var(--gold)' }}>{en}</span>
          {tag}
        </span>
        <span className="block font-display text-[15px] tracking-[0.1em] mt-1" style={{ color: disabled ? 'var(--ivory-dim)' : 'var(--ivory)' }}>
          {title}
        </span>
        <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--ivory-faint)' }}>{line}</span>
      </span>
      {!disabled && (
        <span
          className="relative flex-shrink-0 text-sm font-display transition-[opacity,transform] duration-300 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0"
          style={{ color: 'var(--gold)' }}
        >
          ›
        </span>
      )}
    </motion.button>
  );
};

interface HubStripProps {
  overview: DailyOverview | null;
  isGuest: boolean;
  onOpenDaily: () => void;
  onOpenJourney: () => void;
}

const HubStrip: React.FC<HubStripProps> = ({ overview, isGuest, onOpenDaily, onOpenJourney }) => {
  const navigate = useNavigate();

  // 每日一签
  const record = overview?.today_record ?? null;
  const tagline = overview?.history[overview.history.length - 1]?.tagline;
  const streak = overview?.streak ?? 0;

  // 心灵奇旅：游客进不去；注册用户只要写过就能回看，没写过则要素材够了才点得动
  const count = overview?.journey_count ?? 0;
  const ready = overview?.journey_ready ?? false;
  const journeyUsable = !isGuest && (count > 0 || ready);
  const journeyLine = isGuest
    ? '旅程要有你自己的记录才写得出来'
    : count > 0
      ? ready
        ? '这些日子又攒下新的牌,可以再写一篇'
        : '回到卷宗,重读走过的那些日子'
      : ready
        ? '这些日子的牌与占卜,够串成一段了'
        : '再积累几次日签或占卜,旅程自会显形';

  const smallTag = (text: string, boxed = false) => (
    <span
      className={`text-[9px] tracking-[0.16em] font-display ${boxed ? 'px-1.5 py-0.5 rounded' : ''}`}
      style={boxed ? { color: 'var(--gold-deep)', border: '1px solid rgba(201,169,110,0.25)' } : { color: 'var(--ivory-faint)' }}
    >
      {text}
    </span>
  );

  return (
    <motion.nav
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
      className="w-full max-w-[900px]"
      aria-label="牌廊与日签"
    >
      <div
        className="relative h-px"
        style={{ background: 'linear-gradient(to right, transparent, rgba(201,169,110,0.4) 18%, rgba(201,169,110,0.4) 82%, transparent)' }}
      >
        <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 text-[10px]" style={{ color: 'var(--gold)' }}>✦</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 pt-1 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--line-soft)]">
        <Cell
          en="Gallery"
          title="塔罗牌廊"
          line="78 张经典塔罗 · 多套艺术牌组"
          visual={(h) => <MiniFan hovered={h} />}
          onClick={() => navigate('/showcase')}
        />
        <Cell
          en="Daily Oracle"
          title={
            record
              ? `${record.card.card_name} · ${record.card.reversed ? '逆位' : '正位'}`
              : isEveningDraw()
                ? '为明日求一签'
                : '今日一签 · 待启'
          }
          line={record ? tagline || '今日的指引已揭示' : '静心抽取,看看今天的指引'}
          tag={streak >= 2 ? <span className="text-[9px] tracking-[0.16em] font-display" style={{ color: 'var(--gold)' }}>连续 {streak} 天</span> : undefined}
          visual={(h) => <MiniDaily overview={overview} hovered={h} />}
          onClick={onOpenDaily}
        />
        <Cell
          en="Journey"
          title="心灵奇旅"
          line={journeyLine}
          tag={isGuest ? smallTag('注册专属', true) : count > 0 ? smallTag(`已写下 ${count} 卷`) : undefined}
          disabled={!journeyUsable}
          visual={(h) => <MiniConstellation lit={h} dim={!journeyUsable} />}
          onClick={onOpenJourney}
        />
      </div>
    </motion.nav>
  );
};

export default HubStrip;
