# 牌组商店（发现新牌组）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/showcase` 新增「✦ 发现新牌组」入口，打开一个全屏 overlay 商店，可优雅地预览并（模拟）购买不同塔罗牌组；纯前端，无后端改动。

**Architecture:** 商店是挂载在 `TarotShowcase` 内、由本地 state 切换的全屏 overlay（不新增路由）。`DeckStore` 持有内部视图状态机 `storefront → detail → checkout`，并集中所有 CSS。子组件只写 JSX + 按牌组 accent 的内联样式。已拥有牌组与星尘余额由 `useDeckWallet`（zustand + localStorage）持久化。占位牌组复用 `classic-rws` 缩略图叠加 per-accent duotone，零新增图片资产。

**Tech Stack:** React 18 + TypeScript、framer-motion、zustand、Vite。**不新增依赖。** 设计语言：Astral Atelier（`--void/--gold/--moon/--ivory/--line` CSS 变量，Cinzel / Noto Serif SC）。

**Verification model:** 项目无测试框架（刻意保持轻量）。每个任务的验收门 = `cd frontend && npm run build`（tsc + vite build 通过）与 `npm run lint`（eslint，`--max-warnings 0`）。最后做一次手动走查。**注意 lint 零容忍：不得有未使用的 import / 变量。**

**Design spec:** `docs/superpowers/specs/2026-06-08-deck-store-frontend-design.md`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `frontend/src/data/storeDecks.ts` | 商店目录 `StoreDeck[]` + 类型；只有 `classic-rws` 为真，其余为占位。 |
| `frontend/src/stores/useDeckWallet.ts` | zustand store：`ownedDeckIds` + `balance`，持久化到 localStorage。 |
| `frontend/src/components/deckstore/coverArt.ts` | 展示 helper：`hexA` / `duotoneOverlay` / `proceduralCover` / `badgeFor` / `ctaFor`。 |
| `frontend/src/components/deckstore/DeckTile.tsx` | 网格中的单个牌组卡。 |
| `frontend/src/components/deckstore/StorefrontView.tsx` | 精选 Hero + 牌组网格。 |
| `frontend/src/components/deckstore/DeckDetailView.tsx` | 牌组详情：预览条 + 文案 + 购买 CTA。 |
| `frontend/src/components/deckstore/CheckoutPanel.tsx` | 模拟结账面板（form → processing → success）。 |
| `frontend/src/components/deckstore/DeckStore.tsx` | overlay 外壳 + 视图状态机 + 退出逻辑 + **集中 CSS**。 |
| `frontend/src/pages/TarotShowcase.tsx`（改） | 入口 chip + 渲染 `<DeckStore />` + `.deck-discover` 样式。 |

依赖顺序：data/store/helpers（Task 1）→ Tile/Storefront（Task 2）→ Detail/Checkout（Task 3）→ DeckStore 外壳含 CSS（Task 4）→ 集成（Task 5）。

---

## Task 1: 数据、钱包 store、展示 helper

**Files:**
- Create: `frontend/src/data/storeDecks.ts`
- Create: `frontend/src/stores/useDeckWallet.ts`
- Create: `frontend/src/components/deckstore/coverArt.ts`

- [ ] **Step 1: 创建商店目录 `frontend/src/data/storeDecks.ts`**

```ts
// 商店目录。仅 `classic-rws` 为真实牌组；其余为占位，复用 classic-rws 缩略图
// 叠加各自 accent 的 duotone 滤镜，读作不同艺术风格，零新增图片资产。
// 将来上线真实牌组：把图片放入 public/tarot-images/decks/<id>/，把对应条目
// 的 state 改为 'available' 并设 liveDeckId 即可。

export type DeckState = 'available' | 'partial' | 'coming-soon';
// 注意：'owned' 不在此枚举内 —— 是否已拥有由 useDeckWallet 派生。

export interface StoreDeck {
  id: string;
  name: string;
  tagline: string;          // 一句诗意短语（陈列文案）
  artist: string;
  style: string;
  description: string;      // detail 视图的叙事文案
  price: number;            // 单位 ✦星尘（模拟货币）
  accent: string;           // hex；驱动该牌组的辉光 / duotone
  state: DeckState;
  completed?: number;       // 仅 partial：已绘制 N（满 78）
  previewCards: string[];   // 预览缩略图 url（.thumb.webp）
  liveDeckId?: string;      // 仅当 manifest 中存在真实牌组时设置
  featured?: boolean;       // Hero 精选位
}

const RWS = (id: string) => `/tarot-images/decks/classic-rws/major/${id}.thumb.webp`;
const PREVIEW_A = ['the-high-priestess', 'the-moon', 'the-star', 'the-sun', 'the-world'].map(RWS);
const PREVIEW_B = ['the-magician', 'the-empress', 'the-emperor', 'the-lovers', 'the-chariot'].map(RWS);
const PREVIEW_C = ['the-hermit', 'death', 'the-tower', 'temperance', 'the-devil'].map(RWS);

export const STORE_DECKS: StoreDeck[] = [
  {
    id: 'classic-rws',
    name: 'Rider–Waite–Smith',
    tagline: '一切塔罗的源头，百年传世的原型。',
    artist: 'Pamela Colman Smith',
    style: 'Classic · 经典原型',
    description:
      '由 Pamela Colman Smith 于 1909 年绘制，定义了现代塔罗的视觉语言。78 张完整牌面，象征体系清晰，是初学与精研皆宜的基石牌组。',
    price: 0,
    accent: '#C9A96E',
    state: 'available',
    previewCards: PREVIEW_A,
    liveDeckId: 'classic-rws',
    featured: true,
  },
  {
    id: 'lunar-mirage',
    name: 'Lunar Mirage',
    tagline: '月光浸染的幻象，冷蓝调的低语。',
    artist: 'Atelier Nocturne',
    style: 'Moonlit · 月光幻境',
    description:
      '以月光银蓝为主调的当代牌组，柔雾质感与星象线条交织，适合直觉式、情感向的解读。',
    price: 1280,
    accent: '#A8D8EA',
    state: 'available',
    previewCards: PREVIEW_B,
  },
  {
    id: 'gilded-ember',
    name: 'Gilded Ember',
    tagline: '余烬与鎏金，热烈而庄重。',
    artist: 'Studio Solis',
    style: 'Golden · 鎏金余烬',
    description:
      '暖金与琥珀色调，笔触如烛火摇曳。目前仍在绘制中，已完成部分大阿卡纳，抢先获取可在后续更新中持续解锁新牌面。',
    price: 980,
    accent: '#F4A261',
    state: 'partial',
    completed: 32,
    previewCards: PREVIEW_C,
  },
  {
    id: 'verdant-oracle',
    name: 'Verdant Oracle',
    tagline: '草木与苔藓的预言，尚未苏醒。',
    artist: '待定',
    style: 'Botanical · 草木神谕',
    description:
      '一套以植物与自然循环为母题的牌组，目前仍处于概念阶段。敬请期待它的苏醒。',
    price: 1180,
    accent: '#90BE6D',
    state: 'coming-soon',
    previewCards: [],
  },
];
```

- [ ] **Step 2: 创建钱包 store `frontend/src/stores/useDeckWallet.ts`**

```ts
import { create } from 'zustand';

const LS_KEY = 'tarot.deckWallet';
const SEED_OWNED = ['classic-rws']; // classic-rws 作为已拥有锚点
const SEED_BALANCE = 8888;          // 星尘初始余额，充足以保证默认结账成功

interface Persisted {
  ownedDeckIds: string[];
  balance: number;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      return {
        ownedDeckIds: Array.from(new Set([...SEED_OWNED, ...(p.ownedDeckIds ?? [])])),
        balance: typeof p.balance === 'number' ? p.balance : SEED_BALANCE,
      };
    }
  } catch {
    /* 忽略损坏的存储 */
  }
  return { ownedDeckIds: [...SEED_OWNED], balance: SEED_BALANCE };
}

function save(p: Persisted) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}

interface WalletState {
  ownedDeckIds: string[];
  balance: number;
  purchase: (id: string, price: number) => boolean; // false = 余额不足
  topUp: (amount: number) => void;
}

export const useDeckWallet = create<WalletState>((set, get) => {
  const initial = load();
  return {
    ownedDeckIds: initial.ownedDeckIds,
    balance: initial.balance,
    purchase: (id, price) => {
      const s = get();
      if (s.ownedDeckIds.includes(id)) return true; // 已拥有，幂等
      if (s.balance < price) return false;
      const next: Persisted = {
        ownedDeckIds: [...s.ownedDeckIds, id],
        balance: s.balance - price,
      };
      save(next);
      set(next);
      return true;
    },
    topUp: (amount) => {
      const s = get();
      const next: Persisted = { ownedDeckIds: s.ownedDeckIds, balance: s.balance + amount };
      save(next);
      set({ balance: next.balance });
    },
  };
});
```

- [ ] **Step 3: 创建展示 helper `frontend/src/components/deckstore/coverArt.ts`**

```ts
import React from 'react';
import { StoreDeck } from '../../data/storeDecks';

// hex(#rrggbb) → rgba 字符串
export function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 复用 classic-rws 图时叠加的 per-accent duotone 着色层；
// classic-rws（真实牌组，金色）不着色，保持原貌。
export function duotoneOverlay(deck: StoreDeck): React.CSSProperties {
  if (deck.id === 'classic-rws') return { background: 'transparent' };
  return { background: hexA(deck.accent, 0.55), mixBlendMode: 'color' };
}

// 无预览图的牌组（coming-soon）的程序化封面。
export function proceduralCover(deck: StoreDeck): React.CSSProperties {
  return {
    background: `radial-gradient(120% 80% at 50% 0%, ${hexA(deck.accent, 0.3)} 0%, rgba(10,10,22,0.92) 70%)`,
  };
}

export interface Badge {
  label: string;
  fg: string;
  bg: string;
  border: string;
}

// 状态徽章：已拥有优先，其次按 state。
export function badgeFor(deck: StoreDeck, owned: boolean): Badge {
  if (owned) return { label: '✓ 已拥有', fg: '#0e0e1a', bg: '#C9A96E', border: '#C9A96E' };
  switch (deck.state) {
    case 'partial':
      return {
        label: `设计中 · ${deck.completed ?? 0}/78`,
        fg: hexA(deck.accent, 0.95),
        bg: hexA(deck.accent, 0.12),
        border: hexA(deck.accent, 0.5),
      };
    case 'coming-soon':
      return {
        label: '即将上架',
        fg: 'rgba(237,230,214,0.7)',
        bg: 'rgba(255,255,255,0.05)',
        border: 'rgba(255,255,255,0.15)',
      };
    default:
      return {
        label: '可获取',
        fg: hexA(deck.accent, 0.95),
        bg: hexA(deck.accent, 0.12),
        border: hexA(deck.accent, 0.5),
      };
  }
}

export type CtaKind = 'enter' | 'buy' | 'notify';

// 主 CTA 的文案 + 行为类型。owned 但无 liveDeckId（占位牌组买后）→ notify。
export function ctaFor(deck: StoreDeck, owned: boolean): { label: string; kind: CtaKind } {
  if (owned) return deck.liveDeckId ? { label: '进入牌廊 ›', kind: 'enter' } : { label: '已拥有', kind: 'notify' };
  if (deck.state === 'coming-soon') return { label: '通知我', kind: 'notify' };
  if (deck.state === 'partial') return { label: `抢先获取 · ${deck.price} ✦`, kind: 'buy' };
  return { label: `获取 · ${deck.price} ✦`, kind: 'buy' };
}
```

- [ ] **Step 4: 验收门 — typecheck 通过**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TS 报错（新文件目前未被引用，但类型须正确）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/data/storeDecks.ts frontend/src/stores/useDeckWallet.ts frontend/src/components/deckstore/coverArt.ts
git commit -m "feat(deckstore): catalog data, wallet store, presentation helpers"
```

---

## Task 2: DeckTile + StorefrontView

**Files:**
- Create: `frontend/src/components/deckstore/DeckTile.tsx`
- Create: `frontend/src/components/deckstore/StorefrontView.tsx`

CSS 类（`ds-*` / `deckstore-*`）集中在 Task 4 的 `DeckStore` 中定义；本任务只写 JSX，tsc 不依赖 CSS 即可通过。

- [ ] **Step 1: 创建 `frontend/src/components/deckstore/DeckTile.tsx`**

```tsx
import React from 'react';
import { motion } from 'framer-motion';
import { StoreDeck } from '../../data/storeDecks';
import { duotoneOverlay, proceduralCover, badgeFor } from './coverArt';

interface DeckTileProps {
  deck: StoreDeck;
  owned: boolean;
  index: number;
  onClick: () => void;
}

export default function DeckTile({ deck, owned, index, onClick }: DeckTileProps) {
  const badge = badgeFor(deck, owned);
  const hasArt = deck.previewCards.length > 0;

  return (
    <motion.button
      className="ds-tile"
      style={{ '--accent': deck.accent } as React.CSSProperties}
      onClick={onClick}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(index * 0.05, 0.3) }}
      whileHover={{ y: -4 }}
    >
      <div className="ds-tile-cover" style={!hasArt ? proceduralCover(deck) : undefined}>
        {hasArt ? (
          <>
            <img
              className="ds-tile-img"
              src={deck.previewCards[0]}
              alt={deck.name}
              loading="lazy"
              onError={(e) => { e.currentTarget.style.opacity = '0'; }}
            />
            <div className="ds-tile-tint" style={duotoneOverlay(deck)} />
          </>
        ) : (
          <span className="ds-tile-lock">✦</span>
        )}
        <span
          className="ds-badge ds-tile-badge"
          style={{ color: badge.fg, background: badge.bg, borderColor: badge.border }}
        >
          {badge.label}
        </span>
      </div>
      <div className="ds-tile-info">
        <span className="ds-tile-name">{deck.name}</span>
        <span className="ds-tile-artist">{deck.artist} · {deck.style}</span>
        <div className="ds-tile-foot">
          {!owned && deck.state !== 'coming-soon' ? (
            <span className="ds-tile-price">{deck.price} ✦</span>
          ) : (
            <span className="ds-tile-price muted">{owned ? '已拥有' : '敬请期待'}</span>
          )}
          <span className="ds-tile-go">›</span>
        </div>
      </div>
    </motion.button>
  );
}
```

- [ ] **Step 2: 创建 `frontend/src/components/deckstore/StorefrontView.tsx`**

```tsx
import React from 'react';
import { motion } from 'framer-motion';
import { StoreDeck } from '../../data/storeDecks';
import { useDeckWallet } from '../../stores/useDeckWallet';
import { duotoneOverlay, badgeFor } from './coverArt';
import DeckTile from './DeckTile';

interface StorefrontViewProps {
  decks: StoreDeck[];
  onOpenDeck: (d: StoreDeck) => void;
  onEnterDeck: (liveDeckId: string) => void;
}

export default function StorefrontView({ decks, onOpenDeck, onEnterDeck }: StorefrontViewProps) {
  // 订阅 ownedDeckIds，购买后整页重渲染。
  const ownedIds = useDeckWallet((s) => s.ownedDeckIds);
  const hero = decks.find((d) => d.featured) ?? decks[0];
  const rest = decks.filter((d) => d.id !== hero.id);
  const heroOwned = ownedIds.includes(hero.id);
  const heroBadge = badgeFor(hero, heroOwned);

  return (
    <div className="ds-store">
      {/* 精选 Hero */}
      <motion.div
        className="ds-hero"
        style={{ '--accent': hero.accent } as React.CSSProperties}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="ds-hero-cover">
          <div className="ds-hero-fan">
            {hero.previewCards.slice(0, 5).map((src, i, arr) => {
              const mid = (arr.length - 1) / 2;
              const off = i - mid;
              return (
                <span
                  key={src}
                  className="ds-hero-card"
                  style={{
                    marginLeft: i ? -30 : 0,
                    transform: `rotate(${off * 8}deg) translateY(${Math.abs(off) * 8}px)`,
                    zIndex: 10 - Math.abs(off),
                  }}
                >
                  <img src={src} alt="" onError={(e) => { e.currentTarget.style.opacity = '0'; }} />
                </span>
              );
            })}
          </div>
          <div className="ds-hero-tint" style={duotoneOverlay(hero)} />
        </div>
        <div className="ds-hero-info">
          <span className="ds-eyebrow">FEATURED · 精选</span>
          <h2 className="ds-hero-name">{hero.name}</h2>
          <p className="ds-hero-tagline">{hero.tagline}</p>
          <p className="ds-meta">{hero.artist} · {hero.style}</p>
          <span
            className="ds-badge"
            style={{ color: heroBadge.fg, background: heroBadge.bg, borderColor: heroBadge.border }}
          >
            {heroBadge.label}
          </span>
          <div className="ds-hero-actions">
            {heroOwned && hero.liveDeckId ? (
              <button className="ds-cta" onClick={() => onEnterDeck(hero.liveDeckId!)}>进入牌廊 ›</button>
            ) : (
              <button className="ds-cta" onClick={() => onOpenDeck(hero)}>查看牌组 ›</button>
            )}
          </div>
        </div>
      </motion.div>

      {/* 牌组网格 */}
      <div className="ds-grid">
        {rest.map((d, i) => (
          <DeckTile key={d.id} deck={d} owned={ownedIds.includes(d.id)} index={i} onClick={() => onOpenDeck(d)} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验收门**

Run: `cd frontend && npm run build`
Expected: 构建成功（组件尚未挂载，仅验证类型）。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/deckstore/DeckTile.tsx frontend/src/components/deckstore/StorefrontView.tsx
git commit -m "feat(deckstore): storefront hero + deck grid tiles"
```

---

## Task 3: DeckDetailView + CheckoutPanel

**Files:**
- Create: `frontend/src/components/deckstore/DeckDetailView.tsx`
- Create: `frontend/src/components/deckstore/CheckoutPanel.tsx`

- [ ] **Step 1: 创建 `frontend/src/components/deckstore/DeckDetailView.tsx`**

```tsx
import React from 'react';
import { StoreDeck } from '../../data/storeDecks';
import { useDeckWallet } from '../../stores/useDeckWallet';
import { duotoneOverlay, proceduralCover, badgeFor, ctaFor } from './coverArt';
import { toast } from '../../stores/useToastStore';

interface DeckDetailViewProps {
  deck: StoreDeck;
  onBuy: () => void;
  onEnterDeck: (liveDeckId: string) => void;
}

export default function DeckDetailView({ deck, onBuy, onEnterDeck }: DeckDetailViewProps) {
  const ownedIds = useDeckWallet((s) => s.ownedDeckIds);
  const owned = ownedIds.includes(deck.id);
  const badge = badgeFor(deck, owned);
  const cta = ctaFor(deck, owned);
  const hasArt = deck.previewCards.length > 0;
  // partial 牌组：预览条在已完成卡之后补几个「设计中」占位。
  const placeholders = deck.state === 'partial' ? 3 : 0;

  const handleCta = () => {
    if (cta.kind === 'enter') { onEnterDeck(deck.liveDeckId!); return; }
    if (cta.kind === 'buy') { onBuy(); return; }
    toast.info(owned ? '该牌组即将上线，敬请期待 ✦' : '已记录，上线时第一时间通知你 ✦');
  };

  return (
    <div className="ds-detail" style={{ '--accent': deck.accent } as React.CSSProperties}>
      <div className="ds-detail-left">
        <div className="ds-detail-cover" style={!hasArt ? proceduralCover(deck) : undefined}>
          {hasArt ? (
            <>
              <img src={deck.previewCards[0]} alt={deck.name} onError={(e) => { e.currentTarget.style.opacity = '0'; }} />
              <div className="ds-tile-tint" style={duotoneOverlay(deck)} />
            </>
          ) : (
            <span className="ds-detail-lock">✦</span>
          )}
        </div>
        {hasArt && (
          <div className="ds-detail-strip">
            {deck.previewCards.map((src) => (
              <span key={src} className="ds-detail-thumb">
                <img src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.opacity = '0'; }} />
                <div className="ds-tile-tint" style={duotoneOverlay(deck)} />
              </span>
            ))}
            {Array.from({ length: placeholders }).map((_, i) => (
              <span key={`ph-${i}`} className="ds-detail-thumb ds-detail-thumb-todo">设计中</span>
            ))}
          </div>
        )}
      </div>

      <div className="ds-detail-info">
        <span className="ds-eyebrow">{deck.style}</span>
        <h2 className="ds-detail-name">{deck.name}</h2>
        <span className="ds-badge" style={{ color: badge.fg, background: badge.bg, borderColor: badge.border }}>
          {badge.label}
        </span>
        <p className="ds-detail-desc">{deck.description}</p>
        <p className="ds-meta">绘者 {deck.artist}</p>
        {deck.state === 'partial' && (
          <div className="ds-progress">
            <div className="ds-progress-bar">
              <div className="ds-progress-fill" style={{ width: `${Math.round(((deck.completed ?? 0) / 78) * 100)}%` }} />
            </div>
            <span className="ds-progress-label">{deck.completed}/78 已绘制</span>
          </div>
        )}
        <button className="ds-cta ds-cta-lg" onClick={handleCta}>{cta.label}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 `frontend/src/components/deckstore/CheckoutPanel.tsx`**

```tsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { StoreDeck } from '../../data/storeDecks';
import { useDeckWallet } from '../../stores/useDeckWallet';
import { toast } from '../../stores/useToastStore';

interface CheckoutPanelProps {
  deck: StoreDeck;
  onCancel: () => void;
  onEnterDeck: (liveDeckId: string) => void;
}

type Phase = 'form' | 'processing' | 'success';
type Method = 'stardust' | 'coin';

export default function CheckoutPanel({ deck, onCancel, onEnterDeck }: CheckoutPanelProps) {
  const balance = useDeckWallet((s) => s.balance);
  const purchase = useDeckWallet((s) => s.purchase);
  const topUp = useDeckWallet((s) => s.topUp);
  const [phase, setPhase] = useState<Phase>('form');
  const [method, setMethod] = useState<Method>('stardust');
  const insufficient = balance < deck.price;

  const confirm = () => {
    if (insufficient) { toast.error('星尘余额不足'); return; }
    setPhase('processing');
    window.setTimeout(() => {
      const ok = purchase(deck.id, deck.price);
      if (!ok) { setPhase('form'); toast.error('结算失败，请重试'); return; }
      setPhase('success');
    }, 1200);
  };

  return (
    <motion.div
      className="ds-checkout-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={phase === 'processing' ? undefined : onCancel}
    >
      <motion.div
        className="ds-checkout"
        style={{ '--accent': deck.accent } as React.CSSProperties}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'success' ? (
          <div className="ds-success">
            <motion.div
              className="ds-success-mark"
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', damping: 12, stiffness: 200 }}
            >
              ✦
            </motion.div>
            <h3 className="ds-success-title">已收入囊中</h3>
            <p className="ds-success-sub">{deck.name} 已加入你的牌组</p>
            {deck.liveDeckId ? (
              <button className="ds-confirm" onClick={() => onEnterDeck(deck.liveDeckId!)}>进入牌廊 ›</button>
            ) : (
              <button className="ds-confirm" onClick={onCancel}>完成</button>
            )}
          </div>
        ) : (
          <>
            <div className="ds-checkout-head">结算</div>
            <div className="ds-checkout-line">
              <img
                className="ds-checkout-thumb"
                src={deck.previewCards[0]}
                alt=""
                onError={(e) => { e.currentTarget.style.opacity = '0'; }}
              />
              <div className="ds-checkout-meta">
                <span className="ds-checkout-name">{deck.name}</span>
                <span className="ds-checkout-style">{deck.style}</span>
              </div>
              <span className="ds-checkout-price">{deck.price} ✦</span>
            </div>

            <div className="ds-pay-label">支付方式</div>
            <div className="ds-pay-methods">
              <button className={`ds-pay-method ${method === 'stardust' ? 'active' : ''}`} onClick={() => setMethod('stardust')}>
                ✦ 星尘余额
              </button>
              <button className={`ds-pay-method ${method === 'coin' ? 'active' : ''}`} onClick={() => setMethod('coin')}>
                🪙 金币
              </button>
            </div>

            <div className="ds-balance">
              <span>当前余额</span>
              <span className={insufficient ? 'low' : ''}>{balance} ✦</span>
            </div>

            {insufficient && (
              <button className="ds-topup" onClick={() => { topUp(5000); toast.success('已充值 5000 ✦'); }}>
                余额不足 · 充值 5000 ✦
              </button>
            )}

            <button className="ds-confirm" disabled={phase === 'processing'} onClick={confirm}>
              {phase === 'processing' ? (
                <><span className="ds-spinner" /><span style={{ marginLeft: 8 }}>结算中…</span></>
              ) : (
                '确认支付'
              )}
            </button>
            <button className="ds-checkout-cancel" onClick={onCancel} disabled={phase === 'processing'}>取消</button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 3: 验收门**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/deckstore/DeckDetailView.tsx frontend/src/components/deckstore/CheckoutPanel.tsx
git commit -m "feat(deckstore): deck detail view + simulated checkout panel"
```

---

## Task 4: DeckStore 外壳（状态机 + 退出 + 集中 CSS）

**Files:**
- Create: `frontend/src/components/deckstore/DeckStore.tsx`

- [ ] **Step 1: 创建 `frontend/src/components/deckstore/DeckStore.tsx`（含全部 `ds-*` / `deckstore-*` CSS）**

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { STORE_DECKS, StoreDeck } from '../../data/storeDecks';
import StorefrontView from './StorefrontView';
import DeckDetailView from './DeckDetailView';
import CheckoutPanel from './CheckoutPanel';

interface DeckStoreProps {
  open: boolean;
  onClose: () => void;
  onEnterDeck: (liveDeckId: string) => void;
}

export default function DeckStore({ open, onClose, onEnterDeck }: DeckStoreProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const selected: StoreDeck | null = selectedId ? STORE_DECKS.find((d) => d.id === selectedId) ?? null : null;

  // 商店关闭时重置内部导航
  useEffect(() => {
    if (!open) { setSelectedId(null); setCheckoutOpen(false); }
  }, [open]);

  // 逐级返回：checkout → detail → storefront → 关闭
  const back = useCallback(() => {
    if (checkoutOpen) { setCheckoutOpen(false); return; }
    if (selectedId) { setSelectedId(null); return; }
    onClose();
  }, [checkoutOpen, selectedId, onClose]);

  // 进入牌廊：关闭整个商店并通知父级切换牌组
  const enterDeck = useCallback((liveDeckId: string) => {
    setCheckoutOpen(false);
    setSelectedId(null);
    onEnterDeck(liveDeckId);
  }, [onEnterDeck]);

  // 上下文相关的 Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, back]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="deckstore-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => { if (!selectedId) onClose(); }}
        >
          <motion.div
            className="deckstore-shell"
            initial={{ opacity: 0, scale: 0.985, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.985, y: 12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="deckstore-topbar">
              <button className="deckstore-back" onClick={back}>‹ {selectedId ? '返回商店' : '返回牌廊'}</button>
              <span className="deckstore-title">发现新牌组</span>
              <button className="deckstore-close" onClick={onClose} aria-label="关闭商店">✕</button>
            </div>

            <div className="deckstore-body">
              <AnimatePresence mode="wait">
                {!selected ? (
                  <motion.div key="storefront" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <StorefrontView decks={STORE_DECKS} onOpenDeck={(d) => setSelectedId(d.id)} onEnterDeck={enterDeck} />
                  </motion.div>
                ) : (
                  <motion.div key={`detail-${selected.id}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
                    <DeckDetailView deck={selected} onBuy={() => setCheckoutOpen(true)} onEnterDeck={enterDeck} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence>
              {checkoutOpen && selected && (
                <CheckoutPanel deck={selected} onCancel={() => setCheckoutOpen(false)} onEnterDeck={enterDeck} />
              )}
            </AnimatePresence>
          </motion.div>

          <style>{`
            .deckstore-backdrop {
              position: fixed; inset: 0; z-index: 1200;
              background: rgba(4,4,10,.82); backdrop-filter: blur(10px);
              display: flex; align-items: stretch; justify-content: center;
              padding: 0;
            }
            .deckstore-shell {
              position: relative; width: 100%; max-width: 1180px;
              margin: 0 auto; background: var(--void, #06060f);
              display: flex; flex-direction: column;
              border-left: 1px solid var(--line, rgba(201,169,110,.16));
              border-right: 1px solid var(--line, rgba(201,169,110,.16));
              overflow: hidden;
            }
            .deckstore-topbar {
              position: sticky; top: 0; z-index: 5;
              display: flex; align-items: center; justify-content: space-between;
              padding: 16px 22px; gap: 12px;
              border-bottom: 1px solid var(--line, rgba(201,169,110,.16));
              background: rgba(8,8,16,.7); backdrop-filter: blur(8px);
            }
            .deckstore-back {
              display: inline-flex; align-items: center; gap: 6px;
              padding: 7px 15px; border-radius: 999px; cursor: pointer;
              font-size: 13px; letter-spacing: .08em;
              color: rgba(201,169,110,.85);
              background: rgba(10,10,20,.5);
              border: 1px solid rgba(201,169,110,.25);
              transition: all .2s; font-family: inherit;
            }
            .deckstore-back:hover { color: #F0D090; border-color: rgba(201,169,110,.5); background: rgba(201,169,110,.1); }
            .deckstore-title {
              font-family: 'Cinzel', serif; font-size: 15px; letter-spacing: 3px;
              color: var(--gold, #C9A96E); text-transform: uppercase;
            }
            .deckstore-close {
              width: 34px; height: 34px; border-radius: 50%; cursor: pointer;
              border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06);
              color: rgba(255,255,255,.75); font-size: 14px;
              display: flex; align-items: center; justify-content: center;
              transition: all .2s; font-family: inherit;
            }
            .deckstore-close:hover { background: rgba(255,255,255,.14); color: #fff; }
            .deckstore-body {
              flex: 1; overflow-y: auto; padding: 32px 28px 64px;
              scrollbar-width: thin; scrollbar-color: rgba(201,169,110,.4) transparent;
            }
            .deckstore-body::-webkit-scrollbar { width: 10px; }
            .deckstore-body::-webkit-scrollbar-track { background: transparent; }
            .deckstore-body::-webkit-scrollbar-thumb {
              border-radius: 999px; border: 3px solid transparent;
              background-clip: padding-box; background-color: rgba(201,169,110,.3);
            }

            /* shared bits */
            .ds-eyebrow { font-size: 10px; letter-spacing: .3em; color: var(--gold, #C9A96E); text-transform: uppercase; }
            .ds-meta { font-size: 12px; color: rgba(237,230,214,.5); letter-spacing: .04em; }
            .ds-badge {
              display: inline-block; width: fit-content;
              font-size: 11px; padding: 3px 11px; border-radius: 999px;
              border: 1px solid; letter-spacing: .04em; white-space: nowrap;
            }
            .ds-cta {
              align-self: flex-start;
              padding: 10px 22px; border-radius: 999px; cursor: pointer;
              font-family: 'Cinzel', serif; font-size: 13px; letter-spacing: .08em;
              color: #0e0e1a; border: none;
              background: linear-gradient(120deg, var(--accent) 0%, #fff6e0 130%);
              box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 30%, transparent);
              transition: transform .2s, box-shadow .2s;
            }
            .ds-cta:hover { transform: translateY(-2px); box-shadow: 0 12px 30px color-mix(in srgb, var(--accent) 45%, transparent); }
            .ds-cta-lg { padding: 13px 30px; font-size: 14px; margin-top: 6px; }

            /* storefront */
            .ds-store { display: flex; flex-direction: column; gap: 40px; }
            .ds-hero {
              display: grid; grid-template-columns: minmax(0, 340px) 1fr; gap: 36px;
              align-items: center; padding: 28px;
              border-radius: 18px;
              border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
              background: linear-gradient(120deg, color-mix(in srgb, var(--accent) 8%, #0c0c18) 0%, rgba(10,10,22,.6) 100%);
              box-shadow: 0 24px 60px rgba(0,0,0,.45);
            }
            .ds-hero-cover { position: relative; display: flex; justify-content: center; padding: 10px 0; }
            .ds-hero-fan { display: flex; align-items: flex-end; }
            .ds-hero-card {
              display: block; width: 96px; height: 158px; border-radius: 8px; overflow: hidden;
              transform-origin: bottom center;
              border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
              box-shadow: 0 10px 26px rgba(0,0,0,.6);
            }
            .ds-hero-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .ds-hero-tint { position: absolute; inset: 0; pointer-events: none; border-radius: 12px; }
            .ds-hero-info { display: flex; flex-direction: column; gap: 12px; }
            .ds-hero-name { font-family: 'Cinzel', serif; font-size: clamp(24px, 3vw, 34px); color: var(--ivory, #ede6d6); letter-spacing: 1px; }
            .ds-hero-tagline { font-size: 15px; color: rgba(237,230,214,.78); line-height: 1.6; font-style: italic; }
            .ds-hero-actions { margin-top: 8px; }

            .ds-grid {
              display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 22px;
            }
            .ds-tile {
              display: flex; flex-direction: column; gap: 0; cursor: pointer;
              text-align: left; padding: 0; border: none; background: none;
              border-radius: 14px; overflow: hidden;
            }
            .ds-tile-cover {
              position: relative; aspect-ratio: 3/4; overflow: hidden;
              border-radius: 14px; background: #10101a;
              border: 1px solid var(--line, rgba(201,169,110,.16));
              transition: border-color .25s, box-shadow .25s;
            }
            .ds-tile:hover .ds-tile-cover {
              border-color: color-mix(in srgb, var(--accent) 60%, transparent);
              box-shadow: 0 16px 40px rgba(0,0,0,.5), 0 0 22px color-mix(in srgb, var(--accent) 22%, transparent);
            }
            .ds-tile-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s; }
            .ds-tile:hover .ds-tile-img { transform: scale(1.05); }
            .ds-tile-tint { position: absolute; inset: 0; pointer-events: none; }
            .ds-tile-lock { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 34px; color: color-mix(in srgb, var(--accent) 70%, white); opacity: .7; }
            .ds-tile-badge { position: absolute; top: 10px; left: 10px; backdrop-filter: blur(4px); }
            .ds-tile-info { display: flex; flex-direction: column; gap: 3px; padding: 12px 4px 4px; }
            .ds-tile-name { font-family: 'Cinzel', serif; font-size: 15px; color: var(--ivory, #ede6d6); letter-spacing: .04em; }
            .ds-tile-artist { font-size: 11px; color: rgba(237,230,214,.45); }
            .ds-tile-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
            .ds-tile-price { font-size: 13px; color: var(--gold, #C9A96E); letter-spacing: .04em; }
            .ds-tile-price.muted { color: rgba(237,230,214,.4); }
            .ds-tile-go { font-size: 18px; color: color-mix(in srgb, var(--accent) 80%, white); transition: transform .2s; }
            .ds-tile:hover .ds-tile-go { transform: translateX(3px); }

            /* detail */
            .ds-detail { display: grid; grid-template-columns: minmax(0, 380px) 1fr; gap: 40px; align-items: start; }
            .ds-detail-left { display: flex; flex-direction: column; gap: 16px; }
            .ds-detail-cover {
              position: relative; aspect-ratio: 3/4; border-radius: 16px; overflow: hidden; background: #10101a;
              border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
              box-shadow: 0 22px 50px rgba(0,0,0,.5);
            }
            .ds-detail-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .ds-detail-lock { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 48px; color: color-mix(in srgb, var(--accent) 70%, white); opacity: .7; }
            .ds-detail-strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; scrollbar-color: rgba(201,169,110,.4) transparent; }
            .ds-detail-thumb { position: relative; flex: 0 0 auto; width: 64px; height: 104px; border-radius: 7px; overflow: hidden; border: 1px solid var(--line, rgba(201,169,110,.16)); }
            .ds-detail-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .ds-detail-thumb-todo {
              display: flex; align-items: center; justify-content: center;
              font-size: 10px; letter-spacing: .1em; color: rgba(237,230,214,.4);
              background: repeating-linear-gradient(45deg, rgba(255,255,255,.03) 0 1px, transparent 1px 9px);
            }
            .ds-detail-info { display: flex; flex-direction: column; gap: 14px; }
            .ds-detail-name { font-family: 'Cinzel', serif; font-size: clamp(26px, 3.4vw, 40px); color: var(--ivory, #ede6d6); letter-spacing: 1px; }
            .ds-detail-desc { font-size: 15px; line-height: 1.8; color: rgba(237,230,214,.74); }
            .ds-progress { display: flex; flex-direction: column; gap: 6px; }
            .ds-progress-bar { height: 5px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
            .ds-progress-fill { height: 100%; border-radius: 999px; background: var(--accent); }
            .ds-progress-label { font-size: 11px; color: rgba(237,230,214,.5); letter-spacing: .05em; }

            /* checkout */
            .ds-checkout-scrim {
              position: absolute; inset: 0; z-index: 20;
              background: rgba(2,2,8,.7); backdrop-filter: blur(6px);
              display: flex; align-items: flex-end; justify-content: center;
            }
            .ds-checkout {
              width: 100%; max-width: 440px; margin: 0 16px;
              background: #0e0e1a; border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
              border-radius: 18px 18px 0 0; padding: 24px 24px 28px;
              box-shadow: 0 -20px 60px rgba(0,0,0,.6);
              display: flex; flex-direction: column; gap: 14px;
            }
            @media (min-width: 720px) { .ds-checkout-scrim { align-items: center; } .ds-checkout { border-radius: 18px; } }
            .ds-checkout-head { font-family: 'Cinzel', serif; font-size: 16px; letter-spacing: 3px; color: var(--gold, #C9A96E); text-transform: uppercase; }
            .ds-checkout-line { display: flex; align-items: center; gap: 14px; padding: 12px 0; border-top: 1px solid rgba(255,255,255,.08); border-bottom: 1px solid rgba(255,255,255,.08); }
            .ds-checkout-thumb { width: 44px; height: 70px; object-fit: cover; border-radius: 6px; }
            .ds-checkout-meta { flex: 1; display: flex; flex-direction: column; gap: 3px; }
            .ds-checkout-name { font-family: 'Cinzel', serif; font-size: 15px; color: var(--ivory, #ede6d6); }
            .ds-checkout-style { font-size: 11px; color: rgba(237,230,214,.45); }
            .ds-checkout-price { font-size: 17px; color: var(--gold, #C9A96E); }
            .ds-pay-label { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: rgba(237,230,214,.4); }
            .ds-pay-methods { display: flex; gap: 10px; }
            .ds-pay-method {
              flex: 1; padding: 11px; border-radius: 10px; cursor: pointer;
              font-size: 13px; color: rgba(237,230,214,.7);
              border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03);
              transition: all .2s; font-family: inherit;
            }
            .ds-pay-method.active { color: var(--gold, #C9A96E); border-color: var(--gold, #C9A96E); background: rgba(201,169,110,.1); }
            .ds-balance { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: rgba(237,230,214,.6); }
            .ds-balance .low { color: #ff8c64; }
            .ds-topup {
              padding: 9px; border-radius: 10px; cursor: pointer; font-size: 12px;
              color: #ffb98c; border: 1px solid rgba(255,140,80,.35); background: rgba(255,120,80,.08);
              font-family: inherit; transition: all .2s;
            }
            .ds-topup:hover { background: rgba(255,120,80,.16); }
            .ds-confirm {
              margin-top: 4px; padding: 14px; border-radius: 12px; cursor: pointer;
              font-family: 'Cinzel', serif; font-size: 14px; letter-spacing: .08em;
              color: #0e0e1a; border: none;
              display: flex; align-items: center; justify-content: center;
              background: linear-gradient(120deg, var(--accent, #C9A96E) 0%, #fff6e0 140%);
              box-shadow: 0 8px 24px color-mix(in srgb, var(--accent, #C9A96E) 30%, transparent);
              transition: transform .2s; min-height: 50px;
            }
            .ds-confirm:hover:not(:disabled) { transform: translateY(-2px); }
            .ds-confirm:disabled { cursor: default; opacity: .9; }
            .ds-checkout-cancel { padding: 6px; cursor: pointer; font-size: 12px; color: rgba(237,230,214,.45); background: none; border: none; font-family: inherit; }
            .ds-checkout-cancel:hover:not(:disabled) { color: rgba(237,230,214,.7); }
            .ds-spinner {
              width: 16px; height: 16px; border-radius: 50%;
              border: 2px solid rgba(14,14,26,.3); border-top-color: #0e0e1a;
              display: inline-block; animation: ds-spin .7s linear infinite;
            }
            @keyframes ds-spin { to { transform: rotate(360deg); } }
            .ds-success { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 16px 0 8px; }
            .ds-success-mark {
              width: 64px; height: 64px; border-radius: 50%;
              display: flex; align-items: center; justify-content: center; font-size: 30px; color: #0e0e1a;
              background: radial-gradient(circle, #fff6e0 0%, var(--accent, #C9A96E) 80%);
              box-shadow: 0 0 36px color-mix(in srgb, var(--accent, #C9A96E) 60%, transparent);
            }
            .ds-success-title { font-family: 'Cinzel', serif; font-size: 22px; color: var(--ivory, #ede6d6); letter-spacing: 1px; }
            .ds-success-sub { font-size: 13px; color: rgba(237,230,214,.6); margin-bottom: 8px; }

            /* responsive */
            @media (max-width: 760px) {
              .ds-hero { grid-template-columns: 1fr; gap: 22px; }
              .ds-detail { grid-template-columns: 1fr; gap: 24px; }
              .ds-detail-left { max-width: 320px; }
              .deckstore-body { padding: 24px 18px 56px; }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: 验收门**

Run: `cd frontend && npm run build`
Expected: 构建成功（组件仍未挂载，验证类型与 import 完整）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/deckstore/DeckStore.tsx
git commit -m "feat(deckstore): overlay shell, view state machine, centralized styles"
```

---

## Task 5: 集成进 TarotShowcase（入口 + 渲染 + 样式）

**Files:**
- Modify: `frontend/src/pages/TarotShowcase.tsx`

- [ ] **Step 1: 增加 import（在文件顶部 import 区，`Link` 那行之后）**

找到（约第 1-3 行）：
```tsx
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
```
改为：
```tsx
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import DeckStore from '../components/deckstore/DeckStore';
```

- [ ] **Step 2: 增加 `storeOpen` state（在 `const [shown, setShown] = ...` 之后）**

找到：
```tsx
  const [selected, setSelected] = useState<TarotCard | null>(null);
  const [shown, setShown] = useState<Variant | null>(null); // image inside lightbox
```
改为：
```tsx
  const [selected, setSelected] = useState<TarotCard | null>(null);
  const [shown, setShown] = useState<Variant | null>(null); // image inside lightbox
  const [storeOpen, setStoreOpen] = useState(false);        // 发现新牌组 overlay
```

- [ ] **Step 3: 在 deck-switcher 中加入口 chip（refresh 图标按钮之前）**

找到：
```tsx
              <button
                className="deck-refresh-icon"
                onClick={loadManifest}
                disabled={loading}
                title="Rescan the decks folder"
                aria-label="Refresh decks"
              >
                <span className={loading ? 'spin' : ''}>⟳</span>
              </button>
```
在它**之前**插入：
```tsx
              <button
                className="deck-discover"
                onClick={() => setStoreOpen(true)}
                title="发现并获取更多牌组"
              >
                <span className="deck-discover-spark">✦</span>
                发现新牌组
              </button>
```

- [ ] **Step 4: 渲染 `<DeckStore />`（在 Lightbox 的 `</AnimatePresence>` 之后、`<style>{` 之前）**

找到 Lightbox 段尾（约第 685 行）：
```tsx
        })()}
      </AnimatePresence>

      <style>{`
        .showcase-root {
```
改为：
```tsx
        })()}
      </AnimatePresence>

      <DeckStore
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        onEnterDeck={(liveDeckId) => { setActiveDeck(liveDeckId); setStoreOpen(false); }}
      />

      <style>{`
        .showcase-root {
```

- [ ] **Step 5: 加 `.deck-discover` 样式（在 showcase 的 `<style>` 块内，`.deck-sync-note { ... }` 规则之后）**

找到：
```css
        .deck-sync-note {
          font-size: 11px; color: rgba(255,180,140,.5);
          letter-spacing: .5px; font-style: italic;
        }
```
在其后插入：
```css
        .deck-discover {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 7px 16px; border-radius: 8px; cursor: pointer;
          font-family: 'Cinzel', serif; font-size: 13px; letter-spacing: .5px;
          color: #C9A96E;
          border: 1px solid rgba(201,169,110,.45);
          background: linear-gradient(120deg, rgba(201,169,110,.16), rgba(201,169,110,.04));
          box-shadow: 0 0 18px rgba(201,169,110,.12);
          transition: all .2s; margin-left: 4px;
        }
        .deck-discover:hover {
          color: #F0D090; border-color: #C9A96E;
          box-shadow: 0 0 26px rgba(201,169,110,.28); transform: translateY(-1px);
        }
        .deck-discover-spark { font-size: 12px; }
```

- [ ] **Step 6: 验收门 — 构建 + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: 两者都通过；lint 无 warning（`--max-warnings 0`）。常见坑：确认没有未使用的 import / 变量。

- [ ] **Step 7: 手动走查（`npm run dev`，打开 `/showcase`）**

确认以下全部成立：
1. deck-switcher 行出现金色「✦ 发现新牌组」chip；点击淡入全屏商店 overlay。
2. Storefront 显示 Hero（Rider–Waite–Smith，徽章「✓ 已拥有」，CTA「进入牌廊」）+ 网格（Lunar Mirage 可获取 / Gilded Ember 设计中·32/78 / Verdant Oracle 即将上架，各自 accent 着色不同）。
3. 点击 Lunar Mirage → detail 视图，预览条、文案、CTA「获取 · 1280 ✦」。
4. 点「获取」→ checkout 面板 spring 滑入；点「确认支付」→「结算中…」spinner 约 1.2s →「已收入囊中」对勾迸发。
5. 返回 storefront，Lunar Mirage 徽章变为「✓ 已拥有」。
6. 逐级 Esc：checkout→detail→storefront→关闭；右上 ✕ 与左上「‹ 返回牌廊」均可退出；storefront 层点击 backdrop 关闭。
7. Hero 点「进入牌廊」/ classic-rws 已拥有牌组的「进入牌廊」→ 商店关闭并切到该牌组。
8. Gilded Ember 详情显示进度条 32/78 + 预览条含「设计中」占位；Verdant Oracle 为程序化封面 + 「通知我」toast。
9. 刷新页面 → 重新打开商店，Lunar Mirage 仍为「已拥有」、余额已扣（localStorage 持久化生效）。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/TarotShowcase.tsx
git commit -m "feat(showcase): add 发现新牌组 entry, mount DeckStore overlay"
```

---

## Self-Review 记录

- **Spec coverage:** §2 入口/overlay/状态机 → Task 4+5；§3 退出（✕/back/Esc 逐级/backdrop）→ Task 4 `back()`+topbar、Task 5 渲染；§4 数据模型/目录/货币 → Task 1；§5 持久化 → Task 1 `useDeckWallet`；§6 状态与 CTA → `badgeFor`/`ctaFor`（Task 1）+ 各视图；§7 storefront → Task 2；§8 detail → Task 3；§9 checkout → Task 3；§10 封面处理 → `duotoneOverlay`/`proceduralCover`（Task 1）；§11 美学动效 → Task 4 CSS + 各 framer-motion；§12 集成 → Task 5；§13 验收 → 各任务 build 门 + Task 5 手动走查；§14 YAGNI（充值/通知我为模拟）→ Task 3 `topUp`/toast。全部覆盖。
- **Placeholder scan:** 无 TBD/TODO；所有代码步骤含完整代码。（`artist: '待定'` 是牌组的 in-world 文案，非计划占位。）
- **Type consistency:** `StoreDeck` 字段在各组件一致；`useDeckWallet` 暴露 `ownedDeckIds`/`balance`/`purchase`/`topUp`，消费端用名一致；helper `hexA`/`duotoneOverlay`/`proceduralCover`/`badgeFor`/`ctaFor` 签名与调用一致；CSS 类名（`ds-tile-tint` 被 Tile/Detail 复用等）均在 Task 4 的集中 `<style>` 中定义。
```
