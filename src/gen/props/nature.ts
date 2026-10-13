/**
 * Nature prop registry (GDD 2.12 prop builders). Every builder returns ONE merged, flat-shaded, vertex-coloured
 * geometry at the origin, standing on y = 0 and facing +Z, plus simple colliders in local space.
 *
 * Common params (all optional; missing ones are drawn from the rng, so a given rng + params is deterministic):
 *   variant 0..3   shape variant
 *   height  m      overall height (log: thickness, lily: pad radius)
 *   colour  #hex   main colour override (`color` also accepted)
 *   lod     0|1    1 = fewer segments for distant instances (same layout, silhouette and colours)
 * Extra: `length` (m) for log and vine_row; `orchard: true` on tree_fruit (= fruit_tree_orchard).
 *
 * Triangle budgets (full detail): grass <= 36, flower <= 54, rock <= 76, reeds/lily <= 80, bush <= 140,
 * mushroom <= 144, trees < 300, vine_row ~250 for a 6 m row.
 */
import type { PropBuilder } from '../types';
import { log, mushroom, rock, stump, vineRow } from './nature-ground';
import { bush, flower, grass, lily, reeds } from './nature-plants';
import { treeCone, treeDead, treeFruit, treeOrchard, treeRound } from './nature-trees';

export const NATURE_PROPS: Record<string, PropBuilder> = {
  tree_cone: treeCone,
  tree_round: treeRound,
  tree_dead: treeDead,
  tree_fruit: treeFruit,
  fruit_tree_orchard: treeOrchard,
  bush,
  reeds,
  grass,
  rock,
  flower,
  lily,
  mushroom,
  log,
  stump,
  vine_row: vineRow,
};
