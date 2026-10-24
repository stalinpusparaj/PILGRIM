import { events } from './Events';
import { services } from './Services';

/**
 * The Android shell's native helpers (DECISIONS #389). The app injects `PilgrimNative` into the WebView; in a
 * browser it is absent and none of this runs. Haptics follow story and combat moments; the shell calls
 * `__pilgrimNative.audioFocus(false)` when a phone call or another app takes the sound, which pauses the game
 * and suspends Web Audio until focus comes back.
 */
interface NativeBridge {
  vibrate(pattern: string): void;
}
interface NativeHooks {
  audioFocus(on: boolean): void;
}
declare global {
  interface Window {
    PilgrimNative?: NativeBridge;
    __pilgrimNative?: NativeHooks;
  }
}
interface Pausable { pause(): void }
interface AudioLike { readonly context: AudioContext | null }

/** Buzz patterns in ms (off, on, off, on...), kept short and soft for small hands. */
export const HAPTICS = {
  bonk: [0, 40],
  perfectBlock: [0, 25, 40, 25],
  bigHit: [0, 60],
  burdenDropped: [0, 30, 80, 30, 80, 120],
} as const;

export function installNativeShell(): () => void {
  const bridge = window.PilgrimNative;
  if (!bridge) return () => {};
  const buzz = (p: readonly number[]): void => {
    try { bridge.vibrate(p.join(',')); } catch { /* the shell may refuse; never break play */ }
  };
  const offs = [
    events.on('player:bonk', () => buzz(HAPTICS.bonk)),
    events.on('combat:block', (e) => { if (e.perfect) buzz(HAPTICS.perfectBlock); }),
    events.on('apollyon:hit', () => buzz(HAPTICS.bigHit)),
    events.on('burden:dropped', () => buzz(HAPTICS.burdenDropped)),
  ];
  window.__pilgrimNative = {
    audioFocus(on: boolean): void {
      const ctx = services.tryGet('audio') as AudioLike | undefined;
      if (!on) {
        (services.tryGet('flow') as Pausable | undefined)?.pause();
        void ctx?.context?.suspend().catch(() => {});
      } else if (document.visibilityState === 'visible') {
        void ctx?.context?.resume().catch(() => {});
      }
    },
  };
  return () => { offs.forEach((off) => off()); delete window.__pilgrimNative; };
}
