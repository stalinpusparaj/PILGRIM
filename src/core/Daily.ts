/**
 * Coming back each day (DECISIONS #403), gently: nothing is ever lost by missing a day (GDD 2.2 "Grace, not grind",
 * Google Play Families: no pressure, no notifications).
 *  - Pilgrim's Path: each day the game is opened lights the next of 7 stones; a full path gives a lantern colour
 *    and starts a new path. Missing days only waits.
 *  - A little quest per day (from the second day on): done, today's stone turns gold.
 *  - The map (src/ui/Minimap.ts): 3 looks a day without the full journey, any time with it.
 *  - Welcome back: the first chapter of a new day opens with a companion's (or a toast's) greeting.
 * The first day a player ever opens the game is already full of new things: the Morning Manna card, the quest and
 * the greeting start the next day. State lives in localStorage (per device), every access in try/catch.
 */
import { events } from './Events';
import { entitlement } from './Entitlement';
import { services } from './Services';

export const PATH_STONES = 7;
export const FREE_MAP_LOOKS = 3;
const KEY = 'pilgrim.daily.v1';

export type QuestId = 'promise' | 'waystone' | 'talk' | 'jump' | 'read';
/** Each quest: the event that counts and how many it needs. */
export const QUESTS: Readonly<Record<QuestId, { event: 'promise:collected' | 'waystone:read' | 'dialogue:end' | 'player:jump' | 'promise:read'; need: number }>> = {
  promise: { event: 'promise:collected', need: 1 },
  waystone: { event: 'waystone:read', need: 1 },
  talk: { event: 'dialogue:end', need: 3 },
  jump: { event: 'player:jump', need: 10 },
  read: { event: 'promise:read', need: 1 },
};
const QUEST_ORDER: readonly QuestId[] = ['waystone', 'jump', 'promise', 'talk', 'read'];

/** Lantern flame colours (hue turns of the flame and glass); 'gold' is the lantern's own. Gifts come in this order. */
export const LANTERNS: Readonly<Record<string, number>> = {
  gold: 0, rose: -55, sky: 175, mint: 105, violet: -115, dawn: 22, ember: -22,
};
const GIFT_ORDER = ['rose', 'sky', 'mint', 'violet', 'dawn', 'ember'];

export interface DailyQuest { day: string; id: QuestId; n: number; done: boolean }
export interface DailyData {
  v: 1;
  /** The first day the game was opened on this device. */
  first: string;
  last: string;
  /** Days the game was opened, in all. */
  days: number;
  /** Stones lit on the current path (1..7). */
  stones: number;
  /** Stones (0-based) whose day's quest was done. */
  gold: number[];
  gifts: string[];
  lantern: string;
  /** A lantern gift not yet shown on the Morning Manna card. */
  newGift: string;
  quest: DailyQuest | null;
  map: { day: string; n: number };
  cardDay: string;
  welcomeDay: string;
}

declare module './Events' {
  interface EventMap {
    /** Today's quest moved on or was finished. */
    'daily:quest': DailyQuest;
    /** The lantern colour changed (Morning Manna card). */
    'daily:lantern': { id: string };
  }
}

/** Local calendar day, "YYYY-MM-DD". */
export function dayKey(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days since 1970 for a day key (stable picks per day). */
export function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

export function questFor(day: string): QuestId {
  return QUEST_ORDER[dayNumber(day) % QUEST_ORDER.length]!;
}

function fresh(): DailyData {
  return {
    v: 1, first: '', last: '', days: 0, stones: 0, gold: [], gifts: [], lantern: 'gold', newGift: '', quest: null,
    map: { day: '', n: 0 }, cardDay: '', welcomeDay: '',
  };
}

function load(): DailyData {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DailyData> | null;
    if (!raw || raw.v !== 1) return fresh();
    const d = { ...fresh(), ...raw };
    if (!(d.lantern in LANTERNS)) d.lantern = 'gold';
    return d;
  } catch {
    return fresh();
  }
}

let data: DailyData = load();

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode: today's state lives until the page closes */
  }
}

function applyLantern(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--lantern-hue', `${LANTERNS[data.lantern] ?? 0}deg`);
}

export const daily = {
  get data(): Readonly<DailyData> {
    return data;
  },
  /** The first day this device ever opened the game. */
  get newcomer(): boolean {
    return data.first === dayKey();
  },
  /** Counts today's visit (once a day): the next stone, a gift on a full path, today's quest. */
  visit(today = dayKey()): void {
    if (data.last === today) return;
    if (!data.first) data.first = today;
    data.days += 1;
    if (data.stones >= PATH_STONES) {
      data.stones = 0;
      data.gold = [];
    }
    data.stones += 1;
    if (data.stones === PATH_STONES) {
      const gift = GIFT_ORDER.find((g) => !data.gifts.includes(g));
      if (gift) {
        data.gifts.push(gift);
        data.newGift = gift;
      }
    }
    data.quest = data.first === today ? null : { day: today, id: questFor(today), n: 0, done: false };
    data.last = today;
    persist();
  },
  /** The Morning Manna card opens by itself once a day, from the second day on. */
  get cardDue(): boolean {
    return !this.newcomer && data.cardDay !== dayKey();
  },
  markCardShown(): void {
    data.cardDay = dayKey();
    data.newGift = '';
    persist();
  },
  /** Today's quest (null on the first day). */
  get quest(): DailyQuest | null {
    return data.quest && data.quest.day === dayKey() ? data.quest : null;
  },
  /** Map looks left today: Infinity with the full journey (or a build that sells nothing). */
  get mapLeft(): number {
    if (entitlement.owned) return Infinity;
    return Math.max(0, FREE_MAP_LOOKS - (data.map.day === dayKey() ? data.map.n : 0));
  },
  /** Spends one map look; false when none are left today. */
  useMap(): boolean {
    if (entitlement.owned) return true;
    if (this.mapLeft <= 0) return false;
    const today = dayKey();
    data.map = { day: today, n: (data.map.day === today ? data.map.n : 0) + 1 };
    persist();
    return true;
  },
  get lanterns(): string[] {
    return ['gold', ...GIFT_ORDER.filter((g) => data.gifts.includes(g))];
  },
  setLantern(id: string): void {
    if (!this.lanterns.includes(id)) return;
    data.lantern = id;
    persist();
    applyLantern();
    events.emit('daily:lantern', { id });
  },
  /** Tests / debug: forget everything (or start from `next`). */
  reset(next?: Partial<DailyData>): void {
    data = { ...fresh(), ...next };
    persist();
    applyLantern();
  },
};

function step(id: QuestId): void {
  const q = daily.quest;
  if (!q || q.done || q.id !== id) return;
  q.n += 1;
  if (q.n >= QUESTS[id].need) {
    q.done = true;
    const stone = data.stones - 1;
    if (!data.gold.includes(stone)) data.gold.push(stone);
    events.emit('hud:toast', { key: 'ui.daily.questDone' });
    events.emit('sfx', { id: 'joy_note' });
  }
  persist();
  events.emit('daily:quest', q);
}

/** The first chapter started on a new day: a friend says hello (or a toast does). */
function welcome(): void {
  if (daily.newcomer || data.welcomeDay === dayKey()) return;
  data.welcomeDay = dayKey();
  persist();
  window.setTimeout(() => {
    const friend = services.tryGet('chapters')?.context?.companions[0];
    if (friend) friend.bark('ui.daily.welcomeBack');
    else events.emit('hud:toast', { key: 'ui.daily.welcomeBack' });
  }, 4500);
}

/** Boot (main.ts): counts today's visit, follows the quest events, colours the lantern. */
export function installDaily(): () => void {
  daily.visit();
  applyLantern();
  const offs = (Object.keys(QUESTS) as QuestId[]).map((id) => events.on(QUESTS[id].event, () => step(id)));
  offs.push(events.on('hud:chapterCard', welcome));
  return () => offs.forEach((off) => off());
}
