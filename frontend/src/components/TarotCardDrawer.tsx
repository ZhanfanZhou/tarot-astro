import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shuffle, Sparkles } from 'lucide-react';
import type { DrawCardsRequest, TarotCard } from '@/types';
import { getCardInfo, CARD_BACK_IMAGE } from '@/config/tarotCards';

interface TarotCardDrawerProps {
  isOpen: boolean;
  drawRequest: DrawCardsRequest;
  onClose: () => void;
  onCardsDrawn: (cards: TarotCard[]) => void;
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

  // 生成78张牌的数组
  const cards = Array.from({ length: 78 }, (_, i) => i);

  useEffect(() => {
    if (isOpen) {
      setIsShuffling(false);
      setIsSpread(false);
      setSelectedIndices([]);
      setConfirmedCards([]);
      setShowConfirm(false);
    }
  }, [isOpen]);

  const handleShuffle = () => {
    setIsShuffling(true);
    setTimeout(() => {
      setIsShuffling(false);
      setIsSpread(true);
    }, 2500);
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

            {/* Card Slots (顶部显示位置) */}
            {isSpread && (
              <div className="absolute top-24 left-0 right-0 z-10 px-6">
                <div className="flex gap-4 justify-center flex-wrap">
                  {Array.from({ length: drawRequest.card_count }).map((_, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: -30, scale: 0.8 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: idx * 0.1 }}
                      className="relative w-28 h-40 rounded-xl border-2 border-dashed border-mystic-gold/40 flex flex-col items-center justify-center bg-dark-bg/50 backdrop-blur-sm overflow-hidden"
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
            <div className="h-full flex items-center justify-center p-6 pt-52">
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
                    className="mt-6 text-gray-400 font-display"
                  >
                    🌟 深呼吸，让心灵与牌阵共鸣
                  </motion.p>
                </motion.div>
              )}

              {/* 洗牌动画 */}
              {isShuffling && (
                <div className="relative w-40 h-56">
                  {cards.slice(0, 15).map((_, idx) => {
                    const angle = (idx / 15) * 360;
                    const radius = 80;
                    return (
                      <motion.div
                        key={idx}
                        className="absolute inset-0 bg-mystic-gradient rounded-2xl shadow-2xl flex items-center justify-center text-4xl"
                        animate={{
                          rotate: [0, 360, 720],
                          x: [
                            0,
                            Math.cos((angle * Math.PI) / 180) * radius,
                            0,
                          ],
                          y: [
                            0,
                            Math.sin((angle * Math.PI) / 180) * radius,
                            0,
                          ],
                          scale: [1, 1.2, 1],
                        }}
                        transition={{
                          duration: 2.5,
                          delay: idx * 0.05,
                          ease: 'easeInOut',
                        }}
                      >
                        🎴
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* 展开的牌阵 */}
              {isSpread && (
                <div className="w-full max-w-6xl">
                  <div className="relative h-72">
                    {cards.map((cardId, idx) => {
                      const totalCards = cards.length;
                      const angle = (idx / totalCards) * 180 - 90;
                      const radius = 450;
                      const x = Math.cos((angle * Math.PI) / 180) * radius;
                      const y = Math.sin((angle * Math.PI) / 180) * radius * 0.6;
                      const isSelected = selectedIndices.includes(idx);
                      const cardInfo = getCardInfo(cardId);

                      return (
                        <motion.div
                          key={cardId}
                          initial={{ x: 0, y: 0, rotate: 0, opacity: 0 }}
                          animate={{
                            x,
                            y,
                            rotate: angle + 90,
                            opacity: 1,
                          }}
                          transition={{
                            duration: 1.2,
                            delay: idx * 0.008,
                            type: 'spring',
                            stiffness: 80,
                          }}
                          className="absolute left-1/2 top-1/2 cursor-pointer"
                          style={{
                            transformOrigin: 'center center',
                          }}
                          onClick={() => handleCardClick(idx)}
                        >
                          <motion.div
                            whileHover={{ scale: 1.3, z: 20 }}
                            animate={{
                              scale: isSelected ? 1.4 : 1,
                              y: isSelected ? -25 : 0,
                            }}
                            transition={{ type: 'spring', stiffness: 300 }}
                            className={`
                              w-20 h-28 rounded-lg shadow-2xl overflow-hidden
                              flex items-center justify-center text-3xl
                              ${
                                isSelected
                                  ? 'ring-4 ring-mystic-gold shadow-mystic-gold'
                                  : 'ring-1 ring-white/20'
                              }
                            `}
                            style={{
                              background: isSelected
                                ? 'linear-gradient(135deg, #FFD700, #FFF4A3)'
                                : 'linear-gradient(135deg, #6D28D9, #8B5CF6, #EC4899)',
                            }}
                          >
                            {isSelected ? '✨' : '🎴'}
                          </motion.div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

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
