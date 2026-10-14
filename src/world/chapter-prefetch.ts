/**
 * Script loading and the next chapter's background fetch (ARCHITECTURE "Chapters"). When the player reads the
 * last waystone of a chapter the ChapterManager calls `prefetch(nextKey)`: the next script's chunk, its level
 * file chunk (parsed once, so a broken file shows up in the console early) and its dialogue file chunk
 * (`content/dialogue/<levelFileId>.json`) are fetched while the player walks to the chapter's end, so the next
 * chapter starts without network waits. Only code and JSON chunks are fetched: no GPU memory is held (the World
 * is built when the chapter starts; see DECISIONS for the deferred World pre-build).
 */
import { CHAPTERS, hasChapter } from '../chapters/index';
import type { ChapterScript } from '../chapters/types';
import { dialogueFileIds, loadDialogues } from '../narrative/Dialogue';
import { levelFileId, loadLevel } from './LevelLoader';

export class ChapterScripts {
  private readonly scripts = new Map<string, Promise<ChapterScript>>();
  private readonly fetched = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();

  /** The script for registry key `key` (cached). Rejects for an unknown key. */
  load(key: string): Promise<ChapterScript> {
    let p = this.scripts.get(key);
    if (!p) {
      const loader = hasChapter(key) ? CHAPTERS[key] : undefined;
      if (!loader) return Promise.reject(new Error(`[chapters] there is no chapter script "${key}"`));
      p = loader().then((m) => m.default);
      p.catch(() => this.scripts.delete(key));
      this.scripts.set(key, p);
    }
    return p;
  }

  /** Keys whose script, level and dialogue were fetched in the background (probe, tests). */
  get prefetched(): string[] {
    return [...this.fetched];
  }

  /** Fetches the script, level file and dialogue file of `key` in the background (once). */
  prefetch(key: string): Promise<void> {
    if (!hasChapter(key)) return Promise.resolve();
    const have = this.running.get(key);
    if (have) return have;
    const run = this.load(key)
      .then(async (script) => {
        const fileId = levelFileId(script.level);
        await loadLevel(script.level);
        if (dialogueFileIds().includes(fileId)) await loadDialogues(fileId);
        this.fetched.add(key);
      })
      .catch((err: unknown) => {
        this.running.delete(key); // try again when the chapter starts for real
        console.error(`[chapters] background fetch of chapter "${key}" failed`, err);
      });
    this.running.set(key, run);
    return run;
  }
}
