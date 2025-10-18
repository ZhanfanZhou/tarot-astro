import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shuffle } from 'lucide-react';
import type { DrawCardsRequest, TarotCard } from '@/types';

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
      
      // Debug logging
      console.log('[TarotCardDrawer] Opened with drawRequest:', drawRequest);
      console.log('[TarotCardDrawer] positions:', drawRequest.positions);
      console.log('[TarotCardDrawer] positions type:', typeof drawRequest.positions);
      console.log('[TarotCardDrawer] positions is array:', Array.isArray(drawRequest.positions));
      if (drawRequest.positions) {
        console.log('[TarotCardDrawer] positions length:', drawRequest.positions.length);
        console.log('[TarotCardDrawer] positions[0]:', drawRequest.positions[0]);
      }
    }
  }, [isOpen]);

  const handleShuffle = () => {
    setIsShuffling(true);
    setTimeout(() => {
      setIsShuffling(false);
      setIsSpread(true);
    }, 2000);
  };

  const handleCardClick = (index: number) => {
    if (!isSpread || isShuffling) return;

    if (selectedIndices.includes(index)) {
      setSelectedIndices(selectedIndices.filter((i) => i !== index));
    } else if (selectedIndices.length < drawRequest.card_count) {
      setSelectedIndices([...selectedIndices, index]);
      if (selectedIndices.length + 1 === drawRequest.card_count) {
        setShowConfirm(true);
      }
    }
  };

  const handleConfirm = () => {
    // 模拟抽牌结果（实际应该调用API）
    const drawnCards: TarotCard[] = selectedIndices.map((idx) => ({
      card_id: idx,
      card_name: `塔罗牌 ${idx}`,
      reversed: Math.random() < 0.3,
    }));

    setConfirmedCards(drawnCards);
    
    // 延迟后关闭并返回结果
    setTimeout(() => {
      onCardsDrawn(drawnCards);
      onClose();
    }, 1500);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isShuffling) {
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-6xl h-[80vh] bg-dark-surface rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-10 p-6 bg-gradient-to-b from-dark-bg to-transparent">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">抽取塔罗牌</h2>
                  <p className="text-gray-400 mt-1">
                    {isSpread
                      ? `请选择 ${drawRequest.card_count} 张牌 (已选${selectedIndices.length}张)`
                      : '点击洗牌开始'}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  disabled={isShuffling}
                  className="p-2 hover:bg-dark-hover rounded-lg transition-colors disabled:opacity-50"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            {/* Card Slots (顶部) */}
            {isSpread && (
              <div className="absolute top-24 left-0 right-0 z-10 px-6">
                <div className="flex gap-4 justify-center">
                  {Array.from({ length: drawRequest.card_count }).map((_, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="w-24 h-36 border-2 border-dashed border-primary/50 rounded-lg flex items-center justify-center bg-dark-bg/50"
                    >
                      {confirmedCards[idx] ? (
                        <div className="text-center p-2">
                          <div className="text-4xl mb-2">🎴</div>
                          <div className="text-xs">
                            {confirmedCards[idx].reversed ? '逆位' : '正位'}
                          </div>
                        </div>
                      ) : selectedIndices[idx] !== undefined ? (
                        <div className="text-2xl">✨</div>
                      ) : (
                        <div className="text-sm text-gray-500">
                          {drawRequest.positions?.[idx] || `位置${idx + 1}`}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Cards Display */}
            <div className="h-full flex items-center justify-center p-6 pt-48">
              {!isSpread && !isShuffling && (
                <motion.button
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleShuffle}
                  className="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl text-xl font-bold flex items-center gap-3 shadow-lg"
                >
                  <Shuffle size={24} />
                  开始洗牌
                </motion.button>
              )}

              {isShuffling && (
                <div className="relative w-32 h-48">
                  {cards.slice(0, 10).map((_, idx) => (
                    <motion.div
                      key={idx}
                      className="absolute inset-0 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl shadow-xl"
                      animate={{
                        rotate: [0, 360],
                        scale: [1, 1.1, 1],
                        x: Math.sin(idx) * 50,
                        y: Math.cos(idx) * 50,
                      }}
                      transition={{
                        duration: 2,
                        repeat: 0,
                        delay: idx * 0.05,
                      }}
                    >
                      <div className="w-full h-full flex items-center justify-center text-4xl">
                        🎴
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {isSpread && (
                <div className="w-full max-w-5xl">
                  <div className="relative h-64">
                    {cards.map((cardId, idx) => {
                      const totalCards = cards.length;
                      const angle = (idx / totalCards) * 180 - 90;
                      const radius = 400;
                      const x = Math.cos((angle * Math.PI) / 180) * radius;
                      const y = Math.sin((angle * Math.PI) / 180) * radius * 0.6;
                      const isSelected = selectedIndices.includes(idx);

                      return (
                        <motion.div
                          key={cardId}
                          initial={{ x: 0, y: 0, rotate: 0 }}
                          animate={{
                            x,
                            y,
                            rotate: angle + 90,
                          }}
                          transition={{
                            duration: 1,
                            delay: idx * 0.01,
                          }}
                          className="absolute left-1/2 top-1/2 cursor-pointer"
                          style={{
                            transformOrigin: 'center center',
                          }}
                          onClick={() => handleCardClick(idx)}
                        >
                          <motion.div
                            whileHover={{ scale: 1.2, z: 10 }}
                            animate={{
                              scale: isSelected ? 1.3 : 1,
                              y: isSelected ? -20 : 0,
                            }}
                            className={`w-16 h-24 bg-gradient-to-br rounded-lg shadow-lg flex items-center justify-center text-2xl ${
                              isSelected
                                ? 'from-yellow-500 to-orange-500 ring-4 ring-yellow-400'
                                : 'from-purple-600 to-pink-600'
                            }`}
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
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-6 left-0 right-0 flex justify-center"
              >
                <button
                  onClick={handleConfirm}
                  className="px-8 py-4 bg-gradient-to-r from-green-500 to-teal-500 rounded-xl text-xl font-bold shadow-lg hover:scale-105 transition-transform"
                >
                  确认抽牌
                </button>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TarotCardDrawer;




