/**
 * The live play session (GDD 2.7): Hope, the Burden, the Roll, gifts, carried items, Promises, detours, flags.
 * One instance per running game, registered as the 'state' service. Every change goes through a method here so
 * the matching event fires; UI (HUD, Satchel) and systems (audio, chapters) listen instead of polling.
 *
 * It wraps a SaveData (GDD 2.15 save format). `snapshot()` returns a detached copy for `Save.write()`.
 * Things the save format has no field for live in `flags` under a prefix:
 *   - `met.<recipeId>` = true          FRIENDS MET (Satchel)
 *   - `goal.<objectiveKey>` = chapter  THE ROLL: goals now and before (Satchel); `goal` = current objective key
 *   - `rollLost` = true                the Roll slipped under the arbour bench (GDD 2.7.4)
 */
import { events } from './Events';
import { services } from './Services';
import { newSave, type SaveData } from './Save';

/** GDD 2.7.6 gift ids (also the i18n keys ui.gift.<id>.name / ui.toast.gift.<id>). */
export type GiftId = 'sword' | 'shield' | 'helmet' | 'breastplate' | 'shoes' | 'prayer' | 'key_promise' | 'looking_glass';
export const GIFT_IDS: readonly GiftId[] = [
  'sword',
  'shield',
  'helmet',
  'breastplate',
  'shoes',
  'prayer',
  'key_promise',
  'looking_glass',
];

/** Total Promises in the game (GDD 2.7.5). */
export const PROMISE_TOTAL = 24;
export const HOPE_MIN = 0;
export const HOPE_MAX = 100;
/** Reading a Promise in the Satchel: +15, once per Promise per chapter (GDD 2.7.2). */
export const PROMISE_READ_HOPE = 15;
/** Waystones set Hope to at least this (GDD 2.7.2) and I SHALL ARISE respawns with it. */
export const HOPE_WAYSTONE_FLOOR = 60;

export type FlagValue = boolean | number | string;

declare module './Events' {
  interface EventMap {
    'state:reset': void;
    'burden:changed': { on: boolean };
    'roll:changed': { has: boolean; lost: boolean };
    'item:given': { id: string };
    'item:taken': { id: string };
    'gift:given': { id: GiftId };
    'promise:collected': { id: string; total: number };
    'promise:read': { id: string; hope: number };
    'flag:changed': { key: string; value: FlagValue | undefined };
    'objective:changed': { key: string | null };
    'friend:met': { id: string };
    'chapter:changed': { chapter: number };
    'achievement:unlocked': { id: string };
    /** HUD requests (src/ui/HUD.ts listens). `key` is an i18n key. */
    'hud:toast': { key: string; params?: Record<string, string | number> };
    'hud:chapterCard': { chapter: number };
    'hud:visible': { on: boolean };
  }
}

declare module './Services' {
  interface ServiceMap {
    state: GameState;
  }
}

function clampHope(v: number): number {
  return Math.min(HOPE_MAX, Math.max(HOPE_MIN, v));
}

function copySave(d: SaveData): SaveData {
  return {
    ...d,
    gifts: [...d.gifts],
    carried: [...d.carried],
    promises: [...d.promises],
    promisesReadThisChapter: [...d.promisesReadThisChapter],
    detours: [...d.detours],
    flags: { ...d.flags },
    achievements: [...d.achievements],
  };
}

export class GameState {
  private d: SaveData;

  constructor(save?: SaveData) {
    this.d = copySave(save ?? newSave());
  }

  /** Read-only view of the live data. Mutate only through the methods below. */
  get data(): Readonly<SaveData> {
    return this.d;
  }

  /** Detached copy for Save.write() (Save stamps savedAt). */
  snapshot(): SaveData {
    return copySave(this.d);
  }

  /** Replace everything (load a save or start a new game). */
  reset(save?: SaveData): void {
    this.d = copySave(save ?? newSave());
    events.emit('state:reset');
  }

  // ------------------------------------------------------------------------------------------- Hope

  get hope(): number {
    return this.d.hope;
  }

  setHope(value: number): void {
    const next = clampHope(value);
    const delta = next - this.d.hope;
    if (delta === 0) return;
    this.d.hope = next;
    events.emit('hope:changed', { value: next, delta });
  }

  addHope(delta: number): void {
    this.setHope(this.d.hope + delta);
  }

  // ----------------------------------------------------------------------------------- Burden, Roll

  get burden(): boolean {
    return this.d.burden;
  }

  setBurden(on: boolean): void {
    if (this.d.burden === on) return;
    this.d.burden = on;
    events.emit('burden:changed', { on });
  }

  get hasRoll(): boolean {
    return this.d.hasRoll && !this.rollLost;
  }

  get rollLost(): boolean {
    return this.d.flags['rollLost'] === true;
  }

  /** Given at the Cross (GDD 2.7.4). */
  giveRoll(): void {
    this.d.hasRoll = true;
    if (!this.d.carried.includes('roll')) this.d.carried.push('roll');
    this.setFlag('rollLost', undefined);
    events.emit('roll:changed', { has: true, lost: false });
  }

  /** The arbour nap: the Roll slips under the bench until found again. */
  loseRoll(): void {
    if (!this.d.hasRoll || this.rollLost) return;
    this.setFlag('rollLost', true);
    events.emit('roll:changed', { has: false, lost: true });
  }

  findRoll(): void {
    if (!this.rollLost) return;
    this.setFlag('rollLost', undefined);
    events.emit('roll:changed', { has: true, lost: false });
  }

  // ----------------------------------------------------------------------------- Items and gifts

  has(id: string): boolean {
    return this.d.carried.includes(id) || (this.d.gifts as string[]).includes(id);
  }

  give(id: string): void {
    if (this.d.carried.includes(id)) return;
    this.d.carried.push(id);
    events.emit('item:given', { id });
  }

  take(id: string): void {
    const i = this.d.carried.indexOf(id);
    if (i < 0) return;
    this.d.carried.splice(i, 1);
    events.emit('item:taken', { id });
  }

  hasGift(id: GiftId): boolean {
    return this.d.gifts.includes(id);
  }

  /**
   * GDD 2.7.6. The Key of Promise is a gift that is also a carried item (Satchel > CARRIED). It arrives quietly
   * at the Cross: pass `quiet` so no toast is requested.
   */
  giveGift(id: GiftId, quiet = false): void {
    if (this.d.gifts.includes(id)) return;
    this.d.gifts.push(id);
    if (id === 'key_promise' && !this.d.carried.includes(id)) this.d.carried.push(id);
    events.emit('gift:given', { id });
    if (!quiet) events.emit('hud:toast', { key: `ui.toast.gift.${id}` });
  }

  // ------------------------------------------------------------------------------------- Promises

  hasPromise(id: string): boolean {
    return this.d.promises.includes(id);
  }

  /** Returns true when this Promise is new. */
  collectPromise(id: string): boolean {
    if (this.d.promises.includes(id)) return false;
    this.d.promises.push(id);
    events.emit('promise:collected', { id, total: this.d.promises.length });
    return true;
  }

  readThisChapter(id: string): boolean {
    return this.d.promisesReadThisChapter.includes(id);
  }

  /** Reading a collected Promise in the Satchel: +15 Hope once per chapter. Returns the Hope gained. */
  readPromise(id: string): number {
    if (!this.d.promises.includes(id)) return 0;
    const fresh = !this.d.promisesReadThisChapter.includes(id);
    if (fresh) {
      this.d.promisesReadThisChapter.push(id);
      this.addHope(PROMISE_READ_HOPE);
    }
    const gained = fresh ? PROMISE_READ_HOPE : 0;
    events.emit('promise:read', { id, hope: gained });
    return gained;
  }

  // -------------------------------------------------------------------------------------- Detours

  /** Records a detour taken (GDD 2.7.8: red on the Satchel map, counted in the footer). */
  enterDetour(id: string): void {
    const fresh = !this.d.detours.includes(id);
    if (fresh) this.d.detours.push(id);
    events.emit('detour:entered', { id });
  }

  // ---------------------------------------------------------------------------------------- Flags

  flag(key: string): FlagValue | undefined {
    return this.d.flags[key];
  }

  setFlag(key: string, value: FlagValue | undefined): void {
    if (this.d.flags[key] === value) return;
    if (value === undefined) delete this.d.flags[key];
    else this.d.flags[key] = value;
    events.emit('flag:changed', { key, value });
  }

  /** FRIENDS MET in the Satchel. */
  meet(recipeId: string): void {
    if (this.d.flags[`met.${recipeId}`] === true) return;
    this.setFlag(`met.${recipeId}`, true);
    events.emit('friend:met', { id: recipeId });
  }

  friendsMet(): string[] {
    return Object.keys(this.d.flags)
      .filter((k) => k.startsWith('met.') && this.d.flags[k] === true)
      .map((k) => k.slice(4));
  }

  /** Current objective (an i18n key such as ui.hud.objective.followLight), remembered for THE ROLL tab. */
  get objective(): string | null {
    const g = this.d.flags['goal'];
    return typeof g === 'string' ? g : null;
  }

  setObjective(key: string | null): void {
    if (this.objective === key) return;
    this.setFlag('goal', key ?? undefined);
    if (key) this.setFlag(`goal.${key}`, this.d.chapter);
    events.emit('objective:changed', { key });
  }

  /** Every objective seen so far with the chapter it belonged to, oldest first (insertion order). */
  objectiveHistory(): Array<{ key: string; chapter: number }> {
    return Object.entries(this.d.flags)
      .filter(([k, v]) => k.startsWith('goal.') && typeof v === 'number')
      .map(([k, v]) => ({ key: k.slice(5), chapter: v as number }));
  }

  // -------------------------------------------------------------------------- Chapter, waystone

  get chapter(): number {
    return this.d.chapter;
  }

  /** Entering a chapter: Promise reads reset (GDD 2.7.2 "once per Promise per chapter"). */
  setChapter(chapter: number): void {
    this.d.promisesReadThisChapter = [];
    if (this.d.chapter === chapter) return;
    this.d.chapter = chapter;
    this.d.waystone = '';
    events.emit('chapter:changed', { chapter });
  }

  get waystone(): string {
    return this.d.waystone;
  }

  setWaystone(id: string): void {
    this.d.waystone = id;
  }

  get playerName(): string {
    return this.d.playerName;
  }

  setPlayerName(name: string): void {
    this.d.playerName = name;
  }

  // ------------------------------------------------------------------------------ Achievements

  unlock(id: string): void {
    if (this.d.achievements.includes(id)) return;
    this.d.achievements.push(id);
    events.emit('achievement:unlocked', { id });
  }

  /** Called by the game loop while playing (not paused). */
  tickPlaytime(dt: number): void {
    this.d.playtimeSec += dt;
  }
}

/** Creates the session state and registers it as the 'state' service. */
export function createGameState(save?: SaveData): GameState {
  const s = new GameState(save);
  services.register('state', s);
  return s;
}
