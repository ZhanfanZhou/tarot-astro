import React from 'react';
import { motion } from 'framer-motion';
import { CARD_BACK_IMAGE, getCardInfo } from '@/config/tarotCards';
import { isEveningDraw } from '@/utils/dailyDate';
import type { DailyOverview } from '@/types';

interface DailyOracleBannerProps {
  overview: DailyOverview | null;
  onOpen: () => void;
}

/** 殿堂主页「每日一签」仪式入口:未抽=呼吸辉光牌背,已抽=今日牌面+签语 */
const DailyOracleBanner: React.FC<DailyOracleBannerProps> = ({ overview, onOpen }) => {
  const [hovered, setHovered] = React.useState(false);
  const record = overview?.today_record ?? null;
  const todayView = overview?.history[overview.history.length - 1];
  const tagline = todayView?.tagline;
  const streak = overview?.streak ?? 0;
  const cardInfo = record ? getCardInfo(record.card.card_id) : undefined;
  const evening = isEveningDraw();

  return (
    <motion.button
      onClick={onOpen}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.65, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
      whileHover={{ y: -3 }}
      className="group relative w-full rounded-2xl overflow-hidden flex items-center gap-5 sm:gap-7 px-5 sm:px-7 py-4 text-left"
      style={{
        background: 'linear-gradient(110deg, rgba(18,18,30,0.7) 0%, rgba(11,11,22,0.5) 100%)',
        border: `1px solid ${hovered ? 'rgba(201,169,110,0.5)' : 'var(--line)'}`,
        boxShadow: hovered
          ? '0 18px 50px rgba(0,0,0,0.5), 0 0 30px rgba(201,169,110,0.1)'
          : '0 10px 30px rgba(0,0,0,0.3)',
        transition: 'border-color .4s, box-shadow .4s',
      }}
    >
      {/* 牌位:未抽=呼吸辉光牌背,已抽=今日牌面 */}
      <span className="relative flex-shrink-0">
        <motion.span
          className="block w-[44px] h-[72px] rounded-md overflow-hidden"
          style={{ border: '1px solid rgba(201,169,110,0.4)' }}
          animate={
            record
              ? { y: 0, boxShadow: '0 6px 16px rgba(0,0,0,0.5)' }
              : {
                  y: hovered ? -4 : 0,
                  boxShadow: [
                    '0 0 10px rgba(201,169,110,0.15)',
                    '0 0 22px rgba(201,169,110,0.45)',
                    '0 0 10px rgba(201,169,110,0.15)',
                  ],
                }
          }
          transition={
            record
              ? { duration: 0.4 }
              : { boxShadow: { duration: 4, repeat: Infinity, ease: 'easeInOut' }, y: { duration: 0.3 } }
          }
        >
          <motion.img
            key={record ? 'face' : 'back'}
            initial={record ? { rotateY: 90 } : false}
            animate={{ rotateY: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            src={record ? cardInfo?.imageUrl || CARD_BACK_IMAGE : CARD_BACK_IMAGE}
            alt=""
            aria-hidden
            className="w-full h-full object-cover"
            style={{ transform: record?.card.reversed ? 'rotate(180deg)' : undefined }}
            loading="lazy"
          />
        </motion.span>
      </span>

      {/* 文案 */}
      <span className="flex-1 min-w-0">
        <span
          className="eyebrow block"
          style={{ fontSize: '10px', letterSpacing: '0.3em', color: 'var(--gold)' }}
        >
          DAILY ORACLE
        </span>
        <span
          className="block font-display font-semibold text-lg tracking-[0.1em] mt-1"
          style={{ color: 'var(--ivory)' }}
        >
          {record
            ? `${record.card.card_name} · ${record.card.reversed ? '逆位' : '正位'}`
            : evening
              ? '为明日求一签'
              : '今日一签 · 待启'}
        </span>
        <span
          className="block text-xs mt-1 leading-relaxed truncate"
          style={{ color: 'var(--ivory-dim)' }}
        >
          {record ? tagline || '今日的指引已揭示' : '静心抽取,看看今天的指引'}
        </span>
      </span>

      {/* streak 徽记(N≥2 才显示) */}
      {streak >= 2 && (
        <span
          className="absolute top-3 right-4 sm:right-5 text-[10px] tracking-[0.18em] font-display"
          style={{ color: 'var(--gold)' }}
        >
          连续 {streak} 天 ✦
        </span>
      )}

      {/* affordance */}
      <span
        className="flex-shrink-0 hidden sm:flex items-center gap-1.5 text-sm tracking-[0.18em] font-display transition-transform duration-300 group-hover:translate-x-1"
        style={{ color: 'var(--gold)' }}
      >
        {record ? '查看今日指引 ›' : '抽取 ›'}
      </span>
    </motion.button>
  );
};

export default DailyOracleBanner;
