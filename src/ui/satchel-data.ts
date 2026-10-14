/**
 * Content catalogues for MY SATCHEL, read from `content/promises.json` and `content/friends.json` (bundled by
 * static import, validated once on load so a typo in the JSON is a readable error instead of a broken card).
 *
 * PROMISES (GDD 2.7.5): exactly 24, ids p01..p24, 1-3 per chapter (Chapter VII has 4, one from each sister of
 * Palace Beautiful). `text` and `refKey` are i18n keys: English holds the exact King James wording (excerpts
 * marked with "..."), Tamil holds a game-written comfort line and the reference with the Tamil book name
 * (GDD 2.16 rule 6: no Tamil scripture text). Level files place Promises with these same ids.
 *
 * FRIENDS (GDD 2.8 "Satchel > FRIENDS MET"): one card per named character, keyed by id; `aliases` are the recipe
 * ids GameState.meet() may be called with (son_1..son_4 → sons). Apollyon is deliberately absent.
 */
import promisesJson from '../../content/promises.json';
import friendsJson from '../../content/friends.json';

export interface PromiseDef {
  id: string;
  /** 1..13 (GDD 2.10). */
  chapter: number;
  /** English KJV reference, e.g. "Psalm 23:1" (data; the screen shows `refKey`). */
  ref: string;
  /** i18n key of the line. */
  text: string;
  /** i18n key of the reference as shown (Tamil book names in ta). */
  refKey: string;
  /** The English line is part of a verse (marked with "..."). */
  excerpt: boolean;
  /** Chapter VII: which sister gives it. */
  from?: string;
}

export interface FriendDef {
  id: string;
  /** i18n keys. */
  name: string;
  line: string;
  /** Character recipe used for the portrait. */
  recipe: string;
  aliases: readonly string[];
  /** Badge colour when no portrait is available (GDD 2.11 signature colour). */
  color: string;
  /** Portrait expression (GDD 2.11 list). */
  expr: string;
  /** Chapter of the first meeting (14 = epilogue); cards are listed in this order. */
  chapter: number;
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(o: Rec, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0)
    throw new Error(`[satchel] ${where}: "${key}" must be a string`);
  return v;
}

function int(o: Rec, key: string, where: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`[satchel] ${where}: "${key}" must be an integer ${min}-${max}`);
  }
  return v;
}

export function parsePromises(raw: unknown): PromiseDef[] {
  if (!Array.isArray(raw)) throw new Error('[satchel] promises.json must be an array');
  const seen = new Set<string>();
  return raw.map((item: unknown, i) => {
    const where = `promises.json[${i}]`;
    if (!isRec(item)) throw new Error(`[satchel] ${where} must be an object`);
    const id = str(item, 'id', where);
    if (seen.has(id)) throw new Error(`[satchel] ${where}: duplicate id "${id}"`);
    seen.add(id);
    const from = item['from'];
    return {
      id,
      chapter: int(item, 'chapter', where, 1, 13),
      ref: str(item, 'ref', where),
      text: str(item, 'text', where),
      refKey: str(item, 'refKey', where),
      excerpt: item['excerpt'] === true,
      ...(typeof from === 'string' ? { from } : {}),
    };
  });
}

export function parseFriends(raw: unknown): FriendDef[] {
  if (!Array.isArray(raw)) throw new Error('[satchel] friends.json must be an array');
  return raw.map((item: unknown, i) => {
    const where = `friends.json[${i}]`;
    if (!isRec(item)) throw new Error(`[satchel] ${where} must be an object`);
    const aliases = item['aliases'];
    const color = str(item, 'color', where);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`[satchel] ${where}: bad color "${color}"`);
    return {
      id: str(item, 'id', where),
      name: str(item, 'name', where),
      line: str(item, 'line', where),
      recipe: str(item, 'recipe', where),
      aliases: Array.isArray(aliases) ? aliases.filter((a): a is string => typeof a === 'string') : [],
      color,
      expr: typeof item['expr'] === 'string' ? item['expr'] : 'happy',
      chapter: int(item, 'chapter', where, 1, 14),
    };
  });
}

export const PROMISES: readonly PromiseDef[] = Object.freeze(parsePromises(promisesJson as unknown));
export const FRIENDS: readonly FriendDef[] = Object.freeze(parseFriends(friendsJson as unknown));

const PROMISE_BY_ID = new Map(PROMISES.map((p) => [p.id, p]));
const FRIEND_BY_KEY = new Map<string, FriendDef>();
for (const f of FRIENDS) {
  FRIEND_BY_KEY.set(f.id, f);
  for (const a of f.aliases) if (!FRIEND_BY_KEY.has(a)) FRIEND_BY_KEY.set(a, f);
}

export function promiseById(id: string): PromiseDef | undefined {
  return PROMISE_BY_ID.get(id);
}

/** The card for a met id: its own id, an alias, or the id without a trailing `_<n>` (crowd-style numbering). */
export function friendFor(id: string): FriendDef | undefined {
  return FRIEND_BY_KEY.get(id) ?? FRIEND_BY_KEY.get(id.replace(/_\d+$/, ''));
}

/** Cards for the met ids, one per character, in story order. Unknown ids (villain beasts, crowds) are skipped. */
export function friendsFromMet(met: readonly string[]): FriendDef[] {
  const found = new Set<FriendDef>();
  for (const id of met) {
    const f = friendFor(id);
    if (f) found.add(f);
  }
  return FRIENDS.filter((f) => found.has(f));
}

/** Collected ids that are in the catalogue (the footer's "Promises: n of 24"). */
export function knownPromiseCount(collected: readonly string[]): number {
  let n = 0;
  for (const id of new Set(collected)) if (PROMISE_BY_ID.has(id)) n++;
  return n;
}
