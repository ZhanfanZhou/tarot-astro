import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Feather } from 'lucide-react';
import Markdown from '../Markdown';
import { dailyApi } from '@/services/api';
import { toast } from '@/stores/useToastStore';
import type { JourneyEntry } from '@/types';

const VOLUME_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 卷一、卷二……超过十卷就写数字,不硬凑中文数字 */
const volumeLabel = (index: number) =>
  `卷${index < 10 ? VOLUME_NUMERALS[index] : index + 1}`;

/** "2026-09-05 ~ 2026-09-19" → "9月5日 — 9月19日" */
const formatRange = (range: string) => {
  const day = (iso: string) => {
    const [, m, d] = iso.split('-');
    return m && d ? `${Number(m)}月${Number(d)}日` : iso;
  };
  const [from, to] = range.split('~').map((s) => s.trim());
  if (!to) return day(from);
  return from === to ? day(from) : `${day(from)} — ${day(to)}`;
};

interface JourneyChronicleProps {
  isOpen: boolean;
  userId: string;
  todayDate: string;
  onClose: () => void;
}

/**
 * 心灵奇旅的卷宗:写过的每一篇都留在这里,按时间成卷。
 *
 * 只读——旅程是一次性的记述,不能续写、不能对话,写过的篇目不能重写;一天只写一篇。
 */
const JourneyChronicle: React.FC<JourneyChronicleProps> = ({
  isOpen,
  userId,
  todayDate,
  onClose,
}) => {
  const [entries, setEntries] = useState<JourneyEntry[]>([]);   // 新→旧
  const [ready, setReady] = useState(false);
  const [pendingToday, setPendingToday] = useState(false);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');   // 正在流式写下的那一篇

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await dailyApi.journeys(userId, todayDate);
      setEntries(list.entries);
      setReady(list.ready);
      setPendingToday(list.pending_today);
      setSelected(0);
    } catch (error) {
      console.error('[Journey] 加载卷宗失败:', error);
      toast.error('卷宗一时翻不开,请稍后再试');
    } finally {
      setLoading(false);
    }
  }, [userId, todayDate]);

  useEffect(() => {
    if (isOpen) {
      setDraft('');
      load();
    }
  }, [isOpen, load]);

  const write = async () => {
    setWriting(true);
    setDraft('');
    try {
      await dailyApi.journey(userId, todayDate, (chunk) =>
        setDraft((prev) => prev + chunk)
      );
      await load();
    } catch (error: any) {
      toast.error(error?.message || '旅程一时写不出来,请稍后再试');
    } finally {
      setWriting(false);
      setDraft('');
    }
  };

  const current = entries[selected];
  const total = entries.length;
  const hasToday = entries.some((e) => e.generated_on === todayDate);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 16 }}
            transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative w-full max-w-[880px] max-h-[88vh] rounded-2xl overflow-hidden flex flex-col"
            style={{
              background: 'linear-gradient(160deg, rgba(18,18,30,0.97) 0%, rgba(8,8,18,0.97) 100%)',
              border: '1px solid rgba(201,169,110,0.3)',
              boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
            }}
          >
            {/* 顶上的一点微光 */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-40"
              style={{
                background:
                  'radial-gradient(60% 100% at 50% 0%, rgba(201,169,110,0.16) 0%, transparent 70%)',
              }}
            />

            {/* Header */}
            <div className="relative flex items-start justify-between px-5 sm:px-7 pt-6 pb-4">
              <div>
                <span
                  className="eyebrow block"
                  style={{ fontSize: '10px', letterSpacing: '0.3em', color: 'var(--gold)' }}
                >
                  JOURNEY
                </span>
                <h2
                  className="font-display font-semibold text-xl tracking-[0.1em] mt-0.5"
                  style={{ color: 'var(--ivory)' }}
                >
                  心灵奇旅
                </h2>
                <p className="text-[11px] mt-1" style={{ color: 'var(--ivory-faint)' }}>
                  写过的旅程都留在这里 · 只供回望,不再改动
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg transition-colors hover:bg-white/[0.05]"
                style={{ color: 'var(--ivory-dim)' }}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>

            <div
              className="relative flex-1 min-h-0 flex flex-col sm:flex-row"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              {/* 卷目 */}
              {total > 0 && (
                <nav
                  className="flex-shrink-0 sm:w-[196px] overflow-x-auto sm:overflow-y-auto px-5 sm:px-4 py-3 sm:py-5 flex sm:block gap-3"
                  style={{ borderRight: '1px solid var(--line)' }}
                >
                  {entries.map((entry, i) => {
                    const active = i === selected;
                    return (
                      <button
                        key={entry.generated_on}
                        onClick={() => setSelected(i)}
                        className="group relative flex-shrink-0 text-left sm:w-full sm:flex sm:items-start sm:gap-3 py-1.5"
                      >
                        {/* 星链:圆点 + 连线 */}
                        <span className="hidden sm:flex flex-col items-center pt-1.5">
                          <span
                            className="block rounded-full transition-all duration-300"
                            style={{
                              width: active ? 7 : 5,
                              height: active ? 7 : 5,
                              background: active ? 'var(--gold-bright)' : 'var(--gold-deep)',
                              boxShadow: active ? '0 0 10px rgba(240,208,144,0.6)' : 'none',
                            }}
                          />
                          {i < total - 1 && (
                            <span
                              className="block w-px flex-1 mt-1"
                              style={{ minHeight: 26, background: 'var(--line)' }}
                            />
                          )}
                        </span>
                        <span className="block">
                          <span
                            className="block font-display text-[11px] tracking-[0.22em]"
                            style={{ color: active ? 'var(--gold)' : 'var(--ivory-faint)' }}
                          >
                            {volumeLabel(total - 1 - i)}
                          </span>
                          <span
                            className="block text-xs mt-0.5 whitespace-nowrap"
                            style={{ color: active ? 'var(--ivory)' : 'var(--ivory-dim)' }}
                          >
                            {formatRange(entry.date_range)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </nav>
              )}

              {/* 正文 */}
              <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-8 py-6">
                {writing ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <span
                      className="font-display text-[11px] tracking-[0.28em]"
                      style={{ color: 'var(--gold)' }}
                    >
                      正在回望……
                    </span>
                    <div className="mt-4">
                      {draft ? (
                        <Markdown content={draft} />
                      ) : (
                        <p className="text-sm" style={{ color: 'var(--ivory-dim)' }}>
                          占卜师正翻看这些日子的牌与笔记。
                        </p>
                      )}
                    </div>
                  </motion.div>
                ) : current ? (
                  <motion.article
                    key={current.generated_on}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <div>
                        <span
                          className="font-display text-sm tracking-[0.2em]"
                          style={{ color: 'var(--gold)' }}
                        >
                          {volumeLabel(total - 1 - selected)}
                        </span>
                        <span className="text-xs ml-3" style={{ color: 'var(--ivory-dim)' }}>
                          {formatRange(current.date_range)}
                        </span>
                      </div>
                    </div>
                    <span
                      aria-hidden
                      className="block h-px my-4"
                      style={{
                        background:
                          'linear-gradient(to right, var(--gold), transparent 70%)',
                        opacity: 0.6,
                      }}
                    />
                    <Markdown content={current.text} />
                  </motion.article>
                ) : (
                  /* 还没有任何一篇 */
                  <div className="h-full flex flex-col items-center justify-center text-center py-10">
                    <Feather size={22} style={{ color: 'var(--gold-deep)' }} />
                    <p
                      className="font-display text-base tracking-[0.12em] mt-4"
                      style={{ color: 'var(--ivory)' }}
                    >
                      卷宗还是空的
                    </p>
                    <p
                      className="text-xs mt-2 leading-relaxed max-w-[300px]"
                      style={{ color: 'var(--ivory-dim)' }}
                    >
                      {loading
                        ? '正在翻开卷宗……'
                        : ready
                          ? '这些日子的牌与占卜已经够串成一段了。'
                          : '再积累几次日签或占卜,旅程自会显形。'}
                    </p>
                    {ready && !loading && (
                      <button
                        onClick={write}
                        className="mt-5 px-5 py-2 rounded-lg font-display text-sm tracking-[0.16em] transition-colors"
                        style={{
                          color: 'var(--gold)',
                          border: '1px solid rgba(201,169,110,0.4)',
                        }}
                      >
                        写下这一篇 ✦
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 页脚:今日尚未归档的提示 —— 看得见,但不抢戏 */}
            {(pendingToday || (ready && !hasToday && total > 0)) && (
              <div
                className="relative px-5 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-2"
                style={{ borderTop: '1px solid var(--line)' }}
              >
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ivory-faint)' }}>
                  {pendingToday
                    ? '今天的对话还在占卜师案头,要等他下班后归档成笔记——这一篇写得到今天抽了哪些牌,聊了些什么还写不进来。'
                    : '这些日子又攒下新的牌,可以再写一篇。'}
                </p>
                {ready && !hasToday && !writing && (
                  <button
                    onClick={write}
                    className="flex-shrink-0 font-display text-[11px] tracking-[0.16em] transition-colors hover:text-white"
                    style={{ color: 'var(--gold)' }}
                  >
                    写下新的一篇 ✦
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default JourneyChronicle;
