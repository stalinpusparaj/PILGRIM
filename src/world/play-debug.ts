/**
 * F1 panel controls for a play session (GDD 2.15 "toggle Burden, set Hope, show triggers/zones/Way spline";
 * dev builds or ?debug=1 only). Developer-facing: plain English, no i18n.
 *
 * Group "Play": Burden on/off (the outfit follows), "Cross drop now" (the full GDD 2.7.1 sequence toward the
 * level's tomb when it is near, else 12 m ahead; "Go to the Cross" first for the real framing), teleport to each waystone, god mode (no Hope drain, no bonks; starts from
 * ?god=1), collider / Way wireframes. The other controls the session needs come from the systems themselves and
 * are not repeated here: "Grow +0.3" and the Burden readout (BurdenSystem), the Hope slider and "Hope 0 (I SHALL
 * ARISE)" (HopeSystem), "Bonk (pit)" and the Player readout (Player), "Show zones" (Zones), the time scale (core).
 */
import type { Debug } from '../core/Debug';
import type { GameState } from '../core/GameState';
import { PlayGizmos } from './play-gizmos';
import type { World } from './World';

/** What the controls drive (PlaySession). */
export interface PlayDebugHost {
  readonly world: World;
  readonly state: GameState;
  god: boolean;
  setBurden(on: boolean): void;
  crossDrop(): Promise<void>;
  goToCross(): boolean;
  /** To a waystone of the level (null: the Way's start). */
  respawn(waystone: string | null): void;
}

const GROUP = 'Play';

/** Installs the controls; returns a function that removes them and frees the wireframes. */
export function installPlayDebug(host: PlayDebugHost, debug: Debug): () => void {
  const gizmos = new PlayGizmos(host.world);
  host.world.scene.add(gizmos.object);
  let crossRunning = false;
  const offs: Array<() => void> = [
    debug.addToggle(
      GROUP,
      'Burden',
      () => host.state.burden,
      (on) => host.setBurden(on),
    ),
    debug.addButton(GROUP, 'Go to the Cross', () => host.goToCross()),
    debug.addButton(GROUP, 'Cross drop now', () => {
      if (crossRunning) return;
      crossRunning = true;
      host
        .crossDrop()
        .catch((err: unknown) => console.error('[play] Cross drop failed', err))
        .finally(() => {
          crossRunning = false;
        });
    }),
    debug.addToggle(
      GROUP,
      'God mode',
      () => host.god,
      (on) => (host.god = on),
    ),
    debug.addToggle(
      GROUP,
      'Show colliders',
      () => gizmos.shown('colliders'),
      (on) => gizmos.set('colliders', on),
    ),
    debug.addToggle(
      GROUP,
      'Show Way',
      () => gizmos.shown('way'),
      (on) => gizmos.set('way', on),
    ),
  ];
  for (const w of host.world.level.waystones) {
    offs.push(debug.addButton(GROUP, `Go to ${w.id}`, () => host.respawn(w.id)));
  }
  return () => {
    for (const off of offs.splice(0)) off();
    gizmos.dispose();
  };
}
