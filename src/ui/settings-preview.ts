/**
 * A short preview sound after a volume slider is released (Settings > Audio), through the 'audio' service.
 *
 * - Master and Effects: a chime on the effects bus (master scales it too).
 * - Voices: a few babble blips on the voice bus (the line itself is never shown).
 * - Music / Ambience: a song or bed that is already playing changes live, so nothing extra plays. When that
 *   bus is silent, a cue plays on the effects bus scaled to that bus's level (the mixer's v² curve and trims),
 *   so the player still hears how loud it will be. Muted effects mean no stand-in cue.
 *
 * Silent before the audio is unlocked (the tap that opened the menu normally unlocks it) and without audio.
 */
import { events } from '../core/Events';
import { services } from '../core/Services';
import { settings } from '../core/Settings';
import { VOICE_PRESETS } from '../audio/voices';
import type { VolumeKey } from './settings-rows';

/** Wait after the last change, so key / pad steps give one preview, not one per step. */
const DEBOUNCE_MS = 260;
/** Bus trims relative to the effects bus (src/audio/amb-mixer.ts MIX: music 1, ambience 0.8, effects 1). */
const MUSIC_TRIM = 1;
const AMBIENCE_TRIM = 0.8;
/** Never louder than this multiple of the cue's own level. */
const MAX_RELATIVE = 3;
/** Babble only shapes blips from the letters; this line is never shown. */
const VOICE_LINE = 'Hello there, friend!';

export class VolumePreview {
  private timer: number | null = null;
  private line: { stop(): void } | null = null;

  /** Plays the preview for `key` shortly after the last call. */
  schedule(key: VolumeKey): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.play(key);
    }, DEBOUNCE_MS);
  }

  dispose(): void {
    this.clearTimer();
    this.line?.stop();
    this.line = null;
  }

  private play(key: VolumeKey): void {
    const audio = services.tryGet('audio');
    if (!audio?.ready) return;
    const s = settings.data;
    switch (key) {
      case 'volMaster':
        events.emit('sfx', { id: 'promise_chime' });
        break;
      case 'volEffects':
        events.emit('sfx', { id: 'ui_toast' });
        break;
      case 'volVoices':
        this.line?.stop();
        this.line = audio.babble.speak(VOICE_PRESETS.christian ?? DEFAULT_VOICE, VOICE_LINE, {
          mood: 'excited',
        });
        break;
      case 'volMusic':
        if (audio.music.current === null)
          standIn('joy_note', (MUSIC_TRIM * s.volMusic ** 2) / s.volEffects ** 2);
        break;
      case 'volAmbience':
        if (audio.ambience.current === null) {
          standIn('bird_chirp', (AMBIENCE_TRIM * s.volAmbience ** 2) / s.volEffects ** 2);
        }
        break;
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}

const DEFAULT_VOICE = { pitch: 1, speed: 1, wave: 'triangle', vowel: 0.5 } as const;

function standIn(id: 'joy_note' | 'bird_chirp', relative: number): void {
  if (!Number.isFinite(relative) || relative <= 0) return; // muted bus, or muted effects
  events.emit('sfx', { id, volume: Math.min(MAX_RELATIVE, relative) });
}
