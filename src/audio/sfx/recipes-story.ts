/** The Burden and the Cross, the Roll, Promises and waystones: the story's signature sounds. */
import { bp, chime, hp, lp, noise, osc, type RecipeTable } from './recipes-kit';

type StoryId =
  | 'burden_creak'
  | 'burden_huff'
  | 'burden_boing'
  | 'rope_snap'
  | 'sack_roll'
  | 'tomb_thoom'
  | 'joy_note'
  | 'sparkle'
  | 'roll_unroll'
  | 'promise_chime'
  | 'waystone_save';

const BOING_BEND = [
  [0, -7],
  [0.05, 0],
  [0.75, 4],
] as const;
const BOING_VIB = { rate: 14, depth: 2.5, fade: 0.7 } as const;

export const STORY_RECIPES: RecipeTable<StoryId> = {
  /** Rope-and-sack creak: a slow pulse train ringing through a woody band-pass. */
  burden_creak: {
    len: 0.7,
    level: 0.28,
    variants: 3,
    poly: 2,
    vary: { pitch: 2, volume: 0.2 },
    tone: 4000,
    layers: [
      {
        src: osc('sawtooth', [55, 75], {
          bend: [
            [0, 0],
            [0.2, 2],
            [0.45, -1],
          ],
        }),
        env: { a: 0.06, h: 0.1, d: 0.3 },
        gain: 1,
        trem: { rate: [18, 26], depth: 0.85 },
        filters: [bp([700, 900], 3), lp(2500)],
      },
      { src: noise('pink'), env: { a: 0.1, d: 0.3 }, gain: 0.15, filters: [bp(1200, 6)] },
    ],
  },
  /** A tired little "hff". */
  burden_huff: {
    len: 0.5,
    level: 0.3,
    variants: 3,
    poly: 2,
    vary: { pitch: 1.5, volume: 0.2 },
    tone: 3500,
    layers: [
      {
        src: noise('pink'),
        env: { a: 0.05, h: 0.05, d: 0.25 },
        gain: 1,
        filters: [bp(1300, 1, [[0.3, 700]]), hp(300)],
      },
      {
        src: osc('sawtooth', [150, 170], {
          bend: [
            [0, 1],
            [0.3, -3],
          ],
        }),
        env: { a: 0.05, d: 0.2 },
        gain: 0.12,
        filters: [bp(600, 3), lp(1200)],
      },
    ],
  },
  /** Springy cartoon boing: a wobbling glide up with a jaw-harp "oi" from a sweeping formant. */
  burden_boing: {
    len: 0.95,
    level: 0.55,
    poly: 2,
    vary: { pitch: 0.5 },
    tone: 4000,
    reverb: { seconds: 0.6, decay: 3, mix: 0.12 },
    layers: [
      {
        src: osc('triangle', 196, { bend: BOING_BEND, vib: BOING_VIB }),
        env: { a: 0.004, h: 0.05, d: 0.7 },
        gain: 1,
        filters: [lp(2500)],
      },
      { src: osc('sine', 98, { bend: BOING_BEND, vib: BOING_VIB }), env: { a: 0.004, d: 0.45 }, gain: 0.5 },
      {
        src: osc('sawtooth', 98, { bend: BOING_BEND, vib: BOING_VIB }),
        env: { a: 0.005, d: 0.6 },
        gain: 0.35,
        filters: [
          bp(400, 4, [
            [0.12, 1500],
            [0.7, 700],
          ]),
        ],
      },
      { src: noise('brown'), env: { a: 0.002, d: 0.05 }, gain: 0.4, filters: [lp(400)] },
    ],
  },
  /** Twangy plucked snap. stepPitch('rope_snap', 0..2) = the three ropes, each a little higher. */
  rope_snap: {
    len: 0.7,
    level: 0.5,
    variants: 3,
    poly: 3,
    steps: [0, 4, 7],
    vary: { pitch: 0.3 },
    tone: 6000,
    reverb: { seconds: 0.8, decay: 3, mix: 0.15 },
    layers: [
      {
        src: osc('triangle', [305, 318], {
          bend: [
            [0, 6],
            [0.025, 0],
            [0.5, -0.5],
          ],
          fm: { ratio: 2, index: 2.5, indexEnd: 0 },
        }),
        env: { a: 0.001, d: 0.45 },
        gain: 0.8,
      },
      {
        src: osc('sawtooth', 311, {
          bend: [
            [0, 6],
            [0.025, 0],
          ],
        }),
        env: { a: 0.001, d: 0.3 },
        gain: 0.35,
        filters: [lp(3500, 0, [[0.25, 500]])],
      },
      { src: noise('white'), env: { a: 0.001, d: 0.018 }, gain: 0.7, filters: [hp(1800)] },
      { src: noise('pink'), env: { a: 0.002, d: 0.07 }, gain: 0.35, filters: [bp(3000, 3, [[0.07, 900]])] },
    ],
  },
  /** The sack tumbling downhill: soft bumps that slow and fade, over a rustle. */
  sack_roll: {
    len: 1.8,
    level: 0.45,
    variants: 2,
    poly: 1,
    vary: { pitch: 1 },
    tone: 2500,
    layers: [
      {
        src: noise('brown'),
        env: { a: 0.003, d: [0.07, 0.1] },
        gain: 1,
        filters: [lp([400, 550])],
        repeat: { count: [6, 8], every: [0.13, 0.2], fade: 0.88, sync: 'bump' },
      },
      {
        src: osc('sine', [70, 90], {
          bend: [
            [0, 3],
            [0.05, 0],
          ],
        }),
        env: { a: 0.003, d: 0.08 },
        gain: 0.6,
        repeat: { count: [6, 8], every: [0.13, 0.2], fade: 0.88, sync: 'bump' },
      },
      { src: noise('pink'), env: { a: 0.1, h: 0.6, d: 0.5 }, gain: 0.2, filters: [bp(1500, 0.8)] },
    ],
  },
  /** Deep, soft, echoing "thoom" as the burden drops into the open tomb. */
  tomb_thoom: {
    len: 3.4,
    level: 0.7,
    poly: 1,
    tone: 1800,
    echo: { time: 0.32, feedback: 0.42, mix: 0.45, tone: 700 },
    reverb: { seconds: 2.4, decay: 2.5, mix: 0.45 },
    layers: [
      {
        src: osc('sine', 64, {
          bend: [
            [0, 7],
            [0.12, 0],
            [1, -2],
          ],
        }),
        env: { a: 0.012, h: 0.05, d: 1.1 },
        gain: 1,
      },
      { src: noise('brown'), env: { a: 0.008, d: 0.35 }, gain: 0.8, filters: [lp(260)] },
      {
        src: osc('triangle', 128, {
          bend: [
            [0, 5],
            [0.1, 0],
          ],
        }),
        env: { a: 0.01, d: 0.6 },
        gain: 0.35,
        filters: [bp(150, 5)],
      },
      { src: noise('pink'), env: { a: 0.004, d: 0.04 }, gain: 0.3, filters: [lp(900)] },
    ],
  },
  /** Bright rising chime for the joy jumps: stepPitch('joy_note', 0, 1, 2...) climbs a D major arpeggio. */
  joy_note: {
    len: 1.6,
    level: 0.5,
    poly: 4,
    steps: [0, 4, 7],
    rate: 32000,
    reverb: { seconds: 1.4, decay: 3, mix: 0.25 },
    layers: [
      {
        src: osc('sine', 587.33, {
          bend: [
            [0, -1.5],
            [0.05, 0],
          ],
          fm: { ratio: 2, index: 1.6, indexEnd: 0.1 },
        }),
        env: { a: 0.003, d: 1.1 },
        gain: 0.8,
      },
      { src: osc('sine', 1174.66), env: { a: 0.003, d: 0.5 }, gain: 0.3 },
      { src: osc('triangle', 2349.32), at: 0.04, env: { a: 0.002, d: 0.18 }, gain: 0.12 },
      {
        src: osc('sine', 1760, {
          bend: [
            [0, -5],
            [0.12, 0],
          ],
        }),
        env: { a: 0.002, d: 0.08 },
        gain: 0.15,
        repeat: { count: 3, every: 0.04, step: 4, fade: 0.7 },
      },
    ],
  },
  /** Glittery shimmer. */
  sparkle: {
    len: 1,
    level: 0.32,
    variants: 3,
    poly: 3,
    vary: { pitch: 1.5, volume: 0.2 },
    rate: 32000,
    reverb: { seconds: 1, decay: 3, mix: 0.3 },
    layers: [
      {
        src: osc('sine', [2200, 3300], { fm: { ratio: 3, index: 0.6, indexEnd: 0 } }),
        env: { a: 0.002, d: [0.1, 0.18] },
        gain: 0.6,
        repeat: { count: [5, 7], every: [0.03, 0.07], fade: 0.85, step: [1, 4] },
      },
      { src: noise('white'), env: { a: 0.05, d: 0.3 }, gain: 0.06, filters: [bp(7000, 2)] },
    ],
  },
  /** Paper unrolling: a rising slide, little crinkles and a soft flop at the end. */
  roll_unroll: {
    len: 0.9,
    level: 0.35,
    variants: 2,
    poly: 1,
    tone: 7000,
    layers: [
      {
        src: noise('pink'),
        env: { a: 0.06, h: 0.2, d: 0.3 },
        gain: 0.7,
        filters: [
          bp(1400, 1.4, [
            [0.4, 3200],
            [0.6, 2400],
          ]),
          hp(600),
        ],
      },
      {
        src: noise('white'),
        env: { a: 0.001, d: [0.01, 0.02] },
        gain: 0.35,
        filters: [bp([3000, 4500], 3)],
        repeat: { count: [8, 12], every: [0.025, 0.06], fade: 0.93 },
      },
      { src: noise('brown'), at: 0.55, env: { a: 0.01, d: 0.12 }, gain: 0.22, filters: [lp(500)] },
    ],
  },
  /** Magical three-note arpeggio (G major, rising) with a shimmer. */
  promise_chime: {
    len: 2.2,
    level: 0.5,
    poly: 2,
    rate: 32000,
    reverb: { seconds: 1.8, decay: 2.8, mix: 0.35 },
    layers: [
      ...chime(783.99, 0, 0.7, 0.8),
      ...chime(987.77, 0.1, 0.7, 0.8),
      ...chime(1174.66, 0.2, 0.8, 1.4),
      { src: noise('white'), at: 0.15, env: { a: 0.2, d: 0.6 }, gain: 0.04, filters: [bp(6000, 1.5)] },
    ],
  },
  /** Warm two-tone: up a fourth, soft and round. */
  waystone_save: {
    len: 2,
    level: 0.5,
    poly: 1,
    tone: 5000,
    reverb: { seconds: 1.6, decay: 3, mix: 0.3 },
    layers: [
      { src: osc('triangle', 440), env: { a: 0.02, d: 0.9 }, gain: 0.6, filters: [lp(2200)] },
      { src: osc('sine', 220), env: { a: 0.02, d: 0.8 }, gain: 0.35 },
      { src: osc('triangle', 587.33), at: 0.2, env: { a: 0.02, d: 1.3 }, gain: 0.65, filters: [lp(2200)] },
      { src: osc('sine', 293.66), at: 0.2, env: { a: 0.02, d: 1.2 }, gain: 0.35 },
      {
        src: osc('sine', 1174.66, { fm: { ratio: 2, index: 0.5, indexEnd: 0 } }),
        at: 0.2,
        env: { a: 0.005, d: 0.6 },
        gain: 0.12,
      },
    ],
  },
};
