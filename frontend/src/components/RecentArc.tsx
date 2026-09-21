import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Trash2 } from 'lucide-react';
import type { Conversation, SessionType } from '@/types';

/**
 * 最近的占卜：殿堂与对话页左侧页边上的一条右括号形弧线轨迹（代替原来的侧栏）。
 * 弧线本身不动，占卜列表在它上面滚：每一场按离「选中线」的远近沿弧往左收、变淡变小，
 * 经过选中线的那一场亮起来。标题和搜索钉在弧线起点，不参与滚动；
 * 今天 / 本周 / 更早是压在弧线上的小标签，跟着列表走。
 */

const SAGITTA = 40;   // 弧的拱高：两端相对中段往左收多少 px
const ROW_H = 52;
const TAG_H = 30;
const NOTE_H = 40;    // 列表末尾「共 N 场」/ 空状态那一行
const RAIL = 10;      // 每一行里，轨迹点离行左端的距离
const TEXT_W = 132;
const HEAD_H = 92;    // 起点那一块（标题 + 搜索）的高度
const SEARCH_Y = 64;  // 搜索节点圆心 = 弧线起点
const FOCUS_Y = 64;   // 选中线离列表可视区顶部的距离（紧挨着搜索下面）

/** 轨迹整体宽度：弧往左收的量 + 两端标签往左探出的余量 + 点 + 文字 */
export const ARC_WIDTH = SAGITTA + 22 + RAIL * 2 + 12 + TEXT_W;
export const ARC_HEAD_H = HEAD_H;

// ── 时间：一律按日历日算，「今天」和分组标签的「今天」是同一个意思 ─────────────

const DAY = 86400000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** 离今天差几个日历日（0 = 今天）。round 吸收夏令时那一天的 23/25 小时 */
const daysAgo = (dateStr: string, now: number) =>
  Math.round((startOfDay(now) - startOfDay(new Date(dateStr).getTime())) / DAY);

export const relTime = (dateStr: string, now = Date.now()) => {
  const d = daysAgo(dateStr, now);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  if (d < 7) return `${d}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
};

export const bucketOf = (dateStr: string, now = Date.now()) => {
  const d = daysAgo(dateStr, now);
  if (d <= 0) return '今天';
  if (d < 7) return '本周';
  return '更早';
};

// ── 轨迹上的一行 ─────────────────────────────────────────────────

export type ArcRow =
  | { kind: 'tag'; key: string; label: string }
  | { kind: 'item'; key: string; conv: Conversation }
  | { kind: 'note'; key: string; text: string };

/** 按更新时间倒序排好，搜索只筛标题；每换一个分组插一个标签，末尾一行交代总数或为什么是空的 */
export function buildArcRows(conversations: Conversation[], query: string, now = Date.now()): ArcRow[] {
  const q = query.trim().toLowerCase();
  const list = conversations
    .filter((c) => !q || c.title?.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const rows: ArcRow[] = [];
  let last = '';
  for (const c of list) {
    const b = bucketOf(c.updated_at, now);
    if (b !== last) {
      rows.push({ kind: 'tag', key: `tag-${b}`, label: b });
      last = b;
    }
    rows.push({ kind: 'item', key: c.conversation_id, conv: c });
  }
  const text = list.length ? `共 ${list.length} 场` : conversations.length ? '没有匹配的占卜' : '还没有占卜记录';
  rows.push({ kind: 'note', key: 'note', text });
  return rows;
}

const isGold = (s: SessionType) => s === 'tarot' || s === 'daily';
const TYPE_LABEL: Record<string, string> = { tarot: '塔罗', daily: '日签', astrology: '占星', chat: '聊愈' };

/** 行里放轨迹点的那一格：点的圆心正好落在弧线上 */
const Rail: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="relative flex-shrink-0 self-stretch" style={{ width: RAIL * 2 }}>
    <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center" style={{ left: RAIL }}>
      {children}
    </span>
  </span>
);

interface RecentArcProps {
  conversations: Conversation[];
  currentId?: string;
  /** 列表可视区高度（不含起点那块标题 + 搜索） */
  height: number;
  onOpen: (conversation: Conversation) => void;
  onDelete: (conversationId: string) => void;
}

const RecentArc: React.FC<RecentArcProps> = ({ conversations, currentId, height, onOpen, onDelete }) => {
  const gid = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searchFocus, setSearchFocus] = useState(false);
  const [active, setActive] = useState('');
  const activeRef = useRef('');
  const rows = useMemo(() => buildArcRows(conversations, query), [conversations, query]);

  // 弧线几何：从搜索节点（起点）到底端，对称的一段圆弧，中段最往右鼓
  const total = HEAD_H + height;
  const yMid = (SEARCH_Y + total) / 2;
  const half = (total - SEARCH_Y) / 2;
  const padL = SAGITTA + 22;
  const apexX = padL + RAIL;
  const R = (half * half + SAGITTA * SAGITTA) / (2 * SAGITTA);
  /** 整块坐标里高度 y 处，弧线相对中段往左收了多少（负数） */
  const xAt = (y: number) => -(R - Math.sqrt(Math.max(R * R - (y - yMid) ** 2, 0)));
  const startX = apexX + xAt(SEARCH_Y);
  const below = height - FOCUS_Y;

  const layout = () => {
    const el = ref.current;
    if (!el) return;
    let best = '';
    let bestD = Infinity;
    el.querySelectorAll<HTMLElement>('[data-row]').forEach((row) => {
      const inView = row.offsetTop + row.offsetHeight / 2 - el.scrollTop; // 行中心在可视区里的高度
      if (inView < -ROW_H * 2 || inView > height + ROW_H * 2) return;      // 远在可视区外的不用管
      const d = inView - FOCUS_Y;
      const t = Math.min(Math.abs(d) / (d < 0 ? FOCUS_Y : below), 1);
      row.style.transform = `translateX(${xAt(HEAD_H + inView).toFixed(2)}px) scale(${(1 - 0.08 * t).toFixed(3)})`;
      row.style.opacity = Math.max(0.12, 1 - 0.8 * Math.pow(t, 1.6)).toFixed(3);
      if (row.dataset.item && Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        best = row.dataset.key!;
      }
    });
    activeRef.current = best;
    setActive(best);
  };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const raf = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => layoutRef.current());
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const scrollToKey = (key: string | undefined) => {
    const el = ref.current;
    const target = key ? el?.querySelector<HTMLElement>(`[data-key="${key}"]`) : null;
    if (el && target) el.scrollTop = target.offsetTop + target.offsetHeight / 2 - FOCUS_Y;
    return Boolean(target);
  };

  // 列表变了：搜索词变了就回到第一场；否则（有场次更新、删除）让原来亮着的那场留在选中线上
  const lastQuery = useRef(query);
  useLayoutEffect(() => {
    if (lastQuery.current !== query) {
      lastQuery.current = query;
      if (ref.current) ref.current.scrollTop = 0;
    } else {
      scrollToKey(activeRef.current);
    }
    layoutRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // 打开 / 切到某场对话：把它转到选中线上（殿堂上没有当前场，停在最近一场）
  useLayoutEffect(() => {
    if (!scrollToKey(currentId) && ref.current) ref.current.scrollTop = 0;
    layoutRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, height]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      ref.current?.scrollBy({ top: e.key === 'ArrowDown' ? ROW_H : -ROW_H, behavior: 'smooth' });
    } else if (e.key === 'Enter') {
      const c = conversations.find((x) => x.conversation_id === activeRef.current);
      if (c) onOpen(c);
    }
  };

  const fade = 'linear-gradient(to bottom, transparent 0, #000 7%, #000 86%, transparent 100%)';
  const rowStyle = (h: number): React.CSSProperties => ({ height: h, transformOrigin: `${RAIL}px 50%`, willChange: 'transform, opacity' });
  const searchOn = searchFocus || !!query;

  return (
    <div className="relative flex-shrink-0" style={{ width: ARC_WIDTH, height: total }}>
      {/* 弧线：从搜索节点起，不随滚动动 */}
      <svg className="absolute inset-0 pointer-events-none" width={ARC_WIDTH} height={total} aria-hidden>
        <defs>
          <linearGradient id={`arc-${gid}`} x1="0" y1={SEARCH_Y} x2="0" y2={total} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#C9A96E" stopOpacity="0.45" />
            <stop offset="0.75" stopColor="#C9A96E" stopOpacity="0.3" />
            <stop offset="1" stopColor="#C9A96E" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`lamp-${gid}`}>
            <stop offset="0" stopColor="#C9A96E" stopOpacity="0.3" />
            <stop offset="1" stopColor="#C9A96E" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d={`M ${startX} ${SEARCH_Y} A ${R} ${R} 0 0 1 ${startX} ${total}`} stroke={`url(#arc-${gid})`} strokeWidth="1" fill="none" />
        {/* 选中线上一盏微光 */}
        <circle cx={apexX + xAt(HEAD_H + FOCUS_Y)} cy={HEAD_H + FOCUS_Y} r="30" fill={`url(#lamp-${gid})`} />
      </svg>

      {/* 起点：标题 + 搜索，钉住不动 */}
      <div className="absolute inset-x-0 top-0" style={{ height: HEAD_H }}>
        <div className="absolute" style={{ left: startX + 21, top: 2 }}>
          <span className="eyebrow block" style={{ fontSize: '9px', letterSpacing: '0.3em', color: 'var(--gold)' }}>Recent</span>
          <span className="block font-display text-[13px] mt-0.5 tracking-[0.16em]" style={{ color: 'var(--ivory-dim)' }}>最近的占卜</span>
        </div>
        <span
          aria-hidden
          className="absolute grid place-items-center w-[22px] h-[22px] rounded-full transition-[border-color,box-shadow] duration-300"
          style={{
            left: startX - 11,
            top: SEARCH_Y - 11,
            background: 'var(--void)',
            border: `1px solid ${searchOn ? 'rgba(201,169,110,0.75)' : 'rgba(201,169,110,0.4)'}`,
            boxShadow: searchOn ? '0 0 12px rgba(201,169,110,0.35)' : 'none',
          }}
        >
          <Search size={11} style={{ color: 'var(--gold)' }} />
        </span>
        {conversations.length > 0 && (
          <span className="absolute flex items-center" style={{ left: startX + 21, top: SEARCH_Y - 14, width: TEXT_W }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocus(true)}
              onBlur={() => setSearchFocus(false)}
              placeholder="搜索占卜…"
              aria-label="搜索占卜"
              className="recent-arc-input w-full bg-transparent outline-none text-[13px] py-1 pr-5 transition-colors"
              style={{ color: 'var(--ivory)', borderBottom: `1px solid ${searchOn ? 'rgba(201,169,110,0.45)' : 'var(--line-soft)'}` }}
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-0 p-0.5" aria-label="清空搜索" style={{ color: 'var(--ivory-faint)' }}>
                <X size={12} />
              </button>
            )}
          </span>
        )}
      </div>

      {/* 列表：沿弧滚，一次停一场 */}
      <div
        ref={ref}
        onScroll={onScroll}
        onKeyDown={onKey}
        tabIndex={0}
        role="listbox"
        aria-label="最近的占卜"
        aria-activedescendant={active ? `arc-${gid}-${active}` : undefined}
        className="recent-arc-scroll absolute inset-x-0 bottom-0 overflow-y-auto outline-none"
        style={{
          top: HEAD_H,
          scrollSnapType: 'y mandatory',
          scrollPaddingTop: FOCUS_Y - ROW_H / 2,
          overscrollBehavior: 'contain',
          paddingLeft: padL,
          WebkitMaskImage: fade,
          maskImage: fade,
        }}
      >
        {/* 顶上留白：列表第一行是分组标签，它下面那一场正好落在选中线上 */}
        <div style={{ height: FOCUS_Y - ROW_H / 2 - TAG_H }} />
        {rows.map((row) => {
          if (row.kind === 'tag')
            return (
              <div key={row.key} data-row data-key={row.key} className="relative" style={rowStyle(TAG_H)}>
                <span
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-[1px] rounded-full text-[9px] tracking-[0.2em] whitespace-nowrap"
                  style={{ left: RAIL, background: 'var(--void)', color: 'var(--gold)', border: '1px solid rgba(201,169,110,0.3)' }}
                >
                  {row.label}
                </span>
              </div>
            );
          if (row.kind === 'note')
            return (
              <div key={row.key} data-row data-key={row.key} className="flex items-center" style={rowStyle(NOTE_H)}>
                <Rail>
                  <span className="block w-[3px] h-[3px] rounded-full" style={{ background: 'var(--gold-deep)' }} />
                </Rail>
                <span className="pl-3 text-[11px] tracking-[0.16em]" style={{ color: 'var(--ivory-faint)' }}>{row.text}</span>
              </div>
            );
          const c = row.conv;
          const on = active === row.key;
          const gold = isGold(c.session_type);
          return (
            <div
              key={row.key}
              id={`arc-${gid}-${row.key}`}
              data-row
              data-item="1"
              data-key={row.key}
              role="option"
              aria-selected={on}
              onClick={() => onOpen(c)}
              className="group relative flex items-center cursor-pointer"
              style={{ ...rowStyle(ROW_H), scrollSnapAlign: 'start' }}
            >
              {/* 转到选中线上：从点往右晕开一点光 */}
              <span
                aria-hidden
                className="absolute inset-y-1 -left-2 right-0 rounded-full transition-opacity duration-300 pointer-events-none"
                style={{ opacity: on ? 1 : 0, background: 'radial-gradient(ellipse 75% 95% at 12px 50%, rgba(201,169,110,0.15), transparent 78%)' }}
              />
              <Rail>
                <span
                  className="block rounded-full transition-all duration-300"
                  style={{
                    width: on ? 9 : 5,
                    height: on ? 9 : 5,
                    background: gold ? 'var(--gold)' : 'var(--moon)',
                    boxShadow: on
                      ? `0 0 0 3px var(--void), 0 0 14px ${gold ? 'rgba(201,169,110,0.8)' : 'rgba(168,216,234,0.8)'}`
                      : '0 0 0 3px var(--void)',
                  }}
                />
              </Rail>
              <span className="relative min-w-0 pl-3" style={{ width: TEXT_W + 12 }}>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="truncate transition-[color,font-size] duration-300 group-hover:!text-[color:var(--ivory)]"
                    style={{ fontSize: on ? 14 : 13, color: on ? 'var(--ivory)' : 'var(--ivory-dim)' }}
                  >
                    {c.title}
                  </span>
                  {c.conversation_id === currentId && (
                    <span className="flex-shrink-0 text-[9px] tracking-[0.12em] px-1 rounded" style={{ color: 'var(--gold)', border: '1px solid rgba(201,169,110,0.35)' }}>
                      当前
                    </span>
                  )}
                </span>
                <span className="block text-[11px] mt-0.5 tracking-wide" style={{ color: 'var(--ivory-faint)' }}>
                  {TYPE_LABEL[c.session_type] ?? ''} · {relTime(c.updated_at)}
                  {c.has_drawn_cards && <span style={{ color: 'var(--gold)' }}> ✦</span>}
                </span>
                {/* 删除：悬停时压在时间那一行的右端，不另占宽度 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.conversation_id);
                  }}
                  className="absolute right-0 bottom-[3px] p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100 transition-opacity"
                  aria-label="删除对话"
                >
                  <Trash2 size={12} className="text-red-300/80" />
                </button>
              </span>
            </div>
          );
        })}
        {/* 底下留白：最后一场也能滚到选中线上 */}
        <div style={{ height: height - FOCUS_Y - ROW_H / 2 }} />
      </div>

      <style>{`
        .recent-arc-scroll { scrollbar-width: none; }
        .recent-arc-scroll::-webkit-scrollbar { display: none; }
        .recent-arc-input::placeholder { color: var(--ivory-faint); }
      `}</style>
    </div>
  );
};

export default RecentArc;

/** 放在某个容器里时的列表高度：容器实际高度减去 reserve，夹在 [160, 460]，跟着容器变（输入坞长高、窗口缩放） */
export function useFitArcHeight(container: HTMLElement | null, reserve: number) {
  const [h, setH] = useState(460);
  useLayoutEffect(() => {
    if (!container) return;
    const ro = new ResizeObserver(([entry]) => setH(Math.max(160, Math.min(460, entry.contentRect.height - reserve))));
    ro.observe(container);
    return () => ro.disconnect();
  }, [container, reserve]);
  return h;
}

/** 浮层里的列表高度：窗口高度减去 reserve，夹在 [220, 460]，随窗口变 */
export function useArcHeight(reserve: number) {
  const calc = () => Math.max(220, Math.min(460, window.innerHeight - reserve));
  const [h, setH] = useState(calc);
  useEffect(() => {
    const onResize = () => setH(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reserve]);
  return h;
}

/**
 * 页边放不下轨迹时（窄屏 / 手机）：左缘只留一道小弧，点开整条轨迹浮在页面上，用法一样。
 * 显隐交给调用方的 className（按各页能放下轨迹的宽度）。
 */
export const RecentArcEdge: React.FC<Omit<RecentArcProps, 'height'> & { className?: string }> = ({ className = '', onOpen, ...rest }) => {
  const [open, setOpen] = useState(false);
  const height = useArcHeight(HEAD_H + 96);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`group fixed left-0 top-1/2 -translate-y-1/2 z-30 w-6 h-40 ${className}`}
        aria-label="最近的占卜"
      >
        <svg width="24" height="160" aria-hidden>
          <path d="M 4 8 Q 20 80 4 152" stroke="var(--gold)" strokeOpacity="0.45" fill="none" className="transition-[stroke-opacity] group-hover:[stroke-opacity:0.9]" />
          <circle cx="12" cy="80" r="2.5" fill="var(--gold)" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: -32, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -32, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed inset-y-0 left-0 z-50 flex items-center pl-3 pr-10"
              style={{ background: 'linear-gradient(to right, rgba(6,6,15,0.97) 70%, transparent)' }}
            >
              <RecentArc
                {...rest}
                height={height}
                onOpen={(c) => {
                  setOpen(false);
                  onOpen(c);
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
