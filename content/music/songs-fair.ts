/**
 * Vanity Fair's jig and the Delectable Mountains' pastoral.
 * ORIGINAL melodies written for this game (see docs/MUSIC.md). Grammar: src/audio/types.ts TrackDef.
 *
 * Meter note: the jig is 6/8 music written as 2/4 with triplet eighths. The contract counts bpm in meter-bottom
 * notes and the sequencer caps bpm at 260, so a true [6, 8] bar could not go faster than a dotted quarter of 87.
 * Written in 2/4 the beat IS the dotted quarter: bpm 132, a fast jig. The source below counts eighth notes (as in
 * 6/8) and `triplets()` turns every length n into n/3.
 */
import type { SongDef } from '../../src/audio/types';
import { arp, bars, rep, triplets } from './notation';

// --- Vanity Fair (C major, 6/8 feel, fast and a bit too much) --------------------------------------------------------
// A barker's call: "DO' sol DO' sol" (come BUY, come BUY!), a rattle down the scale, then chromatic wiggles. Form
// A B C A; strain C shouts the same call a 5th lower in F. Busy marimba, offbeat plucks, and in 'joy' a
// glockenspiel doubling the tune, which is exactly one layer too many.

const VANITY_A = bars(
  'C6:2 G5:1 C6:2 G5:1', //              C    come BUY, come BUY
  'A5:1 G5:1 F5:1 E5:1 D5:1 C5:1', //    F
  'B4:2 D5:1 G5:2 F5:1', //              G7
  'E5:1 D#5:1 E5:1 G5:2 E5:1', //        C
  'C6:2 G5:1 C6:2 G5:1', //              C
  'A5:1 Bb5:1 A5:1 F5:2 A5:1', //        F
  'G5:1 F5:1 D5:1 B4:1 C5:1 D5:1', //    G7
  'C5:3 E5:1 F#5:1 G5:1', //             C
);
const VANITY_B = bars(
  'E5:1 A5:1 E5:1 C5:1 E5:1 A5:1', //    Am
  'F5:1 A5:1 C6:1 A5:2 F5:1', //         F
  'G5:1 E5:1 C5:1 E5:2 G5:1', //         C
  'B4:1 D5:1 G5:1 B5:3', //              G
  'C6:1 B5:1 A5:1 E5:2 A5:1', //         Am
  'A5:1 G5:1 F5:1 C5:2 F5:1', //         F
  'B4:1 C5:1 D5:1 F5:1 E5:1 D5:1', //    G7
  'C5:2 G4:1 E5:1 F#5:1 G5:1', //        C
);
const VANITY_C = bars(
  'F5:2 C5:1 F5:2 C5:1', //              F    the barker again, a 5th lower
  'Bb5:1 A5:1 G5:1 F5:1 E5:1 D5:1', //   Bb
  'E5:2 G5:1 C6:2 Bb5:1', //             C7
  'A5:1 G#5:1 A5:1 C6:2 A5:1', //        F
  'F5:2 C5:1 F5:2 C5:1', //              F
  'D5:1 F5:1 Bb5:1 A5:1 G5:1 F5:1', //   Bb
  'E5:1 G5:1 Bb5:1 G5:1 E5:1 C5:1', //   C7
  'B4:2 D5:1 G5:2 F5:1', //              G7   and round again
);
const VANITY_TUNE = triplets(bars(VANITY_A, VANITY_B, VANITY_C, VANITY_A));

/** Per chord: [marimba broken chord, offbeat pluck chord, bass root, bass fifth, pad]. */
type JigChord = readonly [string, string, string, string, string];
const C: JigChord = ['C4 E4 G4 C5', 'E4+G4+C5', 'C3', 'G2', 'C4+E4+G4'];
const F: JigChord = ['C4 F4 A4 C5', 'F4+A4+C5', 'F2', 'C3', 'C4+F4+A4'];
const G7: JigChord = ['B3 D4 F4 G4', 'F4+G4+B4', 'G2', 'D3', 'B3+D4+F4'];
const G: JigChord = ['B3 D4 G4 B4', 'D4+G4+B4', 'G2', 'D3', 'B3+D4+G4'];
const AM: JigChord = ['A3 C4 E4 A4', 'E4+A4+C5', 'A2', 'E2', 'C4+E4+A4'];
const BB: JigChord = ['Bb3 D4 F4 Bb4', 'D4+F4+Bb4', 'Bb2', 'F2', 'Bb3+D4+F4'];
const C7: JigChord = ['C4 E4 G4 Bb4', 'E4+G4+Bb4', 'C3', 'G2', 'Bb3+C4+E4'];
const HARM_A = [C, F, G7, C, C, F, G7, C];
const VANITY_HARMONY = [...HARM_A, AM, F, C, G, AM, F, G7, C, F, BB, C7, F, F, BB, C7, G7, ...HARM_A];
const JIG_ROLL = [0, 1, 2, 3, 2, 1] as const;
const VANITY_MARIMBA = triplets(bars(...VANITY_HARMONY.map(([m]) => arp(m, JIG_ROLL, 1, 0.45, 0.6))));
const VANITY_CHK = triplets(bars(...VANITY_HARMONY.map(([, c]) => `.:2 ${c}:1:0.4 .:2 ${c}:1:0.35`)));
const VANITY_BASS = triplets(bars(...VANITY_HARMONY.map(([, , r, f]) => `${r}:3:0.8 ${f}:3:0.65`)));
const VANITY_PAD = triplets(bars(...VANITY_HARMONY.map(([, , , , p]) => `${p}:6`)));
const JIG_KICK = triplets('K:1:0.6 .:2 S:1:0.35 .:2');
const JIG_FILL = triplets('K:1:0.6 .:2 S:1:0.35 S:1:0.35 S:1:0.4');
const JIG_HATS = triplets('H:1:0.3 H:1:0.15 H:1:0.2 H:1:0.3 H:1:0.15 H:1:0.2');

export const VANITY: SongDef = {
  id: 'vanity',
  title: 'Vanity Fair Jig',
  bpm: 132,
  meter: [2, 4],
  loopBars: 32,
  key: 'C major (6/8 jig feel)',
  tracks: [
    { name: 'tune', instrument: 'flute', layer: 'melody', gain: 0.7, notes: VANITY_TUNE, states: ['calm', 'joy', 'boss'] },
    { name: 'glock', instrument: 'bell', layer: 'sparkle', gain: 0.3, notes: VANITY_TUNE, states: ['joy', 'boss'] },
    { name: 'marimba', instrument: 'marimba', layer: 'counter', gain: 0.45, notes: VANITY_MARIMBA, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'chk', instrument: 'pluck', layer: 'counter', gain: 0.35, notes: VANITY_CHK, states: ['calm', 'joy', 'boss'] },
    { name: 'bass', instrument: 'bass', layer: 'bass', gain: 0.6, notes: VANITY_BASS },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.4, notes: VANITY_PAD, states: ['sad', 'tension'] },
    { name: 'drums', instrument: 'drums', layer: 'perc', gain: 0.45, notes: rep(bars(rep(JIG_KICK, 7), JIG_FILL), 4), states: ['joy', 'tension', 'boss'] },
    { name: 'hats', instrument: 'drums', layer: 'perc', gain: 0.3, notes: rep(JIG_HATS, 32), states: ['joy', 'boss'] },
  ],
};

// --- The Delectable Mountains (A major, 3/4, airy) --------------------------------------------------------------
// A shepherd's call across a valley: a long high note falls a 5th, then climbs back a little higher each time
// (E5, F#5, A5), like an echo answering from further up the hill. Open-fifth pad, drone-ish bass, flute on top.

const MOUNTAINS_TUNE = bars(
  'E5:2 A4:1', //               A     the call
  'B4:1 C#5:1 E5:1', //         A     the climb back
  'F#5:2 B4:1', //              Bm    the call, a step higher
  'C#5:1 D5:1 F#5:1', //        Bm
  'A5:2 C#5:1', //              F#m   from the top: a falling 6th
  'D5:1.5 E5:0.5 F#5:1', //     D
  'G#5:1.5 F#5:0.5 E5:1', //    E
  'B4:3', //                    E
  'E5:2 A4:1', //               A
  'B4:1 C#5:1 E5:1', //         A
  'F#5:2 A5:1', //              D     this time the call rises: the view opens
  'A5:1.5 G#5:0.5 F#5:1', //    D     (a lydian G# glint)
  'E5:2 C#5:1', //              A/C#
  'F#5:1 E5:1 D5:1', //         Bm7
  'C#5:1.5 B4:0.5 G#4:1', //    E7
  'A4:3', //                    A
);
/** Per bar: [open-fifth pad, plucked fifths, bass]. */
const MOUNTAINS_HARMONY = [
  ['A3+E4', 'A3 E4 A4', 'A2'], ['A3+E4', 'A3 E4 A4', 'A2'], ['B3+F#4', 'B3 F#4 B4', 'B2'], ['B3+F#4', 'B3 F#4 B4', 'B2'],
  ['F#3+C#4', 'F#3 C#4 F#4', 'F#2'], ['D4+A4', 'D4 A4 D5', 'D3'], ['E3+B3', 'E3 B3 E4', 'E2'], ['E3+B3', 'E3 B3 E4', 'E2'],
  ['A3+E4', 'A3 E4 A4', 'A2'], ['A3+E4', 'A3 E4 A4', 'A2'], ['D4+A4', 'D4 A4 D5', 'D3'], ['D4+A4', 'D4 A4 D5', 'D3'],
  ['A3+E4', 'C#4 E4 A4', 'C#3'], ['B3+F#4', 'B3 F#4 A4', 'B2'], ['E3+B3', 'E3 B3 D4', 'E2'], ['A3+E4', 'A3 E4 A4', 'A2'],
] as const;
const MOUNTAINS_PAD = bars(...MOUNTAINS_HARMONY.map(([p]) => `${p}:3`));
const MOUNTAINS_PLUCK = bars(...MOUNTAINS_HARMONY.map(([, c]) => arp(c, [0, 1, 2], 1, 0.4, 0.5)));
const MOUNTAINS_BASS = bars(...MOUNTAINS_HARMONY.map(([, , b]) => `${b}:3:0.7`));
const MOUNTAINS_BELLS = bars(
  '.:2 A5:1:0.3', '.:3', '.:3', '.:3',
  '.:2 C#6:1:0.25', '.:3', '.:3', '.:2 E5:1:0.25',
  '.:2 A5:1:0.3', '.:3', '.:2 D6:1:0.25', '.:3',
  '.:2 A5:1:0.3', '.:3', '.:3', '.:1 E5:1:0.25 A5:1:0.3',
);

export const MOUNTAINS: SongDef = {
  id: 'mountains',
  title: 'The Delectable Mountains',
  bpm: 88,
  meter: [3, 4],
  loopBars: 16,
  key: 'A major',
  tracks: [
    { name: 'shepherd', instrument: 'flute', layer: 'melody', gain: 0.75, notes: MOUNTAINS_TUNE, states: ['calm', 'joy', 'sad', 'boss'] },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.45, notes: MOUNTAINS_PAD },
    { name: 'fifths', instrument: 'pluck', layer: 'counter', gain: 0.4, notes: MOUNTAINS_PLUCK, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'bass', instrument: 'bass', layer: 'bass', gain: 0.5, notes: MOUNTAINS_BASS, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'bells', instrument: 'bell', layer: 'sparkle', gain: 0.4, notes: MOUNTAINS_BELLS, states: ['joy'] },
  ],
};
