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
  thermalStatus?(): number;
  /** Settings > About (DECISIONS #397): the Play listing, the share sheet, and links set in the app. */
  openStore?(): void;
  share?(text: string): void;
  hasLink?(name: string): boolean;
  openLink?(name: string): void;
  /** Asks Google Play for a newer version; a yes arrives as `__pilgrimNative.update(versionCode)`. */
  checkUpdate?(): void;
}

export type NativeLinkName = 'facebook' | 'feedback' | 'more';
export interface NativeLinks {
  readonly canRate: boolean;
  rate(): void;
  share(text: string): void;
  has(name: NativeLinkName): boolean;
  open(name: NativeLinkName): void;
}

/** The Android shell's store, share and link calls, or null in a browser (or an older shell). */
export function nativeLinks(): NativeLinks | null {
  const b = typeof window === 'undefined' ? undefined : window.PilgrimNative;
  if (!b?.openStore || !b.share) return null;
  const call = (fn: () => void): void => {
    try {
      fn();
    } catch {
      /* the shell may refuse; never break the menu */
    }
  };
  return {
    canRate: true,
    rate: () => call(() => b.openStore?.()),
    share: (text) => call(() => b.share?.(text)),
    has: (name) => {
      try {
        return b.hasLink?.(name) === true;
      } catch {
        return false;
      }
    },
    open: (name) => call(() => b.openLink?.(name)),
  };
}
interface NativeHooks {
  audioFocus(on: boolean): void;
  /** Android PowerManager thermal status: 0 none, 1 light, 2 moderate, 3 severe, 4+ critical. */
  thermal(level: number): void;
  /** Google Play has a newer version (its versionCode). */
  update(versionCode: number): void;
}
declare module './Events' {
  interface EventMap {
    /** The device's thermal status changed (Android shell only); main.ts eases frame rate and resolution. */
    'device:thermal': { level: number };
    /** Google Play has a newer version (Android shell only): the title notice and Settings > About. */
    'app:update': { versionCode: number };
  }
}
export const THERMAL_MODERATE = 2;
export const THERMAL_SEVERE = 3;
let thermalLevel = 0;
let newerVersion: number | null = null;
/** The versionCode of a newer version on Google Play, or null (none known, or a browser). */
export function updateAvailable(): number | null {
  return newerVersion;
}
/** The last thermal status the shell reported (0 in a browser). */
export function thermalStatus(): number {
  return thermalLevel;
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
    update(versionCode: number): void {
      if (!Number.isInteger(versionCode) || versionCode <= 0 || versionCode === newerVersion) return;
      newerVersion = versionCode;
      events.emit('app:update', { versionCode });
    },
    thermal(level: number): void {
      const l = Number.isFinite(level) ? Math.max(0, Math.round(level)) : 0;
      if (l === thermalLevel) return;
      thermalLevel = l;
      events.emit('device:thermal', { level: l });
    },
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
  try {
    window.__pilgrimNative.thermal(bridge.thermalStatus?.() ?? 0);
  } catch {
    /* an older shell without the thermal call */
  }
  try {
    bridge.checkUpdate?.();
  } catch {
    /* an older shell, or no Play Store */
  }
  return () => { offs.forEach((off) => off()); delete window.__pilgrimNative; };
}
