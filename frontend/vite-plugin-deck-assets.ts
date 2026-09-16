import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

// Indexes frontend/public/tarot-images/decks/ at dev/build time and hands the app
// a plain listing of URLs.
//
// Why not `import.meta.glob('../../public/...')`? Files under public/ are copied
// verbatim and served at the root path, so globbing them makes Vite ALSO emit a
// hashed copy of every PNG into dist/assets/ — ~360MB of duplicate art next to
// the ~450MB public copy — and it logs one "assets in the public directory are
// served at the root path" warning per file (218 of them on every dev start).
// deck.json was worse: a non-`?url` glob over public/ is a hard error
// ("cannot be imported from JavaScript"), so the offline deck names never loaded.
//
// URLs under public/ are deterministic (`/tarot-images/...`), so all the app ever
// needed from the glob was the file list. That's what this provides.

const DECKS_REL = 'tarot-images/decks';

export interface DeckAssetsIndex {
  /** `/tarot-images/decks/<deck>/<suit>/<file>.png` → same string (the served URL) */
  pngs: Record<string, string>;
  /** same, for `.thumb.webp` */
  thumbs: Record<string, string>;
  /** `/tarot-images/decks/<deck>/deck.json` → parsed contents */
  metas: Record<string, unknown>;
}

function scan(publicDir: string): DeckAssetsIndex {
  const root = path.join(publicDir, DECKS_REL);
  const index: DeckAssetsIndex = { pngs: {}, thumbs: {}, metas: {} };
  if (!fs.existsSync(root)) return index;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      // POSIX-style, rooted at the public dir — exactly how the browser requests it
      const url = '/' + path.relative(publicDir, abs).split(path.sep).join('/');
      if (entry.name.endsWith('.thumb.webp')) index.thumbs[url] = url;
      else if (entry.name.endsWith('.png')) index.pngs[url] = url;
      else if (entry.name === 'deck.json') {
        try {
          index.metas[url] = JSON.parse(fs.readFileSync(abs, 'utf-8'));
        } catch (e) {
          console.warn(`[deck-assets] skipping unparsable ${url}: ${e}`);
        }
      }
    }
  };
  walk(root);
  return index;
}

const VIRTUAL_ID = 'virtual:deck-assets';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

export default function deckAssets(): Plugin {
  let publicDir = '';
  return {
    name: 'deck-assets',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const index = scan(publicDir);
      return [
        `export const pngs = ${JSON.stringify(index.pngs)};`,
        `export const thumbs = ${JSON.stringify(index.thumbs)};`,
        `export const metas = ${JSON.stringify(index.metas)};`,
      ].join('\n');
    },
    // Adding/removing deck art during `npm run dev` re-indexes on the next reload.
    configureServer(server) {
      const root = path.join(publicDir, DECKS_REL);
      server.watcher.add(root);
      const invalidate = (file: string) => {
        if (!file.startsWith(root)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('unlink', invalidate);
      server.watcher.on('change', invalidate);
    },
  };
}
