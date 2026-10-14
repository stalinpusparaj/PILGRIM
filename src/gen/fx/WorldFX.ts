/**
 * World look controls shared by every world shader (GDD 2.7.2 "Low Hope (<30): colours desaturate"; GDD 2.10
 * Chapter IX "The lantern is the only light"). One set of uniform objects lives here; every material that takes
 * part holds references to the SAME objects, so changing a value here changes the whole world at no CPU cost.
 *
 * - Shared materials (`src/gen/materials.ts`) are patched once with `patchWorldFx()` (onBeforeCompile + a stable
 *   customProgramCacheKey); the grade runs after fog, on the final display colour, so the sky dome (whose eye-level
 *   band is the fog colour) and fogged ground stay seamless while both lose colour.
 * - Our own ShaderMaterials (sky, clouds, water, particles) include `WORLD_FX_PARS` and spread `fxUniforms` into
 *   their uniforms (or are bound later with `bindWorldFx()`).
 * - Every uniform is zero-safe: a shader that includes the chunk but never got the uniforms (WebGL starts them at
 *   0) draws exactly as before. That is why the GLSL speaks of `uDesaturation` (0 = full colour) while the API
 *   speaks of saturation (1 = full colour).
 * - The 'glow' material (candle flames, waystone and Promise glows, the far light) is left out on purpose: lights
 *   keep their warmth when the world goes grey, so the things that restore Hope still shine (DECISIONS).
 */
import * as THREE from 'three';

/** Saturation drawn when Hope is 0 (GDD 2.7.2 low-Hope look). */
export const SATURATION_LOW = 0.35;
/** Seconds for the look to get ~63% of the way to a new saturation target. */
const SATURATION_EASE = 0.6;
const LANTERN_DEFAULT_COLOR = '#FFD27A'; // GDD 2.10 Chapter IX lantern
const CACHE_KEY = 'worldfx:1';
const MARKER = '/* world-fx */';

export interface FxUniforms {
  /** 0 = normal colour, 1 = grey. Saturation = 1 - this. */
  readonly uDesaturation: THREE.IUniform<number>;
  /** World position of the Chapter IX lantern. */
  readonly uLanternPos: THREE.IUniform<THREE.Vector3>;
  /** Metres of warm light around the lantern (falls off over the outer half). */
  readonly uLanternRadius: THREE.IUniform<number>;
  /** 0 = off (default), 1 = the lantern is the only light; values between fade it in. */
  readonly uLanternOn: THREE.IUniform<number>;
  /** Display-space tint of the lantern light. */
  readonly uLanternColor: THREE.IUniform<THREE.Color>;
}

/** Display-space colour: the hex digits as 0..1 numbers, uploaded without any colour-space conversion. */
function displayColor(hex: string, out = new THREE.Color()): THREE.Color {
  const n = parseInt(hex.replace('#', ''), 16);
  return out.setRGB(
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
    THREE.LinearSRGBColorSpace,
  );
}

/** THE shared uniform objects. Spread them into a ShaderMaterial's uniforms (references, not copies). */
export const fxUniforms: FxUniforms = {
  uDesaturation: { value: 0 },
  uLanternPos: { value: new THREE.Vector3() },
  uLanternRadius: { value: 0 },
  uLanternOn: { value: 0 },
  uLanternColor: { value: displayColor(LANTERN_DEFAULT_COLOR) },
};

/**
 * GLSL: uniforms + `worldFxGrade(c)` (desaturation) and `worldFx(c, worldPos)` (grade, then the lantern pool).
 * Call them on the final display colour (after tone mapping, colour space and fog).
 */
export const WORLD_FX_PARS = /* glsl */ `
${MARKER}
uniform float uDesaturation;
uniform vec3 uLanternPos;
uniform float uLanternRadius;
uniform float uLanternOn;
uniform vec3 uLanternColor;
vec3 worldFxGrade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(c, vec3(l), uDesaturation);
}
vec3 worldFx(vec3 c, vec3 wp) {
  c = worldFxGrade(c);
  if (uLanternOn > 0.0) {
    float k = 1.0 - smoothstep(uLanternRadius * 0.45, max(uLanternRadius, 0.001), distance(wp, uLanternPos));
    vec3 lit = c * mix(vec3(1.0), uLanternColor, 0.45) * (1.0 + 0.45 * k);
    c = mix(c, mix(c * 0.18, lit, k), clamp(uLanternOn, 0.0, 1.0));
  }
  return c;
}
`;

/** Vertex lines for built-in materials: the world position (instancing, batching and skinning included). */
const WORLD_POS_VERTEX = /* glsl */ `
vec4 fxWorld = vec4(transformed, 1.0);
#ifdef USE_BATCHING
fxWorld = batchingMatrix * fxWorld;
#endif
#ifdef USE_INSTANCING
fxWorld = instanceMatrix * fxWorld;
#endif
vFxWorld = (modelMatrix * fxWorld).xyz;
`;

const patched = new WeakSet<THREE.Material>();
let warnedPatch = false;

function insertAfter(src: string, anchor: string, text: string): string | null {
  const i = src.indexOf(anchor);
  return i < 0 ? null : `${src.slice(0, i + anchor.length)}\n${text}${src.slice(i + anchor.length)}`;
}

function onBeforeCompileFx(shader: THREE.WebGLProgramParametersWithUniforms): void {
  const vs = insertAfter(
    insertAfter(shader.vertexShader, '#include <common>', 'varying vec3 vFxWorld;') ?? '',
    '#include <project_vertex>',
    WORLD_POS_VERTEX,
  );
  const fs = insertAfter(
    insertAfter(shader.fragmentShader, '#include <common>', `varying vec3 vFxWorld;\n${WORLD_FX_PARS}`) ?? '',
    '#include <fog_fragment>',
    'gl_FragColor.rgb = worldFx(gl_FragColor.rgb, vFxWorld);',
  );
  if (!vs || !fs) {
    if (!warnedPatch)
      console.warn('[worldfx] shader anchors not found; this material keeps its normal colours');
    warnedPatch = true;
    return;
  }
  Object.assign(shader.uniforms, fxUniforms);
  shader.vertexShader = vs;
  shader.fragmentShader = fs;
}

function fxCacheKey(): string {
  return CACHE_KEY;
}

/**
 * Patch a built-in mesh material (Lambert, Toon, Basic...) so it follows the world look. Idempotent. Patched
 * materials of one type share a single shader program (stable cache key).
 */
export function patchWorldFx(material: THREE.Material): void {
  if (patched.has(material) || material instanceof THREE.ShaderMaterial) return;
  patched.add(material);
  material.onBeforeCompile = onBeforeCompileFx;
  material.customProgramCacheKey = fxCacheKey;
  material.needsUpdate = true;
}

/**
 * Give a ShaderMaterial that includes `WORLD_FX_PARS` the shared uniforms (e.g. the particles, built before any
 * Hope system existed). If its program was already linked, the new cache key relinks it once so three picks the
 * uniforms up. Returns true when it was bound now.
 */
export function bindWorldFx(material: THREE.ShaderMaterial): boolean {
  if (material.uniforms['uDesaturation'] === fxUniforms.uDesaturation) return false;
  if (!material.fragmentShader.includes(MARKER)) return false;
  Object.assign(material.uniforms, fxUniforms);
  material.customProgramCacheKey = fxCacheKey;
  material.needsUpdate = true;
  return true;
}

/**
 * Brings everything under `root` into the world look: binds our ShaderMaterials that include the chunk and patches
 * lit built-in materials (Lambert, Toon) that are not patched yet (e.g. a crowd's own material). Basic materials
 * (glows, decals, debug lines) are left alone. Call once after a world is built. Returns how many it touched.
 */
export function applyWorldFx(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((obj) => {
    const m = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    for (const mat of list) {
      if (mat instanceof THREE.ShaderMaterial) {
        if (bindWorldFx(mat)) n++;
      } else if (
        (mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshToonMaterial) &&
        !patched.has(mat)
      ) {
        patchWorldFx(mat);
        n++;
      }
    }
  });
  return n;
}

/** The world look: low-Hope saturation (eased) and the Chapter IX lantern. One app-wide instance: `worldFx`. */
export class WorldFX {
  private target = 1;
  private current = 1;

  /** Saturation drawn right now (1 = normal). */
  get saturation(): number {
    return this.current;
  }

  /** Where the saturation is easing to. */
  get targetSaturation(): number {
    return this.target;
  }

  /** 1 = normal colours, 0 = grey. Eased by update(dt) unless `immediate`. */
  setSaturation(v: number, immediate = false): void {
    this.target = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    if (immediate) this.apply(this.target);
  }

  /**
   * The Chapter IX lantern: `on` 0..1 (true = 1), `radius` in metres, `pos` the lantern's world position. Update
   * `pos` every rendered frame while it is on (it only copies three numbers).
   */
  setLantern(on: boolean | number, pos?: THREE.Vector3, radius?: number, colorHex?: string): void {
    const u = fxUniforms;
    u.uLanternOn.value = typeof on === 'number' ? Math.min(1, Math.max(0, on)) : on ? 1 : 0;
    if (pos) u.uLanternPos.value.copy(pos);
    if (radius !== undefined && Number.isFinite(radius)) u.uLanternRadius.value = Math.max(0, radius);
    if (colorHex) displayColor(colorHex, u.uLanternColor.value);
  }

  /** Eases the saturation toward its target (fixed step or frame time; frame-rate independent). */
  update(dt: number): void {
    if (this.current === this.target || !(dt > 0)) return;
    const k = 1 - Math.exp(-dt / SATURATION_EASE);
    const next = this.current + (this.target - this.current) * k;
    this.apply(Math.abs(this.target - next) < 0.002 ? this.target : next);
  }

  /** Normal colours, lantern off (leaving a chapter, the title screen, tests). */
  reset(): void {
    this.target = 1;
    this.apply(1);
    this.setLantern(false, undefined, 0, LANTERN_DEFAULT_COLOR);
    fxUniforms.uLanternPos.value.set(0, 0, 0);
  }

  private apply(s: number): void {
    this.current = s;
    fxUniforms.uDesaturation.value = 1 - s;
  }
}

/** The one world look of the app. */
export const worldFx = new WorldFX();
