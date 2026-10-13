/**
 * Soft drum kit for playDrum(): K kick, S snare, H closed hat, O open hat, T tom, R rim. Warm and rounded on
 * purpose (a kids' game): no harsh transients, hats kept well below the kick and snare. 3-6 nodes per hit.
 */
import type { Kit } from './inst-kit';
import type { Voice } from './inst-voice';

export type DrumKind = 'K' | 'S' | 'H' | 'O' | 'T' | 'R';

/** Peak gain per drum at vel 0.8 (kit balance: kick and snare lead, hats sit underneath). */
export const DRUM_LEVEL: Readonly<Record<DrumKind, number>> = {
  K: 0.166,
  S: 0.48,
  H: 0.186,
  O: 0.077,
  T: 0.122,
  R: 0.287,
};

export function isDrumKind(s: string): s is DrumKind {
  return s === 'K' || s === 'S' || s === 'H' || s === 'O' || s === 'T' || s === 'R';
}

/** General-MIDI-style note -> drum, for play('drums', ...) callers that send note numbers. */
export function midiToDrum(m: number): DrumKind {
  switch (Math.round(m)) {
    case 35:
    case 36:
      return 'K';
    case 37:
    case 39:
      return 'R';
    case 38:
    case 40:
      return 'S';
    case 42:
    case 44:
      return 'H';
    case 46:
      return 'O';
    default:
      return m < 42 ? 'K' : m < 50 ? 'T' : 'H';
  }
}

/** Builds one drum hit; returns its final gain (envelope recorded on the voice). */
export function buildDrum(k: Kit, v: Voice, kind: DrumKind, t: number, amp: number, vel: number): GainNode {
  const p = 1 + k.wobble(0.012);
  const env = k.gain(v, 0);
  switch (kind) {
    case 'K': {
      // Sine thump with a fast pitch drop, plus a short triangle "knock" an octave up so small speakers hear it.
      const o = k.osc(v, 'sine', 150 * p, t);
      o.frequency.setValueAtTime(150 * p, t);
      o.frequency.exponentialRampToValueAtTime(48 * p, t + 0.12);
      const knock = k.osc(v, 'triangle', 300 * p, t);
      knock.frequency.setValueAtTime(300 * p, t);
      knock.frequency.exponentialRampToValueAtTime(110 * p, t + 0.05);
      const kg = k.gain(v, 0);
      k.hit(kg, t, 0.55 + 0.35 * vel, 0.03);
      o.connect(env);
      knock.connect(kg);
      kg.connect(env);
      k.env(v, env, t, amp, 0.002, 0.42, 0, 0.06, 0.42);
      break;
    }
    case 'S': {
      // Soft, brushy snare: band-passed noise over a short pitched body.
      const nz = k.noise(v, 'pink', t);
      const bp = k.filter(v, 'bandpass', 1900 * p, 0.8);
      const ng = k.gain(v, 0);
      k.hit(ng, t, 1.1, 0.06 + 0.02 * vel);
      nz.connect(bp);
      bp.connect(ng);
      ng.connect(env);
      const body = k.osc(v, 'triangle', 210 * p, t);
      body.frequency.setValueAtTime(210 * p, t);
      body.frequency.exponentialRampToValueAtTime(160 * p, t + 0.06);
      const bg = k.gain(v, 0);
      k.hit(bg, t, 0.75, 0.045);
      body.connect(bg);
      bg.connect(env);
      k.env(v, env, t, amp, 0.0015, 0.32, 0, 0.05, 0.32);
      break;
    }
    case 'H':
    case 'O': {
      const open = kind === 'O';
      const nz = k.noise(v, 'white', t);
      const hp = k.filter(v, 'highpass', (open ? 6500 : 7200) * p, 0.8);
      nz.connect(hp);
      hp.connect(env);
      const len = open ? 0.5 : 0.07;
      k.env(v, env, t, amp, 0.001, len, 0, open ? 0.1 : 0.03, len);
      break;
    }
    case 'T': {
      // Round tom: falling sine plus the drum head's inharmonic 1.5x mode, briefly.
      const o = k.osc(v, 'sine', 132 * p, t);
      o.frequency.setValueAtTime(132 * p, t);
      o.frequency.exponentialRampToValueAtTime(92 * p, t + 0.3);
      const head = k.osc(v, 'triangle', 198 * p, t);
      const hg = k.gain(v, 0);
      k.hit(hg, t, 0.6 + 0.3 * vel, 0.07);
      o.connect(env);
      head.connect(hg);
      hg.connect(env);
      k.env(v, env, t, amp, 0.002, 0.5, 0, 0.08, 0.5);
      break;
    }
    case 'R': {
      // Wooden rim "tock": a short triangle ping with a narrow band of noise.
      const o = k.osc(v, 'triangle', 800 * p, t);
      const nz = k.noise(v, 'white', t);
      const bp = k.filter(v, 'bandpass', 2800 * p, 2.5);
      o.connect(env);
      nz.connect(bp);
      bp.connect(env);
      k.env(v, env, t, amp, 0.0008, 0.07, 0, 0.03, 0.07);
      break;
    }
  }
  return env;
}
