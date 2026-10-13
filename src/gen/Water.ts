/**
 * Water and mud surfaces (GDD 2.12 "Water and mud: in-house shaders (vertex wave, faceted normals, colour by
 * depth; mud bubbles as animated instanced spheres)").
 *
 * - A low-res grid (hex-like rings for circles, a checker-diagonal grid for boxes; `fx/waterGrid.ts`) lies in
 *   the local XZ plane at y = 0; the caller places the mesh at the water level (no rotation needed).
 * - The vertex shader adds a few summed sine waves in world space; the fragment shader takes one normal per
 *   triangle from screen-space derivatives, so the surface stays faceted while it moves.
 * - "Depth" is distance from the shore (an `aDepth` attribute, 0 at the edge → 1 a few metres in): shallow
 *   colour and more transparency at the edge, deep colour in the middle, a fresnel sky tint and sun sparkle.
 *   Lighting uses the palette's sun and hemisphere values, matching the shared Lambert materials.
 * - Mud is brown, opaque, slower and heavier, with bubbles: one InstancedMesh of small spheres that swell
 *   and pop on deterministic phases (shared Lambert material).
 */
import * as THREE from 'three';
import { boxGrid, circleGrid, smooth01 } from './fx/waterGrid';
import { colorOf, lowSphere, paint } from './geom';
import { mat } from './materials';
import { PALETTES, mix, type Palette } from './palette';
import { Rng, hashString } from './rng';

export interface WaterOptions {
  kind: 'water' | 'mud';
  pal: Palette;
  shape: 'circle' | 'box';
  r?: number;
  size?: [number, number];
}

export interface WaterBody {
  mesh: THREE.Mesh;
  update(t: number): void;
  dispose(): void;
}

interface SurfaceStyle {
  cell: number; // target triangle size (m)
  amp: number; // wave height (m)
  facet: number; // exaggerates facet tilt in the lighting only, so small waves still read as facets
  freq: number;
  speed: number;
  sparkle: number;
  fresnel: number;
  foam: number; // pale rim at the shore
  alphaShallow: number;
  alphaDeep: number;
  shore: number; // metres from the edge to full depth colour
}

// prettier-ignore
const STYLE: Record<WaterOptions['kind'], SurfaceStyle> = {
  water: { cell: 1.6, amp: 0.09, facet: 3, freq: 1.8, speed: 1, sparkle: 1, fresnel: 0.5, foam: 0.35, alphaShallow: 0.72,
    alphaDeep: 0.94, shore: 3.5 },
  mud: { cell: 2, amp: 0.05, facet: 2.5, freq: 1.1, speed: 0.3, sparkle: 0.15, fresnel: 0.1, foam: 0, alphaShallow: 1,
    alphaDeep: 1, shore: 2.5 },
};
const DEFAULT_R = 5;
const DEFAULT_SIZE: [number, number] = [10, 10];
const BUBBLE = { perM2: 1 / 4, min: 3, max: 40, rest: 0.25, pop: 0.86, hop: 0.5 } as const;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uSpeed;
attribute float aDepth;
varying vec3 vWorld;
varying float vDepth;
#include <fog_pars_vertex>
float wave(vec2 p, float t) {
  vec2 q = p * uFreq;
  float s = t * uSpeed;
  return sin(q.x * 0.55 + s * 1.3) * 0.45 + sin(q.y * 0.71 - s * 1.1 + 1.7) * 0.35
       + sin((q.x + q.y) * 0.93 + s * 1.7 + 0.4) * 0.25 + sin((q.x - q.y) * 1.37 - s * 2.1) * 0.15;
}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.y += wave(world.xz, uTime) * uAmp * mix(0.35, 1.0, aDepth); // calmer at the shore
  vWorld = world.xyz;
  vDepth = aDepth;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uFoamColor;
uniform vec3 uSunCol;
uniform vec3 uSunDir;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform float uSparkle;
uniform float uFacet;
uniform float uFresnel;
uniform float uFoam;
uniform float uAlphaShallow;
uniform float uAlphaDeep;
varying vec3 vWorld;
varying float vDepth;
#include <fog_pars_fragment>
const float RECIP_PI = 0.3183098862;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld))); // one normal per triangle: faceted
  if (n.y < 0.0) n = -n;
  n = normalize(vec3(n.x * uFacet, n.y, n.z * uFacet));
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 base = mix(uShallow, uDeep, vDepth);
  base = mix(base, uFoamColor, (1.0 - smoothstep(0.0, 0.12, vDepth)) * uFoam);
  vec3 irradiance = mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) + uSunCol * max(dot(n, uSunDir), 0.0);
  vec3 col = base * irradiance * RECIP_PI;
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 4.0) * uFresnel;
  col = mix(col, uSky, fres);
  // Sparkle: a sharp sun highlight per facet, plus brief glints that hop between cells.
  vec3 h = normalize(uSunDir + v);
  float facing = max(dot(n, h), 0.0);
  float spec = pow(facing, 120.0);
  vec2 cell = floor(vWorld.xz * 1.5);
  float g = hash(cell);
  float glint = smoothstep(0.95, 1.0, fract(g * 7.0 + uTime * (0.25 + g * 0.5))) * pow(facing, 10.0);
  col += uSunCol * (spec * 0.35 + glint * 0.3) * uSparkle;
  float alpha = clamp(mix(uAlphaShallow, uAlphaDeep, vDepth) + fres * 0.5 + spec, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** CPU copy of the shader's wave (keeps mud bubbles on the moving surface). */
function wave(x: number, z: number, t: number, s: SurfaceStyle): number {
  const qx = x * s.freq;
  const qz = z * s.freq;
  const k = t * s.speed;
  return (
    Math.sin(qx * 0.55 + k * 1.3) * 0.45 +
    Math.sin(qz * 0.71 - k * 1.1 + 1.7) * 0.35 +
    Math.sin((qx + qz) * 0.93 + k * 1.7 + 0.4) * 0.25 +
    Math.sin((qx - qz) * 1.37 - k * 2.1) * 0.15
  );
}

/** Integer hash → [0, 1), for per-cycle bubble positions without storing state. */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function surfaceColors(kind: WaterOptions['kind'], pal: Palette): { shallow: string; deep: string } {
  if (kind === 'water') return { shallow: pal.water.shallow, deep: pal.water.deep };
  // GDD 2.10 mud (#5B4A35) unless this chapter names its own. Tints use mix(), not shade(): shade() moves
  // linear-space lightness, which turns dark browns black.
  const mud = pal.accents['mud'] ?? PALETTES.slough.accents['mud'] ?? pal.ground.slope;
  return { shallow: mix(mud, pal.ground.mid, 0.3), deep: mud };
}

export function createWater(o: WaterOptions): WaterBody {
  const s = STYLE[o.kind];
  const pal = o.pal;
  const radius = Math.max(0.5, o.r ?? DEFAULT_R);
  const size: [number, number] = [
    Math.max(0.5, o.size?.[0] ?? DEFAULT_SIZE[0]),
    Math.max(0.5, o.size?.[1] ?? DEFAULT_SIZE[1]),
  ];
  const key = o.shape === 'circle' ? `${radius}` : `${size[0]}x${size[1]}`;
  const rng = new Rng(hashString(`water:${o.kind}:${o.shape}:${key}:${pal.id}`));

  const grid =
    o.shape === 'circle'
      ? circleGrid(radius, s, rng.fork('grid'))
      : boxGrid(size[0], size[1], s, rng.fork('grid'));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(grid.pos, 3));
  geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(grid.depth, 1));
  geometry.setIndex(grid.index);
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += s.amp * 2; // waves move vertices in Y

  const colors = surfaceColors(o.kind, pal);
  const light = pal.light;
  const uTime: THREE.IUniform<number> = { value: 0 };
  const material = new THREE.ShaderMaterial({
    name: `water:${o.kind}`,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime,
      uAmp: { value: s.amp },
      uFreq: { value: s.freq },
      uSpeed: { value: s.speed },
      uShallow: { value: colorOf(colors.shallow).clone() },
      uDeep: { value: colorOf(colors.deep).clone() },
      uSky: { value: colorOf(mix(pal.sky.horizon, pal.sky.top, 0.35)).clone() },
      uFoamColor: { value: colorOf(mix(colors.shallow, pal.sky.sun, 0.6)).clone() },
      uSunCol: { value: colorOf(light.sun).clone().multiplyScalar(light.sunIntensity) },
      uSunDir: { value: new THREE.Vector3().fromArray(light.sunDir).normalize() },
      uHemiSky: { value: colorOf(light.hemiSky).clone().multiplyScalar(light.hemiIntensity) },
      uHemiGround: { value: colorOf(light.hemiGround).clone().multiplyScalar(light.hemiIntensity) },
      uSparkle: { value: s.sparkle },
      uFacet: { value: s.facet },
      uFresnel: { value: s.fresnel },
      uFoam: { value: s.foam },
      uAlphaShallow: { value: s.alphaShallow },
      uAlphaDeep: { value: s.alphaDeep },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
    transparent: s.alphaShallow < 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = o.kind;

  // Mud bubbles: base spots inset from the edge; each cycle hops a little (hash of slot + cycle).
  let bubbles: THREE.InstancedMesh | null = null;
  let bubbleGeometry: THREE.BufferGeometry | null = null;
  const extent = o.shape === 'circle' ? radius : Math.max(size[0], size[1]) / 2;
  const area = o.shape === 'circle' ? Math.PI * radius * radius : size[0] * size[1];
  const count =
    o.kind === 'mud' ? Math.min(BUBBLE.max, Math.max(BUBBLE.min, Math.round(area * BUBBLE.perM2))) : 0;
  const bx = new Float32Array(count);
  const bz = new Float32Array(count);
  const br = new Float32Array(count);
  const bPeriod = new Float32Array(count);
  const bPhase = new Float32Array(count);
  const hop = Math.min(BUBBLE.hop, extent * 0.2);
  if (count > 0) {
    const brng = rng.fork('bubbles');
    const inset = Math.min(0.8, extent * 0.4) + hop;
    for (let i = 0; i < count; i++) {
      if (o.shape === 'circle') {
        const a = brng.range(0, Math.PI * 2);
        const d = Math.sqrt(brng.next()) * Math.max(0, radius - inset);
        bx[i] = Math.cos(a) * d;
        bz[i] = Math.sin(a) * d;
      } else {
        bx[i] = brng.range(-1, 1) * Math.max(0, size[0] / 2 - inset);
        bz[i] = brng.range(-1, 1) * Math.max(0, size[1] / 2 - inset);
      }
      br[i] = brng.range(0.13, 0.32);
      bPeriod[i] = brng.range(2.4, 5);
      bPhase[i] = brng.next();
    }
    const top = mix(colors.shallow, pal.sky.sun, 0.18); // wet sheen on top
    const side = colors.shallow;
    bubbleGeometry = paint(lowSphere(1, 1), (_p, n) => (n.y > 0.55 ? top : side));
    bubbles = new THREE.InstancedMesh(bubbleGeometry, mat('lambert'), count);
    bubbles.name = 'mud:bubbles';
    bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bubbles.boundingSphere = new THREE.Sphere(new THREE.Vector3(), extent + 1);
    mesh.add(bubbles);
  }

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  let disposed = false;

  function updateBubbles(t: number, b: THREE.InstancedMesh): void {
    const wx = mesh.matrixWorld.elements[12]!;
    const wz = mesh.matrixWorld.elements[14]!;
    for (let i = 0; i < count; i++) {
      const r = br[i]!;
      const ct = t / bPeriod[i]! + bPhase[i]!;
      const cycle = Math.floor(ct);
      const u = ct - cycle;
      let bs = 0;
      let y = 0;
      if (u >= BUBBLE.rest && u < BUBBLE.pop) {
        const k = smooth01((u - BUBBLE.rest) / (BUBBLE.pop - BUBBLE.rest));
        bs = r * (0.35 + 0.65 * k);
        y = r * (-0.55 + 0.5 * k); // a dome swelling up out of the mud
      } else if (u >= BUBBLE.pop) {
        const k = (u - BUBBLE.pop) / (1 - BUBBLE.pop);
        bs = k < 0.6 ? r * (1 + 0.4 * k) : r * 1.24 * (1 - (k - 0.6) / 0.4); // swell, then pop
        y = -0.05 * r;
      }
      const x = bx[i]! + (hash01(i, cycle) - 0.5) * 2 * hop;
      const z = bz[i]! + (hash01(i + 7919, cycle) - 0.5) * 2 * hop;
      p.set(x, y + wave(wx + x, wz + z, t, s) * s.amp, z);
      sc.set(bs, bs * 0.85, bs);
      b.setMatrixAt(i, m.compose(p, q, sc));
    }
    b.instanceMatrix.needsUpdate = true;
  }

  return {
    mesh,
    update(t: number): void {
      if (disposed) return;
      uTime.value = t;
      if (bubbles) updateBubbles(t, bubbles);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      if (bubbles) {
        bubbles.removeFromParent();
        bubbles.dispose();
      }
      bubbleGeometry?.dispose();
    },
  };
}
