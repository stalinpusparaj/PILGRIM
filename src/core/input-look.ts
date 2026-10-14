/**
 * Look maths for Input (src/core/Input.ts): mouse, touch-drag and right-stick deltas to camera radians, the clamp for
 * pointer-lock spikes, and how much mouse look makes someone a mouse player (the auto-camera's 'default' setting
 * stays on for keyboard-only players, GDD 2.15 "playable with keyboard only").
 */
import { FIXED_DT } from './Loop';

/** Look speed before Settings.cameraSpeed: radians per mouse px, per touch px, per second of full stick. */
const MOUSE_LOOK = 0.0022;
const TOUCH_LOOK = 0.006;
const PAD_LOOK = 3.2;
/** Clamp for single pointer-lock movement events (some platforms report huge spikes). */
const MAX_MOUSE_EVENT_PX = 250;
/** This much mouse look in a session (px) means the player turns the camera with the mouse. */
export const MOUSE_HABIT_PX = 400;

export function clampMousePx(v: number): number {
  return Math.min(MAX_MOUSE_EVENT_PX, Math.max(-MAX_MOUSE_EVENT_PX, v));
}

/** Radians for one fixed step: x > 0 turns right, y > 0 looks up; `speed` = cameraSpeed, `invert` = ±1. */
export function lookStep(
  out: { x: number; y: number },
  mouse: { x: number; y: number },
  touch: { x: number; y: number },
  stick: { x: number; y: number },
  speed: number,
  invert: number,
): void {
  // Squared stick response: fine aim near the centre, full speed at the edge.
  const padStep = PAD_LOOK * FIXED_DT * Math.hypot(stick.x, stick.y);
  const x = mouse.x * MOUSE_LOOK + touch.x * TOUCH_LOOK + stick.x * padStep;
  const y = stick.y * padStep - (mouse.y * MOUSE_LOOK + touch.y * TOUCH_LOOK);
  out.x = x * speed;
  out.y = y * speed * invert;
}
