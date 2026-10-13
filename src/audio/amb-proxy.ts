/**
 * The engine's `ambience` facade. Gameplay may set the zone and add emitters before audio is unlocked (the
 * AudioContext only exists after the first tap); the proxy remembers the zone and every live emitter and hands
 * them to the real Ambience on attach(), then forwards calls straight through.
 */
import type { Ambience } from './Ambience';
import type { AmbienceId, Vec3 } from './types';

export interface AmbienceControl {
  /** Crossfades to the zone bed (null = silence) over `fade` seconds (default 2.5). */
  set(id: AmbienceId | null, fade?: number): void;
  /** Positional emitter at a world position; returns a function that fades it out and removes it. */
  addEmitter(id: AmbienceId, at: Vec3): () => void;
  /** The zone asked for last (also before unlock). */
  readonly current: AmbienceId | null;
}

interface EmitterRec {
  readonly id: AmbienceId;
  readonly at: Vec3;
  off: (() => void) | null;
}

export class AmbienceProxy implements AmbienceControl {
  private target: Ambience | null = null;
  private want: AmbienceId | null = null;
  private wantFade: number | undefined = undefined;
  private readonly recs = new Set<EmitterRec>();

  /** `onSet` runs on every set() (the engine lifts its 'music:silence' ambience mute there). */
  constructor(private readonly onSet: (fade: number | undefined) => void) {}

  get current(): AmbienceId | null {
    return this.want;
  }

  set(id: AmbienceId | null, fade?: number): void {
    this.want = id;
    this.wantFade = fade;
    this.onSet(fade);
    this.target?.set(id, fade);
  }

  addEmitter(id: AmbienceId, at: Vec3): () => void {
    const rec: EmitterRec = { id, at: [at[0], at[1], at[2]], off: null };
    this.recs.add(rec);
    if (this.target) rec.off = this.target.addEmitter(id, rec.at);
    return () => {
      if (!this.recs.delete(rec)) return;
      rec.off?.();
      rec.off = null;
    };
  }

  /** Starts forwarding to `amb` and applies the zone and emitters asked for before. */
  attach(amb: Ambience): void {
    this.target = amb;
    if (this.want) amb.set(this.want, this.wantFade);
    for (const rec of this.recs) rec.off ??= amb.addEmitter(rec.id, rec.at);
  }

  /** Stops forwarding (engine dispose); the Ambience itself is disposed by the engine. */
  detach(): void {
    this.target = null;
    this.recs.clear();
  }
}
