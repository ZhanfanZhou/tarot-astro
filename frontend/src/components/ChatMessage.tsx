import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Copy, Check, ThumbsUp, ThumbsDown, Share2 } from 'lucide-react';
import type { FeedbackRating, Message, SessionType, TarotCard } from '@/types';
import { getCardInfo } from '@/config/tarotCards';
import { useDeckWallet } from '@/stores/useDeckWallet';
import { resolveActiveCardImage } from '@/data/activeDeckImage';
import Markdown from './Markdown';
import ChatInvite from './ChatInvite';
import ShareDialog from './ShareDialog';
import CardPreview from './CardPreview';

interface ChatMessageProps {
  message: Message;
  /**
   * 这条回复要一起展示的牌面。牌存在抽牌的 tool 记录上，由 App 关联到抽牌之后第一条
   * 有正文的回复——只有那一条带牌，后续追问不重复画。
   * 每日一签的解读自己带 message.tarot_cards（服务端直接生成，没有工具调用），优先用它。
   */
  drawnCards?: Message['tarot_cards'];
  drawnRequest?: Message['draw_request'];
  isThinking?: boolean;
  sessionType?: SessionType;
  showDrawButton?: boolean; // 是否显示抽牌按钮
  drawPositions?: string[]; // 等着抽的那副牌阵的位置，写在抽牌按钮上
  onReadyToDraw?: () => void; // 点击抽牌按钮的回调
  showProfileButton?: boolean; // 是否显示补充资料按钮
  onReadyToFillProfile?: () => void; // 点击补充资料按钮的回调
  isStreaming?: boolean; // 正在流式输出（显示光标 + 纯文本）
  /** 用户对这条回复的评价；传了 onFeedback 才显示赞 / 踩（只给已落库的回复） */
  feedback?: FeedbackRating;
  onFeedback?: (rating: FeedbackRating | null) => void;
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
  drawnCards,
  drawnRequest,
  isThinking = false,
  sessionType,
  showDrawButton = false,
  drawPositions,
  onReadyToDraw,
  showProfileButton = false,
  onReadyToFillProfile,
  isStreaming = false,
  feedback,
  onFeedback,
}) => {
  const isUser = message.role === 'user';
  // 都不是「谁说的话」：tool 是工具结果（牌面由之后的回复画），system 只在旧版本对话里有
  const isSystem = message.role === 'system' || message.role === 'tool';
  const cards = message.tarot_cards?.length ? message.tarot_cards : drawnCards;
  const spread = message.tarot_cards?.length ? message.draw_request : drawnRequest;
  const trimmedContent = message.content?.trim() ?? '';
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [previewCard, setPreviewCard] = useState<TarotCard | null>(null);

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
    sessionType === 'tarot' || sessionType === 'daily' ? '/assets/avatar-tarot.webp' : '/assets/avatar-astrology.webp';

  // 系统消息不显示
  if (isSystem) return null;
  // 只有工具调用、没正文也没牌的 AI 记录不显示（除非要挂按钮）
  if (!isUser && !isThinking && !trimmedContent && !cards?.length && !showDrawButton && !showProfileButton) {
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

          {/* 抽牌 — 金色，说明那一行写出牌阵的位置 */}
          {!isUser && showDrawButton && onReadyToDraw && (
            <ChatInvite
              kind="draw"
              title={trimmedContent ? '我准备好了' : '抽牌'}
              positions={drawPositions}
              afterText={Boolean(trimmedContent)}
              onClick={onReadyToDraw}
            />
          )}

          {/* 补充资料 — 月光银蓝 */}
          {!isUser && showProfileButton && onReadyToFillProfile && (
            <ChatInvite
              kind="profile"
              title="补充资料"
              afterText={Boolean(trimmedContent)}
              onClick={onReadyToFillProfile}
            />
          )}

          {/* 抽到的牌 */}
          {cards && cards.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className={trimmedContent ? 'mt-6 pt-5' : ''}
              style={trimmedContent ? { borderTop: '1px solid var(--line)' } : undefined}
            >
              <div className="flex items-center justify-center gap-3 mb-5">
                <span className="h-px w-8 bg-gradient-to-r from-transparent to-mystic-gold/50" />
                <span className="eyebrow" style={{ fontSize: '10px', letterSpacing: '0.3em', color: 'var(--gold)' }}>
                  抽到的牌
                </span>
                <span className="h-px w-8 bg-gradient-to-l from-transparent to-mystic-gold/50" />
              </div>

              <div className="flex flex-wrap gap-5 justify-center">
                {cards.map((card, idx) => {
                  const cardInfo = getCardInfo(card.card_id);
                  return (
                    <TarotCardDisplay
                      key={idx}
                      card={card}
                      cardInfo={cardInfo}
                      position={spread?.positions?.[idx]}
                      index={idx}
                      onPreview={() => setPreviewCard(card)}
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
          {/* 复制 / 赞 / 踩常驻（手机上没有悬停）；点过的那个亮起，再点一次取消 */}
          {!isUser && trimmedContent && !isStreaming && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] tracking-wide opacity-60 hover:opacity-100 focus:opacity-100 transition-opacity"
              style={{ color: copied ? 'var(--gold)' : 'var(--ivory-faint)' }}
              aria-label="复制解读"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </button>
          )}
          {!isUser && trimmedContent && !isStreaming && onFeedback &&
            (['up', 'down'] as const).map((rating) => {
              const active = feedback === rating;
              const Icon = rating === 'up' ? ThumbsUp : ThumbsDown;
              return (
                <button
                  key={rating}
                  onClick={() => onFeedback(active ? null : rating)}
                  className={`flex items-center text-[11px] transition-opacity ${
                    active ? 'opacity-100' : 'opacity-60 hover:opacity-100 focus:opacity-100'
                  }`}
                  style={{ color: active ? oracleAccent : 'var(--ivory-faint)' }}
                  aria-label={rating === 'up' ? '赞' : '踩'}
                  aria-pressed={active}
                >
                  <Icon size={12} fill={active ? 'currentColor' : 'none'} />
                </button>
              );
            })}
          {!isUser && trimmedContent && !isStreaming && onFeedback && (
            <button
              onClick={() => setSharing(true)}
              className="flex items-center text-[11px] opacity-60 hover:opacity-100 focus:opacity-100 transition-opacity"
              style={{ color: 'var(--ivory-faint)' }}
              aria-label="分享"
            >
              <Share2 size={12} />
            </button>
          )}
        </div>
      </div>

      <ShareDialog open={sharing} excerpt={trimmedContent.slice(0, 120)} onClose={() => setSharing(false)} />

      {/* 大图预览 — 点击牌面查看，不改变对话框中的牌朝向 */}
      <CardPreview card={previewCard} onClose={() => setPreviewCard(null)} />
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
