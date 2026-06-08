// Single source of truth for the browsable card set shown in the store.
//
// classic-rws is the only deck with real art, and its files are uneven (mixed
// names, __alt/__backup variants, an incomplete 78). We glob the *primary*
// thumbnails (+ full PNGs for the zoom view), drop variants, and order them
// canonically. Placeholder store decks reuse this same set under their accent
// duotone — so "browse all cards" works with zero new image assets.

export interface CardImage {
  id: string;        // `${suit}/${stem}` — unique
  name: string;      // display name, e.g. "The High Priestess"
  suit: string;      // major | cups | wands | swords | pentacles
  thumbUrl: string;  // ~400px webp for the grid
  fullUrl: string;   // original PNG for the zoom lightbox (falls back to thumb)
}

const SUIT_ORDER = ['major', 'cups', 'wands', 'swords', 'pentacles'];
const RANK = ['ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'page', 'knight', 'queen', 'king'];
const MAJOR_ORDER = [
  'the-fool', 'the-magician', 'the-high-priestess', 'the-empress', 'the-emperor',
  'the-hierophant', 'the-lovers', 'the-chariot', 'strength', 'the-hermit',
  'wheel-of-fortune', 'justice', 'the-hanged-man', 'death', 'temperance',
  'the-devil', 'the-tower', 'the-star', 'the-moon', 'the-sun', 'judgement', 'the-world',
];

const thumbGlob = import.meta.glob(
  '../../public/tarot-images/decks/classic-rws/**/*.thumb.webp',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>;

const fullGlob = import.meta.glob(
  '../../public/tarot-images/decks/classic-rws/**/*.png',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>;

function prettify(stem: string): string {
  return stem
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\bOf\b/g, 'of');
}

function rank(suit: string, stem: string): number {
  const s = SUIT_ORDER.indexOf(suit);
  let within: number;
  if (suit === 'major') within = MAJOR_ORDER.indexOf(stem);
  else within = RANK.findIndex((r) => stem.startsWith(`${r}-`));
  if (within < 0) within = 99;
  return s * 100 + within;
}

// suit/stem → full PNG url, so each thumb can pair with its original
const fullByKey = new Map<string, string>();
for (const [path, url] of Object.entries(fullGlob)) {
  const m = path.match(/classic-rws\/([^/]+)\/(.+)\.png$/i);
  if (!m) continue;
  const [, suit, stem] = m;
  if (stem.includes('__')) continue;
  fullByKey.set(`${suit}/${stem}`, url);
}

export const ALL_CARD_IMAGES: CardImage[] = Object.entries(thumbGlob)
  .map(([path, thumbUrl]) => {
    const m = path.match(/classic-rws\/([^/]+)\/(.+)\.thumb\.webp$/i);
    if (!m) return null;
    const [, suit, stem] = m;
    if (stem.includes('__') || !SUIT_ORDER.includes(suit)) return null;
    const key = `${suit}/${stem}`;
    return {
      id: key,
      name: prettify(stem),
      suit,
      thumbUrl,
      fullUrl: fullByKey.get(key) ?? thumbUrl,
    } as CardImage;
  })
  .filter((c): c is CardImage => c !== null)
  .sort((a, b) => rank(a.suit, a.id.split('/')[1]) - rank(b.suit, b.id.split('/')[1]));
