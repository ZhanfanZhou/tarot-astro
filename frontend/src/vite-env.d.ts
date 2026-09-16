/// <reference types="vite/client" />

// Built by vite-plugin-deck-assets.ts — a listing of everything under
// public/tarot-images/decks/. Keys are the served URLs (`/tarot-images/...`).
declare module 'virtual:deck-assets' {
  export const pngs: Record<string, string>;
  export const thumbs: Record<string, string>;
  export const metas: Record<string, any>;
}
