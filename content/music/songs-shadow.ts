/**
 * Songs for dark places: Apollyon's march, the Valley drone, Giant Despair's drone and the generic tension bed.
 * Cartoon peril only (GDD 1.6): low and heavy, never shrill, never sudden. ORIGINAL melodies (see docs/MUSIC.md).
 * Grammar: src/audio/types.ts TrackDef.
 */
import type { SongDef } from '../../src/audio/types';
import { bars, octave, pulse, rep } from './notation';

// --- Apollyon (E minor, 4/4 march) ------------------------------------------------------------------------------
// "DUM . da-DOOM": a stamp and a leap up a 5th, then a heavy fall. The middle creeps upward in half notes over a
// drumming E pedal, like a big lizard climbing the road, before the stamp comes back.

const STAMP = 'E3:1 .:0.5 E3:0.5 B3:2';
const APOLLYON_TUNE = bars(
  STAMP, //                                  Em
  'C4:1 B3:1 G3:1 E3:1', //                  C
  'A3:1 .:0.5 A3:0.5 E4:2', //               Am
  'F#4:1 D#4:1 B3:1 A3:1', //                B7
  STAMP, //                                  Em
  'C4:1 D4:1 E4:1 G4:1', //                  C
  'A4:1.5 G4:0.5 F#4:1 D#4:1', //            Am B7
  'E4:1 B3:1 E3:2', //                       Em   stomp, stomp, STOMP
  'G3:2 F#3:2', //                           Em   (the creep)
  'A3:2 G3:2', //                            Am/E
  'B3:2 A3:2', //                            Em
  'C4:2 B3:2', //                            C
  'E4:1.5 D4:0.5 C4:1 A3:1', //              Am
  'D#4:2 F#4:2', //                          B7
  'G4:1 F#4:1 E4:1 C4:1', //                 Em C
  'B3:1 A3:1 F#3:1 D#3:1', //                B7
);
const APOLLYON_BASS = bars(
  'E2:1 B2:1 E2:1 B2:1', 'C3:1 G2:1 C3:1 G2:1', 'A2:1 E2:1 A2:1 E2:1', 'B2:1 F#2:1 B2:1 F#2:1',
  'E2:1 B2:1 E2:1 B2:1', 'C3:1 G2:1 C3:1 G2:1', 'A2:1 E2:1 B2:1 F#2:1', 'E2:1 B2:1 E2:2',
  'E2:1 E2:1 E2:1 E2:1', 'E2:1 E2:1 E2:1 E2:1', 'E2:1 E2:1 E2:1 E2:1', 'C3:1 C3:1 C3:1 C3:1',
  'A2:1 E2:1 A2:1 E2:1', 'B2:1 F#2:1 B2:1 F#2:1', 'E2:1 B2:1 C3:1 G2:1', 'B2:2 F#2:2',
);
const EM = 'G3+B3+E4:4';
const C_ = 'G3+C4+E4:4';
const AM = 'A3+C4+E4:4';
const B7 = 'F#3+A3+D#4:4';
/** Bars 9-12 sit on a bare E pedal so the creeping strings can lean on it without grinding against a full chord. */
const PEDAL = 'E3+B3+E4:4';
const APOLLYON_PAD = bars(
  EM, C_, AM, B7, EM, C_, 'A3+C4+E4:2 F#3+A3+D#4:2', EM,
  PEDAL, PEDAL, PEDAL, 'E3+G3+E4:4', AM, B7, 'G3+B3+E4:2 G3+C4+E4:2', B7,
);
const APOLLYON_CHOIR = bars(
  'E4:4', 'E4:4', 'E4:4', 'D#4:4', 'E4:4', 'E4:4', 'E4:2 D#4:2', 'E4:4',
  'B3:4', 'C4:4', 'B3:4', 'E4:4', 'C4:4', 'D#4:4', 'E4:4', 'D#4:4',
);
const BOOT = 'K:1:0.7 .:1 K:1:0.6 .:1';
const BOOT_END = 'K:1:0.7 .:1 K:1:0.6 K:0.5:0.5 K:0.5:0.55';
const SNARE = '.:1 S:1:0.4 .:1 S:0.5:0.35 S:0.25:0.25 S:0.25:0.3';
const SNARE_END = '.:1 S:1:0.4 T:0.5:0.45 T:0.5:0.4 T:0.5:0.45 T:0.5:0.5';

export const APOLLYON: SongDef = {
  id: 'apollyon',
  title: "Apollyon's March",
  bpm: 84,
  meter: [4, 4],
  loopBars: 16,
  key: 'E minor',
  tracks: [
    { name: 'strings', instrument: 'strings', layer: 'melody', gain: 0.8, notes: APOLLYON_TUNE, states: ['calm', 'tension', 'boss', 'sad'] },
    { name: 'strings-hi', instrument: 'strings', layer: 'melody', gain: 0.35, notes: octave(APOLLYON_TUNE, 1), states: ['boss', 'joy'] },
    { name: 'bass', instrument: 'bass', layer: 'bass', gain: 0.6, notes: APOLLYON_BASS, states: ['calm', 'tension', 'boss', 'joy'] },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.45, notes: APOLLYON_PAD, states: ['calm', 'sad', 'joy'] },
    { name: 'choir', instrument: 'choir', layer: 'counter', gain: 0.4, notes: APOLLYON_CHOIR, states: ['boss'] },
    { name: 'boots', instrument: 'drums', layer: 'perc', gain: 0.5, notes: bars(rep(BOOT, 7), BOOT_END, rep(BOOT, 7), BOOT_END), states: ['tension', 'boss'] },
    { name: 'snare', instrument: 'drums', layer: 'perc', gain: 0.4, notes: bars(rep(SNARE, 7), SNARE_END, rep(SNARE, 7), SNARE_END), states: ['boss'] },
  ],
};

// --- The Valley of the Shadow (E, ambiguous, very slow) ---------------------------------------------------------
// Spooky-fun, not frightening: a low E drone under suspended chords that slide to a neighbouring F chord and back,
// an "aah" choir that leans on half steps, rare bell twinkles, and (in 'tension') a cartoon tiptoe on whole tones.

const VALLEY_PAD = bars(
  'B3+E4+F#4:4', 'B3+E4+F#4:4', 'C4+F4+A4:4', 'B3+E4+G4:4',
  'A3+D4+F#4:4', 'C4+E4+G4:4', 'C4+F4+A4:4', 'B3+E4+F#4:4',
);
const VALLEY_CHOIR = bars('B4:4', 'B4:2 C5:2', 'C5:4', 'B4:4', 'A4:4', 'G4:4', 'A4:2 C5:2', 'B4:4');
const VALLEY_BELL = bars(
  '.:2 G#5:2:0.3', '.:4', '.:1 A5:1:0.25 .:2', '.:3 D6:1:0.2',
  '.:2 F#5:2:0.3', '.:4', '.:1 C6:1:0.25 .:2', '.:3 F#5:1:0.25',
);
/** Staccato tiptoe: four notes per bar, each followed by a rest. */
const tip = (a: string, b: string, c: string, d: string): string =>
  `${a}:0.5:0.5 .:0.5 ${b}:0.5:0.45 .:0.5 ${c}:0.5:0.5 .:0.5 ${d}:0.5:0.45 .:0.5`;
const VALLEY_TIPTOE = bars(
  tip('E3', 'F#3', 'G#3', 'A#3'), tip('C4', 'A#3', 'G#3', 'F#3'), tip('F3', 'A3', 'C4', 'A3'), tip('E3', 'G3', 'B3', 'A#3'),
  tip('D3', 'F#3', 'A3', 'F#3'), tip('E3', 'G3', 'C4', 'G3'), tip('F3', 'A3', 'C4', 'B3'), 'E3:0.5:0.5 .:0.5 F#3:0.5:0.45 .:0.5 B3:0.5:0.5 .:1.5',
);
const HOPE_E = 'E4:1 F#4:1 B4:2';

export const VALLEY: SongDef = {
  id: 'valley',
  title: 'The Valley of the Shadow',
  bpm: 52,
  meter: [4, 4],
  loopBars: 8,
  key: 'E (suspended, ambiguous)',
  tracks: [
    { name: 'drone', instrument: 'bass', layer: 'bass', gain: 0.5, notes: rep('E2:4:0.6', 8) },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.5, notes: VALLEY_PAD },
    { name: 'choir', instrument: 'choir', layer: 'melody', gain: 0.45, notes: VALLEY_CHOIR, states: ['calm', 'sad', 'tension', 'boss'] },
    { name: 'twinkles', instrument: 'bell', layer: 'sparkle', gain: 0.4, notes: VALLEY_BELL, states: ['calm', 'joy', 'tension'] },
    { name: 'tiptoe', instrument: 'pluck', layer: 'counter', gain: 0.4, notes: VALLEY_TIPTOE, states: ['tension', 'boss'] },
    { name: 'heartbeat', instrument: 'drums', layer: 'perc', gain: 0.35, notes: rep('K:0.5:0.3 K:0.5:0.22 .:3', 8), states: ['boss'] },
    { name: 'hope', instrument: 'flute', layer: 'melody', gain: 0.5, notes: bars('.:4', '.:4', '.:4', HOPE_E, '.:4', '.:4', '.:4', HOPE_E), states: ['joy'] },
  ],
};

// --- Giant Despair (C minor, slow drone) ------------------------------------------------------------------------
// A dark low pad that barely moves (C minor, A-flat, F minor, G) and bells that drip, slow and uneven, in the
// dungeon. In 'joy' the drips give way to the Pilgrim cell, C-D-G: the Key of Promise is near.

const CM = 'C3+G3+Eb4:4';
const AB = 'C3+Ab3+Eb4:4';
const DESPAIR_PAD = bars(CM, AB, CM, 'C3+F3+Ab3:4', CM, AB, 'B2+D3+G3:4', CM);
const DESPAIR_BASS = bars('C3:4:0.5', 'C3:4:0.5', 'C3:4:0.5', 'F2:4:0.5', 'C3:4:0.5', 'C3:4:0.5', 'G2:4:0.5', 'C3:4:0.5');
const DESPAIR_DRIPS = bars(
  '.:1.5 G5:0.5:0.3 .:2', '.:3 Eb5:0.5:0.25 C5:0.5:0.2', '.:4', '.:0.5 C6:0.5:0.25 .:1 Ab5:0.5:0.2 .:1.5',
  '.:2.5 Eb5:0.5:0.3 .:1', '.:4', '.:1 D5:0.5:0.25 .:0.5 G5:0.5:0.2 .:1.5', '.:3 C5:1:0.25',
);
const DESPAIR_STRINGS = bars('G3:4', 'Ab3:4', 'G3:4', 'F3:2 Ab3:2', 'G3:4', 'Ab3:4', 'D4:2 B3:2', 'C4:4');
const DESPAIR_CHOIR = bars('G4:4', 'Ab4:4', 'G4:4', 'F4:2 Ab4:2', 'G4:4', 'Ab4:2 Eb4:2', 'D4:2 F4:2', 'Eb4:4');
const HOPE_C = 'C5:1 D5:1 G5:2';

export const DESPAIR: SongDef = {
  id: 'despair',
  title: 'Giant Despair',
  bpm: 54,
  meter: [4, 4],
  loopBars: 8,
  key: 'C minor',
  tracks: [
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.55, notes: DESPAIR_PAD },
    { name: 'bass', instrument: 'bass', layer: 'bass', gain: 0.5, notes: DESPAIR_BASS, states: ['calm', 'sad', 'tension', 'boss'] },
    { name: 'drips', instrument: 'bell', layer: 'sparkle', gain: 0.45, notes: DESPAIR_DRIPS, states: ['calm', 'sad', 'tension', 'joy'] },
    { name: 'strings', instrument: 'strings', layer: 'counter', gain: 0.45, notes: DESPAIR_STRINGS, states: ['tension', 'boss'] },
    { name: 'choir', instrument: 'choir', layer: 'melody', gain: 0.4, notes: DESPAIR_CHOIR, states: ['sad'] },
    { name: 'thump', instrument: 'drums', layer: 'perc', gain: 0.4, notes: rep('T:1:0.4 .:1 T:1:0.32 .:1', 8), states: ['tension', 'boss'] },
    { name: 'hope', instrument: 'bell', layer: 'melody', gain: 0.45, notes: bars('.:4', '.:4', HOPE_C, '.:4', '.:4', '.:4', '.:4', HOPE_C), states: ['joy'] },
  ],
};

// --- Tension bed (A minor, 4/4) ---------------------------------------------------------------------------------
// For arrows and chases: a bass ostinato that jumps the octave, strings pulsing in eighths that swell across each
// pair of bars, and a quick four-note "look out!" figure at the end of every second bar.

const osti = (r: string, hi: string): string =>
  `${r}:0.5:0.7 ${r}:0.5:0.5 ${hi}:0.5:0.6 ${r}:0.5:0.5 ${r}:0.5:0.55 ${hi}:0.5:0.6 ${r}:0.5:0.5 ${hi}:0.5:0.55`;
const TENSION_BASS = bars(
  osti('A2', 'A3'), osti('A2', 'A3'), osti('F2', 'F3'), osti('F2', 'F3'),
  osti('D3', 'D4'), osti('D3', 'D4'), osti('E2', 'E3'), osti('E2', 'E3'),
);
const swell = (chord: string): string => `${pulse(chord, 8, 0.5, 0.45, 0.6)} | ${pulse(chord, 8, 0.5, 0.6, 0.75)}`;
const TENSION_STRINGS = bars(swell('C4+E4'), swell('C4+F4'), swell('D4+F4'), swell('D4+G#4'));
const TENSION_LOOKOUT = bars(
  '.:4', '.:2 A4:0.5:0.45 B4:0.5:0.5 C5:0.5:0.55 E5:0.5:0.6',
  '.:4', '.:2 A4:0.5:0.45 B4:0.5:0.5 C5:0.5:0.55 F5:0.5:0.6',
  '.:4', '.:2 A4:0.5:0.45 B4:0.5:0.5 D5:0.5:0.55 F5:0.5:0.6',
  '.:4', '.:2 G#4:0.5:0.45 B4:0.5:0.5 D5:0.5:0.55 E5:0.5:0.6',
);
const TENSION_PAD = bars('A3+C4+E4:4', 'A3+C4+E4:4', 'A3+C4+F4:4', 'A3+C4+F4:4', 'A3+D4+F4:4', 'A3+D4+F4:4', 'G#3+B3+E4:4', 'G#3+B3+E4:4');
const TENSION_HATS = 'H:0.5:0.3 H:0.5:0.15 H:0.5:0.22 H:0.5:0.15 H:0.5:0.3 H:0.5:0.15 H:0.5:0.22 H:0.5:0.15';

export const TENSION: SongDef = {
  id: 'tension',
  title: 'Look Out!',
  bpm: 112,
  meter: [4, 4],
  loopBars: 8,
  key: 'A minor',
  tracks: [
    { name: 'ostinato', instrument: 'bass', layer: 'bass', gain: 0.6, notes: TENSION_BASS, states: ['calm', 'tension', 'boss', 'joy'] },
    { name: 'strings', instrument: 'strings', layer: 'bed', gain: 0.6, notes: TENSION_STRINGS, states: ['tension', 'boss', 'sad'] },
    { name: 'lookout', instrument: 'pluck', layer: 'melody', gain: 0.55, notes: TENSION_LOOKOUT, states: ['tension', 'boss'] },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.45, notes: TENSION_PAD, states: ['calm', 'sad', 'joy'] },
    { name: 'kick', instrument: 'drums', layer: 'perc', gain: 0.5, notes: rep('K:1:0.6 .:0.5 K:0.5:0.45 K:1:0.55 .:1', 8), states: ['tension', 'boss'] },
    { name: 'rim', instrument: 'drums', layer: 'perc', gain: 0.4, notes: rep('.:1 R:1:0.35 .:1 R:1:0.35', 8), states: ['tension', 'boss'] },
    { name: 'hats', instrument: 'drums', layer: 'perc', gain: 0.3, notes: rep(TENSION_HATS, 8), states: ['boss'] },
  ],
};
