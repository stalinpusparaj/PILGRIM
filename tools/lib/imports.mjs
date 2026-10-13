/**
 * Import rules for tools/check-assets.mjs (GDD 2.3: the runtime dependency is three only; modules from
 * three/examples are allowed only when they are code).
 *
 * - moduleSpecifiers(): the modules a source file loads (static imports and re-exports, side-effect imports,
 *   dynamic import()).
 * - packageName(): the npm package a bare specifier loads. Anything installed in node_modules resolves and
 *   bundles, including packages that only came in as dependencies of dev tools (e.g. @types/three brings a
 *   physics engine), so check-assets fails every package except three.
 * - THREE_JSM_ALLOWED / threeModuleProblems(): three/examples modules are allowed by name, and each one is
 *   read from node_modules together with every module it imports. A module that embeds binary data (SMAAPass
 *   ships two third-party PNG lookup textures as data URIs) or pulls in a module off the list fails.
 */
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

/**
 * Allowed three/examples/jsm (alias three/addons) modules, by path without '.js'. Read a module, and what
 * it imports, before adding it here.
 */
export const THREE_JSM_ALLOWED = new Set([
  'utils/BufferGeometryUtils',
  'controls/OrbitControls',
  'controls/TransformControls',
  // High quality post-processing (GDD 2.11: bloom and FXAA) and the modules those passes import.
  'postprocessing/EffectComposer',
  'postprocessing/Pass',
  'postprocessing/MaskPass',
  'postprocessing/RenderPass',
  'postprocessing/ShaderPass',
  'postprocessing/OutputPass',
  'postprocessing/UnrealBloomPass',
  'postprocessing/FXAAPass',
  'shaders/CopyShader',
  'shaders/FXAAShader',
  'shaders/LuminosityHighPassShader',
  'shaders/OutputShader',
  // Maths only (no lookup tables or palettes).
  'math/Capsule',
  'math/ConvexHull',
  'math/ImprovedNoise',
  'math/MeshSurfaceSampler',
  'math/OBB',
  'math/Octree',
  'math/SimplexNoise',
]);

// Statements start a line or follow a `;`, so JSDoc examples (` * import ...`) do not count. The import
// clause never holds ; quotes ( ) or =, which keeps a match inside one statement.
const STATIC_IMPORT_RE = /(?:^|;)[ \t]*(?:import|export)\b[^;'"`()=]*?\bfrom\s*(['"])([^'"\n]+)\1/gm;
const SIDE_EFFECT_IMPORT_RE = /(?:^|;)[ \t]*import\s*(['"])([^'"\n]+)\1/gm;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"`])([^'"`\n]+)\1/g;

/** `{ index, spec }` for every module a JS/TS source loads; index points at the specifier. */
export function moduleSpecifiers(text) {
  const out = [];
  for (const re of [STATIC_IMPORT_RE, SIDE_EFFECT_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    for (const m of text.matchAll(re)) out.push({ index: m.index + m[0].lastIndexOf(m[2]), spec: m[2] });
  }
  return out;
}

/** The npm package a bare specifier loads ('three', '@scope/name'); null for paths and URL schemes. */
export function packageName(spec) {
  if (/^(?:\.{0,2}\/|\.{1,2}$)/.test(spec)) return null; // ./x ../x /x
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return null; // node:, data:, https: (remote URLs are a text rule)
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** 'postprocessing/UnrealBloomPass.js' -> 'postprocessing/UnrealBloomPass' */
export function jsmName(path) {
  return path.replace(/\.js$/, '');
}

/** What a specifier inside jsm/<from>.js loads: a jsm module name, undefined for three, null otherwise. */
function jsmTarget(from, spec) {
  if (spec.startsWith('.')) {
    const path = posix.normalize(posix.join(posix.dirname(from), spec));
    return path.startsWith('..') ? null : jsmName(path);
  }
  const addon = /^three\/(?:examples\/jsm|addons)\/(.+)$/.exec(spec);
  if (addon) return jsmName(addon[1]);
  if (/^three\/(?:examples|addons)\b/.test(spec)) return null;
  return packageName(spec) === 'three' ? undefined : null;
}

const reports = new Map();

/**
 * Problems in three/examples/jsm/<name>.js and in every module it imports (each read once per run), as
 * messages. `rules(text)` returns the content problems of one file as `[{ index, message }]`.
 */
export function threeModuleProblems(root, name, rules) {
  const key = `${root}\0${name}`;
  const cached = reports.get(key);
  if (cached) return cached;
  const problems = [];
  const seen = new Set([name]);
  const queue = [name];
  while (queue.length > 0) {
    const mod = queue.shift();
    const label = `three/examples/jsm/${mod}.js`;
    let text;
    try {
      text = readFileSync(join(root, 'node_modules', 'three', 'examples', 'jsm', `${mod}.js`), 'utf8');
    } catch {
      problems.push(`${label} cannot be read, so it cannot be checked (run npm install).`);
      continue;
    }
    const at = (index) => `${label}:${text.slice(0, index).split('\n').length}`;
    for (const { index, message } of rules(text)) problems.push(`${at(index)} ${message}`);
    for (const { index, spec } of moduleSpecifiers(text)) {
      const target = jsmTarget(mod, spec);
      if (target === undefined) continue; // three itself
      if (target === null || !THREE_JSM_ALLOWED.has(target)) {
        problems.push(`${at(index)} imports ${spec}, which is not an allowed three/examples module.`);
      } else if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  reports.set(key, problems);
  return problems;
}
