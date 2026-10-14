/**
 * The DialogueHost of the `?dialogue=test` demo (DialogueTypes.ts): the level's NPCs are the actors and `cam`
 * effects cut the camera with the Cutscene shot helpers (`shots.*` + `cutTo`, cutscene-shots.ts, re-exported by
 * Cutscene.ts; imported directly so the demo does not load the cutscene player). Faces, gestures and talking
 * mouths need nothing here: the runner drives them on the actors this host returns (dialogue-actors.ts), so
 * doing it again would play every clip twice. Every effects block is logged for the F1 readout and tests.
 *
 * Shot names: `<kind>` or `<kind>_<actorId>`, the actor defaulting to the line's speaker:
 *   over_shoulder_<id> / ots_<id>   over the other actor's shoulder, onto <id>
 *   close_<id> / closeup_<id>       close-up of <id>
 *   two / wide                      both actors
 *   release                         back to the demo's two-shot (the runner also sends it at the end)
 * Cuts are instant, then hold the shot's own gentle push-in (still under "Reduce camera motion"). They keep to
 * the two-shot's side of the actors (180° rule). The demo camera is suspended while a shot holds.
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';
import { cutTo, shots } from './cutscene-shots';
import type { CameraTrack } from './cutscene-types';
import { CAM_RELEASE, type DialogueEffects, type DialogueHost, type EffectContext } from './Dialogue';
import type { DemoCamera } from './dtest-camera';

type ShotKind = 'overShoulder' | 'close' | 'two';

const KINDS: ReadonlyArray<readonly [prefix: string, kind: ShotKind]> = [
  ['over_shoulder', 'overShoulder'],
  ['overshoulder', 'overShoulder'],
  ['ots', 'overShoulder'],
  ['close_up', 'close'],
  ['closeup', 'close'],
  ['close', 'close'],
  ['two_shot', 'two'],
  ['two', 'two'],
  ['wide', 'two'],
];
const RELEASE_BLEND = 0.8;
/** Dialogue cuts raise the subject by this much of the half-frame so the bottom panel never covers the face. */
const PANEL_LIFT = 0.42;
const MAX_LOG = 64;
export interface HostLogEntry {
  kind: 'cam' | 'effect';
  detail: string;
}

export class DemoHost implements DialogueHost {
  /** What the runner asked for during the current conversation (tests, F1 readout). */
  readonly log: HostLogEntry[] = [];
  private holding = false;
  private shot: CameraTrack | null = null;
  private shotTime = 0;
  private readonly side = new THREE.Vector3();
  private readonly head = new THREE.Vector3();

  constructor(
    private readonly cast: ReadonlyMap<string, Character>,
    private readonly cam: THREE.PerspectiveCamera,
    private readonly rig: DemoCamera,
  ) {}

  actor(speaker: string): Character | null {
    return this.cast.get(speaker) ?? null;
  }

  camera(shot: string, speaker: string): void {
    this.record('cam', `${shot} (${speaker})`);
    const name = shot.trim().toLowerCase();
    if (name === CAM_RELEASE) {
      this.release();
      return;
    }
    const parsed = parseShot(name);
    const target = parsed ? (this.actor(parsed.actor ?? speaker) ?? this.actor(speaker)) : null;
    if (!parsed || !target) {
      console.warn(`[dialogue test] camera shot "${shot}" has no kind or actor this stage knows`);
      return;
    }
    const other = this.other(target) ?? target;
    const keepSideOf = this.rig.home(this.side);
    let track: CameraTrack;
    const lift = PANEL_LIFT; // the speaker's face above the bottom dialogue panel
    if (parsed.kind === 'close')
      track = shots.closeUp(target, { side: this.closeSide(target, keepSideOf), lift });
    else if (parsed.kind === 'overShoulder') {
      track = shots.overShoulder(other, target, { keepSideOf, lift }); // clears a burdened listener's sack itself
    } else track = shots.two(target, other, { keepSideOf, lift });
    if (!this.holding) {
      this.rig.suspend();
      this.holding = true;
    }
    this.shot = track;
    this.shotTime = 0;
    cutTo(this.cam, track);
  }

  effect(e: DialogueEffects, ctx: EffectContext): void {
    // The runner already applied the block (Hope, items, flags, anims, sfx, music); the demo only records it.
    const parts = Object.entries(e).map(
      ([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`,
    );
    this.record('effect', `${ctx.node}/${ctx.from}: ${parts.join(' ')}`);
  }

  /** Per rendered frame: walks the held shot's push-in (locked off with "Reduce camera motion"). */
  update(frameDt: number, reduceMotion: boolean): void {
    const shot = this.shot;
    if (!shot || !this.holding || reduceMotion) return;
    const span = Math.max(0.1, shot.end - shot.start);
    if (this.shotTime >= span) return;
    this.shotTime = Math.min(span, this.shotTime + Math.min(frameDt, 0.1));
    cutTo(this.cam, shot, { progress: this.shotTime / span });
  }

  /** Clears the log at the start of a conversation. */
  beginConversation(): void {
    this.log.length = 0;
  }

  /** The conversation ended (or was stopped): the camera goes back to the two-shot. */
  endConversation(): void {
    this.release();
  }

  // ---------------------------------------------------------------------------------------------- private

  private release(): void {
    this.shot = null;
    if (!this.holding) return;
    this.holding = false;
    this.rig.resume(RELEASE_BLEND);
  }

  private record(kind: HostLogEntry['kind'], detail: string): void {
    if (this.log.length >= MAX_LOG) this.log.shift();
    this.log.push({ kind, detail });
  }

  private other(c: Character): Character | null {
    for (const a of this.cast.values()) if (a !== c) return a;
    return null;
  }

  /** Close-up side (shots.closeUp: 1 = camera-right of the face) that stays on the two-shot's side. */
  private closeSide(c: Character, home: THREE.Vector3): 1 | -1 {
    const yaw = c.root.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    c.root.getWorldPosition(this.head);
    // Camera-right when looking back at the face along its facing (fx, fz) is (-fz, fx).
    const dx = home.x - this.head.x;
    const dz = home.z - this.head.z;
    return dx * -fz + dz * fx >= 0 ? 1 : -1;
  }
}

/** 'over_shoulder_evangelist' → { kind: 'overShoulder', actor: 'evangelist' }; 'wide' → { kind: 'two' }. */
export function parseShot(name: string): { kind: ShotKind; actor: string | null } | null {
  for (const [prefix, kind] of KINDS) {
    if (name === prefix) return { kind, actor: null };
    if (name.startsWith(`${prefix}_`)) return { kind, actor: name.slice(prefix.length + 1) || null };
  }
  return null;
}
