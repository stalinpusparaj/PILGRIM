/**
 * Dialogue files: `content/dialogue/<file>.json`, one lazy chunk per file (import.meta.glob), parsed and cached.
 * In dev builds every graph is also validated (dialogue-rules.ts) and problems are logged once per file;
 * `tools/validate-dialogue.mjs` runs the full check (both languages) at build time.
 */
import { i18n } from '../core/I18n';
import { GIFT_IDS } from '../core/GameState';
import { ANIM_NAMES } from '../gen/anim';
import { EXPRESSIONS } from '../gen/CharacterFactory';
import { parseDialogueFile } from './dialogue-parse';
import { graphFileId, validateGraph } from './dialogue-rules';
import type { DialogueGraph, Mood } from './DialogueTypes';

const FILES = import.meta.glob<unknown>('/content/dialogue/*.json', { import: 'default' });
/** Every babble mood (a Record, so a new Mood in src/audio/types.ts is a compile error here until added). */
const MOOD_SET: Readonly<Record<Mood, true>> = {
  neutral: true,
  sad: true,
  excited: true,
  scared: true,
  angry: true,
  sleepy: true,
};
const MOODS = Object.keys(MOOD_SET);

const byFile = new Map<string, Promise<Map<string, DialogueGraph>>>();
const loaded = new Map<string, DialogueGraph>();

function fileIdOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
}

/** Ids of every dialogue file ('test', 'ch01'...). */
export function dialogueFileIds(): string[] {
  return Object.keys(FILES).map(fileIdOf).sort();
}

/**
 * Loads (once) and parses `content/dialogue/<fileId>.json`. Resolves to its graphs by id. Rejects for an unknown
 * file. Malformed entries are dropped with a warning; the rest still play.
 */
export function loadDialogues(fileId: string): Promise<Map<string, DialogueGraph>> {
  let p = byFile.get(fileId);
  if (!p) {
    const importer = FILES[`/content/dialogue/${fileId}.json`];
    if (!importer) return Promise.reject(new Error(`[dialogue] no dialogue file "${fileId}.json"`));
    p = importer().then((raw) => register(fileId, raw));
    // A failed import may be retried later (a flaky network on a lazy chunk).
    p.catch(() => byFile.delete(fileId));
    byFile.set(fileId, p);
  }
  return p;
}

/** A graph by id, loading its file (the id's prefix: 'ch01_evangelist' → ch01.json). Null when unknown. */
export async function findDialogue(id: string): Promise<DialogueGraph | null> {
  const known = loaded.get(id);
  if (known) return known;
  const file = graphFileId(id);
  if (!file || !FILES[`/content/dialogue/${file}.json`]) return null;
  try {
    return (await loadDialogues(file)).get(id) ?? null;
  } catch (err) {
    console.error(`[dialogue] could not load ${file}.json`, err);
    return null;
  }
}

/** A graph from an already loaded file, or null. */
export function peekDialogue(id: string): DialogueGraph | null {
  return loaded.get(id) ?? null;
}

function register(fileId: string, raw: unknown): Map<string, DialogueGraph> {
  const { graphs, problems } = parseDialogueFile(raw, fileId);
  if (import.meta.env.DEV) {
    for (const g of graphs) {
      problems.push(
        ...validateGraph(g, (k) => i18n.has(k), {
          anims: ANIM_NAMES,
          expressions: EXPRESSIONS,
          moods: MOODS,
          gifts: GIFT_IDS,
        }),
      );
    }
  }
  if (problems.length) console.warn(`[dialogue] ${fileId}.json:\n  ${problems.join('\n  ')}`);
  const map = new Map<string, DialogueGraph>();
  for (const g of graphs) {
    if (!g.nodes.length) continue;
    map.set(g.id, g);
    loaded.set(g.id, g);
  }
  return map;
}
