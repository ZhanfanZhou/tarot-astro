import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import type { TarotCard } from '@/types';
import { CARD_BACK_IMAGE, getCardInfo } from '@/config/tarotCards';
import { useDeckWallet } from '@/stores/useDeckWallet';
import { resolveActiveCardImage } from '@/data/activeDeckImage';

/**
 * 揭牌幕：抽牌窗口收场之后，在对话界面上逐张翻开抽到的牌。
 * 只压暗一层半透明，后面的对话仍看得见；翻完淡出，牌这时已经画在对话里了。
 *
 * 真牌由后端给，所以 cards 允许先是 null：牌背先落位等着，牌一到就开翻。
 * 翻牌只动 transform(rotateY/y/z) 和 opacity，光晕/扫光是各自独立的一层，
 * 不去动卡面本身的 filter 或 box-shadow。
 *
 * 两种排法：
 * - 一排摆开（桌面，以及手机上单张或 4 张以上的牌阵）；
 * - 一张一张切换（手机上 2~3 张）：窄屏并排只剩指甲盖大，改成一次一张大牌轮着翻。
 */

const ENTER_DUR = 0.5;
const ENTER_STAGGER = 0.07;
const FLIP_DUR = 0.78;
const HOLD_AFTER_LAST = 1.3; // 最后一张翻完之后停一拍再退场

// 一张一张切换的节奏：上一张退场 → 这张入场 → 翻面 → 停留
const SOLO_EXIT = 0.28;
const SOLO_ENTER = 0.38;
const SOLO_FLIP_AT = SOLO_ENTER + 0.18; // 相对这张牌入场的时刻
const SOLO_HOLD = 0.6;
const SOLO_STEP = SOLO_EXIT + SOLO_FLIP_AT + FLIP_DUR + SOLO_HOLD;

/** 窄屏（手机竖屏）——和 Tailwind 的 sm 断点同一条线 */
function useNarrowViewport(): boolean {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

interface CardRevealOverlayProps {
  /** 抽到的牌；null = 还在等后端出牌，先只摆牌背 */
  cards: TarotCard[] | null;
  /** 牌阵位置：牌没到时决定摆几张牌背，牌到了写在每张牌下面 */
  positions?: string[];
  /** 揭完之后那行小字 */
  caption?: string;
  /** 退场动画播完时调用——调用方在这里把这一幕从界面上摘掉 */
  onDone: () => void;
}

const CardRevealOverlay: React.FC<CardRevealOverlayProps> = ({
  cards,
  positions,
  caption = '正在为你解读…',
  onDone,
}) => {
  const count = cards?.length || positions?.length || 0;
  const narrow = useNarrowViewport();
  const solo = narrow && count >= 2 && count <= 3;
  const flipStagger = count > 6 ? 0.3 : 0.46;

  const [started, setStarted] = useState(false); // 牌到了、开翻了
  const [flipAt0, setFlipAt0] = useState(0); // 一排摆开时,第一张开翻的时刻(秒)
  const [soloIdx, setSoloIdx] = useState(0); // 一张一张时,翻到第几张了
  const [visible, setVisible] = useState(true);
  const mountedAt = useRef(performance.now());
  const endTimer = useRef<number | null>(null);

  // 牌一到就开翻：牌背刚落位就等它落完，等了半天才到就只留一拍
  useEffect(() => {
    if (!cards || !count || started) return;
    setStarted(true);
    if (solo) return; // 一张一张的节奏由下面那个 effect 推着走

    const entered = ENTER_DUR + (count - 1) * ENTER_STAGGER;
    const elapsed = (performance.now() - mountedAt.current) / 1000;
    const first = Math.max(0.3, entered - elapsed + 0.25);
    setFlipAt0(first);
    const total = first + (count - 1) * flipStagger + FLIP_DUR + HOLD_AFTER_LAST;
    if (endTimer.current) window.clearTimeout(endTimer.current);
    endTimer.current = window.setTimeout(() => setVisible(false), total * 1000);
  }, [cards, count, solo, flipStagger, started]);

  // 一张一张：每张停够了换下一张，最后一张停完就退场
  useEffect(() => {
    if (!started || !solo) return;
    if (soloIdx >= count) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setSoloIdx((idx) => idx + 1), SOLO_STEP * 1000);
    return () => window.clearTimeout(timer);
  }, [started, solo, soloIdx, count]);

  useEffect(
    () => () => {
      if (endTimer.current) window.clearTimeout(endTimer.current);
    },
    []
  );

  // 点一下跳过剩下的；牌还没到的时候点不走(走了就看不到自己抽的牌了)
  const dismiss = () => {
    if (!started) return;
    if (endTimer.current) window.clearTimeout(endTimer.current);
    setVisible(false);
  };

  // 落幕那句什么时候浮出来：一排摆开看最后一张翻完,一张一张看是不是翻到最后一张了
  const captionAt = !started
    ? null
    : solo
      ? soloIdx === count - 1
        ? SOLO_EXIT + SOLO_FLIP_AT + FLIP_DUR * 0.85
        : null
      : flipAt0 + (count - 1) * flipStagger + FLIP_DUR * 0.85;

  // 窄屏是按「一行放得下几张、整幕还得塞进一屏」定的,不用桌面那套 clamp 下限
  const cardWidth = solo
    ? 'min(62vw, 250px)'
    : narrow
      ? count === 1
        ? 'min(56vw, 220px)'
        : count <= 6
          ? 'min(23vw, 100px)' // 一行三张,四到六张排两行
          : 'min(18vw, 78px)' // 更多就只有 lab 里试得到,一行四张
      : count <= 3
        ? 'clamp(119px, 25vw, 176px)'
        : count <= 6
          ? 'clamp(97px, 19vw, 139px)'
          : 'clamp(75px, 13vw, 110px)';
  // 间距跟着牌宽走,再按张数分档:三张摊得开,十张还得在一行里放得下(放不下就换行)
  const gapRatio = count <= 3 ? 0.34 : count <= 6 ? 0.24 : 0.16;

  return createPortal(
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          key="reveal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          onClick={dismiss}
          className="fixed inset-0 z-[110] flex flex-col items-center justify-center px-4 sm:px-6 py-10 overflow-hidden"
          style={{
            background: 'rgba(6,6,15,0.62)',
            backdropFilter: 'blur(7px)',
            WebkitBackdropFilter: 'blur(7px)',
            cursor: started ? 'pointer' : 'default',
          }}
        >
          {/* 牌阵背后的那团光：跟着翻牌一起亮起来 */}
          <motion.div
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[54vh] pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at center, rgba(240,208,144,0.16), rgba(168,216,234,0.05) 52%, transparent 78%)',
              mixBlendMode: 'screen',
            }}
            initial={{ opacity: 0.25, scale: 0.9 }}
            animate={{ opacity: started ? 0.85 : 0.35, scale: 1 }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
          />

          {/* 跳过：手机上光靠「点任意处」看不出来，给一个明白的出口 */}
          {started && (
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              onClick={(e) => {
                e.stopPropagation();
                dismiss();
              }}
              className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10 flex items-center gap-1.5
                         px-4 py-2.5 rounded-full font-display text-[11px] tracking-[0.2em]
                         border transition-colors"
              style={{
                color: 'var(--ivory-dim)',
                borderColor: 'var(--line)',
                background: 'rgba(6,6,15,0.55)',
              }}
            >
              跳过
              <ChevronRight size={13} />
            </motion.button>
          )}

          {/* 抬头：等牌时一行小字，翻完换成落定那句 */}
          <div className="relative h-16 w-full shrink-0">
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              animate={{ opacity: started ? 0 : 1 }}
              transition={{ duration: 0.4 }}
            >
              <span className="eyebrow" style={{ color: 'var(--ivory-faint)' }}>
                牌阵落位
              </span>
            </motion.div>
            {captionAt !== null && (
              <motion.div
                className="absolute inset-0 flex flex-col items-center justify-center text-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: captionAt, duration: 0.7, ease: 'easeOut' }}
              >
                <div className="font-display text-xl sm:text-2xl tracking-[0.22em] mystic-text">
                  命运之牌已就位
                </div>
                <div
                  className="mt-2 text-[12px] tracking-[0.18em] font-display"
                  style={{ color: 'var(--ivory-dim)' }}
                >
                  {caption}
                </div>
              </motion.div>
            )}
          </div>

          {solo ? (
            // 舞台高度先按牌撑住(牌高 = 宽 × 1.75,再加下面两行字),换牌时整页才不会一跳一跳
            <div
              className="relative shrink-0"
              style={{ width: cardWidth, height: `calc(${cardWidth} * 1.75 + 74px)` }}
            >
              <AnimatePresence initial={false} mode="wait">
                <RevealCard
                  key={started ? soloIdx : 'waiting'}
                  card={started ? cards?.[soloIdx] : undefined}
                  position={positions?.[started ? soloIdx : 0]}
                  enterDelay={0}
                  flipAt={started ? SOLO_FLIP_AT : null}
                  solo
                />
              </AnimatePresence>
            </div>
          ) : (
            <div
              className="relative flex flex-wrap items-start justify-center max-w-5xl"
              style={{
                columnGap: `calc(${cardWidth} * ${gapRatio})`,
                rowGap: `calc(${cardWidth} * 0.3)`,
              }}
            >
              {Array.from({ length: count }, (_, idx) => (
                <RevealCard
                  key={idx}
                  card={cards?.[idx]}
                  position={positions?.[idx]}
                  width={cardWidth}
                  enterDelay={idx * ENTER_STAGGER}
                  flipAt={started ? flipAt0 + idx * flipStagger : null}
                />
              ))}
            </div>
          )}

          {/* 一张一张时的进度点 */}
          {solo && (
            <div className="relative mt-6 flex items-center justify-center gap-2 shrink-0">
              {Array.from({ length: count }, (_, idx) => (
                <motion.span
                  key={idx}
                  className="block h-1.5 rounded-full"
                  animate={{
                    width: started && idx === soloIdx ? 18 : 6,
                    backgroundColor:
                      started && idx <= soloIdx ? 'rgba(201,169,110,1)' : 'rgba(237,230,214,0.25)',
                  }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                />
              ))}
            </div>
          )}

          {/* 跳过提示 */}
          <div className="relative h-10 w-full shrink-0 flex items-end justify-center">
            {captionAt !== null && (
              <motion.span
                className="text-[11px] tracking-[0.24em] font-display"
                style={{ color: 'var(--ivory-faint)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: captionAt + 0.5, duration: 0.6 }}
              >
                点击任意处继续
              </motion.span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

// ── 单张牌：牌背落位 → 抬起来翻过去 → 牌面朝上落回 ──────────────────────────
const RevealCard: React.FC<{
  card?: TarotCard;
  position?: string;
  /** 一排摆开时由外面定宽；一张一张时占满舞台 */
  width?: string;
  enterDelay: number;
  /** null = 还没到翻的时候 */
  flipAt: number | null;
  /** 一张一张模式：贴在舞台上，左右滑动进出 */
  solo?: boolean;
}> = ({ card, position, width, enterDelay, flipAt, solo = false }) => {
  const [imageError, setImageError] = useState(false);
  const activeDeckId = useDeckWallet((s) => s.activeDeckId);
  const info = card ? getCardInfo(card.card_id) : undefined;
  const resolved = info ? resolveActiveCardImage(info.imageUrl, activeDeckId) : null;
  const flipping = flipAt !== null;
  const accent = card?.reversed ? 'var(--moon)' : 'var(--gold)';
  const halo = card?.reversed ? 'rgba(168,216,234,0.55)' : 'rgba(240,208,144,0.6)';

  return (
    <motion.div
      className={solo ? 'absolute inset-0' : 'relative'}
      style={width ? { width } : undefined}
      initial={solo ? { opacity: 0, x: '34%', scale: 0.92 } : { opacity: 0, y: 48, scale: 0.86 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={solo ? { opacity: 0, x: '-34%', scale: 0.92 } : { opacity: 0 }}
      transition={
        solo
          ? { duration: SOLO_ENTER, ease: [0.16, 1, 0.3, 1] }
          : { duration: ENTER_DUR, delay: enterDelay, ease: [0.16, 1, 0.3, 1] }
      }
    >
      {/* 等牌时牌背自己在呼吸(只动 opacity) */}
      {!flipping && (
        <motion.div
          className="absolute -inset-4 rounded-[26px] pointer-events-none"
          style={{
            background: 'radial-gradient(circle at center, rgba(201,169,110,0.35), transparent 64%)',
            mixBlendMode: 'screen',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.2, 0.55, 0.2] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: enterDelay }}
        />
      )}

      {/* 翻到一半时从牌后炸开的那团光 */}
      {flipping && (
        <motion.div
          className="absolute -inset-7 rounded-[32px] pointer-events-none"
          style={{
            background: `radial-gradient(circle at center, ${halo}, transparent 66%)`,
            mixBlendMode: 'screen',
          }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0, 0.95, 0], scale: [0.6, 1.2, 1.55] }}
          transition={{
            duration: 1.05,
            delay: flipAt + FLIP_DUR * 0.42,
            ease: 'easeOut',
            times: [0, 0.35, 1],
          }}
        />
      )}

      {/* perspective 单独一层静止的:淡入那层带 opacity/will-change,压在同一个元素上会把 3D 摊平 */}
      <div className="relative w-full" style={{ perspective: '1100px' }}>
        <motion.div
          className="relative w-full aspect-[2/3.5]"
          style={{ transformStyle: 'preserve-3d' }}
          animate={
            flipping
              ? { rotateY: [0, 90, 180], y: [0, -24, 0], z: [0, 90, 0] }
              : { rotateY: 0, y: 0, z: 0 }
          }
          transition={
            flipping
              ? {
                  duration: FLIP_DUR,
                  delay: flipAt,
                  times: [0, 0.5, 1],
                  ease: ['easeIn', 'easeOut'],
                }
              : { duration: 0 }
          }
        >
          {/* 背面 */}
          <div
            className="absolute inset-0 rounded-xl overflow-hidden"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              border: '1px solid rgba(201,169,110,0.35)',
              boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
            }}
          >
            <img
              src={CARD_BACK_IMAGE}
              alt=""
              aria-hidden
              className="w-full h-full object-cover select-none"
              draggable={false}
            />
          </div>

          {/* 正面 */}
          <div
            className="absolute inset-0 rounded-xl overflow-hidden"
            style={{
              transform: 'rotateY(180deg)',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              border: `1px solid ${accent}`,
              boxShadow: `0 18px 44px rgba(0,0,0,0.55), 0 0 22px ${
                card?.reversed ? 'rgba(168,216,234,0.22)' : 'rgba(201,169,110,0.24)'
              }`,
            }}
          >
            {info && !imageError ? (
              <>
                <div
                  className="w-full h-full"
                  style={{ transform: card?.reversed ? 'rotate(180deg)' : undefined }}
                >
                  <img
                    src={resolved?.src ?? info.imageUrl}
                    alt={info.name_zh}
                    className="w-full h-full object-cover select-none"
                    onError={() => setImageError(true)}
                    draggable={false}
                  />
                </div>
                {resolved?.tint && (
                  <div className="absolute inset-0 pointer-events-none" style={resolved.tint} />
                )}
              </>
            ) : (
              <div
                className="w-full h-full flex flex-col items-center justify-center p-3 relative"
                style={{ background: 'linear-gradient(160deg, #12121e 0%, #0a0a14 100%)' }}
              >
                <div className="absolute inset-3 rounded-lg" style={{ border: '1px solid var(--line)' }} />
                <div className="text-3xl mb-2" style={{ color: accent, opacity: 0.85 }}>
                  ✦
                </div>
                <div className="text-center text-sm leading-tight px-2" style={{ color: 'var(--ivory)' }}>
                  {info?.name_zh || card?.card_name}
                </div>
              </div>
            )}

            {/* 翻过来那一下扫过牌面的高光 */}
            {flipping && (
              <motion.div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(105deg, transparent 36%, rgba(255,255,255,0.45) 50%, transparent 64%)',
                }}
                initial={{ x: '-130%', opacity: 0 }}
                animate={{ x: ['-130%', '0%', '130%'], opacity: [0, 0.9, 0] }}
                transition={{
                  duration: 0.85,
                  delay: flipAt + FLIP_DUR * 0.55,
                  ease: 'easeOut',
                  times: [0, 0.4, 1],
                }}
              />
            )}
          </div>
        </motion.div>
      </div>

      {/* 牌下的字：位置一开始就在，牌名等翻过来才写上 */}
      <div className="mt-3 text-center">
        {position && (
          <div
            className="text-[10px] tracking-[0.26em] font-display uppercase"
            style={{ color: 'var(--ivory-faint)' }}
          >
            {position}
          </div>
        )}
        {/* 高度先占住,牌名是翻过来之后才浮出来的,别让整排牌跟着往下顶 */}
        <div className="mt-1.5 h-9">
          {card && flipping && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: flipAt + FLIP_DUR * 0.62, duration: 0.5, ease: 'easeOut' }}
            >
              <div
                className="font-display text-sm tracking-[0.1em] leading-tight"
                style={{ color: 'var(--ivory)' }}
              >
                {info?.name_zh || card.card_name}
              </div>
              <div className="text-[11px] tracking-[0.2em] mt-0.5" style={{ color: accent }}>
                {card.reversed ? '逆位' : '正位'}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default CardRevealOverlay;
