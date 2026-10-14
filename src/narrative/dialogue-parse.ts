/**
 * Shape check for `content/dialogue/<file>.json` (an array of DialogueGraph, GDD 2.8). Turns unknown JSON into
 * typed graphs and lists readable problems (wrong types, unknown fields, ids that do not match the file).
 * Malformed nodes are dropped; a graph keeps whatever nodes are usable so the game never crashes on data.
 *
 * Import-free like dialogue-rules.ts: Node loads it with type stripping for tools/validate-dialogue.mjs.
 */
import type { DialogueChoice, DialogueEffects, DialogueGraph, DialogueNode } from './DialogueTypes';

export interface ParsedDialogueFile {
  graphs: DialogueGraph[];
  problems: string[];
}

const NODE_KEYS = new Set([
  'id',
  'speaker',
  'text',
  'anim',
  'expr',
  'mood',
  'bubble',
  'next',
  'choices',
  'effects',
  'cond',
]);
const CHOICE_KEYS = new Set(['text', 'next', 'effects', 'cond']);
const EFFECT_KEYS = new Set(['hope', 'give', 'take', 'detour', 'flag', 'anim', 'cam', 'sfx', 'music', 'end']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Parses one dialogue file. `fileId` is the file name without `.json` (graph ids must start with `<fileId>_`). */
export function parseDialogueFile(raw: unknown, fileId: string): ParsedDialogueFile {
  const problems: string[] = [];
  const graphs: DialogueGraph[] = [];
  if (!Array.isArray(raw)) {
    return { graphs, problems: [`${fileId}.json: must be an array of dialogue graphs`] };
  }
  const seen = new Set<string>();
  raw.forEach((g: unknown, gi) => {
    const where = `${fileId}.json[${gi}]`;
    if (!isObj(g) || !isStr(g.id) || !Array.isArray(g.nodes)) {
      problems.push(`${where}: a graph needs "id" (string) and "nodes" (array)`);
      return;
    }
    const id = g.id;
    if (!id.startsWith(`${fileId}_`))
      problems.push(`${id}: graph id must start with "${fileId}_" (its file)`);
    if (seen.has(id)) problems.push(`${id}: duplicate graph id`);
    seen.add(id);
    for (const k of Object.keys(g))
      if (k !== 'id' && k !== 'nodes') problems.push(`${id}: unknown field "${k}"`);
    const nodes: DialogueNode[] = [];
    g.nodes.forEach((n: unknown, ni) => {
      const node = parseNode(n, (msg) =>
        problems.push(`${id}/${isObj(n) && isStr(n.id) ? n.id : `#${ni}`}: ${msg}`),
      );
      if (node) nodes.push(node);
    });
    graphs.push({ id, nodes });
  });
  return { graphs, problems };
}

function parseNode(n: unknown, report: (msg: string) => void): DialogueNode | null {
  if (!isObj(n)) {
    report('a node must be an object');
    return null;
  }
  if (!isStr(n.id) || !isStr(n.speaker) || !isStr(n.text)) {
    report('a node needs "id", "speaker" and "text" (non-empty strings)');
    return null;
  }
  for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) report(`unknown field "${k}"`);
  const node: DialogueNode = { id: n.id, speaker: n.speaker, text: n.text };
  const str = (k: 'anim' | 'next' | 'cond'): void => {
    if (n[k] === undefined) return;
    if (isStr(n[k])) node[k] = n[k];
    else report(`"${k}" must be a non-empty string`);
  };
  str('anim');
  str('next');
  str('cond');
  // expr / mood values are checked against their vocabularies by validateGraph().
  if (n.expr !== undefined) {
    if (isStr(n.expr)) node.expr = n.expr as DialogueNode['expr'];
    else report('"expr" must be a string');
  }
  if (n.mood !== undefined) {
    if (isStr(n.mood)) node.mood = n.mood as DialogueNode['mood'];
    else report('"mood" must be a string');
  }
  if (n.bubble !== undefined) {
    if (typeof n.bubble === 'boolean') node.bubble = n.bubble;
    else report('"bubble" must be true or false');
  }
  if (n.effects !== undefined) {
    const e = parseEffects(n.effects, report);
    if (e) node.effects = e;
  }
  if (n.choices !== undefined) {
    if (!Array.isArray(n.choices)) report('"choices" must be an array');
    else {
      node.choices = [];
      n.choices.forEach((c: unknown, ci) => {
        const choice = parseChoice(c, (msg) => report(`choice ${ci + 1}: ${msg}`));
        if (choice) node.choices?.push(choice);
      });
    }
  }
  return node;
}

function parseChoice(c: unknown, report: (msg: string) => void): DialogueChoice | null {
  if (!isObj(c) || !isStr(c.text)) {
    report('a choice needs "text" (an i18n key)');
    return null;
  }
  for (const k of Object.keys(c)) if (!CHOICE_KEYS.has(k)) report(`unknown field "${k}"`);
  const choice: DialogueChoice = { text: c.text };
  if (c.next !== undefined) {
    if (isStr(c.next)) choice.next = c.next;
    else report('"next" must be a non-empty string');
  }
  if (c.cond !== undefined) {
    if (isStr(c.cond)) choice.cond = c.cond;
    else report('"cond" must be a non-empty string');
  }
  if (c.effects !== undefined) {
    const e = parseEffects(c.effects, report);
    if (e) choice.effects = e;
  }
  return choice;
}

function parseEffects(e: unknown, report: (msg: string) => void): DialogueEffects | null {
  if (!isObj(e)) {
    report('"effects" must be an object');
    return null;
  }
  const out: DialogueEffects = {};
  for (const [k, v] of Object.entries(e)) {
    if (!EFFECT_KEYS.has(k)) {
      report(`unknown effect "${k}"`);
      continue;
    }
    switch (k) {
      case 'hope':
        if (typeof v === 'number' && Number.isFinite(v)) out.hope = v;
        else report('effects.hope must be a number');
        break;
      case 'end':
        if (typeof v === 'boolean') out.end = v;
        else report('effects.end must be true or false');
        break;
      case 'flag':
        if (isObj(v) && Object.values(v).every(isFlagValue))
          out.flag = v as Record<string, boolean | number | string | null>;
        else report('effects.flag must map keys to true/false, numbers, strings or null');
        break;
      default:
        // give, take, detour, anim, cam, sfx, music. Ids are checked against their vocabularies by validateGraph().
        if (isStr(v)) (out as Record<string, unknown>)[k] = v;
        else report(`effects.${k} must be a non-empty string`);
    }
  }
  return out;
}

function isFlagValue(v: unknown): boolean {
  return (
    v === null ||
    typeof v === 'boolean' ||
    typeof v === 'string' ||
    (typeof v === 'number' && Number.isFinite(v))
  );
}
