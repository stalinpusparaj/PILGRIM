#!/usr/bin/env node
/**
 * Asset guard (GDD 2.3: zero third-party assets). Exits 1 with a readable report if:
 *   - public/ holds a symlink, a binary file, or a file that is not text, unless it is an icon written by
 *     tools/gen-icons.mjs (listed in public/.generated-icons.json with a matching sha256);
 *   - package.json has a runtime dependency other than three (pinned exactly) or a dev dependency outside
 *     the allowlist;
 *   - code (src/, content/, index.html, public/ scripts) imports an npm package other than three (even one
 *     installed only for a dev tool), a three/examples (three/addons) module that is not on the allowlist,
 *     or an allowed one that embeds or imports something it should not (tools/lib/imports.mjs);
 *   - src/, content/, index.html or a public/ text file holds a binary, references a three/examples asset
 *     folder, imports an asset file, loads from another server (any http(s) or protocol-relative URL except
 *     XML namespaces), uses a web font service or embeds a base64 binary data URI.
 * Genuine OS folder metadata (.DS_Store, Thumbs.db, desktop.ini, recognised by content) is listed as
 * ignored; vite.config.ts leaves it out of the build. Node built-ins only; runs in well under a second.
 *
 * Usage: node tools/check-assets.mjs [--root <repo dir>]
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THREE_JSM_ALLOWED,
  jsmName,
  moduleSpecifiers,
  packageName,
  threeModuleProblems,
} from './lib/imports.mjs';
import { isOsMetadata, isOsMetadataName, sniff } from './lib/sniff.mjs';

const RUNTIME_DEPS = ['three'];
const DEV_DEPS_ALLOWED = ['vite', 'typescript', '@playwright/test', 'eslint', 'prettier', '@types/three'];
const EMPTY_DEP_FIELDS = [
  'optionalDependencies',
  'peerDependencies',
  'bundleDependencies',
  'bundledDependencies',
];
const GENERATED_MANIFEST = '.generated-icons.json';
/** Text formats allowed in public/ (still sniffed for binary content). */
const PUBLIC_TEXT_EXTS = new Set(['.svg', '.json', '.webmanifest', '.txt', '.js', '.css', '.html']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);
/** Asset and binary formats: never in src/ or content/, never imported. */
// prettier-ignore
const ASSET_EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tga', 'tif', 'tiff', 'psd', 'ktx', 'ktx2',
  'basis', 'dds', 'hdr', 'exr', 'glb', 'gltf', 'bin', 'drc', 'fbx', 'obj', 'mtl', 'dae', '3ds', 'blend',
  'stl', 'ply', 'usdz', 'vrm', 'vox', 'mp3', 'ogg', 'oga', 'opus', 'wav', 'flac', 'aac', 'm4a', 'mid',
  'midi', 'mp4', 'webm', 'mov', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'zip', 'gz', 'wasm', 'lottie',
];
const ASSET_EXT_SET = new Set(ASSET_EXTS.map((e) => `.${e}`));

/** XML namespace names look like URLs but are identifiers that are never fetched. */
const NAMESPACE_URIS = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/1998/Math/MathML',
]);
/** Absolute http(s) URLs, and protocol-relative ones (`//host.tld/...`) after a quote, `(` or `=`. */
const REMOTE_URL_RE =
  /\bhttps?:\/\/[^\s'"`<>()\\]+|(?<=['"`(=]\s*)\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?![\w.-])/gi;
const FONT_SERVICE_RE =
  /\b(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|(?:use|kit)\.fontawesome\.com)\b/gi;
const DATA_URI_RE =
  /data:((?:image\/(?!svg\+xml)|audio\/|video\/|font\/|model\/|application\/(?:octet-stream|gltf-buffer|font-|x-font-|vnd\.ms-fontobject|zip|wasm))[\w.+-]*)[^,'"`\s]{0,100},[A-Za-z0-9+/=%]{64,}/gi;
const THREE_JSM_RE = /\bthree\/(?:examples\/jsm|addons)(?:\/([^'"`\s?#)]*))?(\?[^'"`\s)]*)?/g;
const THREE_EXAMPLES_ASSET_RE = /(?:\bthree|threejs\.org)\/examples\/(?!jsm(?:\/|\b))[\w.-]+/g;
/** Specifiers of import / import() / new URL(): checked for asset file extensions. */
const IMPORT_SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bnew\s+URL\s*\(\s*)(['"`])([^'"`\n]+?)\1/g;
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const SCRIPT_RE = /(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi;

// ---------------------------------------------------------------------------------------------------------
// Reporting and file walking
// ---------------------------------------------------------------------------------------------------------

const problems = [];
const ignored = [];
let root = '';

const rel = (abs) => relative(root, abs).split(sep).join('/');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (where, message) => problems.push(`${where}: ${message}`);
/** Reports a problem at the line of `index` inside `text`. */
const failAt = (where, text, index, message) =>
  fail(`${where}:${text.slice(0, index).split('\n').length}`, message);

function parseRoot(argv) {
  const i = argv.findIndex((a) => a === '--root' || a.startsWith('--root='));
  if (i < 0) return fileURLToPath(new URL('..', import.meta.url));
  const value = argv[i].includes('=') ? argv[i].slice('--root='.length) : argv[i + 1];
  if (!value) throw new Error('--root needs a directory');
  return resolve(value);
}

/**
 * Lists the regular files under `dir` without following links. Symlinks (including `dir` itself) and
 * special files are reported as problems. Genuine OS metadata is skipped; a file that only borrows such a
 * name (a PNG saved as Thumbs.db) is checked like any other. A missing folder yields nothing.
 */
function walk(dir, out = []) {
  try {
    if (lstatSync(dir).isSymbolicLink()) {
      fail(rel(dir), 'is a symbolic link; it must be a real folder inside the repo.');
      return out;
    }
  } catch {
    return out;
  }
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isSymbolicLink()) fail(rel(abs), 'is a symbolic link (links can reach outside the repo).');
    else if (e.isDirectory()) walk(abs, out);
    else if (!e.isFile()) fail(rel(abs), 'is not a regular file.');
    else if (isOsMetadataName(e.name) && isOsMetadata(e.name, readFileSync(abs))) ignored.push(rel(abs));
    else out.push({ abs, ext: extname(e.name).toLowerCase() });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------------------

/** path (relative to public/) -> sha256, from the manifest tools/gen-icons.mjs writes. */
function loadGeneratedManifest(publicDir) {
  const file = join(publicDir, GENERATED_MANIFEST);
  const listed = new Map();
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return listed; // Not generated yet: nothing binary is allowed.
  }
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.files)) throw new Error('"files" must be an array');
    for (const f of data.files) {
      const safe = typeof f.path === 'string' && !f.path.startsWith('/') && !f.path.split('/').includes('..');
      if (safe && typeof f.sha256 === 'string') listed.set(f.path, f.sha256.toLowerCase());
    }
  } catch (err) {
    fail(rel(file), `is not a valid gen-icons manifest (${err.message}). Run \`npm run icons\`.`);
  }
  return listed;
}

function looksLikeGltf(text) {
  if (!text.includes('"asset"')) return false;
  try {
    const data = JSON.parse(text);
    return Boolean(data?.asset?.version) && ['meshes', 'accessors', 'buffers'].some((k) => k in data);
  } catch {
    return false;
  }
}

/** The HTML with everything outside <script> bodies blanked (same length and lines), for import rules. */
function scriptBodies(html) {
  const blank = (part) => part.replace(/[^\n]/g, ' ');
  let out = '';
  let last = 0;
  for (const m of html.matchAll(SCRIPT_RE)) {
    const body = m.index + m[1].length;
    out += blank(html.slice(last, body)) + m[2];
    last = body + m[2].length;
  }
  return out + blank(html.slice(last));
}

/** Content rules for every text file we ship or bundle. */
function scanText(where, text, ext) {
  for (const m of text.matchAll(REMOTE_URL_RE)) {
    if (NAMESPACE_URIS.has(m[0])) continue;
    failAt(
      where,
      text,
      m.index,
      `loads from another server (${m[0]}). The game ships everything it uses, made by our code ` +
        '(GDD 2.3); keep reference links in docs/.',
    );
  }
  for (const m of text.matchAll(FONT_SERVICE_RE)) {
    failAt(where, text, m.index, `uses a web font service (${m[0]}). Use system fonts (GDD 2.14).`);
  }
  for (const m of text.matchAll(DATA_URI_RE)) {
    failAt(where, text, m.index, `embeds a data URI (${m[1]}). Embedded binaries are assets too.`);
  }
  if (ext === '.css') {
    for (const m of text.matchAll(CSS_URL_RE)) {
      const target = m[2].trim().split(/[?#]/)[0].toLowerCase();
      if (ASSET_EXT_SET.has(extname(target))) failAt(where, text, m.index, `CSS loads an asset (${m[2]}).`);
    }
  }
  if (ext === '.json' && looksLikeGltf(text)) {
    fail(where, 'is a glTF model saved as .json. Models are built by code in src/gen (GDD 2.12).');
  }
}

/** Content rules for a three/examples module the allowlist lets in (its comments may link to papers). */
function vendorRules(text) {
  const found = [];
  for (const m of text.matchAll(DATA_URI_RE)) {
    found.push({ index: m.index, message: `embeds a data URI (${m[1]}): a bundled third-party asset.` });
  }
  for (const m of text.matchAll(IMPORT_SPECIFIER_RE)) {
    const target = m[2].split(/[?#]/)[0].toLowerCase();
    if (ASSET_EXT_SET.has(extname(target))) found.push({ index: m.index, message: `loads ${m[2]}.` });
  }
  return found;
}

/**
 * Import and three/examples rules for code. `code` is the part that runs as JavaScript (for HTML, the
 * <script> bodies, blanked elsewhere); the three/examples and asset rules read the whole text.
 */
function scanCode(where, text, code = text) {
  for (const m of text.matchAll(THREE_JSM_RE)) {
    const name = jsmName(m[1] ?? '');
    if (m[2]) {
      failAt(where, text, m.index, `imports ${m[0]}: only plain code modules may come from three/examples.`);
    } else if (name === '' || name === 'Addons') {
      failAt(where, text, m.index, 'imports the whole three/addons bundle (it includes loaders).');
    } else if (!THREE_JSM_ALLOWED.has(name)) {
      const allowed = [...THREE_JSM_ALLOWED].join(', ');
      failAt(where, text, m.index, `imports three/examples/jsm/${name}.js; allowed modules: ${allowed}.`);
    } else {
      for (const problem of threeModuleProblems(root, name, vendorRules)) {
        failAt(where, text, m.index, `imports three/examples/jsm/${name}.js, but ${problem} (GDD 2.3)`);
      }
    }
  }
  for (const m of text.matchAll(THREE_EXAMPLES_ASSET_RE)) {
    failAt(where, text, m.index, `references ${m[0]}: three/examples assets are not allowed (GDD 2.3).`);
  }
  for (const m of text.matchAll(IMPORT_SPECIFIER_RE)) {
    const target = m[2].split(/[?#]/)[0].toLowerCase();
    if (ASSET_EXT_SET.has(extname(target))) {
      failAt(where, text, m.index, `imports an asset file (${m[2]}). Generate it with code (GDD 2.3).`);
    }
  }
  for (const { index, spec } of moduleSpecifiers(code)) {
    const pkg = packageName(spec);
    if (pkg === null || RUNTIME_DEPS.includes(pkg)) continue;
    failAt(
      where,
      text,
      index,
      `imports the package "${pkg}". The only runtime dependency is three (GDD 2.3), even when another ` +
        'package is installed (for example as a dependency of a dev tool).',
    );
  }
}

function checkPublic() {
  const publicDir = join(root, 'public');
  const stats = { text: 0, generated: 0 };
  const listed = loadGeneratedManifest(publicDir);
  for (const { abs, ext } of walk(publicDir)) {
    const where = rel(abs);
    const bytes = readFileSync(abs);
    const magic = sniff(bytes);
    if (PUBLIC_TEXT_EXTS.has(ext)) {
      if (magic) fail(where, `is named ${ext} but contains ${magic} data.`);
      else if (bytes.includes(0)) fail(where, `is named ${ext} but contains NUL bytes (binary, not text).`);
      else {
        stats.text++;
        const text = bytes.toString('utf8');
        scanText(where, text, ext);
        if (ext === '.js') scanCode(where, text);
        else if (ext === '.html' || ext === '.svg') scanCode(where, text, scriptBodies(text));
      }
      continue;
    }
    const expected = listed.get(relative(publicDir, abs).split(sep).join('/'));
    if (!expected) {
      const what = magic ?? `"${ext || '(no extension)'}" file`;
      fail(
        where,
        `${what} is not allowed in public/. Only icons from tools/gen-icons.mjs may be binary; text files ` +
          `must be ${[...PUBLIC_TEXT_EXTS].join(' ')}. Delete it or make it with code (GDD 2.3).`,
      );
    } else if (sha256(bytes) !== expected) {
      fail(where, `does not match its sha256 in ${GENERATED_MANIFEST}. Run \`npm run icons\`.`);
    } else if (magic !== 'PNG image') {
      fail(where, `is listed as a generated icon but contains ${magic ?? 'unknown'} data, not PNG.`);
    } else {
      stats.generated++;
    }
  }
  return stats;
}

function checkPackageJson() {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch (err) {
    fail('package.json', `cannot be read (${err.message}).`);
    return 'unreadable';
  }
  const bad = (message) => fail('package.json', message);
  const deps = pkg.dependencies ?? {};
  for (const name of Object.keys(deps)) {
    if (!RUNTIME_DEPS.includes(name)) bad(`dependency "${name}" is not allowed; the only one is three.`);
  }
  if (!('three' in deps)) bad('dependencies: "three" is missing.');
  else if (typeof deps.three !== 'string' || !/^\d+\.\d+\.\d+$/.test(deps.three)) {
    bad(`three must be pinned to an exact version (found "${deps.three}").`);
  }
  const devNames = Object.keys(pkg.devDependencies ?? {});
  for (const name of devNames) {
    if (!DEV_DEPS_ALLOWED.includes(name))
      bad(`devDependency "${name}" is not allowed (${DEV_DEPS_ALLOWED.join(', ')}).`);
  }
  for (const field of EMPTY_DEP_FIELDS) {
    const value = pkg[field];
    // bundleDependencies may be `true` (bundle everything).
    const count = value === true ? 1 : Array.isArray(value) ? value.length : Object.keys(value ?? {}).length;
    if (count > 0) bad(`${field} must be empty (runtime allowlist: three).`);
  }
  return `three@${deps.three ?? '?'}, ${devNames.length} dev dependencies`;
}

function checkSources() {
  let scanned = 0;
  for (const top of ['src', 'content']) {
    for (const { abs, ext } of walk(join(root, top))) {
      const where = rel(abs);
      const bytes = readFileSync(abs);
      const magic = sniff(bytes);
      scanned++;
      if (ASSET_EXT_SET.has(ext) || magic || bytes.includes(0)) {
        const what = magic ?? (ASSET_EXT_SET.has(ext) ? `${ext} asset` : 'binary data');
        fail(where, `${what} in ${top}/, which holds only code and text data (GDD 2.3).`);
        continue;
      }
      const text = bytes.toString('utf8');
      scanText(where, text, ext);
      if (CODE_EXTS.has(ext)) scanCode(where, text);
    }
  }
  // The Vite entry page ships too, and Vite bundles its inline module scripts like src/ code.
  let html = null;
  try {
    html = readFileSync(join(root, 'index.html'), 'utf8');
  } catch {
    // No entry page yet.
  }
  if (html !== null) {
    scanText('index.html', html, '.html');
    scanCode('index.html', html, scriptBodies(html));
    scanned++;
  }
  return scanned;
}

function main() {
  const started = performance.now();
  root = parseRoot(process.argv.slice(2));
  const pub = checkPublic();
  const deps = checkPackageJson();
  const scanned = checkSources();
  const ms = Math.round(performance.now() - started);

  console.log('check-assets: GDD 2.3 asset policy');
  console.log(`  public/        ${pub.text} text files, ${pub.generated} generated icons (sha256 verified)`);
  console.log(`  package.json   ${deps}`);
  console.log(`  src/ content/  ${scanned} files scanned (binaries, imports, remote URLs, embedded data)`);
  if (ignored.length) console.log(`  ignored OS metadata: ${ignored.join(', ')}`);
  if (problems.length === 0) {
    console.log(`PASS (${ms} ms)`);
    return;
  }
  console.error(`FAIL: ${problems.length} problem${problems.length === 1 ? '' : 's'} (${ms} ms)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(`check-assets crashed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
}
