/**
 * Ambience one-shots made of creatures and people: frogs, birds, an owl, bees, far laughter and a fiddler at the
 * fair. All friendly and small (GDD 2.13: kids 6-12, nothing harsh). Each builds into a Shot and returns the time
 * it is silent. The fiddle phrases are random walks on a pentatonic scale, not tunes.
 */
import type { Rng } from '../gen/rng';
import { midiToHz } from './Synth';
import { hold, type Shot } from './amb-shot';
import { sweep } from './amb-events';
import type { AmbEventFn } from './amb-types';

/** A "rib-bit": a buzzy croak (pulsed saw through a throat band-pass), 1-3 croaks, the last one higher. */
export function frog(lo: number, hi: number): AmbEventFn {
  return (s, t, r) => {
    const f = r.range(lo, hi);
    const o = s.osc('sawtooth', f);
    const bp = s.filter('bandpass', f * r.range(3.5, 5), 3);
    const am = s.gain(0.5);
    const lfo = s.osc('square', r.range(22, 34));
    lfo.connect(s.gain(0.5)).connect(am.gain);
    const g = s.gain(0);
    o.connect(bp).connect(am).connect(g).connect(s.input);
    const n = r.chance(0.65) ? 2 : r.chance(0.5) ? 3 : 1;
    let ti = t;
    for (let i = 0; i < n; i++) {
      const d = r.range(0.11, 0.2);
      const fi = n > 1 && i === n - 1 ? f * 1.12 : f;
      o.frequency.setValueAtTime(fi, ti);
      o.frequency.exponentialRampToValueAtTime(fi * 0.86, ti + d);
      hold(g.gain, ti, 1, 0.012, ti + d * 0.75, 0.025);
      ti += d + r.range(0.07, 0.14);
    }
    return ti + 0.15;
  };
}

const OWL_AT: readonly number[] = [0, 0.62, 0.92];
const OWL_DUR: readonly number[] = [0.42, 0.22, 0.42];

/** A friendly owl: "hoo... hoo-hoo". */
export const owl: AmbEventFn = (s, t, r) => {
  const f = r.range(330, 400);
  const o = s.osc('sine', f);
  const lp = s.filter('lowpass', 900, 0.7);
  const g = s.gain(0);
  o.connect(lp).connect(g).connect(s.input);
  for (let i = 0; i < OWL_AT.length; i++) {
    const ti = t + (OWL_AT[i] ?? 0);
    const d = OWL_DUR[i] ?? 0.3;
    o.frequency.setValueAtTime(f * 1.03, ti);
    o.frequency.exponentialRampToValueAtTime(f * 0.93, ti + d);
    hold(g.gain, ti, i === 1 ? 0.7 : 1, 0.03, ti + d * 0.65, 0.05);
  }
  return t + 1.8;
};

export type BirdKind = 'tweet' | 'whistle' | 'trill' | 'warble' | 'cheep';

/** A small bird call around `pitch` Hz. One sine voice; the call shape comes from frequency/gain automation. */
export function bird(kind: BirdKind, pitch: number): AmbEventFn {
  return (s, t, r) => {
    const p = pitch * r.range(0.94, 1.06);
    const o = s.osc('sine', p);
    const g = s.gain(0);
    o.connect(g).connect(s.input);
    switch (kind) {
      case 'tweet':
        return tweet(o, g, t, r, p);
      case 'whistle':
        return whistle(o, g, t, p);
      case 'trill':
        return trill(s, o, g, t, r, p);
      case 'warble':
        return warble(o, g, t, r, p);
      case 'cheep':
        return cheep(o, g, t, r, p);
    }
  };
}

function tweet(o: OscillatorNode, g: GainNode, t: number, r: Rng, p: number): number {
  let ti = t;
  const n = r.int(2, 4);
  for (let i = 0; i < n; i++) {
    const d = r.range(0.05, 0.08);
    o.frequency.setValueAtTime(p * 0.75, ti);
    o.frequency.exponentialRampToValueAtTime(p * 1.15, ti + d);
    hold(g.gain, ti, 1, 0.006, ti + d * 0.7, 0.012);
    ti += d + r.range(0.04, 0.07);
  }
  return ti + 0.1;
}

function whistle(o: OscillatorNode, g: GainNode, t: number, p: number): number {
  o.frequency.setValueAtTime(p, t);
  o.frequency.linearRampToValueAtTime(p * 1.02, t + 0.2);
  hold(g.gain, t, 0.9, 0.02, t + 0.17, 0.02);
  const t2 = t + 0.3;
  o.frequency.setValueAtTime(p * 0.8, t2);
  o.frequency.linearRampToValueAtTime(p * 0.78, t2 + 0.26);
  hold(g.gain, t2, 0.8, 0.02, t2 + 0.22, 0.03);
  return t2 + 0.45;
}

function trill(s: Shot, o: OscillatorNode, g: GainNode, t: number, r: Rng, p: number): number {
  const am = s.gain(0.5);
  const lfo = s.osc('sine', r.range(16, 24));
  lfo.connect(s.gain(0.5)).connect(am.gain);
  o.disconnect();
  o.connect(am).connect(g);
  const d = r.range(0.4, 0.7);
  o.frequency.setValueAtTime(p * 1.1, t);
  o.frequency.exponentialRampToValueAtTime(p * 0.9, t + d);
  hold(g.gain, t, 0.9, 0.03, t + d * 0.85, 0.03);
  return t + d + 0.2;
}

function warble(o: OscillatorNode, g: GainNode, t: number, r: Rng, p: number): number {
  const n = r.int(5, 8);
  let ti = t;
  o.frequency.setValueAtTime(p, t);
  for (let i = 0; i < n; i++) {
    const d = r.range(0.06, 0.09);
    o.frequency.exponentialRampToValueAtTime(p * r.range(0.75, 1.3), ti + 0.02);
    g.gain.setTargetAtTime(r.range(0.6, 1), ti, 0.008);
    g.gain.setTargetAtTime(0.12, ti + d * 0.7, 0.01);
    ti += d + 0.02;
  }
  g.gain.setTargetAtTime(0, ti, 0.015);
  return ti + 0.15;
}

function cheep(o: OscillatorNode, g: GainNode, t: number, r: Rng, p: number): number {
  const n = r.int(1, 2);
  let ti = t;
  for (let i = 0; i < n; i++) {
    o.frequency.setValueAtTime(p * 1.4, ti);
    o.frequency.exponentialRampToValueAtTime(p * 0.9, ti + 0.07);
    hold(g.gain, ti, 1, 0.005, ti + 0.05, 0.012);
    ti += 0.13;
  }
  return ti + 0.1;
}

/** A bee buzzing past: vibrato saw through a soft band-pass, swelling in and out while it drifts across. */
export const bee: AmbEventFn = (s, t, r) => {
  const f = r.range(185, 235);
  const o = s.osc('sawtooth', f);
  const vib = s.osc('sine', r.range(7, 11));
  vib.connect(s.gain(r.range(4, 9))).connect(o.frequency);
  const bp = s.filter('bandpass', r.range(450, 650), 0.9);
  const lp = s.filter('lowpass', 2400, 0.7);
  const g = s.gain(0);
  o.connect(bp).connect(lp).connect(g).connect(s.input);
  const d = r.range(2.5, 4.5);
  o.frequency.setValueAtTime(f, t);
  o.frequency.linearRampToValueAtTime(f * 1.04, t + d * 0.45);
  o.frequency.linearRampToValueAtTime(f * 0.95, t + d);
  hold(g.gain, t, 1, d * 0.12, t + d * 0.65, d * 0.1);
  sweep(s, r, t, d);
  return t + d * 1.45;
};

/** Far-off laughter blips: "ha-ha-ha" syllables through a vowel band-pass, falling in pitch. */
export const laugh: AmbEventFn = (s, t, r) => {
  const child = r.chance(0.3);
  const f = child ? r.range(360, 460) : r.range(190, 300);
  const o = s.osc('sawtooth', f);
  const bp = s.filter('bandpass', child ? 1300 : 950, 1.4);
  const g = s.gain(0);
  o.connect(bp).connect(g).connect(s.input);
  const n = r.int(3, 6);
  let ti = t;
  for (let i = 0; i < n; i++) {
    const fi = f * (1 - 0.035 * i);
    const d = r.range(0.06, 0.09);
    o.frequency.setValueAtTime(fi * 1.1, ti);
    o.frequency.exponentialRampToValueAtTime(fi, ti + d);
    hold(g.gain, ti, 1 - i * 0.1, 0.008, ti + d * 0.6, 0.02);
    ti += d + r.range(0.05, 0.08);
  }
  return ti + 0.15;
};

/** D major pentatonic, D4..A5 (MIDI). */
const FIDDLE_SCALE: readonly number[] = [62, 64, 66, 69, 71, 74, 76, 78, 81];

/** A fiddler across the fair: a short jig-rhythm (long-short) random walk of plucky saw notes. */
export const fiddle: AmbEventFn = (s, t, r) => {
  const o = s.osc('sawtooth', 300);
  const vib = s.osc('sine', 5.5);
  vib.connect(s.gain(3)).connect(o.frequency);
  const lp = s.filter('lowpass', 1800, 0.8);
  const g = s.gain(0);
  o.connect(lp).connect(g).connect(s.input);
  const n = r.int(5, 9);
  let idx = r.int(2, 5);
  let ti = t;
  for (let i = 0; i < n; i++) {
    const long = i % 2 === 0;
    const hz = midiToHz(FIDDLE_SCALE[idx] ?? 69);
    if (i === 0) o.frequency.setValueAtTime(hz, ti);
    else o.frequency.setTargetAtTime(hz, ti, 0.008);
    g.gain.setTargetAtTime(long ? 1 : 0.75, ti, 0.006);
    g.gain.setTargetAtTime(0.12, ti + 0.03, 0.06);
    idx = Math.max(0, Math.min(FIDDLE_SCALE.length - 1, idx + r.int(-2, 2)));
    ti += long ? 0.24 : 0.12;
  }
  g.gain.setTargetAtTime(0, ti - 0.03, 0.03);
  return ti + 0.3;
};
