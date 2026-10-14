/**
 * The DialogueHost of a chapter conversation (DialogueTypes.ts): actors are the player's Character
 * ('christian') and the level's NPCs; `cam` effects cut the gameplay camera with the Cutscene shot helpers
 * (`shots.*` + `cutTo`), the follow rig (PlaySession.camera, the 'cameraRig') suspended while a shot holds and
 * resumed on 'release' or at the end. Shot names as in the dialogue demo (dtest-host.ts `parseShot`):
 * over_shoulder_<id> / ots_<id>, close_<id> / closeup_<id>, two / wide, release. Cuts keep to the side the follow
 * camera stood on when the talk began (180° rule) and lift the face above the bottom panel. Allocation-free per
 * frame (the held shot's push-in).
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';
import { CAM_RELEASE, type DialogueHost } from '../narrative/Dialogue';
import { cutTo, shots } from '../narrative/cutscene-shots';
import type { CameraTrack } from '../narrative/cutscene-types';
import { parseShot } from '../narrative/dtest-host';
import { PLAYER_SPEAKER } from '../narrative/dialogue-rules';
import type { CameraRig } from '../core/CameraRig';

const RELEASE_BLEND = 0.8;
/** Raise the subject this much of the half-frame so the bottom panel never covers the face. */
const PANEL_LIFT = 0.42;

export interface TalkHostDeps {
  /** The Character for a speaker id (the player for 'christian'). */
  actor(speaker: string): Character | null;
  /** The camera the engine draws with while the chapter is shown. */
  readonly camera: THREE.PerspectiveCamera;
  /** The follow rig to suspend while a shot holds. */
  readonly rig: CameraRig;
  reduceMotion(): boolean;
}

export class TalkHost implements DialogueHost {
  /** Shots requested during the current talk (probe / tests). */
  cuts = 0;
  private partner: string | null = null;
  private holding = false;
  private shot: CameraTrack | null = null;
  private shotTime = 0;
  private readonly home = new THREE.Vector3();

  constructor(private readonly deps: TalkHostDeps) {}

  actor(speaker: string): Character | null {
    return this.deps.actor(speaker);
  }

  /** A talk begins: who the player talks with (the other actor of shots) and the side to keep. */
  begin(partner: string | null): void {
    this.partner = partner;
    this.cuts = 0;
    this.home.copy(this.deps.camera.position);
  }

  /** The talk ended (or was stopped): the follow rig takes the camera back. */
  end(): void {
    this.release();
    this.partner = null;
  }

  camera(shot: string, speaker: string): void {
    const name = shot.trim().toLowerCase();
    if (name === CAM_RELEASE) {
      this.release();
      return;
    }
    const parsed = parseShot(name);
    const target = parsed ? (this.actor(parsed.actor ?? speaker) ?? this.actor(speaker)) : null;
    if (!parsed || !target) {
      console.warn(`[chapter] camera shot "${shot}" has no kind or actor in this chapter`);
      return;
    }
    const other = this.other(target) ?? target;
    const lift = PANEL_LIFT;
    let track: CameraTrack;
    if (parsed.kind === 'close') track = shots.closeUp(target, { side: this.closeSide(target), lift });
    else if (parsed.kind === 'overShoulder')
      track = shots.overShoulder(other, target, { keepSideOf: this.home, lift });
    else track = shots.two(target, other, { keepSideOf: this.home, lift });
    if (!this.holding) {
      this.deps.rig.suspend();
      this.holding = true;
    }
    this.cuts++;
    this.shot = track;
    this.shotTime = 0;
    cutTo(this.deps.camera, track);
  }

  /** Per rendered frame: the held shot's gentle push-in (locked off under "Reduce camera motion"). */
  update(frameDt: number): void {
    const shot = this.shot;
    if (!shot || !this.holding || this.deps.reduceMotion()) return;
    const span = Math.max(0.1, shot.end - shot.start);
    if (this.shotTime >= span) return;
    this.shotTime = Math.min(span, this.shotTime + Math.min(frameDt, 0.1));
    cutTo(this.deps.camera, shot, { progress: this.shotTime / span });
  }

  private release(): void {
    this.shot = null;
    if (!this.holding) return;
    this.holding = false;
    this.deps.rig.resume(RELEASE_BLEND);
  }

  /** The other side of the conversation: the partner for Christian, Christian for anyone else. */
  private other(c: Character): Character | null {
    const player = this.actor(PLAYER_SPEAKER);
    if (c !== player) return player;
    return this.partner ? this.actor(this.partner) : null;
  }

  /** Close-up side (shots.closeUp: 1 = camera-right of the face) on the follow camera's side. */
  private closeSide(c: Character): 1 | -1 {
    const yaw = c.root.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const dx = this.home.x - c.root.position.x;
    const dz = this.home.z - c.root.position.z;
    return dx * -fz + dz * fx >= 0 ? 1 : -1;
  }
}
