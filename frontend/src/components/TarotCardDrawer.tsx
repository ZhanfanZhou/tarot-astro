import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import type { DrawCardsRequest, TarotCard } from '@/types';
import { getCardInfo, CARD_BACK_IMAGE, TABLE_BACKGROUND_IMAGE } from '@/config/tarotCards';
import { createShuffleRun, type ShuffleCardConfig, type ShuffleVariant } from './shufflePatterns';
import ArchPortrait from './ui/ArchPortrait';

interface TarotCardDrawerProps {
  isOpen: boolean;
  drawRequest: DrawCardsRequest;
  onClose: () => void;
  onCardsDrawn: (cards: TarotCard[]) => void;
  /** 弹层标题,默认「抽取塔罗牌」(日运场景定制) */
  title?: string;
  /** 标题上方的英文眉题,默认「The Draw」 */
  eyebrow?: string;
  /** 洗牌前副标题,默认「静心凝神，准备开启命运之门」 */
  subtitle?: string;
  /** 固定洗牌花式,只给本地预览页用;正常抽牌不传=随机 */
  shuffleVariant?: ShuffleVariant;
}

// 牌阵位置的序号：槽位里、选中那张牌头上都写它，一眼对上「这张落在哪个位置」
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// 装饰星点：坐标和节奏在模块加载时定死一次。原先是在 render 里现摇 Math.random()，
// 拖动扇形时每帧重渲染都会给所有星点换一遍坐标（每帧重排重绘），
// transition 对象也跟着变新，framer-motion 会不停重启这些无限循环动画。
const AMBIENT_STARS = Array.from({ length: 18 }, () => ({
  left: `${Math.random() * 100}%`,
  top: `${Math.random() * 100}%`,
  duration: 2 + Math.random() * 2,
  delay: Math.random() * 2,
}));

const TarotCardDrawer: React.FC<TarotCardDrawerProps> = ({
  isOpen,
  drawRequest,
  onClose,
  onCardsDrawn,
  title = '抽取塔罗牌',
  eyebrow = 'The Draw',
  subtitle = '静心凝神，准备开启命运之门',
  shuffleVariant,
}) => {
  const [isShuffling, setIsShuffling] = useState(false);
  const [isSpread, setIsSpread] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rotationOffset, setRotationOffset] = useState(0); // 记录旋转偏移量
  const [shuffleConfig, setShuffleConfig] = useState<ShuffleCardConfig[]>([]);
  const [shuffleRunId, setShuffleRunId] = useState(0);
  const shuffleTimeoutRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageHeight, setStageHeight] = useState(0);

  // 生成78张牌的数组
  const cards = Array.from({ length: 78 }, (_, i) => i);

  // 扇形展示配置
  const VISIBLE_CARDS = 22; // 扇形中同时显示的卡片数
  const TOTAL_CARDS = cards.length;
  const CARD_HALF_WIDTH = 48; // 卡片宽度约96px，记录一半用于水平居中
  const FAN_RADIUS = 500;
  const FAN_VERTICAL_SQUASH = 0.95; // 扇形压缩系数，控制整体高度
  const FAN_BASE_Y_OFFSET = 180; // 扇形整体下移偏移量
  // 扇形从舞台底部往上真正吃掉的高度：中间那张牌的位移 + 牌高 + 头顶序号徽标
  // （= 500*0.95 - 180 + 144 + 32）。舞台矮于这个数，轮盘就会顶进上面的槽位里，
  // 所以按舞台实测高度整体缩放，而不是把几何常量写死。
  const FAN_DESIGN_HEIGHT = 471;
  // 牌阵位置即槽位，个数即抽牌张数（唯一真源，见 DrawCardsRequest）
  const positions = drawRequest?.positions ?? [];
  const cardCount = positions.length;
  // 张数多时换小槽位：10 张 w-20 会在 max-w-5xl 里换行，两行槽位再次撞上轮盘
  const isCompactSlots = cardCount > 6;
  const fanScale = stageHeight
    ? Math.min(1, Math.max(0.5, stageHeight / FAN_DESIGN_HEIGHT))
    : 1;

  // 计算当前可见的牌
  const getCenterIndex = () => {
    const normalizedOffset = ((rotationOffset % TOTAL_CARDS) + TOTAL_CARDS) % TOTAL_CARDS;
    return Math.round(normalizedOffset);
  };

  const centerIndex = getCenterIndex();

  // 计算可见的牌（环形逻辑）
  const getVisibleCards = () => {
    const halfVisible = Math.floor(VISIBLE_CARDS / 2);
    const visible: number[] = [];

    for (let i = -halfVisible; i <= halfVisible; i++) {
      const idx = ((centerIndex + i) % TOTAL_CARDS + TOTAL_CARDS) % TOTAL_CARDS;
      visible.push(idx);
    }

    return visible;
  };

  const visibleCards = getVisibleCards();

  const normalizedRotation = ((rotationOffset % TOTAL_CARDS) + TOTAL_CARDS) % TOTAL_CARDS;
  const rawSliderProgress = (normalizedRotation / TOTAL_CARDS + 0.5) % 1;
  const sliderProgress = rawSliderProgress < 0 ? rawSliderProgress + 1 : rawSliderProgress;

  // 打开即洗牌:调用方那一下「抽牌」就是开始洗牌的动作,不再多一颗按钮。
  // startShuffle 自己会把上一轮的选牌/扇形/计时器全部清掉。
  useEffect(() => {
    if (!isOpen) return;
    finishedRef.current = false;
    startShuffle();
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (shuffleTimeoutRef.current) {
        window.clearTimeout(shuffleTimeoutRef.current);
      }
    };
  }, []);

  // 舞台高度随窗口大小、槽位行的出现/换行而变 —— 实测而非猜测
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen, isSpread]);

  const startShuffle = () => {
    const run = createShuffleRun(shuffleVariant);

    setShuffleConfig(run.cards);
    setShuffleRunId((prev) => prev + 1);
    setIsShuffling(true);
    setIsSpread(false);
    setSelectedIndices([]);
    setShowConfirm(false);
    setRotationOffset(0);

    if (shuffleTimeoutRef.current) {
      window.clearTimeout(shuffleTimeoutRef.current);
    }

    // 最后一张牌落定 + 一点收尾停顿,然后展扇形
    shuffleTimeoutRef.current = window.setTimeout(() => {
      setIsShuffling(false);
      setIsSpread(true);
    }, (run.settleAt + 0.35) * 1000);
  };

  const handleDrag = (_: any, info: PanInfo) => {
    // 水平拖动时旋转扇形
    const sensitivity = 0.0005; // 拖动灵敏度（降低20倍，使滑动更慢）
    const deltaRotation = info.offset.x * sensitivity;
    setRotationOffset((prev) => prev + deltaRotation);
  };

  const handleCardClick = (index: number) => {
    if (!isSpread || isShuffling) return;

    if (selectedIndices.includes(index)) {
      setSelectedIndices(selectedIndices.filter((i) => i !== index));
      setShowConfirm(false);
    } else if (cardCount === 1) {
      // 单张:点哪张就换成哪张,不用先取消;和多张一样,点「确认抽牌」才收场
      setSelectedIndices([index]);
      setShowConfirm(true);
    } else if (selectedIndices.length < cardCount) {
      const newSelected = [...selectedIndices, index];
      setSelectedIndices(newSelected);
      if (newSelected.length === cardCount) {
        setShowConfirm(true);
      }
    }
  };

  const finishSelection = (indices: number[]) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    // 模拟抽牌结果(仪式用;线上真实牌面由服务端决定)
    const drawnCards: TarotCard[] = indices.map((idx) => {
      const cardInfo = getCardInfo(idx);
      return {
        card_id: idx,
        card_name: cardInfo?.name_zh || `塔罗牌 ${idx}`,
        reversed: Math.random() < 0.3,
      };
    });

    // 选完就收场:揭牌是抽牌之后的另一幕,由调用方在对话界面上演(CardRevealOverlay)
    onCardsDrawn(drawnCards);
    onClose();
  };

  const handleConfirm = () => finishSelection(selectedIndices);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-6 bg-black/95 isolate"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isShuffling) {
              onClose();
            }
          }}
        >
          {/* 背景装饰 - 漂浮的星星 */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {AMBIENT_STARS.map((star, i) => (
              <motion.div
                key={i}
                className="absolute w-1 h-1 bg-mystic-gold rounded-full"
                style={{ left: star.left, top: star.top }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0, 1.5, 0],
                }}
                transition={{
                  duration: star.duration,
                  repeat: Infinity,
                  delay: star.delay,
                }}
              />
            ))}
          </div>

          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative w-full max-w-7xl h-[85vh] rounded-[28px] overflow-hidden flex flex-col"
            style={{
              background: 'var(--void)',
              border: '1px solid rgba(201,169,110,0.24)',
              boxShadow: '0 30px 90px rgba(0,0,0,0.65)',
            }}
          >
            {/* 牌桌：铺满整个弹层，压暗后四周往底色收（同殿堂拱窗的暗角），z-0 垫底 */}
            <div className="absolute inset-0 z-0 pointer-events-none">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url(${TABLE_BACKGROUND_IMAGE})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'brightness(0.88)',
                }}
              />
              <div className="absolute inset-0 bg-[#06060f]/78" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,228,185,0.18),transparent_78%)] mix-blend-screen" />
              <div
                className="absolute inset-0"
                style={{ background: 'radial-gradient(ellipse 85% 80% at 50% 58%, transparent 52%, rgba(6,6,15,0.82) 100%)' }}
              />
              <div className="absolute inset-x-0 top-0 h-52 bg-gradient-to-b from-[#06060f]/75 to-transparent" />
              {/* 离外沿 10px 再描一圈淡金发丝，像画框里的衬边 */}
              <div className="absolute inset-2.5 rounded-[20px]" style={{ border: '1px solid var(--line)' }} />
            </div>

            {/* 头部：拱窗小立绘 + 眉题 / 标题 / 进度，居中；关闭在右上 */}
            <div className="relative z-20 shrink-0 px-6 pt-6 pb-3 flex justify-center">
              <div className="flex items-center gap-4">
                <ArchPortrait src="/assets/avatar-tarot.webp" className="w-10 h-[50px]" />
                <div className="min-w-0">
                  <div className="eyebrow" style={{ fontSize: '9px', letterSpacing: '0.34em', color: 'var(--gold)' }}>
                    {eyebrow}
                  </div>
                  <h2 className="mt-1 font-display font-semibold text-[22px] sm:text-2xl tracking-[0.2em] leading-tight mystic-text">
                    {title}
                  </h2>
                  <p className="mt-1.5 text-[12px] sm:text-[13px] tracking-[0.14em] font-display" style={{ color: 'var(--ivory-dim)' }}>
                    {isSpread ? (
                      <>
                        {selectedIndices.length < cardCount ? `凭直觉选出 ${cardCount} 张牌` : '牌已选定'}
                        <span className="ml-2.5 tracking-[0.2em]" style={{ color: 'var(--gold)' }}>
                          {selectedIndices.length} / {cardCount}
                        </span>
                      </>
                    ) : (
                      subtitle
                    )}
                  </p>
                </div>
              </div>
              <motion.button
                onClick={onClose}
                disabled={isShuffling}
                whileTap={{ scale: 0.92 }}
                className="absolute top-5 right-5 w-10 h-10 rounded-full grid place-items-center transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                style={{ border: '1px solid var(--line)', background: 'rgba(6,6,15,0.55)', color: 'var(--ivory-dim)' }}
                aria-label="关闭"
              >
                <X size={17} />
              </motion.button>
            </div>

            {/* 槽位：牌阵的每个位置一格，在扇形牌阵正上方。位置名写在格子上面——
                选中的牌抬起来会顶进这一行的下沿，写在下面会被牌面压住 */}
            {isSpread && (
              <div className="relative z-20 shrink-0 px-4 sm:px-6 pb-2">
                <div className={`flex ${isCompactSlots ? 'gap-x-1.5 gap-y-2' : 'gap-x-2 gap-y-3'} justify-center flex-wrap max-w-5xl mx-auto`}>
                  {positions.map((position, idx) => {
                    const filled = selectedIndices[idx] !== undefined;
                    const isNext = idx === selectedIndices.length; // 下一张牌落在这一格
                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.08, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                        className={`flex flex-col items-center justify-end ${isCompactSlots ? 'w-14' : 'w-[84px]'}`}
                      >
                        <span
                          className={`mb-1.5 w-full text-center font-display leading-snug line-clamp-2 transition-colors duration-500 ${
                            isCompactSlots ? 'text-[9px] tracking-[0.04em]' : 'text-[11px] tracking-[0.1em]'
                          }`}
                          style={{ color: filled ? 'var(--ivory)' : isNext ? 'var(--gold)' : 'var(--ivory-faint)' }}
                        >
                          {position}
                        </span>
                        <div className={`relative ${isCompactSlots ? 'w-12 h-[84px]' : 'w-16 h-28'}`}>
                          {/* 空位：一方暗色的牌位，发丝金边 + 内框，正中写序号；下一张要落的那一格亮着 */}
                          <div
                            className="absolute inset-0 rounded-lg transition-[border-color,box-shadow] duration-500"
                            style={{
                              background: 'rgba(6,6,15,0.6)',
                              border: `1px solid ${isNext ? 'rgba(201,169,110,0.65)' : 'rgba(201,169,110,0.24)'}`,
                              boxShadow: isNext ? '0 0 18px rgba(201,169,110,0.25), inset 0 0 14px rgba(201,169,110,0.1)' : 'none',
                            }}
                          />
                          <div className="absolute inset-[5px] rounded-[5px]" style={{ border: '1px solid rgba(201,169,110,0.12)' }} />
                          <span
                            className={`absolute inset-0 grid place-items-center font-display tracking-[0.08em] transition-colors duration-500 ${
                              isCompactSlots ? 'text-[11px]' : 'text-[13px]'
                            }`}
                            style={{ color: isNext ? 'var(--gold)' : 'rgba(201,169,110,0.38)' }}
                          >
                            {ROMAN[idx] ?? idx + 1}
                          </span>

                          {/* 选中：一张牌背落进这一格 */}
                          <AnimatePresence>
                            {filled && (
                              <motion.div
                                key="card"
                                initial={{ opacity: 0, y: -16, scale: 1.1 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 1.05 }}
                                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                                className="absolute inset-0 rounded-lg overflow-hidden"
                                style={{
                                  border: '1px solid rgba(240,208,144,0.75)',
                                  boxShadow: '0 0 16px rgba(201,169,110,0.4), 0 8px 18px rgba(0,0,0,0.5)',
                                }}
                              >
                                <img src={CARD_BACK_IMAGE} alt="" aria-hidden className="w-full h-full object-cover" draggable={false} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cards Display */}
            <motion.div className="relative flex-1 min-h-0 w-full flex items-center justify-center px-6 pb-4">
              <div ref={stageRef} className="relative z-10 w-full h-full flex items-center justify-center">
                {/* 洗牌动画 */}
                {isShuffling && (
                  <div className="relative w-full max-w-4xl h-[360px] flex items-center justify-center">
                    <motion.div
                      key={shuffleRunId}
                      initial={{ opacity: 0, scale: 1 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative w-full h-full flex items-center justify-center"
                    >
                      <motion.div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%] pointer-events-none"
                        style={{
                          width: 'min(90vw, 760px)',
                          height: 'min(90vw, 760px)',
                          maxWidth: '800px',
                          maxHeight: '800px',
                        }}
                        initial={{ scaleX: 1.1, scaleY: 0.62, rotate: 0, opacity: 0.4 }}
                        animate={{
                          scaleX: [1.1, 1.2, 1.05, 1.1],
                          scaleY: [0.62, 0.7, 0.58, 0.62],
                          opacity: [0.38, 0.46, 0.42, 0.38],
                          rotate: [0, 4, -3, 0],
                        }}
                        transition={{ duration: 9, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' }}
                      >
                        <div className="absolute inset-0 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(253,244,215,0.25),rgba(168,216,234,0.08)_58%,transparent_85%)] blur-[56px] mix-blend-screen" />
                        <motion.div
                          className="absolute inset-[18%] rounded-full bg-[conic-gradient(from_0deg,rgba(254,240,199,0.22),rgba(168,216,234,0.07),rgba(254,240,199,0.22))] opacity-60 blur-[44px] mix-blend-screen"
                          animate={{ rotate: [0, 360] }}
                          transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
                        />
                        <motion.div
                          className="absolute inset-[32%] rounded-full border border-mystic-gold/15 opacity-40"
                          animate={{ rotate: [0, -360] }}
                          transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
                        />
                      </motion.div>
                      {shuffleConfig.map((card) => (
                        <motion.div
                          key={`${shuffleRunId}-${card.id}`}
                          className="absolute w-28 h-44 rounded-xl overflow-hidden shadow-[0_16px_44px_rgba(225,196,142,0.26)] border border-mystic-gold/30"
                          style={{ zIndex: card.zIndex }}
                          initial={{
                            opacity: 0,
                            scale: card.scale[0],
                            rotate: card.rotate[0],
                          }}
                          animate={{
                            opacity: [0, 0.9, 1, 0.82],
                            x: card.pathX,
                            y: card.pathY,
                            rotate: card.rotate,
                            scale: card.scale,
                          }}
                          transition={{
                            duration: card.duration,
                            ease: 'easeInOut',
                            times: [0, 0.3, 0.7, 1],
                            delay: card.delay,
                          }}
                        >
                          <img
                            src={CARD_BACK_IMAGE}
                            alt="塔罗牌背面"
                            className="w-full h-full object-cover select-none pointer-events-none"
                            draggable={false}
                          />
                          <div className="absolute inset-0 bg-white/8 mix-blend-screen" />
                        </motion.div>
                      ))}
                    </motion.div>
                  </div>
                )}

                {/* 展开的扇形牌阵 - 可拖动扇形展开，使用绝对定位直接贴底 */}
                {isSpread && (
                  <div
                    className="absolute bottom-0 left-0 right-0"
                    style={{ transform: `scale(${fanScale})`, transformOrigin: 'bottom center' }}
                  >
                    <motion.div
                      className="relative w-full"
                      drag="x"
                      dragConstraints={{ left: 0, right: 0 }}
                      dragElastic={0.05}
                      dragMomentum={true}
                      onDrag={handleDrag}
                      style={{ cursor: 'grab' }}
                      whileDrag={{ cursor: 'grabbing' }}
                    >
                      <div className="relative h-[280px] flex items-end justify-center pointer-events-none">
                        <div className="relative w-full max-w-5xl">
                          <div className="absolute inset-0 -translate-y-10 h-[320px] rounded-[360px] bg-[radial-gradient(circle_at_center,rgba(255,214,150,0.14),transparent_80%)] blur-3xl opacity-75" />
                          {visibleCards.map((cardId, visIdx) => {
                            const isSelected = selectedIndices.includes(cardId);
                            const selectionOrder = selectedIndices.indexOf(cardId);

                            const angleSpan = 110;
                            const halfVisible = Math.floor(VISIBLE_CARDS / 2);
                            const relativePos = visIdx - halfVisible;
                            const angle = (relativePos / halfVisible) * (angleSpan / 2);
                            const radius = FAN_RADIUS;

                            const distanceFromCenter = Math.abs(relativePos);
                            const opacity = 1 - (distanceFromCenter / halfVisible) * 0.3;
                            const scale = 1 - (distanceFromCenter / halfVisible) * 0.1;

                            const angleRad = (angle * Math.PI) / 180;
                            const rawX = Math.sin(angleRad) * radius;
                            const yPosition = -Math.cos(angleRad) * radius * FAN_VERTICAL_SQUASH + FAN_BASE_Y_OFFSET;

                            return (
                              <motion.div
                                key={cardId}
                                initial={{
                                  x: -CARD_HALF_WIDTH,
                                  y: 0,
                                  rotate: 0,
                                  opacity: 0,
                                  scale: 0.5,
                                }}
                                animate={{
                                  x: rawX - CARD_HALF_WIDTH,
                                  y: yPosition + (isSelected ? -30 : 0),
                                  rotate: angle,
                                  opacity: isSelected ? 1 : opacity,
                                  scale: isSelected ? 1.15 : scale,
                                }}
                                transition={{
                                  duration: 0.5,
                                  type: 'spring',
                                  stiffness: 150,
                                  damping: 20,
                                }}
                                className="absolute left-1/2 bottom-0 cursor-pointer pointer-events-auto"
                                style={{
                                  transformOrigin: 'bottom center',
                                  zIndex: isSelected ? 100 : Math.round((1 - Math.abs(relativePos) / halfVisible) * 50),
                                }}
                                onClick={() => handleCardClick(cardId)}
                              >
                                <motion.div
                                  whileHover={{
                                    scale: 1.15,
                                    y: -20,
                                    transition: { type: 'spring', stiffness: 300 },
                                  }}
                                  className="relative"
                                >
                                  <motion.div
                                    initial={{ opacity: 0, scale: 0 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.5 }}
                                    className={`
                                      absolute -top-8 left-1/2 -translate-x-1/2 z-20
                                      w-8 h-8 rounded-full flex items-center justify-center
                                      font-display text-[11px] tracking-[0.04em]
                                      ${isSelected
                                        ? 'bg-gold-gradient text-dark-bg font-semibold shadow-[0_0_14px_rgba(201,169,110,0.65)]'
                                        : 'bg-[#06060f]/85 text-[color:var(--ivory-dim)] border border-mystic-gold/35 shadow-[0_4px_10px_rgba(0,0,0,0.5)]'}
                                    `}
                                  >
                                    {selectionOrder >= 0 ? ROMAN[selectionOrder] ?? selectionOrder + 1 : cardId + 1}
                                  </motion.div>

                                  <motion.div
                                    className={`
                                      w-24 h-36 rounded-lg shadow-2xl overflow-hidden
                                      transition-all duration-300
                                      ${
                                        isSelected
                                          ? 'ring-2 ring-mystic-gold-light'
                                          : 'ring-1 ring-mystic-gold/30 hover:ring-mystic-gold/70'
                                      }
                                    `}
                                  >
                                    <img
                                      src={CARD_BACK_IMAGE}
                                      alt={`塔罗牌 ${cardId + 1}`}
                                      className="w-full h-full object-cover"
                                      draggable={false}
                                    />
                                  </motion.div>

                                  {isSelected && (
                                    <motion.div
                                      className="absolute inset-0 rounded-lg pointer-events-none"
                                      animate={{
                                        boxShadow: [
                                          '0 0 18px rgba(201, 169, 110, 0.5)',
                                          '0 0 34px rgba(240, 208, 144, 0.85)',
                                          '0 0 18px rgba(201, 169, 110, 0.5)',
                                        ],
                                      }}
                                      transition={{
                                        duration: 1.5,
                                        repeat: Infinity,
                                      }}
                                    />
                                  )}
                                </motion.div>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>

                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 1 }}
                        className="absolute top-[160px] inset-x-0 flex justify-center z-50"
                      >
                        <motion.div
                          drag="x"
                          dragConstraints={{ left: 0, right: 0 }}
                          dragElastic={0.05}
                          dragMomentum={true}
                          onDrag={handleDrag}
                          whileHover={{ scale: 1.03 }}
                          whileDrag={{ scale: 1.08, cursor: 'grabbing' }}
                          className="relative w-[210px] h-2 rounded-full bg-[#06060f]/60 cursor-grab"
                        >
                          {/* 一道发丝金线当轨道，两端淡出 */}
                          <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-mystic-gold/60 to-transparent pointer-events-none" />

                          <motion.div
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none"
                            animate={{
                              left: `${sliderProgress * 100}%`,
                            }}
                            transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                          >
                            {/* 滑块：同「最近的占卜」起点那枚节点——暗底、金发丝圈、正中一颗 ✦ */}
                            <div
                              className="w-[22px] h-[22px] rounded-full grid place-items-center text-[9px] leading-none"
                              style={{
                                background: 'var(--void)',
                                border: '1px solid rgba(201,169,110,0.75)',
                                boxShadow: '0 0 14px rgba(201,169,110,0.45)',
                                color: 'var(--gold)',
                              }}
                            >
                              ✦
                            </div>
                          </motion.div>
                        </motion.div>
                      </motion.div>
                    </motion.div>
                  </div>
                )}
              </div>
            </motion.div>

            {/* 确认：暗底发丝金边的胶囊，背后一团慢慢呼吸的金光；悬停时框线亮起、底色透出一层金 */}
            {showConfirm && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute bottom-8 left-0 right-0 flex justify-center z-20 pointer-events-none"
              >
                <div className="relative pointer-events-auto">
                  <motion.span
                    aria-hidden
                    className="absolute -inset-5 rounded-full blur-2xl pointer-events-none"
                    style={{ background: 'radial-gradient(closest-side, rgba(201,169,110,0.55), transparent)' }}
                    animate={{ opacity: [0.45, 0.95, 0.45] }}
                    transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.button
                    onClick={handleConfirm}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    className="group relative flex items-center gap-4 h-14 px-9 rounded-full font-display text-base tracking-[0.36em]"
                    style={{
                      color: 'var(--gold-bright)',
                      background: 'rgba(6,6,15,0.8)',
                      border: '1px solid rgba(201,169,110,0.7)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                    }}
                  >
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: 'linear-gradient(120deg, rgba(201,169,110,0.2), rgba(240,208,144,0.1))',
                        boxShadow: 'inset 0 0 0 1px rgba(240,208,144,0.85), 0 0 26px rgba(201,169,110,0.35)',
                      }}
                    />
                    <span aria-hidden className="relative text-[10px]">✦</span>
                    <span className="relative pl-[0.36em]">确认抽牌</span>
                    <span aria-hidden className="relative text-[10px]">✦</span>
                  </motion.button>
                </div>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TarotCardDrawer;
