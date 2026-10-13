/**
 * Buffer utilities for the SFX renderer: seeded noise loops and reverb impulses (generated from fixed seeds,
 * never loaded) shared by every render while loading, and the final peak normalisation / silence trim.
 */
import { Rng, hashString } from '../../gen/rng';
import type { NoiseColor } from './types';

/** Peak level of every rendered buffer: -6 dBFS. */
export const TARGET_PEAK = 0.5;
/** Length of the shared noise loops (s). Longer layers loop them; the loop point is crossfaded (no click). */
export const NOISE_LOOP = 2;
const LOOP_XFADE = 0.05;

const noiseCache = new Map<string, AudioBuffer>();
const impulseCache = new Map<string, AudioBuffer>();

/** Samples generated between two yields of buildNoise. */
const NOISE_CHUNK = 16384;

/**
 * Builds the seeded noise loop for a colour at the context's rate: white, pink (Paul Kellet's filter) or brown
 * (leaky integrator), crossfaded end-to-start and peak-normalised to 0.9. Yields between chunks so the loader
 * can time-slice it; sharedNoise runs it straight through. Both give the same samples.
 */
function* buildNoise(
  ctx: BaseAudioContext,
  color: NoiseColor,
  key: string,
): Generator<void, AudioBuffer, void> {
  const rate = ctx.sampleRate;
  const len = Math.ceil(NOISE_LOOP * rate);
  const fade = Math.ceil(LOOP_XFADE * rate);
  const raw = new Float32Array(len + fade);
  const rng = new Rng(hashString(key));
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0,
    brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rng.next() * 2 - 1;
    let v = w;
    if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else if (color === 'brown') {
      brown = (brown + 0.02 * w) / 1.02;
      v = brown;
    }
    raw[i] = v;
    if (i % NOISE_CHUNK === NOISE_CHUNK - 1) yield;
  }
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    let v = raw[i] ?? 0;
    if (i < fade) v = v * (i / fade) + (raw[len + i] ?? 0) * (1 - i / fade); // ends where the start begins
    d[i] = v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const k = peak > 0 ? 0.9 / peak : 0;
  for (let i = 0; i < len; i++) d[i] = (d[i] ?? 0) * k;
  return buf;
}

/** The shared noise loop for a colour at the context's rate (cached until clearRenderCaches()). */
export function sharedNoise(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const key = `${color}@${ctx.sampleRate}`;
  const hit = noiseCache.get(key);
  if (hit) return hit;
  const it = buildNoise(ctx, color, key);
  let r = it.next();
  while (!r.done) r = it.next();
  noiseCache.set(key, r.value);
  return r.value;
}

/** Generates the shared noise loop for a colour and rate ahead of the renders, awaiting `tick` between chunks. */
export async function warmNoise(rate: number, color: NoiseColor, tick: () => Promise<void>): Promise<void> {
  const key = `${color}@${rate}`;
  if (noiseCache.has(key)) return;
  let ctx: OfflineAudioContext;
  try {
    ctx = new OfflineAudioContext(1, 1, rate);
  } catch {
    return; // rate not supported here: the render falls back and generates on demand
  }
  const it = buildNoise(ctx, color, key);
  let r = it.next();
  while (!r.done) {
    await tick();
    r = it.next();
  }
  noiseCache.set(key, r.value);
}

/**
 * Seeded reverb impulse: decaying noise that also darkens over time (warm, never metallic). Cached per sample
 * rate, length and decay until clearRenderCaches().
 */
export function sharedImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const key = `${ctx.sampleRate}|${seconds}|${decay}`;
  const hit = impulseCache.get(key);
  if (hit) return hit;
  const len = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rng = new Rng(hashString(`impulse:${key}`));
  const BLOCK = 64;
  let lp = 0;
  let e0 = 1;
  let e1 = 1;
  for (let i = 0; i < len; i++) {
    const j = i % BLOCK;
    if (j === 0) {
      e0 = Math.pow(1 - i / len, decay); // (1 - t)^decay, interpolated per block
      e1 = Math.pow(1 - Math.min(len, i + BLOCK) / len, decay);
    }
    const t = i / len;
    lp += (rng.next() * 2 - 1 - lp) * (0.7 - 0.62 * t); // one-pole low-pass that closes as the tail fades
    d[i] = lp * (e0 + (e1 - e0) * (j / BLOCK));
  }
  impulseCache.set(key, buf);
  return buf;
}

/** Frees the shared noise loops and impulses (the bank calls this when loading is done). */
export function clearRenderCaches(): void {
  noiseCache.clear();
  impulseCache.clear();
}

/**
 * Peak-normalises a rendered buffer to TARGET_PEAK (-6 dBFS), trims trailing silence and fades the last 8 ms.
 * `make` allocates the result (usually `ctx.createBuffer`). Returns null for a silent or broken render.
 */
export function finishBuffer(
  raw: AudioBuffer,
  make: (length: number, sampleRate: number) => AudioBuffer,
): AudioBuffer | null {
  const d = raw.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i] ?? 0;
    const a = v < 0 ? -v : v;
    if (!(a < 1e6)) return null; // NaN or runaway feedback
    if (a > peak) peak = a;
  }
  if (peak < 1e-5) return null;
  const k = TARGET_PEAK / peak;
  const floor = 0.0004 / k; // about -62 dBFS after scaling
  let last = 0;
  for (let i = d.length - 1; i >= 0; i--) {
    const v = d[i] ?? 0;
    if (v > floor || v < -floor) {
      last = i;
      break;
    }
  }
  const rate = raw.sampleRate;
  const len = Math.min(d.length, last + 1 + Math.ceil(0.01 * rate));
  const out = make(len, rate);
  const o = out.getChannelData(0);
  const fade = Math.max(1, Math.min(len, Math.ceil(0.008 * rate)));
  const fadeFrom = len - fade;
  for (let i = 0; i < len; i++) {
    const g = i >= fadeFrom ? (len - i) / fade : 1;
    o[i] = (d[i] ?? 0) * k * g;
  }
  return out;
}
