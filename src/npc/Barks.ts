/**
 * Companion barks (GDD 2.8): short speech bubbles on triggers — low Hope, a Promise nearby, a detour entered,
 * the player idle for 20 s — at most one automatic bark per 20 s. Lines are i18n keys; the generic set
 * (`bark.generic.*`, content/i18n/fragments/npc.*.json) is used for any kind a companion does not override.
 */
import type { Mood } from '../audio/types';

/** i18n keys per trigger. `cheer` lines go with the automatic +10 Hope (GDD 2.7.2). */
export interface BarkSet {
  lowHope?: string[];
  promiseNear?: string[];
  promiseFound?: string[];
  detour?: string[];
  idle?: string[];
  cheer?: string[];
}

export type BarkKind = keyof BarkSet;

/** Seconds between automatic barks (GDD 2.8). */
export const BARK_INTERVAL = 20;
/** Low Hope (GDD 2.7.2) and the companion's cheer: +10 Hope when a friend is within 6 m. */
export const BARK_LOW_HOPE = 30;
export const CHEER_HOPE = 10;
export const CHEER_RANGE = 6;
/** A Promise this close to the player (m) gets pointed out (once per Promise). */
export const PROMISE_RANGE = 8;
/** Seconds the player stands still before the idle bark. */
export const IDLE_AFTER = 20;

const generic = (kind: string, count = 3): string[] =>
  Array.from({ length: count }, (_, i) => `bark.generic.${kind}.${i + 1}`);

export const DEFAULT_BARKS: Readonly<Required<BarkSet>> = {
  lowHope: generic('lowHope', 5),
  cheer: generic('cheer', 5),
  promiseNear: generic('promise', 5),
  promiseFound: generic('promiseFound', 3),
  detour: generic('detour', 3),
  idle: generic('idle', 5),
};

export const BARK_MOOD: Readonly<Record<BarkKind, Mood>> = {
  lowHope: 'sad',
  cheer: 'excited',
  promiseNear: 'excited',
  promiseFound: 'excited',
  detour: 'scared',
  idle: 'neutral',
};

/** The companion's lines with the generic ones filling any kind left out (or left empty). */
export function withDefaults(set: BarkSet | undefined): Required<BarkSet> {
  const pick = (k: BarkKind): string[] => {
    const own = set?.[k];
    return own && own.length > 0 ? [...own] : [...DEFAULT_BARKS[k]];
  };
  return {
    lowHope: pick('lowHope'),
    cheer: pick('cheer'),
    promiseNear: pick('promiseNear'),
    promiseFound: pick('promiseFound'),
    detour: pick('detour'),
    idle: pick('idle'),
  };
}

/** Cycles through each kind's lines (a random start, then in order: no line twice in a row). */
export class BarkPicker {
  private readonly next: Record<BarkKind, number> = {
    lowHope: -1,
    cheer: -1,
    promiseNear: -1,
    promiseFound: -1,
    detour: -1,
    idle: -1,
  };
  private readonly set: Required<BarkSet>;
  private readonly rand: () => number;

  constructor(set: Required<BarkSet>, rand: () => number = Math.random) {
    this.set = set;
    this.rand = rand;
  }

  pick(kind: BarkKind): string | null {
    const lines = this.set[kind];
    if (lines.length === 0) return null;
    let i = this.next[kind];
    if (i < 0) i = Math.floor(this.rand() * lines.length);
    i %= lines.length;
    this.next[kind] = i + 1;
    return lines[i] ?? null;
  }
}

/** The 20 s rule for automatic barks (seconds of game time). */
export class BarkClock {
  private since = Infinity;

  tick(dt: number): void {
    this.since += dt;
  }

  get ready(): boolean {
    return this.since >= BARK_INTERVAL;
  }

  get sinceLast(): number {
    return this.since;
  }

  mark(): void {
    this.since = 0;
  }
}
