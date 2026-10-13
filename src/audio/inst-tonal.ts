/**
 * Sustained and plucked tonal instruments: pluck, pad, strings, choir, flute, bass. Each builder makes at most
 * six nodes per note and returns its final envelope gain; the bank connects that to `out` and the reverb send
 * (the choir's goes through the shared "aah" formant bank first).
 */
import type { Kit, NoteSpec, VoiceBuilder } from './inst-kit';
import type { Voice } from './inst-voice';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Soft pluck (harp / nylon guitar): a steep-rolloff saw plus a triangle for body, through a low-pass that
 * closes quickly after the strike. Low notes ring longer. 4 nodes.
 */
export const pluck: VoiceBuilder = (k: Kit, v: Voice, n: NoteSpec) => {
  const { t, hz, vel } = n;
  const ring = clamp(1.7 - (n.midi - 48) * 0.028, 0.45, 1.9);
  const o1 = k.wave(v, k.rig.waves.pluck, hz, t, k.wobble(3) - 3);
  const o2 = k.osc(v, 'triangle', hz, t, k.wobble(3) + 4);
  const open = Math.min(hz * (3.5 + 7 * vel), 11000);
  const lp = k.filter(v, 'lowpass', open, 0.7);
  lp.frequency.setValueAtTime(open, t);
  lp.frequency.setTargetAtTime(Math.min(hz * 1.6 + 250, 8000), t + 0.004, 0.07 + ring * 0.06);
  const env = k.gain(v, 0);
  o1.connect(lp);
  o2.connect(lp);
  lp.connect(env);
  const gate = Math.min(Math.max(n.dur, 0.15), ring);
  // Low notes ring longer and so sound louder: trim them so the whole range sits level.
  const comp = Math.pow(10, (clamp(n.midi - 60, -30, 30) * 0.13) / 20);
  k.env(v, env, t, n.amp * comp, 0.004, ring, 0, 0.16 + ring * 0.2, gate);
  return env;
};

/**
 * Warm pad: two saws detuned +-7 cents, one per side, through a low-pass that slowly opens with the slow
 * attack. 5 nodes.
 */
export const pad: VoiceBuilder = (k, v, n) => {
  const { t, hz, vel } = n;
  const o1 = k.osc(v, 'sawtooth', hz, t, -7 + k.wobble(2));
  const o2 = k.osc(v, 'sawtooth', hz, t, 7 + k.wobble(2));
  const m = k.merger(v);
  o1.connect(m, 0, 0);
  o2.connect(m, 0, 1);
  const top = Math.min(450 + hz * 2 + 900 * vel, 4200);
  const lp = k.filter(v, 'lowpass', top * 0.4, 0.5);
  lp.frequency.setValueAtTime(top * 0.4, t);
  lp.frequency.setTargetAtTime(top, t, 0.35);
  const env = k.gain(v, 0);
  m.connect(lp);
  lp.connect(env);
  k.env(v, env, t, n.amp, 0.55, 1.2, 0.75, 1.4, Math.max(n.dur, 0.3));
  return env;
};

/**
 * Bowed string ensemble: three detuned saws (left, centre, right) with a shared 5.6 Hz vibrato, a low-pass
 * that brightens as the bow bites, slow attack (faster when played harder). 6 nodes.
 */
export const strings: VoiceBuilder = (k, v, n) => {
  const { t, hz, vel } = n;
  const o1 = k.osc(v, 'sawtooth', hz, t, -10 + k.wobble(2));
  const o2 = k.osc(v, 'sawtooth', hz, t, k.wobble(2));
  const o3 = k.osc(v, 'sawtooth', hz, t, 10 + k.wobble(2));
  const lfo = k.rig.lfoCents('strings');
  k.linkParam(v, lfo, o1.detune);
  k.linkParam(v, lfo, o2.detune);
  k.linkParam(v, lfo, o3.detune);
  const m = k.merger(v);
  o1.connect(m, 0, 0);
  o2.connect(m, 0, 0);
  o2.connect(m, 0, 1);
  o3.connect(m, 0, 1);
  const attack = clamp(0.3 - 0.16 * vel, 0.08, 0.3);
  const bright = Math.min(1400 + hz * 2.5, 7000) * (0.6 + 0.45 * vel);
  const lp = k.filter(v, 'lowpass', bright * 0.45, 0.6);
  lp.frequency.setValueAtTime(bright * 0.45, t);
  lp.frequency.setTargetAtTime(bright, t, attack * 0.6);
  const env = k.gain(v, 0);
  m.connect(lp);
  lp.connect(env);
  k.env(v, env, t, n.amp, attack, 0.6, 0.85, 0.6, Math.max(n.dur, 0.12));
  return env;
};

/**
 * Choir "aah": three detuned saws (left, centre, right) with a gentle shared vibrato and a slow swell. The
 * vowel comes from the shared formant bank the bank routes this voice into. 5 nodes.
 */
export const choir: VoiceBuilder = (k, v, n) => {
  const { t, hz } = n;
  const o1 = k.osc(v, 'sawtooth', hz, t, -12 + k.wobble(3));
  const o2 = k.osc(v, 'sawtooth', hz, t, 1 + k.wobble(3));
  const o3 = k.osc(v, 'sawtooth', hz, t, 13 + k.wobble(3));
  const lfo = k.rig.lfoCents('choir');
  k.linkParam(v, lfo, o1.detune);
  k.linkParam(v, lfo, o2.detune);
  k.linkParam(v, lfo, o3.detune);
  const m = k.merger(v);
  o1.connect(m, 0, 0);
  o2.connect(m, 0, 0);
  o2.connect(m, 0, 1);
  o3.connect(m, 0, 1);
  const env = k.gain(v, 0);
  m.connect(env);
  k.env(v, env, t, n.amp, 0.42, 0.8, 0.85, 0.9, Math.max(n.dur, 0.25));
  return env;
};

/**
 * Flute-like lead: a soft, mostly-fundamental wave with a tiny pitch scoop at the start, delayed vibrato
 * (shared 5.1 Hz LFO, per-voice depth) and shared breath noise with a little "chiff" on the attack. 4 nodes.
 */
export const flute: VoiceBuilder = (k, v, n) => {
  const { t, hz, vel } = n;
  const o = k.wave(v, k.rig.waves.flute, hz, t, 0);
  o.detune.setValueAtTime(-16, t);
  o.detune.setTargetAtTime(0, t, 0.025);
  const depth = k.gain(v, 0);
  k.linkNode(v, k.rig.lfoRaw('flute'), depth);
  depth.connect(o.detune);
  depth.gain.setValueAtTime(0, t);
  depth.gain.setTargetAtTime(14, t + 0.22, 0.25);
  const breath = k.gain(v, 0);
  k.linkNode(v, k.rig.breath(), breath);
  breath.gain.setValueAtTime(0, t);
  breath.gain.linearRampToValueAtTime(0.22 + 0.25 * vel, t + 0.015);
  breath.gain.setTargetAtTime(0.07, t + 0.015, 0.05);
  const env = k.gain(v, 0);
  o.connect(env);
  breath.connect(env);
  const attack = clamp(0.075 - 0.045 * vel, 0.02, 0.08);
  k.env(v, env, t, n.amp, attack, 0.25, 0.86, 0.14, Math.max(n.dur, 0.08));
  return env;
};

/**
 * Round bass: a gently saturated sine (warm 2nd/3rd harmonics so it is heard on phone speakers) through a
 * low-pass with a soft "pluck" that settles after the attack. 3 nodes.
 */
export const bass: VoiceBuilder = (k, v, n) => {
  const { t, hz, vel } = n;
  const o = k.wave(v, k.rig.waves.bass, hz, t, k.wobble(2));
  const bright = Math.min(240 + hz * 4 + 1400 * vel * vel, 5000);
  const lp = k.filter(v, 'lowpass', bright, 0.8);
  lp.frequency.setValueAtTime(bright, t);
  lp.frequency.setTargetAtTime(bright * 0.55, t + 0.01, 0.18);
  const env = k.gain(v, 0);
  o.connect(lp);
  lp.connect(env);
  k.env(v, env, t, n.amp, 0.008, 0.5, 0.72, 0.1, Math.max(n.dur, 0.08));
  return env;
};
