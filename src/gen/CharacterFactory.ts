/**
 * CharacterFactory (GDD 2.12, ARCHITECTURE "Characters"): builds a character from a recipe as ONE SkinnedMesh
 * (body, clothes, hair, hat, props, Burden sack and every face part, each rigidly bound to one bone) on a generated
 * skeleton, with the shared mat('skinned') material, so a character costs one draw call. Emissive bits (flames,
 * lantern glass, the forehead dot) go to a second tiny SkinnedMesh with mat('glow') on the same skeleton.
 */
import * as THREE from 'three';
import recipesJson from '../../content/characters/recipes.json';
import { Animator } from './anim/Animator';
import { DEFAULT_STYLE, type AnimName } from './anim/types';
import { mat } from './materials';
import { Rng, hashString } from './rng';
import {
  MOUTHS,
  type AttachBone,
  type Character,
  type CharacterRecipe,
  type Expression,
  type MouthShape,
} from './char-types';
import { FALLBACK_RECIPE, collectRecipes, normaliseRecipe } from './char-recipes';
import { assemble } from './char-build';
import { bakeSkinned } from './char-parts';
import { buildRig, type Layout } from './rig';
import { FaceRig } from './face';
import { SecondaryMotion } from './char-motion';

export type {
  AttachBone,
  BodyType,
  Character,
  CharacterRecipe,
  Expression,
  MouthShape,
  PropBone,
  PropType,
} from './char-types';
export { EXPRESSIONS, MOUTHS } from './char-types';
export { BEAST_BONES, BODY_BONES, FACE_BONES, type BoneName } from './rig';
export { normaliseRecipe } from './char-recipes';

const IDENTITY = new THREE.Matrix4();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const MAX_BURDEN = 1.6;
/** Full-body clips that close the eyes (ARCHITECTURE: setEyesClosed "nap, pray"). */
const EYES_CLOSED_CLIPS: ReadonlySet<AnimName> = new Set<AnimName>(['nap', 'pray']);
/** Full-body clips that force a mouth shape (a grin on joy jumps). */
const CLIP_MOUTH: Partial<Record<AnimName, MouthShape>> = { joyJump: 'grin' };

class CharacterImpl implements Character {
  readonly recipe: CharacterRecipe;
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly glowMesh: THREE.SkinnedMesh | null;
  readonly bones: Record<string, THREE.Bone>;
  readonly skeleton: THREE.Skeleton;
  readonly animator: Animator;
  readonly height: number;
  readonly triangles: number;
  onSparkle: ((worldPos: THREE.Vector3) => void) | null = null;

  private readonly face: FaceRig;
  private readonly motion: SecondaryMotion;
  private readonly head: THREE.Bone;
  private readonly sack: THREE.Bone;
  private readonly hat: THREE.Bone;
  private readonly baseHead = new THREE.Quaternion();
  private readonly baseSack = new THREE.Quaternion();
  private readonly baseHat = new THREE.Quaternion();
  private readonly nodQ = new THREE.Quaternion();
  private readonly sparkleRng: Rng;
  private readonly sparklePos = new THREE.Vector3();
  private sparkleWait = 0;
  /** What scripts asked for; the face also follows the playing clip (nap/pray close the eyes, joy jump grins). */
  private eyesClosed = false;
  private mouth: MouthShape | null = null;
  private readonly attached: THREE.Object3D[] = [];
  private disposed = false;

  constructor(recipe: CharacterRecipe, rng: Rng) {
    this.recipe = recipe;
    const { parts, layout } = assemble(recipe, rng.fork('parts'), 'hero', MOUTHS);
    const rig = buildRig(layout);
    this.bones = rig.bones;
    const baked = bakeSkinned(parts.items, rig.index, recipe.glow === true);

    this.root.name = `character:${recipe.id}`;
    this.mesh = new THREE.SkinnedMesh(baked.main, mat(recipe.glow ? 'glow' : 'skinned'));
    this.mesh.name = `${recipe.id}:body`;
    this.mesh.castShadow = true;
    this.root.add(rig.rootBone, this.mesh);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(rig.list); // inverses from the bind pose (root at the origin)
    this.mesh.bind(this.skeleton, IDENTITY);
    // Fixed bounds with room for the limbs, so three never has to skin every vertex on the CPU to cull.
    const sphere = baked.main.boundingBox!.getBoundingSphere(new THREE.Sphere());
    sphere.radius *= 1.35;
    this.mesh.boundingSphere = sphere;

    if (baked.glow) {
      const g = new THREE.SkinnedMesh(baked.glow, mat('glow'));
      g.name = `${recipe.id}:glow`;
      this.root.add(g);
      g.bind(this.skeleton, IDENTITY);
      g.boundingSphere = sphere.clone();
      this.glowMesh = g;
    } else {
      this.glowMesh = null;
    }
    this.triangles =
      (baked.main.getAttribute('position').count + (baked.glow?.getAttribute('position').count ?? 0)) / 3;
    this.height = layout.height;

    const need = (n: string): THREE.Bone => {
      const b = this.bones[n];
      if (!b) throw new Error(`CharacterFactory: missing bone "${n}"`);
      return b;
    };
    this.head = need('head');
    this.sack = need('sack');
    this.hat = need('hat');
    const burden = recipe.burden ? 1 : 0;
    this.animator = new Animator(this.bones, {
      speed: 0,
      burden,
      time: rng.fork('anim').range(0, 10), // desyncs idle breathing between characters
      style: { ...DEFAULT_STYLE, ...recipe.style },
      height: this.height,
      pose: recipe.pose ?? null,
    });
    this.correctRigInfo(layout);
    this.face = new FaceRig(this.bones, layout.body.headR, rng.fork('face'), recipe.expression ?? 'neutral');
    this.motion = new SecondaryMotion(
      this.root,
      { hips: need('hips'), sack: this.sack, hat: this.hat, ropes: need('ropes') },
      layout.body.scale,
      burden,
    );
    this.sparkleRng = rng.fork('sparkle');
    this.baseHead.copy(this.head.quaternion);
    this.baseSack.copy(this.sack.quaternion);
    this.baseHat.copy(this.hat.quaternion);
  }

  /** The Animator measures bones; head size, body radius and mitten reach come from the actual layout. */
  private correctRigInfo(L: Layout): void {
    const info = this.animator.params.rig;
    if (!info) return;
    const b = L.body;
    const p = L.pos;
    info.headR = b.headR;
    info.bodyR = b.torsoRZ * (1 + b.belly);
    info.kneeR = b.shinR;
    info.headDist = L.headC.distanceTo(p.hips!);
    info.headC.copy(L.headC).sub(p.chest!);
    info.lowerArm = p.lowerArmL!.distanceTo(p.propL!);
  }

  get expression(): Expression {
    return this.face.expression;
  }

  get burdenSize(): number {
    return this.motion.burdenSize;
  }

  setExpression(e: Expression): void {
    this.face.setExpression(e);
  }

  setTalking(on: boolean): void {
    this.face.setTalking(on);
  }

  setMouth(shape: MouthShape | null): void {
    this.mouth = shape;
  }

  setEyesClosed(closed: boolean): void {
    this.eyesClosed = closed;
  }

  setBurdenSize(s: number): void {
    if (!this.recipe.burden) return;
    const v = Math.min(MAX_BURDEN, Math.max(0, Number.isFinite(s) ? s : 0));
    this.motion.burdenTarget = v;
    this.animator.params.burden = v;
  }

  attach(obj: THREE.Object3D, bone: AttachBone): void {
    const b = this.bones[bone];
    if (!b || this.disposed) return;
    b.add(obj);
    this.attached.push(obj);
  }

  update(dt: number): void {
    if (this.disposed) return;
    // Undo last frame's additive layers so the animator's output is the clean base again, whether or not the
    // animator writes these bones itself.
    this.head.quaternion.copy(this.baseHead);
    this.sack.quaternion.copy(this.baseSack);
    this.hat.quaternion.copy(this.baseHat);
    this.animator.update(dt);
    this.baseHead.copy(this.head.quaternion);
    this.baseSack.copy(this.sack.quaternion);
    this.baseHat.copy(this.hat.quaternion);

    const clip = this.animator.current;
    this.face.setEyesClosed(this.eyesClosed || EYES_CLOSED_CLIPS.has(clip));
    this.face.setMouth(this.mouth ?? CLIP_MOUTH[clip] ?? null);
    this.face.update(dt);
    this.motion.update(dt);
    const nod = this.face.headNod;
    if (nod !== 0) this.head.quaternion.multiply(this.nodQ.setFromAxisAngle(X_AXIS, nod));
    if (this.recipe.glow && this.onSparkle) this.updateSparkles(dt);
  }

  private updateSparkles(dt: number): void {
    this.sparkleWait -= dt;
    if (this.sparkleWait > 0 || !this.onSparkle) return;
    const r = this.sparkleRng;
    this.sparkleWait = r.range(0.1, 0.3);
    const h = this.height;
    this.sparklePos.set(r.range(-0.2, 0.2) * h, r.range(0.1, 1.05) * h, r.range(-0.12, 0.12) * h);
    this.root.localToWorld(this.sparklePos);
    this.onSparkle(this.sparklePos);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of this.attached) o.removeFromParent();
    this.attached.length = 0;
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.glowMesh?.geometry.dispose();
    this.skeleton.dispose();
    this.onSparkle = null;
  }
}

let recipeCache: Record<string, CharacterRecipe> | null = null;
const warned = new Set<string>();

export class CharacterFactory {
  /** Every recipe in content/characters/recipes.json, validated and normalised (a fresh record each call). */
  static recipes(): Record<string, CharacterRecipe> {
    if (!recipeCache) recipeCache = collectRecipes(recipesJson as unknown);
    return { ...recipeCache };
  }

  /**
   * Builds a character. A string is looked up in recipes.json (unknown ids warn once and build a plain villager);
   * an object is normalised first, so hand-edited recipes (the Lab) can never crash the build.
   */
  static build(recipe: CharacterRecipe | string, rng?: Rng): Character {
    let r: CharacterRecipe;
    if (typeof recipe === 'string') {
      const found = CharacterFactory.recipes()[recipe];
      if (!found && !warned.has(recipe)) {
        warned.add(recipe);
        console.warn(`[CharacterFactory] unknown recipe "${recipe}", building a villager instead`);
      }
      r = found ?? { ...FALLBACK_RECIPE, id: recipe };
    } else {
      r = normaliseRecipe(recipe, typeof recipe.id === 'string' ? recipe.id : 'recipe');
    }
    return new CharacterImpl(r, rng ?? new Rng(hashString(r.id)));
  }
}
