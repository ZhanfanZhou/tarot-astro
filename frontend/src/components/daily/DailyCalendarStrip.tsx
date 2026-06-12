import React from 'react';
import { motion } from 'framer-motion';
import { getCardInfo } from '@/config/tarotCards';
import type { DailyDayView } from '@/types';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface DailyCalendarStripProps {
  history: DailyDayView[]; // 升序,最后一格为今日
  todayDate: string;
  selectedDate: string | null;
  onSelect: (date: string) => void;
}

/** 两周日历带:过往日显示牌面缩略,空日为暗格,今日金边高亮,逐格 stagger 浮现 */
const DailyCalendarStrip: React.FC<DailyCalendarStripProps> = ({
  history,
  todayDate,
  selectedDate,
  onSelect,
}) => (
  <div
    className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1"
    role="listbox"
    aria-label="近两周日运"
  >
    {history.map((day, i) => {
      const d = new Date(`${day.effective_date}T00:00:00`);
      const isToday = day.effective_date === todayDate;
      const isSelected = day.effective_date === selectedDate;
      const img = day.record ? getCardInfo(day.record.card.card_id)?.imageUrl : undefined;
      return (
        <motion.button
          key={day.effective_date}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.35 }}
          onClick={() => onSelect(day.effective_date)}
          className="flex-shrink-0 flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors hover:bg-white/[0.04]"
          style={{
            border: `1px solid ${
              isSelected ? 'var(--gold)' : isToday ? 'rgba(201,169,110,0.5)' : 'transparent'
            }`,
            background: isSelected ? 'rgba(201,169,110,0.08)' : 'transparent',
          }}
          role="option"
          aria-selected={isSelected}
          aria-label={`${day.effective_date}${day.record ? ` ${day.record.card.card_name}` : ' 未抽签'}`}
        >
          <span
            className="text-[9px] tracking-wider"
            style={{ color: isToday ? 'var(--gold)' : 'var(--ivory-dim)' }}
          >
            {isToday ? '今' : WEEKDAYS[d.getDay()]}
          </span>
          <span
            className="w-7 h-11 rounded-[3px] overflow-hidden flex items-center justify-center"
            style={{
              border: '1px solid',
              borderColor: day.record ? 'rgba(201,169,110,0.4)' : 'var(--line)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            {img ? (
              <img
                src={img}
                alt=""
                aria-hidden
                className="w-full h-full object-cover"
                style={{ transform: day.record!.card.reversed ? 'rotate(180deg)' : 'none' }}
                loading="lazy"
              />
            ) : (
              <span className="text-[10px]" style={{ color: 'var(--line)' }}>
                ·
              </span>
            )}
          </span>
          <span className="text-[9px]" style={{ color: 'var(--ivory-dim)' }}>
            {d.getDate()}
          </span>
        </motion.button>
      );
    })}
  </div>
);

export default DailyCalendarStrip;
