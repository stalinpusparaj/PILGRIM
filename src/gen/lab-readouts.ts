/**
 * Character Lab readouts (the panel's numbers): frame stats, the focused character's draw calls, triangles,
 * height and build time, the lineup build and the crowd's draw calls. Dev tool: plain English.
 */
import type { Engine } from '../core/Engine';
import type { Character } from './CharacterFactory';
import { meshStats, type LabCast } from './lab-cast';
import type { LabCrowd } from './lab-lineup';

export type ReadoutRow = readonly [string, string];

export function labReadouts(
  engine: Engine,
  cast: LabCast,
  focus: Character | null,
  crowd: LabCrowd | null,
  recipeCount: number,
): ReadoutRow[] {
  const s = engine.stats;
  const c = focus;
  const parts = c ? meshStats(c.root) : null;
  const shadows = engine.renderer.shadowMap.enabled;
  const lineup = cast.lineup;
  const overlay = cast.overlayName ? ` + ${cast.overlayName}` : '';
  return [
    ['FPS', `${s.fps.toFixed(0)}  (${s.frameMs.toFixed(1)} ms)`],
    ['Draw calls', String(s.drawCalls)],
    ['Triangles', s.triangles.toLocaleString('en-US')],
    ['Character', c ? c.recipe.id : '-'],
    ['Char draw calls', parts ? `${parts.meshes}${shadows ? ' (+shadow)' : ''}` : '-'],
    ['Char triangles', parts ? parts.triangles.toLocaleString('en-US') : '-'],
    ['Char height', c ? `${c.height.toFixed(2)} m` : '-'],
    ['Build', `${cast.buildMs.toFixed(1)} ms`],
    [
      'Lineup',
      lineup
        ? `${lineup.characters.length}/${recipeCount} built, ${lineup.buildMs.toFixed(0)} ms total`
        : '-',
    ],
    [
      'Crowd',
      crowd ? `${crowd.total} in ${crowd.meshes.length} meshes = ${crowd.drawCalls(shadows)} calls` : 'off',
    ],
    ['Clip', c ? `${c.animator.current}${overlay}` : '-'],
  ];
}
