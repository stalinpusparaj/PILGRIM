/**
 * Babble loudness normalisation: estimates how loud a voice's steady tone is on a small speaker, so Babble can
 * bring every voice (any wave, pitch and vowel) to the same level. Computed from the harmonics of the wave
 * through the voice's actual filters (BiquadFilterNode.getFrequencyResponse), no audio is rendered.
 */
import type { VoiceParams } from './types';

const MAX_HARMONICS = 64;

/** Dry tone vs formant mix per wave: pure waves stay mostly dry, rich waves get their vowels from the formants. */
export const WAVE_MIX: Readonly<Record<VoiceParams['wave'], { dry: number; f1: number; f2: number }>> = {
  sine: { dry: 1, f1: 0.25, f2: 0.1 },
  triangle: { dry: 0.75, f1: 0.9, f2: 0.45 },
  sawtooth: { dry: 0.35, f1: 1.1, f2: 0.7 },
  square: { dry: 0.32, f1: 1.1, f2: 0.6 },
};

type F32 = Float32Array<ArrayBuffer>;

/** Reusable buffers for `loudness()` (one set per Babble, so speaking a line allocates nothing here). */
export interface LevelScratch {
  freq: F32;
  mag: [F32, F32, F32];
  phase: [F32, F32, F32];
}

export function createLevelScratch(): LevelScratch {
  const buf = (): F32 => new Float32Array(MAX_HARMONICS);
  return { freq: buf(), mag: [buf(), buf(), buf()], phase: [buf(), buf(), buf()] };
}

/** Harmonic n (1-based) amplitude of Web Audio's built-in waves (peak-normalised). */
export function harmonicAmp(wave: VoiceParams['wave'], n: number): number {
  switch (wave) {
    case 'sine':
      return n === 1 ? 1 : 0;
    case 'triangle':
      return n % 2 === 1 ? 8 / (Math.PI * Math.PI * n * n) : 0;
    case 'square':
      return n % 2 === 1 ? 4 / (Math.PI * n) : 0;
    default:
      return 2 / (Math.PI * n);
  }
}

/** Small-speaker / ear weighting: 2nd-order roll-off below ~300 Hz, gentle roll-off above 5 kHz. */
export function speakerWeight(f: number): number {
  const f2 = f * f;
  return f2 / Math.sqrt(f2 * f2 + 8.1e9) / Math.sqrt(1 + (f / 5000) * (f / 5000));
}

/**
 * Weighted RMS of a steady tone at f0 through three parallel filters with the given gains (complex sum of the
 * paths per harmonic, so phase differences between the paths count).
 */
export function loudness(
  wave: VoiceParams['wave'],
  f0: number,
  filters: readonly [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode],
  gains: readonly [number, number, number],
  s: LevelScratch,
): number {
  const nyquist = filters[0].context.sampleRate / 2;
  const n = Math.max(1, Math.min(MAX_HARMONICS, Math.floor(Math.min(8000, nyquist * 0.9) / f0)));
  const freq = s.freq.subarray(0, n);
  for (let h = 0; h < n; h++) freq[h] = f0 * (h + 1);
  for (let i = 0; i < 3; i++) {
    filters[i].getFrequencyResponse(freq, s.mag[i].subarray(0, n), s.phase[i].subarray(0, n));
  }
  let acc = 0;
  for (let h = 0; h < n; h++) {
    const a = harmonicAmp(wave, h + 1);
    if (a === 0) continue;
    let re = 0;
    let im = 0;
    for (let i = 0; i < 3; i++) {
      const m = s.mag[i][h] * gains[i];
      re += m * Math.cos(s.phase[i][h]);
      im += m * Math.sin(s.phase[i][h]);
    }
    const amp = a * Math.hypot(re, im) * speakerWeight(freq[h]);
    acc += amp * amp;
  }
  return Math.sqrt(acc / 2);
}
