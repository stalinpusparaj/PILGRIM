#!/usr/bin/env node
/**
 * Validates content/dialogue/*.json (GDD 2.8 dialogue graphs) with the same rules the game uses
 * (src/narrative/dialogue-parse.ts + dialogue-rules.ts, loaded through Node's built-in type stripping):
 *
 *   - shape: an array of graphs { id, nodes }, typed node / choice / effect fields, no unknown fields;
 *     graph ids start with "<file>_" and are unique across all files
 *   - unknown `next` ids, more than 3 choices, bad `cond` syntax, unreachable nodes, more than 5 lines in a
 *     row before a choice or the end (GDD 2.8 "Max 5 bubbles before the player acts or chooses")
 *   - every text key exists in English AND Tamil (content/i18n/en.json / ta.json)
 *   - vocabularies read from the source: anim (AnimName), expr (EXPRESSIONS), mood (Mood), sfx (SfxId),
 *     music (SongId), gifts (GIFT_IDS)
 *   - writing rules on the English text: at most 2 sentences per bubble (GDD 2.8), no sectarian words
 *     (GDD 2.16 rule 5)
 * Warnings (do not fail): speakers that are not NPCs of the matching level, very long lines or choices.
 *
 * Usage: node tools/validate-dialogue.mjs [dialogue dir]   (exit 1 on problems; 0 when valid or no files)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = resolve(process.argv[2] ?? join(ROOT, 'content/dialogue'));
const I18N_DIR = join(ROOT, 'content/i18n');
const LANGS = ['en', 'ta'];
const MAX_SENTENCES = 2;
const LONG_LINE = 110;
const LONG_CHOICE = 48;
const BANNED = /\b(pope|pagan|rome)\b/i;
/** Abbreviations whose dot does not end a sentence. */
const ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Mt)\./g;

async function loadRules() {
  try {
    const [rules, parse] = await Promise.all([
      import('../src/narrative/dialogue-rules.ts'),
      import('../src/narrative/dialogue-parse.ts'),
    ]);
    return { ...rules, ...parse };
  } catch (err) {
    if (err?.code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw err;
    console.error(
      `validate-dialogue: Node ${process.versions.node} cannot load TypeScript (no type stripping). ` +
        'Use Node ^22.18.0 or >= 23.6.0, as package.json "engines" says.',
    );
    process.exit(1);
  }
}

const { graphKeys, parseDialogueFile, validateGraph } = await loadRules();

const problems = [];
const warnings = [];

function readJson(path, where) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    problems.push(`${where}: cannot read JSON (${err.message})`);
    return null;
  }
}

/** Every i18n key per language. */
function loadStrings() {
  const tables = {};
  for (const lang of LANGS) {
    tables[lang] = readJson(join(I18N_DIR, `${lang}.json`), `content/i18n/${lang}.json`) ?? {};
  }
  return tables;
}

/** String literals of `export type <name> = ...;` or `export const <name> ... = [...]` in a source file. */
function sourceList(file, name) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return null;
  const src = readFileSync(path, 'utf8').replace(/\/\/[^\n]*/g, '');
  const m = new RegExp(`export\\s+(?:type|const)\\s+${name}\\b[^=]*=([\\s\\S]*?);`).exec(src);
  if (!m) return null;
  const list = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return list.length ? list : null;
}

function vocabularies() {
  const sources = {
    anims: ['src/gen/anim/types.ts', 'AnimName'],
    expressions: ['src/gen/char-types.ts', 'EXPRESSIONS'],
    moods: ['src/audio/types.ts', 'Mood'],
    sfx: ['src/audio/types.ts', 'SfxId'],
    songs: ['src/audio/types.ts', 'SongId'],
    gifts: ['src/core/GameState.ts', 'GIFT_IDS'],
  };
  const out = {};
  for (const [key, [file, name]] of Object.entries(sources)) {
    const list = sourceList(file, name);
    if (list) out[key] = list;
    else warnings.push(`could not read ${name} from ${file}; ${key} are not checked`);
  }
  return out;
}

/** NPC ids of content/levels/<fileId>.json plus the player, or null when there is no such level. */
function levelSpeakers(fileId) {
  const path = join(ROOT, 'content/levels', `${fileId}.json`);
  if (!existsSync(path)) return null;
  const level = readJson(path, `content/levels/${fileId}.json`);
  const npcs = Array.isArray(level?.npcs)
    ? level.npcs.map((n) => n?.id).filter((id) => typeof id === 'string')
    : [];
  return ['christian', ...npcs];
}

function sentences(text) {
  const plain = text.replace(ABBREV, '$1').replace(/\.{3}|…/g, ',');
  return plain.split(/[.!?]+(?:["')\]]*)(?:\s+|$)/).filter((s) => s.trim()).length;
}

function checkText(where, key, en, isChoice) {
  if (typeof en !== 'string') return;
  if (!isChoice && sentences(en) > MAX_SENTENCES)
    problems.push(`${where}: "${key}" has more than ${MAX_SENTENCES} sentences`);
  if (BANNED.test(en)) problems.push(`${where}: "${key}" uses a word cut by GDD 2.16 rule 5`);
  const limit = isChoice ? LONG_CHOICE : LONG_LINE;
  if (en.length > limit) warnings.push(`${where}: "${key}" is long (${en.length} > ${limit} characters)`);
}

if (!existsSync(DIR)) {
  console.log(`validate-dialogue: no ${relative(ROOT, DIR) || DIR} folder, nothing to check`);
  process.exit(0);
}
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();
if (!files.length) {
  console.log('validate-dialogue: no dialogue files yet');
  process.exit(0);
}

const strings = loadStrings();
const vocab = vocabularies();
const graphOwner = new Map();
let graphCount = 0;

for (const file of files) {
  const fileId = basename(file, '.json');
  const raw = readJson(join(DIR, file), `${relative(ROOT, DIR)}/${file}`);
  if (raw === null) continue;
  const parsed = parseDialogueFile(raw, fileId);
  problems.push(...parsed.problems);
  const speakers = levelSpeakers(fileId);
  for (const g of parsed.graphs) {
    graphCount++;
    const owner = graphOwner.get(g.id);
    if (owner && owner !== file) problems.push(`${g.id}: graph id also used in ${owner}`);
    graphOwner.set(g.id, file);
    problems.push(...validateGraph(g, (k) => Object.hasOwn(strings.en, k), vocab));
    for (const k of graphKeys(g)) {
      if (Object.hasOwn(strings.en, k) && !Object.hasOwn(strings.ta, k))
        problems.push(`${g.id}: missing Tamil for "${k}"`);
    }
    for (const n of g.nodes) {
      const where = `${g.id}/${n.id}`;
      checkText(where, n.text, strings.en[n.text], false);
      for (const c of n.choices ?? []) checkText(where, c.text, strings.en[c.text], true);
      if (speakers && !speakers.includes(n.speaker)) {
        warnings.push(`${where}: speaker "${n.speaker}" is not an NPC of content/levels/${fileId}.json`);
      }
    }
  }
}

for (const w of warnings) console.warn(`  warning: ${w}`);
if (problems.length) {
  console.error(`validate-dialogue: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`validate-dialogue: ${files.length} file(s), ${graphCount} graph(s) OK`);
