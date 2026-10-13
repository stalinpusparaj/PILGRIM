/**
 * AudioContext helpers for AudioEngine (the amb- prefix is historical, like amb-mixer.ts): creating the context
 * (with the old webkit name), the iOS / Safari audio session, and the unlock kick iOS needs inside a gesture.
 */

/** iOS / Safari audio session type (`navigator.audioSession.type`, Safari 16.4+). */
export type AudioSessionType = 'playback' | 'ambient';

/** The AudioContext constructor, or null when the browser has no Web Audio. */
export function audioContextClass(): typeof AudioContext | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  return (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null;
}

/**
 * Sets the audio session type where the browser has one; a no-op elsewhere. Call it before the context starts.
 * 'playback' plays even with the iPhone's Ring/Silent switch on silent (and pauses other apps' audio); 'ambient'
 * (WebKit's choice for a page with only Web Audio) follows the switch and mixes with other audio.
 */
export function setAudioSession(type: AudioSessionType): void {
  try {
    const session = (globalThis.navigator as { audioSession?: { type: string } } | undefined)?.audioSession;
    if (session) session.type = type;
  } catch {
    // an unknown type or a locked session: keep the browser's default
  }
}

/** resume() plus a one-sample silent buffer: what iOS needs inside the gesture. `onResumed` runs once it runs. */
export function kickContext(ctx: AudioContext, onResumed: () => void): void {
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.onended = () => src.disconnect();
    src.start(0);
  } catch {
    // closed context: resume() below fails quietly too
  }
  ctx.resume().then(onResumed, () => undefined);
}
