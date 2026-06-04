import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Suit = 'all' | 'major' | 'cups' | 'wands' | 'swords' | 'pentacles';
type CardSuit = Exclude<Suit, 'all'>;

interface TarotCard {
  id: string;
  name: string;
  suit: CardSuit;
}

interface DeckMeta {
  id: string;
  name: string;
  artist?: string;
  style?: string;
  accent?: string;
  order?: number;
}

// A single image: one card, in one deck, optionally a named variant.
interface Variant {
  cardId: string;
  deckId: string;
  suit: CardSuit;
  url: string;
  variantTag: string | null; // null = primary; e.g. "alt", "backup"
}

// ── Auto-discover decks + card art at build time via Vite glob ────────────────
// Image keys:  '../../public/tarot-images/decks/<deckId>/<suit>/<card>.png'
// Meta keys:   '../../public/tarot-images/decks/<deckId>/deck.json'
const _imgGlob = import.meta.glob(
  '../../public/tarot-images/decks/**/*.png',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>;

const _metaGlob = import.meta.glob(
  '../../public/tarot-images/decks/*/deck.json',
  { eager: true, import: 'default' }
) as Record<string, DeckMeta>;

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

// O(n·m) Levenshtein, O(n) space
function editDist(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (const ca of a) {
    let prev = dp[0]++;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = ca === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

// ── Complete 78-card deck (canonical positions, display order) ────────────────
const DECK: TarotCard[] = [
  // Major Arcana (22)
  { id: 'fool',           name: 'The Fool',           suit: 'major' },
  { id: 'magician',       name: 'The Magician',        suit: 'major' },
  { id: 'high-priestess', name: 'The High Priestess',  suit: 'major' },
  { id: 'empress',        name: 'The Empress',          suit: 'major' },
  { id: 'emperor',        name: 'The Emperor',          suit: 'major' },
  { id: 'hierophant',     name: 'The Hierophant',       suit: 'major' },
  { id: 'lovers',         name: 'The Lovers',           suit: 'major' },
  { id: 'chariot',        name: 'The Chariot',          suit: 'major' },
  { id: 'strength',       name: 'Strength',             suit: 'major' },
  { id: 'hermit',         name: 'The Hermit',           suit: 'major' },
  { id: 'wheel',          name: 'Wheel of Fortune',     suit: 'major' },
  { id: 'justice',        name: 'Justice',              suit: 'major' },
  { id: 'hanged-man',     name: 'The Hanged Man',       suit: 'major' },
  { id: 'death',          name: 'Death',                suit: 'major' },
  { id: 'temperance',     name: 'Temperance',           suit: 'major' },
  { id: 'devil',          name: 'The Devil',            suit: 'major' },
  { id: 'tower',          name: 'The Tower',            suit: 'major' },
  { id: 'star',           name: 'The Star',             suit: 'major' },
  { id: 'moon',           name: 'The Moon',             suit: 'major' },
  { id: 'sun',            name: 'The Sun',              suit: 'major' },
  { id: 'judgement',      name: 'Judgement',            suit: 'major' },
  { id: 'world',          name: 'The World',            suit: 'major' },
  // Cups (14)
  { id: 'ace-cups',    name: 'Ace of Cups',    suit: 'cups' },
  { id: 'two-cups',    name: 'Two of Cups',    suit: 'cups' },
  { id: 'three-cups',  name: 'Three of Cups',  suit: 'cups' },
  { id: 'four-cups',   name: 'Four of Cups',   suit: 'cups' },
  { id: 'five-cups',   name: 'Five of Cups',   suit: 'cups' },
  { id: 'six-cups',    name: 'Six of Cups',    suit: 'cups' },
  { id: 'seven-cups',  name: 'Seven of Cups',  suit: 'cups' },
  { id: 'eight-cups',  name: 'Eight of Cups',  suit: 'cups' },
  { id: 'nine-cups',   name: 'Nine of Cups',   suit: 'cups' },
  { id: 'ten-cups',    name: 'Ten of Cups',    suit: 'cups' },
  { id: 'page-cups',   name: 'Page of Cups',   suit: 'cups' },
  { id: 'knight-cups', name: 'Knight of Cups', suit: 'cups' },
  { id: 'queen-cups',  name: 'Queen of Cups',  suit: 'cups' },
  { id: 'king-cups',   name: 'King of Cups',   suit: 'cups' },
  // Wands (14)
  { id: 'ace-wands',    name: 'Ace of Wands',    suit: 'wands' },
  { id: 'two-wands',    name: 'Two of Wands',    suit: 'wands' },
  { id: 'three-wands',  name: 'Three of Wands',  suit: 'wands' },
  { id: 'four-wands',   name: 'Four of Wands',   suit: 'wands' },
  { id: 'five-wands',   name: 'Five of Wands',   suit: 'wands' },
  { id: 'six-wands',    name: 'Six of Wands',    suit: 'wands' },
  { id: 'seven-wands',  name: 'Seven of Wands',  suit: 'wands' },
  { id: 'eight-wands',  name: 'Eight of Wands',  suit: 'wands' },
  { id: 'nine-wands',   name: 'Nine of Wands',   suit: 'wands' },
  { id: 'ten-wands',    name: 'Ten of Wands',    suit: 'wands' },
  { id: 'page-wands',   name: 'Page of Wands',   suit: 'wands' },
  { id: 'knight-wands', name: 'Knight of Wands', suit: 'wands' },
  { id: 'queen-wands',  name: 'Queen of Wands',  suit: 'wands' },
  { id: 'king-wands',   name: 'King of Wands',   suit: 'wands' },
  // Swords (14)
  { id: 'ace-swords',    name: 'Ace of Swords',    suit: 'swords' },
  { id: 'two-swords',    name: 'Two of Swords',    suit: 'swords' },
  { id: 'three-swords',  name: 'Three of Swords',  suit: 'swords' },
  { id: 'four-swords',   name: 'Four of Swords',   suit: 'swords' },
  { id: 'five-swords',   name: 'Five of Swords',   suit: 'swords' },
  { id: 'six-swords',    name: 'Six of Swords',    suit: 'swords' },
  { id: 'seven-swords',  name: 'Seven of Swords',  suit: 'swords' },
  { id: 'eight-swords',  name: 'Eight of Swords',  suit: 'swords' },
  { id: 'nine-swords',   name: 'Nine of Swords',   suit: 'swords' },
  { id: 'ten-swords',    name: 'Ten of Swords',    suit: 'swords' },
  { id: 'page-swords',   name: 'Page of Swords',   suit: 'swords' },
  { id: 'knight-swords', name: 'Knight of Swords', suit: 'swords' },
  { id: 'queen-swords',  name: 'Queen of Swords',  suit: 'swords' },
  { id: 'king-swords',   name: 'King of Swords',   suit: 'swords' },
  // Pentacles (14)
  { id: 'ace-pentacles',    name: 'Ace of Pentacles',    suit: 'pentacles' },
  { id: 'two-pentacles',    name: 'Two of Pentacles',    suit: 'pentacles' },
  { id: 'three-pentacles',  name: 'Three of Pentacles',  suit: 'pentacles' },
  { id: 'four-pentacles',   name: 'Four of Pentacles',   suit: 'pentacles' },
  { id: 'five-pentacles',   name: 'Five of Pentacles',   suit: 'pentacles' },
  { id: 'six-pentacles',    name: 'Six of Pentacles',    suit: 'pentacles' },
  { id: 'seven-pentacles',  name: 'Seven of Pentacles',  suit: 'pentacles' },
  { id: 'eight-pentacles',  name: 'Eight of Pentacles',  suit: 'pentacles' },
  { id: 'nine-pentacles',   name: 'Nine of Pentacles',   suit: 'pentacles' },
  { id: 'ten-pentacles',    name: 'Ten of Pentacles',    suit: 'pentacles' },
  { id: 'page-pentacles',   name: 'Page of Pentacles',   suit: 'pentacles' },
  { id: 'knight-pentacles', name: 'Knight of Pentacles', suit: 'pentacles' },
  { id: 'queen-pentacles',  name: 'Queen of Pentacles',  suit: 'pentacles' },
  { id: 'king-pentacles',   name: 'King of Pentacles',   suit: 'pentacles' },
];

// Per-suit lookup: normalised card name → canonical card id
const NAME_TO_ID: Record<CardSuit, Map<string, string>> = {
  major: new Map(), cups: new Map(), wands: new Map(),
  swords: new Map(), pentacles: new Map(),
};
for (const card of DECK) NAME_TO_ID[card.suit].set(norm(card.name), card.id);

// Resolve a filename stem to a canonical card id within its suit.
// Exact normalised match first; falls back to edit-distance ≤ 1 (handles
// "judgment"↔"judgement"). Capped at 1 so it can never cross to another card.
function resolveCardId(suit: CardSuit, stem: string): string | null {
  const target = norm(stem);
  const lookup = NAME_TO_ID[suit];
  const exact = lookup.get(target);
  if (exact) return exact;
  for (const [name, id] of lookup) {
    if (editDist(target, name) === 1) return id;
  }
  return null;
}

// ── Build the deck + variant registry from the globbed files ──────────────────
const _metaById = new Map<string, DeckMeta>();
for (const meta of Object.values(_metaGlob)) {
  if (meta && meta.id) _metaById.set(meta.id, meta);
}

const _variants: Variant[] = [];
const _deckIdsSeen = new Set<string>();
for (const [key, url] of Object.entries(_imgGlob)) {
  const m = key.match(/\/decks\/([^/]+)\/([^/]+)\/([^/]+)\.png$/i);
  if (!m) continue;
  const [, deckId, suitRaw, fileStem] = m;
  const suit = suitRaw as CardSuit;
  if (!(suit in NAME_TO_ID)) continue;
  const sep = fileStem.indexOf('__');
  const baseStem = sep === -1 ? fileStem : fileStem.slice(0, sep);
  const variantTag = sep === -1 ? null : fileStem.slice(sep + 2);
  const cardId = resolveCardId(suit, baseStem);
  if (!cardId) continue;
  _deckIdsSeen.add(deckId);
  _variants.push({ cardId, deckId, suit, url, variantTag });
}

// Deck list: prefer deck.json metadata, fall back to a bare entry for any
// deck folder that has images but no metadata.
const DECKS: DeckMeta[] = Array.from(new Set([..._deckIdsSeen, ..._metaById.keys()]))
  .map(id => _metaById.get(id) ?? { id, name: id })
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));

const DECK_NAME = new Map(DECKS.map(d => [d.id, d.name]));
const _deckOrder = new Map(DECKS.map((d, i) => [d.id, i]));

// cardId → all its variants (across every deck), sorted deck-order then primary-first
const VARIANTS_BY_CARD = new Map<string, Variant[]>();
for (const v of _variants) {
  const arr = VARIANTS_BY_CARD.get(v.cardId) ?? [];
  arr.push(v);
  VARIANTS_BY_CARD.set(v.cardId, arr);
}
for (const arr of VARIANTS_BY_CARD.values()) {
  arr.sort((a, b) => {
    const da = _deckOrder.get(a.deckId) ?? 99, db = _deckOrder.get(b.deckId) ?? 99;
    if (da !== db) return da - db;
    if ((a.variantTag === null) !== (b.variantTag === null)) return a.variantTag === null ? -1 : 1;
    return (a.variantTag ?? '').localeCompare(b.variantTag ?? '');
  });
}

// The image shown for a card in a given deck (primary version, else first).
function deckPrimary(deckId: string, cardId: string): Variant | undefined {
  const arr = VARIANTS_BY_CARD.get(cardId);
  if (!arr) return undefined;
  const inDeck = arr.filter(v => v.deckId === deckId);
  return inDeck.find(v => v.variantTag === null) ?? inDeck[0];
}

// ── UI constants ──────────────────────────────────────────────────────────────
const SUIT_LABELS: Record<Suit, string> = {
  all: 'All Cards', major: 'Major Arcana',
  cups: 'Cups', wands: 'Wands', swords: 'Swords', pentacles: 'Pentacles',
};
const SUIT_ICONS: Record<Suit, string> = {
  all: '✦', major: '☽', cups: '◎', wands: '⟆', swords: '⚔', pentacles: '⬟',
};
const SUIT_COLORS: Record<CardSuit, string> = {
  major: '#C9A96E', cups: '#7EC8E3', wands: '#F4A261',
  swords: '#A8D8EA', pentacles: '#90BE6D',
};

function variantLabel(v: Variant): string {
  const deck = DECK_NAME.get(v.deckId) ?? v.deckId;
  return v.variantTag ? `${deck} · ${v.variantTag}` : deck;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TarotShowcase() {
  const [activeDeck, setActiveDeck] = useState<string>(DECKS[0]?.id ?? '');
  const [activeSuit, setActiveSuit] = useState<Suit>('all');
  const [selected, setSelected] = useState<TarotCard | null>(null);
  const [shown, setShown] = useState<Variant | null>(null); // image inside lightbox

  const deckMeta = DECKS.find(d => d.id === activeDeck);
  const deckAccent = deckMeta?.accent ?? '#C9A96E';

  const filtered = useMemo(
    () => activeSuit === 'all' ? DECK : DECK.filter(c => c.suit === activeSuit),
    [activeSuit]
  );

  // cards present in the active deck (have an image) — used for the lightbox nav
  const navList = useMemo(
    () => filtered.filter(c => deckPrimary(activeDeck, c.id)),
    [filtered, activeDeck]
  );

  const missingCount = filtered.length - navList.length;

  const openCard = (card: TarotCard) => {
    setSelected(card);
    setShown(deckPrimary(activeDeck, card.id) ?? VARIANTS_BY_CARD.get(card.id)?.[0] ?? null);
  };

  const step = (dir: 1 | -1) => {
    if (!selected || navList.length === 0) return;
    const at = navList.findIndex(c => c.id === selected.id);
    const next = navList[((at < 0 ? 0 : at) + dir + navList.length) % navList.length];
    setSelected(next);
    setShown(deckPrimary(activeDeck, next.id) ?? VARIANTS_BY_CARD.get(next.id)?.[0] ?? null);
  };

  // keyboard nav for the lightbox
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, navList, activeDeck]);

  return (
    <div className="showcase-root">
      <div className="showcase-stars" aria-hidden />

      <div className="showcase-content">
        {/* Header */}
        <header className="showcase-header">
          <div className="showcase-ornament">✦ ✦ ✦</div>
          <h1 className="showcase-title">Tarot Card Gallery</h1>
          <p className="showcase-subtitle">
            {deckMeta?.name ?? '—'}
            {deckMeta?.style ? ` · ${deckMeta.style}` : ''}
          </p>
        </header>

        {/* Deck switcher */}
        <div className="deck-switcher">
          <span className="deck-switcher-label">Deck</span>
          {DECKS.map(d => (
            <button
              key={d.id}
              className={`deck-btn ${activeDeck === d.id ? 'active' : ''}`}
              onClick={() => setActiveDeck(d.id)}
              style={{ '--deck-accent': d.accent ?? '#C9A96E' } as React.CSSProperties}
            >
              {d.name}
            </button>
          ))}
        </div>

        {/* Suit filter tabs */}
        <nav className="showcase-nav">
          {(Object.keys(SUIT_LABELS) as Suit[]).map(suit => (
            <button
              key={suit}
              className={`showcase-tab ${activeSuit === suit ? 'active' : ''}`}
              onClick={() => setActiveSuit(suit)}
            >
              <span className="tab-icon">{SUIT_ICONS[suit]}</span>
              <span className="tab-label">{SUIT_LABELS[suit]}</span>
              {suit !== 'all' && (
                <span className="tab-count">{DECK.filter(c => c.suit === suit).length}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Stats row */}
        <p className="showcase-count">
          Showing {filtered.length} cards
          {missingCount > 0 && (
            <span className="missing-badge">{missingCount} missing</span>
          )}
        </p>

        {/* Grid */}
        <motion.div className="showcase-grid" layout>
          <AnimatePresence mode="popLayout">
            {filtered.map((card, i) => {
              const primary = deckPrimary(activeDeck, card.id);
              const src = primary?.url ?? null;
              const color = SUIT_COLORS[card.suit];
              const versionCount = VARIANTS_BY_CARD.get(card.id)?.length ?? 0;
              return (
                <motion.div
                  key={card.id}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.22, delay: Math.min(i * 0.012, 0.3) }}
                  className={`card-item ${!src ? 'card-missing' : ''}`}
                  onClick={() => src && openCard(card)}
                  style={{ '--suit-color': color } as React.CSSProperties}
                >
                  <div className="card-border">
                    <div className="card-img-wrap">
                      {src ? (
                        <>
                          <img src={src} alt={card.name} className="card-img" loading="lazy" />
                          {versionCount > 1 && (
                            <span className="card-versions-badge" title={`${versionCount} versions available`}>
                              ⊞ {versionCount}
                            </span>
                          )}
                          <div className="card-overlay"><span className="card-zoom">⊕</span></div>
                        </>
                      ) : (
                        <div className="card-placeholder">
                          <div className="placeholder-pattern" aria-hidden />
                          <span className="placeholder-symbol">✦</span>
                        </div>
                      )}
                    </div>
                    <div className="card-label">
                      <span className="card-suit-dot" style={{ background: src ? color : 'rgba(255,255,255,0.2)' }} />
                      <span className="card-name">{card.name}</span>
                      {!src && <span className="card-missing-tag">缺</span>}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {selected && shown && (() => {
          const color = SUIT_COLORS[selected.suit];
          const versions = VARIANTS_BY_CARD.get(selected.id) ?? [];
          const at = navList.findIndex(c => c.id === selected.id);
          return (
            <motion.div
              className="lightbox-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
            >
              <motion.div
                className="lightbox-panel"
                initial={{ opacity: 0, scale: 0.75, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.75, y: 40 }}
                transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                style={{ '--suit-color': color } as React.CSSProperties}
                onClick={e => e.stopPropagation()}
              >
                <button className="lightbox-close" onClick={() => setSelected(null)}>✕</button>

                <div className="lightbox-stage">
                  <button className="lstage-nav prev" onClick={() => step(-1)} aria-label="Previous">‹</button>
                  <AnimatePresence mode="wait">
                    <motion.img
                      key={shown.url}
                      src={shown.url}
                      alt={selected.name}
                      className="lightbox-img"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    />
                  </AnimatePresence>
                  <button className="lstage-nav next" onClick={() => step(1)} aria-label="Next">›</button>
                </div>

                <div className="lightbox-info">
                  <p className="lightbox-suit">{SUIT_LABELS[selected.suit]}</p>
                  <h2 className="lightbox-name">{selected.name}</h2>
                  <p className="lightbox-deck">
                    <span className="deck-dot" style={{ background: deckAccent }} />
                    {variantLabel(shown)}
                  </p>
                </div>

                {/* Cross-deck / multi-version strip */}
                {versions.length > 1 && (
                  <div className="lightbox-versions">
                    {versions.map(v => (
                      <button
                        key={`${v.deckId}/${v.variantTag ?? 'base'}`}
                        className={`version-thumb ${v.url === shown.url ? 'active' : ''}`}
                        onClick={() => setShown(v)}
                        title={variantLabel(v)}
                      >
                        <img src={v.url} alt={variantLabel(v)} loading="lazy" />
                        <span className="version-deck">
                          {DECK_NAME.get(v.deckId) ?? v.deckId}
                          {v.variantTag && <span className="version-tag">{v.variantTag}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="lightbox-nav">
                  <span className="lnav-pos">{(at < 0 ? 0 : at) + 1} / {navList.length}</span>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      <style>{`
        .showcase-root {
          height: 100%;
          background: #06060f;
          overflow-y: auto;
          overflow-x: hidden;
          position: relative;
        }
        .showcase-stars {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          background-image:
            radial-gradient(1px 1px at 10% 15%, rgba(255,255,255,.6) 0%, transparent 100%),
            radial-gradient(1px 1px at 30% 60%, rgba(255,255,255,.4) 0%, transparent 100%),
            radial-gradient(1px 1px at 55% 25%, rgba(255,255,255,.5) 0%, transparent 100%),
            radial-gradient(1px 1px at 70% 80%, rgba(255,255,255,.3) 0%, transparent 100%),
            radial-gradient(1px 1px at 85% 40%, rgba(255,255,255,.5) 0%, transparent 100%),
            radial-gradient(1px 1px at 20% 90%, rgba(255,255,255,.4) 0%, transparent 100%),
            radial-gradient(1px 1px at 45% 70%, rgba(255,255,255,.6) 0%, transparent 100%),
            radial-gradient(1px 1px at 92% 10%, rgba(255,255,255,.5) 0%, transparent 100%),
            radial-gradient(1.5px 1.5px at 5% 45%, rgba(201,169,110,.4) 0%, transparent 100%),
            radial-gradient(1.5px 1.5px at 65% 55%, rgba(201,169,110,.3) 0%, transparent 100%),
            radial-gradient(2px 2px at 38% 8%, rgba(201,169,110,.5) 0%, transparent 100%);
        }
        .showcase-content {
          position: relative; z-index: 1;
          max-width: 1400px; margin: 0 auto;
          padding: 48px 24px 80px;
        }
        .showcase-header { text-align: center; margin-bottom: 28px; }
        .showcase-ornament {
          font-size: 12px; letter-spacing: 12px;
          color: #C9A96E; opacity: .7; margin-bottom: 16px;
        }
        .showcase-title {
          font-family: 'Cinzel', serif;
          font-size: clamp(28px, 5vw, 52px); font-weight: 700;
          background: linear-gradient(135deg, #C9A96E 0%, #F0D090 50%, #C9A96E 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text; letter-spacing: 3px; margin-bottom: 10px;
        }
        .showcase-subtitle {
          color: rgba(255,255,255,.4); font-size: 14px;
          letter-spacing: 2px; text-transform: uppercase;
        }

        /* Deck switcher */
        .deck-switcher {
          display: flex; flex-wrap: wrap; justify-content: center;
          align-items: center; gap: 8px; margin-bottom: 22px;
        }
        .deck-switcher-label {
          font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
          color: rgba(255,255,255,.3); margin-right: 4px;
        }
        .deck-btn {
          padding: 7px 16px; border-radius: 8px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.03);
          color: rgba(255,255,255,.6); font-size: 13px;
          cursor: pointer; transition: all .2s; font-family: 'Cinzel', serif;
          letter-spacing: .5px;
        }
        .deck-btn:hover {
          color: rgba(255,255,255,.9);
          border-color: color-mix(in srgb, var(--deck-accent) 50%, transparent);
        }
        .deck-btn.active {
          color: var(--deck-accent);
          border-color: var(--deck-accent);
          background: color-mix(in srgb, var(--deck-accent) 14%, transparent);
          box-shadow: 0 0 18px color-mix(in srgb, var(--deck-accent) 18%, transparent);
        }

        .showcase-nav {
          display: flex; flex-wrap: wrap; justify-content: center;
          gap: 8px; margin-bottom: 16px;
        }
        .showcase-tab {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 18px; border-radius: 999px;
          border: 1px solid rgba(201,169,110,.25);
          background: rgba(255,255,255,.04);
          color: rgba(255,255,255,.55); font-size: 13px;
          cursor: pointer; transition: all .2s;
          font-family: inherit; white-space: nowrap;
        }
        .showcase-tab:hover {
          border-color: rgba(201,169,110,.5);
          color: rgba(255,255,255,.85);
          background: rgba(201,169,110,.08);
        }
        .showcase-tab.active {
          border-color: #C9A96E;
          background: rgba(201,169,110,.15);
          color: #C9A96E;
        }
        .tab-icon { font-size: 11px; opacity: .8; }
        .tab-count {
          font-size: 11px; background: rgba(201,169,110,.2);
          color: rgba(201,169,110,.8); padding: 1px 6px; border-radius: 999px;
        }
        .showcase-count {
          text-align: center; font-size: 12px;
          color: rgba(255,255,255,.3); margin-bottom: 32px;
          letter-spacing: 1px; display: flex; align-items: center;
          justify-content: center; gap: 10px;
        }
        .missing-badge {
          font-size: 11px; padding: 2px 8px; border-radius: 999px;
          background: rgba(255,120,80,.12); color: rgba(255,140,100,.7);
          border: 1px solid rgba(255,120,80,.2); letter-spacing: .5px;
        }

        /* Grid */
        .showcase-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 20px;
        }
        @media (min-width: 768px) {
          .showcase-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 24px; }
        }
        @media (min-width: 1200px) {
          .showcase-grid { grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); gap: 28px; }
        }

        /* Card */
        .card-item { cursor: pointer; }
        .card-missing { cursor: default; opacity: .55; }
        .card-border {
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.03);
          padding: 8px 8px 10px;
          transition: border-color .25s, box-shadow .25s, transform .25s;
          height: 100%;
        }
        .card-item:not(.card-missing):hover .card-border {
          border-color: var(--suit-color);
          box-shadow: 0 0 20px rgba(201,169,110,.15), 0 8px 32px rgba(0,0,0,.5);
          transform: translateY(-4px);
        }
        .card-missing .card-border {
          border-style: dashed;
          border-color: rgba(255,255,255,.12);
        }
        .card-img-wrap {
          position: relative; border-radius: 8px; overflow: hidden;
          background: #10101a;
        }
        .card-img {
          width: 100%; height: auto;
          display: block; transition: transform .3s;
        }
        .card-item:not(.card-missing):hover .card-img { transform: scale(1.04); }
        .card-versions-badge {
          position: absolute; top: 6px; right: 6px; z-index: 2;
          font-size: 10px; letter-spacing: .5px;
          padding: 2px 7px; border-radius: 999px;
          background: rgba(8,8,16,.78); color: rgba(255,255,255,.85);
          border: 1px solid rgba(201,169,110,.5);
          backdrop-filter: blur(4px);
        }
        .card-overlay {
          position: absolute; inset: 0; background: rgba(0,0,0,0);
          display: flex; align-items: center; justify-content: center;
          transition: background .25s;
        }
        .card-item:not(.card-missing):hover .card-overlay { background: rgba(0,0,0,.35); }
        .card-zoom { font-size: 28px; color: white; opacity: 0; transition: opacity .2s; }
        .card-item:not(.card-missing):hover .card-zoom { opacity: 1; }

        /* Missing placeholder */
        .card-placeholder {
          width: 100%; aspect-ratio: 2/3;
          display: flex; align-items: center; justify-content: center;
          position: relative; overflow: hidden;
        }
        .placeholder-pattern {
          position: absolute; inset: 0;
          background-image: repeating-linear-gradient(
            45deg,
            rgba(255,255,255,.025) 0px, rgba(255,255,255,.025) 1px,
            transparent 1px, transparent 12px
          );
        }
        .placeholder-symbol {
          font-size: 28px; color: rgba(255,255,255,.15);
          position: relative; z-index: 1;
        }

        /* Card label */
        .card-label {
          display: flex; align-items: center; gap: 6px;
          margin-top: 8px; padding: 0 2px;
        }
        .card-suit-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .card-name {
          font-size: 11.5px; color: rgba(255,255,255,.7);
          line-height: 1.3; font-family: 'Cinzel', serif;
          font-weight: 400; transition: color .2s; flex: 1; min-width: 0;
        }
        .card-item:not(.card-missing):hover .card-name { color: rgba(255,255,255,.95); }
        .card-missing-tag {
          font-size: 10px; padding: 1px 5px; border-radius: 4px;
          background: rgba(255,120,80,.12); color: rgba(255,140,100,.6);
          border: 1px solid rgba(255,120,80,.2); flex-shrink: 0;
        }

        /* Lightbox */
        .lightbox-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,.85); backdrop-filter: blur(8px);
          z-index: 1000; display: flex; align-items: center;
          justify-content: center; padding: 24px;
        }
        .lightbox-panel {
          background: #0e0e1a;
          border: 1px solid var(--suit-color);
          border-radius: 16px; padding: 24px;
          max-width: 420px; width: 100%; position: relative;
          box-shadow: 0 0 60px rgba(201,169,110,.15), 0 32px 80px rgba(0,0,0,.7);
        }
        .lightbox-close {
          position: absolute; top: 14px; right: 14px; z-index: 3;
          width: 30px; height: 30px; border-radius: 50%;
          border: 1px solid rgba(255,255,255,.2);
          background: rgba(255,255,255,.06);
          color: rgba(255,255,255,.7); font-size: 13px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all .2s; font-family: inherit;
        }
        .lightbox-close:hover { background: rgba(255,255,255,.12); color: white; }
        .lightbox-stage {
          position: relative; display: flex; align-items: center; justify-content: center;
        }
        .lightbox-img {
          display: block;
          width: auto; height: auto;
          max-width: 100%; max-height: 60vh;
          margin: 0 auto;
          border-radius: 10px;
        }
        .lstage-nav {
          position: absolute; top: 50%; transform: translateY(-50%);
          width: 38px; height: 38px; border-radius: 50%;
          border: 1px solid rgba(201,169,110,.35);
          background: rgba(14,14,26,.7); color: #C9A96E;
          font-size: 22px; cursor: pointer; display: flex;
          align-items: center; justify-content: center;
          transition: all .2s; font-family: inherit; line-height: 1;
          backdrop-filter: blur(4px); z-index: 2;
        }
        .lstage-nav:hover { background: rgba(201,169,110,.2); border-color: #C9A96E; }
        .lstage-nav.prev { left: -6px; }
        .lstage-nav.next { right: -6px; }
        .lightbox-info { text-align: center; margin-top: 16px; }
        .lightbox-suit {
          font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
          color: var(--suit-color); margin-bottom: 6px;
        }
        .lightbox-name {
          font-family: 'Cinzel', serif; font-size: 20px;
          font-weight: 600; color: white; letter-spacing: 1px;
        }
        .lightbox-deck {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          margin-top: 8px; font-size: 12px; color: rgba(255,255,255,.5);
          letter-spacing: .5px;
        }
        .deck-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        /* Version strip */
        .lightbox-versions {
          display: flex; gap: 10px; margin-top: 16px;
          padding: 12px 4px 4px; overflow-x: auto;
          border-top: 1px solid rgba(255,255,255,.08);
          scrollbar-width: thin;
        }
        .version-thumb {
          flex: 0 0 auto; width: 64px; cursor: pointer;
          background: none; border: none; padding: 0;
          display: flex; flex-direction: column; align-items: center; gap: 5px;
          opacity: .6; transition: opacity .2s;
        }
        .version-thumb:hover { opacity: 1; }
        .version-thumb.active { opacity: 1; }
        .version-thumb img {
          width: 64px; height: 64px; object-fit: cover;
          border-radius: 6px; border: 2px solid transparent;
          transition: border-color .2s;
        }
        .version-thumb.active img { border-color: var(--suit-color); }
        .version-deck {
          font-size: 9.5px; line-height: 1.25; text-align: center;
          color: rgba(255,255,255,.6); max-width: 72px;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
        }
        .version-tag {
          font-size: 8.5px; padding: 0 5px; border-radius: 999px;
          background: rgba(201,169,110,.18); color: rgba(201,169,110,.9);
          text-transform: uppercase; letter-spacing: .5px;
        }
        .lightbox-nav {
          display: flex; align-items: center; justify-content: center;
          margin-top: 16px;
        }
        .lnav-pos {
          font-size: 12px; color: rgba(255,255,255,.4);
          min-width: 60px; text-align: center;
        }
      `}</style>
    </div>
  );
}
