/**
 * CHAPTER XI — BY-PATH MEADOW AND DOUBTING CASTLE (GDD 2.10).
 *
 * Beats: By-ends agrees with everyone → Demas waves from the silver mine (its edge crumbles: bonk, Hope -30) →
 * the pillar of salt → river rest → the stile into the soft meadow and the storm → Giant Despair's dungeon →
 * the Key puzzle → morning sunshine freezes the giant → a warning sign for future pilgrims → end.
 *
 * Key puzzle (GDD 2.10 Ch XI step 9): no prompt. Near a locked door the Satchel > CARRIED "Use" button shows on
 * the Key of Promise; using it opens that lock. After 90 s Hopeful hints, after 180 s Christian remembers. The
 * iron gate is stiff: after the Key, hold E for 3 s while it grinds. Each locked door is a wall across the map
 * until it opens, so the only way on is through.
 *
 * Positions come from the level file: triggers 'dungeon_door', 'cell_door', 'outer_door', 'iron_gate',
 * 'escape_trigger', 'ch11_end' (and the beats before); the 'pit' zone 'silver_mine'.
 */
import * as THREE from 'three';
import '../audio/events';
import type {} from '../ui/SatchelUI';
import { events } from '../core/Events';
import type { ChapterContext, ChapterScript } from './types';

const LOCKS = ['cell_door', 'outer_door', 'iron_gate'] as const;
const KEY = 'key_promise';
/** The Satchel's "Use" shows on the Key within this distance of the next locked door (m). */
const USE_REACH = 4;
const HINT_S = 90;
const REMEMBER_S = 180;
const GATE_HOLD_S = 3;
/** The silver mine costs 30 Hope in all; the bonk itself takes 5 (GDD 2.7.3, 2.7.8). */
const MINE_EXTRA_HOPE = -25;

const HOPEFUL_BARKS = {
  idle: ['bark.ch10.hopeful.idle.1', 'bark.ch10.hopeful.idle.2'],
  cheer: ['bark.ch10.hopeful.cheer.1', 'bark.ch10.hopeful.cheer.2'],
  lowHope: ['bark.ch10.hopeful.lowHope.1'],
};

interface Door {
  id: (typeof LOCKS)[number];
  pos: THREE.Vector3;
  wall: number;
}

class Chapter11 {
  private opened = 0;
  private inDungeon = false;
  private doors: Door[] = [];
  private ending = false;
  private gateHold: (() => void) | null = null;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;
    this.opened = Math.min(LOCKS.length, Number(ctx.state.flag('ch11.locksOpen')) || 0);
    // The Key is given quietly at the Cross (GDD 2.7.6 #7); a chapter started on its own still has it.
    if (!ctx.state.has(KEY)) ctx.state.giveGift(KEY, true);

    ctx.objective('ch11.objective.pressOn');
    ctx.music('pilgrim', 'calm');
    ctx.ambience('hills');
    ctx.addCompanion('hopeful', HOPEFUL_BARKS);
    this.buildDoors();

    ctx.onTrigger('by_ends_meet', () => void ctx.talk('ch11_by_ends', { with: 'by_ends' }));
    ctx.onTrigger('demas_wave', () => void ctx.talk('ch11_demas', { with: 'demas' }));
    ctx.onZone('pit', (id) => {
      if (id !== 'silver_mine') return;
      ctx.state.addHope(MINE_EXTRA_HOPE);
      ctx.state.enterDetour('silver_mine');
      ctx.toast('ch11.toast.mineBonk');
    });
    ctx.onTrigger('pillar_salt', () => ctx.toast('ch11.toast.pillarSalt'));
    ctx.onTrigger('river_reach', () => {
      ctx.state.setHope(100);
      ctx.toast('ch11.toast.riverRest');
    });
    ctx.onTrigger('stile_cross', () => {
      ctx.state.enterDetour('stile_meadow');
      ctx.objective('ch11.objective.storm');
      ctx.toast('ch11.toast.softMeadow');
    });
    ctx.onTrigger('storm_trigger', () => {
      ctx.music('despair', 'tension');
      ctx.ambience('rain');
      ctx.toast('ch11.toast.storm');
      ctx.objective('ch11.objective.shelter');
    });

    ctx.onTrigger('dungeon_door', () => void this.enterDungeon());
    if (this.opened > 0 && this.opened < LOCKS.length) void this.enterDungeon(true);

    ctx.itemUse((id) => id === KEY && this.nearNextDoor());
    ctx.own(
      events.on('satchel:use', ({ id }) => {
        if (id === KEY && this.nearNextDoor()) void this.useKey();
      }),
    );

    ctx.onTrigger('escape_trigger', () => this.offerSign());
    ctx.onTrigger('ch11_end', () => this.end(), { once: false });
    ctx.own(() => this.removeWalls());
  }

  /** Each lock is a wall across the map at its trigger until it opens. */
  private buildDoors(): void {
    const ctx = this.ctx;
    const half = ctx.level.size / 2;
    for (const [i, id] of LOCKS.entries()) {
      const t = ctx.level.triggers.find((tr) => tr.id === id);
      if (!t) continue;
      const pos = new THREE.Vector3(t.at[0], ctx.session.world.terrain.heightAt(t.at[0], t.at[2]), t.at[2]);
      const wall =
        i < this.opened
          ? -1
          : ctx.session.col.addCollider({
              kind: 'box',
              center: [pos.x, pos.y + 3, 0],
              half: [0.4, 6, half],
              rotY: 0,
            });
      this.doors.push({ id, pos, wall });
    }
  }

  private removeWalls(): void {
    if (this.ctx.session.isDisposed) return;
    for (const d of this.doors) if (d.wall >= 0) this.ctx.session.col.removeCollider(d.wall);
  }

  private nextDoor(): Door | null {
    return this.inDungeon ? (this.doors[this.opened] ?? null) : null;
  }

  private nearNextDoor(): boolean {
    const d = this.nextDoor();
    if (!d || this.gateHold) return false;
    const p = this.ctx.session.player.renderPosition;
    return Math.hypot(p.x - d.pos.x, p.z - d.pos.z) <= USE_REACH;
  }

  private async enterDungeon(resumed = false): Promise<void> {
    if (this.inDungeon || this.opened >= LOCKS.length) return;
    this.inDungeon = true;
    const ctx = this.ctx;
    ctx.music('despair', 'sad');
    ctx.ambience('dungeon');
    ctx.objective('ch11.objective.findWayOut');
    if (!resumed) {
      ctx.toast('ch11.toast.dungeon');
      await ctx.talk('ch11_giant_stomp', { with: 'giant_despair' });
      if (ctx.session.isDisposed) return;
      await ctx.talk('ch11_hopeful_encourage', { with: 'hopeful' });
    }
    const first = this.opened;
    void ctx.wait(HINT_S).then(() => {
      if (this.opened === first) void ctx.talk('ch11_key_hint', { with: 'hopeful' });
    });
    void ctx.wait(REMEMBER_S).then(() => {
      if (this.opened !== first) return;
      void ctx.talk('ch11_remember').then(() => ctx.toast('ch11.toast.useKey'));
    });
  }

  private async useKey(): Promise<void> {
    const door = this.nextDoor();
    if (!door) return;
    const ctx = this.ctx;
    if (door.id === 'iron_gate') {
      // Stiff: the Key turns, then the gate must be pushed open (hold E 3 s while it grinds).
      events.emit('sfx', { id: 'cage_clank' });
      ctx.toast('ch11.toast.gateStiff');
      this.gateHold = ctx.onInteract({
        id: 'iron_gate_push',
        pos: door.pos,
        radius: 2.5,
        verb: 'ui.verb.use',
        enabled: true,
        holdSeconds: GATE_HOLD_S,
        onUse: () => {
          this.gateHold?.();
          this.gateHold = null;
          events.emit('sfx', { id: 'gate_grind' });
          this.open(door);
        },
      });
      return;
    }
    events.emit('sfx', { id: 'cage_clank' });
    this.open(door);
    if (door.id === 'cell_door') await ctx.talk('ch11_cell_open');
  }

  private open(door: Door): void {
    const ctx = this.ctx;
    if (door.wall >= 0) ctx.session.col.removeCollider(door.wall);
    door.wall = -1;
    this.opened++;
    ctx.state.setFlag('ch11.locksOpen', this.opened);
    if (this.opened < LOCKS.length) {
      ctx.toast(this.opened === 1 ? 'ch11.toast.lockOpen' : 'ch11.toast.lastLock');
      return;
    }
    this.inDungeon = false;
    ctx.state.setFlag('ch11.dungeonDone', true);
    ctx.objective('ch11.objective.runFromGiant');
    ctx.music('pilgrim', 'joy');
    ctx.ambience('hills');
    ctx.toast('ch11.toast.giantFreezes');
  }

  /** Optional: a sign so other pilgrims keep off By-Path Meadow. */
  private offerSign(): void {
    const ctx = this.ctx;
    const t = ctx.level.triggers.find((tr) => tr.id === 'escape_trigger');
    if (!t || ctx.state.flag('ch11.signUp') === true) return;
    const pos = new THREE.Vector3(t.at[0], ctx.session.world.terrain.heightAt(t.at[0], t.at[2]), t.at[2]);
    const off = ctx.onInteract({
      id: 'warning_sign',
      pos,
      radius: 3,
      verb: 'ui.verb.warningSign',
      enabled: true,
      onUse: () => {
        off();
        ctx.state.setFlag('ch11.signUp', true);
        events.emit('sfx', { id: 'knock' });
        ctx.toast('ch11.toast.warningSign');
      },
    });
  }

  private end(): void {
    if (this.ending || this.opened < LOCKS.length) return;
    this.ending = true;
    this.ctx.itemUse(null);
    this.ctx.complete();
  }
}

let running: Chapter11 | null = null;

const script: ChapterScript = {
  id: 'ch11',
  level: 'ch11',
  start(ctx) {
    running = new Chapter11(ctx);
    running.start();
  },
  dispose() {
    running = null;
  },
};

export default script;
