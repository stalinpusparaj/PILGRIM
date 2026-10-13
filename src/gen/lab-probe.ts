/**
 * Character Lab probe (`window.__pilgrim.lab`): what the Playwright Lab test and the console use to drive the
 * Lab and measure the cast. Dev tool only; it is created by src/modes.ts when `?lab=1` runs.
 *
 * - `measureRecipe(id)` builds a fresh character, renders it alone into a small offscreen target and reads the
 *   renderer's draw calls and triangles (no shadow pass: the probe scene has no shadow-casting light).
 * - `exercise(id)` builds a character offscreen and runs every clip (full body and overlays), every
 *   expression, talking and the Burden spring through `update()`, checking that every bone stays finite.
 * - `measureCrowd()` renders the Lab's crowd alone, with and without a shadow pass.
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import {
  CharacterFactory,
  EXPRESSIONS,
  type Character,
  type CharacterRecipe,
  type Expression,
} from './CharacterFactory';
import { ANIM_NAMES, CLIPS, NOMINAL_SPEED, isUpperClip, type AnimName } from './anim';
import { EXPRESSION_DEFS } from './face';
import { Rng, hashString } from './rng';
import type { LabCast } from './lab-cast';
import type { LabCrowd } from './lab-lineup';
import type { BlobShadows } from './BlobShadows';
import { footSlip } from './lab-footslip';
import type { LabPanelHandlers, LabShot, LabView } from './lab-panel';

/** What the Lab hands the probe (Lab.inspect()). */
export interface LabInternals {
  readonly ids: readonly string[];
  readonly controls: LabPanelHandlers;
  readonly cast: LabCast;
  readonly crowd: LabCrowd | null;
  readonly scene: THREE.Scene;
  /** The stage's blob shadows (one call for the cast and the crowd). */
  readonly blobs: BlobShadows;
  readonly camera: THREE.PerspectiveCamera;
  readonly turntable: THREE.Object3D;
  recipeOf(id: string): CharacterRecipe;
}

export interface RecipeStats {
  id: string;
  /** Draw calls of the main SkinnedMesh alone (body, clothes, props, Burden and the whole face). */
  meshCalls: number;
  /** Draw calls of the whole character (main mesh + the tiny glow mesh, if the recipe has glowing bits). */
  drawCalls: number;
  triangles: number;
  meshes: number;
  hasGlow: boolean;
  height: number;
  buildMs: number;
}

export interface ExerciseResult {
  id: string;
  clips: number;
  expressions: number;
  /** Lowest bone (world y, m) seen over all clips; feet stand on y = 0. */
  lowestBone: number;
  /** Blinks seen in BLINK_WATCH seconds of a neutral idle (eye bones squashed below half open). */
  blinks: number;
  /** Planted-foot slide at mid-stance as a share of body speed, per locomotion clip at its NOMINAL_SPEED. */
  slip: Partial<Record<AnimName, number>>;
  issues: string[];
}

export interface CrowdStats {
  instances: number;
  meshes: number;
  /** Colour pass only: one call per body type with citizens. */
  drawCalls: number;
  /** Measured: what the crowd adds to a frame of the Lab scene, colour plus shadow pass (shadows on). */
  drawCallsWithShadows: number;
  triangles: number;
}

export interface LabProbe {
  ready(): boolean;
  recipeIds(): string[];
  clipNames(): AnimName[];
  expressions(): Expression[];
  select(id: string): void;
  view(v: LabView): void;
  shot(s: LabShot): void;
  crowd(on: boolean): void;
  play(name: AnimName): void;
  expression(e: Expression): void;
  talking(on: boolean): void;
  burden(size: number): void;
  setRepeat(on: boolean): void;
  /** Stops the turntable and turns it to `angle` (rad; 0 = the character faces the camera). */
  turn(angle: number): void;
  lineupBuilt(): number;
  current(): { id: string; clip: AnimName; overlay: AnimName | null; height: number } | null;
  /** Every bone of the turntable character has a finite world matrix. */
  poseFinite(): boolean;
  measureRecipe(id: string): RecipeStats;
  exercise(id: string): ExerciseResult;
  measureCrowd(): CrowdStats | null;
}

const STEP = 1 / 60;
const MAX_CLIP_SECONDS = 3;
const PROBE_TARGET = 64;
/** Locomotion clips whose planted feet are checked for sliding (lab-footslip.ts). */
const SLIP_CLIPS: readonly AnimName[] = ['walk', 'run', 'burdenedWalk'];
/** Seconds of idle watched for blinks (one every 2-5 s). */
const BLINK_WATCH = 12;

export function createLabProbe(engine: Engine, inspect: () => LabInternals | null): LabProbe {
  const need = (): LabInternals => {
    const i = inspect();
    if (!i) throw new Error('[lab probe] the Lab is not running');
    return i;
  };

  return {
    ready: () => inspect()?.cast.character != null,
    recipeIds: () => [...need().ids],
    clipNames: () => [...ANIM_NAMES],
    expressions: () => [...EXPRESSIONS],
    select: (id) => need().controls.selectRecipe(id),
    view: (v) => need().controls.setView(v),
    shot: (s) => need().controls.setShot(s),
    crowd: (on) => need().controls.setCrowd(on),
    play: (name) => {
      const c = need().controls;
      if (isUpperClip(name)) c.overlay(name);
      else c.play(name);
    },
    expression: (e) => need().controls.setExpression(e),
    talking: (on) => need().controls.setTalking(on),
    burden: (s) => need().controls.setBurden(s),
    setRepeat: (on) => need().controls.setRepeat(on),
    turn: (angle) => {
      const i = need();
      i.controls.setRotate(false);
      i.turntable.rotation.y = angle;
    },
    lineupBuilt: () => inspect()?.cast.lineup?.characters.length ?? 0,
    current: () => {
      const c = inspect()?.cast.character;
      if (!c) return null;
      return {
        id: c.recipe.id,
        clip: c.animator.current,
        overlay: c.animator.overlayName,
        height: c.height,
      };
    },
    poseFinite: () => {
      const c = inspect()?.cast.character;
      return c ? bonesFinite(c) : false;
    },
    measureRecipe: (id) => measureRecipe(engine, need().recipeOf(id)),
    exercise: (id) => exercise(need().recipeOf(id)),
    measureCrowd: () => {
      const i = need();
      return i.crowd ? measureCrowd(engine, i.crowd, i.scene, i.blobs) : null;
    },
  };
}

// ------------------------------------------------------------------------------------------- measuring

function build(recipe: CharacterRecipe): { c: Character; ms: number } {
  const t0 = performance.now();
  const c = CharacterFactory.build(recipe, new Rng(hashString(recipe.id)));
  return { c, ms: performance.now() - t0 };
}

/** Renders `scene` once into a small offscreen target; returns the renderer's counts for that render. */
function renderCounts(
  engine: Engine,
  scene: THREE.Scene,
  camera: THREE.Camera,
): { calls: number; triangles: number } {
  const r = engine.renderer;
  const target = new THREE.WebGLRenderTarget(PROBE_TARGET, PROBE_TARGET);
  const previous = r.getRenderTarget();
  try {
    r.setRenderTarget(target);
    r.render(scene, camera);
    return { calls: r.info.render.calls, triangles: r.info.render.triangles };
  } finally {
    r.setRenderTarget(previous);
    target.dispose();
  }
}

function measureRecipe(engine: Engine, recipe: CharacterRecipe): RecipeStats {
  const { c, ms } = build(recipe);
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi, c.root);
  try {
    c.update(STEP);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    camera.position.set(0, c.height * 0.6, c.height * 3 + 2);
    camera.lookAt(0, c.height * 0.5, 0);
    const all = renderCounts(engine, scene, camera);
    let meshCalls = all.calls;
    if (c.glowMesh) {
      c.glowMesh.visible = false;
      meshCalls = renderCounts(engine, scene, camera).calls;
      c.glowMesh.visible = true;
    }
    let meshes = 0;
    c.root.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    return {
      id: recipe.id,
      meshCalls,
      drawCalls: all.calls,
      triangles: all.triangles,
      meshes,
      hasGlow: c.glowMesh !== null,
      height: c.height,
      buildMs: ms,
    };
  } finally {
    c.root.removeFromParent();
    c.dispose();
    hemi.dispose();
  }
}

function bonesFinite(c: Character): boolean {
  c.root.updateMatrixWorld(true);
  for (const bone of Object.values(c.bones)) {
    for (const v of bone.matrixWorld.elements) if (!Number.isFinite(v)) return false;
  }
  return true;
}

function lowestBoneY(c: Character): number {
  let low = Infinity;
  const p = new THREE.Vector3();
  for (const bone of Object.values(c.bones)) low = Math.min(low, p.setFromMatrixPosition(bone.matrixWorld).y);
  return low;
}

function run(c: Character, seconds: number, issues: string[], label: string, low: { y: number }): void {
  const steps = Math.ceil(seconds / STEP);
  for (let i = 0; i < steps; i++) c.update(STEP);
  if (!bonesFinite(c)) issues.push(`${label}: a bone matrix is not finite`);
  else low.y = Math.min(low.y, lowestBoneY(c));
}

function exercise(recipe: CharacterRecipe): ExerciseResult {
  const issues: string[] = [];
  const low = { y: Infinity };
  let clips = 0;
  let expressions = 0;
  let blinks = 0;
  const { c } = build(recipe);
  try {
    const a = c.animator;
    for (const name of ANIM_NAMES) {
      const clip = CLIPS[name];
      try {
        a.params.speed = NOMINAL_SPEED[name as keyof typeof NOMINAL_SPEED] ?? 0;
        if (isUpperClip(name)) {
          a.play('idle', { fade: 0 });
          a.overlay(name, { fade: 0.2, restart: true });
        } else {
          a.overlay(null, { fade: 0 });
          a.play(name, { fade: 0.25, restart: true });
        }
        run(c, Math.min(MAX_CLIP_SECONDS, clip.duration + 0.3), issues, name, low);
        // Napping and praying close the eyes (the face follows the clip).
        const eye = c.bones.eyeL;
        if ((name === 'nap' || name === 'pray') && eye && eye.scale.y > 0.5 * eye.scale.x)
          issues.push(`${name}: the eyes stay open`);
        clips++;
      } catch (err) {
        issues.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    a.overlay(null, { fade: 0 });
    a.play('idle', { fade: 0 });
    c.setExpression('neutral');
    run(c, 0.5, issues, 'neutral', low);
    blinks = countBlinks(c, BLINK_WATCH);
    for (const e of EXPRESSIONS) {
      try {
        c.setExpression(e);
        run(c, 0.3, issues, `expression ${e}`, low);
        const want = `mouth_${EXPRESSION_DEFS[e].mouth}`;
        for (const [name, bone] of Object.entries(c.bones)) {
          if (!name.startsWith('mouth_')) continue;
          const shown = bone.scale.x > 0.5;
          if (shown !== (name === want))
            issues.push(`expression ${e}: ${name} ${shown ? 'shown' : 'hidden'}`);
        }
        expressions++;
      } catch (err) {
        issues.push(`expression ${e}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    c.setTalking(true);
    run(c, 1, issues, 'talking', low);
    c.setTalking(false);
    if (recipe.burden) {
      c.setBurdenSize(1.6);
      run(c, 1, issues, 'burden 1.6', low);
      c.setBurdenSize(0);
      run(c, 1, issues, 'burden 0', low);
    }
  } finally {
    c.dispose();
  }
  const slip: Partial<Record<AnimName, number>> = {};
  for (const name of SLIP_CLIPS) slip[name] = footSlip(recipe, name, NOMINAL_SPEED[name] ?? 1);
  return { id: recipe.id, clips, expressions, lowestBone: low.y, blinks, slip, issues };
}

/** Steps `seconds` of the current state and counts eye closures (Y scale under half the X scale). */
function countBlinks(c: Character, seconds: number): number {
  const eye = c.bones.eyeL;
  if (!eye) return 0;
  let blinks = 0;
  let shut = false;
  for (let i = 0, n = Math.ceil(seconds / STEP); i < n; i++) {
    c.update(STEP);
    const open = eye.scale.y / Math.max(1e-6, eye.scale.x);
    if (open < 0.5 && !shut) {
      blinks++;
      shut = true;
    } else if (open > 0.7) {
      shut = false;
    }
  }
  return blinks;
}

/**
 * The crowd's real cost in the Lab scene (its sun, its shadow map): the scene is rendered from a camera looking
 * at the crowd with the crowd shown and hidden; the difference is what the crowd costs (colour + shadow pass).
 * Its blob shadows are counted in the triangles; their draw call is the scene's single blob call, which the cast
 * already pays for.
 */
function measureCrowd(engine: Engine, crowd: LabCrowd, scene: THREE.Scene, blobs: BlobShadows): CrowdStats {
  const box = new THREE.Box3();
  for (const m of crowd.meshes) {
    m.mesh.computeBoundingBox();
    if (m.mesh.boundingBox) box.union(m.mesh.boundingBox);
  }
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, radius * 20);
  camera.position.set(center.x, center.y + radius * 0.8, center.z + radius * 2.2);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  let instances = 0;
  for (const m of crowd.meshes) instances += m.count;
  const visible = crowd.group.visible;
  try {
    // The citizens' blob shadows follow the crowd's visibility (they share the cast's one blob call).
    crowd.group.visible = true;
    blobs.update();
    const on = renderCounts(engine, scene, camera);
    crowd.group.visible = false;
    blobs.update();
    const off = renderCounts(engine, scene, camera);
    let colour = 0;
    for (const m of crowd.meshes) if (m.count > 0) colour++;
    return {
      instances,
      meshes: crowd.meshes.length,
      drawCalls: colour,
      drawCallsWithShadows: on.calls - off.calls,
      triangles: on.triangles - off.triangles,
    };
  } finally {
    crowd.group.visible = visible;
    blobs.update();
  }
}
