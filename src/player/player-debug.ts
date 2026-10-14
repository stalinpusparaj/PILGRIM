/**
 * F1 panel controls for the player (dev builds / ?debug=1 only; plain English, no i18n): state readouts, bonk
 * buttons, the outfit swap and a speed-scale slider.
 */
import { services } from '../core/Services';
import type { Player } from './Player';
import { RECIPES } from './player-outfit';

const GROUP = 'Player';

export function installPlayerDebug(p: Player): () => void {
  const debug = services.tryGet('debug');
  if (!debug) return () => {};
  const offs = [
    debug.addReadout('Player', () => {
      const pos = p.controller.position;
      return (
        `${p.mode} ${p.isGrounded ? 'ground' : 'air'} ${p.speed.toFixed(1)} m/s ${p.animName} ` +
        `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`
      );
    }),
    debug.addReadout(
      'Bonks',
      () => `${p.bonks.count} (${p.bonks.lastReason ?? '-'}), safe spots ${p.bonks.safeSpots}`,
    ),
    debug.addButton(GROUP, 'Bonk (pit)', () => p.bonk('pit')),
    debug.addButton(GROUP, 'Bonk (arrow trip)', () => p.bonk('arrow')),
    debug.addButton(GROUP, 'Outfit burdened / free', () =>
      p.setRecipe(p.character.recipe.id === RECIPES.free ? RECIPES.burdened : RECIPES.free),
    ),
    debug.addSlider(
      GROUP,
      'Speed scale',
      0.2,
      2,
      0.05,
      () => p.speedScale,
      (v) => {
        p.speedScale = v;
      },
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}
