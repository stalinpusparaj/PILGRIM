/**
 * Ambience one-shots made of things (not creatures): far bells, a smith's hammer, cart creaks, bubbles, drips,
 * soft gusts. Every one is small, warm and quiet: kids' ears first (GDD 2.13), no sharp attacks above the bed.
 * Each function builds into a Shot (src/audio/amb-shot.ts) and returns the time it is silent.
 */
import type { Rng } from '../gen/rng';
import { strike, type Shot } from './amb-shot';
import type { AmbEventFn } from './amb-types';

/** Bell partials: [ratio to the strike note, level, decay seconds]. Hum, prime, tierce, quint, nominal. */
const BELL_PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 0.3, 3.4],
  [1, 1, 2.6],
  [1.19, 0.38, 1.7],
  [1.5, 0.2, 1.3],
  [2, 0.28, 1],
];
const BELL_LEVEL = 0.32;

/** A slow, distant bell: 1-4 strikes of one note picked from `pitches` (Hz). */
export function bell(pitches: readonly number[], strikes: readonly [number, number]): AmbEventFn {
  return (s, t, r) => {
    const f = r.pick(pitches);
    const n = r.int(strikes[0], strikes[1]);
    const gap = r.range(1.4, 1.9);
    for (const [ratio, amp, decay] of BELL_PARTIALS) {
      const o = s.osc('sine', f * ratio * r.range(0.998, 1.002));
      const g = s.gain(0);
      o.connect(g).connect(s.input);
      for (let i = 0; i < n; i++)
        strike(g.gain, t + i * gap, amp * BELL_LEVEL * (1 - i * 0.1), 0.008, decay / 4);
    }
    return t + (n - 1) * gap + 4.2;
  };
}

/** Tink partials (a smith's hammer on an anvil, far off): ratio, level, decay. */
const TINK_PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0.35],
  [2.76, 0.45, 0.18],
  [5.4, 0.2, 0.08],
];

/** 2-4 light hammer tinks. */
export const tink: AmbEventFn = (s, t, r) => {
  const f = r.range(1300, 1800);
  const n = r.int(2, 4);
  const gap = r.range(0.42, 0.6);
  for (const [ratio, amp, decay] of TINK_PARTIALS) {
    const o = s.osc('sine', f * ratio);
    const g = s.gain(0);
    o.connect(g).connect(s.input);
    for (let i = 0; i < n; i++)
      strike(g.gain, t + i * gap, amp * 0.3 * (i % 2 === 0 ? 1 : 0.75), 0.003, decay / 4);
  }
  return t + (n - 1) * gap + 0.6;
};

/** A cart wheel creaking: stick-slip pulses through a woody band-pass, 1-3 creaks per turn. */
export const creak: AmbEventFn = (s, t, r) => {
  const o = s.osc('sawtooth', 50);
  const bp = s.filter('bandpass', r.range(800, 1300), 6);
  const g = s.gain(0);
  o.connect(bp).connect(g).connect(s.input);
  const n = r.int(1, 3);
  let ti = t;
  for (let i = 0; i < n; i++) {
    const d = r.range(0.18, 0.34);
    const f0 = r.range(38, 62);
    o.frequency.setValueAtTime(f0, ti);
    o.frequency.linearRampToValueAtTime(f0 * r.range(1.3, 1.8), ti + d * 0.7);
    o.frequency.linearRampToValueAtTime(f0 * 1.1, ti + d);
    g.gain.setTargetAtTime(r.range(0.6, 1), ti, 0.02);
    g.gain.setTargetAtTime(0, ti + d * 0.8, 0.03);
    ti += d + r.range(0.25, 0.5);
  }
  return ti + 0.2;
};

/** A cluster of "blup" bubbles: quick upward sine sweeps through a low-pass (`tone` Hz). */
export function bubbles(lo: number, hi: number, most: number, tone: number): AmbEventFn {
  return (s, t, r) => {
    const o = s.osc('sine', lo);
    const lp = s.filter('lowpass', tone, 0.7);
    const g = s.gain(0);
    o.connect(g).connect(lp).connect(s.input);
    const n = r.int(1, most);
    let ti = t;
    for (let i = 0; i < n; i++) {
      const f0 = r.range(lo, hi);
      o.frequency.setValueAtTime(f0, ti);
      o.frequency.exponentialRampToValueAtTime(f0 * r.range(1.8, 2.8), ti + 0.07);
      strike(g.gain, ti, r.range(0.4, 1), 0.01, 0.025);
      ti += r.range(0.08, 0.24);
    }
    return ti + 0.2;
  };
}

/** A water drop "plink" (sometimes a second, smaller one). */
export function drip(lo: number, hi: number): AmbEventFn {
  return (s, t, r) => {
    const o = s.osc('sine', lo);
    const g = s.gain(0);
    o.connect(g).connect(s.input);
    const n = r.chance(0.3) ? 2 : 1;
    let ti = t;
    for (let i = 0; i < n; i++) {
      const f0 = r.range(lo, hi) * (i === 0 ? 1 : 1.25);
      o.frequency.setValueAtTime(f0, ti);
      o.frequency.exponentialRampToValueAtTime(f0 * 2.1, ti + 0.035);
      strike(g.gain, ti, i === 0 ? 1 : 0.5, 0.004, 0.03);
      ti += r.range(0.1, 0.18);
    }
    return ti + 0.25;
  };
}

/** A soft far-off gust: band-passed pink noise that swells, sweeps up and down and drifts across. */
export const whoosh: AmbEventFn = (s, t, r) => {
  const src = s.noise('pink', r);
  const bp = s.filter('bandpass', 250, 1.2);
  const g = s.gain(0);
  src.connect(bp).connect(g).connect(s.input);
  const d = r.range(2, 3.6);
  bp.frequency.setValueAtTime(220, t);
  bp.frequency.exponentialRampToValueAtTime(r.range(600, 1100), t + d * 0.45);
  bp.frequency.exponentialRampToValueAtTime(260, t + d);
  g.gain.setTargetAtTime(1, t, d * 0.15);
  g.gain.setTargetAtTime(0, t + d * 0.5, d * 0.14);
  sweep(s, r, t, d);
  return t + d * 1.5;
};

/** Moves a panned shot from one side towards the other over `d` seconds. */
export function sweep(s: Shot, r: Rng, t: number, d: number): void {
  if (!s.pan) return;
  const side = r.sign() * r.range(0.35, 0.8);
  s.pan.setValueAtTime(side, t);
  s.pan.linearRampToValueAtTime(-side * r.range(0.3, 1), t + d);
}
