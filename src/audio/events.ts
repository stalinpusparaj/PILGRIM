/** Declares the audio events (src/audio/types.ts AudioEventMap) on the global event bus. Import for types only. */
import type { AudioEventMap } from './types';

declare module '../core/Events' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface EventMap extends AudioEventMap {}
}

export {};
