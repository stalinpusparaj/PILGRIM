/**
 * Player outfits (GDD 2.7.1, 2.10 Ch VI, 2.11): which Christian recipe a session starts in, the sparkly outfit swap
 * that keeps the animator state, and the walk personality that follows the Burden.
 *
 * Dropping the Burden does not change clothes: the Cross leaves Christian in his old tunic without the sack, and
 * the Shining Ones' white clothes are their own sparkle swap later in Ch VI (`player.setRecipe('christian_free')`).
 * What changes at once is how he moves: a burdened outfit without its Burden walks with christian_free's light,
 * upright, bouncy style. The sack size belongs to the Burden system (src/player/Burden.ts).
 */
import * as THREE from 'three';
import '../audio/events';
import { events } from '../core/Events';
import { CharacterFactory, type Character } from '../gen/CharacterFactory';
import { DEFAULT_STYLE, type AnimStyle } from '../gen/anim';
import type { World } from '../world/World';

export const RECIPES = { burdened: 'christian_burdened', free: 'christian_free' } as const;

/** Sparkle burst on an outfit swap. */
const SWAP = { sparkles: 24, chest: 0.55 } as const;

const at = new THREE.Vector3();

/** A session starts in christian_burdened while burdened, christian_free after; other outfits stay as they are. */
export function recipeFor(id: string, burdened: boolean): string {
  if (id === RECIPES.burdened && !burdened) return RECIPES.free;
  if (id === RECIPES.free && burdened) return RECIPES.burdened;
  return id;
}

/**
 * Builds the `id` outfit in `old`'s place: same transform, visibility, clip, overlay, cadence, clock and
 * expression, posed at once (no bind-pose frame), with a sparkle burst and chime. The caller disposes `old`.
 */
export function swapCharacter(old: Character, id: string, world: World): Character {
  const next = CharacterFactory.build(id);
  next.root.position.copy(old.root.position);
  next.root.quaternion.copy(old.root.quaternion);
  next.root.visible = old.root.visible;
  const a = old.animator;
  const b = next.animator;
  b.params.speed = a.params.speed;
  b.params.time = a.params.time;
  b.params.rootMotion = a.params.rootMotion;
  b.play(a.current, { fade: 0 });
  if (a.overlayName) b.overlay(a.overlayName, { fade: 0 });
  b.steps = a.steps;
  b.cues = a.cues;
  next.setExpression(old.expression);
  if (next.recipe.burden) next.setBurdenSize(old.recipe.burden ? old.burdenSize : 1);
  next.update(0);

  const chest = old.bones['chest'];
  if (chest) chest.getWorldPosition(at);
  else at.copy(old.root.position).setY(old.root.position.y + old.height * SWAP.chest);
  world.particles.emit('sparkle', at, SWAP.sparkles);
  events.emit('sfx', { id: 'sparkle', at: [at.x, at.y, at.z] });
  return next;
}

let freeStyle: AnimStyle | null = null;

/** christian_free's walk personality (bounce, upright lean), read once from the recipes. */
function freedStyle(): AnimStyle {
  freeStyle ??= { ...DEFAULT_STYLE, ...CharacterFactory.recipes()[RECIPES.free]?.style };
  return freeStyle;
}

/**
 * The walk personality of the player's Character: its own recipe style, or, for an outfit made for the Burden
 * worn without it (after the Cross), the freed style. Writes `animator.params.style` only when that changes.
 */
export class GaitStyle {
  private c: Character | null = null;
  private readonly base: AnimStyle = { ...DEFAULT_STYLE };
  private freed: boolean | null = null;

  bind(c: Character): void {
    this.c = c;
    Object.assign(this.base, c.animator.params.style);
    this.freed = null;
  }

  /** Call every fixed step with GameState.burden. */
  apply(burdened: boolean): void {
    const c = this.c;
    if (!c) return;
    const freed = !burdened && c.recipe.burden === true;
    if (freed === this.freed) return;
    this.freed = freed;
    Object.assign(c.animator.params.style, freed ? freedStyle() : this.base);
  }

  dispose(): void {
    this.c = null;
  }
}
