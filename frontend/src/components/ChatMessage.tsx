import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Copy, Check, X } from 'lucide-react';
import type { Message, SessionType } from '@/types';
import { getCardInfo } from '@/config/tarotCards';
import { useDeckWallet } from '@/stores/useDeckWallet';
import { resolveActiveCardImage } from '@/data/activeDeckImage';
import Markdown from './Markdown';

interface ChatMessageProps {
  message: Message;
  isThinking?: boolean;
  sessionType?: SessionType;
  showDrawButton?: boolean; // 是否显示抽牌按钮
  onReadyToDraw?: () => void; // 点击抽牌按钮的回调
  showProfileButton?: boolean; // 是否显示补充资料按钮
  onReadyToFillProfile?: () => void; // 点击补充资料按钮的回调
  isStreaming?: boolean; // 正在流式输出（显示光标 + 纯文本）
}

const THINKING_MESSAGES = [
  '凝神思索',
  '灵感汇聚',
  '星辰共鸣',
  '牌运流转',
  '宇宙指引',
  '深层解读',
  '命运显现',
  '智慧连接',
];

const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isThinking = false,
  sessionType,
  showDrawButton = false,
  onReadyToDraw,
  showProfileButton = false,
  onReadyToFillProfile,
  isStreaming = false,
}) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const trimmedContent = message.content?.trim() ?? '';
  const [copied, setCopied] = useState(false);
  const [previewCard, setPreviewCard] = useState<{ card: any; cardInfo: any } | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const plainTextStyle: React.CSSProperties = {
    color: 'var(--ivory)',
    lineHeight: 1.9,
    fontSize: '15px',
    letterSpacing: '0.015em',
  };

  // 神谕的口吻随会话类型变换强调色：塔罗=古铜金，占星=月光银蓝
  const oracleAccent = sessionType === 'astrology' ? 'var(--moon)' : 'var(--gold)';
  const getAIAvatarPath = () =>
    sessionType === 'tarot' ? '/assets/avatar_tarot.png' : '/assets/avatar.png';

  // 系统消息不显示
  if (isSystem) return null;

  // 隐藏自动触发解读 / 星盘的消息
  if (isUser && message.content === '请根据抽牌结果进行解读') return null;
  if (
    isUser &&
    (message.content === '资料补充好了，我的星盘信息已经准备好了' ||
      message.content === '星盘数据已准备好，请继续解读' ||
      message.content === '我已经填写好出生信息了')
  ) {
    return null;
  }

  // ── 思考状态 ─────────────────────────────────────────────────────────────
  if (isThinking) {
    const thinkingText = THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)];
    return (
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex gap-4">
        <div
          className="flex-shrink-0 w-11 h-11 rounded-full overflow-hidden ring-1 ring-offset-2 ring-offset-dark-bg"
          style={{ '--tw-ring-color': oracleAccent } as React.CSSProperties}
        >
          <img src={getAIAvatarPath()} alt="AI" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 max-w-3xl">
          <div
            className="inline-flex items-center gap-3 px-5 py-3.5 rounded-2xl rounded-tl-md backdrop-blur-xl"
            style={{ background: 'rgba(12,12,22,0.7)', border: '1px solid var(--line)' }}
          >
            <span className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: oracleAccent }}
                  animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
                  transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.18 }}
                />
              ))}
            </span>
            <span className="text-sm tracking-[0.18em]" style={{ color: 'var(--ivory-dim)' }}>
              {thinkingText}
            </span>
          </div>
        </div>
      </motion.div>
    );
  }

  // ── 普通消息 ─────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      className={`group flex gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      {isUser ? (
        <div className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center bg-secondary/12 border border-secondary/40">
          <User size={20} style={{ color: 'var(--moon)' }} />
        </div>
      ) : (
        <div
          className="flex-shrink-0 w-11 h-11 rounded-full overflow-hidden ring-1 ring-offset-2 ring-offset-dark-bg"
          style={{ '--tw-ring-color': oracleAccent } as React.CSSProperties}
        >
          <img src={getAIAvatarPath()} alt="AI" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 max-w-3xl ${isUser ? 'text-right' : 'text-left'}`}>
        <div
          className={`inline-block px-5 py-4 rounded-2xl backdrop-blur-xl text-left ${
            isUser ? 'rounded-tr-md' : 'rounded-tl-md'
          }`}
          style={
            isUser
              ? {
                  background:
                    'linear-gradient(135deg, rgba(168,216,234,0.15) 0%, rgba(110,157,181,0.09) 100%)',
                  border: '1px solid rgba(168,216,234,0.28)',
                }
              : {
                  background: 'rgba(12,12,22,0.72)',
                  border: '1px solid var(--line)',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.32)',
                }
          }
        >
          {trimmedContent &&
            (isUser ? (
              <p className="whitespace-pre-wrap break-words" style={plainTextStyle}>
                {message.content}
              </p>
            ) : isStreaming ? (
              <p className="whitespace-pre-wrap break-words stream-caret" style={plainTextStyle}>
                {message.content}
              </p>
            ) : (
              <Markdown content={message.content} />
            ))}

          {/* 抽牌按钮 — 主行动，金色 */}
          {!isUser && showDrawButton && onReadyToDraw && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onReadyToDraw}
              className={`${trimmedContent ? 'mt-5' : ''} group relative mx-auto flex items-center gap-3 px-7 py-3 rounded-full
                         font-display tracking-[0.16em] text-sm overflow-hidden transition-colors duration-300
                         border border-mystic-gold/55 text-mystic-gold hover:text-dark-bg`}
            >
              <span className="absolute inset-0 -z-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 bg-gold-gradient" />
              <span className="relative z-10">✦</span>
              <span className="relative z-10">{trimmedContent ? '我准备好了' : '抽 牌'}</span>
              <span className="relative z-10">✦</span>
            </motion.button>
          )}

          {/* 补充资料按钮 — 次行动，月光银蓝 */}
          {!isUser && showProfileButton && onReadyToFillProfile && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onReadyToFillProfile}
              className={`${trimmedContent ? 'mt-5' : ''} mx-auto flex items-center gap-3 px-7 py-3 rounded-full
                         font-display tracking-[0.16em] text-sm transition-colors duration-300
                         border border-secondary/50 text-secondary hover:bg-secondary/12`}
            >
              <span>☽</span>
              补充资料
              <span>☽</span>
            </motion.button>
          )}

          {/* 抽到的牌 */}
          {message.tarot_cards && message.tarot_cards.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mt-6 pt-5"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <div className="flex items-center justify-center gap-3 mb-5">
                <span className="h-px w-8 bg-gradient-to-r from-transparent to-mystic-gold/50" />
                <span className="eyebrow" style={{ fontSize: '10px', letterSpacing: '0.3em', color: 'var(--gold)' }}>
                  抽到的牌
                </span>
                <span className="h-px w-8 bg-gradient-to-l from-transparent to-mystic-gold/50" />
              </div>

              <div className="flex flex-wrap gap-5 justify-center">
                {message.tarot_cards.map((card, idx) => {
                  const cardInfo = getCardInfo(card.card_id);
                  return (
                    <TarotCardDisplay
                      key={idx}
                      card={card}
                      cardInfo={cardInfo}
                      position={message.draw_request?.positions?.[idx]}
                      index={idx}
                      onPreview={() => setPreviewCard({ card, cardInfo })}
                    />
                  );
                })}
              </div>
            </motion.div>
          )}
        </div>

        <div className={`flex items-center gap-3 mt-2 px-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[11px] tracking-[0.14em]" style={{ color: 'var(--ivory-faint)' }}>
            {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
          {!isUser && trimmedContent && !isStreaming && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] tracking-wide opacity-0 group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 transition-opacity"
              style={{ color: copied ? 'var(--gold)' : 'var(--ivory-faint)' }}
              aria-label="复制解读"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </button>
          )}
        </div>
      </div>

      {/* 大图预览 — 点击牌面查看，不改变对话框中的牌朝向 */}
      {createPortal(
        <AnimatePresence>
          {previewCard && (
            <CardPreview card={previewCard.card} cardInfo={previewCard.cardInfo} onClose={() => setPreviewCard(null)} />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </motion.div>
  );
};

// ── 大图预览（灯箱） ─────────────────────────────────────────────────────────
const CardPreview: React.FC<{ card: any; cardInfo: any; onClose: () => void }> = ({ card, cardInfo, onClose }) => {
  const [imageError, setImageError] = useState(false);
  const accent = card.reversed ? 'var(--moon)' : 'var(--gold)';
  const name = cardInfo?.name_zh || card.card_name;
  const activeDeckId = useDeckWallet((s) => s.activeDeckId);
  const resolved = cardInfo ? resolveActiveCardImage(cardInfo.imageUrl, activeDeckId) : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/85 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 16 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col items-center"
      >
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ background: 'rgba(6,6,15,0.9)', border: '1px solid var(--line)', color: 'var(--ivory-dim)' }}
          aria-label="关闭预览"
        >
          <X size={17} />
        </button>

        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            border: `1px solid ${accent}`,
            boxShadow: `0 24px 70px rgba(0,0,0,0.6), 0 0 40px ${card.reversed ? 'rgba(168,216,234,0.22)' : 'rgba(201,169,110,0.24)'}`,
          }}
        >
          {cardInfo && !imageError ? (
            <>
              <img
                src={resolved?.src ?? cardInfo.imageUrl}
                alt={name}
                onError={() => setImageError(true)}
                className="block w-auto object-contain"
                style={{ maxHeight: '74vh', maxWidth: '88vw' }}
              />
              {resolved?.tint && <div className="absolute inset-0 pointer-events-none" style={resolved.tint} />}
            </>
          ) : (
            <div
              className="flex flex-col items-center justify-center"
              style={{ width: 'min(320px, 80vw)', aspectRatio: '2 / 3.5', background: 'linear-gradient(160deg, #12121e 0%, #0a0a14 100%)' }}
            >
              <div className="text-5xl mb-4" style={{ color: accent, opacity: 0.85 }}>✦</div>
              <div className="text-lg" style={{ color: 'var(--ivory)' }}>{name}</div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="font-display text-lg tracking-wide" style={{ color: 'var(--ivory)' }}>{name}</span>
          {cardInfo?.name_en && (
            <span className="text-sm tracking-[0.12em]" style={{ color: 'var(--ivory-faint)' }}>{cardInfo.name_en}</span>
          )}
          {card.reversed && (
            <span
              className="px-2.5 py-0.5 rounded-full text-[11px] tracking-wider"
              style={{ color: 'var(--moon)', border: '1px solid rgba(168,216,234,0.4)', background: 'rgba(6,6,15,0.8)' }}
            >
              逆位
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

// ── 单张塔罗牌展示 ───────────────────────────────────────────────────────────
const TarotCardDisplay: React.FC<{
  card: any;
  cardInfo: any;
  position?: string;
  index: number;
  onPreview: () => void;
}> = ({ card, cardInfo, position, index, onPreview }) => {
  const [imageError, setImageError] = useState(false);
  const accent = card.reversed ? 'var(--moon)' : 'var(--gold)';
  const activeDeckId = useDeckWallet((s) => s.activeDeckId);
  const resolved = cardInfo ? resolveActiveCardImage(cardInfo.imageUrl, activeDeckId) : null;

  return (
    <motion.div
      initial={{ opacity: 0, rotateY: 90, y: 14 }}
      animate={{ opacity: 1, rotateY: 0, y: 0 }}
      transition={{ delay: index * 0.18, type: 'spring', stiffness: 90, damping: 14 }}
      className="relative group"
      style={{ width: '128px', perspective: '900px' }}
    >
      {/* 点击查看大图；悬停抬升的 transform 与逆位旋转拆分到不同元素，避免互相覆盖 */}
      <button
        type="button"
        onClick={onPreview}
        aria-label="查看大图"
        className="block w-full cursor-zoom-in transition-transform duration-300 hover:-translate-y-2 focus:outline-none focus-visible:-translate-y-2"
      >
        <div
          className="relative w-full aspect-[2/3.5] rounded-xl overflow-hidden"
          style={{
            border: `1px solid ${accent}`,
            boxShadow: `0 10px 30px rgba(0,0,0,0.5), 0 0 18px ${card.reversed ? 'rgba(168,216,234,0.18)' : 'rgba(201,169,110,0.2)'}`,
            transform: card.reversed ? 'rotate(180deg)' : undefined,
          }}
        >
          {/* 逆位标记 */}
          {card.reversed && (
            <div
              className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full text-[10px] tracking-wider"
              style={{
                transform: 'rotate(180deg)',
                background: 'rgba(6,6,15,0.8)',
                color: 'var(--moon)',
                border: '1px solid rgba(168,216,234,0.4)',
              }}
            >
              逆位
            </div>
          )}

          {cardInfo && !imageError ? (
            <>
              <img
                src={resolved?.src ?? cardInfo.imageUrl}
                alt={cardInfo.name_zh}
                className="w-full h-full object-cover"
                onError={() => setImageError(true)}
                loading="lazy"
              />
              {resolved?.tint && <div className="absolute inset-0 pointer-events-none" style={resolved.tint} />}
            </>
          ) : (
            <div
              className="w-full h-full flex flex-col items-center justify-center p-3 relative"
              style={{ background: 'linear-gradient(160deg, #12121e 0%, #0a0a14 100%)' }}
            >
              <div className="absolute inset-3 rounded-lg" style={{ border: '1px solid var(--line)' }} />
              <div className="text-3xl mb-3" style={{ color: accent, opacity: 0.85 }}>✦</div>
              <div className="text-center text-sm leading-tight px-2" style={{ color: 'var(--ivory)' }}>
                {cardInfo?.name_zh || card.card_name}
              </div>
              {cardInfo && (
                <div className="text-xs mt-1 text-center" style={{ color: 'var(--ivory-faint)' }}>
                  {cardInfo.name_en}
                </div>
              )}
            </div>
          )}

          {/* 悬停暗角 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </div>
      </button>

      {/* 位置标签 */}
      {position && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: index * 0.18 + 0.3 }}
          className="mt-2.5 text-center"
        >
          <span
            className="inline-block px-3 py-1 rounded-full text-[11px] tracking-[0.12em]"
            style={{ color: 'var(--gold)', border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}
          >
            {position}
          </span>
        </motion.div>
      )}
    </motion.div>
  );
};

export default ChatMessage;
