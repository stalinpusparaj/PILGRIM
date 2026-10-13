/**
 * Foot-slide check for the Lab probe: walks a fresh character along +Z at a speed with a locomotion clip and
 * measures how fast the planted foot moves at mid-stance (gait phase 0.1-0.4 for the left foot, 0.6-0.9 for the
 * right; runs 0.17-0.33 / 0.67-0.83, their contact windows). Returned as a share of the body speed: 0 = the foot
 * stays planted, 1 = it skates along with the body.
 */
import * as THREE from 'three';
import { CharacterFactory, type CharacterRecipe } from './CharacterFactory';
import type { AnimName } from './anim';
import { Rng, hashString } from './rng';

const STEP = 1 / 120;
const WARM = 1;
const WATCH = 3;

export function footSlip(recipe: CharacterRecipe, clip: AnimName, speed: number): number {
  const c = CharacterFactory.build(recipe, new Rng(hashString(recipe.id)));
  try {
    const a = c.animator;
    a.params.speed = speed;
    if (clip === 'burdenedWalk') a.params.burden = Math.max(1, a.params.burden);
    a.play(clip, { fade: 0, restart: true });
    const run = clip === 'run' || clip === 'coverEarsRun';
    const w0 = run ? 0.17 : 0.1;
    const w1 = run ? 0.33 : 0.4;
    const l = new THREE.Vector3();
    const r = new THREE.Vector3();
    const pl = new THREE.Vector3();
    const pr = new THREE.Vector3();
    const speeds: number[] = [];
    const n = Math.round((WARM + WATCH) / STEP);
    for (let i = 0; i < n; i++) {
      c.root.position.set(0, 0, speed * i * STEP);
      c.update(STEP);
      c.root.updateMatrixWorld(true);
      c.bones.footL!.getWorldPosition(l);
      c.bones.footR!.getWorldPosition(r);
      if (i * STEP >= WARM) {
        const g = a.gaitPhase;
        if (g >= w0 && g <= w1) speeds.push(Math.hypot(l.x - pl.x, l.z - pl.z) / STEP);
        else if (g >= w0 + 0.5 && g <= w1 + 0.5) speeds.push(Math.hypot(r.x - pr.x, r.z - pr.z) / STEP);
      }
      pl.copy(l);
      pr.copy(r);
    }
    speeds.sort((x, y) => x - y);
    return speed > 0 ? (speeds[Math.floor(speeds.length / 2)] ?? 0) / speed : 0;
  } finally {
    c.dispose();
  }
}
