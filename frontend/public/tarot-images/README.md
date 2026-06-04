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

The `/showcase` page auto-discovers everything under `decks/` at build time
(via Vite `import.meta.glob`). There is **no hardcoded file list** — adding or
removing files just works after a rebuild.

## Adding a deck

Drop a new folder under `decks/` containing a `deck.json` and the suit
subfolders. No code changes required.

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
versions (within a deck and across decks) appear in the preview's version strip.

> Note: the chat app (`src/config/tarotCards.ts`) uses its own separate image
> scheme and is unrelated to the `decks/` structure above.
