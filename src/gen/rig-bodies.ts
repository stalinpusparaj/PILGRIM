/**
 * Body proportions per body type (GDD 2.11 style lock: about 2.5 heads tall, a big round head, a short torso,
 * stubby legs, mitten hands) and `bodyFor()`, which applies a recipe's build multipliers and scale. Split out of
 * rig.ts (which re-exports both) to keep files under 400 lines.
 */
import { BUILD_LIMITS, type BodyType, type CharacterRecipe } from './char-types';

/** Body measurements in metres (after build multipliers and scale). */
export interface Body {
  type: BodyType;
  female: boolean;
  scale: number;
  footH: number;
  legLen: number;
  torsoLen: number;
  neckLen: number;
  headR: number;
  hipHalf: number;
  shoulderHalf: number;
  torsoRX: number;
  torsoRZ: number;
  belly: number;
  armLen: number;
  armR: number;
  handR: number;
  thighR: number;
  shinR: number;
  footLen: number;
  footW: number;
  /** Forward lean of the spine in radians (elder). */
  stoop: number;
}

type BaseBody = Omit<Body, 'type' | 'scale'>;

/** Adult reference: ~1.5 m with hair, head 0.6 m across (about 2.5 heads), hands reach the hips. */
const ADULT: BaseBody = {
  female: false,
  footH: 0.07,
  legLen: 0.44,
  torsoLen: 0.46,
  neckLen: 0.03,
  headR: 0.3,
  hipHalf: 0.1,
  shoulderHalf: 0.205,
  torsoRX: 0.215,
  torsoRZ: 0.155,
  belly: 0,
  armLen: 0.41,
  armR: 0.062,
  handR: 0.078,
  thighR: 0.088,
  shinR: 0.078,
  footLen: 0.21,
  footW: 0.12,
  stoop: 0,
};

const BODIES: Record<BodyType, BaseBody> = {
  adult: ADULT,
  adultF: {
    ...ADULT,
    female: true,
    legLen: 0.42,
    torsoLen: 0.42,
    headR: 0.29,
    hipHalf: 0.095,
    shoulderHalf: 0.175,
    torsoRX: 0.19,
    torsoRZ: 0.14,
    armLen: 0.37,
    armR: 0.055,
    handR: 0.07,
    thighR: 0.08,
    shinR: 0.07,
    footLen: 0.18,
    footW: 0.105,
  },
  elder: {
    ...ADULT,
    legLen: 0.41,
    torsoLen: 0.44,
    headR: 0.29,
    shoulderHalf: 0.19,
    torsoRX: 0.205,
    belly: 0.03,
    armLen: 0.39,
    armR: 0.058,
    stoop: 0.2,
  },
  child: {
    ...ADULT,
    footH: 0.05,
    legLen: 0.25,
    torsoLen: 0.26,
    neckLen: 0.02,
    headR: 0.22,
    hipHalf: 0.065,
    shoulderHalf: 0.125,
    torsoRX: 0.135,
    torsoRZ: 0.105,
    armLen: 0.24,
    armR: 0.042,
    handR: 0.054,
    thighR: 0.057,
    shinR: 0.052,
    footLen: 0.13,
    footW: 0.08,
    belly: 0.03,
  },
  youngAdult: {
    ...ADULT,
    legLen: 0.4,
    torsoLen: 0.4,
    headR: 0.285,
    hipHalf: 0.09,
    shoulderHalf: 0.18,
    torsoRX: 0.19,
    torsoRZ: 0.14,
    armLen: 0.36,
    armR: 0.055,
    handR: 0.07,
    thighR: 0.08,
    shinR: 0.07,
    footLen: 0.19,
    footW: 0.11,
  },
  stocky: {
    ...ADULT,
    legLen: 0.4,
    torsoLen: 0.45,
    headR: 0.3,
    hipHalf: 0.125,
    shoulderHalf: 0.25,
    torsoRX: 0.265,
    torsoRZ: 0.19,
    belly: 0.06,
    armLen: 0.4,
    armR: 0.074,
    handR: 0.088,
    thighR: 0.1,
    shinR: 0.09,
    footLen: 0.22,
    footW: 0.135,
  },
  thin: {
    ...ADULT,
    legLen: 0.52,
    torsoLen: 0.5,
    headR: 0.28,
    hipHalf: 0.085,
    shoulderHalf: 0.165,
    torsoRX: 0.165,
    torsoRZ: 0.12,
    armLen: 0.45,
    armR: 0.05,
    handR: 0.07,
    thighR: 0.07,
    shinR: 0.062,
    footLen: 0.2,
    footW: 0.1,
  },
  big: {
    ...ADULT,
    footH: 0.08,
    legLen: 0.5,
    torsoLen: 0.56,
    headR: 0.33,
    hipHalf: 0.13,
    shoulderHalf: 0.275,
    torsoRX: 0.29,
    torsoRZ: 0.21,
    belly: 0.03,
    armLen: 0.49,
    armR: 0.085,
    handR: 0.11,
    thighR: 0.11,
    shinR: 0.1,
    footLen: 0.26,
    footW: 0.15,
  },
  giant: {
    ...ADULT,
    footH: 0.08,
    legLen: 0.5,
    torsoLen: 0.56,
    headR: 0.32,
    hipHalf: 0.13,
    shoulderHalf: 0.275,
    torsoRX: 0.29,
    torsoRZ: 0.21,
    belly: 0.06,
    armLen: 0.5,
    armR: 0.085,
    handR: 0.11,
    thighR: 0.11,
    shinR: 0.1,
    footLen: 0.26,
    footW: 0.15,
  },
  giantess: {
    ...ADULT,
    female: true,
    legLen: 0.52,
    torsoLen: 0.48,
    headR: 0.27,
    hipHalf: 0.09,
    shoulderHalf: 0.165,
    torsoRX: 0.17,
    torsoRZ: 0.125,
    armLen: 0.45,
    armR: 0.05,
    handR: 0.068,
    thighR: 0.07,
    shinR: 0.062,
    footLen: 0.2,
    footW: 0.1,
  },
  tall: {
    ...ADULT,
    legLen: 0.5,
    torsoLen: 0.5,
    headR: 0.29,
    shoulderHalf: 0.2,
    torsoRX: 0.205,
    armLen: 0.44,
  },
  beast: {
    ...ADULT,
    footH: 0.09,
    legLen: 0.56,
    torsoLen: 0.62,
    headR: 0.32,
    hipHalf: 0.15,
    shoulderHalf: 0.32,
    torsoRX: 0.33,
    torsoRZ: 0.24,
    belly: 0.05,
    armLen: 0.55,
    armR: 0.095,
    handR: 0.12,
    thighR: 0.13,
    shinR: 0.11,
    footLen: 0.3,
    footW: 0.17,
  },
};

/** Default recipe `scale` per body when the recipe gives none. */
const DEFAULT_SCALE: Partial<Record<BodyType, number>> = { giant: 3, giantess: 3, beast: 1.6 };

/** Same limits as the recipe loader (char-recipes.ts), so a stored multiplier is the one the body is built with. */
const clampM = (v: number | undefined): number =>
  Math.min(BUILD_LIMITS.max, Math.max(BUILD_LIMITS.min, v ?? 1));

export function bodyFor(recipe: CharacterRecipe): Body {
  const b = BODIES[recipe.body] ?? ADULT;
  const m = recipe.build ?? {};
  const h = clampM(m.height);
  const g = clampM(m.girth);
  const legs = clampM(m.legs);
  const s = Math.min(5, Math.max(0.3, recipe.scale ?? DEFAULT_SCALE[recipe.body] ?? 1));
  const gw = 0.5 + 0.5 * g; // shoulders and hips widen less than the belly
  return {
    type: recipe.body,
    female: b.female,
    scale: s,
    footH: b.footH * s,
    legLen: (b.footH + (b.legLen - b.footH) * h * legs) * s,
    torsoLen: b.torsoLen * h * s,
    neckLen: b.neckLen * h * s,
    headR: b.headR * clampM(m.head) * s,
    hipHalf: b.hipHalf * gw * s,
    shoulderHalf: b.shoulderHalf * gw * s,
    torsoRX: b.torsoRX * g * s,
    torsoRZ: b.torsoRZ * g * s,
    belly: Math.min(0.45, Math.max(0, b.belly + (clampM(m.belly) - 1) * 0.5)),
    armLen: b.armLen * h * clampM(m.arms) * s,
    armR: b.armR * gw * s,
    handR: b.handR * Math.sqrt(gw) * s,
    thighR: b.thighR * gw * s,
    shinR: b.shinR * gw * s,
    footLen: b.footLen * Math.sqrt(h) * s,
    footW: b.footW * gw * s,
    stoop: b.stoop,
  };
}
