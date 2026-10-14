/**
 * Things the player can use with [E] / pad X / the USE button (GDD 2.6, 2.14 "Interaction bubble"): waystones,
 * NPCs (Phase 3 dialogue), doors, the arbour bench... Each registers an `Interactable`; every fixed step the
 * nearest one in reach and roughly in front of the player gets the focus, and the HUD draws its bubble with the
 * verb and the device's key or button icon (`input.glyph('use')`).
 *
 * - Focus: enabled, within `radius` (horizontal) and 2.2 m in height, and in front of the player (facing dot >
 *   0.2) unless very close (< 1 m). Higher `priority` wins, then the closest (things straight ahead slightly
 *   preferred). Hysteresis: the focused one keeps the focus 0.35 m past its radius and down to a dot of 0, and a
 *   rival must be clearly closer to steal it, so the bubble never flickers between two neighbours.
 * - Use: a press calls `onUse()`; with `holdSeconds` the button must be held that long (`holdProgress` 0..1
 *   fills the HUD ring, `interact:hold` reports it), letting go early cancels.
 * - Nothing is focused while `player.mode !== 'play'` (cutscenes, dialogue, locked moments) or `walkOnly`.
 * - Events: `interact:focus` {id | null} on change, `interact:use` {id} after `onUse()`.
 *
 *   const interactables = new Interactables(player);          // registers the 'interactables' service
 *   const remove = interactables.add({ id: 'gate', pos, radius: 2, verb: 'ui.verb.knock', enabled: true,
 *                                      onUse: () => knock() });
 *   loop: interactables.update(dt) each fixed step, after the player moved
 */
import type * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { Input } from '../core/Input';
import type { Character } from '../gen/CharacterFactory';

declare module '../core/Events' {
  interface EventMap {
    'interact:focus': { id: string | null };
    'interact:use': { id: string };
    /**
     * Hold-to-use progress (0..1) while the button is held on an interactable with `holdSeconds`; a final 0 when
     * the hold is let go early, 1 when it completes. The payload object is reused: read it, do not keep it.
     */
    'interact:hold': { id: string; progress: number };
  }
}

declare module '../core/Services' {
  interface ServiceMap {
    interactables: Interactables;
  }
}

export interface Interactable {
  id: string;
  /** World position of the thing, at its foot (ground level); owners may move it (NPCs). */
  pos: THREE.Vector3;
  /** Reach in metres (horizontal). */
  radius: number;
  /** i18n key of the bubble verb, e.g. 'ui.verb.talk'. */
  verb: string;
  enabled: boolean;
  /** Bubble height above `pos` (m). */
  height?: number;
  /** Hold the button this long to use it (e.g. the iron gate, 3 s). */
  holdSeconds?: number;
  /** Higher wins over nearer. Default 0. */
  priority?: number;
  /**
   * The button the bubble shows (GDD 2.14 "the key or button icon matches the current input device"): 'use'
   * (default; E / X / USE) or 'jump' (Space / A / JUMP) for things the jump button does, like a ledge climb. The
   * use button always works too.
   */
  action?: 'use' | 'jump';
  onUse(): void;
}

/**
 * What the Phase 2 world systems read from the player (`src/player/Player.ts`, ARCHITECTURE "Gameplay"). Kept
 * structural so these modules build on their own and tests can pass a stand-in.
 */
export interface PlayerLike {
  readonly controller: {
    readonly position: THREE.Vector3;
    readonly velocity: THREE.Vector3;
    readonly grounded: boolean;
  };
  /** Horizontal facing (unit length). */
  readonly forward: THREE.Vector3;
  readonly character: Character;
  /** 'play' | 'locked' | 'cutscene' */
  readonly mode: string;
  /** True while a script slows the player to a stop (the Cross): nothing can be used. */
  readonly walkOnly?: boolean;
  /** Speed multiplier from zones (the Slough writes it), 1 by default. */
  speedScale: number;
}

export type UseInput = Pick<Input, 'pressed' | 'held'>;

const FOCUS = {
  /** Height window between the player's feet and the thing's foot (m). */
  maxDy: 2.2,
  /** Closer than this, facing does not matter (m). */
  close: 1,
  /** Facing dot needed to take the focus, and to keep it. */
  dotTake: 0.2,
  dotKeep: 0,
  /** The focused one keeps it this far past its radius (m)... */
  keepRadius: 0.35,
  /** ...and a rival must be this much closer to steal it (m). */
  keepBonus: 0.4,
  /** How much straight ahead beats off to the side, in metres of distance. */
  facingWeight: 0.5,
};
/** After a use, ignore presses this long (s): one press is one use. */
const USE_COOLDOWN = 0.25;

export class Interactables {
  private readonly list: Interactable[] = [];
  private readonly player: PlayerLike;
  private readonly input: UseInput | null;
  private current: Interactable | null = null;
  private holdTime = 0;
  private holding = false;
  /** A completed hold needs the button let go before it can start again. */
  private needRelease = false;
  private cooldown = 0;
  private readonly holdPayload = { id: '', progress: 0 };
  private disposed = false;

  constructor(player: PlayerLike, input?: UseInput | null) {
    this.player = player;
    this.input = input ?? null;
    services.register('interactables', this);
  }

  /** Registers a thing to use. Returns its remover. Ids should be unique (the latest add wins `get(id)`). */
  add(i: Interactable): () => void {
    this.list.push(i);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const k = this.list.indexOf(i);
      if (k >= 0) this.list.splice(k, 1);
      if (this.current === i) this.setFocus(null);
    };
  }

  /** The interactable the bubble is on, or null. */
  get focused(): Interactable | null {
    return this.current;
  }

  /** Hold-to-use progress 0..1 of the focused interactable (0 when not holding). */
  get holdProgress(): number {
    const hs = this.current?.holdSeconds ?? 0;
    return this.holding && hs > 0 ? Math.min(1, this.holdTime / hs) : 0;
  }

  get(id: string): Interactable | null {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.id === id) return this.list[i]!;
    return null;
  }

  /** Uses the focused thing now (a tap on the bubble, tests). Ignores `holdSeconds`. False when nothing is focused. */
  useFocused(): boolean {
    if (!this.current || this.disposed) return false;
    this.use(this.current);
    return true;
  }

  update(dt: number): void {
    if (this.disposed) return;
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.player.mode !== 'play' || this.player.walkOnly === true) {
      this.setFocus(null);
      return;
    }
    this.setFocus(this.pick());
    const input = this.input ?? services.tryGet('input') ?? null;
    const f = this.current;
    if (!f || !input) return;

    const hs = f.holdSeconds ?? 0;
    if (hs <= 0) {
      if (input.pressed('use') && this.cooldown <= 0) this.use(f);
      return;
    }
    const held = input.held('use');
    if (!held) this.needRelease = false;
    // Kids often hold the button while walking up: a hold already down when the focus arrives counts too.
    if (held && !this.needRelease) {
      this.holding = true;
      this.holdTime += dt;
      const progress = Math.min(1, this.holdTime / hs);
      this.emitHold(f.id, progress);
      if (progress >= 1) {
        this.holding = false;
        this.holdTime = 0;
        this.needRelease = true;
        this.use(f);
      }
    } else if (this.holding) {
      this.cancelHold();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.setFocus(null);
    this.disposed = true;
    this.list.length = 0;
    if (services.tryGet('interactables') === this) services.unregister('interactables');
  }

  // --------------------------------------------------------------------------------------------- private

  private pick(): Interactable | null {
    const p = this.player.controller.position;
    const fw = this.player.forward;
    const fl = Math.hypot(fw.x, fw.z) || 1;
    const fx = fw.x / fl;
    const fz = fw.z / fl;
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (let k = 0; k < this.list.length; k++) {
      const i = this.list[k]!;
      if (!i.enabled) continue;
      if (Math.abs(i.pos.y - p.y) > FOCUS.maxDy) continue;
      const dx = i.pos.x - p.x;
      const dz = i.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      const mine = i === this.current;
      if (d > i.radius + (mine ? FOCUS.keepRadius : 0)) continue;
      const dot = d > 1e-4 ? (dx * fx + dz * fz) / d : 1;
      if (d > FOCUS.close && dot <= (mine ? FOCUS.dotKeep : FOCUS.dotTake)) continue;
      const score = -(i.priority ?? 0) * 1000 + d - dot * FOCUS.facingWeight - (mine ? FOCUS.keepBonus : 0);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private setFocus(next: Interactable | null): void {
    if (next === this.current) return;
    if (this.holding) this.cancelHold();
    this.holdTime = 0;
    this.current = next;
    if (!this.disposed) events.emit('interact:focus', { id: next ? next.id : null });
  }

  private use(i: Interactable): void {
    this.cooldown = USE_COOLDOWN;
    try {
      i.onUse();
    } catch (err) {
      console.error(`[interactables] "${i.id}" onUse threw`, err);
    }
    events.emit('interact:use', { id: i.id });
  }

  private cancelHold(): void {
    const id = this.current?.id ?? this.holdPayload.id;
    this.holding = false;
    this.holdTime = 0;
    this.emitHold(id, 0);
  }

  private emitHold(id: string, progress: number): void {
    this.holdPayload.id = id;
    this.holdPayload.progress = progress;
    events.emit('interact:hold', this.holdPayload);
  }
}
