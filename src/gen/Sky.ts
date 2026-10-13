/**
 * Sky dome, puffy clouds and the chapter's light + fog (GDD 2.11 "Gentle gradient skies, soft fog, puffy
 * low-poly clouds"; GDD 2.12 "Sky").
 *
 * - The dome is a small inverted icosphere drawn first (renderOrder, no depth test/write) and re-centred on
 *   the rendering camera in the vertex shader, so it never lags behind an interpolated camera and never clips
 *   against the far plane. Colours are the palette hexes exactly (not tone mapped), and the band at eye level
 *   is the fog colour, so fogged ground melts into the sky without a seam.
 * - Clouds are ONE InstancedMesh of jittered, merged icospheres with a tiny unlit faceted shader (fog-free,
 *   palette tinted). They ride around the camera too; drift is a uniform, so the CPU cost per frame is two
 *   floats. A uniform scale keeps them inside the camera's far plane (projection is unchanged by scaling
 *   about the eye).
 * - applyAtmosphere() adds the fog, the hemisphere light and the sun with a movable shadow frustum.
 */
import * as THREE from 'three';
import type { QualityPreset } from '../core/Quality';
import { services } from '../core/Services';
import { colorOf, jitter, lowSphere, merge, xform } from './geom';
import { mix, type Palette } from './palette';
import { Rng, hashString } from './rng';

const TAU = Math.PI * 2;
const DOME_RADIUS = 10; // any size works: the dome is drawn first without depth
const SUN_ANGULAR_RADIUS = 0.045; // rad (~2.6°): a big friendly toy sun
const CLOUD_COUNT: Record<QualityPreset['level'], number> = { low: 7, medium: 12, high: 18 };
const CLOUD = { dist: [205, 330], elevation: [0.16, 0.36], width: [0.045, 0.075], drift: 0.004 } as const;
/** Farthest point of any cloud at scale 1 (dist max + half the widest cloud), used to fit the far plane. */
const CLOUD_EXTENT = CLOUD.dist[1] * (1 + CLOUD.width[1] * 2.4);
const SHADOW = { half: 30, distance: 80, near: 1, far: 200, bias: -0.0005, normalBias: 0.035 };
const WHITE = '#FFFFFF';

const SKY_COMMON = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uFog;
vec3 skyGradient(vec3 d) {
  float h = d.y;
  vec3 c = h >= 0.0
    ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.6, h), 0.8))
    : mix(uHorizon, uBottom, smoothstep(0.0, 0.25, -h));
  // Soft band at eye level that becomes the fog colour, so distant fogged ground meets the sky cleanly.
  float band = 1.0 - smoothstep(0.0, 0.15, abs(h));
  return mix(c, uFog, band * band);
}
`;

const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
}
`;

const DOME_FRAGMENT = /* glsl */ `
${SKY_COMMON}
uniform vec3 uSunDir;
uniform vec3 uSunDisc;
uniform vec3 uSunGlow;
uniform float uSunCos;
uniform float uSunStrength;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyGradient(d);
  float s = dot(d, uSunDir);
  float sp = max(s, 0.0);
  float glow = pow(sp, 10.0) * 0.28 + pow(sp, 90.0) * 0.5;
  c = mix(c, uSunGlow, clamp(glow * uSunStrength, 0.0, 1.0));
  float aa = max(fwidth(s) * 1.5, 1e-5);
  c = mix(c, uSunDisc, smoothstep(uSunCos - aa, uSunCos + aa, s) * uSunStrength);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CLOUD_VERTEX = /* glsl */ `
uniform float uAngle;
uniform float uScale;
varying vec3 vRel;
void main() {
  vec4 local = instanceMatrix * vec4(position, 1.0);
  float c = cos(uAngle);
  float s = sin(uAngle);
  vRel = vec3(c * local.x + s * local.z, local.y, -s * local.x + c * local.z) * uScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(vRel + cameraPosition, 1.0);
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
${SKY_COMMON}
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uSunDir;
uniform float uHaze;
varying vec3 vRel;
void main() {
  // Screen-space derivatives give one normal per triangle: the faceted toy look without a normal attribute.
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  vec3 c = mix(uShade, uLit, smoothstep(-0.35, 0.9, dot(n, uSunDir)));
  c *= mix(0.9, 1.0, smoothstep(-0.6, 0.3, n.y));
  vec3 d = normalize(vRel);
  float haze = clamp(uHaze + (1.0 - smoothstep(0.03, 0.32, d.y)) * 0.4, 0.0, 0.95);
  gl_FragColor = vec4(mix(c, skyGradient(d), haze), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Relative luminance (0..1) of a palette hex, for picking how bright clouds may be in this sky. */
function luminance(hex: string): number {
  const c = colorOf(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function skyUniforms(pal: Palette): Record<string, THREE.IUniform> {
  return {
    uTop: { value: colorOf(pal.sky.top).clone() },
    uHorizon: { value: colorOf(pal.sky.horizon).clone() },
    uBottom: { value: colorOf(pal.sky.bottom).clone() },
    uFog: { value: colorOf(pal.fog.color).clone() },
  };
}

function sunDirection(pal: Palette, out: THREE.Vector3): THREE.Vector3 {
  return out.fromArray(pal.light.sunDir).normalize();
}

/** One cloud: a row of jittered puffs with a flattened underside. Only `position` is kept (normals come
 *  from derivatives in the shader). */
function buildCloudGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const puffs = 6;
  for (let i = 0; i < puffs; i++) {
    const t = (i / (puffs - 1)) * 2 - 1; // -1..1 along X
    const r = 0.95 - Math.abs(t) * 0.38 + rng.range(-0.08, 0.08);
    const pos: [number, number, number] = [
      t * 1.35 + rng.range(-0.1, 0.1),
      (1 - Math.abs(t)) * 0.22 + rng.range(-0.04, 0.1),
      rng.range(-0.28, 0.28),
    ];
    parts.push(xform(jitter(lowSphere(r, 1), r * 0.09, rng), { pos }));
  }
  // A crown puff on top for the classic cumulus silhouette.
  parts.push(xform(jitter(lowSphere(0.72, 1), 0.06, rng), { pos: [rng.range(-0.3, 0.3), 0.72, 0] }));
  const g = merge(parts);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const floor = -0.32;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < floor) p.setY(i, floor + (y - floor) * 0.2);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('color');
  g.computeBoundingSphere();
  return g;
}

export class Sky {
  readonly object = new THREE.Group();
  private readonly domeGeometry: THREE.BufferGeometry;
  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly cloudGeometry: THREE.BufferGeometry;
  private readonly cloudMaterial: THREE.ShaderMaterial;
  private readonly clouds: THREE.InstancedMesh;
  private readonly uAngle: THREE.IUniform<number> = { value: 0 };
  private readonly uScale: THREE.IUniform<number> = { value: 1 };
  private time = 0;
  private disposed = false;

  constructor(pal: Palette, q: QualityPreset) {
    this.object.name = 'sky';
    const sunDir = sunDirection(pal, new THREE.Vector3());

    // Dome: only positions are needed; the gradient is computed per pixel, so a coarse sphere is enough.
    const ico = new THREE.IcosahedronGeometry(DOME_RADIUS, 2);
    this.domeGeometry = new THREE.BufferGeometry();
    this.domeGeometry.setAttribute('position', ico.getAttribute('position'));
    ico.dispose();
    const sunStrength = Math.min(1, Math.max(0.3, pal.light.sunIntensity / 1.6));
    this.domeMaterial = new THREE.ShaderMaterial({
      name: 'sky:dome',
      uniforms: {
        ...skyUniforms(pal),
        uSunDir: { value: sunDir.clone() },
        uSunDisc: { value: colorOf(mix(pal.sky.sun, WHITE, 0.45)).clone() },
        uSunGlow: { value: colorOf(pal.sky.sun).clone() },
        uSunCos: { value: Math.cos(SUN_ANGULAR_RADIUS) },
        uSunStrength: { value: sunStrength },
      },
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false, // exact palette colours; the fog colour (also not tone mapped) meets them at the horizon
    });
    const dome = new THREE.Mesh(this.domeGeometry, this.domeMaterial);
    dome.name = 'sky:dome';
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    dome.matrixAutoUpdate = false;

    // Clouds: brightness follows the sky so a dark chapter never gets glowing white clouds.
    const rng = new Rng(hashString(`sky:${pal.id}`));
    const bright = Math.min(
      0.9,
      Math.max(0.25, Math.max(luminance(pal.sky.horizon), luminance(pal.sky.top)) * 2.2),
    );
    const lit = mix(pal.sky.horizon, mix(pal.sky.sun, WHITE, 0.55), bright);
    const shadeHex = mix(mix(pal.sky.top, pal.sky.horizon, 0.5), lit, 0.4);
    // Short fog (dark valley, indoors) hazes the clouds into the sky instead of leaving them crisp.
    const haze = Math.min(0.95, Math.max(0, 1 - (pal.fog.far - 40) / 180));
    this.cloudGeometry = buildCloudGeometry(rng.fork('shape'));
    this.cloudMaterial = new THREE.ShaderMaterial({
      name: 'sky:clouds',
      uniforms: {
        ...skyUniforms(pal),
        uLit: { value: colorOf(lit).clone() },
        uShade: { value: colorOf(shadeHex).clone() },
        uSunDir: { value: sunDir.clone() },
        uHaze: { value: haze },
        uAngle: this.uAngle,
        uScale: this.uScale,
      },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      fog: false,
      toneMapped: false,
    });
    const count = CLOUD_COUNT[q.level];
    this.clouds = new THREE.InstancedMesh(this.cloudGeometry, this.cloudMaterial, count);
    this.clouds.name = 'sky:clouds';
    this.clouds.frustumCulled = false; // positioned around the camera in the shader
    this.clouds.renderOrder = -999;
    this.clouds.matrixAutoUpdate = false;
    this.placeClouds(rng.fork('place'), count);

    this.object.add(dome, this.clouds);
  }

  private placeClouds(rng: Rng, count: number): void {
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const a = ((i + rng.range(-0.35, 0.35)) / count) * TAU;
      const dist = rng.range(CLOUD.dist[0], CLOUD.dist[1]);
      pos.set(
        Math.cos(a) * dist,
        rng.range(CLOUD.elevation[0], CLOUD.elevation[1]) * dist,
        Math.sin(a) * dist,
      );
      const w = dist * rng.range(CLOUD.width[0], CLOUD.width[1]); // apparent size stays even with distance
      scale.set(w, w * rng.range(0.6, 0.85), w * rng.range(0.55, 0.8));
      quat.setFromAxisAngle(up, Math.PI / 2 - a + rng.range(-0.3, 0.3)); // long side across the view
      this.clouds.setMatrixAt(i, m.compose(pos, quat, scale));
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  /** Drift the clouds and keep them inside the camera's far plane. The dome follows the camera by itself. */
  update(dt: number, camera: THREE.Camera): void {
    if (this.disposed) return;
    this.time += dt;
    this.uAngle.value = (this.time * CLOUD.drift) % TAU;
    const far =
      camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera
        ? camera.far
        : 1000;
    this.uScale.value = Math.min(1, (far * 0.92) / CLOUD_EXTENT);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    this.clouds.dispose();
    this.cloudGeometry.dispose();
    this.cloudMaterial.dispose();
    this.domeGeometry.dispose();
    this.domeMaterial.dispose();
  }
}

export interface Atmosphere {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  /** Centre the 60 m shadow frustum on a world point (snapped to shadow texels, so shadows do not shimmer
   *  as the player walks). Same as moving `sun.target`, which carries the sun with it. */
  focus(p: THREE.Vector3): void;
  dispose(): void;
}

/**
 * Fog, hemisphere light and the sun for a chapter palette. The sun is a child of its own target, so moving
 * `sun.target` (or calling `focus`) slides the whole shadow frustum with the player. `castShadow` is always on:
 * the renderer's shadow map (quality preset + Shadows setting, applied by Engine) decides whether it is drawn,
 * so changing quality at runtime just works.
 */
export function applyAtmosphere(scene: THREE.Scene, pal: Palette): Atmosphere {
  const previousFog = scene.fog;
  const fog = new THREE.Fog(pal.fog.color, pal.fog.near, pal.fog.far);
  scene.fog = fog;

  const hemi = new THREE.HemisphereLight(pal.light.hemiSky, pal.light.hemiGround, pal.light.hemiIntensity);
  hemi.name = 'atmosphere:hemi';

  const dir = sunDirection(pal, new THREE.Vector3());
  const sun = new THREE.DirectionalLight(pal.light.sun, pal.light.sunIntensity);
  sun.name = 'atmosphere:sun';
  sun.target.name = 'atmosphere:sunTarget';
  sun.position.copy(dir).multiplyScalar(SHADOW.distance);
  sun.target.add(sun);
  sun.castShadow = true;
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -SHADOW.half;
  cam.right = cam.top = SHADOW.half;
  cam.near = SHADOW.near;
  cam.far = SHADOW.far;
  cam.updateProjectionMatrix();
  sun.shadow.bias = SHADOW.bias;
  sun.shadow.normalBias = SHADOW.normalBias;
  // Engine only resizes maps when the preset changes, so a light added later reads the size itself.
  const size = services.tryGet('quality')?.preset.shadowMapSize ?? 1024;
  sun.shadow.mapSize.set(size, size);
  scene.add(hemi, sun.target);

  // Shadow-camera basis (matches Object3D.lookAt with +Y up) for texel snapping.
  const axisZ = dir.clone();
  const axisX = new THREE.Vector3(0, 1, 0).cross(axisZ);
  if (axisX.lengthSq() < 1e-6) axisX.set(1, 0, 0);
  axisX.normalize();
  const axisY = axisZ.clone().cross(axisX).normalize();
  const tmp = new THREE.Vector3();

  let disposed = false;
  return {
    hemi,
    sun,
    focus(p: THREE.Vector3): void {
      const texel = (SHADOW.half * 2) / Math.max(1, sun.shadow.mapSize.x);
      const a = Math.round(p.dot(axisX) / texel) * texel;
      const b = Math.round(p.dot(axisY) / texel) * texel;
      const c = p.dot(axisZ);
      sun.target.position.copy(axisX).multiplyScalar(a).add(tmp.copy(axisY).multiplyScalar(b));
      sun.target.position.add(tmp.copy(axisZ).multiplyScalar(c));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scene.remove(hemi, sun.target);
      sun.dispose(); // frees the shadow map
      hemi.dispose();
      if (scene.fog === fog) scene.fog = previousFog;
    },
  };
}
