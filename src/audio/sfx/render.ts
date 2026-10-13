/**
 * Renders SFX recipes (types.ts) into AudioBuffers in an OfflineAudioContext. Called once per recipe variant on
 * load (SfxBank time-slices the calls). All randomness comes from the seed, so a recipe always renders the same
 * sound for the same seed. Noise loops and reverb impulses come from buffers.ts (generated, never loaded).
 */
import { Rng, hashString } from '../../gen/rng';
import { sharedImpulse, sharedNoise } from './buffers';
import type { EnvSpec, FilterSpec, LayerSpec, NoiseColor, Num, OscSrc, Points, SfxRecipe } from './types';

export const DEFAULT_RATE = 24000;
/** Default final low-pass (Hz): keeps every effect soft. */
export const DEFAULT_TONE = 9000;
/** Exponential decays end this far below the peak (-60 dB). */
const DECAY_FLOOR = 0.001;

/** Draws a `Num` (fixed value or [min, max] range). */
export function num(v: Num, rng: Rng): number {
  return typeof v === 'number' ? v : rng.range(v[0], v[1]);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface Kit {
  c: OfflineAudioContext;
  rng: Rng;
  seed: number;
  seconds: number;
  nyquist: number;
  curves: Map<number, Float32Array<ArrayBuffer>>;
}

function curveFor(kit: Kit, drive: number): Float32Array<ArrayBuffer> {
  let curve = kit.curves.get(drive);
  if (!curve) {
    const n = 1024;
    curve = new Float32Array(n);
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) curve[i] = Math.tanh(drive * ((i / (n - 1)) * 2 - 1)) / norm;
    kit.curves.set(drive, curve);
  }
  return curve;
}

interface Env {
  a: number;
  h: number;
  d: number;
  s: number;
  r: number;
  lin: boolean;
  total: number;
}

function resolveEnv(e: EnvSpec, rng: Rng): Env {
  const a = Math.max(0.001, num(e.a, rng));
  const h = e.h === undefined ? 0 : Math.max(0, num(e.h, rng));
  const d = Math.max(0.005, num(e.d, rng));
  const s = clamp(e.s ?? 0, 0, 1);
  const r = s > 0 ? Math.max(0.005, num(e.r ?? 0.05, rng)) : 0;
  return { a, h, d, s, r, lin: e.curve === 'lin', total: a + h + d + r + 0.004 };
}

function applyEnv(p: AudioParam, t0: number, peak: number, e: Env): void {
  p.setValueAtTime(0, t0);
  let t = t0 + e.a;
  p.linearRampToValueAtTime(peak, t);
  if (e.h > 0) {
    t += e.h;
    p.setValueAtTime(peak, t);
  }
  t += e.d;
  const target = e.s > 0 ? peak * e.s : e.lin ? 0 : peak * DECAY_FLOOR;
  if (e.lin) p.linearRampToValueAtTime(target, t);
  else p.exponentialRampToValueAtTime(Math.max(target, 1e-6), t);
  if (e.s > 0) {
    t += e.r;
    p.exponentialRampToValueAtTime(peak * DECAY_FLOOR, t);
  }
  p.linearRampToValueAtTime(0, t + 0.004);
}

/** Resolves automation points once, so every oscillator of a layer follows the same curve. */
function resolvePoints(pts: Points | undefined, rng: Rng): number[] {
  const out: number[] = [];
  if (pts) for (const [t, v] of pts) out.push(Math.max(0, t), num(v, rng));
  return out;
}

/** Pitch curve on a detune param (cents): linear in cents = exponential in Hz. */
function applyBend(p: AudioParam, t0: number, baseCents: number, pts: number[]): void {
  const startsAtZero = pts.length > 0 && pts[0] === 0;
  p.setValueAtTime(baseCents + (startsAtZero ? (pts[1] ?? 0) * 100 : 0), t0);
  for (let i = startsAtZero ? 2 : 0; i + 1 < pts.length; i += 2) {
    p.linearRampToValueAtTime(baseCents + (pts[i + 1] ?? 0) * 100, t0 + (pts[i] ?? 0));
  }
}

function buildFilter(kit: Kit, f: FilterSpec, t0: number, ratio: number): BiquadFilterNode {
  const { c, rng } = kit;
  const top = kit.nyquist * 0.95;
  const node = c.createBiquadFilter();
  node.type = f.type;
  node.Q.value = num(f.q ?? (f.type === 'lowpass' || f.type === 'highpass' ? -3 : 1), rng);
  if (f.gain !== undefined) node.gain.value = f.gain;
  node.frequency.setValueAtTime(clamp(num(f.freq, rng) * ratio, 10, top), t0);
  const pts = resolvePoints(f.sweep, rng);
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const hz = clamp((pts[i + 1] ?? 1000) * ratio, 10, top);
    const t = t0 + (pts[i] ?? 0);
    if (t <= t0) node.frequency.setValueAtTime(hz, t0);
    else node.frequency.exponentialRampToValueAtTime(hz, t);
  }
  return node;
}

function buildOsc(kit: Kit, s: OscSrc, t0: number, stopAt: number, semis: number, dest: AudioNode): void {
  const { c, rng } = kit;
  const top = kit.nyquist * 0.95;
  const freq = clamp(num(s.freq, rng), 1, top);
  const bend = resolvePoints(s.bend, rng);
  const base = semis * 100;
  let vib: GainNode | null = null;
  if (s.vib) {
    const lfo = c.createOscillator();
    lfo.frequency.value = num(s.vib.rate, rng);
    vib = c.createGain();
    const depth = num(s.vib.depth, rng) * 100;
    const delay = s.vib.delay ?? 0;
    const g = vib.gain;
    g.setValueAtTime(delay > 0 ? 0 : depth, t0);
    if (delay > 0) {
      g.setValueAtTime(0, t0 + delay);
      g.linearRampToValueAtTime(depth, t0 + delay + 0.08);
    }
    if (s.vib.fade !== undefined && depth > 0) {
      g.exponentialRampToValueAtTime(Math.max(0.5, depth * 0.03), t0 + delay + Math.max(0.1, s.vib.fade));
    }
    lfo.connect(vib);
    lfo.start(t0);
    lfo.stop(stopAt);
  }
  let fm: GainNode | null = null;
  if (s.fm) {
    const modHz = clamp(freq * num(s.fm.ratio, rng), 1, top);
    const idx = num(s.fm.index, rng);
    const idxEnd = s.fm.indexEnd === undefined ? idx : num(s.fm.indexEnd, rng);
    const m = c.createOscillator();
    m.type = s.fm.wave ?? 'sine';
    m.frequency.value = modHz;
    applyBend(m.detune, t0, base, bend);
    if (vib) vib.connect(m.detune);
    fm = c.createGain();
    fm.gain.setValueAtTime(idx * modHz, t0);
    fm.gain.linearRampToValueAtTime(idxEnd * modHz, stopAt);
    m.connect(fm);
    m.start(t0);
    m.stop(stopAt);
  }
  const count = s.unison ? Math.max(1, Math.floor(s.unison.count)) : 1;
  let target = dest;
  if (count > 1) {
    const mix = c.createGain();
    mix.gain.value = 1 / Math.sqrt(count);
    mix.connect(dest);
    target = mix;
  }
  for (let i = 0; i < count; i++) {
    const o = c.createOscillator();
    o.type = s.wave;
    o.frequency.value = freq;
    const spread = count > 1 && s.unison ? s.unison.cents * ((2 * i) / (count - 1) - 1) : 0;
    applyBend(o.detune, t0, base + spread, bend);
    if (vib) vib.connect(o.detune);
    if (fm) fm.connect(o.frequency);
    o.connect(target);
    o.start(t0);
    o.stop(stopAt);
  }
}

function buildNoise(kit: Kit, color: NoiseColor, t0: number, stopAt: number, dest: AudioNode): void {
  const buf = sharedNoise(kit.c, color);
  const n = kit.c.createBufferSource();
  n.buffer = buf;
  n.loop = true;
  n.start(t0, kit.rng.range(0, buf.duration * 0.98));
  n.stop(stopAt);
  n.connect(dest);
}

/** One hit of a layer: source -> filters -> drive -> envelope -> tremolo -> out. */
function buildHit(kit: Kit, L: LayerSpec, t0: number, gainMul: number, semis: number, out: AudioNode): void {
  const { c, rng } = kit;
  const env = resolveEnv(L.env, rng);
  const stopAt = t0 + env.total + 0.01;
  const ratio = Math.pow(2, semis / 12);
  const amp = c.createGain();
  applyEnv(amp.gain, t0, Math.max(1e-4, num(L.gain ?? 1, rng) * gainMul), env);
  if (L.trem) {
    const depth = clamp(L.trem.depth, 0, 1);
    const tg = c.createGain();
    tg.gain.value = 1 - depth / 2;
    const lfo = c.createOscillator();
    lfo.frequency.value = num(L.trem.rate, rng);
    const lg = c.createGain();
    lg.gain.value = depth / 2;
    lfo.connect(lg);
    lg.connect(tg.gain);
    lfo.start(t0);
    lfo.stop(stopAt);
    amp.connect(tg);
    tg.connect(out);
  } else {
    amp.connect(out);
  }
  let head: AudioNode = amp;
  if (L.drive !== undefined && L.drive > 1) {
    const ws = c.createWaveShaper();
    ws.curve = curveFor(kit, L.drive);
    ws.oversample = '2x';
    ws.connect(head);
    head = ws;
  }
  const filters = L.filters ?? [];
  for (let i = filters.length - 1; i >= 0; i--) {
    const spec = filters[i];
    if (!spec) continue;
    const f = buildFilter(kit, spec, t0, ratio);
    f.connect(head);
    head = f;
  }
  if (L.src.type === 'noise') buildNoise(kit, L.src.color, t0, stopAt, head);
  else buildOsc(kit, L.src, t0, stopAt, semis, head);
}

/** A layer with its repeats. Hits re-draw every range; a `sync` key shares the hit pattern between layers. */
function buildLayer(kit: Kit, L: LayerSpec, out: AudioNode): void {
  const rep = L.repeat;
  const start = num(L.at ?? 0, kit.rng);
  const pat = rep?.sync !== undefined ? new Rng((kit.seed ^ hashString(`sync:${rep.sync}`)) >>> 0) : kit.rng;
  const count = rep ? Math.max(1, Math.round(num(rep.count, pat))) : 1;
  let t = start;
  let g = 1;
  let semis = 0;
  for (let i = 0; i < count && t < kit.seconds; i++) {
    buildHit(kit, L, t, g, semis, out);
    if (!rep) break;
    t += Math.max(0.005, num(rep.every, pat));
    g *= rep.fade ?? 1;
    if (rep.step !== undefined) semis += num(rep.step, pat);
  }
}

function createOffline(seconds: number, rate: number): OfflineAudioContext {
  try {
    return new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * rate)), rate);
  } catch {
    // Some older engines only accept common device rates.
    return new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * 44100)), 44100);
  }
}

const noTick = (): Promise<void> => Promise.resolve();

/**
 * Builds the offline graph for one recipe variant and renders it (raw, not yet normalised). `tick` is awaited
 * between the main-thread steps (each layer, the impulse, the convolver set-up) so a caller can time-slice.
 */
export async function renderRecipe(recipe: SfxRecipe, seed: number, tick = noTick): Promise<AudioBuffer> {
  const c = createOffline(recipe.len, recipe.rate ?? DEFAULT_RATE);
  const kit: Kit = {
    c,
    rng: new Rng(seed),
    seed,
    seconds: recipe.len,
    nyquist: c.sampleRate / 2,
    curves: new Map(),
  };
  const top = kit.nyquist * 0.95;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 25;
  hp.Q.value = -3;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = clamp(recipe.tone ?? DEFAULT_TONE, 200, top);
  lp.Q.value = -3;
  hp.connect(lp);
  lp.connect(c.destination);
  const bus = c.createGain();
  bus.connect(hp);
  const echo = recipe.echo;
  if (echo) {
    const dl = c.createDelay(Math.max(1, echo.time + 0.1));
    dl.delayTime.value = echo.time;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = clamp(echo.tone ?? 2500, 100, top);
    tone.Q.value = -3;
    const fb = c.createGain();
    fb.gain.value = clamp(echo.feedback, 0, 0.85);
    const wet = c.createGain();
    wet.gain.value = echo.mix;
    bus.connect(dl);
    dl.connect(tone);
    tone.connect(fb);
    fb.connect(dl);
    tone.connect(wet);
    wet.connect(hp);
  }
  for (const L of recipe.layers) {
    buildLayer(kit, L, bus);
    await tick();
  }
  const rev = recipe.reverb;
  if (rev) {
    const impulse = sharedImpulse(c, rev.seconds, rev.decay);
    await tick();
    const conv = c.createConvolver();
    conv.buffer = impulse; // Chrome prepares the FFT partitions here, on the main thread
    const wet = c.createGain();
    wet.gain.value = rev.mix;
    bus.connect(conv);
    conv.connect(wet);
    wet.connect(hp);
    await tick();
  }
  return c.startRendering();
}

/** Recipe sanity checks (dev builds and tests). Returns readable problems; empty when the recipe is fine. */
export function recipeProblems(id: string, r: SfxRecipe): string[] {
  const out: string[] = [];
  if (!(r.len > 0 && r.len <= 8)) out.push(`${id}: len ${r.len} must be in (0, 8] s`);
  if (r.layers.length === 0) out.push(`${id}: no layers`);
  if (r.level !== undefined && !(r.level > 0 && r.level <= 1)) out.push(`${id}: level must be in (0, 1]`);
  if (r.rate !== undefined && !(r.rate >= 8000 && r.rate <= 48000)) out.push(`${id}: rate out of range`);
  if (r.echo && r.echo.feedback >= 0.9) out.push(`${id}: echo feedback too high`);
  const ranges: Num[] = [];
  for (const L of r.layers) {
    ranges.push(L.env.a, L.env.d);
    if (L.at !== undefined) ranges.push(L.at);
    if (L.src.type === 'osc') ranges.push(L.src.freq);
    if (L.repeat) ranges.push(L.repeat.count, L.repeat.every);
  }
  for (const v of ranges) {
    if (typeof v === 'number' ? !Number.isFinite(v) || v < 0 : !(v[0] >= 0 && v[1] >= v[0])) {
      out.push(`${id}: bad value ${JSON.stringify(v)}`);
    }
  }
  return out;
}
