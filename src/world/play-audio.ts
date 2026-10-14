/**
 * A level's sound bed (GDD 2.13, level format `ambience` / `music`): the play session starts them when the world
 * goes on screen and fades them out when it ends. Only ids the audio engine knows are sent (the level validator
 * cannot check them); gameplay never touches Web Audio, it emits events (src/audio/types.ts).
 */
import '../audio/events';
import { SONGS } from '../../content/music/themes';
import { isAmbienceId } from '../audio/amb-beds';
import type { SongId } from '../audio/types';
import { events } from '../core/Events';
import type { LevelData } from './LevelTypes';

const FADE = { music: 1.5, ambience: 2.5, out: 1 };

function isSongId(v: string): v is SongId {
  return Object.hasOwn(SONGS, v);
}

/** Starts the level's ambience and music; returns the function that fades them out. */
export function playLevelAudio(level: Pick<LevelData, 'ambience' | 'music'>): () => void {
  const ambience = isAmbienceId(level.ambience) ? level.ambience : null;
  const music = isSongId(level.music) ? level.music : null;
  if (ambience) events.emit('ambience:set', { id: ambience, fade: FADE.ambience });
  if (music) events.emit('music:play', { id: music, fade: FADE.music });
  return () => {
    if (ambience) events.emit('ambience:set', { id: null, fade: FADE.out });
    if (music) events.emit('music:stop', { fade: FADE.out });
  };
}
