/**
 * The play session's loop systems (fixed 60 Hz update + per-frame render, src/core/Loop.ts) in their order:
 * input-driven player → zones, the Slough, Hope, the Burden → gifts (Prayer, Sword, Shield), interactables,
 * waystones, Promises → the follow camera → (fly cameras, PLAY_ORDER.cameraOverride) → HUD timers + playtime, and
 * per frame the world around the camera's view. Render runs in the same order: player interpolation → Slough sink → camera → world + HUD.
 */
import type { Loop, System } from '../core/Loop';

/** Loop orders of the session's systems (lower first; the Engine draws at 1000). */
export const PLAY_ORDER = {
  input: 100,
  zones: 110,
  interact: 120,
  camera: 130,
  /** Render-only systems that take the view over (TestWorld's fly cameras, the Cross): after the camera. */
  cameraOverride: 135,
  world: 140,
} as const;

interface Stepper {
  update(dt: number): void;
}

export interface PlayLoopParts {
  player: Stepper & { render(alpha: number): void };
  zones: Stepper;
  slough: Stepper & { render(alpha: number, frameDt: number): void };
  hope: Stepper;
  burden: Stepper;
  interactables: Stepper;
  /** Prayer, Sword and Shield (after the player moved, before the interactables). */
  gifts: Stepper & { render(frameDt: number): void };
  waystones: Stepper;
  promises: Stepper;
  camera: System;
  /** Fixed step, last: HUD timers, playtime. */
  tick(dt: number): void;
  /** Per rendered frame, after the camera: world.update(view), shadow focus, HUD bubble. */
  frame(frameDt: number): void;
}

/** Adds the systems; returns their remove functions (call them all on dispose). */
export function addPlayLoop(loop: Loop, p: PlayLoopParts): Array<() => void> {
  return [
    loop.add({ update: (dt) => p.player.update(dt), render: (a) => p.player.render(a) }, PLAY_ORDER.input),
    loop.add(
      {
        update: (dt) => {
          p.zones.update(dt);
          p.slough.update(dt);
          p.hope.update(dt);
          p.burden.update(dt);
        },
        render: (a, frameDt) => p.slough.render(a, frameDt),
      },
      PLAY_ORDER.zones,
    ),
    loop.add(
      {
        update: (dt) => {
          p.gifts.update(dt);
          p.interactables.update(dt);
          p.waystones.update(dt);
          p.promises.update(dt);
        },
        render: (_a, frameDt) => p.gifts.render(frameDt),
      },
      PLAY_ORDER.interact,
    ),
    loop.add(p.camera, PLAY_ORDER.camera),
    loop.add({ update: (dt) => p.tick(dt), render: (_a, frameDt) => p.frame(frameDt) }, PLAY_ORDER.world),
  ];
}
