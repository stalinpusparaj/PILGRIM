/**
 * The audio engine (GDD 2.13, ARCHITECTURE "Audio"), registered as the 'audio' service. Composes the mixer
 * (amb-mixer.ts: buses, -6 dB duck, limiter, shared reverb), InstrumentBank + MusicPlayer, SfxBank, Babble and
 * Ambience, and routes every AudioEventMap event to them.
 *
 * - The AudioContext is created lazily by unlock(), which is bound to the first pointerdown / touchend / keydown /
 *   click (resume() plus a one-sample silent buffer, for iOS). `ready` turns true when the context first runs.
 * - Before that, music:play / music:state / ambience:set (and emitters) are remembered and applied on unlock;
 *   sfx are dropped and babble is silent but keeps each line's length (`done` resolves on time), so the game
 *   simply runs silently at its normal pace.
 * - iOS: the audio session is left to WebKit (Web Audio alone follows the Ring/Silent switch, like native games)
 *   unless `audioSession` asks for 'playback' (the music test page does, to be judged on a phone in silent mode).
 * - Volumes follow Settings live ('settings:changed'). Dialogue ducks music by 6 dB (duck() / 'audio:duck').
 *   'music:silence' also fades the ambience and the shared reverb's tail until the next music:play or
 *   ambience:set ("everything except effects").
 * - Hidden tab: everything ramps to silence, then the context is suspended; it resumes and ramps back on return.
 * - Nothing runs per frame except setListener(), which allocates nothing.
 */
import type { Camera } from 'three';
import { SONGS } from '../../content/music/themes';
import { events } from '../core/Events';
import { SpokenVoice } from './SpokenVoice';
import { services } from '../core/Services';
import { hashString } from '../gen/rng';
import { Ambience } from './Ambience';
import { Babble, silentLine } from './Babble';
import { InstrumentBank } from './Instruments';
import { MusicPlayer } from './Sequencer';
import { SfxBank } from './sfx/index';
import { ListenerSync } from './amb-listener';
import { audioContextClass, kickContext, setAudioSession, type AudioSessionType } from './amb-context';
import { Mixer, type AudioBuses, type MixFlags } from './amb-mixer';
import { AmbienceProxy, type AmbienceControl } from './amb-proxy';
import type { Mood, MusicState, SfxId, SongDef, SongId, Vec3, VoiceParams } from './types';
import './events';

export type { AudioBuses } from './amb-mixer';
export type { AmbienceControl } from './amb-proxy';

declare module '../core/Services' {
  interface ServiceMap {
    audio: AudioEngine;
  }
}

declare module '../core/Events' {
  interface EventMap {
    /** The AudioContext runs for the first time (audio was unlocked by a gesture). */
    'audio:ready': void;
  }
}

export interface SfxOptions {
  at?: Vec3;
  volume?: number;
  pitch?: number;
}
export interface SpeechHandle {
  stop(): void;
  readonly done: Promise<void>;
}
export interface MusicControl {
  play(id: SongId, fade?: number, state?: MusicState): void;
  setState(s: MusicState, fade?: number): void;
  stop(fade?: number): void;
  silence(fade?: number): void;
  readonly current: SongId | null;
  readonly state: MusicState;
}
export interface BabbleControl {
  speak(voice: VoiceParams, text: string, opts?: { mood?: Mood; cps?: number; at?: Vec3 }): SpeechHandle;
}
export interface AudioEngineOptions {
  /** Song data (default content/music/themes.ts SONGS). */
  songs?: Partial<Record<SongId, SongDef>>;
  /** Seed for the ambience (default fixed). */
  seed?: number;
  /** Bind unlock() to the first user gesture (default true). */
  autoUnlock?: boolean;
  /**
   * iOS / Safari audio session (`navigator.audioSession.type`), set before the context starts. Default: left
   * alone, so Web Audio follows the Ring/Silent switch and the player's own music keeps playing. 'playback' plays
   * even in silent mode (and pauses other audio): the music test page uses it.
   */
  audioSession?: AudioSessionType;
}

const TC_VOLUME = 0.05;
const TC_DUCK_DOWN = 0.08;
const TC_DUCK_UP = 0.35;
const TC_HIDE = 0.04;
const TC_SHOW = 0.15;
const SUSPEND_AFTER_MS = 400;
const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
const LISTEN_OPTS: AddEventListenerOptions = { capture: true, passive: true };
const RESOLVED: Promise<void> = Promise.resolve();

export class AudioEngine {
  readonly spoken = new SpokenVoice();
  readonly music: MusicControl;
  readonly ambience: AmbienceControl;
  private readonly ambProxy: AmbienceProxy;
  readonly babble: BabbleControl;
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private listener: ListenerSync | null = null;
  private player: MusicPlayer | null = null;
  private bank: InstrumentBank | null = null;
  private sfx: SfxBank | null = null;
  private voices: Babble | null = null;
  private amb: Ambience | null = null;
  private readonly songs: Partial<Record<SongId, SongDef>>;
  private readonly seed: number;
  private readonly session: AudioSessionType | undefined;
  private readonly flags: MixFlags = { ducked: false, silenced: false, hidden: false };
  private readonly duckers = new Set<string>();
  private isReady = false;
  private failed = false;
  private disposed = false;
  private suspendedByUs = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private wantSong: SongId | null = null;
  private wantSongFade: number | undefined = undefined;
  private wantState: MusicState = 'calm';
  private readonly offs: Array<() => void> = [];
  private readonly unlocked: Promise<void>;
  private resolveUnlock: () => void = () => undefined;
  private sfxFailed = false;

  constructor(opts: AudioEngineOptions = {}) {
    this.songs = opts.songs ?? SONGS;
    this.seed = opts.seed ?? hashString('pilgrim:audio');
    this.session = opts.audioSession;
    this.flags.hidden = typeof document !== 'undefined' && document.hidden;
    this.unlocked = new Promise<void>((resolve) => (this.resolveUnlock = resolve));
    this.music = this.musicControl();
    this.ambience = this.ambProxy = new AmbienceProxy((fade) => this.setSilenced(false, fade ?? 1.5));
    // Not ready (before the unlock, no Web Audio, Babble failed): silent, but `done` still takes the line's length.
    this.babble = {
      speak: (voice, text, o) =>
        this.spoken.speak(text, voice) ??
        (this.isReady && this.voices ? this.voices.speak(voice, text, o) : silentLine(voice, text, o)),
    };
    this.subscribe();
    if (typeof window !== 'undefined' && opts.autoUnlock !== false) {
      for (const type of GESTURES) window.addEventListener(type, this.onGesture, LISTEN_OPTS);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    services.register('audio', this);
  }

  /** False until the AudioContext runs (unlocked by the first tap / click / key). */
  get ready(): boolean {
    return this.isReady;
  }

  /** The AudioContext, once unlock() created it. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Mixer nodes (meters, tests), null before unlock. */
  get buses(): AudioBuses | null {
    return this.mixer;
  }

  /** The sequencer (song info, problems, position) for the music test page; null before unlock. */
  get musicPlayer(): MusicPlayer | null {
    return this.player;
  }

  /** Creates and resumes the context (call it from a user gesture). Resolves once audio runs; never rejects. */
  unlock(): Promise<void> {
    if (this.disposed) return RESOLVED;
    let ctx = this.ctx;
    if (!ctx) {
      ctx = this.createContext();
      if (!ctx) {
        this.resolveUnlock(); // no Web Audio: the game runs silently, nobody waits forever
        return this.unlocked;
      }
      kickContext(ctx, this.onStateChange);
      this.build(ctx);
    } else if (ctx.state !== 'running' && !this.flags.hidden) {
      kickContext(ctx, this.onStateChange);
    }
    if (ctx.state === 'running') this.onRunning();
    return this.unlocked;
  }

  playSfx(id: SfxId, opts?: SfxOptions): void {
    if (!this.isReady || this.flags.hidden || !this.sfx) return;
    try {
      this.sfx.play(id, opts);
    } catch (err) {
      if (!this.sfxFailed) console.error('[audio] sfx failed', err);
      this.sfxFailed = true;
    }
  }

  /** Ducks the music by 6 dB while any owner (`by`) holds it: a pause closing mid-dialogue keeps the duck. */
  duck(on: boolean, by = 'default'): void {
    if (on) this.duckers.add(by);
    else this.duckers.delete(by);
    const ducked = this.duckers.size > 0;
    if (this.flags.ducked === ducked) return;
    this.flags.ducked = ducked;
    this.mixer?.apply(this.flags, ducked ? TC_DUCK_DOWN : TC_DUCK_UP);
  }

  /** Puts the shared listener on the camera (call once per frame, after the camera moved). Allocation-free. */
  setListener(camera: Camera): void {
    const l = this.listener;
    if (l && this.isReady && l.update(camera.matrixWorld.elements)) this.amb?.listenerAt(l.x, l.y, l.z);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.spoken.dispose();
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (typeof window !== 'undefined') {
      for (const type of GESTURES) window.removeEventListener(type, this.onGesture, LISTEN_OPTS);
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearSuspendTimer();
    for (const s of [this.player, this.amb, this.voices, this.sfx, this.bank, this.mixer]) {
      try {
        s?.dispose();
      } catch (err) {
        console.error('[audio] dispose failed', err);
      }
    }
    this.player = this.amb = this.voices = this.sfx = this.bank = this.mixer = this.listener = null;
    this.ambProxy.detach();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      ctx.removeEventListener('statechange', this.onStateChange);
      ctx.close().catch(() => undefined);
    }
    this.isReady = false;
    this.resolveUnlock();
    if (services.tryGet('audio') === this) services.unregister('audio');
  }

  // facades: remember intent before unlock, forward after -------------------------------------------------

  private musicControl(): MusicControl {
    const self = this;
    return {
      play(id, fade, state) {
        if (id !== self.wantSong) self.wantState = state ?? 'calm';
        else if (state) self.wantState = state;
        self.wantSong = id;
        self.wantSongFade = fade;
        self.setSilenced(false, fade ?? 1.5);
        if (self.isReady) self.player?.play(id, fade, state);
      },
      setState(s, fade) {
        self.wantState = s;
        if (self.isReady) self.player?.setState(s, fade);
      },
      stop(fade) {
        self.wantSong = null;
        if (self.isReady) self.player?.stop(fade);
      },
      silence(fade) {
        self.wantSong = null;
        self.setSilenced(true, fade ?? 0.4);
        if (self.isReady) self.player?.silence(fade);
      },
      get current() {
        return self.isReady && self.player ? self.player.current : self.wantSong;
      },
      get state() {
        return self.isReady && self.player ? self.player.state : self.wantState;
      },
    };
  }

  private setSilenced(on: boolean, fade: number): void {
    if (this.flags.silenced === on) return;
    this.flags.silenced = on;
    this.mixer?.apply(this.flags, Math.max(0.01, fade / 3));
  }

  // lifecycle -----------------------------------------------------------------------------------------------

  private subscribe(): void {
    this.offs.push(
      events.on('sfx', (p) => this.playSfx(p.id, p)),
      events.on('music:play', (p) => this.music.play(p.id, p.fade, p.state)),
      events.on('music:state', (p) => this.music.setState(p.state, p.fade)),
      events.on('music:stop', (p) => this.music.stop(p?.fade)),
      events.on('music:silence', (p) => this.music.silence(p?.fade)),
      events.on('ambience:set', (p) => this.ambience.set(p.id, p.fade)),
      events.on('audio:duck', (p) => this.duck(p.on, p.by)),
      events.on('settings:changed', (p) => {
        if (p.key.startsWith('vol')) this.mixer?.apply(this.flags, TC_VOLUME);
      }),
    );
  }

  private createContext(): AudioContext | null {
    if (this.failed) return null;
    const Ctor = audioContextClass();
    try {
      if (!Ctor) throw new Error('Web Audio is not available');
      if (this.session) setAudioSession(this.session);
      const ctx = new Ctor({ latencyHint: 'interactive' });
      ctx.addEventListener('statechange', this.onStateChange);
      this.ctx = ctx;
      return ctx;
    } catch (err) {
      this.failed = true;
      console.warn('[audio] no AudioContext; the game runs silently', err);
      return null;
    }
  }

  private build(ctx: AudioContext): void {
    const mix = this.make('mixer', () => new Mixer(ctx));
    if (!mix) return;
    this.mixer = mix;
    mix.apply(this.flags, 0);
    this.listener = new ListenerSync(ctx.listener);
    const bank = (this.bank = this.make('instruments', () => new InstrumentBank(ctx, mix.musicSend)));
    const songs = this.songs;
    if (bank) {
      this.player = this.make('music', () => new MusicPlayer(ctx, bank, mix.music, songs, mix.musicSend));
    }
    this.sfx = this.make('sfx', () => new SfxBank(ctx, mix.effects));
    this.voices = this.make('babble', () => new Babble(ctx, mix.voice));
    const hrtf = typeof matchMedia === 'function' && !matchMedia('(pointer: coarse)').matches;
    const opts = { reverb: mix.ambienceSend, seed: this.seed, hrtf };
    this.amb = this.make('ambience', () => new Ambience(ctx, mix.ambience, opts));
  }

  private make<T>(what: string, create: () => T): T | null {
    try {
      return create();
    } catch (err) {
      console.error(`[audio] ${what} failed to start`, err);
      return null;
    }
  }

  private readonly onStateChange = (): void => {
    if (this.ctx?.state === 'running' && !this.disposed) this.onRunning();
  };

  /** First time the context runs: apply what was asked for before the unlock. */
  private onRunning(): void {
    if (this.isReady || this.disposed) return;
    this.isReady = true;
    const p = this.player;
    if (p && this.wantSong) p.play(this.wantSong, this.wantSongFade, this.wantState);
    else if (p && p.state !== this.wantState) p.setState(this.wantState, 0);
    if (this.amb) this.ambProxy.attach(this.amb);
    this.resolveUnlock();
    events.emit('audio:ready');
  }

  private readonly onGesture = (): void => {
    if (this.disposed || this.flags.hidden) return;
    if (this.isReady && this.ctx?.state === 'running') return;
    // A touch pointerdown or an Esc key does not count as a gesture: wait for the touchend / next key, so the
    // context is never created "not allowed to start".
    const activation = (navigator as { userActivation?: { readonly isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) return;
    void this.unlock();
  };

  private readonly onVisibility = (): void => {
    if (this.disposed) return;
    const hidden = document.hidden;
    this.flags.hidden = hidden;
    this.mixer?.apply(this.flags, hidden ? TC_HIDE : TC_SHOW);
    this.clearSuspendTimer();
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden) {
      // Suspend once the fade is done: no CPU or battery while hidden. The music clock freezes with it.
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (!this.flags.hidden || ctx.state !== 'running') return;
        this.suspendedByUs = true;
        ctx.suspend().catch(() => undefined);
      }, SUSPEND_AFTER_MS);
    } else if (this.suspendedByUs) {
      this.suspendedByUs = false;
      ctx.resume().catch(() => undefined); // if refused (iOS), the next tap resumes it (onGesture)
    }
  };

  private clearSuspendTimer(): void {
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }
}
