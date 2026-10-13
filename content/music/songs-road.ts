/**
 * Songs of the road: the Burden motif, Mr Worldly Wiseman's waltz and the Interpreter's music box.
 * ORIGINAL melodies written for this game (see docs/MUSIC.md). Grammar: src/audio/types.ts TrackDef.
 */
import type { SongDef } from '../../src/audio/types';
import { arp, bars, octave, pulse, rep } from './notation';

// --- Burden (D minor, 4/4, slow) --------------------------------------------------------------------------------
// Three heavy notes, D-C-G: the Pilgrim hook (D-E-A, a step up then a 4th up) turned upside down (a step down then
// a 4th down). Each answer is a sigh one semitone long that starts higher every time (F-E, Bb-A, D-C#); the last
// answer is the Pilgrim cell itself, D-E-A, very quietly: there is hope under the weight.

const HEAVY = 'D4:1:0.9 C4:1:0.85 G3:2:0.95';
const BURDEN_MOTIF = bars(HEAVY, '.:4', HEAVY, '.:4', HEAVY, '.:4', 'F4:1:0.9 E4:1:0.85 A3:2:0.95', '.:4');
const BURDEN_BASS = bars(
  'D3:1 C3:1 G2:2', 'Bb2:2 A2:2', 'D3:1 C3:1 G2:2', 'G2:2 A2:2',
  'D3:1 C3:1 G2:2', 'Bb2:2 A2:2', 'F2:1 E2:1 A2:2', 'D3:4',
);
const DM_GM = 'F3+A3+D4:2 G3+Bb3+D4:2';
const BB_A = 'F3+Bb3+D4:2 E3+A3+C#4:2';
const BURDEN_PAD = bars(DM_GM, BB_A, DM_GM, 'G3+Bb3+D4:2 E3+A3+C#4:2', DM_GM, BB_A, 'F3+A3+D4:1 E3+A3+C#4:3', 'F3+A3+D4:4');
const BURDEN_ANSWER = bars('.:4', 'F4:2 E4:2', '.:4', 'Bb4:2 A4:2', '.:4', 'D5:2 C#5:2', '.:4', 'D4:1 E4:1 A4:2');
const THUD = 'T:1:0.35 T:1:0.3 T:2:0.4';
const BURDEN_THUD = bars(THUD, '.:4', THUD, '.:4', THUD, '.:4', THUD, '.:4');
/** Tension: a slow tread of eighths on the chord roots. */
const tread = (a: string, b: string): string => `${pulse(a, 4, 0.5, 0.4, 0.3)} ${pulse(b, 4, 0.5, 0.35, 0.28)}`;
const BURDEN_TREAD = bars(
  tread('D3', 'G3'), tread('Bb3', 'A3'), tread('D3', 'G3'), tread('G3', 'A3'),
  tread('D3', 'G3'), tread('Bb3', 'A3'), tread('F3', 'A3'), pulse('D3', 8, 0.5, 0.4, 0.25),
);

export const BURDEN: SongDef = {
  id: 'burden',
  title: 'The Burden',
  bpm: 60,
  meter: [4, 4],
  loopBars: 8,
  key: 'D minor',
  tracks: [
    { name: 'motif', instrument: 'strings', layer: 'melody', gain: 0.75, notes: BURDEN_MOTIF },
    { name: 'bass', instrument: 'bass', layer: 'bass', gain: 0.6, notes: BURDEN_BASS },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.5, notes: BURDEN_PAD },
    { name: 'answer', instrument: 'flute', layer: 'counter', gain: 0.55, notes: BURDEN_ANSWER, states: ['calm', 'joy'] },
    { name: 'answer-choir', instrument: 'choir', layer: 'counter', gain: 0.45, notes: BURDEN_ANSWER, states: ['sad', 'tension'] },
    { name: 'hope', instrument: 'bell', layer: 'sparkle', gain: 0.35, notes: octave(BURDEN_ANSWER, 1), states: ['joy'] },
    { name: 'thud', instrument: 'drums', layer: 'perc', gain: 0.45, notes: BURDEN_THUD, states: ['calm', 'tension', 'boss'] },
    { name: 'tread', instrument: 'pluck', layer: 'counter', gain: 0.4, notes: BURDEN_TREAD, states: ['tension', 'boss'] },
  ],
};

// --- Mr Worldly Wiseman's waltz (F major, 3/4) ------------------------------------------------------------------
// A pompous gentleman going down a grand staircase: every other bar is a falling arpeggio, a step lower each time
// (F5, E5, D5, C5), and between them he fusses with a little chromatic curl. Pizzicato tune, a bassoon-ish flute an
// octave below, oom-pah-pah underneath. Form A B A C; C is a mock-serious episode in D minor.

const WISEMAN_A = bars(
  'F5:1 C5:1 A4:1', //                         F
  'Bb4:0.5 A4:0.5 G#4:0.5 A4:0.5 F4:1', //     F    the curl
  'E5:1 Bb4:1 G4:1', //                        C7
  'A4:0.5 G4:0.5 F#4:0.5 G4:0.5 E4:1', //      C7
  'D5:1 Bb4:1 G4:1', //                        Gm7
  'F4:0.5 E4:0.5 D#4:0.5 E4:0.5 C4:1', //      C7
  'C5:1 A4:1 F4:1', //                         F
  'G4:0.5 A4:0.5 F4:1 .:1', //                 F    "hmph."
);
const WISEMAN_B = bars(
  'D5:1.5 C5:0.5 Bb4:1', //                    Bb
  'F5:1 D5:1 Bb4:1', //                        Bb
  'C5:1.5 Bb4:0.5 A4:1', //                    F/C
  'F5:1 C5:1 A4:1', //                         F
  'B4:0.5 C5:0.5 C#5:0.5 D5:0.5 F5:1', //      G7   a silly chromatic climb
  'E5:1 Bb4:1 G4:1', //                        C7
  'A4:0.5 G#4:0.5 A4:1 F4:1', //               F
  'E4:1 G4:1 C5:1', //                         C7   and up the stairs again
);
const WISEMAN_C = bars(
  'A4:1 D5:1 F5:1', //                         Dm   terribly serious
  'E5:0.5 F5:0.5 E5:0.5 D5:0.5 C#5:1', //      A7
  'D5:1 A4:1 F4:1', //                         Dm
  'E4:0.5 F4:0.5 G4:0.5 F4:0.5 E4:1', //       A7
  'Bb4:1 D5:1 G5:1', //                        Gm
  'E5:0.5 F5:0.5 G5:0.5 E5:0.5 C5:1', //       C7
  'F5:1 C5:1 A4:1', //                         F    a bow
  'G4:1 Bb4:1 E5:1', //                        C7   and back to the top
);
const WISEMAN_TUNE = bars(WISEMAN_A, WISEMAN_B, WISEMAN_A, WISEMAN_C);
const W_A = [
  'A3+C4+F4', 'A3+C4+F4', 'Bb3+C4+E4', 'Bb3+C4+E4', 'Bb3+D4+F4', 'Bb3+C4+E4', 'A3+C4+F4', 'A3+C4+F4',
] as const;
const W_B = [
  'Bb3+D4+F4', 'Bb3+D4+F4', 'A3+C4+F4', 'A3+C4+F4', 'B3+D4+F4', 'Bb3+C4+E4', 'A3+C4+F4', 'Bb3+C4+E4',
] as const;
const W_C = [
  'A3+D4+F4', 'G3+C#4+E4', 'A3+D4+F4', 'G3+C#4+E4', 'Bb3+D4+G4', 'Bb3+C4+E4', 'A3+C4+F4', 'Bb3+C4+E4',
] as const;
const WISEMAN_CHORDS = [...W_A, ...W_B, ...W_A, ...W_C];
const R_A = ['F2', 'C3', 'C3', 'G2', 'G2', 'C3', 'F2', 'C3'] as const;
const R_B = ['Bb2', 'F2', 'C3', 'F2', 'G2', 'C3', 'F2', 'C3'] as const;
const R_C = ['D3', 'A2', 'D3', 'A2', 'G2', 'C3', 'F2', 'C3'] as const;
const WISEMAN_ROOTS = [...R_A, ...R_B, ...R_A, ...R_C];
const WISEMAN_OOM = bars(...WISEMAN_ROOTS.map((r) => `${r}:1:0.8 .:2`));
const WISEMAN_PAH = bars(...WISEMAN_CHORDS.map((c) => `.:1 ${c}:1:0.45 ${c}:1:0.38`));
const WISEMAN_PAD = bars(...WISEMAN_CHORDS.map((c) => `${c}:3`));

export const WISEMAN: SongDef = {
  id: 'wiseman',
  title: "Mr Worldly Wiseman's Waltz",
  bpm: 138,
  meter: [3, 4],
  loopBars: 32,
  key: 'F major',
  tracks: [
    { name: 'pizzicato', instrument: 'pluck', layer: 'melody', gain: 0.75, notes: WISEMAN_TUNE, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'bassoon', instrument: 'flute', layer: 'counter', gain: 0.5, notes: octave(WISEMAN_TUNE, -1) },
    { name: 'flute', instrument: 'flute', layer: 'melody', gain: 0.35, notes: WISEMAN_TUNE, states: ['joy'] },
    { name: 'oom', instrument: 'bass', layer: 'bass', gain: 0.6, notes: WISEMAN_OOM },
    { name: 'pah', instrument: 'pluck', layer: 'counter', gain: 0.35, notes: WISEMAN_PAH, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.4, notes: WISEMAN_PAD, states: ['sad'] },
    { name: 'tock', instrument: 'drums', layer: 'perc', gain: 0.35, notes: rep('.:1 R:1:0.3 R:1:0.22', 32), states: ['joy'] },
  ],
};

// --- The Interpreter's music box (G major, 3/4) -----------------------------------------------------------------
// Curious and gentle: "mi. fa sol, DO'-ti", each phrase reaching a little higher (G5, B5, C6) as if looking at the
// next picture; a lydian C#/F# glint in bars 9 and 14 for wonder. Music-box tune over a music-box arpeggio and pad.

const INTERPRETER_TUNE = bars(
  'B4:1.5 C5:0.5 D5:1', //    G
  'G5:2 F#5:1', //            Em
  'E5:1.5 D5:0.5 C5:1', //    C
  'A4:2 D5:1', //             D
  'B4:1.5 C5:0.5 D5:1', //    G
  'B5:2 A5:1', //             Bm
  'G5:1.5 E5:0.5 C5:1', //    Am7
  'D5:3', //                  D7
  'E5:1.5 F#5:0.5 G5:1', //   C
  'C6:2 B5:1', //             Am
  'B5:1.5 A5:0.5 G5:1', //    G/B
  'B5:1 G#5:1 E5:1', //       E7
  'C6:1 A5:1 E5:1', //        Am
  'G5:1.5 E5:0.5 C#5:1', //   A7/C#
  'C5:1.5 B4:0.5 A4:1', //    D7
  'G4:3', //                  G
);
const INTERPRETER_CHORDS = [
  ['G3 D4 G4 B4', 'G3+B3+D4'], ['E3 B3 E4 G4', 'G3+B3+E4'], ['C3 G3 C4 E4', 'G3+C4+E4'], ['D3 A3 D4 F#4', 'F#3+A3+D4'],
  ['G3 D4 G4 B4', 'G3+B3+D4'], ['F#3 B3 D4 F#4', 'F#3+B3+D4'], ['A3 C4 E4 G4', 'G3+C4+E4'], ['D3 A3 C4 F#4', 'F#3+A3+C4'],
  ['C3 G3 C4 E4', 'G3+C4+E4'], ['A3 C4 E4 A4', 'A3+C4+E4'], ['B3 D4 G4 B4', 'G3+B3+D4'], ['E3 B3 D4 G#4', 'G#3+B3+D4'],
  ['A3 C4 E4 A4', 'A3+C4+E4'], ['C#4 E4 G4 A4', 'G3+C#4+E4'], ['D3 A3 C4 F#4', 'F#3+A3+C4'], ['G3 D4 G4 B4', 'G3+B3+D4'],
] as const;
const BOX_ROLL = [0, 1, 2, 3, 2, 1] as const;
const INTERPRETER_ARP = bars(...INTERPRETER_CHORDS.map(([a]) => arp(a, BOX_ROLL, 0.5, 0.35, 0.45)));
const INTERPRETER_PAD = bars(...INTERPRETER_CHORDS.map(([, p]) => `${p}:3`));
const INTERPRETER_BASS = bars(
  ...['G2', 'E2', 'C3', 'D3', 'G2', 'B2', 'A2', 'D3', 'C3', 'A2', 'B2', 'E2', 'A2', 'C#3', 'D3', 'G2'].map((r) => `${r}:3:0.6`),
);
const INTERPRETER_GLINTS = bars(
  '.:3', '.:1 B5:2:0.3', '.:3', '.:1 F#5:2:0.3',
  '.:3', '.:1 D6:2:0.25', '.:3', '.:1 A5:1:0.3 F#5:1:0.3',
  '.:3', '.:1 E6:2:0.25', '.:3', '.:1 D6:2:0.25',
  '.:3', '.:1 A5:2:0.3', '.:3', '.:1 D6:1:0.25 B5:1:0.25',
);

export const INTERPRETER: SongDef = {
  id: 'interpreter',
  title: "The Interpreter's Music Box",
  bpm: 76,
  meter: [3, 4],
  loopBars: 16,
  key: 'G major',
  tracks: [
    { name: 'box', instrument: 'musicbox', layer: 'melody', gain: 0.75, notes: INTERPRETER_TUNE },
    { name: 'box-roll', instrument: 'musicbox', layer: 'counter', gain: 0.4, notes: INTERPRETER_ARP, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.4, notes: INTERPRETER_PAD },
    { name: 'glints', instrument: 'bell', layer: 'sparkle', gain: 0.4, notes: INTERPRETER_GLINTS, states: ['joy'] },
    { name: 'bass', instrument: 'bass', layer: 'bass', gain: 0.45, notes: INTERPRETER_BASS, states: ['tension', 'boss'] },
  ],
};
