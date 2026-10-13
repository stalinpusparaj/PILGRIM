/**
 * Synth helpers (GDD 2.13): pitch maths, seeded noise buffers, the generated reverb impulse and the ADSR
 * envelope used by every instrument. Pure Web Audio, no samples: every buffer here is computed from a seed, so
 * the same context always gets the same sound.
 */
import { Rng, hashString } from '../gen/rng';

/** MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const LETTER: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PITCH_RE = /^([A-Ga-g])([#b]*)(-?\d+)$/;

/**
 * Scientific pitch -> MIDI number: 'C4' = 60, 'C#4' = 61, 'Bb5' = 82, 'F#3' = 54, 'C-1' = 0.
 * Accidentals: any number of '#' (sharp) or 'b' (flat). Returns NaN for anything that is not a pitch
 * (callers such as the song validator check `Number.isNaN`).
 */
export function parsePitch(p: string): number {
  const m = PITCH_RE.exec(p.trim());
  if (!m) return NaN;
  const letter = m[1];
  const acc = m[2];
  const oct = m[3];
  if (letter === undefined || acc === undefined || oct === undefined) return NaN;
  const base = LETTER[letter.toUpperCase()];
  if (base === undefined) return NaN;
  let shift = 0;
  for (let i = 0; i < acc.length; i++) shift += acc[i] === '#' ? 1 : -1;
  const midi = (parseInt(oct, 10) + 1) * 12 + base + shift;
  return midi >= 0 && midi <= 127 ? midi : NaN;
}

// ---------------------------------------------------------------------------------------------------------
// Envelopes

/** Release and decay use exponential (setTarget) curves; time constant = segment time / this. */
const DECAY_TC = 4;
const RELEASE_TC = 5;

/**
 * Schedules an ADSR envelope on `param` (usually a GainNode.gain) and returns the time at which it is silent
 * (stop your sources there).
 * - starts at 0 at `t`, rises linearly to `peak` over `a` seconds;
 * - falls exponentially towards `s * peak` (s = sustain as a fraction of peak, 0 = percussive) over about `d` s;
 * - holds until note-off at `t + dur` (dur is the gate length from `t`, attack included);
 * - releases exponentially to silence over `r` seconds (-43 dB at the returned end time `t + dur + r`).
 * A gate shorter than the attack releases from wherever the attack got to, so nothing ever clicks.
 */
export function adsr(param: AudioParam, t: number, peak: number, a: number, d: number, s: number, r: number, dur: number): number {
  const att = Math.max(0.001, a);
  const off = t + Math.max(0.002, dur);
  const rel = Math.max(0.005, r);
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  if (off <= t + att) {
    param.linearRampToValueAtTime(peak * ((off - t) / att), off);
  } else {
    param.linearRampToValueAtTime(peak, t + att);
    param.setTargetAtTime(peak * clamp01(s), t + att, Math.max(0.001, d) / DECAY_TC);
  }
  param.setTargetAtTime(0, off, rel / RELEASE_TC);
  return off + rel;
}

/**
 * The value `adsr(param, t, peak, a, d, s, r, dur)` has at `time` (same maths as the scheduled curve). Used to
 * fade a stolen voice from exactly where it is, on every browser (no reliance on cancelAndHoldAtTime).
 */
export function adsrValueAt(t: number, peak: number, a: number, d: number, s: number, r: number, dur: number, time: number): number {
  if (time <= t) return 0;
  const att = Math.max(0.001, a);
  const off = t + Math.max(0.002, dur);
  const rel = Math.max(0.005, r);
  const at = Math.min(time, off);
  let v: number;
  if (off <= t + att || at <= t + att) {
    v = peak * Math.min(1, (at - t) / att);
  } else {
    const sus = peak * clamp01(s);
    v = sus + (peak - sus) * Math.exp(-(at - t - att) / (Math.max(0.001, d) / DECAY_TC));
  }
  if (time <= off) return v;
  return v * Math.exp(-(time - off) / (rel / RELEASE_TC));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------------------------------------
// Noise

export type NoiseColor = 'white' | 'pink' | 'brown';

const noiseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/**
 * A mono noise buffer, `seconds` long, at the context's sample rate. Seeded (same noise every time), cached per
 * context and colour/length, so callers may ask for it on every note. Loop it freely: the ends are crossfaded.
 * Peak level is normalised to about 0.9; pink and brown are noticeably softer and darker than white.
 */
export function noiseBuffer(ctx: BaseAudioContext, seconds: number, color: NoiseColor = 'white'): AudioBuffer {
  let byCtx = noiseCache.get(ctx);
  if (!byCtx) {
    byCtx = new Map();
    noiseCache.set(ctx, byCtx);
  }
  const len = Math.max(64, Math.round(seconds * ctx.sampleRate));
  const key = `${color}:${len}`;
  const hit = byCtx.get(key);
  if (hit) return hit;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  fillNoise(data, color, new Rng(hashString(`noise:${key}`)));
  loopCrossfade(data, Math.min(len >> 3, Math.round(ctx.sampleRate * 0.01)));
  normalize(data, 0.9);
  byCtx.set(key, buf);
  return buf;
}

function fillNoise(out: Float32Array, color: NoiseColor, rng: Rng): void {
  const n = out.length;
  if (color === 'white') {
    for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
    return;
  }
  if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (rng.next() * 2 - 1)) / 1.02;
      out[i] = last;
    }
    removeDc(out);
    return;
  }
  // Pink: Paul Kellet's economy filter on white noise.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = b0 + b1 + b2 + w * 0.1848;
  }
  removeDc(out);
}

function removeDc(data: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] ?? 0;
  const mean = sum / data.length;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) - mean;
}

/** Blends the tail into the head so a looping buffer has no seam click. */
function loopCrossfade(data: Float32Array, fade: number): void {
  const n = data.length;
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    const head = data[i] ?? 0;
    const tail = data[n - fade + i] ?? 0;
    data[n - fade + i] = tail * (1 - w) + head * w;
  }
}

function normalize(data: Float32Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i] ?? 0));
  if (max <= 0) return;
  const k = peak / max;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) * k;
}

// ---------------------------------------------------------------------------------------------------------
// Reverb

/**
 * A stereo reverb impulse for a ConvolverNode: decorrelated seeded noise per channel, shaped by
 * `(1 - x) ^ decay` (x = 0..1 over `seconds`; 1 = linear fade, 2-4 = a warm hall, higher = shorter tail),
 * a soft 6 ms onset, a few early reflections, and a low-pass that darkens as the tail goes on (warm, never
 * hissy). Each channel has unit energy, so a convolver with `normalize = false` keeps roughly the input level.
 */
export function createReverbImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(256, Math.round(Math.max(0.05, seconds) * sr));
  const buf = ctx.createBuffer(2, len, sr);
  const root = new Rng(hashString(`reverb:${seconds}:${decay}`));
  const onset = Math.round(0.006 * sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const rng = root.fork(ch + 1);
    let lp = 0;
    let k = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      if ((i & 31) === 0) {
        // One-pole low-pass whose cutoff falls from ~9 kHz to ~1.5 kHz across the tail (updated every 32 samples).
        const fc = 9000 * Math.pow(1500 / 9000, Math.min(1, x * 1.6));
        k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      }
      lp += k * (rng.next() * 2 - 1 - lp);
      const env = Math.pow(1 - x, Math.max(0.1, decay)) * (i < onset ? i / onset : 1);
      data[i] = lp * env;
    }
    // Early reflections: a handful of soft taps in the first 60 ms, different per side.
    for (let e = 0; e < 6; e++) {
      const at = Math.round(rng.range(0.008, 0.06) * sr);
      if (at < len) data[at] = (data[at] ?? 0) + rng.range(0.25, 0.5) * (1 - e / 8) * rng.sign();
    }
    let energy = 0;
    for (let i = 0; i < len; i++) energy += (data[i] ?? 0) * (data[i] ?? 0);
    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = 0; i < len; i++) data[i] = (data[i] ?? 0) * scale;
  }
  return buf;
}

// ---------------------------------------------------------------------------------------------------------
// Waveforms

/**
 * A PeriodicWave from harmonic amplitudes (index 0 = fundamental) with sine phase. Browsers band-limit these,
 * so they never alias. Callers cache the result (one per bank).
 */
export function harmonicWave(ctx: BaseAudioContext, amps: readonly number[]): PeriodicWave {
  const n = amps.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 0; i < amps.length; i++) imag[i + 1] = amps[i] ?? 0;
  return ctx.createPeriodicWave(real, imag);
}
