#!/usr/bin/env node
/**
 * Generates the favicon, the PWA/app icons and the web manifest from the emblem data in src/ui/Emblem.ts
 * (GDD 2.3: icons are our own code; GDD 2.14: the emblem). Runs before every dev/build/test script.
 *
 *   public/favicon.svg            emblemSvg()
 *   public/icon-192.png           rounded tile, transparent corners
 *   public/icon-512.png           rounded tile, transparent corners
 *   public/apple-touch-icon.png   180, full bleed (iOS rounds it)
 *   public/maskable-512.png       full bleed, art scaled into the maskable safe zone
 *   public/manifest.webmanifest
 *   public/.generated-icons.json  sha256 of every file above; tools/check-assets.mjs trusts only these
 *
 * The PNGs come from an in-house scanline rasteriser (exact horizontal coverage, 16 vertical subsamples)
 * and an in-house PNG encoder (node:zlib deflate + CRC32). Output is byte-for-byte deterministic, and files
 * are only rewritten when their content changes (so a running dev server is not poked needlessly).
 * Node built-ins only; Node loads Emblem.ts directly via its built-in type stripping, which is on by default
 * from Node 22.18 / 23.6 (package.json "engines"); older Node stops here with a clear message.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

/** Loads src/ui/Emblem.ts. A dynamic import, so a Node without type stripping gets a readable error. */
async function loadEmblem() {
  try {
    return await import('../src/ui/Emblem.ts');
  } catch (err) {
    if (err?.code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw err;
    console.error(
      `gen-icons: Node ${process.versions.node} cannot load src/ui/Emblem.ts (no TypeScript type stripping). ` +
        'Use Node ^22.18.0 or >= 23.6.0, as package.json "engines" says.',
    );
    process.exit(1);
  }
}

const { EMBLEM_BACKGROUND, EMBLEM_CORNER_RADIUS, EMBLEM_DESIGN_SIZE, EMBLEM_SHAPES, emblemSvg } =
  await loadEmblem();

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const GENERATED_MANIFEST = '.generated-icons.json';

/** Maskable icons may be cropped to a circle of 40% radius; scaling the art to 80% keeps it all inside. */
const MASKABLE_CONTENT_SCALE = 0.8;
/** Vertical samples per pixel row. Horizontal coverage is computed exactly per span. */
const SUBSAMPLES = 16;

// ---------------------------------------------------------------------------------------------------------
// Rasteriser
// ---------------------------------------------------------------------------------------------------------

/** '#rrggbb' -> [r, g, b] in 0..1 */
function parseHex(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`gen-icons: unsupported colour "${hex}" (use #rrggbb)`);
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Maps a design-space shape to pixel space: p' = p * k + offset (uniform scale, so circles stay circles). */
function toPixels(shape, k, offset) {
  const p = (v) => v * k + offset;
  switch (shape.kind) {
    case 'circle':
      return { ...shape, cx: p(shape.cx), cy: p(shape.cy), r: shape.r * k };
    case 'rect':
      return { ...shape, x: p(shape.x), y: p(shape.y), w: shape.w * k, h: shape.h * k, r: shape.r * k };
    case 'polygon':
      return { ...shape, points: shape.points.map(([x, y]) => [p(x), p(y)]) };
    default:
      throw new Error(`gen-icons: unknown emblem shape kind "${shape.kind}"`);
  }
}

/** [top, bottom] of a pixel-space shape. */
function verticalExtent(shape) {
  if (shape.kind === 'circle') return [shape.cy - shape.r, shape.cy + shape.r];
  if (shape.kind === 'rect') return [shape.y, shape.y + shape.h];
  const ys = shape.points.map(([, y]) => y);
  return [Math.min(...ys), Math.max(...ys)];
}

/** Calls emit(x0, x1) for every interval of the horizontal line at `y` that lies inside the shape. */
function forEachSpan(shape, y, emit, crossings) {
  switch (shape.kind) {
    case 'circle': {
      const dy = y - shape.cy;
      if (Math.abs(dy) >= shape.r) return;
      const half = Math.sqrt(shape.r * shape.r - dy * dy);
      emit(shape.cx - half, shape.cx + half);
      return;
    }
    case 'rect': {
      const { x, w, h } = shape;
      const top = shape.y;
      if (y < top || y >= top + h) return;
      const r = Math.min(shape.r, w / 2, h / 2);
      let inset = 0;
      const dy = y < top + r ? top + r - y : y > top + h - r ? y - (top + h - r) : 0;
      if (dy > 0) inset = r - Math.sqrt(Math.max(0, r * r - dy * dy));
      emit(x + inset, x + w - inset);
      return;
    }
    case 'polygon': {
      // Nonzero winding: collect signed edge crossings, then walk them left to right.
      crossings.length = 0;
      const pts = shape.points;
      for (let i = 0; i < pts.length; i++) {
        const [xa, ya] = pts[i];
        const [xb, yb] = pts[(i + 1) % pts.length];
        if (ya === yb) continue;
        const down = yb > ya;
        if (down ? y >= ya && y < yb : y >= yb && y < ya) {
          crossings.push({ x: xa + ((y - ya) * (xb - xa)) / (yb - ya), dir: down ? 1 : -1 });
        }
      }
      crossings.sort((p, q) => p.x - q.x);
      let winding = 0;
      let start = 0;
      for (const { x, dir } of crossings) {
        const before = winding;
        winding += dir;
        if (before === 0) start = x;
        else if (winding === 0) emit(start, x);
      }
      return;
    }
    default:
      throw new Error(`gen-icons: unknown emblem shape kind "${shape.kind}"`);
  }
}

/** Adds `weight` x (overlap of [a, b] with each pixel column) into one row of a coverage buffer. */
function addSpan(cov, rowStart, width, a, b, weight) {
  const x0 = Math.max(0, a);
  const x1 = Math.min(width, b);
  if (x1 <= x0) return;
  const first = Math.floor(x0);
  const last = Math.min(width - 1, Math.floor(x1));
  if (first === last) {
    cov[rowStart + first] += (x1 - x0) * weight;
    return;
  }
  cov[rowStart + first] += (first + 1 - x0) * weight;
  for (let i = first + 1; i < last; i++) cov[rowStart + i] += weight;
  cov[rowStart + last] += (x1 - last) * weight;
}

/** Fills `cov` with the 0..1 area coverage of a pixel-space shape; returns the touched row range. */
function rasterise(shape, size, cov) {
  cov.fill(0);
  const [top, bottom] = verticalExtent(shape);
  const rowFrom = Math.max(0, Math.floor(top));
  const rowTo = Math.min(size, Math.ceil(bottom));
  const weight = 1 / SUBSAMPLES;
  const crossings = [];
  for (let py = rowFrom; py < rowTo; py++) {
    const rowStart = py * size;
    const emit = (a, b) => addSpan(cov, rowStart, size, a, b, weight);
    for (let s = 0; s < SUBSAMPLES; s++) forEachSpan(shape, py + (s + 0.5) / SUBSAMPLES, emit, crossings);
  }
  return [rowFrom, rowTo];
}

/**
 * Renders the emblem at `size` px into 8-bit RGBA (straight alpha). Compositing is source-over in sRGB space
 * with premultiplied floats, matching how browsers paint the same SVG.
 */
function renderEmblem(size, { frame, contentScale = 1 }) {
  const premul = new Float32Array(size * size * 4);
  const cov = new Float32Array(size * size);
  const clip = new Float32Array(size * size);
  const pxPerUnit = size / EMBLEM_DESIGN_SIZE;
  const corner = frame === 'rounded' ? EMBLEM_CORNER_RADIUS * pxPerUnit : 0;
  const frameShape = { kind: 'rect', x: 0, y: 0, w: size, h: size, r: corner };
  rasterise(frameShape, size, clip);

  const paint = (shape, fill, opacity) => {
    const [r, g, b] = parseHex(fill);
    const [rowFrom, rowTo] = rasterise(shape, size, cov);
    for (let i = rowFrom * size; i < rowTo * size; i++) {
      const a = Math.min(1, cov[i]) * clip[i] * opacity;
      if (a <= 0) continue;
      const o = i * 4;
      const keep = 1 - a;
      premul[o] = r * a + premul[o] * keep;
      premul[o + 1] = g * a + premul[o + 1] * keep;
      premul[o + 2] = b * a + premul[o + 2] * keep;
      premul[o + 3] = a + premul[o + 3] * keep;
    }
  };

  paint({ ...frameShape, r: 0 }, EMBLEM_BACKGROUND, 1);
  // Content scales about the centre; the frame and background do not.
  const k = pxPerUnit * contentScale;
  const offset = size / 2 - (EMBLEM_DESIGN_SIZE / 2) * k;
  for (const shape of EMBLEM_SHAPES) paint(toPixels(shape, k, offset), shape.fill, shape.opacity ?? 1);

  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    const a = premul[o + 3];
    if (a <= 0) continue;
    const to8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    out[o] = to8(premul[o] / a);
    out[o + 1] = to8(premul[o + 1] / a);
    out[o + 2] = to8(premul[o + 2] / a);
    out[o + 3] = to8(a);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// PNG encoder
// ---------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** PNG filter predictors by filter type: None, Sub, Up, Average, Paeth. */
const PREDICTORS = [() => 0, (left) => left, (left, up) => up, (left, up) => (left + up) >> 1, paeth];

/** Applies PNG filter `type` to one scanline. */
function filterRow(type, row, prev, bpp, out) {
  const predict = PREDICTORS[type];
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = prev ? prev[i] : 0;
    const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
    out[i] = (row[i] - predict(left, up, upLeft)) & 255;
  }
}

/** Encodes straight-alpha RGBA as PNG; drops the alpha channel when every pixel is opaque. */
function encodePng(size, rgba) {
  let opaque = true;
  for (let i = 3; i < rgba.length && opaque; i += 4) opaque = rgba[i] === 255;
  const bpp = opaque ? 3 : 4;
  const stride = size * bpp;
  const pixels = new Uint8Array(size * stride);
  for (let i = 0, j = 0; i < size * size; i++) {
    for (let c = 0; c < bpp; c++) pixels[j++] = rgba[i * 4 + c];
  }

  // Per row, keep the filter with the smallest sum of absolute (signed) residuals: the usual heuristic.
  const raw = new Uint8Array(size * (stride + 1));
  const trial = new Uint8Array(stride);
  for (let y = 0; y < size; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestScore = Infinity;
    for (let type = 0; type < 5; type++) {
      filterRow(type, row, prev, bpp, trial);
      let score = 0;
      for (let i = 0; i < stride; i++) score += trial[i] < 128 ? trial[i] : 256 - trial[i];
      if (score < bestScore) {
        bestScore = score;
        best = type;
      }
    }
    const at = y * (stride + 1);
    raw[at] = best;
    filterRow(best, row, prev, bpp, raw.subarray(at + 1, at + 1 + stride));
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // colour type: RGB or RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])), // perceptual intent
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------

const png = (size, options) => encodePng(size, renderEmblem(size, options));
const text = (s) => Buffer.from(s.endsWith('\n') ? s : `${s}\n`, 'utf8');

const webManifest = {
  name: 'PILGRIM: THE NARROW WAY',
  short_name: 'PILGRIM',
  description: 'A story adventure for kids and families.',
  lang: 'en',
  dir: 'ltr',
  id: './',
  start_url: './',
  scope: './',
  display: 'fullscreen',
  display_override: ['fullscreen', 'standalone'],
  orientation: 'any',
  background_color: EMBLEM_BACKGROUND,
  theme_color: EMBLEM_BACKGROUND,
  categories: ['games', 'kids', 'education'],
  icons: [
    { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

function writeIfChanged(file, data) {
  try {
    if (readFileSync(file).equals(data)) return false;
  } catch {
    // Missing or unreadable: write it.
  }
  writeFileSync(file, data);
  return true;
}

function main() {
  const started = performance.now();
  const outputs = [
    ['favicon.svg', text(emblemSvg(64))],
    ['icon-192.png', png(192, { frame: 'rounded' })],
    ['icon-512.png', png(512, { frame: 'rounded' })],
    ['apple-touch-icon.png', png(180, { frame: 'square' })],
    ['maskable-512.png', png(512, { frame: 'square', contentScale: MASKABLE_CONTENT_SCALE })],
    ['manifest.webmanifest', text(JSON.stringify(webManifest, null, 2))],
  ];

  mkdirSync(PUBLIC_DIR, { recursive: true });
  let changed = 0;
  const files = [];
  for (const [name, data] of outputs) {
    if (writeIfChanged(join(PUBLIC_DIR, name), data)) changed++;
    files.push({ path: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  const record = {
    generator: 'tools/gen-icons.mjs',
    note:
      'Written by tools/gen-icons.mjs. tools/check-assets.mjs allows binary files in public/ only ' +
      'if they are listed here with a matching sha256.',
    files,
  };
  if (writeIfChanged(join(PUBLIC_DIR, GENERATED_MANIFEST), text(JSON.stringify(record, null, 2)))) changed++;

  const ms = Math.round(performance.now() - started);
  console.log(`gen-icons: ${files.length + 1} files in public/ (${changed} updated) in ${ms} ms`);
}

main();
