/**
 * The follow camera's "feel" state, advanced in the fixed step (GDD 2.5, 2.7.1):
 * - burden: the sack size, smoothed (drives the 0.2 m drop, the sway and the shoulder offset);
 * - sway: a slow sideways drift while burdened;
 * - thud: a soft vertical spring kicked by heavy burdened foot plants, hard landings and bump();
 * - lag: the camera's own height, stiff on the ground and loose in the air, so hops do not yank the view;
 * - fovKick: a few degrees wider while running free.
 * "Reduce camera motion" fades sway, thud and the FOV kick to nothing.
 */
import { CAMERA } from './camera-config';
import { clamp, damp, smoothstep, wrapAngle } from './camera-math';
import type { CameraTarget } from './camera-types';

type CameraCharacter = CameraTarget['character'];

export class CameraFeel {
  /** Smoothed sack size, 0..CAMERA.maxBurden. */
  burden = 0;
  /** Current sideways sway (m). */
  sway = 0;
  /** Vertical thud offset (m), <= 0 is a dip. */
  bob = 0;
  /** Smoothed feet height (m). */
  smoothY = 0;
  fovKick = 0;
  pullBack = 0;
  travelLift = 0;
  travelAhead = 0;
  roll = 0;
  private lastHeading = 0;

  private time = 0;
  private swayAmp = 0;
  private bobV = 0;
  private lastChar: CameraCharacter | null = null;
  private lastSteps = 0;
  private wasGrounded = true;
  private airVy = 0;

  /** Burden as 0..1 (camera drop, sway, look height). */
  get burden01(): number {
    return Math.min(1, this.burden);
  }

  /** Jump to the settled state for the player as they are now (snap, resume). */
  reset(p: CameraTarget, reduce: boolean): void {
    const ctl = p.controller;
    this.burden = sackSize(p.character);
    this.swayAmp = reduce ? 0 : CAMERA.sway.amp * this.burden01;
    this.sway = this.swayAmp * Math.sin(this.time * CAMERA.sway.speed);
    this.bob = 0;
    this.bobV = 0;
    this.smoothY = ctl.position.y;
    this.fovKick = 0;
    this.pullBack = this.travelLift = this.travelAhead = this.roll = 0;
    this.lastHeading = Math.atan2(p.forward.x, p.forward.z);
    this.lastChar = p.character;
    this.lastSteps = p.character.animator.steps;
    this.wasGrounded = ctl.grounded;
    this.airVy = 0;
  }

  step(dt: number, p: CameraTarget, reduce: boolean): void {
    const ctl = p.controller;
    const ch = p.character;
    this.burden = damp(this.burden, sackSize(ch), CAMERA.burdenRate, dt);
    const b = this.burden01;

    // Slow sway while burdened.
    this.time += dt;
    this.swayAmp = damp(this.swayAmp, reduce ? 0 : CAMERA.sway.amp * b, CAMERA.sway.fade, dt);
    this.sway = this.swayAmp * Math.sin(this.time * CAMERA.sway.speed);

    // Heavy foot plants (only burdened) and landings kick the thud spring.
    if (ch !== this.lastChar) {
      this.lastChar = ch;
      this.lastSteps = ch.animator.steps;
    }
    const steps = ch.animator.steps;
    if (steps !== this.lastSteps) {
      this.lastSteps = steps;
      if (!reduce && ctl.grounded && b > 0.05) this.bobV -= CAMERA.thud.step * b;
    }
    if (!ctl.grounded) {
      this.airVy = Math.min(this.airVy, ctl.velocity.y);
    } else {
      if (!this.wasGrounded && !reduce) {
        const fall = -this.airVy - CAMERA.thud.landMin;
        if (fall > 0) this.bobV -= Math.min(CAMERA.thud.landMax, fall * CAMERA.thud.land);
      }
      this.airVy = 0;
    }
    this.wasGrounded = ctl.grounded;
    this.springStep(dt, reduce);

    // Running free opens the view a little.
    const v = ctl.velocity;
    const speed = Math.hypot(v.x, v.z);
    const kick = reduce ? 0 : CAMERA.fovKick.deg * smoothstep(CAMERA.fovKick.from, CAMERA.fovKick.to, speed);
    this.fovKick = damp(this.fovKick, kick, CAMERA.fovKick.rate, dt);

    const cinema = CAMERA.cinema;
    const travel = reduce ? 0 : smoothstep(CAMERA.fovKick.from, CAMERA.fovKick.to, speed);
    const heading = Math.atan2(p.forward.x, p.forward.z);
    const turn = dt > 0 ? wrapAngle(heading - this.lastHeading) / dt : 0;
    this.lastHeading = heading;
    if (reduce) {
      this.pullBack = this.travelLift = this.travelAhead = this.roll = 0;
      this.fovKick = 0;
    } else {
      this.pullBack = damp(this.pullBack, cinema.pullBack * travel, cinema.rate, dt);
      this.travelLift = damp(this.travelLift, cinema.lift * travel, cinema.rate, dt);
      this.travelAhead = damp(this.travelAhead, cinema.ahead * travel, cinema.rate, dt);
      const bank = speed > 0.4 ? clamp(-turn * cinema.bank, -cinema.maxRoll, cinema.maxRoll) : 0;
      this.roll = damp(this.roll, bank, cinema.rate, dt);
    }

    // Camera height: stiff on the ground, loose in the air, never far from the player.
    const y = ctl.position.y;
    this.smoothY = damp(this.smoothY, y, ctl.grounded ? CAMERA.lagGround : CAMERA.lagAir, dt);
    this.smoothY = clamp(this.smoothY, y - CAMERA.maxLag, y + CAMERA.maxLag);
  }

  /** A soft downward kick (0..1), e.g. a heavy "thoom". Ignored with Reduce camera motion. */
  bump(strength: number, reduce: boolean): void {
    if (reduce || !(strength > 0)) return;
    this.bobV -= Math.min(1, strength) * CAMERA.thud.landMax * 1.5;
  }

  private springStep(dt: number, reduce: boolean): void {
    if (reduce) {
      this.bobV = 0;
      this.bob = damp(this.bob, 0, 10, dt);
      return;
    }
    const t = CAMERA.thud;
    this.bobV += (-t.k * this.bob - t.c * this.bobV) * dt;
    this.bob = clamp(this.bob + this.bobV * dt, -t.maxDip, t.maxDip);
  }
}

function sackSize(ch: CameraCharacter): number {
  const s = ch.burdenSize;
  return Number.isFinite(s) ? clamp(s, 0, CAMERA.maxBurden) : 0;
}
