import React, { useMemo, useState } from 'react';
import { Plus, Search, Settings, Trash2, PanelLeftClose, LayoutGrid } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import type { Conversation, SessionType } from '@/types';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  onNewConversation: () => void;       // 返回殿堂 / 开启新占卜
  onSelectConversation: (conversation: Conversation) => void;
  onDeleteConversation: (conversationId: string) => void;
  onOpenSettings: () => void;
  onClose?: () => void;                // 折叠/收起侧边栏
  isHome?: boolean;                    // 当前已在殿堂
}

const relTime = (dateStr: string) => {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
};

const GROUP_ORDER = ['今天', '本周', '更早'] as const;
const bucketOf = (dateStr: string) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const t = new Date(dateStr).getTime();
  if (t >= startOfToday.getTime()) return '今天';
  if (Date.now() - t < 7 * 86400000) return '本周';
  return '更早';
};

const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  currentConversationId,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onOpenSettings,
  onClose,
  isHome = false,
}) => {
  const [query, setQuery] = useState('');

  const accentFor = (s: SessionType) => (s === 'tarot' ? 'var(--gold)' : 'var(--moon)');
  const iconFor = (s: SessionType) => (s === 'tarot' ? '/assets/avatar_tarot.png' : '/assets/avatar.png');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = conversations
      .filter((c) => !q || c.title?.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    const map = new Map<string, Conversation[]>();
    for (const c of filtered) {
      const b = bucketOf(c.updated_at);
      (map.get(b) ?? map.set(b, []).get(b)!).push(c);
    }
    return GROUP_ORDER.map((g) => [g, map.get(g) ?? []] as const).filter(([, list]) => list.length > 0);
  }, [conversations, query]);

  return (
    <div className="w-72 h-full flex flex-col relative overflow-hidden bg-dark-bg/65 backdrop-blur-2xl border-r border-mystic-gold/12">
      {/* Header */}
      <div className="p-5 border-b border-mystic-gold/12 relative">
        <div className="flex items-center justify-between mb-4">
          {/* Logo = 返回殿堂 */}
          <button
            onClick={onNewConversation}
            className="group flex items-center gap-3 -ml-1 pr-2 py-1 rounded-lg transition-colors hover:bg-white/[0.03]"
            aria-label="返回殿堂"
          >
            <span className="w-9 h-9 rounded-full overflow-hidden ring-1 ring-mystic-gold/45 ring-offset-2 ring-offset-dark-bg transition-shadow group-hover:shadow-[0_0_16px_rgba(201,169,110,0.35)]">
              <img src="/assets/icon.png" alt="Logo" className="w-full h-full object-cover" />
            </span>
            <span className="text-left">
              <span className="block font-display font-semibold text-[15px] mystic-text tracking-wide leading-none">小x的秘密圣殿</span>
              <span className="block eyebrow mt-1" style={{ fontSize: '8px', letterSpacing: '0.3em' }}>SECRET SANCTUM</span>
            </span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="flex-shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/[0.05]"
              style={{ color: 'var(--ivory-faint)' }}
              aria-label="收起侧边栏"
            >
              <PanelLeftClose size={17} />
            </button>
          )}
        </div>

        {/* 新占卜 / 当前态 */}
        {isHome ? (
          <div
            className="w-full flex flex-col items-center justify-center gap-0.5 px-4 py-2.5 rounded-xl select-none"
            style={{ border: '1px solid var(--line-soft)', background: 'rgba(255,255,255,0.015)' }}
          >
            <span className="flex items-center gap-2 text-sm tracking-[0.12em]" style={{ color: 'var(--ivory-dim)' }}>
              <span style={{ color: 'var(--gold)' }}>◍</span> 殿堂 · 当前
            </span>
            <span className="text-[10px] tracking-wide" style={{ color: 'var(--ivory-faint)' }}>选择下方占卜开始</span>
          </div>
        ) : (
          <motion.button
            onClick={onNewConversation}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-mystic-gold/40 text-mystic-gold tracking-[0.12em] text-sm transition-colors duration-300 hover:bg-mystic-gold/10"
          >
            <Plus size={17} />
            <span>新的占卜</span>
          </motion.button>
        )}

        {/* 搜索 */}
        {conversations.length > 0 && (
          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ivory-faint)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索占卜…"
              className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] outline-none transition-colors"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line-soft)', color: 'var(--ivory)' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(201,169,110,0.4)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--line-soft)')}
            />
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-3 relative">
        {conversations.length === 0 ? (
          <div className="text-center mt-16" style={{ color: 'var(--ivory-faint)' }}>
            <p className="text-sm tracking-wide">暂无对话历史</p>
            <p className="text-xs mt-1.5">点击上方开启占卜之旅</p>
          </div>
        ) : groups.length === 0 ? (
          <p className="text-center text-sm mt-12" style={{ color: 'var(--ivory-faint)' }}>没有匹配的占卜</p>
        ) : (
          <div className="space-y-4">
            {groups.map(([label, list]) => (
              <div key={label}>
                <div className="px-2 mb-1.5 eyebrow" style={{ fontSize: '9px', letterSpacing: '0.26em' }}>{label}</div>
                <div className="space-y-1">
                  <AnimatePresence>
                    {list.map((conv) => {
                      const isActive = conv.conversation_id === currentConversationId;
                      const accent = accentFor(conv.session_type);
                      return (
                        <motion.div
                          key={conv.conversation_id}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -12 }}
                          className="group relative rounded-xl transition-all cursor-pointer overflow-hidden"
                          style={{
                            background: isActive ? 'rgba(201,169,110,0.06)' : 'transparent',
                            border: `1px solid ${isActive ? 'rgba(201,169,110,0.3)' : 'transparent'}`,
                          }}
                          onClick={() => onSelectConversation(conv)}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                        >
                          {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[2px] rounded-full" style={{ background: 'var(--gold)' }} />}
                          <div className="relative p-3 flex items-start gap-3">
                            <span
                              className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden ring-1 ring-offset-2 ring-offset-dark-bg"
                              style={{ '--tw-ring-color': accent } as React.CSSProperties}
                            >
                              <img src={iconFor(conv.session_type)} alt="" aria-hidden className="w-full h-full object-cover" />
                            </span>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-medium truncate" style={{ color: isActive ? 'var(--ivory)' : 'var(--ivory-dim)' }}>{conv.title}</h3>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[11px] tracking-wide" style={{ color: 'var(--ivory-faint)' }}>{relTime(conv.updated_at)}</span>
                                {conv.has_drawn_cards && <span className="text-[11px]" style={{ color: 'var(--gold)' }}>✦</span>}
                              </div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.conversation_id); }}
                              className="relative z-10 opacity-0 group-hover:opacity-70 focus-visible:opacity-100 flex-shrink-0 p-1.5 hover:bg-red-500/15 rounded-lg transition-all"
                              aria-label="删除对话"
                            >
                              <Trash2 size={14} className="text-red-300/80" />
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-mystic-gold/12 relative space-y-1">
        <Link
          to="/showcase"
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all group hover:bg-white/[0.03]"
        >
          <LayoutGrid size={17} style={{ color: 'var(--gold)' }} className="opacity-80" />
          <span className="tracking-wide text-sm" style={{ color: 'var(--ivory-dim)' }}>塔罗牌廊</span>
        </Link>
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all group hover:bg-white/[0.03]"
        >
          <Settings size={17} style={{ color: 'var(--ivory-dim)' }} className="group-hover:rotate-45 transition-transform duration-500" />
          <span className="tracking-wide text-sm" style={{ color: 'var(--ivory-dim)' }}>设置</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
