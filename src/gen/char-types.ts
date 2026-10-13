/**
 * Character recipe + runtime types (ARCHITECTURE "Characters") and the allowed values the recipe loader validates
 * against. No runtime imports, so rig.ts, face.ts, the part builders and the animation library can all share these
 * without import cycles. `CharacterFactory.ts` re-exports everything public from here.
 */
import type * as THREE from 'three';
import type { Animator } from './anim/Animator';

export const BODY_TYPES = [
  'adult',
  'adultF',
  'elder',
  'child',
  'youngAdult',
  'stocky',
  'thin',
  'big',
  'giant',
  'giantess',
  'tall',
  'beast',
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const EXPRESSIONS = [
  'neutral',
  'happy',
  'sad',
  'scared',
  'surprised',
  'angry',
  'sleepy',
  'determined',
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** Mouth shapes; each lives on its own `mouth_<shape>` bone (scale 1 = shown, 0 = hidden). */
export const MOUTHS = ['neutral', 'smile', 'open', 'frown', 'o', 'flat', 'wavy', 'grin'] as const;
export type MouthShape = (typeof MOUTHS)[number];

export const TOPS = ['tunic', 'robe', 'dress', 'coat', 'vest', 'shirt', 'judge'] as const;
export const BOTTOMS = ['trousers', 'robe', 'skirt'] as const;
export const HAIRS = ['none', 'short', 'curls', 'bun', 'long', 'tuft', 'bald'] as const;
export const BEARDS = ['none', 'short', 'full', 'long'] as const;
export const HATS = [
  'none',
  'cap',
  'hood',
  'tall',
  'wig',
  'scarf',
  'helmet',
  'droopy',
  'mirrorMask',
] as const;
export const PROP_TYPES = [
  'staff',
  'candle',
  'lantern',
  'keys',
  'book',
  'gavel',
  'crook',
  'sword',
  'shield',
  'cane',
  'letter',
  'toy',
  'club',
  'pole',
] as const;
export const PROP_BONES = ['propL', 'propR', 'back'] as const;
/** Design-sheet signature rest poses (GDD 2.11), held by the idle clip instead of hanging arms. */
export const REST_POSES = ['armsCrossed', 'handsOnHeart', 'pointFar'] as const;
export type RestPose = (typeof REST_POSES)[number];
/** Build multipliers: the loader keeps exactly what the body builder uses (rig-bodies.ts) and the Lab offers. */
export const BUILD_LIMITS = { min: 0.6, max: 1.6 } as const;
/** Face options: brow size multiplier (Obstinate's "big frown brows"). */
export const FACE_LIMITS = { brows: [0.6, 1.8] } as const;
export const VOICE_WAVES = ['sine', 'triangle', 'square', 'sawtooth'] as const;

export type PropType = (typeof PROP_TYPES)[number];
export type PropBone = (typeof PROP_BONES)[number];

export interface CharacterRecipe {
  id: string;
  name?: string;
  body: BodyType;
  /** Uniform size multiplier baked into the geometry (giants 3, Shining Ones 1.3). */
  scale?: number;
  /** Proportion multipliers, BUILD_LIMITS 0.6-1.6 (most recipes ~0.8-1.25). */
  build?: { height?: number; girth?: number; head?: number; legs?: number; arms?: number; belly?: number };
  /** One of the GDD 2.11 skin tones. */
  skin: string;
  colors: {
    top: string;
    bottom: string;
    feet?: string;
    accent?: string;
    hair?: string;
    hat?: string;
    trim?: string;
    [k: string]: string | undefined;
  };
  parts: {
    top?: (typeof TOPS)[number];
    bottom?: (typeof BOTTOMS)[number];
    hair?: (typeof HAIRS)[number];
    beard?: (typeof BEARDS)[number];
    hat?: (typeof HATS)[number];
    /** 'apron','ropeBelt','belt','cape','buttons','plume','glowDot','trim','sleeves','chains','bag','blush' */
    extras?: string[];
  };
  props?: Array<{ type: PropType; bone: PropBone }>;
  /** Adds the Burden sack on the 'sack' bone. */
  burden?: boolean;
  /** Shining Ones: unlit white glow material + sparkle hook. */
  glow?: boolean;
  /** Default face. */
  expression?: Expression;
  /** Face options: `brows` scales the brow bars (FACE_LIMITS, default 1). */
  face?: { brows?: number };
  /** Signature rest pose held while idling (GDD 2.11 design sheet); none = arms hang. */
  pose?: RestPose;
  /** Phase 3 babble voice (see src/audio/types.ts VoiceParams). */
  voice: { pitch: number; speed: number; wave: (typeof VOICE_WAVES)[number]; vowel: number };
  /** Walk personality: bounce 0..2, stiffness 0..1, swagger 0..1, lean -0.6..0.6 (see anim/types.ts). */
  style?: { bounce?: number; stiffness?: number; swagger?: number; lean?: number };
}

export type AttachBone = 'propL' | 'propR' | 'back' | 'head';

export interface Character {
  readonly recipe: CharacterRecipe;
  /** Position / rotate this. */
  readonly root: THREE.Object3D;
  /** The one SkinnedMesh (body, clothes, props, sack and every face part): 1 draw call. */
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: Record<string, THREE.Bone>;
  readonly animator: Animator;
  /** Top of the head (with hair) in metres, at rest. */
  readonly height: number;
  setExpression(e: Expression): void;
  /** Mouth flap + head bob layer. */
  setTalking(on: boolean): void;
  /** 0 = none, 1 = normal, up to 1.6 (sack bone scale, sprung so it "boings"). */
  setBurdenSize(s: number): void;
  /** Runtime props (extra draw call). The caller still owns and disposes `obj`. */
  attach(obj: THREE.Object3D, bone: AttachBone): void;
  /** Animator, blink, face, secondary motion (sack spring, hat bounce). */
  update(dt: number): void;
  /** Frees geometry and the skeleton's bone texture (materials are shared). */
  dispose(): void;

  // ---- additions beyond the ARCHITECTURE minimum (see DECISIONS) ----
  /** Second tiny SkinnedMesh (shared skeleton, mat('glow')) for flames, lantern glass and the forehead dot; null if none. */
  readonly glowMesh: THREE.SkinnedMesh | null;
  readonly skeleton: THREE.Skeleton;
  readonly expression: Expression;
  readonly burdenSize: number;
  /** Triangles in mesh + glowMesh. */
  readonly triangles: number;
  /** Force a mouth shape (e.g. 'grin' on a joy jump); null returns to the expression's mouth. */
  setMouth(shape: MouthShape | null): void;
  /** Close the eyes (nap, pray); blinking pauses while closed. */
  setEyesClosed(closed: boolean): void;
  /** Glow recipes call this every ~0.1-0.3 s with a world point on the body (wire it to Particles 'sparkle'). */
  onSparkle: ((worldPos: THREE.Vector3) => void) | null;
}
