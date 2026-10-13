/**
 * Struck instruments: bell (FM), marimba (sine + 4th harmonic) and music box (tines). They ring on after the
 * note's gate like the real thing, but a short gate damps them sooner so fast passages do not pile up voices.
 */
import type { VoiceBuilder } from './inst-kit';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Bell: FM with an inharmonic 1:3.5 modulator whose index falls from a bright strike to a nearly pure tone,
 * plus a slightly stretched octave partial that fades early. Long, pitch-dependent ring. 6 nodes.
 */
export const bell: VoiceBuilder = (k, v, n) => {
  const { t, hz, vel } = n;
  const ring = clamp(4 - (n.midi - 60) * 0.06, 1.2, 5);
  const carrier = k.osc(v, 'sine', hz, t);
  const mHz = hz * 3.5;
  const mod = k.osc(v, 'sine', mHz, t);
  const index = k.gain(v, 0);
  // High bells get a smaller index so the sidebands stay well under Nyquist.
  const tame = Math.min(1, Math.sqrt(900 / hz));
  index.gain.setValueAtTime((0.35 + 1.0 * vel) * tame * mHz, t);
  index.gain.setTargetAtTime(0.1 * tame * mHz, t + 0.002, 0.22);
  mod.connect(index);
  index.connect(carrier.frequency);
  const shimmer = k.osc(v, 'sine', hz * 2, t, 6);
  const sg = k.gain(v, 0);
  k.hit(sg, t, 0.3 + 0.15 * vel, ring * 0.16);
  shimmer.connect(sg);
  const env = k.gain(v, 0);
  carrier.connect(env);
  sg.connect(env);
  const gate = clamp(n.dur * 2 + 0.8, 0.8, ring);
  k.env(v, env, t, n.amp, 0.002, ring, 0, 0.6 + ring * 0.15, gate);
  return env;
};

/**
 * Marimba: a sine bar with its tuned 4th harmonic (fast decay) and a very short ~10x "wood" partial for the
 * mallet knock. Short, warm and round. Up to 6 nodes.
 */
export const marimba: VoiceBuilder = (k, v, n) => {
  const { t, hz, vel } = n;
  const ring = clamp(1.25 - (n.midi - 48) * 0.022, 0.25, 1.3);
  const env = k.gain(v, 0);
  const o1 = k.osc(v, 'sine', hz, t);
  o1.connect(env);
  const o2 = k.osc(v, 'sine', hz * 4, t, k.wobble(4));
  const g2 = k.gain(v, 0);
  k.hit(g2, t, 0.3 + 0.35 * vel, 0.04 + ring * 0.05);
  o2.connect(g2);
  g2.connect(env);
  if (hz * 9.9 < k.nyquist * 0.8) {
    const o3 = k.osc(v, 'sine', hz * 9.9, t);
    const g3 = k.gain(v, 0);
    k.hit(g3, t, 0.08 + 0.14 * vel, 0.01);
    o3.connect(g3);
    g3.connect(env);
  }
  const gate = Math.min(ring, Math.max(n.dur * 1.5, 0.25));
  const comp = Math.pow(10, (clamp(n.midi - 72, -30, 30) * 0.075) / 20);
  k.env(v, env, t, n.amp * comp, 0.0025, ring, 0, 0.12, gate);
  return env;
};

/**
 * Music box: a pair of tines tuned a few cents apart (gentle shimmer) and the tine's bright inharmonic
 * second mode (x6.27), which fades almost at once. Very short, sparkly. Up to 5 nodes.
 */
export const musicbox: VoiceBuilder = (k, v, n) => {
  const { t, hz, vel } = n;
  const ring = clamp(1.5 - (n.midi - 72) * 0.03, 0.45, 1.7);
  const env = k.gain(v, 0);
  const a = k.osc(v, 'sine', hz, t);
  const b = k.osc(v, 'sine', hz, t, 4 + k.wobble(1));
  a.connect(env);
  b.connect(env);
  if (hz * 6.27 < k.nyquist * 0.8) {
    const tine = k.osc(v, 'sine', hz * 6.27, t);
    const g = k.gain(v, 0);
    k.hit(g, t, 0.25 + 0.3 * vel, 0.035);
    tine.connect(g);
    g.connect(env);
  }
  k.env(v, env, t, n.amp, 0.0015, ring, 0, 0.12, ring);
  return env;
};
