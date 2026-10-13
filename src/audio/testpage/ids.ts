/**
 * Every id of the audio contract as runtime lists, for the test page. Written as records keyed by the union
 * types, so adding an id to src/audio/types.ts without listing it here is a compile error.
 */
import type { AmbienceId, Mood, MusicState, SfxId, SongId } from '../types';

/** Every SfxId with the group it is shown under (groups follow src/audio/types.ts). */
export const SFX_GROUPS: Readonly<Record<SfxId, string>> = {
  step_dirt: 'Footsteps',
  step_stone: 'Footsteps',
  step_mud: 'Footsteps',
  step_wood: 'Footsteps',
  step_grass: 'Footsteps',
  step_water: 'Footsteps',
  burden_creak: 'Burden and Cross',
  burden_huff: 'Burden and Cross',
  burden_boing: 'Burden and Cross',
  rope_snap: 'Burden and Cross',
  sack_roll: 'Burden and Cross',
  tomb_thoom: 'Burden and Cross',
  joy_note: 'Burden and Cross',
  sparkle: 'Burden and Cross',
  roll_unroll: 'Roll, Promises, waystones',
  promise_chime: 'Roll, Promises, waystones',
  waystone_save: 'Roll, Promises, waystones',
  knock: 'World',
  arrow_whistle: 'World',
  arrow_thunk: 'World',
  bonk: 'World',
  stars: 'World',
  lion_roar: 'World',
  chain_rattle: 'World',
  cage_clank: 'World',
  gate_grind: 'World',
  net_drop: 'World',
  mud_slurp: 'World',
  splash: 'World',
  jump: 'World',
  land: 'World',
  sword_whoosh: 'Combat',
  sword_hit: 'Combat',
  shield_clang: 'Combat',
  perfect_block: 'Combat',
  dart_whoosh: 'Combat',
  prayer_swell: 'Combat',
  shadow_squeak: 'Combat',
  thunder: 'Weather and creatures',
  frog_croak: 'Weather and creatures',
  sheep_baa: 'Weather and creatures',
  snore: 'Weather and creatures',
  bells: 'Weather and creatures',
  bird_chirp: 'Weather and creatures',
  ui_click: 'UI',
  ui_open: 'UI',
  ui_close: 'UI',
  ui_toast: 'UI',
  ui_choice: 'UI',
};

const AMBIENCE: Record<AmbienceId, true> = {
  town: true,
  bog: true,
  hills: true,
  wind: true,
  candle: true,
  fair: true,
  river: true,
  birdsong: true,
  rain: true,
  valley: true,
  night: true,
  dungeon: true,
  meadow: true,
};

const SONGS: Record<SongId, true> = {
  pilgrim: true,
  title: true,
  burden: true,
  wiseman: true,
  interpreter: true,
  apollyon: true,
  valley: true,
  vanity: true,
  despair: true,
  mountains: true,
  celestial: true,
  tension: true,
};

const STATES: Record<MusicState, true> = { calm: true, tension: true, sad: true, boss: true, joy: true };

const MOODS: Record<Mood, true> = { neutral: true, sad: true, excited: true, scared: true, angry: true, sleepy: true };

function keys<K extends string>(r: Readonly<Record<K, unknown>>): readonly K[] {
  return Object.freeze(Object.keys(r) as K[]);
}

export const SFX_IDS: readonly SfxId[] = keys(SFX_GROUPS);
export const AMBIENCE_IDS: readonly AmbienceId[] = keys(AMBIENCE);
export const SONG_IDS: readonly SongId[] = keys(SONGS);
export const MUSIC_STATE_IDS: readonly MusicState[] = keys(STATES);
export const MOOD_IDS: readonly Mood[] = keys(MOODS);

export function isSongId(id: string | null | undefined): id is SongId {
  return typeof id === 'string' && Object.hasOwn(SONGS, id);
}
