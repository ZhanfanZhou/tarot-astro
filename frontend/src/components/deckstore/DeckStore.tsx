import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { STORE_DECKS, StoreDeck } from '../../data/storeDecks';
import StorefrontView from './StorefrontView';
import DeckDetailView from './DeckDetailView';
import CheckoutPanel from './CheckoutPanel';
import WalletChip from '../wallet/WalletChip';

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
      if (e.key === 'Escape') {
        // 卡牌放大层在场时，让它先处理 Esc，商店不抢
        if (document.querySelector('[data-ds-zoom]')) return;
        e.stopPropagation(); back();
      }
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
              <div className="deckstore-topbar-right">
                <WalletChip />
                <button className="deckstore-close" onClick={onClose} aria-label="关闭商店">✕</button>
              </div>
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
            .deckstore-topbar-right { display: flex; align-items: center; gap: 12px; }
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
            .ds-detail-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 6px; }
            .ds-apply {
              padding: 12px 22px; border-radius: 999px; cursor: pointer;
              font-family: 'Cinzel', serif; font-size: 13px; letter-spacing: .06em;
              color: var(--ivory, #ede6d6); background: transparent;
              border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
              transition: all .2s;
            }
            .ds-apply:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); transform: translateY(-1px); }
            .ds-active-tag {
              display: inline-flex; align-items: center; gap: 4px;
              font-size: 12px; letter-spacing: .04em; color: color-mix(in srgb, var(--accent) 85%, white);
              padding: 8px 14px; border-radius: 999px;
              border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
              background: color-mix(in srgb, var(--accent) 10%, transparent);
            }

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
            .ds-detail { display: flex; flex-direction: column; gap: 36px; }
            .ds-detail-head { display: grid; grid-template-columns: minmax(0, 340px) 1fr; gap: 36px; align-items: start; }
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

            /* full card grid */
            .ds-cards { display: flex; flex-direction: column; gap: 16px; }
            .ds-cards-head { display: flex; align-items: baseline; justify-content: space-between; border-top: 1px solid var(--line, rgba(201,169,110,.16)); padding-top: 20px; }
            .ds-cards-title { font-family: 'Cinzel', serif; font-size: 16px; letter-spacing: 2px; color: var(--ivory, #ede6d6); }
            .ds-cards-count { font-size: 12px; color: rgba(237,230,214,.5); letter-spacing: .04em; }
            .ds-cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 14px; }
            @media (min-width: 768px) { .ds-cards-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 16px; } }
            .ds-card-cell {
              display: flex; flex-direction: column; gap: 6px; padding: 0;
              background: none; border: none; cursor: pointer; text-align: center;
            }
            .ds-card-cell.locked { cursor: default; }
            .ds-card-thumb {
              position: relative; aspect-ratio: 2/3; border-radius: 8px; overflow: hidden; background: #10101a;
              border: 1px solid var(--line, rgba(201,169,110,.16));
              transition: border-color .2s, box-shadow .2s, transform .2s;
            }
            .ds-card-cell:not(.locked):hover .ds-card-thumb {
              border-color: color-mix(in srgb, var(--accent) 60%, transparent);
              box-shadow: 0 10px 26px rgba(0,0,0,.5), 0 0 16px color-mix(in srgb, var(--accent) 20%, transparent);
              transform: translateY(-3px);
            }
            .ds-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .ds-card-cell.locked .ds-card-thumb img { filter: grayscale(1) brightness(.5); }
            .ds-card-todo {
              position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
              font-size: 11px; letter-spacing: .1em; color: rgba(237,230,214,.65);
              background: rgba(8,8,16,.5);
            }
            .ds-card-name { font-size: 11px; color: rgba(237,230,214,.6); line-height: 1.25; }
            .ds-card-cell:not(.locked):hover .ds-card-name { color: rgba(237,230,214,.95); }

            /* card zoom lightbox */
            .ds-zoom-backdrop {
              position: fixed; inset: 0; z-index: 1300;
              background: rgba(2,2,8,.9); backdrop-filter: blur(10px);
              display: flex; align-items: center; justify-content: center; padding: 28px;
            }
            .ds-zoom-stage { position: relative; display: flex; flex-direction: column; align-items: center; gap: 14px; max-width: min(92vw, 520px); }
            .ds-zoom-img-wrap {
              position: relative; border-radius: 12px; overflow: hidden;
              border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
              box-shadow: 0 30px 70px rgba(0,0,0,.7);
            }
            .ds-zoom-img { display: block; width: auto; height: auto; max-width: 100%; max-height: min(78vh, 720px); }
            .ds-zoom-tint { position: absolute; inset: 0; pointer-events: none; }
            .ds-zoom-info { display: flex; align-items: center; gap: 12px; }
            .ds-zoom-name { font-family: 'Cinzel', serif; font-size: 16px; color: var(--ivory, #ede6d6); letter-spacing: 1px; }
            .ds-zoom-counter { font-size: 11px; color: rgba(237,230,214,.4); padding-left: 12px; border-left: 1px solid rgba(255,255,255,.12); }
            .ds-zoom-arrow {
              position: fixed; top: 50%; transform: translateY(-50%);
              width: 50px; height: 50px; border-radius: 50%;
              border: 1px solid rgba(201,169,110,.3); background: rgba(14,14,26,.55); color: #C9A96E;
              font-size: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center;
              backdrop-filter: blur(6px); transition: all .2s; line-height: 1; z-index: 1301;
            }
            .ds-zoom-arrow:hover { background: rgba(201,169,110,.2); border-color: #C9A96E; transform: translateY(-50%) scale(1.08); }
            .ds-zoom-arrow.prev { left: max(16px, 3vw); }
            .ds-zoom-arrow.next { right: max(16px, 3vw); }
            .ds-zoom-close {
              position: fixed; top: 22px; right: 22px; z-index: 1301;
              width: 36px; height: 36px; border-radius: 50%;
              border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06); color: rgba(255,255,255,.75);
              font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .2s;
            }
            .ds-zoom-close:hover { background: rgba(255,255,255,.14); color: #fff; }
            @media (max-width: 640px) { .ds-zoom-arrow { width: 42px; height: 42px; font-size: 24px; } .ds-zoom-arrow.prev { left: 8px; } .ds-zoom-arrow.next { right: 8px; } }

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
            .ds-pay-method:disabled { opacity: .4; cursor: default; font-size: 11px; }
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
              .ds-detail-head { grid-template-columns: 1fr; gap: 24px; }
              .ds-detail-cover { max-width: 320px; }
              .deckstore-body { padding: 24px 18px 56px; }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
