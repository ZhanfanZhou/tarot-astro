import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, MoreHorizontal, Copy, ArrowDownToLine, Trash2 } from 'lucide-react';
import WalletChip from './wallet/WalletChip';
import AccountMenu from './AccountMenu';
import type { Conversation, User } from '@/types';
import { canDelete } from '@/utils/conversation';

interface TopBarProps {
  /** 当前会话；null = 在殿堂 */
  conversation: Conversation | null;
  user: User | null;
  /** 能量剩余百分比，交给账户那一枚 */
  energy: number | null;
  onHome: () => void;
  onCopyAll: () => void;
  onScrollToLatest: () => void;
  onDelete: () => void;
  onConvertAccount: () => void;
  onLogout: () => void;
}

/**
 * 殿堂与对话共用的顶栏。左：logo + 所在之处（殿堂上是「殿堂 · 当前」，对话里是回殿堂的路）；
 * 中：对话标题；右：殿堂上是钱包，对话里是「更多」；最右是账户与设置。
 * 殿堂上透明、不画底线，对话里加一层磨砂。
 */
const TopBar: React.FC<TopBarProps> = ({
  conversation,
  user,
  energy,
  onHome,
  onCopyAll,
  onScrollToLatest,
  onDelete,
  onConvertAccount,
  onLogout,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const atHome = !conversation;
  const isTarot = conversation?.session_type === 'tarot' || conversation?.session_type === 'daily';

  const items = [
    { label: '复制全部解读', icon: <Copy size={15} />, action: onCopyAll },
    { label: '回到最新', icon: <ArrowDownToLine size={15} />, action: onScrollToLatest },
    // 没接着聊过的日签不给删
    ...(conversation && canDelete(conversation)
      ? [{ label: '删除对话', icon: <Trash2 size={15} />, action: onDelete, danger: true }]
      : []),
  ];

  return (
    <header
      className={`relative z-30 flex-shrink-0 h-14 px-4 sm:px-6 flex items-center gap-3 ${
        atHome ? '' : 'border-b border-mystic-gold/[0.12] bg-dark-bg/45 backdrop-blur-xl'
      }`}
    >
      {/* logo = 回殿堂；窄屏上让给旁边的所在之处 */}
      <button onClick={onHome} className="group hidden sm:block flex-shrink-0 rounded-full" aria-label="回到殿堂" title="回到殿堂">
        <span className="block w-9 h-9 rounded-full overflow-hidden ring-1 ring-mystic-gold/45 ring-offset-2 ring-offset-dark-bg transition-shadow group-hover:shadow-[0_0_16px_rgba(201,169,110,0.35)]">
          <img src="/assets/icon.webp" alt="" className="w-full h-full object-cover" />
        </span>
      </button>

      {atHome ? (
        <div
          className="flex-shrink-0 flex items-center gap-2 h-9 px-3.5 rounded-full select-none"
          style={{ border: '1px solid var(--line-soft)', background: 'rgba(255,255,255,0.015)' }}
        >
          <motion.span
            className="block w-[6px] h-[6px] rounded-full"
            style={{ background: 'var(--gold)' }}
            animate={{ boxShadow: ['0 0 0px rgba(201,169,110,0.4)', '0 0 9px rgba(201,169,110,0.9)', '0 0 0px rgba(201,169,110,0.4)'] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="font-display text-sm tracking-[0.18em]" style={{ color: 'var(--ivory)' }}>殿堂</span>
          <span className="hidden sm:inline text-[11px] tracking-[0.14em]" style={{ color: 'var(--ivory-faint)' }}>· 当前</span>
        </div>
      ) : (
        <button
          onClick={onHome}
          className="flex-shrink-0 flex items-center gap-1 h-9 pl-2 pr-3.5 rounded-full transition-colors hover:bg-white/[0.04]"
          style={{ border: '1px solid var(--line-soft)', color: 'var(--ivory-dim)' }}
        >
          <ChevronLeft size={15} style={{ color: 'var(--gold)' }} />
          <span className="font-display text-sm tracking-[0.18em]">殿堂</span>
        </button>
      )}

      <div className="flex-1 min-w-0 flex justify-center">
        {conversation && (
          <div className="min-w-0 flex items-center gap-2.5">
            <span
              className="hidden sm:block w-7 h-7 rounded-full overflow-hidden ring-1 ring-offset-2 ring-offset-dark-bg flex-shrink-0"
              style={{ '--tw-ring-color': isTarot ? 'var(--gold)' : 'var(--moon)' } as React.CSSProperties}
            >
              <img src={isTarot ? '/assets/avatar-tarot.webp' : '/assets/avatar-astrology.webp'} alt="" aria-hidden className="w-full h-full object-cover" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display font-semibold text-[15px] tracking-wide truncate" style={{ color: 'var(--ivory)' }}>
                {conversation.title}
              </h2>
              <p className="eyebrow leading-none mt-0.5 truncate" style={{ letterSpacing: '0.24em', fontSize: '8px' }}>
                {conversation.session_type === 'daily'
                  ? 'DAILY ORACLE · 每日一签'
                  : isTarot
                    ? 'TAROT · 塔罗占卜'
                    : 'ASTROLOGY · 占星'}
              </p>
            </div>
          </div>
        )}
      </div>

      {atHome && <WalletChip />}

      {!atHome && (
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 rounded-lg transition-colors hover:bg-white/[0.05]"
            style={{ color: 'var(--ivory-dim)' }}
            aria-label="更多操作"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={19} />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.16 }}
                  className="absolute right-0 mt-2 w-44 z-50 rounded-xl overflow-hidden py-1.5"
                  style={{ background: 'rgba(11,11,22,0.96)', border: '1px solid var(--line)', boxShadow: '0 18px 44px rgba(0,0,0,0.55)' }}
                >
                  {items.map((it) => (
                    <button
                      key={it.label}
                      onClick={() => {
                        setMenuOpen(false);
                        it.action();
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.05]"
                      style={{ color: it.danger ? '#E5897E' : 'var(--ivory-dim)' }}
                    >
                      {it.icon}
                      {it.label}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      )}

      {user && <AccountMenu user={user} energy={energy} onConvert={onConvertAccount} onLogout={onLogout} />}
    </header>
  );
};

export default TopBar;
