#!/usr/bin/env node
/**
 * Validates content/levels/*.json against the level file format in GDD 2.15.
 *
 * Required: id (matches the file name), seed (uint32), palette, size (> 0), terrain (object), way (>= 2
 * points of [x, y, z]). Optional arrays (detours, zones, scatter, landmarks, npcs, triggers, waystones,
 * promises, water) must hold typed entries; `wayWidth` is a number > 0 (ARCHITECTURE LevelData). Shapes are
 * the ones the runtime builds: zones circle / box / "way" (a band along the Way or a detour, whose `path` must
 * exist), triggers and water circle / box. Scatter rules need `type` and `density` (>= 0); `scale` is a number
 * > 0 or [min, max]. Entity ids
 * are unique within a file; waystone and promise ids are unique across all files. Unknown top-level keys and
 * points outside the level area are warnings.
 *
 * Usage: node tools/validate-levels.mjs [levels dir]   (exit 0 when valid or when there are no levels yet)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ID_RE = /^[a-z0-9][a-z0-9_]*$/;
const UINT32_MAX = 0xffffffff;
// prettier-ignore
const TOP_LEVEL_KEYS = new Set([
  'id', 'seed', 'palette', 'size', 'terrain', 'way', 'detours', 'zones', 'scatter', 'landmarks', 'npcs',
  'triggers', 'waystones', 'promises', 'ambience', 'music', 'water', 'wayWidth',
]);
/** Required fields per optional section; `shaped` sections also need a valid shape with its geometry. */
const SECTIONS = {
  detours: { required: ['id'] },
  zones: { required: ['id', 'type', 'shape'], shaped: true },
  scatter: { required: ['type', 'density'] },
  landmarks: { required: ['type'] },
  npcs: { required: ['id', 'recipe'] },
  triggers: { required: ['id', 'shape'], shaped: true },
  waystones: { required: ['id', 'at'] },
  promises: { required: ['id', 'at'] },
  water: { required: ['kind', 'shape', 'level'], shaped: true },
};
/**
 * The shapes the runtime builds (LevelTypes.ts, src/gen/terrain/zones.ts): zones are circles, boxes or a band
 * along the Way or a detour ('way': `path`, `from`, `to`); triggers and water are circles or boxes.
 */
const SHAPES_BY_SECTION = {
  zones: new Set(['circle', 'box', 'way']),
  triggers: new Set(['circle', 'box']),
  water: new Set(['circle', 'box']),
};
const WATER_KINDS = new Set(['water', 'mud']);
/** Field types that mean the same thing wherever they appear in an entry. */
// prettier-ignore
const NUMBER_RULES = {
  x: {}, y: {}, z: {}, depth: {}, height: {}, hopeDrain: {}, rotation: {}, yaw: {},
  r: { gt: 0 }, radius: { gt: 0 }, width: { gt: 0 }, level: {},
  density: { min: 0 }, from: { min: 0, max: 1 }, to: { min: 0, max: 1 },
};
const STRING_FIELDS = ['type', 'shape', 'script', 'recipe', 'role', 'zone', 'path', 'palette'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

class LevelReport {
  constructor(file) {
    this.file = file;
    this.errors = [];
    this.warnings = [];
  }
  error(path, message) {
    this.errors.push(`${path}: ${message}`);
  }
  warn(path, message) {
    this.warnings.push(`${path}: ${message}`);
  }
}

/** Generic per-field checks shared by every entry object (numbers, vectors, ids, strings). */
function checkFields(r, entry, path) {
  for (const [key, rule] of Object.entries(NUMBER_RULES)) {
    if (!(key in entry)) continue;
    const v = entry[key];
    if (!isNum(v)) r.error(`${path}.${key}`, 'must be a finite number');
    else if (rule.gt !== undefined && !(v > rule.gt)) r.error(`${path}.${key}`, `must be > ${rule.gt}`);
    else if ((rule.min !== undefined && v < rule.min) || (rule.max !== undefined && v > rule.max)) {
      r.error(`${path}.${key}`, `must be in [${rule.min ?? '-inf'}, ${rule.max ?? 'inf'}]`);
    }
  }
  if ('id' in entry && !(typeof entry.id === 'string' && ID_RE.test(entry.id))) {
    r.error(`${path}.id`, 'must be a lowercase id (a-z, 0-9, _)');
  }
  for (const key of STRING_FIELDS) {
    if (key in entry && !isNonEmptyString(entry[key]))
      r.error(`${path}.${key}`, 'must be a non-empty string');
  }
  if ('at' in entry && !isVec(entry.at, 3)) r.error(`${path}.at`, 'must be [x, y, z] numbers');
  if ('scale' in entry) {
    const s = entry.scale;
    const range = isVec(s, 2) && s[0] > 0 && s[0] <= s[1];
    if (!(range || (isNum(s) && s > 0)))
      r.error(`${path}.scale`, 'must be a number > 0 or [min, max] with 0 < min <= max');
  }
  if ('size' in entry) {
    const s = entry.size;
    const ok = Array.isArray(s) && (s.length === 2 || s.length === 3) && s.every((n) => isNum(n) && n > 0);
    if (!ok) r.error(`${path}.size`, 'must be [w, d] or [w, h, d] positive numbers');
  }
  if ('points' in entry) {
    const p = entry.points;
    if (!Array.isArray(p) || !p.every((pt) => isVec(pt, 2) || isVec(pt, 3))) {
      r.error(`${path}.points`, 'must be an array of [x, z] or [x, y, z] numbers');
    }
  }
}

/** Shape-specific geometry for zones, triggers and water. */
function checkShape(r, entry, path, section) {
  const allowed = SHAPES_BY_SECTION[section];
  if (!allowed.has(entry.shape)) {
    r.error(`${path}.shape`, `must be one of ${[...allowed].join(', ')}`);
    return;
  }
  if (section === 'water' && !WATER_KINDS.has(entry.kind))
    r.error(`${path}.kind`, 'must be "water" or "mud"');
  if (entry.shape === 'way') return; // a band along a path: no x/z needed (its `path` is checked in references)
  if (!('at' in entry) && !(isNum(entry.x) && isNum(entry.z)))
    r.error(path, `${entry.shape} needs "at" or "x" and "z"`);
  if (entry.shape === 'circle' && !('r' in entry)) r.error(path, 'circle needs "r"');
  if (entry.shape === 'box' && !('size' in entry)) r.error(path, 'box needs "size"');
}

function checkTerrain(r, terrain) {
  if (!isObj(terrain)) {
    r.error('terrain', 'is required and must be an object');
    return;
  }
  if ('base' in terrain && !isNum(terrain.base)) r.error('terrain.base', 'must be a finite number');
  if ('noise' in terrain) {
    const n = terrain.noise;
    if (!isObj(n)) r.error('terrain.noise', 'must be an object');
    else {
      if (!(isNum(n.scale) && n.scale > 0)) r.error('terrain.noise.scale', 'must be a number > 0');
      if (!isNum(n.height)) r.error('terrain.noise.height', 'must be a finite number');
    }
  }
  if ('stamps' in terrain) {
    if (!Array.isArray(terrain.stamps)) r.error('terrain.stamps', 'must be an array');
    else {
      terrain.stamps.forEach((s, i) => {
        const path = `terrain.stamps[${i}]`;
        if (!isObj(s)) return r.error(path, 'must be an object');
        if (!isNonEmptyString(s.type)) r.error(`${path}.type`, 'is required');
        checkFields(r, s, path);
      });
    }
  }
}

function checkWay(r, way, half) {
  if (!Array.isArray(way) || way.length < 2) {
    r.error('way', 'is required: at least 2 points of [x, y, z]');
    return;
  }
  way.forEach((p, i) => {
    if (!isVec(p, 3)) return r.error(`way[${i}]`, 'must be [x, y, z] numbers');
    if (half && (Math.abs(p[0]) > half || Math.abs(p[2]) > half))
      r.warn(`way[${i}]`, `lies outside the level area (size ${half * 2})`);
    const prev = way[i - 1];
    if (i > 0 && isVec(prev, 3) && prev.every((v, k) => v === p[k]))
      r.error(`way[${i}]`, 'repeats the previous point');
  });
}

function validateLevel(file, level, crossIds) {
  const r = new LevelReport(file);
  if (!isObj(level)) {
    r.error('(root)', 'must be a JSON object');
    return r;
  }
  const expectedId = basename(file, '.json');
  if (!(typeof level.id === 'string' && ID_RE.test(level.id)))
    r.error('id', 'is required: a lowercase id (a-z, 0-9, _)');
  else if (level.id !== expectedId) r.error('id', `"${level.id}" must match the file name "${expectedId}"`);
  if (!(Number.isInteger(level.seed) && level.seed >= 0 && level.seed <= UINT32_MAX)) {
    r.error('seed', 'is required: an integer from 0 to 4294967295');
  }
  if (!isNonEmptyString(level.palette)) r.error('palette', 'is required: a palette name');
  const sizeOk = isNum(level.size) && level.size > 0;
  if (!sizeOk) r.error('size', 'is required: a number > 0');
  checkTerrain(r, level.terrain);
  checkWay(r, level.way, sizeOk ? level.size / 2 : 0);
  if ('wayWidth' in level && !(isNum(level.wayWidth) && level.wayWidth > 0))
    r.error('wayWidth', 'must be a number > 0');
  for (const key of ['ambience', 'music']) {
    if (key in level && !isNonEmptyString(level[key])) r.error(key, 'must be a non-empty string');
  }
  for (const key of Object.keys(level)) {
    if (!TOP_LEVEL_KEYS.has(key)) r.warn(key, 'unknown top-level key (typo?)');
  }

  const seen = new Map(); // id -> first path, one namespace per file
  for (const [section, rule] of Object.entries(SECTIONS)) {
    if (!(section in level)) continue;
    const list = level[section];
    if (!Array.isArray(list)) {
      r.error(section, 'must be an array');
      continue;
    }
    list.forEach((entry, i) => {
      const path = `${section}[${i}]`;
      if (!isObj(entry)) return r.error(path, 'must be an object');
      for (const field of rule.required) if (!(field in entry)) r.error(path, `is missing "${field}"`);
      checkFields(r, entry, path);
      if (rule.shaped && typeof entry.shape === 'string') checkShape(r, entry, path, section);
      if (typeof entry.id === 'string') {
        if (seen.has(entry.id))
          r.error(`${path}.id`, `"${entry.id}" is already used by ${seen.get(entry.id)}`);
        else seen.set(entry.id, path);
      }
    });
  }
  checkReferences(r, level, crossIds);
  return r;
}

/** References inside a file, and waystone/promise ids across files. */
function checkReferences(r, level, crossIds) {
  const ids = (section) =>
    new Set(
      (Array.isArray(level[section]) ? level[section] : [])
        .filter(isObj)
        .map((e) => e.id)
        .filter(Boolean),
    );
  const zoneIds = ids('zones');
  const detourIds = ids('detours');
  (Array.isArray(level.scatter) ? level.scatter : []).forEach((s, i) => {
    if (isObj(s) && typeof s.zone === 'string' && !zoneIds.has(s.zone)) {
      r.error(`scatter[${i}].zone`, `"${s.zone}" is not a zone in this level`);
    }
  });
  (Array.isArray(level.zones) ? level.zones : []).forEach((z, i) => {
    // A 'way' band follows `path` ("way" or a detour id); a missing detour would silently drop the zone.
    if (isObj(z) && typeof z.path === 'string' && z.path !== 'way' && !detourIds.has(z.path)) {
      r.error(`zones[${i}].path`, `"${z.path}" must be "way" or a detour id`);
    }
    if (isObj(z) && isNum(z.from) && isNum(z.to) && z.from > z.to)
      r.error(`zones[${i}]`, '"from" must be <= "to"');
  });
  (Array.isArray(level.landmarks) ? level.landmarks : []).forEach((l, i) => {
    if (!isObj(l)) return;
    if (typeof l.path === 'string' && l.path !== 'way' && !detourIds.has(l.path)) {
      r.error(`landmarks[${i}].path`, `"${l.path}" must be "way" or a detour id`);
    }
    if (isNum(l.from) && isNum(l.to) && l.from > l.to) r.error(`landmarks[${i}]`, '"from" must be <= "to"');
  });
  for (const section of ['waystones', 'promises']) {
    (Array.isArray(level[section]) ? level[section] : []).forEach((e, i) => {
      if (!isObj(e) || typeof e.id !== 'string') return;
      const owner = crossIds[section].get(e.id);
      if (owner && owner !== r.file) r.error(`${section}[${i}].id`, `"${e.id}" is already used in ${owner}`);
      else crossIds[section].set(e.id, r.file);
      if (section === 'waystones' && typeof level.id === 'string' && !e.id.startsWith(`${level.id}_`)) {
        r.warn(`${section}[${i}].id`, `waystone ids should start with "${level.id}_"`);
      }
    });
  }
}

function main() {
  const dir = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'content', 'levels');
  const inRepo = relative(ROOT, dir);
  const shown = inRepo.startsWith('..') ? dir : inRepo || '.';
  let names;
  try {
    names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    names = [];
  }
  if (names.length === 0) {
    console.log(`validate-levels: no levels yet (${shown})`);
    return;
  }

  const crossIds = { waystones: new Map(), promises: new Map() };
  let errorCount = 0;
  console.log(`validate-levels: ${shown}`);
  for (const name of names) {
    let level;
    let parseError = null;
    try {
      level = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (err) {
      parseError = err.message;
    }
    const report = parseError === null ? validateLevel(name, level, crossIds) : new LevelReport(name);
    if (parseError !== null) report.error('(file)', `is not valid JSON (${parseError})`);
    errorCount += report.errors.length;
    const status = report.errors.length ? `${report.errors.length} error(s)` : 'OK';
    const warn = report.warnings.length ? `, ${report.warnings.length} warning(s)` : '';
    console.log(`  ${name}  ${status}${warn}`);
    for (const e of report.errors) console.log(`    error: ${e}`);
    for (const w of report.warnings) console.log(`    warning: ${w}`);
  }
  if (errorCount > 0) {
    console.error(`FAIL: ${errorCount} error(s) in ${names.length} level file(s)`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${names.length} level file(s) valid`);
  }
}

main();
