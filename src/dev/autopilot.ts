/**
 * Dev-only autopilot for browser play-throughs (loaded by main.ts only when the debug panel exists: dev builds or
 * `?debug=1`). It plays through the game's own input, as a player would: holds W (with A / D to steer, camera-
 * relative) along the Way or toward a target, Shift to run, Space to read lines and 1-3 to answer, E on wanted
 * interactables, Q to pray when a shadow closes in or a prayer is asked for, a click to swing at a close shadow,
 * and it waits while a watchman's lantern pool lies on the road just ahead. Keys are re-pressed every half
 * second (like a held key's repeat) so a conversation that takes the input never leaves it stuck.
 *
 *   __autopilot.start({ choices: { ch10_stall_games: 1 }, visit: [{ npc: 'keeper_hats', use: 'stall_hats' }] })
 *   __autopilot.status()   // position, speed, seconds stuck, the last log lines
 *   __autopilot.stop()
 *
 * Developer tool: plain English, no i18n, never in a release build.
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { events } from '../core/Events';
import { services } from '../core/Services';

export interface AutopilotVisit {
  /** NPC id to walk up to (ends when `use` was pressed, or 4 s after arriving when there is no `use`). */
  npc: string;
  /** Interactable id to press E on when focused. */
  use?: string;
  /** Stand this far in front of the NPC (m, default 1.4). */
  near?: number;
}

export interface AutopilotPlan {
  /** Answer number (1-3) per dialogue graph id; default 1. An array is used in turn for repeated questions. */
  choices?: Record<string, number | number[]>;
  /** NPCs to go and see, in order, before following the Way again. */
  visit?: AutopilotVisit[];
  /** Hold Shift while walking. */
  run?: boolean;
  /** Press E on any waystone ("Read the Roll") it passes (default true). */
  waystones?: boolean;
  /** Pray / swing at the Ch IX shadows and pray when an objective asks (default true). */
  fight?: boolean;
  /** A curious child: press E on anything offered (once each), except ids in `skip`. */
  useAll?: boolean;
  skip?: string[];
  /** Follow the HUD guide (the chapter's goal marker) instead of the Way when it points somewhere. */
  followGuide?: boolean;
  /** Detour ids the story sends Christian down: walk along them when standing on one (Ch III, Ch XI). */
  detours?: string[];
}

const LOG_EVENTS = [
  'trigger:enter', 'hud:toast', 'dialogue:start', 'dialogue:chose', 'player:bonk', 'player:arise',
  'chapter:complete', 'achievement:unlocked', 'waystone:read', 'promise:collected',
] as const;
const MOVE: Record<string, [number, number]> = { KeyW: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
const COMBOS = [['KeyW'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyA'], ['KeyD']];
const STEER_KEYS = ['KeyW', 'KeyA', 'KeyD', 'ShiftLeft'];

const fwd = new THREE.Vector3();
const tan = new THREE.Vector3();
const want = new THREE.Vector3();

export class Autopilot {
  readonly log: string[] = [];
  stuck = 0;
  private unstick = 0;
  private plan: AutopilotPlan = {};
  private readonly held = new Set<string>();
  private readonly asked = new Map<string, number>();
  private readonly used = new Set<string>();
  private visits: AutopilotVisit[] = [];
  private arrivedFor = 0;
  private on = false;
  private cool = 0;
  private dcool = 0;
  private offLoop: (() => void) | null = null;
  private readonly offs: Array<() => void> = [];
  private repeat = 0;

  constructor(private readonly engine: Engine) {
    for (const name of LOG_EVENTS)
      this.offs.push(
        events.on(name, (p: unknown) => {
          const o = (p ?? {}) as Record<string, unknown>;
          this.say(`${name} ${String(o['id'] ?? o['key'] ?? o['reason'] ?? o['chapter'] ?? '')}`);
        }),
      );
  }

  start(plan: AutopilotPlan = {}): void {
    this.plan = plan;
    this.visits = [...(plan.visit ?? [])];
    this.asked.clear();
    this.used.clear();
    this.on = true;
    this.offLoop ??= this.engine.loop.add({ update: (dt) => this.step(dt) }, 127);
    window.clearInterval(this.repeat);
    this.repeat = window.setInterval(() => this.held.forEach((k) => key(k, true)), 500);
  }

  stop(): void {
    this.on = false;
    for (const k of [...this.held]) this.release(k);
    window.clearInterval(this.repeat);
  }

  status(): { x: number; z: number; speed: number; stuck: number; hope: number | null; log: string[] } {
    const play = services.tryGet('player');
    const p = play?.controller.position;
    return {
      x: p ? +p.x.toFixed(1) : NaN,
      z: p ? +p.z.toFixed(1) : NaN,
      speed: play ? +play.speed.toFixed(1) : 0,
      stuck: +this.stuck.toFixed(1),
      hope: services.tryGet('state')?.hope ?? null,
      log: this.log.slice(-12),
    };
  }

  dispose(): void {
    this.stop();
    this.offLoop?.();
    for (const off of this.offs.splice(0)) off();
  }

  // ------------------------------------------------------------------------------------------- inside

  private step(dt: number): void {
    const player = services.tryGet('player');
    if (!this.on || !player) return;
    this.cool -= dt;
    this.dcool -= dt;
    if (this.talk()) return;
    const skipName = document.querySelector<HTMLButtonElement>('.pg-name__btn:not(.pg-name__btn--ok)');
    if (skipName) {
      skipName.click(); // the scribe's name card: a sweep gives no name
      this.say('name card: not now');
    }
    const go = player.mode === 'play';
    const pos = player.controller.position;
    if (this.stuck > 1.5 && this.unstick <= 0) {
      this.unstick = 3; // wedged on a corner: follow the Way for a moment, and try a hop (stiles, ledges)
      tap('Space');
    }
    this.unstick -= dt;
    const target = this.unstick > 0 ? null : this.target(pos, dt);
    let dir = this.steer(pos, target);
    if (this.lanternAhead(pos)) dir = [];
    for (const k of ['KeyW', 'KeyA', 'KeyD']) this.hold(k, go && dir.includes(k));
    this.hold('ShiftLeft', go && this.plan.run === true && dir.length > 0);
    this.stuck = go && dir.length > 0 && player.speed < 0.3 ? this.stuck + dt : 0;
    if (this.cool <= 0 && go) this.act();
  }

  /** Conversations: Space to read on, the planned answer when asked. True while one runs. */
  private talk(): boolean {
    const r = services.tryGet('dialogue');
    if (!r?.active) return false;
    for (const k of STEER_KEYS) this.hold(k, false);
    if (this.dcool > 0) return true;
    if (r.phase === 'choosing') {
      const id = r.graphId ?? '';
      const n = this.asked.get(id) ?? 0;
      this.asked.set(id, n + 1);
      const plan = this.plan.choices?.[id];
      const pick = Array.isArray(plan) ? (plan[Math.min(n, plan.length - 1)] ?? 1) : (plan ?? 1);
      tap(`Digit${pick}`);
      this.say(`answer ${pick} in ${id}`);
      this.dcool = 0.8;
    } else if (r.phase === 'typing' || r.phase === 'shown') {
      tap('Space');
      this.dcool = 0.45;
    }
    return true;
  }

  private target(pos: THREE.Vector3, dt: number): THREE.Vector3 | null {
    const v = this.visits[0];
    if (!v) return this.plan.followGuide ? this.guideTarget() : null;
    const npc = services.tryGet('chapters')?.context?.npc(v.npc);
    if (!npc || !npc.character.root.visible) {
      this.visits.shift();
      return null;
    }
    const at = npc.position;
    const away = new THREE.Vector3(pos.x - at.x, 0, pos.z - at.z);
    if (away.lengthSq() < 1e-4) away.set(0, 0, -1);
    const spot = at.clone().addScaledVector(away.normalize(), v.near ?? 1.4);
    if (Math.hypot(spot.x - pos.x, spot.z - pos.z) < 0.8) {
      this.arrivedFor += dt;
      if (!v.use && this.arrivedFor > 4) this.next();
      return pos.clone(); // there: stand still
    }
    return spot;
  }

  /** The HUD guide's goal when a chapter aims it somewhere (an NPC, a landmark), else null (the Way). */
  private guideTarget(): THREE.Vector3 | null {
    const g = services.tryGet('guide');
    if (!g?.custom) return null;
    const s = g.sample();
    return s.target ? s.target.clone() : null;
  }

  private next(): void {
    this.visits.shift();
    this.arrivedFor = 0;
  }

  /** Camera-relative keys toward `target` (or along the Way ahead, pulled back to its middle). */
  private steer(pos: THREE.Vector3, target: THREE.Vector3 | null): string[] {
    if (target && Math.hypot(target.x - pos.x, target.z - pos.z) < 0.3) return [];
    if (target) want.set(target.x - pos.x, 0, target.z - pos.z).normalize();
    else {
      const way = wayOf(pos, this.plan.detours);
      if (!way) return [];
      const r = way.closest(pos.x, pos.z);
      way.tangent(Math.min(1, r.t + 0.01), tan);
      tan.y = 0;
      want.copy(tan.normalize()).addScaledVector(new THREE.Vector3(r.point.x - pos.x, 0, r.point.z - pos.z), 0.6).normalize();
    }
    this.engine.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    let best: string[] = [];
    let bd = -9;
    for (const c of COMBOS) {
      let x = 0;
      let z = 0;
      for (const k of c) {
        const [mx, my] = MOVE[k]!;
        x += fwd.x * my - fwd.z * mx;
        z += fwd.z * my + fwd.x * mx;
      }
      const d = (x * want.x + z * want.z) / Math.hypot(x, z);
      if (d > bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** A watchman's lantern pool on the road just ahead: wait for it to pass. */
  private lanternAhead(pos: THREE.Vector3): boolean {
    const scene = this.engine.scene;
    const way = wayOf();
    if (!way) return false;
    const me = way.closest(pos.x, pos.z).t;
    let ahead = false;
    scene.traverse((o) => {
      if (ahead || !o.visible || !o.name.startsWith('ch10:lantern-pool')) return;
      const r = way.closest(o.position.x, o.position.z);
      const m = (r.t - me) * way.length;
      if (m > 0 && m < 6.5 && r.dist < 4.2) ahead = true;
    });
    return ahead;
  }

  /** E on wanted things, prayer and the sword against shadows. */
  private act(): void {
    const focus = services.tryGet('interactables')?.focused?.id ?? null;
    const v = this.visits[0];
    if (focus && v?.use === focus) {
      tap('KeyE');
      this.say(`E ${focus}`);
      this.next();
      this.cool = 1;
      return;
    }
    if (focus && this.plan.useAll && !this.used.has(focus) && !(this.plan.skip ?? []).includes(focus)) {
      this.used.add(focus);
      tap('KeyE');
      this.say(`E ${focus}`);
      this.cool = 1;
      return;
    }
    const waystones = services.tryGet('waystones');
    if (focus && this.plan.waystones !== false && waystones?.ids.includes(focus)) {
      tap('KeyE');
      this.say(`E ${focus}`);
      this.cool = 2;
      return;
    }
    if (this.plan.fight === false) return;
    const shadows = services.tryGet('shadows')?.probe() ?? [];
    const near = Math.min(99, ...shadows.filter((s) => s.state === 'chase').map((s) => s.dist));
    const prayer = services.tryGet('prayer');
    const asked = services.tryGet('state')?.objective === 'ch09.objective.prayPath';
    if (prayer?.ready && (near < 5 || asked)) {
      tap('KeyQ');
      this.say(`Q (shadow ${near.toFixed(1)})`);
      this.cool = 1;
    } else if (near < 2.2) {
      clickCanvas(this.engine.canvas);
      this.say(`swing (shadow ${near.toFixed(1)})`);
      this.cool = 0.6;
    }
  }

  private hold(k: string, on: boolean): void {
    if (on === this.held.has(k)) return;
    if (on) {
      this.held.add(k);
      key(k, true);
    } else this.release(k);
  }

  private release(k: string): void {
    this.held.delete(k);
    key(k, false);
  }

  private say(m: string): void {
    this.log.push(`${m} @${this.engine.loop.elapsed.toFixed(1)}`);
    if (this.log.length > 400) this.log.splice(0, 100);
  }
}

function wayOf(pos?: THREE.Vector3, detours?: readonly string[]): import('../gen/Way').Way | null {
  const ways = services.tryGet('chapters')?.session?.world.ways;
  if (!ways) return null;
  if (pos && detours)
    for (const d of ways.detours) {
      if (!detours.includes(d.id)) continue;
      const r = d.closest(pos.x, pos.z);
      if (r.dist < d.halfWidth + 1.5 && r.t < 0.97) return d;
    }
  return ways.main;
}

function key(code: string, down: boolean): void {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
}

function tap(code: string): void {
  key(code, true);
  window.setTimeout(() => key(code, false), 70);
}

function clickCanvas(canvas: HTMLCanvasElement): void {
  const o = { button: 0, buttons: 1, bubbles: true, clientX: 400, clientY: 400, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  canvas.dispatchEvent(new PointerEvent('pointerdown', o));
  canvas.dispatchEvent(new MouseEvent('mousedown', o));
  window.setTimeout(() => {
    const u = { ...o, buttons: 0 };
    canvas.dispatchEvent(new PointerEvent('pointerup', u));
    canvas.dispatchEvent(new MouseEvent('mouseup', u));
  }, 60);
}

/** Puts `window.__autopilot` up for the console and browser play-throughs. */
export function installAutopilot(engine: Engine): () => void {
  const a = new Autopilot(engine);
  Object.defineProperty(window, '__autopilot', { value: a, configurable: true });
  return () => {
    a.dispose();
    Reflect.deleteProperty(window, '__autopilot');
  };
}
