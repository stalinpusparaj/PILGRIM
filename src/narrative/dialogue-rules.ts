/**
 * Dialogue rules shared by the runner and `tools/validate-dialogue.mjs`: the GDD 2.8 limits, the `cond`
 * grammar (see DialogueTypes.ts) and `validateGraph()`.
 *
 * Keep this file free of value imports and of non-erasable TypeScript syntax (no enums, namespaces or parameter
 * properties): Node loads it directly with its built-in type stripping for the validator tool.
 */
import type { DialogueEffects, DialogueGraph, DialogueNode } from './DialogueTypes';

/** GDD 2.8: at most 3 choices for kids. */
export const MAX_CHOICES = 3;
/** GDD 2.8: at most 5 bubbles before the player acts or chooses. */
export const MAX_LINES_IN_A_ROW = 5;
/** The player's speaker id (also the default actor of a choice's `anim` effect). */
export const PLAYER_SPEAKER = 'christian';
/** The camera shot that hands the camera back to the follow rig. */
export const CAM_RELEASE = 'release';

// ------------------------------------------------------------------------------------------------ cond

export type CompareOp = '<' | '<=' | '>' | '>=' | '=';

export type CondTerm =
  | { kind: 'flag'; key: string; value: string | null; not: boolean }
  | { kind: 'hasRoll' | 'burden'; not: boolean }
  | { kind: 'gift' | 'item' | 'detour'; id: string; not: boolean }
  | { kind: 'compare'; stat: 'hope' | 'chapter'; op: CompareOp; n: number; not: boolean };

/** What a condition can read (GameState implements it through dialogue-effects.ts stateReader()). */
export interface CondReader {
  flag(key: string): boolean | number | string | undefined;
  readonly hasRoll: boolean;
  readonly burden: boolean;
  hasGift(id: string): boolean;
  has(id: string): boolean;
  detour(id: string): boolean;
  readonly hope: number;
  readonly chapter: number;
}

const FLAG_KEY = /^[A-Za-z0-9_.-]+$/;
const ID = /^[a-z0-9_]+$/;
const COMPARE = /^(hope|chapter)\s*(<=|>=|<|>|=)\s*(\d+)$/;
const FLAG_EQ = /^([A-Za-z0-9_.-]+)=([^=&!]+)$/;

/** Parses a condition. Returns the terms (all must hold), or a readable error string. */
export function parseCond(cond: string): CondTerm[] | string {
  const parts = cond.split('&').map((p) => p.trim());
  if (!parts.length || parts.some((p) => !p)) return `bad cond "${cond}" (empty term)`;
  const terms: CondTerm[] = [];
  for (const raw of parts) {
    const not = raw.startsWith('!');
    const body = not ? raw.slice(1).trim() : raw;
    const term = parseTerm(body, not);
    if (!term) return `bad cond "${cond}" (term "${raw}")`;
    terms.push(term);
  }
  return terms;
}

function parseTerm(body: string, not: boolean): CondTerm | null {
  if (body === 'hasRoll' || body === 'burden') return { kind: body, not };
  const cmp = COMPARE.exec(body);
  if (cmp)
    return {
      kind: 'compare',
      stat: cmp[1] as 'hope' | 'chapter',
      op: cmp[2] as CompareOp,
      n: Number(cmp[3]),
      not,
    };
  const colon = body.indexOf(':');
  if (colon > 0) {
    const kind = body.slice(0, colon);
    const id = body.slice(colon + 1);
    if ((kind === 'gift' || kind === 'item' || kind === 'detour') && ID.test(id)) return { kind, id, not };
    return null;
  }
  const eq = FLAG_EQ.exec(body);
  if (eq) return { kind: 'flag', key: eq[1], value: eq[2].trim(), not };
  if (FLAG_KEY.test(body)) return { kind: 'flag', key: body, value: null, not };
  return null;
}

const parsed = new Map<string, CondTerm[] | string>();

/** True when `cond` holds (an empty or missing cond always holds; an invalid one never does). */
export function evalCond(cond: string | undefined, r: CondReader): boolean {
  if (cond === undefined || cond.trim() === '') return true;
  let terms = parsed.get(cond);
  if (!terms) {
    terms = parseCond(cond);
    parsed.set(cond, terms);
  }
  if (typeof terms === 'string') return false;
  return terms.every((t) => evalTerm(t, r) !== t.not);
}

function evalTerm(t: CondTerm, r: CondReader): boolean {
  switch (t.kind) {
    case 'hasRoll':
      return r.hasRoll;
    case 'burden':
      return r.burden;
    case 'gift':
      return r.hasGift(t.id);
    case 'item':
      return r.has(t.id);
    case 'detour':
      return r.detour(t.id);
    case 'compare':
      return compare(t.stat === 'hope' ? r.hope : r.chapter, t.op, t.n);
    case 'flag': {
      const v = r.flag(t.key);
      if (t.value !== null) return v !== undefined && String(v) === t.value;
      return v !== undefined && v !== false && v !== 0 && v !== '';
    }
  }
}

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '=':
      return a === b;
  }
}

// ------------------------------------------------------------------------------------------- validation

/** Optional vocabularies for validateGraph(); a missing list skips that check. */
export interface ValidateOptions {
  anims?: readonly string[];
  expressions?: readonly string[];
  moods?: readonly string[];
  sfx?: readonly string[];
  songs?: readonly string[];
  gifts?: readonly string[];
  /** Known speaker ids (the level's NPC ids plus 'christian'). */
  speakers?: readonly string[];
}

/** Every i18n key a graph uses (node lines and choices), in order, without duplicates. */
export function graphKeys(g: DialogueGraph): string[] {
  const keys = new Set<string>();
  for (const n of g.nodes) {
    keys.add(n.text);
    for (const c of n.choices ?? []) keys.add(c.text);
  }
  return [...keys];
}

/** The file a graph id belongs to: 'ch01_evangelist' → 'ch01' (null when the id has no prefix). */
export function graphFileId(id: string): string | null {
  const i = id.indexOf('_');
  return i > 0 ? id.slice(0, i) : null;
}

/**
 * Readable problems with one graph: unknown `next` ids, more than 3 choices, missing i18n keys, bad conds and
 * effects, unreachable nodes, and more than 5 lines in a row before a choice (nodes with a cond count as shown).
 */
export function validateGraph(
  g: DialogueGraph,
  hasKey: (k: string) => boolean,
  opts: ValidateOptions = {},
): string[] {
  const out: string[] = [];
  const at = (n: DialogueNode | null, msg: string): void => {
    out.push(`${g.id}${n ? `/${n.id}` : ''}: ${msg}`);
  };
  if (!g.nodes.length) {
    at(null, 'graph has no nodes');
    return out;
  }
  const ids = new Map<string, DialogueNode>();
  for (const n of g.nodes) {
    if (ids.has(n.id)) at(n, 'duplicate node id');
    ids.set(n.id, n);
  }
  const target = (n: DialogueNode, next: string | undefined, what: string): void => {
    if (next !== undefined && !ids.has(next)) at(n, `${what} goes to unknown node "${next}"`);
    if (next === n.id) at(n, `${what} goes to itself`);
  };
  const key = (n: DialogueNode, k: string): void => {
    if (!hasKey(k)) at(n, `missing i18n key "${k}"`);
  };
  const oneOf = (
    n: DialogueNode,
    v: string | undefined,
    list: readonly string[] | undefined,
    what: string,
  ): void => {
    if (v !== undefined && list && !list.includes(v)) at(n, `unknown ${what} "${v}"`);
  };
  const cond = (n: DialogueNode, c: string | undefined): void => {
    if (c === undefined) return;
    const r = parseCond(c);
    if (typeof r === 'string') at(n, r);
    else for (const t of r) if (t.kind === 'gift') oneOf(n, t.id, opts.gifts, 'gift');
  };

  for (const n of g.nodes) {
    key(n, n.text);
    oneOf(n, n.speaker, opts.speakers, 'speaker');
    oneOf(n, n.anim, opts.anims, 'anim');
    oneOf(n, n.expr, opts.expressions, 'expr');
    oneOf(n, n.mood, opts.moods, 'mood');
    cond(n, n.cond);
    target(n, n.next, 'next');
    effects(n.effects, opts, (msg) => at(n, msg));
    if (n.effects?.end && (n.next !== undefined || n.choices?.length))
      at(n, 'effects.end with next/choices (they are ignored)');
    if (n.choices) {
      if (!n.choices.length) at(n, 'empty choices list');
      if (n.choices.length > MAX_CHOICES) at(n, `${n.choices.length} choices (max ${MAX_CHOICES})`);
      n.choices.forEach((c, i) => {
        key(n, c.text);
        cond(n, c.cond);
        target(n, c.next, `choice ${i + 1}`);
        effects(c.effects, opts, (msg) => at(n, `choice ${i + 1}: ${msg}`));
      });
    }
  }

  // Reachability from the start node.
  const seen = new Set<string>();
  const stack = [g.nodes[0].id];
  while (stack.length) {
    const id = stack.pop() as string;
    const n = ids.get(id);
    if (!n || seen.has(id)) continue;
    seen.add(id);
    if (n.effects?.end && !n.cond) continue;
    if (n.next !== undefined) stack.push(n.next);
    for (const c of n.choices ?? []) if (c.next !== undefined) stack.push(c.next);
  }
  for (const n of g.nodes) if (!seen.has(n.id)) at(n, 'unreachable node');

  // Lines in a row before the player chooses (or the dialogue ends).
  const runs = new Map<string, number>();
  const onPath = new Set<string>();
  const reported = new Set<string>();
  const run = (id: string | undefined): number => {
    if (id === undefined) return 0;
    const n = ids.get(id);
    if (!n) return 0;
    const memo = runs.get(id);
    if (memo !== undefined) return memo;
    if (onPath.has(id)) {
      if (!reported.has(id)) at(n, 'lines loop back here without a choice');
      reported.add(id);
      return MAX_LINES_IN_A_ROW + 1;
    }
    onPath.add(id);
    const stops = Boolean(n.choices?.length) || Boolean(n.effects?.end);
    const len = 1 + (stops ? 0 : run(n.next));
    onPath.delete(id);
    runs.set(id, len);
    return len;
  };
  const starts = [g.nodes[0].id];
  for (const n of g.nodes) for (const c of n.choices ?? []) starts.push(c.next ?? n.next ?? '');
  for (const s of new Set(starts)) {
    const len = run(s || undefined);
    if (len > MAX_LINES_IN_A_ROW && !reported.has(s)) {
      at(
        ids.get(s) ?? null,
        `${len} lines in a row from here before a choice or the end (max ${MAX_LINES_IN_A_ROW})`,
      );
    }
  }
  return out;
}

function effects(e: DialogueEffects | undefined, opts: ValidateOptions, report: (msg: string) => void): void {
  if (!e) return;
  if (e.hope !== undefined && (!Number.isFinite(e.hope) || e.hope === 0))
    report(`effects.hope must be a non-zero number`);
  for (const k of ['give', 'take', 'detour', 'cam'] as const) {
    const v = e[k];
    if (v !== undefined && !v.trim()) report(`effects.${k} is empty`);
  }
  if (e.give?.startsWith('gift:') && opts.gifts && !opts.gifts.includes(e.give.slice(5))) {
    report(`unknown gift "${e.give.slice(5)}"`);
  }
  if (e.flag) {
    for (const [k, v] of Object.entries(e.flag)) {
      if (!FLAG_KEY.test(k)) report(`bad flag key "${k}"`);
      if (v !== null && !['boolean', 'number', 'string'].includes(typeof v))
        report(`flag "${k}" has a bad value`);
    }
  }
  if (e.anim !== undefined) {
    const colon = e.anim.indexOf(':');
    const clip = colon >= 0 ? e.anim.slice(colon + 1) : e.anim;
    if (opts.anims && !opts.anims.includes(clip)) report(`unknown anim "${clip}"`);
    if (colon >= 0 && opts.speakers && !opts.speakers.includes(e.anim.slice(0, colon))) {
      report(`unknown anim actor "${e.anim.slice(0, colon)}"`);
    }
  }
  if (e.sfx !== undefined && opts.sfx && !opts.sfx.includes(e.sfx)) report(`unknown sfx "${e.sfx}"`);
  if (e.music !== undefined && opts.songs && !opts.songs.includes(e.music))
    report(`unknown song "${e.music}"`);
}
