import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { X, Shuffle, Sparkles } from 'lucide-react';
import type { DrawCardsRequest, TarotCard } from '@/types';
import { getCardInfo, CARD_BACK_IMAGE, TABLE_BACKGROUND_IMAGE } from '@/config/tarotCards';

interface TarotCardDrawerProps {
  isOpen: boolean;
  drawRequest: DrawCardsRequest;
  onClose: () => void;
  onCardsDrawn: (cards: TarotCard[]) => void;
}

interface ShuffleCardConfig {
  id: number;
  pathX: number[];
  pathY: number[];
  rotate: number[];
  scale: number[];
  duration: number;
  delay: number;
  zIndex: number;
}

const TarotCardDrawer: React.FC<TarotCardDrawerProps> = ({
  isOpen,
  drawRequest,
  onClose,
  onCardsDrawn,
}) => {
  const [isShuffling, setIsShuffling] = useState(false);
  const [isSpread, setIsSpread] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [confirmedCards, setConfirmedCards] = useState<TarotCard[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rotationOffset, setRotationOffset] = useState(0); // 记录旋转偏移量
  const [shuffleConfig, setShuffleConfig] = useState<ShuffleCardConfig[]>([]);
  const [shuffleRunId, setShuffleRunId] = useState(0);
  const shuffleTimeoutRef = useRef<number | null>(null);

  // 生成78张牌的数组
  const cards = Array.from({ length: 78 }, (_, i) => i);

  // 扇形展示配置
  const VISIBLE_CARDS = 22; // 扇形中同时显示的卡片数
  const TOTAL_CARDS = cards.length;
  const CARD_HALF_WIDTH = 48; // 卡片宽度约96px，记录一半用于水平居中
  const FAN_RADIUS = 500;
  const FAN_VERTICAL_SQUASH = 0.95; // 扇形压缩系数，控制整体高度
  const FAN_BASE_Y_OFFSET = 180; // 扇形整体下移偏移量

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

  useEffect(() => {
    if (isOpen) {
      setIsShuffling(false);
      setIsSpread(false);
      setSelectedIndices([]);
      setConfirmedCards([]);
      setShowConfirm(false);
      setRotationOffset(0);
      setShuffleConfig([]);
      setShuffleRunId(0);
      if (shuffleTimeoutRef.current) {
        window.clearTimeout(shuffleTimeoutRef.current);
        shuffleTimeoutRef.current = null;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (shuffleTimeoutRef.current) {
        window.clearTimeout(shuffleTimeoutRef.current);
      }
    };
  }, []);

  const handleShuffle = () => {
    if (isShuffling) return;

    const cardCount = 16;
    const configs: ShuffleCardConfig[] = Array.from({ length: cardCount }, (_, idx) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      const horizontalSwing = 140 + Math.random() * 180;
      const verticalLift = 90 + Math.random() * 140;
      const returnOffset = (Math.random() - 0.5) * 160;
      const swirl = direction * (180 + Math.random() * 200);
      const finalRotation = direction * (360 + Math.random() * 140);
      const duration = 2.3 + Math.random() * 1.2;
      const delay = idx * 0.04 + Math.random() * 0.2;
      const peakScale = 1.05 + Math.random() * 0.18;
      const endScale = 0.85 + Math.random() * 0.12;
      return {
        id: idx,
        pathX: [0, direction * horizontalSwing, direction * returnOffset, 0],
        pathY: [
          0,
          -verticalLift,
          verticalLift * 0.45 * (Math.random() > 0.5 ? 1 : -1),
          0,
        ],
        rotate: [0, swirl, swirl * 1.35, finalRotation],
        scale: [0.7 + Math.random() * 0.2, peakScale, 1, endScale],
        duration,
        delay,
        zIndex: 40 + Math.floor(Math.random() * 40),
      };
    });

    const longest = Math.max(...configs.map((c) => c.duration + c.delay));

    setShuffleConfig(configs);
    setShuffleRunId((prev) => prev + 1);
    setIsShuffling(true);
    setIsSpread(false);
    setSelectedIndices([]);
    setConfirmedCards([]);
    setShowConfirm(false);
    setRotationOffset(0);

    if (shuffleTimeoutRef.current) {
      window.clearTimeout(shuffleTimeoutRef.current);
    }

    shuffleTimeoutRef.current = window.setTimeout(() => {
      setIsShuffling(false);
      setIsSpread(true);
    }, (longest + 0.35) * 1000);
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
    } else if (selectedIndices.length < drawRequest.card_count) {
      const newSelected = [...selectedIndices, index];
      setSelectedIndices(newSelected);
      if (newSelected.length === drawRequest.card_count) {
        setShowConfirm(true);
      }
    }
  };

  const handleConfirm = () => {
    // 模拟抽牌结果
    const drawnCards: TarotCard[] = selectedIndices.map((idx) => {
      const cardInfo = getCardInfo(idx);
      return {
        card_id: idx,
        card_name: cardInfo?.name_zh || `塔罗牌 ${idx}`,
        reversed: Math.random() < 0.3,
      };
    });

    setConfirmedCards(drawnCards);

    // 延迟后关闭并返回结果
    setTimeout(() => {
      onCardsDrawn(drawnCards);
      onClose();
    }, 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isShuffling) {
              onClose();
            }
          }}
        >
          {/* 背景装饰 - 漂浮的星星 */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {Array.from({ length: 30 }).map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-1 h-1 bg-mystic-gold rounded-full"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0, 1.5, 0],
                }}
                transition={{
                  duration: 2 + Math.random() * 2,
                  repeat: Infinity,
                  delay: Math.random() * 2,
                }}
              />
            ))}
          </div>

          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-7xl h-[85vh] glass-morphism rounded-3xl shadow-2xl overflow-hidden border border-mystic-gold/30"
          >
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-20 p-6 bg-gradient-to-b from-dark-bg/90 to-transparent backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <motion.div
                    className="w-12 h-12 rounded-xl bg-mystic-gradient flex items-center justify-center shadow-mystic"
                    animate={{
                      boxShadow: [
                        '0 0 20px rgba(139, 92, 246, 0.5)',
                        '0 0 40px rgba(236, 72, 153, 0.8)',
                        '0 0 20px rgba(139, 92, 246, 0.5)',
                      ],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                    }}
                  >
                    <Sparkles size={24} className="text-white" />
                  </motion.div>
                  <div>
                    <h2 className="text-2xl font-display font-bold text-white">
                      抽取塔罗牌
                    </h2>
                    <p className="text-gray-400 font-display mt-1">
                      {isSpread
                        ? `请选择 ${drawRequest.card_count} 张牌 (已选${selectedIndices.length}/${drawRequest.card_count})`
                        : '静心凝神，准备开启命运之门'}
                    </p>
                  </div>
                </div>
                <motion.button
                  onClick={onClose}
                  disabled={isShuffling}
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  className="p-3 hover:bg-dark-elevated rounded-xl transition-colors disabled:opacity-50"
                >
                  <X size={24} />
                </motion.button>
              </div>
            </div>

            {/* Card Slots (选牌展示位置 - 在扇形牌阵正上方) */}
            {isSpread && (
              <div className="absolute top-[200px] left-0 right-0 z-20 px-6">
                <div className="flex gap-3 justify-center flex-wrap max-w-4xl mx-auto">
                  {Array.from({ length: drawRequest.card_count }).map((_, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 30, scale: 0.8 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: idx * 0.1 }}
                      className="relative w-20 h-32 rounded-lg border-2 border-dashed border-mystic-gold/40 flex flex-col items-center justify-center bg-dark-bg/50 backdrop-blur-sm overflow-hidden"
                    >
                      {/* 背景光效 */}
                      {selectedIndices[idx] !== undefined && (
                        <motion.div
                          className="absolute inset-0 bg-mystic-gradient opacity-20"
                          animate={{
                            opacity: [0.1, 0.3, 0.1],
                          }}
                          transition={{
                            duration: 2,
                            repeat: Infinity,
                          }}
                        />
                      )}

                      {confirmedCards[idx] ? (
                        <motion.div
                          initial={{ scale: 0, rotateY: 180 }}
                          animate={{ scale: 1, rotateY: 0 }}
                          className="relative text-center"
                        >
                          <div className="text-5xl mb-2">
                            {confirmedCards[idx].reversed ? '🔮' : '✨'}
                          </div>
                          <div className="text-xs text-white font-display font-medium">
                            {confirmedCards[idx].reversed ? '逆位' : '正位'}
                          </div>
                        </motion.div>
                      ) : selectedIndices[idx] !== undefined ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="text-3xl"
                        >
                          ✨
                        </motion.div>
                      ) : (
                        <div className="text-center">
                          <div className="text-sm text-gray-500 font-display font-medium mb-1">
                            {drawRequest.positions?.[idx] || `位置${idx + 1}`}
                          </div>
                          <div className="w-8 h-8 mx-auto border border-mystic-gold/30 rounded-lg" />
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Cards Display */}
            <motion.div className="relative h-full w-full flex items-center justify-center px-6 pb-4">
              <div className="absolute inset-4 rounded-[36px] overflow-hidden pointer-events-none">
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url(${TABLE_BACKGROUND_IMAGE})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: 'brightness(0.88)',
                  }}
                />
                <div className="absolute inset-0 bg-[#0a0718]/72" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,228,185,0.18),transparent_78%)] mix-blend-screen" />
              </div>

              <div className="relative z-10 w-full h-full flex items-center justify-center">
                {/* 洗牌按钮 */}
                {!isSpread && !isShuffling && (
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 100 }}
                    className="text-center"
                  >
                    <motion.button
                      onClick={handleShuffle}
                      whileHover={{ scale: 1.05, y: -5 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-10 py-5 bg-mystic-gradient rounded-2xl text-xl font-display font-bold flex items-center gap-4 shadow-2xl shadow-mystic relative overflow-hidden group"
                    >
                      {/* 按钮光效 */}
                      <motion.div
                        className="absolute inset-0 bg-white/20"
                        animate={{
                          x: ['-100%', '200%'],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          repeatDelay: 1,
                        }}
                      />
                      <Shuffle size={28} />
                      <span className="relative z-10">开始洗牌</span>
                    </motion.button>

                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                      className="mt-6 text-gray-300 font-display"
                    >
                      🌟 深呼吸，让心灵与牌阵共鸣
                    </motion.p>
                  </motion.div>
                )}

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
                        <div className="absolute inset-0 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(253,244,215,0.25),rgba(125,94,211,0.08)_58%,transparent_85%)] blur-[120px] mix-blend-screen" />
                        <motion.div
                          className="absolute inset-[18%] rounded-full bg-[conic-gradient(from_0deg,rgba(254,240,199,0.22),rgba(148,163,255,0.06),rgba(254,240,199,0.22))] opacity-60 blur-[90px] mix-blend-screen"
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
                          className="absolute w-24 h-36 rounded-xl overflow-hidden shadow-[0_16px_44px_rgba(225,196,142,0.22)] border border-mystic-gold/30"
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
                  <motion.div
                    className="absolute bottom-0 left-0 right-0 w-full"
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
                                    font-display font-bold text-xs shadow-lg
                                    ${isSelected
                                      ? 'bg-mystic-gold text-dark-bg ring-2 ring-mystic-gold/50'
                                      : 'bg-dark-elevated/90 text-gray-300 border-2 border-mystic-gold/30'}
                                  `}
                                >
                                  {selectionOrder >= 0 ? `✨${selectionOrder + 1}` : cardId + 1}
                                </motion.div>

                                <motion.div
                                  className={`
                                    w-24 h-36 rounded-lg shadow-2xl overflow-hidden
                                    transition-all duration-300
                                    ${
                                      isSelected
                                        ? 'ring-4 ring-mystic-gold shadow-mystic-gold'
                                        : 'ring-2 ring-white/30 hover:ring-mystic-purple/60'
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
                                        '0 0 18px rgba(255, 215, 0, 0.5)',
                                        '0 0 34px rgba(255, 215, 0, 0.85)',
                                        '0 0 18px rgba(255, 215, 0, 0.5)',
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
                        className="relative w-[210px] h-2 rounded-full bg-dark-elevated/80 backdrop-blur-sm border border-mystic-gold/30 shadow-lg cursor-grab"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-mystic-gold/15 to-transparent pointer-events-none" />

                        <motion.div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none"
                          animate={{
                            left: `${sliderProgress * 100}%`,
                          }}
                          transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                        >
                          <div className="relative w-6 h-6 rounded-full bg-mystic-gold shadow-[0_0_18px_rgba(251,191,36,0.8)] border-2 border-dark-elevated/80">
                            <div className="absolute inset-1 rounded-full bg-dark-elevated/90" />
                          </div>
                        </motion.div>
                      </motion.div>
                    </motion.div>
                  </motion.div>
                )}
              </div>
            </motion.div>

            {/* Confirm Button */}
            {showConfirm && confirmedCards.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 30, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="absolute bottom-8 left-0 right-0 flex justify-center z-20"
              >
                <motion.button
                  onClick={handleConfirm}
                  whileHover={{ scale: 1.05, y: -3 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-10 py-4 bg-gold-gradient rounded-2xl text-xl font-display font-bold shadow-2xl shadow-gold text-dark-bg relative overflow-hidden group"
                >
                  {/* 按钮光效 */}
                  <motion.div
                    className="absolute inset-0 bg-white/30"
                    animate={{
                      x: ['-100%', '200%'],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      repeatDelay: 0.5,
                    }}
                  />
                  <span className="relative z-10 flex items-center gap-3">
                    <Sparkles size={24} />
                    确认抽牌
                    <Sparkles size={24} />
                  </span>
                </motion.button>
              </motion.div>
            )}

            {/* 抽牌完成提示 */}
            {confirmedCards.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-30"
              >
                <div className="text-center">
                  <motion.div
                    animate={{
                      rotate: 360,
                      scale: [1, 1.2, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                    }}
                    className="text-8xl mb-6"
                  >
                    ✨
                  </motion.div>
                  <h3 className="text-3xl font-display font-bold text-mystic-gold mb-4">
                    命运之牌已就位
                  </h3>
                  <p className="text-gray-400 font-display">
                    正在为您解读...
                  </p>
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
