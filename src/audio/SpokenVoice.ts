/** Offline device speech. No downloaded audio, remote voices or per-frame synthesis. */
import { services } from '../core/Services';
import { events } from '../core/Events';
import { t } from '../core/I18n';
import type {} from '../game/flow-types';
import type { SpeechHandle } from './AudioEngine';
import type { VoiceParams } from './types';
import { SPEECH_TAGS } from '../core/langs';

type NativeVoice = {
  available(lang: string): boolean;
  speak(text: string, lang: string, pitch: number, rate: number, volume: number, id: string): void;
  stop(): void;
};
declare global {
  interface Window {
    PilgrimVoice?: NativeVoice;
  }
}
let utteranceSerial = 0;
const SILENT: SpeechHandle = { stop() {}, done: Promise.resolve() };
export class SpokenVoice {
  private active: SpeechHandle | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private offs: Array<() => void> = [];
  private paused = false;
  constructor() {
    this.offs.push(
      events.on('game:pause', () => {
        this.paused = true;
        this.stop();
      }),
      events.on('game:resume', () => {
        this.paused = false;
      }),
      events.on('flow:state', ({ state }) => {
        this.paused = state === 'paused';
        if (state !== 'playing') this.stop();
      }),
      events.on('settings:changed', ({ key }) => {
        if (['lang', 'voiceMode', 'voiceGuidance', 'volMaster', 'volVoices'].includes(key)) this.stop();
      }),
      events.on('objective:changed', ({ key }) => {
        if (key && services.tryGet('settings')?.get('voiceGuidance'))
          this.speak(t(key), { pitch: 1, speed: 1, wave: 'triangle', vowel: 0.5 });
      }),
    );
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.hidden);
  }
  private hidden = (): void => {
    if (document.hidden) this.stop();
  };
  /** null asks the caller to use the classic voice; a silent handle intentionally drops overlapping barks. */
  speak(text: string, voice: VoiceParams, priority = 0): SpeechHandle | null {
    const settings = services.tryGet('settings');
    const mode = settings?.get('voiceMode') ?? 'spoken';
    if (mode === 'classic') return null;
    if (mode === 'off' || this.paused || (typeof document !== 'undefined' && document.hidden)) return SILENT;
    if (typeof window === 'undefined') return null;
    const lang = SPEECH_TAGS[settings?.get('lang') ?? 'en'];
    const volume = (settings?.get('volMaster') ?? 1) * (settings?.get('volVoices') ?? 0.8);
    if (!text.trim() || volume === 0) return SILENT;
    const native = window.PilgrimVoice;
    const synth = window.speechSynthesis;
    const local =
      !native &&
      synth
        ?.getVoices()
        .filter((v) => v.localService && v.lang.toLowerCase().split('-')[0] === lang.split('-')[0]);
    const selected = local && (local.find((v) => v.lang === lang) ?? local[0]);
    if (native ? !native.available(lang) : !selected) return null;
    if (this.active && priority === 0) return SILENT;
    this.stop();
    let resolve!: () => void;
    const done = new Promise<void>((r) => {
      resolve = r;
    });
    const finish = (): void => {
      if (this.active !== handle) return;
      clearTimeout(this.timer);
      this.active = null;
      events.emit('audio:duck', { on: false, by: 'spoken-voice' });
      resolve();
    };
    const handle: SpeechHandle = {
      done,
      stop: () => {
        if (this.active !== handle) return;
        if (native) native.stop();
        else synth.cancel();
        finish();
      },
    };
    this.active = handle;
    events.emit('audio:duck', { on: true, by: 'spoken-voice' });
    const pitch = Math.min(1.2, Math.max(0.85, voice.pitch));
    const rate = 0.95;
    // A bound also releases captions if an engine fails to deliver its completion callback.
    this.timer = setTimeout(() => handle.stop(), Math.min(120000, Math.max(8000, text.length * 180)));
    try {
      if (native) {
        // Android dispatches this once the current utterance ends or fails.
        const id = String(++utteranceSerial);
        const ended = (event: Event): void => {
          if ((event as CustomEvent<string>).detail === id) finish();
        };
        window.addEventListener('pilgrim:voice-end', ended);
        void done.then(() => window.removeEventListener('pilgrim:voice-end', ended));
        native.speak(text, lang, pitch, rate, volume, id);
      } else {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = selected as SpeechSynthesisVoice;
        utterance.lang = lang;
        utterance.volume = volume;
        utterance.pitch = pitch;
        utterance.rate = rate;
        utterance.onend = finish;
        utterance.onerror = finish;
        synth.speak(utterance);
      }
    } catch {
      handle.stop();
    }
    return handle;
  }
  stop(): void {
    this.active?.stop();
  }
  dispose(): void {
    this.stop();
    this.offs.forEach((off) => off());
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.hidden);
  }
}
