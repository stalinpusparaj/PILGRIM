/**
 * The Pilgrim theme and the songs built from it: the title arrangement and the Celestial finale.
 * ORIGINAL melodies written for this game (see docs/MUSIC.md). Grammar: src/audio/types.ts TrackDef.
 *
 * The hook is the rising cell "do re SOL" (D-E-A) with the rhythm short-short-LONG-short-short. Each time it
 * returns its leap opens a little wider (4th, 5th, minor 6th) until the B phrase climbs to the top note, F#5.
 * The Burden motif (songs-road.ts) is the same cell turned upside down in D minor.
 */
import type { SongDef } from '../../src/audio/types';
import { arp, bars, octave, rep } from './notation';

// --- Pilgrim: melody (D major, 4/4) -----------------------------------------------------------------------------

/** Bars 1-8. Hook (1), answer (2), hook wider (3), half cadence (4), hook widest (5), sigh (6), cadence (7-8). */
const PILGRIM_A = bars(
  'D4:0.5 E4:0.5 A4:2 B4:0.5 A4:0.5', //   D     do re SOL- la sol
  'G4:1.5 F#4:0.5 E4:2', //                G Em7 fa. mi re-
  'D4:0.5 E4:0.5 B4:2 C#5:0.5 B4:0.5', //  Bm    do re LA- ti la
  'A4:1.5 G4:0.5 E4:2', //                 A     sol. fa re-
  'E4:0.5 F#4:0.5 D5:2 E5:0.5 D5:0.5', //  D     re mi DO'- re' do'
  'C#5:1.5 B4:0.5 F#4:2', //               F#m   ti. la mi-
  'G4:1.5 F#4:0.5 E4:1 A4:1', //           Em7 A7
  'D4:3 .:1', //                           D
);

/** Bars 9-16. Walking up to the climax on the relative minor, then the hook comes home. */
const PILGRIM_B = bars(
  'G4:1 A4:1 B4:1 D5:1', //                G     fa sol la do'
  'C#5:1.5 B4:0.5 A4:2', //                A     ti. la sol-
  'A4:0.5 B4:0.5 F#5:2 D5:0.5 B4:0.5', //  Bm    sol la MI'- do' la  (the top of the song)
  'E5:1.5 D5:0.5 C#5:1 A4:1', //           Em7 A
  'D4:0.5 E4:0.5 A4:2 B4:0.5 A4:0.5', //   D     the hook again
  'G4:1.5 F#4:0.5 E4:1 B4:1', //           G
  'A4:1.5 G4:0.5 F#4:1 E4:1', //           Asus4 A
  'D4:3 .:1', //                           D
);

const PILGRIM_MELODY = bars(PILGRIM_A, PILGRIM_B);

// --- Pilgrim: harmony -------------------------------------------------------------------------------------------

const PILGRIM_PAD_A = bars(
  'F#3+A3+D4:4',
  'G3+B3+D4:2 G3+B3+E4:2',
  'F#3+B3+D4:4',
  'E3+A3+C#4:4',
  'F#3+A3+D4:4',
  'F#3+A3+C#4:4',
  'G3+B3+D4:2 G3+C#4+E4:2',
  'F#3+A3+D4:4',
);
const PILGRIM_PAD_B = bars(
  'G3+B3+D4:4',
  'A3+C#4+E4:4',
  'B3+D4+F#4:4',
  'G3+B3+E4:2 A3+C#4+E4:2',
  'F#3+A3+D4:4',
  'G3+B3+D4:4',
  'A3+D4+E4:2 A3+C#4+E4:2',
  'F#3+A3+D4:4',
);

const PILGRIM_BASS = bars(
  'D3:2 A2:2', 'G2:2 E2:2', 'B2:2 F#2:2', 'A2:2 A2:1 C#3:1',
  'D3:2 A2:2', 'F#2:2 C#3:2', 'E2:2 A2:2', 'D3:2 A2:1 F#2:1',
  'G2:2 D3:2', 'A2:2 C#3:2', 'B2:2 F#2:2', 'E2:2 A2:2',
  'D3:2 A2:2', 'G2:2 B2:2', 'A2:2 C#3:2', 'D3:2 A2:2',
);

/** Finger-picked eighths: a whole-bar roll, or two half-bar rolls when the chord changes mid-bar. */
const ROLL = [0, 1, 2, 3, 2, 1, 2, 1] as const;
const HALF = [0, 1, 2, 3] as const;
const roll = (chord: string): string => arp(chord, ROLL, 0.5, 0.45, 0.6);
const split = (a: string, b: string): string => `${arp(a, HALF, 0.5, 0.45, 0.55)} ${arp(b, HALF, 0.5, 0.45, 0.5)}`;
const D = 'D3 A3 D4 F#4';
const G = 'G3 B3 D4 G4';
const EM7 = 'E3 B3 D4 G4';
const BM = 'F#3 B3 D4 F#4';
const A = 'E3 A3 C#4 E4';
const PILGRIM_ARP = bars(
  roll(D), split(G, EM7), roll(BM), roll(A),
  roll(D), roll('F#3 A3 C#4 F#4'), split(EM7, 'E3 A3 C#4 G4'), roll(D),
  roll(G), roll(A), roll(BM), split(EM7, A),
  roll(D), roll(G), split('E3 A3 D4 E4', A), roll(D),
);

/**
 * Joy: the choir sings a sustained harmony line under the tune, always a chord tone at or below it. In the hook
 * bars it waits a beat and enters under the long note, so the hook's rising pickup ("do re") stays the top voice;
 * at both cadences it sits below the tune's D4, so the tune lands on the tonic.
 */
const PILGRIM_CHOIR_A = bars(
  '.:1 F#4:3', 'D4:2 B3:2', '.:1 F#4:3', 'E4:2 C#4:2',
  '.:1 A4:3', 'A4:2 C#4:2', 'E4:2 C#4:2', 'A3:4',
);
const PILGRIM_CHOIR_B = bars(
  'D4:2 G4:2', 'A4:2 E4:2', '.:1 D5:1 B4:2', 'B4:2 E4:2',
  '.:1 F#4:3', 'D4:4', 'E4:2 C#4:2', 'F#3:2 A3:2',
);

const GROOVE = 'K:1:0.7 R:1:0.35 K:1:0.6 R:1:0.35';
const FILL = 'K:1:0.7 R:1:0.35 K:0.5:0.6 K:0.5:0.5 T:0.5:0.4 T:0.5:0.45';
const PILGRIM_DRUMS = bars(rep(GROOVE, 7), FILL, rep(GROOVE, 7), FILL);
const HATS = 'H:0.5:0.3 H:0.5:0.16 H:0.5:0.24 H:0.5:0.16 H:0.5:0.3 H:0.5:0.16 H:0.5:0.24 H:0.5:0.16';

const PILGRIM_BELLS = bars(
  '.:2 A5:2:0.4', '.:4', '.:2 B5:2:0.35', '.:4',
  '.:2 D6:2:0.35', '.:4', '.:4', '.:2 A5:1:0.3 F#5:1:0.3',
  '.:4', '.:4', '.:2 F#5:2:0.35', '.:4',
  '.:2 A5:2:0.4', '.:4', '.:4', 'D6:2:0.35 A5:2:0.3',
);

export const PILGRIM: SongDef = {
  id: 'pilgrim',
  title: 'The Pilgrim',
  bpm: 96,
  meter: [4, 4],
  loopBars: 16,
  key: 'D major',
  tracks: [
    { name: 'tune', instrument: 'flute', layer: 'melody', gain: 0.8, notes: PILGRIM_MELODY, states: ['calm', 'joy', 'boss'] },
    { name: 'tune-sad', instrument: 'flute', layer: 'melody', gain: 0.5, notes: PILGRIM_MELODY, states: ['sad'] },
    { name: 'tune-marimba', instrument: 'marimba', layer: 'melody', gain: 0.35, notes: PILGRIM_MELODY, states: ['joy'] },
    { name: 'choir', instrument: 'choir', layer: 'counter', gain: 0.5, notes: bars(PILGRIM_CHOIR_A, PILGRIM_CHOIR_B), states: ['joy'] },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.5, notes: bars(PILGRIM_PAD_A, PILGRIM_PAD_B) },
    { name: 'picking', instrument: 'pluck', layer: 'counter', gain: 0.45, notes: PILGRIM_ARP, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'bass', instrument: 'bass', layer: 'bass', gain: 0.6, notes: PILGRIM_BASS, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'drums', instrument: 'drums', layer: 'perc', gain: 0.5, notes: PILGRIM_DRUMS, states: ['joy', 'boss'] },
    { name: 'hats', instrument: 'drums', layer: 'perc', gain: 0.35, notes: rep(HATS, 16), states: ['joy', 'boss'] },
    { name: 'bells', instrument: 'bell', layer: 'sparkle', gain: 0.45, notes: PILGRIM_BELLS, states: ['joy'] },
  ],
};

// --- Title: the A phrase on a music box, first high, then low and warm, over the pad ----------------------------

const TITLE_CHIMES = bars(
  rep('.:4', 8),
  '.:2 A5:2:0.35', '.:4', '.:2 F#5:2:0.3', '.:4',
  '.:2 A5:2:0.35', '.:4', '.:4', '.:2 D6:2:0.3',
);

export const TITLE: SongDef = {
  id: 'title',
  title: 'The Narrow Way (title)',
  bpm: 76,
  meter: [4, 4],
  loopBars: 16,
  key: 'D major',
  tracks: [
    { name: 'box', instrument: 'musicbox', layer: 'melody', gain: 0.7, notes: bars(octave(PILGRIM_A, 1), PILGRIM_A) },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.45, notes: bars(PILGRIM_PAD_A, PILGRIM_PAD_A) },
    { name: 'chimes', instrument: 'bell', layer: 'sparkle', gain: 0.35, notes: TITLE_CHIMES, states: ['calm', 'joy'] },
    { name: 'choir', instrument: 'choir', layer: 'counter', gain: 0.3, notes: bars(rep('.:4', 8), PILGRIM_CHOIR_A), states: ['joy'] },
  ],
};

// --- Celestial: the Pilgrim theme lifted a whole step to E major, with choir, bells and a new grand ending -------

const CELESTIAL_TUNE = bars(
  'E4:0.5 F#4:0.5 B4:2 C#5:0.5 B4:0.5', //  E       the hook, one step higher than ever before
  'A4:1.5 G#4:0.5 F#4:2', //                A F#m7
  'E4:0.5 F#4:0.5 C#5:2 D#5:0.5 C#5:0.5', //C#m
  'B4:1.5 A4:0.5 F#4:2', //                 B
  'F#4:0.5 G#4:0.5 E5:2 F#5:0.5 E5:0.5', // E
  'D#5:1.5 C#5:0.5 G#4:2', //               G#m
  'A4:1.5 G#4:0.5 F#4:1 B4:1', //           F#m7 B7
  'E4:1 G#4:1 B4:1 E5:1', //                E       instead of resting, it climbs on
  'A4:1 B4:1 C#5:1 E5:1', //                A
  'D#5:1.5 C#5:0.5 B4:2', //                B
  'B4:0.5 C#5:0.5 G#5:2 E5:0.5 C#5:0.5', // C#m     the top: G#5
  'F#5:1.5 E5:0.5 D#5:1 B4:1', //           F#m7 B
  'E4:0.5 F#4:0.5 B4:2 C#5:0.5 B4:0.5', //  E       the hook, everyone together
  'F#4:0.5 G#4:0.5 E5:2 F#5:0.5 E5:0.5', // C#m     and its widest leap
  'C#5:1.5 B4:0.5 D#5:1 F#5:1', //          A B
  'E5:4', //                                E       home, an octave higher than it started
);

/** Choir harmony under the tune: like the Pilgrim's, it enters a beat late in the hook bars and climbs under bar 8. */
const CELESTIAL_CHOIR = bars(
  '.:1 G#4:3', 'E4:2 C#4:2', '.:1 G#4:3', 'F#4:2 D#4:2',
  '.:1 B4:3', 'B4:2 D#4:2', 'F#4:2 D#4:2', 'B3:1 E4:1 G#4:2',
  'E4:2 A4:2', 'B4:2 F#4:2', '.:1 E5:1 C#5:2', 'C#5:2 F#4:2',
  '.:1 G#4:3', '.:1 G#4:1 C#5:2', 'E4:2 D#4:2', 'G#4:2 B4:2',
);

const CELESTIAL_PAD = bars(
  'G#3+B3+E4:4', 'A3+C#4+E4:2 A3+C#4+F#4:2', 'G#3+C#4+E4:4', 'F#3+B3+D#4:4',
  'G#3+B3+E4:4', 'G#3+B3+D#4:4', 'A3+C#4+E4:2 A3+D#4+F#4:2', 'G#3+B3+E4:4',
  'A3+C#4+E4:4', 'B3+D#4+F#4:4', 'C#4+E4+G#4:4', 'A3+C#4+F#4:2 B3+D#4+F#4:2',
  'G#3+B3+E4:4', 'G#3+C#4+E4:4', 'A3+C#4+E4:2 B3+D#4+F#4:2', 'G#3+B3+E4:4',
);

const CELESTIAL_BASS = bars(
  'E2:2 B2:2', 'A2:2 F#2:2', 'C#3:2 G#2:2', 'B2:2 B2:1 D#3:1',
  'E3:2 B2:2', 'G#2:2 D#3:2', 'F#2:2 B2:2', 'E2:1 G#2:1 B2:1 E3:1',
  'A2:2 E2:2', 'B2:2 F#2:2', 'C#3:2 G#2:2', 'F#2:2 B2:2',
  'E3:2 B2:2', 'C#3:2 G#2:2', 'A2:2 B2:2', 'E2:2 B2:2',
);

const E_ = 'E3 B3 E4 G#4';
const CSM = 'G#3 C#4 E4 G#4';
const B_ = 'F#3 B3 D#4 F#4';
const A_ = 'E3 A3 C#4 E4';
const FSM7 = 'F#3 A3 C#4 E4';
const CELESTIAL_ARP = bars(
  roll(E_), split(A_, FSM7), roll(CSM), roll(B_),
  roll(E_), roll('G#3 B3 D#4 G#4'), split(FSM7, 'F#3 A3 D#4 F#4'), roll(E_),
  roll(A_), roll(B_), roll(CSM), split(FSM7, B_),
  roll(E_), roll(CSM), split(A_, B_), roll(E_),
);

/** Bells: a chime at each phrase start and a falling E-major cascade where a phrase breathes. */
const CASCADE = 'B5:0.5:0.35 F#5:0.5:0.3 D#5:0.5:0.3 B4:0.5:0.3';
const PEAL = 'E6:0.5:0.4 B5:0.5:0.35 G#5:0.5:0.35 E5:0.5:0.35';
const CELESTIAL_BELLS = bars(
  'B5:2:0.45 .:2', '.:4', 'G#5:2:0.4 .:2', `.:2 ${CASCADE}`,
  'E6:2:0.45 .:2', '.:4', '.:4', `${PEAL} ${PEAL}`,
  'C#6:2:0.4 .:2', '.:4', 'G#5:2:0.4 .:2', `.:2 ${CASCADE}`,
  'E6:2:0.45 .:2', 'G#5:2:0.4 .:2', `.:2 ${CASCADE}`, `${PEAL} B5:2:0.35`,
);

const MARCH = 'K:1:0.7 S:1:0.3 K:1:0.6 S:1:0.35';
const ROLLFILL = 'K:1:0.7 S:1:0.3 T:0.5:0.4 T:0.5:0.45 T:0.5:0.5 S:0.5:0.4';
const CRASH = bars('O:4:0.3', '.:4', '.:4', '.:4');

export const CELESTIAL: SongDef = {
  id: 'celestial',
  title: 'The Celestial City',
  bpm: 84,
  meter: [4, 4],
  loopBars: 16,
  key: 'E major',
  tracks: [
    { name: 'tune', instrument: 'flute', layer: 'melody', gain: 0.75, notes: CELESTIAL_TUNE, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'cellos', instrument: 'strings', layer: 'counter', gain: 0.45, notes: octave(CELESTIAL_TUNE, -1), states: ['calm', 'joy', 'sad', 'boss'] },
    { name: 'choir', instrument: 'choir', layer: 'counter', gain: 0.45, notes: CELESTIAL_CHOIR, states: ['calm', 'joy', 'sad', 'boss'] },
    { name: 'pad', instrument: 'pad', layer: 'bed', gain: 0.5, notes: CELESTIAL_PAD },
    { name: 'harp', instrument: 'pluck', layer: 'counter', gain: 0.35, notes: CELESTIAL_ARP, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'bass', instrument: 'bass', layer: 'bass', gain: 0.6, notes: CELESTIAL_BASS, states: ['calm', 'joy', 'tension', 'boss'] },
    { name: 'bells', instrument: 'bell', layer: 'sparkle', gain: 0.45, notes: CELESTIAL_BELLS, states: ['calm', 'joy', 'boss'] },
    { name: 'drums', instrument: 'drums', layer: 'perc', gain: 0.45, notes: bars(rep(MARCH, 7), ROLLFILL, rep(MARCH, 7), ROLLFILL), states: ['joy', 'boss'] },
    { name: 'cymbal', instrument: 'drums', layer: 'perc', gain: 0.3, notes: rep(CRASH, 4), states: ['joy', 'boss'] },
  ],
};
