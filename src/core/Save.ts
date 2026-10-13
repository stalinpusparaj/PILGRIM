/**
 * Save games (GDD 2.15 "Save format"): 3 manual slots plus the autosave written at waystones, kept in
 * IndexedDB through `idb.ts` (which falls back to memory when IndexedDB is unavailable).
 *
 * Everything read back goes through `migrate()`, which knows every save version we ever shipped, upgrades old
 * ones step by step, validates every field and returns null for anything it cannot trust.
 *
 * The module creates the `save` singleton and registers it as the `save` service on import.
 */
import { events } from './Events';
import { services } from './Services';
import * as idb from './idb';

export interface SaveData {
  version: 1;
  /** 1..13, and 14 for the epilogue. */
  chapter: number;
  /** Waystone id to respawn at, e.g. "ch07_w2"; "" = chapter start. */
  waystone: string;
  /** Name given to the scribe in Chapter V (may be empty). */
  playerName: string;
  hasRoll: boolean;
  burden: boolean;
  gifts: string[];
  carried: string[];
  /** 0..100 */
  hope: number;
  promises: string[];
  promisesReadThisChapter: string[];
  detours: string[];
  flags: Record<string, boolean | number | string>;
  achievements: string[];
  playtimeSec: number;
  /** Epoch ms of the last write, for the slot list and CONTINUE. Stamped by `Save.write()`. */
  savedAt: number;
}

export type SlotId = 'slot1' | 'slot2' | 'slot3' | 'auto';

export const SAVE_VERSION = 1;
export const SLOT_IDS: readonly SlotId[] = ['slot1', 'slot2', 'slot3', 'auto'];
/** Chapter number used for the epilogue. */
export const EPILOGUE_CHAPTER = 14;

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_LIST = 256;
const MAX_FLAGS = 512;
const MAX_FLAG_TEXT = 256;
const MAX_NAME_CHARS = 32;
const HOPE_MAX = 100;

/** A fresh game: Chapter I, burdened, full lantern. */
export function newSave(): SaveData {
  return {
    version: SAVE_VERSION,
    chapter: 1,
    waystone: '',
    playerName: '',
    hasRoll: false,
    burden: true,
    gifts: [],
    carried: [],
    hope: HOPE_MAX,
    promises: [],
    promisesReadThisChapter: [],
    detours: [],
    flags: {},
    achievements: [],
    playtimeSec: 0,
    savedAt: 0,
  };
}

/**
 * Turns stored data of any version into a valid current SaveData, or null.
 * - no version / not an object (legacy or foreign data) → null
 * - a version newer than this build understands → null (never guess at future formats)
 * - known versions are upgraded one step at a time, then validated field by field.
 */
export function migrate(raw: unknown): SaveData | null {
  if (!isRecord(raw)) return null;
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) return null;

  switch (version) {
    // Future versions: add `case 1: raw = upgradeV1toV2(raw); // falls through` above the current one,
    // bump SAVE_VERSION and the `version` type, and validate the newest shape at the end.
    case 1:
      return validateV1(raw);
    default:
      return null;
  }
}

export class Save {
  /** The slot's save, migrated and validated; null when empty, unreadable or from a newer build. */
  async load(slot: SlotId): Promise<SaveData | null> {
    assertSlot(slot);
    try {
      return migrate(await idb.get(slot));
    } catch (err) {
      console.warn(`[save] could not load ${slot}`, err);
      return null;
    }
  }

  /** Writes a validated copy stamped with `savedAt = Date.now()`, then emits `save:written`. */
  async write(slot: SlotId, data: SaveData): Promise<void> {
    assertSlot(slot);
    const record = migrate({ ...data, savedAt: Date.now() });
    if (!record) throw new Error(`[save] refusing to write invalid save data to ${slot}`);
    if (import.meta.env.DEV) warnCorrected(slot, data, record);
    await idb.put(slot, record);
    events.emit('save:written', { slot });
  }

  async remove(slot: SlotId): Promise<void> {
    assertSlot(slot);
    await idb.del(slot);
  }

  /** Every slot that holds a valid save, in slot order (slot1, slot2, slot3, auto). */
  async list(): Promise<Array<{ slot: SlotId; data: SaveData }>> {
    const loaded = await Promise.all(SLOT_IDS.map(async (slot) => ({ slot, data: await this.load(slot) })));
    return loaded.filter((e): e is { slot: SlotId; data: SaveData } => e.data !== null);
  }

  /** The most recently written save across all slots (for CONTINUE), or null when there is none. */
  async latest(): Promise<SaveData | null> {
    let best: SaveData | null = null;
    for (const { data } of await this.list()) {
      if (!best || data.savedAt > best.savedAt) best = data;
    }
    return best;
  }

  /** False when saves are only kept in memory this session (private mode); the UI may say so. */
  get persistent(): boolean {
    return idb.isPersistent();
  }
}

// ------------------------------------------------------------------------------------------- v1 validation

function validateV1(raw: Record<string, unknown>): SaveData {
  const d = newSave();
  return {
    version: 1,
    chapter: int(raw.chapter, d.chapter, 1, EPILOGUE_CHAPTER),
    waystone: raw.waystone === '' ? '' : id(raw.waystone, d.waystone),
    playerName: playerName(raw.playerName),
    hasRoll: bool(raw.hasRoll, d.hasRoll),
    burden: bool(raw.burden, d.burden),
    gifts: idList(raw.gifts),
    carried: idList(raw.carried),
    hope: num(raw.hope, d.hope, 0, HOPE_MAX),
    promises: idList(raw.promises),
    promisesReadThisChapter: idList(raw.promisesReadThisChapter),
    detours: idList(raw.detours),
    flags: flags(raw.flags),
    achievements: idList(raw.achievements),
    playtimeSec: num(raw.playtimeSec, d.playtimeSec, 0, Number.MAX_SAFE_INTEGER),
    savedAt: num(raw.savedAt, d.savedAt, 0, Number.MAX_SAFE_INTEGER),
  };
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v) && v !== '__proto__';
}

function id(v: unknown, fallback: string): string {
  return isId(v) ? v : fallback;
}

/** Distinct, well-formed ids in their original order. */
function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const item of v) {
    if (out.size >= MAX_LIST) break;
    if (isId(item)) out.add(item);
  }
  return [...out];
}

/** Free text typed by the player: no control characters, trimmed, at most MAX_NAME_CHARS code points. */
function playerName(v: unknown): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return Array.from(clean).slice(0, MAX_NAME_CHARS).join('').trim();
}

function flags(v: unknown): SaveData['flags'] {
  const out: SaveData['flags'] = {};
  if (!isRecord(v)) return out;
  let count = 0;
  for (const [key, value] of Object.entries(v)) {
    if (count >= MAX_FLAGS) break;
    if (!isId(key) || !isFlagValue(value)) continue;
    out[key] = value;
    count++;
  }
  return out;
}

function isFlagValue(v: unknown): v is boolean | number | string {
  return (
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.length <= MAX_FLAG_TEXT)
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Dev aid: name the fields that validation had to replace, so bad game state is caught early. */
function warnCorrected(slot: SlotId, given: SaveData, written: SaveData): void {
  const keys = Object.keys(written) as Array<keyof SaveData>;
  const changed = keys.filter(
    (k) => k !== 'savedAt' && JSON.stringify(given[k]) !== JSON.stringify(written[k]),
  );
  if (changed.length > 0) console.warn(`[save] ${slot}: invalid values replaced in ${changed.join(', ')}`);
}

function assertSlot(slot: SlotId): void {
  if (!SLOT_IDS.includes(slot)) throw new Error(`[save] unknown slot "${String(slot)}"`);
}

declare module './Events' {
  interface EventMap {
    'save:written': { slot: SlotId };
  }
}

declare module './Services' {
  interface ServiceMap {
    save: Save;
  }
}

export const save = new Save();
services.register('save', save);
