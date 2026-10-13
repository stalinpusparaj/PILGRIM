/**
 * Every song in the game (GDD 2.13), keyed by SongId. The note data lives in the songs-*.ts files next to this one;
 * docs/MUSIC.md describes each theme. All melodies are ORIGINAL compositions written for PILGRIM: THE NARROW WAY:
 * nothing is transcribed, quoted or adapted from any hymn, folk tune, classical piece, film or game score.
 */
import type { SongDef, SongId } from '../../src/audio/types';
import { APOLLYON, DESPAIR, TENSION, VALLEY } from './songs-shadow';
import { CELESTIAL, PILGRIM, TITLE } from './songs-pilgrim';
import { BURDEN, INTERPRETER, WISEMAN } from './songs-road';
import { MOUNTAINS, VANITY } from './songs-fair';

export const SONGS: Record<SongId, SongDef> = {
  pilgrim: PILGRIM,
  burden: BURDEN,
  wiseman: WISEMAN,
  interpreter: INTERPRETER,
  apollyon: APOLLYON,
  valley: VALLEY,
  vanity: VANITY,
  despair: DESPAIR,
  mountains: MOUNTAINS,
  celestial: CELESTIAL,
  tension: TENSION,
  title: TITLE,
};
