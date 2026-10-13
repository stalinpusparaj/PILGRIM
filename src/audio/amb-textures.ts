/**
 * Procedural texture loops for the ambience, rendered once per Ambience from a seed (no samples, GDD 2.3):
 * - clicks: candle crackle and rain patter (sparse decaying noise ticks, written sample by sample);
 * - crickets: pulsed high sine chirps from three crickets with their own rhythm;
 * - murmur: a distant crowd, a handful of "voices" (saw buzz through moving vowel formants, syllable envelopes)
 *   rendered by an OfflineAudioContext off the main thread, with the tail crossfaded into the head so it loops.
 * Textures are mono at a low sample rate (they are soft, filtered beds), which keeps them small and quick.
 */
import type { Rng } from '../gen/rng';
import type { TextureId } from './amb-types';

const RATE = 24000;
const MURMUR_RATE = 22050;
const MURMUR_XFADE = 0.5;
const PEAK = 0.9;

interface ClickSpec {
  seconds: number;
  /** Small ticks per second (Poisson). */
  rate: number;
  amp: number;
  /** Tick decay time constant range (s). */
  decay: readonly [number, number];
  /** One-pole low-pass coefficient for the tick noise, 1 = raw. */
  bright: number;
  /** Bigger, darker pops per second. */
  popRate: number;
  popAmp: number;
}

const CLICKS: Readonly<Record<'crackleA' | 'crackleB' | 'patter', ClickSpec>> = {
  crackleA: {
    seconds: 5.3,
    rate: 14,
    amp: 0.5,
    decay: [0.0002, 0.0012],
    bright: 0.9,
    popRate: 0.7,
    popAmp: 0.7,
  },
  crackleB: {
    seconds: 7.1,
    rate: 8,
    amp: 0.4,
    decay: [0.0003, 0.002],
    bright: 0.6,
    popRate: 0.4,
    popAmp: 0.6,
  },
  patter: {
    seconds: 4.7,
    rate: 70,
    amp: 0.5,
    decay: [0.0004, 0.0025],
    bright: 0.45,
    popRate: 4,
    popAmp: 0.6,
  },
};

interface Cricket {
  hz: number;
  every: number;
  pulses: number;
  len: number;
  gap: number;
  amp: number;
}

const CRICKETS: readonly Cricket[] = [
  { hz: 4300, every: 0.58, pulses: 3, len: 0.016, gap: 0.01, amp: 0.55 },
  { hz: 4850, every: 0.77, pulses: 4, len: 0.012, gap: 0.008, amp: 0.35 },
  { hz: 3900, every: 1.1, pulses: 2, len: 0.02, gap: 0.012, amp: 0.25 },
];
const CRICKET_SECONDS = 6;

/** Vowel formants [F1, F2] in Hz: a, e, i, o, u, ae. */
const VOWELS: ReadonlyArray<readonly [number, number]> = [
  [730, 1090],
  [530, 1840],
  [300, 2200],
  [570, 840],
  [320, 900],
  [660, 1720],
];

/** Renders one texture. `ctx` only creates the buffers (any context can play them). */
export function renderTexture(ctx: BaseAudioContext, id: TextureId, r: Rng): Promise<AudioBuffer> {
  switch (id) {
    case 'crackleA':
    case 'crackleB':
    case 'patter':
      return Promise.resolve(clicks(ctx, r, CLICKS[id]));
    case 'crickets':
      return Promise.resolve(crickets(ctx, r));
    case 'murmurA':
      return murmur(ctx, r, 6.3, 7);
    case 'murmurB':
      return murmur(ctx, r, 8.1, 9);
  }
}

function clicks(ctx: BaseAudioContext, r: Rng, o: ClickSpec): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.round(o.seconds * RATE), RATE);
  const data = buf.getChannelData(0);
  scatter(data, r, o.rate, o.amp, o.decay, o.bright);
  if (o.popRate > 0) scatter(data, r, o.popRate, o.popAmp, [0.003, 0.01], 0.25);
  normalize(data);
  return buf;
}

/** Poisson-timed decaying noise ticks, kept clear of the loop seam. */
function scatter(
  data: Float32Array,
  r: Rng,
  rate: number,
  amp: number,
  decay: readonly [number, number],
  bright: number,
): void {
  const n = data.length;
  const margin = Math.round(0.03 * RATE);
  let t = r.range(0.005, 1 / rate);
  for (;;) {
    const pos = Math.round(t * RATE);
    const tau = r.range(decay[0], decay[1]) * RATE;
    const len = Math.ceil(tau * 6);
    if (pos + len >= n - margin) break;
    const a = amp * (0.15 + 0.85 * r.next() * r.next());
    const k = Math.exp(-1 / tau);
    let env = a;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += bright * (r.next() * 2 - 1 - lp);
      data[pos + i] = (data[pos + i] ?? 0) + env * lp;
      env *= k;
    }
    t += -Math.log(1 - r.next()) / rate;
  }
}

function crickets(ctx: BaseAudioContext, r: Rng): AudioBuffer {
  const n = Math.round(CRICKET_SECONDS * RATE);
  const buf = ctx.createBuffer(1, n, RATE);
  const data = buf.getChannelData(0);
  for (const c of CRICKETS) {
    const chirpLen = c.pulses * (c.len + c.gap);
    let t = r.range(0.02, c.every);
    while (t + chirpLen < CRICKET_SECONDS - 0.03) {
      const w = (2 * Math.PI * c.hz * r.range(0.99, 1.01)) / RATE;
      const m = Math.round(c.len * RATE);
      for (let p = 0; p < c.pulses; p++) {
        const i0 = Math.round((t + p * (c.len + c.gap)) * RATE);
        const a = c.amp * (p === c.pulses - 1 ? 0.7 : 1);
        for (let i = 0; i < m; i++) {
          const e = Math.sin((Math.PI * i) / m);
          data[i0 + i] = (data[i0 + i] ?? 0) + a * e * e * Math.sin(w * i);
        }
      }
      t += c.every * r.range(0.92, 1.1);
    }
  }
  normalize(data);
  return buf;
}

async function murmur(ctx: BaseAudioContext, r: Rng, seconds: number, voices: number): Promise<AudioBuffer> {
  const total = seconds + MURMUR_XFADE;
  const off = new OfflineAudioContext(1, Math.ceil(total * MURMUR_RATE), MURMUR_RATE);
  const bus = off.createGain();
  bus.gain.value = 1 / Math.sqrt(voices);
  bus.connect(off.destination);
  for (let v = 0; v < voices; v++) murmurVoice(off, bus, r.fork(v + 1), total);
  const rendered = await off.startRendering();
  return loopify(ctx, rendered, seconds);
}

/** One talker: saw buzz -> two vowel band-passes -> syllable envelope, in phrases with pauses. */
function murmurVoice(off: OfflineAudioContext, bus: AudioNode, r: Rng, total: number): void {
  const child = r.chance(0.2);
  const f0 = child ? r.range(250, 320) : r.range(95, 220);
  const o = off.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = f0;
  const f1 = off.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 5;
  const f2 = off.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 7;
  const f2Level = off.createGain();
  f2Level.gain.value = 0.5;
  const env = off.createGain();
  env.gain.value = 0;
  const level = off.createGain();
  level.gain.value = r.range(0.35, 1);
  o.connect(f1).connect(env);
  o.connect(f2).connect(f2Level).connect(env);
  env.connect(level).connect(bus);
  let t = r.range(0, 0.3);
  while (t < total) {
    const syllables = r.int(3, 9);
    for (let s = 0; s < syllables && t < total; s++) {
      const d = r.range(0.09, 0.22);
      const v = r.pick(VOWELS);
      f1.frequency.setTargetAtTime(v[0] * r.range(0.9, 1.1), t, 0.02);
      f2.frequency.setTargetAtTime(v[1] * r.range(0.9, 1.1), t, 0.02);
      o.frequency.setTargetAtTime(f0 * r.range(0.9, 1.15), t, 0.05);
      env.gain.setTargetAtTime(r.range(0.5, 1), t, 0.015);
      env.gain.setTargetAtTime(0.2, t + d * 0.7, 0.025);
      t += d;
    }
    env.gain.setTargetAtTime(0, t, 0.04);
    t += r.range(0.25, 1.3);
  }
  o.start(0);
  o.stop(total);
}

/** First `seconds` of `src` with the following MURMUR_XFADE crossfaded (equal power) into the head: a seamless loop. */
function loopify(ctx: BaseAudioContext, src: AudioBuffer, seconds: number): AudioBuffer {
  const sr = src.sampleRate;
  const n = Math.min(Math.round(seconds * sr), src.length);
  const m = Math.min(Math.round(MURMUR_XFADE * sr), src.length - n);
  const out = ctx.createBuffer(1, n, sr);
  const a = src.getChannelData(0);
  const o = out.getChannelData(0);
  o.set(a.subarray(0, n));
  for (let i = 0; i < m; i++) {
    const w = (i / m) * (Math.PI / 2);
    o[i] = (a[i] ?? 0) * Math.sin(w) + (a[n + i] ?? 0) * Math.cos(w);
  }
  normalize(o);
  return out;
}

function normalize(data: Float32Array): void {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i] ?? 0));
  if (max <= 0) return;
  const k = PEAK / max;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) * k;
}
