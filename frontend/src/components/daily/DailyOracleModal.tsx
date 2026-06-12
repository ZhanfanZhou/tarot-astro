import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, RefreshCw } from 'lucide-react';
import TarotCardDrawer from '../TarotCardDrawer';
import DailyCalendarStrip from './DailyCalendarStrip';
import Markdown from '../Markdown';
import { conversationApi, dailyApi, tarotApi } from '@/services/api';
import { CARD_BACK_IMAGE, getCardInfo } from '@/config/tarotCards';
import { getEffectiveDate, isEveningDraw } from '@/utils/dailyDate';
import { toast } from '@/stores/useToastStore';
import { MessageRole } from '@/types';
import type { DailyDayView, DailyOverview, DrawCardsRequest } from '@/types';

const DAILY_DRAW_REQUEST: DrawCardsRequest = {
  spread_type: 'single',
  card_count: 1,
  positions: ['今日指引'],
};
// 与后端 services/daily_service.py 的 JOURNEY_MIN_RECORDS 保持一致
const JOURNEY_MIN_RECORDS = 3;

interface DailyOracleModalProps {
  isOpen: boolean;
  userId: string;
  overview: DailyOverview | null;
  onClose: () => void;
  onRefreshOverview: () => Promise<void>;
  onContinueConversation: (conversationId: string) => void;
}

/**
 * 每日一签弹窗:顶部两周日历带 + 今日舞台(抽牌/解读)+ 回顾态(印证)+ 心灵奇旅。
 * 选牌器是纯仪式——真实牌面来自 POST /api/daily/draw 的响应,在本弹窗内翻面揭示。
 */
const DailyOracleModal: React.FC<DailyOracleModalProps> = ({
  isOpen,
  userId,
  overview,
  onClose,
  onRefreshOverview,
  onContinueConversation,
}) => {
  const todayDate = overview?.today_effective_date ?? getEffectiveDate();
  const [selectedDate, setSelectedDate] = useState<string>(todayDate);
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawing, setDrawing] = useState(false);
  // conversation_id → 解读全文;undefined=未加载,null=对话已删除,''=尚无解读
  const [readings, setReadings] = useState<Record<string, string | null>>({});
  const [isReading, setIsReading] = useState(false);
  // 印证表单(回顾态)
  const [verdict, setVerdict] = useState<'hit' | 'miss' | null>(null);
  const [note, setNote] = useState('');
  const [savingFeedback, setSavingFeedback] = useState(false);
  // 心灵奇旅
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [journeyText, setJourneyText] = useState('');
  const [journeyLoading, setJourneyLoading] = useState(false);

  const selectedView: DailyDayView | undefined = overview?.history.find(
    (h) => h.effective_date === selectedDate
  );
  const record = selectedView?.record ?? null;
  const isToday = selectedDate === todayDate;
  const drawnCount = overview?.history.filter((h) => h.record).length ?? 0;
  const reading = record ? readings[record.conversation_id] : undefined;

  // 打开时重置到今日、收起旅程
  useEffect(() => {
    if (isOpen) {
      setSelectedDate(todayDate);
      setJourneyOpen(false);
      setJourneyText('');
    }
  }, [isOpen, todayDate]);

  // 选中某天:同步印证表单 + 懒取该日解读全文
  useEffect(() => {
    const view = overview?.history.find((h) => h.effective_date === selectedDate);
    setVerdict(view?.record?.feedback?.verdict ?? null);
    setNote(view?.record?.feedback?.note ?? '');
    const rec = view?.record;
    if (!rec || readings[rec.conversation_id] !== undefined) return;
    if (!view?.conversation_exists) {
      setReadings((prev) => ({ ...prev, [rec.conversation_id]: null }));
      return;
    }
    conversationApi
      .get(rec.conversation_id)
      .then((conv) => {
        const first = conv.messages.find((m) => m.role === MessageRole.ASSISTANT);
        setReadings((prev) => ({ ...prev, [rec.conversation_id]: first?.content ?? '' }));
      })
      .catch(() => setReadings((prev) => ({ ...prev, [rec.conversation_id]: null })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, overview, isOpen]);

  const streamReading = async (conversationId: string) => {
    setIsReading(true);
    setReadings((prev) => ({ ...prev, [conversationId]: '' }));
    try {
      await tarotApi.sendMessage(
        conversationId,
        '请根据抽牌结果进行解读',
        (chunk) =>
          setReadings((prev) => ({
            ...prev,
            [conversationId]: ((prev[conversationId] as string) || '') + chunk,
          })),
        () => {} // daily 解读不会再触发抽牌
      );
      await onRefreshOverview(); // 刷新签语/横幅
    } catch {
      toast.error('解读生成中断,可点「重新生成解读」再试');
    } finally {
      setIsReading(false);
    }
  };

  const handleCardsDrawn = async () => {
    // 选牌器仪式完成 → 调后端拿真实牌面 → 在弹窗里揭示并流式解读
    setShowDrawer(false);
    setDrawing(true);
    try {
      const eff = getEffectiveDate();
      const res = await dailyApi.draw(userId, eff);
      await onRefreshOverview();
      setSelectedDate(eff);
      await streamReading(res.conversation_id);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error('这一日已抽过签');
        await onRefreshOverview();
      } else {
        toast.error('抽牌失败,请重试');
      }
    } finally {
      setDrawing(false);
    }
  };

  const handleSaveFeedback = async () => {
    if (!verdict) return;
    setSavingFeedback(true);
    try {
      await dailyApi.feedback(userId, selectedDate, verdict, note.trim() || undefined);
      await onRefreshOverview();
      toast.success('已记下你的印证 ✦');
    } catch {
      toast.error('保存失败,请重试');
    } finally {
      setSavingFeedback(false);
    }
  };

  const handleJourney = async (force: boolean) => {
    setJourneyOpen(true);
    setJourneyText('');
    setJourneyLoading(true);
    try {
      await dailyApi.journey(userId, todayDate, force, (chunk) =>
        setJourneyText((prev) => prev + chunk)
      );
    } catch (e) {
      const status = (e as { status?: number })?.status;
      toast.error(status === 400 ? '再积累几天,旅程自会显形' : '旅程生成失败');
      setJourneyOpen(false);
    } finally {
      setJourneyLoading(false);
    }
  };

  const cardInfo = record ? getCardInfo(record.card.card_id) : undefined;

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              className="relative w-full max-w-[560px] max-h-[88vh] overflow-y-auto rounded-2xl px-5 sm:px-7 py-6"
              style={{
                background: 'linear-gradient(160deg, rgba(18,18,30,0.97) 0%, rgba(8,8,18,0.97) 100%)',
                border: '1px solid rgba(201,169,110,0.3)',
                boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <span
                    className="eyebrow block"
                    style={{ fontSize: '10px', letterSpacing: '0.3em', color: 'var(--gold)' }}
                  >
                    DAILY ORACLE
                  </span>
                  <h2
                    className="font-display font-semibold text-xl tracking-[0.08em] mt-0.5"
                    style={{ color: 'var(--ivory)' }}
                  >
                    每日一签 · 心灵奇旅
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => (journeyOpen ? setJourneyOpen(false) : handleJourney(false))}
                    disabled={drawnCount < JOURNEY_MIN_RECORDS}
                    className="hidden sm:inline-flex items-center gap-1.5 text-xs tracking-[0.12em] font-display px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ color: 'var(--gold)' }}
                    title={drawnCount < JOURNEY_MIN_RECORDS ? '再积累几天,旅程自会显形' : '回望这段旅程'}
                  >
                    <Sparkles size={13} />
                    {journeyOpen ? '回到今日' : '回望这段旅程 ✦'}
                  </button>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-lg transition-colors hover:bg-white/[0.05]"
                    style={{ color: 'var(--ivory-dim)' }}
                    aria-label="关闭"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* 日历带 */}
              {overview && (
                <DailyCalendarStrip
                  history={overview.history}
                  todayDate={todayDate}
                  selectedDate={selectedDate}
                  onSelect={(d) => {
                    setJourneyOpen(false);
                    setSelectedDate(d);
                  }}
                />
              )}
              {/* 移动端旅程入口 */}
              <button
                onClick={() => (journeyOpen ? setJourneyOpen(false) : handleJourney(false))}
                disabled={drawnCount < JOURNEY_MIN_RECORDS}
                className="sm:hidden mt-1 mb-1 text-xs tracking-[0.12em] font-display disabled:opacity-40"
                style={{ color: 'var(--gold)' }}
              >
                {journeyOpen ? '回到今日' : '回望这段旅程 ✦'}
              </button>

              {/* 舞台区 */}
              <div className="mt-5 min-h-[260px]">
                {journeyOpen ? (
                  /* ── 心灵奇旅面板 ── */
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="eyebrow" style={{ letterSpacing: '0.28em', color: 'var(--gold)' }}>
                        JOURNEY · 心灵奇旅
                      </span>
                      <button
                        onClick={() => handleJourney(true)}
                        disabled={journeyLoading}
                        className="inline-flex items-center gap-1 text-[11px] transition-colors hover:text-white disabled:opacity-40"
                        style={{ color: 'var(--ivory-dim)' }}
                      >
                        <RefreshCw size={11} />
                        重新生成
                      </button>
                    </div>
                    {journeyText ? (
                      <Markdown content={journeyText} />
                    ) : (
                      <p className="text-sm" style={{ color: 'var(--ivory-dim)' }}>
                        正在回望这段旅程……
                      </p>
                    )}
                  </motion.div>
                ) : !record ? (
                  isToday ? (
                    /* ── 今日未抽 ── */
                    <div className="flex flex-col items-center text-center py-4">
                      <motion.img
                        src={CARD_BACK_IMAGE}
                        alt=""
                        aria-hidden
                        className="w-[110px] h-[180px] rounded-lg object-cover"
                        style={{ border: '1px solid rgba(201,169,110,0.4)' }}
                        animate={{
                          boxShadow: [
                            '0 0 14px rgba(201,169,110,0.15)',
                            '0 0 30px rgba(201,169,110,0.4)',
                            '0 0 14px rgba(201,169,110,0.15)',
                          ],
                        }}
                        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <p className="mt-5 text-sm" style={{ color: 'var(--ivory-dim)' }}>
                        {isEveningDraw() ? '夜色已深,为明日求一签吧' : '一日一签,静心而后抽取'}
                      </p>
                      <button
                        onClick={() => setShowDrawer(true)}
                        disabled={drawing || isReading}
                        className="mt-4 px-7 py-2.5 rounded-xl font-display tracking-[0.15em] text-sm transition-all hover:brightness-110 disabled:opacity-50"
                        style={{
                          color: '#1a1407',
                          background: 'linear-gradient(120deg, #C9A96E, #E2C893)',
                          boxShadow: '0 8px 24px rgba(201,169,110,0.25)',
                        }}
                      >
                        {drawing ? '正在抽取…' : isEveningDraw() ? '静心 · 为明日抽签' : '静心 · 抽取今日指引'}
                      </button>
                    </div>
                  ) : (
                    /* ── 过往空日 ── */
                    <p className="text-center text-sm py-16" style={{ color: 'var(--ivory-dim)' }}>
                      这一日未曾抽签 ·
                    </p>
                  )
                ) : (
                  /* ── 有记录(今日已抽 / 回顾态) ── */
                  <div className="flex flex-col items-center">
                    <motion.div
                      key={record.conversation_id}
                      initial={{ rotateY: 90, opacity: 0 }}
                      animate={{ rotateY: 0, opacity: 1 }}
                      transition={{ duration: 0.55, ease: 'easeOut' }}
                      className="w-[110px] h-[180px] rounded-lg overflow-hidden"
                      style={{
                        border: '1px solid rgba(201,169,110,0.45)',
                        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                      }}
                    >
                      <img
                        src={cardInfo?.imageUrl || CARD_BACK_IMAGE}
                        alt={record.card.card_name}
                        className="w-full h-full object-cover"
                        style={{ transform: record.card.reversed ? 'rotate(180deg)' : 'none' }}
                      />
                    </motion.div>
                    <p
                      className="mt-3 font-display font-semibold tracking-[0.1em]"
                      style={{ color: 'var(--ivory)' }}
                    >
                      {record.card.card_name} · {record.card.reversed ? '逆位' : '正位'}
                    </p>

                    {/* 解读区 */}
                    <div className="w-full mt-4 text-left">
                      {reading === undefined && !isReading ? (
                        <p className="text-sm text-center" style={{ color: 'var(--ivory-dim)' }}>
                          正在取回解读……
                        </p>
                      ) : reading === null ? (
                        <p className="text-sm text-center italic" style={{ color: 'var(--ivory-dim)' }}>
                          这段对话已随风而逝
                        </p>
                      ) : reading === '' && !isReading ? (
                        <div className="text-center">
                          <button
                            onClick={() => streamReading(record.conversation_id)}
                            className="text-sm font-display tracking-[0.1em] underline underline-offset-4"
                            style={{ color: 'var(--gold)' }}
                          >
                            重新生成解读
                          </button>
                        </div>
                      ) : (
                        <Markdown content={(reading as string) || ''} />
                      )}
                      {isReading && (
                        <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom animate-pulse" style={{ background: 'var(--gold)' }} />
                      )}
                    </div>

                    {/* 印证控件(仅过往日) */}
                    {!isToday && (
                      <div
                        className="w-full mt-5 rounded-xl px-4 py-3.5"
                        style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}
                      >
                        <span className="eyebrow block mb-2.5" style={{ letterSpacing: '0.24em' }}>
                          这一日的指引,应验了吗?
                        </span>
                        <div className="flex items-center gap-2">
                          {(['hit', 'miss'] as const).map((v) => (
                            <button
                              key={v}
                              onClick={() => setVerdict(v)}
                              className="px-3.5 py-1.5 rounded-full text-xs font-display tracking-[0.1em] transition-all"
                              style={{
                                border: `1px solid ${verdict === v ? 'var(--gold)' : 'var(--line)'}`,
                                color: verdict === v ? 'var(--gold)' : 'var(--ivory-dim)',
                                background: verdict === v ? 'rgba(201,169,110,0.1)' : 'transparent',
                              }}
                            >
                              {v === 'hit' ? '应验了 ✓' : '没感觉 ◦'}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-2.5">
                          <input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="想补一句吗?(可选)"
                            className="flex-1 bg-transparent text-sm px-3 py-1.5 rounded-lg outline-none placeholder:text-white/25"
                            style={{ border: '1px solid var(--line)', color: 'var(--ivory)' }}
                          />
                          <button
                            onClick={handleSaveFeedback}
                            disabled={!verdict || savingFeedback}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-display tracking-[0.1em] transition-all disabled:opacity-40"
                            style={{ border: '1px solid var(--gold)', color: 'var(--gold)' }}
                          >
                            {savingFeedback ? '…' : '记下'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 继续对话 */}
                    {selectedView?.conversation_exists && !isReading && reading !== undefined && reading !== null && reading !== '' && (
                      <button
                        onClick={() => onContinueConversation(record.conversation_id)}
                        className="mt-5 px-7 py-2.5 rounded-xl font-display tracking-[0.15em] text-sm transition-all hover:brightness-110"
                        style={{
                          color: '#1a1407',
                          background: 'linear-gradient(120deg, #C9A96E, #E2C893)',
                          boxShadow: '0 8px 24px rgba(201,169,110,0.25)',
                        }}
                      >
                        {isToday ? '继续这段对话 ›' : '查看当日对话 ›'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 全屏选牌器(z-50,盖在弹窗之上;纯仪式,真实牌面由 /api/daily/draw 决定) */}
      <TarotCardDrawer
        isOpen={showDrawer}
        drawRequest={DAILY_DRAW_REQUEST}
        onClose={() => setShowDrawer(false)}
        onCardsDrawn={handleCardsDrawn}
        title="每日一签"
        subtitle="静心凝神,为今天抽取一张指引"
        revealOnConfirm={false}
      />
    </>
  );
};

export default DailyOracleModal;
