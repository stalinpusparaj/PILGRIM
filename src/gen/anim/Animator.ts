/**
 * The in-house blend system (GDD 2.12): a full-body layer with crossfades and one upper-body overlay layer,
 * each a small pool of tracks. Blend = weighted sum of Euler offsets per bone; then bone.quaternion =
 * restQuat * offsetQuat('YXZ') and the hips get their translation and squash. update() allocates nothing.
 */
import * as THREE from 'three';
import type { BoneName } from '../rig';
import type { AnimName, AnimParams, ProcClip } from './types';
import { CLIPS } from './clips-all';
import { measureRig } from './clips-rig';
import { ANIM_BONES, N, Track, UPPER_BONES, crossings } from './clips-track';
import { hash01 } from './clips-util';

export { ANIM_BONES, UPPER_BONES } from './clips-track';

export interface PlayOptions {
  /** Crossfade time (s). Full layer default 0.25, overlay 0.2; 0 snaps. */
  fade?: number;
  /** Playback speed multiplier on top of the clip's own rate (default 1). */
  speed?: number;
  /** Start from the beginning even if this clip is already playing. */
  restart?: boolean;
}

const FULL_TRACKS = 4;
const UPPER_TRACKS = 3;
const FULL_FADE = 0.25;
const OVERLAY_FADE = 0.2;
/** Fade back to the previous loop when a one-shot ends. */
const END_FADE = 0.3;
const MAX_DT = 0.1;
/** Animators created so far: an unseeded clock (time 0) gets a deterministic offset so crowds desync. */
let created = 0;

export class Animator {
  readonly params: AnimParams;
  /** Called when a one-shot (full or overlay) reaches its end; play() inside it overrides the fallback. */
  onEnd?: (name: AnimName) => void;
  /** Foot plants so far (poll and compare for footstep sounds). */
  steps = 0;
  /** Clip events so far (burdened huff, impacts, take-offs, knocks, snores); `lastCue` names the clip. */
  cues = 0;
  lastCue: AnimName = 'idle';

  private readonly boneRefs: Array<THREE.Bone | null> = [];
  private readonly restQ: THREE.Quaternion[] = [];
  private readonly upperMask = new Uint8Array(N);
  private readonly hipsBone: THREE.Bone | null;
  private readonly hipsPos = new THREE.Vector3();
  private readonly hipsScale = new THREE.Vector3(1, 1, 1);
  private readonly full: Track[] = [];
  private readonly upper: Track[] = [];
  private readonly accF = new Float64Array(N * 3);
  private readonly accU = new Float64Array(N * 3);
  private readonly hipsAcc = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly quat = new THREE.Quaternion();
  private squashAcc = 0;
  private _squash = 1;
  private _current: AnimName = 'idle';
  private _overlay: AnimName | null = null;
  private lastLoop: AnimName = 'idle';
  private overlayLoop: AnimName | null = null;
  private endFull: ProcClip | null = null;
  private endUpper: ProcClip | null = null;
  private serial = 0;

  constructor(bones: Record<string, THREE.Bone>, params: AnimParams) {
    this.params = params;
    if (!Number.isFinite(params.time) || params.time === 0) params.time = hash01(created) * 100;
    created++;
    for (let i = 0; i < N; i++) {
      const b = bones[ANIM_BONES[i]] ?? null;
      this.boneRefs.push(b);
      this.restQ.push(b ? b.quaternion.clone() : new THREE.Quaternion());
    }
    for (const name of UPPER_BONES) {
      const i = (ANIM_BONES as readonly BoneName[]).indexOf(name);
      if (i >= 0) this.upperMask[i] = 1;
    }
    this.hipsBone = bones['hips'] ?? null;
    if (this.hipsBone) {
      this.hipsPos.copy(this.hipsBone.position);
      this.hipsScale.copy(this.hipsBone.scale);
    }
    params.rig ??= measureRig(bones, params.height);
    for (let i = 0; i < FULL_TRACKS; i++) this.full.push(new Track());
    for (let i = 0; i < UPPER_TRACKS; i++) this.upper.push(new Track());
    this.startFull(CLIPS.idle, 0, 1, true);
  }

  /** The full-body clip playing (or fading in). */
  get current(): AnimName {
    return this._current;
  }

  /** The upper-body overlay playing, or null. */
  get overlayName(): AnimName | null {
    return this._overlay;
  }

  /** Normalised progress (0..1) of the current full-body clip. */
  get phase(): number {
    const t = this.activeTrack(this.full);
    return t && t.clip ? Math.min(1, t.time / t.clip.duration) : 0;
  }

  /**
   * Stride phase of the current gait (0 = left foot strikes, 0.5 = right), or -1 when not walking/running.
   */
  get gaitPhase(): number {
    const t = this.activeTrack(this.full);
    return t ? t.gaitPhase() : -1;
  }

  /** Current squash/stretch factor on the hips (1 = none). */
  get squash(): number {
    return this._squash;
  }

  /** Full-body crossfade. An 'upper' clip is routed to overlay(). Unknown names are ignored. */
  play(name: AnimName, opts?: PlayOptions): void {
    const clip = CLIPS[name] as ProcClip | undefined;
    if (!clip) return;
    if (clip.layer === 'upper') {
      this.overlay(name, opts);
      return;
    }
    this.serial++;
    const active = this.activeTrack(this.full);
    const speed = opts?.speed ?? 1;
    if (active && active.clip === clip && !opts?.restart) {
      active.speed = speed;
      return;
    }
    this.startFull(clip, opts?.fade ?? FULL_FADE, speed, opts?.restart ?? false);
  }

  /**
   * Upper-body overlay (replaces chest, neck, head and arms with its own fading weight); null fades it out.
   */
  overlay(name: AnimName | null, opts?: { fade?: number; speed?: number; restart?: boolean }): void {
    this.serial++;
    const fade = Math.max(0, opts?.fade ?? OVERLAY_FADE);
    if (name === null) {
      this.fadeAll(this.upper, fade);
      this._overlay = null;
      this.overlayLoop = null;
      return;
    }
    const clip = CLIPS[name] as ProcClip | undefined;
    if (!clip) return;
    const active = this.activeTrack(this.upper);
    if (active && active.clip === clip && !opts?.restart) {
      active.speed = opts?.speed ?? 1;
      return;
    }
    if (clip.loop) this.overlayLoop = name;
    this.start(this.upper, clip, fade, opts?.speed ?? 1, opts?.restart ?? false);
    this._overlay = name;
  }

  /** Advance clips, blend, write bone quaternions and hips. Call once per frame/step. */
  update(dt: number): void {
    const step = dt > 0 ? (dt < MAX_DT ? dt : MAX_DT) : 0;
    const p = this.params;
    p.time += step;
    this.advance(this.full, step, true);
    this.advance(this.upper, step, false);
    const sumF = this.accumulate(this.full, this.accF, true);
    const sumU = this.accumulate(this.upper, this.accU, false);
    this.write(sumF, sumU);
    this.fireEnds();
  }

  /** Snap every driven bone back to its rest pose (does not stop the clips; the next update re-poses). */
  rest(): void {
    for (let i = 0; i < N; i++) this.boneRefs[i]?.quaternion.copy(this.restQ[i]);
    if (this.hipsBone) {
      this.hipsBone.position.copy(this.hipsPos);
      this.hipsBone.scale.copy(this.hipsScale);
    }
  }

  // -------------------------------------------------------------------------------------------- tracks

  private activeTrack(tracks: Track[]): Track | null {
    for (let i = 0; i < tracks.length; i++) if (tracks[i].clip && tracks[i].target > 0) return tracks[i];
    return null;
  }

  private startFull(clip: ProcClip, fade: number, speed: number, restart: boolean): void {
    if (clip.loop) this.lastLoop = clip.name;
    this.start(this.full, clip, Math.max(0, fade), speed, restart);
    this._current = clip.name;
  }

  /** Fade every track out so they all reach zero together after `fade` seconds, whatever their weight now. */
  private fadeAll(tracks: Track[], fade: number): void {
    const snap = fade <= 1e-4;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      t.target = 0;
      t.fadeRate = snap ? Infinity : Math.max(t.weight, 1e-3) / fade;
      if (snap) {
        t.weight = 0;
        t.clip = null;
      }
    }
  }

  private start(tracks: Track[], clip: ProcClip, fade: number, speed: number, restart: boolean): void {
    const prev = this.activeTrack(tracks);
    const sync = clip.gait && prev ? prev.gaitPhase() : -1;
    // Loops resume a track that is still fading out (no pop when toggling); one-shots always start fresh.
    let tr: Track | null = null;
    if (clip.loop && !restart) {
      for (let i = 0; i < tracks.length; i++) if (tracks[i].clip === clip) tr = tracks[i];
    }
    if (!tr) {
      tr = tracks[0];
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (!t.clip) {
          tr = t;
          break;
        }
        if (t.weight < tr.weight) tr = t;
      }
      tr.clip = clip;
      tr.weight = 0;
      tr.time = sync >= 0 && clip.gait ? (sync / clip.gait) * clip.duration : 0;
    }
    tr.ended = false;
    this.fadeAll(tracks, fade);
    tr.clip = clip;
    tr.target = 1;
    tr.speed = Number.isFinite(speed) ? Math.max(0, speed) : 1;
    // A resumed track rises from its current weight and arrives as the others leave.
    tr.fadeRate = fade > 1e-4 ? Math.max(1 - tr.weight, 1e-3) / fade : Infinity;
    if (tr.fadeRate === Infinity) tr.weight = 1;
  }

  private advance(tracks: Track[], dt: number, isFull: boolean): void {
    const p = this.params;
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      const clip = tr.clip;
      if (!clip) continue;
      if (tr.weight < tr.target) tr.weight = Math.min(tr.target, tr.weight + tr.fadeRate * dt);
      else if (tr.weight > tr.target) tr.weight = Math.max(tr.target, tr.weight - tr.fadeRate * dt);
      if (tr.weight <= 0 && tr.target <= 0) {
        tr.clip = null;
        continue;
      }
      let rate = clip.rate ? clip.rate(p) : 1;
      rate = Number.isFinite(rate) && rate > 0 ? rate * tr.speed : 0;
      const t0 = tr.time;
      let t1 = t0 + dt * rate;
      const active = tr.target > 0;
      if (!clip.loop && t1 >= clip.duration) {
        t1 = clip.duration;
        if (active && !tr.ended) {
          tr.ended = true;
          if (isFull) this.endFull = clip;
          else this.endUpper = clip;
        }
      }
      if (active && t1 > t0) this.countMarks(clip, t0, t1, isFull);
      tr.time = clip.loop && t1 >= clip.duration ? t1 % clip.duration : t1;
    }
  }

  /** Count foot plants and cues crossed in [t0, t1) (t1 may run past the loop end). */
  private countMarks(clip: ProcClip, t0: number, t1: number, isFull: boolean): void {
    const u0 = t0 / clip.duration;
    const u1 = t1 / clip.duration;
    if (isFull && clip.steps) this.steps += crossings(clip.steps, u0, u1);
    const n = clip.cues ? crossings(clip.cues, u0, u1) : 0;
    if (n > 0) {
      this.cues += n;
      this.lastCue = clip.name;
    }
  }

  // ------------------------------------------------------------------------------------- blend + write

  private accumulate(tracks: Track[], acc: Float64Array, isFull: boolean): number {
    acc.fill(0);
    if (isFull) {
      this.hipsAcc.set(0, 0, 0);
      this.squashAcc = 0;
    }
    let sum = 0;
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      const clip = tr.clip;
      if (!clip || tr.weight <= 0) continue;
      const w = tr.weight * tr.weight * (3 - 2 * tr.weight);
      tr.reset();
      clip.sample(tr.time, this.params, tr.pose);
      const slots = tr.slots;
      for (let j = 0; j < N; j++) {
        const s = slots[j];
        acc[j * 3] += w * s.x;
        acc[j * 3 + 1] += w * s.y;
        acc[j * 3 + 2] += w * s.z;
      }
      if (isFull) {
        const h = tr.pose.hips;
        this.hipsAcc.x += w * h.x;
        this.hipsAcc.y += w * h.y;
        this.hipsAcc.z += w * h.z;
        this.squashAcc += w * ((tr.pose.squash ?? 1) - 1);
      }
      sum += w;
    }
    return sum;
  }

  private write(sumF: number, sumU: number): void {
    const invF = sumF > 0 ? 1 / sumF : 0;
    const invU = sumU > 0 ? 1 / sumU : 0;
    const wU = sumU < 1 ? sumU : 1;
    const accF = this.accF;
    const accU = this.accU;
    for (let i = 0; i < N; i++) {
      const bone = this.boneRefs[i];
      if (!bone) continue;
      const k = i * 3;
      let x = accF[k] * invF;
      let y = accF[k + 1] * invF;
      let z = accF[k + 2] * invF;
      if (wU > 0 && this.upperMask[i] === 1) {
        x += (accU[k] * invU - x) * wU;
        y += (accU[k + 1] * invU - y) * wU;
        z += (accU[k + 2] * invU - z) * wU;
      }
      if (x === 0 && y === 0 && z === 0) bone.quaternion.copy(this.restQ[i]);
      else
        bone.quaternion.multiplyQuaternions(
          this.restQ[i],
          this.quat.setFromEuler(this.euler.set(x, y, z, 'YXZ')),
        );
    }
    let s = 1 + this.squashAcc * invF;
    s = s < 0.6 ? 0.6 : s > 1.4 ? 1.4 : s;
    this._squash = s;
    const hips = this.hipsBone;
    if (hips) {
      // Squash about the feet: scale the body on the hips and lower the hips so the soles stay put.
      const side = 1 / Math.sqrt(s);
      hips.scale.set(this.hipsScale.x * side, this.hipsScale.y * s, this.hipsScale.z * side);
      hips.position.set(
        this.hipsPos.x + this.hipsAcc.x * invF,
        this.hipsPos.y * s + this.hipsAcc.y * invF,
        this.hipsPos.z + this.hipsAcc.z * invF,
      );
    }
  }

  private fireEnds(): void {
    const f = this.endFull;
    const u = this.endUpper;
    this.endFull = null;
    this.endUpper = null;
    if (f) {
      const before = this.serial;
      this.onEnd?.(f.name);
      // Fall back to the previous loop unless onEnd started something else.
      if (this.serial === before && this.activeTrack(this.full)?.clip === f) {
        this.startFull(CLIPS[this.lastLoop], END_FADE, 1, false);
      }
    }
    if (u) {
      const before = this.serial;
      this.onEnd?.(u.name);
      if (this.serial === before && this.activeTrack(this.upper)?.clip === u) {
        if (this.overlayLoop) {
          this.start(this.upper, CLIPS[this.overlayLoop], END_FADE, 1, false);
          this._overlay = this.overlayLoop;
        } else {
          this.fadeAll(this.upper, END_FADE);
          this._overlay = null;
        }
      }
    }
  }
}
