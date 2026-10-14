/**
 * Level triggers (GDD 2.15 level format `triggers`): box or circle areas that tell chapter scripts the player
 * walked in. Shapes are 2D on the ground plane (height is ignored): 'circle' at `at` (or x / z) with `r`, 'box'
 * at `at` with `size` [sx, sy, sz] or [sx, sz] (axis aligned). A trigger is entered at its outline and left
 * 0.35 m past it (no flicker on the border).
 *
 * - Events: 'trigger:enter' {id, script} and 'trigger:exit' {id}.
 * - `once` (default true): the trigger fires its enter once per chapter run and is then spent (no exit either).
 *   `once: false` fires every time the player walks in.
 * - Nothing fires while `enabled` is false (cutscenes may switch it off). Allocation-free per step.
 *
 *   const triggers = new Triggers(level, player);   // anything with controller.position or position
 *   loop: triggers.update() each fixed step after the player moved
 *   triggers.dispose();
 */
import type * as THREE from 'three';
import { events } from '../core/Events';
import type { LevelData, LevelTrigger } from './LevelTypes';

declare module '../core/Events' {
  interface EventMap {
    /** The player walked into a level trigger; `script` is the trigger's script name from the level file. */
    'trigger:enter': { id: string; script: string };
    'trigger:exit': { id: string };
  }
}

const EXIT_MARGIN = 0.35;

export type TriggerTarget =
  { readonly position: THREE.Vector3 } | { readonly controller: { readonly position: THREE.Vector3 } };

interface Area {
  readonly def: LevelTrigger;
  readonly x: number;
  readonly z: number;
  /** Circle radius, or box half extents. */
  readonly r: number;
  readonly hx: number;
  readonly hz: number;
  readonly circle: boolean;
  readonly once: boolean;
}

export class Triggers {
  enabled = true;
  private readonly areas: Area[];
  private readonly inside: Uint8Array;
  private readonly spent: Uint8Array;
  private disposed = false;

  constructor(
    level: Pick<LevelData, 'triggers'>,
    private target: TriggerTarget | null,
  ) {
    this.areas = level.triggers.map(toArea).filter((a): a is Area => a !== null);
    this.inside = new Uint8Array(this.areas.length);
    this.spent = new Uint8Array(this.areas.length);
  }

  get count(): number {
    return this.areas.length;
  }

  /** True while the player stands in trigger `id`. */
  isInside(id: string): boolean {
    const i = this.areas.findIndex((a) => a.def.id === id);
    return i >= 0 && this.inside[i] === 1;
  }

  /** True once a `once` trigger has fired. */
  isSpent(id: string): boolean {
    const i = this.areas.findIndex((a) => a.def.id === id);
    return i >= 0 && this.spent[i] === 1;
  }

  setTarget(t: TriggerTarget | null): void {
    this.target = t;
  }

  update(): void {
    const t = this.target;
    if (this.disposed || !this.enabled || !t) return;
    const p = 'controller' in t ? t.controller.position : t.position;
    for (let i = 0; i < this.areas.length; i++) {
      if (this.spent[i]) continue;
      const a = this.areas[i]!;
      const d = distance(a, p.x, p.z);
      if (!this.inside[i] && d <= 0) {
        this.inside[i] = 1;
        if (a.once) this.spent[i] = 1;
        events.emit('trigger:enter', { id: a.def.id, script: a.def.script });
      } else if (this.inside[i] && d > EXIT_MARGIN) {
        this.inside[i] = 0;
        events.emit('trigger:exit', { id: a.def.id });
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.target = null;
  }
}

/** Signed distance to the outline on the ground (negative inside). */
function distance(a: Area, x: number, z: number): number {
  const dx = x - a.x;
  const dz = z - a.z;
  if (a.circle) return Math.hypot(dx, dz) - a.r;
  const qx = Math.abs(dx) - a.hx;
  const qz = Math.abs(dz) - a.hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

function toArea(def: LevelTrigger): Area | null {
  const loose = def as LevelTrigger & { x?: unknown; z?: unknown };
  const x = Array.isArray(def.at) ? def.at[0] : typeof loose.x === 'number' ? loose.x : NaN;
  const z = Array.isArray(def.at) ? def.at[2] : typeof loose.z === 'number' ? loose.z : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    console.error(`[triggers] trigger "${def.id}" has no position`);
    return null;
  }
  const once = def.once !== false;
  if (def.shape === 'circle') {
    const r = def.r ?? 0;
    return { def, x, z, r, hx: 0, hz: 0, circle: true, once };
  }
  const s = def.size ?? [0, 0, 0];
  // [sx, sy, sz] (GDD example) or [sx, sz].
  const sx = s[0] ?? 0;
  const sz = (s.length >= 3 ? s[2] : s[1]) ?? 0;
  return { def, x, z, r: 0, hx: sx / 2, hz: sz / 2, circle: false, once };
}
