# Tarot images

```
tarot-images/
├── card-back.png      shared UI assets (used by the chat app)
├── card-back2.svg
├── placeholder2.svg
└── decks/
    └── <deck-id>/                a single tarot deck (one art style, 78 cards)
        ├── deck.json             deck metadata (see below)
        ├── major/                22 Major Arcana
        ├── cups/  wands/         14 each of the four Minor suits
        ├── swords/ pentacles/
        └── …
```

The `/showcase` page discovers everything under `decks/` from two sources:

1. **Build-time fallback** — Vite globs these files at build time, so the gallery
   always renders the decks that existed at build, **even if the backend is down**.
2. **Runtime manifest** — on load it also fetches `GET /api/decks/manifest`, which
   rescans this folder on every request. When reachable it replaces the fallback
   and picks up decks added *after* the build (no rebuild needed — use the
   **Refresh** button to rescan without reloading).

Only **deck rename** requires the backend; if it's offline the gallery still works
and rename is simply disabled. There is **no hardcoded file list** in either path.

> Serving note: in dev, Vite serves these files directly from `public/`, so new
> decks are truly live. In a production build, Vite copies `public/` into
> `dist/` at build time — for new decks to appear without a rebuild, the host
> must serve `/tarot-images/...` from this live `public/` dir (not the built
> `dist/` copy).

## Adding a deck

Drop a new folder under `decks/` containing the suit subfolders. A `deck.json`
is **optional**: without one, the deck shows up with a name auto-derived from the
folder (`classic-rws` → "Classic Rws"). You can then rename it right on the
`/showcase` page (✎ Rename) — the new name is written back to `deck.json`.
No code changes required.

```jsonc
// decks/<deck-id>/deck.json
{
  "id": "classic-rws",                 // must match the folder name
  "name": "Classic Rider–Waite",       // shown in the deck switcher + labels
  "artist": "",                         // optional
  "style": "Short description of the art style",
  "accent": "#C9A96E",                 // optional accent colour (hex)
  "order": 1                            // optional sort order in the switcher
}
```

## Naming cards

- One file per card, named after the card in **kebab-case**:
  `cups/ace-of-cups.png`, `major/the-high-priestess.png`, `major/justice.png`.
- Matching is case/spacing-insensitive and tolerates a 1-character typo, so a
  slightly-off name still lands on the right card — but never on a *different*
  card.
- Cards line up across decks automatically: the same card name in two decks is
  treated as the same position, which is what powers cross-deck preview.

## Multiple versions of one card

When a card has more than one take (e.g. the designer kept two), add the extra
ones with a `__<variant>` suffix on the same base name:

```
major/justice.png                      ← primary
major/justice__alt.png                 ← alternate version
pentacles/nine-of-pentacles.png        ← primary
pentacles/nine-of-pentacles__backup.png
```

The file **without** a `__` suffix is the primary shown in the grid. All
versions (within a deck and across decks) appear in the preview's version strip,
where each is labelled **by its deck only** — the `__alt` / `__backup` suffix is
just a way to keep two files apart on disk and is never shown in the UI.

> Note: the chat app (`src/config/tarotCards.ts`) uses its own separate image
> scheme and is unrelated to the `decks/` structure above.
