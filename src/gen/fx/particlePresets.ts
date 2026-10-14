/**
 * Particle presets for `src/gen/Particles.ts` (GDD 2.12: dust, sparkles, smoke, embers, rain, Zzz, fire, light
 * motes, plus bonk stars and splashes). Pure data: tuning lives here, the simulation in Particles.ts.
 */

export type ParticlePreset =
  'dust' | 'sparkle' | 'smoke' | 'ember' | 'rain' | 'zzz' | 'fire' | 'motes' | 'stars' | 'splash' | 'breath';

/** Shape ids drawn by the particle fragment shader (`particleShaders.ts`). */
export const SHAPE = { puff: 0, star: 1, sparkle: 2, zed: 3, streak: 4 } as const;

export interface PresetDef {
  shape: number;
  add: number; // 0 = alpha blended, 1 = additive
  count: number; // default burst size
  life: [number, number]; // seconds
  size: [number, number]; // quad width (m)
  grow: number; // size multiplier reached at end of life
  aspect: number; // quad height / width
  speed: [number, number]; // m/s (rad/s for orbiting stars)
  dir: [number, number, number]; // default direction
  cone: number; // 0 = exactly along dir, 1 = any direction
  flat: number; // squash vertical velocity (puffs that roll along the ground)
  up: number; // extra upward velocity
  spread: number; // spawn radius (orbit radius for stars, field radius for rain)
  lift: number; // spawn height offset
  ySpread: number; // ± spawn height jitter
  gravity: number; // m/s² down (negative = buoyant)
  drag: number;
  wobble: number; // sideways sway acceleration
  twinkle: number; // 0..1 alpha flicker
  spin: number; // rad/s
  stretch: number; // velocity-aligned streak length per m/s (0 = rotate freely)
  alpha: number;
  fadeIn: number; // fraction of life
  colors: string[]; // picked per particle
  end?: string; // colour at end of life
  orbit?: boolean; // circle the emit point (bonk stars)
  lit?: boolean; // physical stuff (dust, smoke, water) is dimmed by the chapter light; glows and signals are not
}

const BASE: PresetDef = {
  shape: SHAPE.puff,
  add: 0,
  count: 6,
  life: [1, 1],
  size: [0.2, 0.2],
  grow: 1,
  aspect: 1,
  speed: [0, 0],
  dir: [0, 1, 0],
  cone: 1,
  flat: 0,
  up: 0,
  spread: 0.2,
  lift: 0,
  ySpread: 0,
  gravity: 0,
  drag: 0,
  wobble: 0,
  twinkle: 0,
  spin: 0,
  stretch: 0,
  alpha: 1,
  fadeIn: 0.1,
  colors: ['#FFFFFF'],
};
const def = (o: Partial<PresetDef>): PresetDef => ({ ...BASE, ...o });

/**
 * Effect colours; several are GDD 2.10 named colours (fire #FF8A3D, embers #E2553A, lantern #FFD27A, horizon
 * light #FFE8A3, safe light #FFF2C2). Callers pass `color` to tint a burst with a chapter palette colour.
 */
// prettier-ignore
export const PRESETS: Record<ParticlePreset, PresetDef> = {
  // Footstep / landing puffs that roll along the ground and settle.
  dust: def({ count: 8, life: [0.5, 1], size: [0.22, 0.4], grow: 2.4, speed: [0.8, 1.8], flat: 0.85, up: 0.35,
    spread: 0.25, gravity: 0.6, drag: 3.5, spin: 1, alpha: 0.5, fadeIn: 0.05, lit: true,
    colors: ['#D8C6A0', '#C9B68E', '#E3D5B5'] }),
  // Twinkling gold and white glints (promises, gifts, Shining Ones).
  sparkle: def({ shape: SHAPE.sparkle, add: 1, count: 12, life: [0.5, 1.1], size: [0.16, 0.3], grow: 0.3,
    speed: [0.6, 1.8], up: 0.3, gravity: -0.2, drag: 2.5, twinkle: 1, spin: 2.5,
    colors: ['#FFE7A0', '#FFFFFF', '#FFD27A'] }),
  // Grey puffs that rise, sway and grow (chimneys, Wrong Hill rumbles).
  smoke: def({ count: 3, life: [2.6, 4.2], size: [0.45, 0.7], grow: 3.2, speed: [0.15, 0.4], flat: 0.5, up: 0.8,
    gravity: -0.15, drag: 0.6, wobble: 0.5, spin: 0.4, alpha: 0.38, fadeIn: 0.2, lit: true,
    colors: ['#8E8A86', '#A39E97', '#B8B2AA'] }),
  // Little orange sparks that float up and flicker.
  ember: def({ add: 1, count: 4, life: [1.4, 2.6], size: [0.05, 0.1], grow: 0.6, speed: [0.3, 0.9], cone: 0.8,
    up: 1, spread: 0.25, gravity: -0.4, drag: 0.8, wobble: 1.5, twinkle: 0.6,
    colors: ['#FF8A3D', '#FFB347', '#E2553A'] }),
  // Falling streaks; emit around the camera with a large `spread` for a rain field.
  rain: def({ shape: SHAPE.streak, count: 30, life: [0.9, 1.2], size: [0.04, 0.05], aspect: 8, speed: [13, 15],
    dir: [0, -1, 0], cone: 0.02, spread: 14, lift: 9, ySpread: 4, stretch: 0.02, alpha: 0.55, lit: true,
    colors: ['#D6E6F2'] }),
  // Sleepy 'Z's drifting up and to the side, rocking gently.
  zzz: def({ shape: SHAPE.zed, count: 1, life: [2, 2.4], size: [0.22, 0.26], grow: 1.8, speed: [0.25, 0.35],
    dir: [0.45, 1, 0], cone: 0.15, spread: 0.05, wobble: 0.6, alpha: 0.95, fadeIn: 0.15,
    colors: ['#FFFFFF', '#EEE8FF'] }),
  // Additive flame tongues: yellow at the base, red as they rise and shrink.
  fire: def({ add: 1, count: 4, life: [0.5, 0.9], size: [0.32, 0.5], grow: 0.35, speed: [0.1, 0.35], up: 1.4,
    spread: 0.18, lift: 0.1, gravity: -1.5, drag: 1.5, wobble: 0.8, alpha: 0.9, fadeIn: 0.15,
    colors: ['#FFE07A', '#FFC24A'], end: '#E2553A' }),
  // Slow light motes hanging in the air (Interpreter's House, the far light, Beulah).
  motes: def({ add: 1, count: 6, life: [3, 6], size: [0.05, 0.11], speed: [0.04, 0.18], up: 0.05, spread: 3,
    ySpread: 1.5, gravity: -0.02, drag: 0.3, wobble: 0.35, twinkle: 0.5, alpha: 0.85, fadeIn: 0.35,
    colors: ['#FFF2C2', '#FFE8A3', '#FFFFFF'] }),
  // Cartoon bonk stars circling a head (emit at the head; `spread` = orbit radius).
  stars: def({ shape: SHAPE.star, count: 5, life: [1.6, 1.9], size: [0.2, 0.26], speed: [4, 5], spread: 0.42,
    spin: 3, fadeIn: 0.08, colors: ['#FFD84A', '#FFE680'], orbit: true }),
  // A small, quick puff of breath blown along `dir` (the Burden's "huff"); pass the walker's velocity as `vel`.
  breath: def({ count: 3, life: [0.35, 0.6], size: [0.09, 0.15], grow: 2.2, speed: [1.1, 1.7], dir: [0, 0, 1],
    cone: 0.22, flat: 0.4, up: 0.12, spread: 0.04, gravity: -0.1, drag: 2.4, alpha: 0.5, fadeIn: 0.04, lit: true,
    colors: ['#F4F2EC', '#EAE6DD'] }),
  // Droplets thrown up and out of water or mud (`dir` = surface normal).
  splash: def({ count: 14, life: [0.45, 0.8], size: [0.07, 0.14], grow: 0.7, speed: [2, 3.8], cone: 0.45, up: 1.5,
    gravity: 11, drag: 0.4, stretch: 0.05, alpha: 0.85, fadeIn: 0.02, lit: true,
    colors: ['#EAF6FB', '#C8E6F0'] }),
};

export const PRESET_NAMES = Object.keys(PRESETS) as ParticlePreset[];
/** Presets by index (particles store a Uint8 preset index per slot). */
export const PRESET_DEFS: readonly PresetDef[] = PRESET_NAMES.map((n) => PRESETS[n]);
export const PRESET_INDEX = Object.fromEntries(PRESET_NAMES.map((n, i) => [n, i])) as Record<
  ParticlePreset,
  number
>;
