# 占卜界面 UX 重构 — Design Spec

Date: 2026-06-08
Scope: Frontend-only UX/interaction/layout redesign of the tarot-astro divination app.
Builds on the completed visual restyle ("Astral Atelier": near-black `#06060f` + antique gold `#C9A96E` + moonlight blue `#A8D8EA` + ivory `#EDE6D6`, serif type).

## Hard constraints

- **No backend changes.** Every interaction keeps the exact same calls/sequencing in `services/api.ts` (`tarotApi`, `astrologyApi`, `conversationApi`, `userApi`): empty-message opening, streaming `onChunk`, `onDrawRequest`, `onProfileRequest`, `onFetchChart` callbacks, `drawCards`, `fetchChart`, `exit`. Nothing under `backend/` is touched.
- **Responsive for desktop AND mobile** (both are primary).
- Keep all existing artwork (avatars, tarot card images, icon, card backs).
- Lightweight: one new dependency only (`react-markdown` + `remark-gfm`).

## Chosen shell

Refined classic shell + centered reading column.
`Sidebar` (collapsible) + main column (`TopBar` → centered reading column → `Composer`).

- Desktop ≥1024px: sidebar persistent (288px), collapsible to a 64px icon rail.
- <1024px: sidebar becomes an overlay drawer toggled by a `☰` in the TopBar; dimmed backdrop; main is single column.
- Reading column: centered `max-width: 720px`; top fade under the TopBar.
- Input dock sticky bottom with `env(safe-area-inset-bottom)`.

## Focus area 1 — Reading experience

1. **Markdown rendering of AI messages.** Replace plain `whitespace-pre-wrap` with `react-markdown` + `remark-gfm` (auto-escaped, no raw HTML). Component style map → theme:
   - `h2/h3` → Cinzel small-caps gold headings; `strong` → `--gold-bright`; `em` → ivory italic (Cormorant for Latin);
   - `ul/ol` → gold markers; `blockquote` → gold left-rule; `hr` → `.gold-rule`; `a` → gold underline; `code` → subtle panel.
   - User messages stay plain text (no markdown).
2. **Multi-line Composer.** `<input>` → auto-growing `<textarea>`: Enter = send, Shift+Enter = newline, grows to ~6 lines then scrolls; gold send button; disabled when empty. Same `onSend(content)`.
3. **Quick replies slimmed.** No longer a permanent stacked block. A single horizontally-scrollable "✦ 灵感" row above the composer; auto-hides once the user types; toggleable. Same `onReplyClick`.
4. **Per-message actions.** On hover (desktop) / persistent subtle (mobile) under AI bubbles: **复制** (clipboard, frontend) + timestamp. Streaming message shows a faint gold caret while live.

## Focus area 2 — Onboarding / entry

(Intention-framing step is intentionally OUT — entry stays instant.)

1. **Logo = home.** The sidebar logo lockup (icon + 小x的秘密圣殿) becomes clickable → returns to the hub (welcome). Hover gold underglow, `aria-label="返回殿堂"`.
2. **Honest "新占卜" button.** Behavior = return to hub to choose a practice.
   - In a conversation: prominent gold-outline CTA「✦ 新的占卜」→ graceful cross-fade (reading column recedes, hub fades in via `AnimatePresence`).
   - On the hub already: button renders a quiet "current location" resting state (dimmed, non-interactive, caption「选择下方占卜开始」) — no confusing no-op.
3. **Welcome hub additions.**
   - **Tarot Gallery preview banner (primary, high-CTR):** full-width panel under the three practice cards — a fanned/overlapping row of real card thumbnails + 「塔罗牌廊 · Gallery · 78 张牌、多套牌组 ›」, whole banner clickable, hover parallax lift. Routes to `/showcase`. Card art pulled from existing static images in `config/tarotCards.ts` (e.g. moon/star/sun/high-priestess/wheel).
   - **近期占卜 strip:** last ~3 conversations as elegant cards (from existing `conversations`; open via `conversationApi.get`).
4. **Astrology profile polish (triggers unchanged).** The inline "补充资料" prompt becomes one clear card with a single CTA; `AstrologyProfileModal` form tidied. Same submit sequence (`updateProfile` → `fetchChart` → `sendMessage`).

## Focus area 3 — Navigation & system polish

1. **Sidebar IA.** Title search (client-side filter); history grouped 今天 / 本周 / 更早 by `updated_at`; item = type-ring avatar · title · relative time · `✦` if `has_drawn_cards`; collapsible to rail on desktop. Footer: **🎴 牌廊** (→ `/showcase`) beside **⚙ 设置**.
2. **Replace native dialogs.**
   - **Toast** (`useToastStore` via existing `zustand` + `<Toaster/>`) for failures (send/draw/interpret) — replaces error `alert()`.
   - **ConfirmDialog** (themed) for delete-conversation & logout — replaces `window.confirm()`.
3. **Showcase page back link.** Add a low-key 「‹ 返回殿堂」 top-left of `TarotShowcase` (→ `/`).

## New dependency

`react-markdown` + `remark-gfm`. Mainstream, safe-by-default, ~tens of KB. (Cloud/local update steps delivered to user after implementation.)

## Component / file plan (frontend only)

New:
- `components/TopBar.tsx` — header: ☰ (drawer) · avatar+title+type · ⋯ overflow (复制全部解读 / 回到最新 / 删除对话).
- `components/Composer.tsx` — auto-grow textarea + send.
- `components/Markdown.tsx` — themed react-markdown renderer.
- `components/GalleryBanner.tsx` — welcome card-fan gallery entry.
- `components/RecentReadings.tsx` — welcome recent-conversations strip.
- `components/ui/Toaster.tsx` + `stores/useToastStore.ts`.
- `components/ui/ConfirmDialog.tsx` + `stores/useConfirmStore.ts` (promise-based `confirm()`).

Modified:
- `App.tsx` — shell wiring, responsive sidebar state, hub/conversation cross-fade, swap alert/confirm → toast/dialog, logo-home + reframed button, render Composer/TopBar/QuickReplies.
- `components/Sidebar.tsx` — search, grouping, collapse, logo-home, footer 牌廊, button states.
- `components/ChatMessage.tsx` — use Markdown for AI text, per-message copy + caret.
- `components/QuickReplies.tsx` — single scroll row, auto-hide.
- `components/AstrologyProfileModal.tsx` — form/layout tidy.
- `pages/TarotShowcase.tsx` — back-to-home link.
- `index.css` — markdown/typography helpers, rail/drawer, toast/dialog styles.

## Out of scope (this round)

- Divination ritual deep-dive (true spread geometry / reading recap view) — not selected.
- Conversation rename (no backend API).
- Any persistence beyond what existing APIs provide (favorites, etc.).
- Backend / API contract changes of any kind.

## Success criteria

- Long AI readings render as structured, scannable rich text.
- Fully usable and good-looking at 375px (mobile) and ≥1280px (desktop); sidebar drawer works on mobile.
- No native `alert`/`confirm` remain in the divination flow.
- Tarot Gallery entry is prominent on the hub and reachable from the sidebar; showcase can return home.
- `npm run build` clean; no backend calls changed (verified by diff of `services/api.ts` usage).
