import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import DeckStore from '../components/deckstore/DeckStore';

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
  url: string;                  // full-resolution original — shown in the lightbox
  thumbUrl: string | null;     // compressed ~400px WebP — shown in the grid (null → fall back to url)
  variantTag: string | null;   // null = primary; e.g. "alt", "backup"
}

// ── Runtime manifest (served by GET /api/decks/manifest) ──────────────────────
// The backend scans frontend/public/tarot-images/decks/ on every request, so a
// new deck folder shows up after a page refresh — no rebuild required.
interface ManifestImage { suit: string; file: string; url: string; thumb?: string | null }
interface ManifestDeck extends DeckMeta { images: ManifestImage[] }
interface Manifest { decks: ManifestDeck[] }

// Same-origin in dev (Vite proxies /api → backend); override with VITE_API_URL.
const API_BASE = import.meta.env.VITE_API_URL || '';

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

// ── Build the deck + variant registry from a fetched manifest ─────────────────
function buildRegistry(manifest: Manifest): {
  decks: DeckMeta[];
  variantsByCard: Map<string, Variant[]>;
} {
  const decks: DeckMeta[] = manifest.decks.map(d => ({
    id: d.id, name: d.name, artist: d.artist,
    style: d.style, accent: d.accent, order: d.order,
  }));
  const deckOrder = new Map(decks.map((d, i) => [d.id, i]));

  const variantsByCard = new Map<string, Variant[]>();
  for (const d of manifest.decks) {
    for (const img of d.images) {
      const suit = img.suit as CardSuit;
      if (!(suit in NAME_TO_ID)) continue;
      const sep = img.file.indexOf('__');
      const baseStem = sep === -1 ? img.file : img.file.slice(0, sep);
      const variantTag = sep === -1 ? null : img.file.slice(sep + 2);
      const cardId = resolveCardId(suit, baseStem);
      if (!cardId) continue;
      const arr = variantsByCard.get(cardId) ?? [];
      arr.push({ cardId, deckId: d.id, suit, url: img.url, thumbUrl: img.thumb ?? null, variantTag });
      variantsByCard.set(cardId, arr);
    }
  }
  // sort each card's variants by deck order, primary-first within a deck
  for (const arr of variantsByCard.values()) {
    arr.sort((a, b) => {
      const da = deckOrder.get(a.deckId) ?? 99, db = deckOrder.get(b.deckId) ?? 99;
      if (da !== db) return da - db;
      if ((a.variantTag === null) !== (b.variantTag === null)) return a.variantTag === null ? -1 : 1;
      return (a.variantTag ?? '').localeCompare(b.variantTag ?? '');
    });
  }
  return { decks, variantsByCard };
}

// ── Build-time fallback ───────────────────────────────────────────────────────
// Vite globs the deck images at build time so the gallery still renders when the
// backend (and its live /api/decks/manifest) is unavailable. The runtime manifest
// is preferred when reachable — it also picks up decks added after the build — but
// this guarantees cards always show. Only deck rename needs the backend.
const _imgGlob = import.meta.glob(
  '../../public/tarot-images/decks/**/*.png',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>;

// Compressed grid thumbnails (generated by tools/gen-thumbnails.sh). Globbed
// separately so the offline fallback can pair each PNG with its .thumb.webp.
const _thumbGlob = import.meta.glob(
  '../../public/tarot-images/decks/**/*.thumb.webp',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>;

const _metaGlob = import.meta.glob(
  '../../public/tarot-images/decks/*/deck.json',
  { eager: true, import: 'default' }
) as Record<string, DeckMeta>;

function prettifyDeckId(id: string): string {
  const s = id.replace(/[-_]+/g, ' ').trim();
  return s ? s.replace(/\b\w/g, c => c.toUpperCase()) : id;
}

// Shape the globbed files into the same Manifest the backend returns, so the rest
// of the page is source-agnostic.
function buildGlobManifest(): Manifest {
  const metaById = new Map<string, DeckMeta>();
  for (const meta of Object.values(_metaGlob)) {
    if (meta && meta.id) metaById.set(meta.id, meta);
  }
  // deckId/suit/stem → thumbnail url, so each PNG can find its .thumb.webp
  const thumbByKey = new Map<string, string>();
  for (const [key, url] of Object.entries(_thumbGlob)) {
    const m = key.match(/\/decks\/([^/]+)\/([^/]+)\/(.+)\.thumb\.webp$/i);
    if (!m) continue;
    const [, deckId, suit, stem] = m;
    thumbByKey.set(`${deckId}/${suit}/${stem}`, url);
  }
  const imagesByDeck = new Map<string, ManifestImage[]>();
  for (const [key, url] of Object.entries(_imgGlob)) {
    const m = key.match(/\/decks\/([^/]+)\/([^/]+)\/([^/]+)\.png$/i);
    if (!m) continue;
    const [, deckId, suit, fileStem] = m;
    const arr = imagesByDeck.get(deckId) ?? [];
    arr.push({ suit, file: fileStem, url, thumb: thumbByKey.get(`${deckId}/${suit}/${fileStem}`) ?? null });
    imagesByDeck.set(deckId, arr);
  }
  const ids = new Set<string>([...imagesByDeck.keys(), ...metaById.keys()]);
  const decks: ManifestDeck[] = Array.from(ids).map(id => {
    const meta = metaById.get(id);
    return {
      id,
      name: meta?.name || prettifyDeckId(id),
      artist: meta?.artist, style: meta?.style,
      accent: meta?.accent, order: meta?.order,
      images: imagesByDeck.get(id) ?? [],
    };
  });
  decks.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  return { decks };
}

const INITIAL = buildRegistry(buildGlobManifest());

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

// ── Component ─────────────────────────────────────────────────────────────────
export default function TarotShowcase() {
  // Seed from the build-time fallback so cards render even if the backend is down;
  // the runtime manifest (if reachable) upgrades this on mount.
  const [decks, setDecks] = useState<DeckMeta[]>(INITIAL.decks);
  const [variantsByCard, setVariantsByCard] = useState<Map<string, Variant[]>>(INITIAL.variantsByCard);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeDeck, setActiveDeck] = useState<string>(INITIAL.decks[0]?.id ?? '');
  const [activeSuit, setActiveSuit] = useState<Suit>('all');
  const [selected, setSelected] = useState<TarotCard | null>(null);
  const [shown, setShown] = useState<Variant | null>(null); // image inside lightbox
  const [storeOpen, setStoreOpen] = useState(false);        // 发现新牌组 overlay

  // deck rename
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const deckName = useMemo(() => new Map(decks.map(d => [d.id, d.name])), [decks]);

  // Fetch (or re-fetch) the manifest. Keeps the current deck selected if it's
  // still present; otherwise falls back to the first deck.
  const loadManifest = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/decks/manifest`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest: Manifest = await res.json();
      const { decks: ds, variantsByCard: vbc } = buildRegistry(manifest);
      setDecks(ds);
      setVariantsByCard(vbc);
      setActiveDeck(prev => (prev && ds.some(d => d.id === prev)) ? prev : (ds[0]?.id ?? ''));
    } catch (e) {
      // Backend unreachable: keep the build-time fallback decks already in state,
      // just flag that live sync (and rename) is unavailable.
      setLoadError(e instanceof Error ? e.message : 'Failed to load decks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadManifest(); }, [loadManifest]);
  // close the rename editor whenever the active deck changes
  useEffect(() => { setRenaming(false); setRenameError(null); }, [activeDeck]);

  const deckMeta = decks.find(d => d.id === activeDeck);
  const deckAccent = deckMeta?.accent ?? '#C9A96E';

  // The image shown for a card in a given deck (primary version, else first).
  const deckPrimary = useCallback((deckId: string, cardId: string): Variant | undefined => {
    const arr = variantsByCard.get(cardId);
    if (!arr) return undefined;
    const inDeck = arr.filter(v => v.deckId === deckId);
    return inDeck.find(v => v.variantTag === null) ?? inDeck[0];
  }, [variantsByCard]);

  // No backup/alt tag — every version is labelled by its deck only.
  const variantLabel = useCallback(
    (v: Variant) => deckName.get(v.deckId) ?? v.deckId,
    [deckName]
  );

  const filtered = useMemo(
    () => activeSuit === 'all' ? DECK : DECK.filter(c => c.suit === activeSuit),
    [activeSuit]
  );

  // cards present in the active deck (have an image) — used for the lightbox nav
  const navList = useMemo(
    () => filtered.filter(c => deckPrimary(activeDeck, c.id)),
    [filtered, activeDeck, deckPrimary]
  );

  const missingCount = filtered.length - navList.length;

  const openCard = (card: TarotCard) => {
    setSelected(card);
    setShown(deckPrimary(activeDeck, card.id) ?? variantsByCard.get(card.id)?.[0] ?? null);
  };

  const step = (dir: 1 | -1) => {
    if (!selected || navList.length === 0) return;
    const at = navList.findIndex(c => c.id === selected.id);
    const next = navList[((at < 0 ? 0 : at) + dir + navList.length) % navList.length];
    setSelected(next);
    setShown(deckPrimary(activeDeck, next.id) ?? variantsByCard.get(next.id)?.[0] ?? null);
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

  // ── Rename handlers ──────────────────────────────────────────────────────────
  const startRename = () => {
    setRenameValue(deckName.get(activeDeck) ?? '');
    setRenameError(null);
    setRenaming(true);
  };
  const cancelRename = () => { setRenaming(false); setRenameError(null); };
  const saveRename = async () => {
    const name = renameValue.trim();
    if (!name || !activeDeck) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      const res = await fetch(`${API_BASE}/api/decks/${encodeURIComponent(activeDeck)}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: ManifestDeck = await res.json();
      setDecks(prev => prev.map(d => d.id === updated.id ? { ...d, name: updated.name } : d));
      setRenaming(false);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setRenameSaving(false);
    }
  };

  return (
    <div className="showcase-root">
      <div className="showcase-stars" aria-hidden />

      <Link to="/" className="showcase-back">‹ 返回殿堂</Link>

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

        {loading && decks.length === 0 ? (
          <p className="showcase-status">Loading decks…</p>
        ) : loadError && decks.length === 0 ? (
          <div className="showcase-status error">
            <p>Couldn’t load decks: {loadError}</p>
            <button className="deck-refresh" onClick={loadManifest}>⟳ Retry</button>
          </div>
        ) : (
          <>
            {/* Deck switcher — active deck is renamed in place */}
            <div className="deck-switcher">
              <span className="deck-switcher-label">Deck</span>
              {decks.map(d => {
                const isActive = activeDeck === d.id;
                const accent = { '--deck-accent': d.accent ?? '#C9A96E' } as React.CSSProperties;

                if (isActive && renaming) {
                  return (
                    <span key={d.id} className="deck-chip-edit" style={accent}>
                      <input
                        className="deck-chip-input"
                        autoFocus
                        value={renameValue}
                        disabled={renameSaving}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveRename();
                          else if (e.key === 'Escape') cancelRename();
                        }}
                        onBlur={() => { if (!renameSaving) cancelRename(); }}
                        size={Math.max(renameValue.length, 6)}
                        aria-label="Deck name"
                      />
                      <span className="deck-chip-hint">
                        {renameSaving ? 'saving…' : renameError ?? '↵ save · esc cancel'}
                      </span>
                    </span>
                  );
                }

                return (
                  <button
                    key={d.id}
                    className={`deck-btn ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveDeck(d.id)}
                    onDoubleClick={() => { if (isActive && !loadError) startRename(); }}
                    style={accent}
                  >
                    <span className="deck-btn-name">{d.name}</span>
                    {isActive && !loadError && (
                      <span
                        className="deck-btn-edit"
                        role="button"
                        tabIndex={0}
                        title="Rename deck"
                        onClick={e => { e.stopPropagation(); startRename(); }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); startRename(); } }}
                      >
                        ✎
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                className="deck-discover-cta"
                onClick={() => setStoreOpen(true)}
                title="发现并获取更多牌组"
              >
                <span className="deck-discover-cta-spark">✦</span>
                <span className="deck-discover-cta-title">发现新牌组</span>
                <span className="deck-discover-cta-arrow">›</span>
              </button>
              <button
                className="deck-refresh-icon"
                onClick={loadManifest}
                disabled={loading}
                title="Rescan the decks folder"
                aria-label="Refresh decks"
              >
                <span className={loading ? 'spin' : ''}>⟳</span>
              </button>
              {loadError && (
                <span className="deck-sync-note" title={loadError}>
                  offline · built-in decks
                </span>
              )}
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
                </button>
              ))}
            </nav>

            {/* Missing indicator — only surfaces when this deck is incomplete */}
            {missingCount > 0 && (
              <p className="showcase-count">
                <span className="missing-badge">{missingCount} cards missing in this deck</span>
              </p>
            )}

            {/* Grid */}
            <motion.div className="showcase-grid" layout>
              <AnimatePresence mode="popLayout">
                {filtered.map((card, i) => {
                  const primary = deckPrimary(activeDeck, card.id);
                  const src = primary?.url ?? null;            // original — gates click/open
                  const thumbSrc = primary?.thumbUrl ?? src;   // compressed — what the grid renders
                  const color = SUIT_COLORS[card.suit];
                  const versionCount = variantsByCard.get(card.id)?.length ?? 0;
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
                              <img src={thumbSrc ?? undefined} alt={card.name} className="card-img" loading="lazy" />
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
          </>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {selected && shown && (() => {
          const color = SUIT_COLORS[selected.suit];
          const versions = variantsByCard.get(selected.id) ?? [];
          const at = navList.findIndex(c => c.id === selected.id);
          return (
            <motion.div
              className="lightbox-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
            >
              {/* Page-turn arrows live on the screen edges, not in the panel —
                  frees the panel's vertical space so the original gets more room. */}
              {navList.length > 1 && (
                <button
                  className="lbox-arrow prev"
                  onClick={e => { e.stopPropagation(); step(-1); }}
                  aria-label="Previous"
                >‹</button>
              )}

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
                </div>

                <div className="lightbox-info">
                  <p className="lightbox-suit">
                    {SUIT_LABELS[selected.suit]}
                    {navList.length > 1 && (
                      <span className="lbox-counter">{(at < 0 ? 0 : at) + 1} / {navList.length}</span>
                    )}
                  </p>
                  <h2 className="lightbox-name">{selected.name}</h2>
                  <p className="lightbox-deck">
                    <span className="deck-dot" style={{ background: deckAccent }} />
                    {variantLabel(shown)}
                  </p>
                </div>

                {/* Cross-deck / multi-version strip — labelled by deck only */}
                {versions.length > 1 && (
                  <div className="lightbox-versions">
                    {versions.map(v => (
                      <button
                        key={`${v.deckId}/${v.variantTag ?? 'base'}`}
                        className={`version-thumb ${v.url === shown.url ? 'active' : ''}`}
                        onClick={() => setShown(v)}
                        title={variantLabel(v)}
                      >
                        <img src={v.thumbUrl ?? v.url} alt={variantLabel(v)} loading="lazy" />
                        <span className="version-deck">
                          {deckName.get(v.deckId) ?? v.deckId}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>

              {navList.length > 1 && (
                <button
                  className="lbox-arrow next"
                  onClick={e => { e.stopPropagation(); step(1); }}
                  aria-label="Next"
                >›</button>
              )}
            </motion.div>
          );
        })()}
      </AnimatePresence>

      <DeckStore
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        onEnterDeck={(liveDeckId) => { setActiveDeck(liveDeckId); setStoreOpen(false); }}
      />

      <style>{`
        .showcase-root {
          height: 100%;
          background: #06060f;
          overflow-y: auto;
          overflow-x: hidden;
          position: relative;
          /* Firefox — slim gold thread, no track */
          scrollbar-width: thin;
          scrollbar-color: rgba(201,169,110,.4) transparent;
        }
        /* WebKit — override the global purple bar with a refined gold one.
           The transparent border + padding-box clip leaves the thumb floating
           as a thin pill inset from the edge. */
        .showcase-root::-webkit-scrollbar { width: 12px; }
        .showcase-root::-webkit-scrollbar-track { background: transparent; }
        .showcase-root::-webkit-scrollbar-thumb {
          border-radius: 999px;
          border: 4px solid transparent;
          background-clip: padding-box;
          background-color: rgba(201,169,110,.3);
          transition: background-color .2s;
        }
        .showcase-root::-webkit-scrollbar-thumb:hover {
          background-color: rgba(201,169,110,.6);
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
        .showcase-back {
          position: fixed; top: 20px; left: 22px; z-index: 5;
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 15px; border-radius: 999px;
          font-size: 13px; letter-spacing: .08em;
          color: rgba(201,169,110,.85);
          background: rgba(10,10,20,.5);
          border: 1px solid rgba(201,169,110,.25);
          backdrop-filter: blur(8px);
          text-decoration: none; transition: all .2s;
        }
        .showcase-back:hover {
          color: #F0D090; border-color: rgba(201,169,110,.5);
          background: rgba(201,169,110,.1);
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

        /* Loading / error status */
        .showcase-status {
          text-align: center; color: rgba(255,255,255,.45);
          font-size: 14px; letter-spacing: 1px; padding: 60px 0;
          display: flex; flex-direction: column; align-items: center; gap: 14px;
        }
        .showcase-status.error { color: rgba(255,140,100,.8); }

        /* Deck switcher */
        .deck-switcher {
          display: flex; flex-wrap: wrap; justify-content: center;
          align-items: center; gap: 8px; margin-bottom: 22px;
          min-height: 34px;
        }
        .deck-switcher-label {
          font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
          color: rgba(255,255,255,.3); margin-right: 4px;
        }
        .deck-btn {
          display: inline-flex; align-items: center; gap: 0;
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
        /* Inline rename pencil — appears only on the active chip */
        .deck-btn-edit {
          display: inline-flex; align-items: center; justify-content: center;
          width: 0; margin-left: 0; overflow: hidden;
          font-size: 11px; opacity: 0;
          color: color-mix(in srgb, var(--deck-accent) 80%, white);
          transition: width .2s ease, margin-left .2s ease, opacity .2s ease;
        }
        .deck-btn.active:hover .deck-btn-edit,
        .deck-btn.active:focus-within .deck-btn-edit {
          width: 14px; margin-left: 8px; opacity: .75;
        }
        .deck-btn-edit:hover { opacity: 1 !important; transform: scale(1.15); }

        /* In-place rename editor — occupies the same slot as the chip */
        .deck-chip-edit {
          display: inline-flex; flex-direction: column; align-items: flex-start;
          gap: 3px; padding: 5px 14px;
          border-radius: 8px;
          border: 1px solid var(--deck-accent);
          background: color-mix(in srgb, var(--deck-accent) 12%, #0e0e1a);
          box-shadow: 0 0 22px color-mix(in srgb, var(--deck-accent) 25%, transparent);
        }
        .deck-chip-input {
          border: none; background: transparent; outline: none;
          color: #fff; font-size: 13px; letter-spacing: .5px;
          font-family: 'Cinzel', serif; padding: 0;
          min-width: 60px;
        }
        .deck-chip-input:disabled { opacity: .6; }
        .deck-chip-hint {
          font-size: 9px; letter-spacing: .8px; text-transform: uppercase;
          color: color-mix(in srgb, var(--deck-accent) 60%, rgba(255,255,255,.5));
        }

        /* Refresh — quiet icon button */
        .deck-refresh-icon {
          width: 30px; height: 30px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          border: 1px solid rgba(255,255,255,.1);
          background: rgba(255,255,255,.03);
          color: rgba(255,255,255,.45); font-size: 15px;
          cursor: pointer; transition: all .2s; margin-left: 4px;
        }
        .deck-refresh-icon:hover:not(:disabled) {
          color: #C9A96E; border-color: rgba(201,169,110,.5);
          background: rgba(201,169,110,.1); transform: rotate(90deg);
        }
        .deck-refresh-icon:disabled { opacity: .5; cursor: default; }
        .deck-refresh-icon .spin { display: inline-block; animation: deck-spin 1s linear infinite; }
        @keyframes deck-spin { to { transform: rotate(360deg); } }
        .deck-sync-note {
          font-size: 11px; color: rgba(255,180,140,.5);
          letter-spacing: .5px; font-style: italic;
        }
        /* Prominent store CTA — sits inline among the deck chips.
           Filled gold so it reads as the primary action in the row; a soft
           halo pulse draws the eye without shifting layout. */
        .deck-discover-cta {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 7px 16px; border-radius: 8px; cursor: pointer;
          margin-left: 4px;
          font-family: 'Cinzel', serif; font-size: 13px;
          letter-spacing: .5px; font-weight: 600; color: #100b04;
          border: 1px solid rgba(240,208,144,.65);
          background: linear-gradient(120deg, #C9A96E 0%, #F0D090 130%);
          box-shadow: 0 4px 16px rgba(201,169,110,.28);
          transition: transform .22s, box-shadow .22s;
          animation: deck-discover-pulse 3s ease-in-out infinite;
        }
        .deck-discover-cta:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(201,169,110,.45);
          animation-play-state: paused;
        }
        @keyframes deck-discover-pulse {
          0%, 100% { box-shadow: 0 4px 16px rgba(201,169,110,.28), 0 0 0 0 rgba(201,169,110,.38); }
          50%       { box-shadow: 0 4px 18px rgba(201,169,110,.34), 0 0 0 6px rgba(201,169,110,0); }
        }
        .deck-discover-cta-spark { font-size: 13px; line-height: 1; }
        .deck-discover-cta-title { white-space: nowrap; }
        .deck-discover-cta-arrow {
          font-size: 17px; line-height: 1; transition: transform .22s;
        }
        .deck-discover-cta:hover .deck-discover-cta-arrow { transform: translateX(3px); }
        @media (prefers-reduced-motion: reduce) {
          .deck-discover-cta { animation: none; }
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
        .showcase-count {
          text-align: center; margin-bottom: 28px;
          display: flex; align-items: center; justify-content: center;
        }
        .missing-badge {
          font-size: 11px; padding: 3px 12px; border-radius: 999px;
          background: rgba(255,120,80,.1); color: rgba(255,140,100,.75);
          border: 1px solid rgba(255,120,80,.22); letter-spacing: .5px;
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
          border-radius: 16px; padding: 20px;
          max-width: min(92vw, 560px); width: 100%; position: relative;
          max-height: calc(100vh - 32px); overflow-y: auto;
          box-shadow: 0 0 60px rgba(201,169,110,.15), 0 32px 80px rgba(0,0,0,.7);
          scrollbar-width: thin; scrollbar-color: rgba(201,169,110,.4) transparent;
        }
        .lightbox-panel::-webkit-scrollbar { width: 8px; }
        .lightbox-panel::-webkit-scrollbar-track { background: transparent; }
        .lightbox-panel::-webkit-scrollbar-thumb {
          border-radius: 999px; border: 2px solid transparent;
          background-clip: padding-box; background-color: rgba(201,169,110,.35);
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
          max-width: 100%;
          /* bigger original — but always leave headroom for the title/deck below */
          max-height: min(80vh, calc(100vh - 200px));
          margin: 0 auto;
          border-radius: 10px;
        }
        /* Page-turn arrows — fixed to the screen edges, clear of the image */
        .lbox-arrow {
          position: fixed; top: 50%; transform: translateY(-50%);
          width: 52px; height: 52px; border-radius: 50%;
          border: 1px solid rgba(201,169,110,.3);
          background: rgba(14,14,26,.55); color: #C9A96E;
          font-size: 30px; cursor: pointer; display: flex;
          align-items: center; justify-content: center;
          transition: all .2s; font-family: inherit; line-height: 1;
          backdrop-filter: blur(6px); z-index: 1001;
        }
        .lbox-arrow:hover {
          background: rgba(201,169,110,.2); border-color: #C9A96E;
          transform: translateY(-50%) scale(1.08);
        }
        .lbox-arrow.prev { left: max(16px, 3vw); }
        .lbox-arrow.next { right: max(16px, 3vw); }
        @media (max-width: 640px) {
          .lbox-arrow { width: 42px; height: 42px; font-size: 24px; }
          .lbox-arrow.prev { left: 8px; }
          .lbox-arrow.next { right: 8px; }
        }
        .lightbox-info { text-align: center; margin-top: 16px; }
        .lightbox-suit {
          font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
          color: var(--suit-color); margin-bottom: 6px;
          display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .lbox-counter {
          font-size: 10px; letter-spacing: 1px;
          color: rgba(255,255,255,.35);
          padding-left: 10px; border-left: 1px solid rgba(255,255,255,.12);
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
          scrollbar-color: rgba(201,169,110,.4) transparent;
        }
        .lightbox-versions::-webkit-scrollbar { height: 8px; }
        .lightbox-versions::-webkit-scrollbar-track { background: transparent; }
        .lightbox-versions::-webkit-scrollbar-thumb {
          border-radius: 999px;
          border: 2px solid transparent;
          background-clip: padding-box;
          background-color: rgba(201,169,110,.35);
        }
        .lightbox-versions::-webkit-scrollbar-thumb:hover {
          background-color: rgba(201,169,110,.6);
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
      `}</style>
    </div>
  );
}
