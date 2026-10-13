/**
 * What the music test page needs from the audio engine: a structural subset of AudioEngine
 * (docs/ARCHITECTURE.md "Audio"), so the page also works with any object of the same shape.
 */
import type { AmbienceId, Mood, MusicState, SfxId, SongId, Vec3, VoiceParams } from '../types';

export interface TestPageAudio {
  readonly ready: boolean;
  unlock(): Promise<void>;
  playSfx(id: SfxId, opts?: { at?: Vec3; volume?: number; pitch?: number }): void;
  readonly music: {
    play(id: SongId, fade?: number, state?: MusicState): void;
    setState(s: MusicState, fade?: number): void;
    stop(fade?: number): void;
    readonly current: SongId | null;
    readonly state: MusicState;
  };
  /** The sequencer behind `music` (AudioEngine.musicPlayer), for the live bar:beat; null before unlock. */
  readonly musicPlayer?: { readonly position: { readonly bar: number; readonly beat: number } } | null;
  readonly ambience: { set(id: AmbienceId | null, fade?: number): void };
  readonly babble: {
    speak(
      voice: VoiceParams,
      text: string,
      opts?: { mood?: Mood; cps?: number; at?: Vec3 },
    ): { stop(): void; readonly done: Promise<void> };
  };
  dispose(): void;
}

/** One block of the page. `update()` runs ~10 times a second while the page is open. */
export interface Part {
  readonly el: HTMLElement;
  update?(): void;
  dispose?(): void;
}

/** Shared page state the parts read (the position picker applies to SFX and babble). */
export interface PageContext {
  readonly audio: TestPageAudio;
  /** Listener-relative position for positional tests, or undefined for plain stereo. */
  at(): Vec3 | undefined;
}
