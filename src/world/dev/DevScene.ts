/**
 * Phase 0 test scene (ARCHITECTURE.md "Runtime modes"): an empty sky-and-ground diorama with a slowly
 * orbiting camera. It proves the engine end to end: fixed-step update with interpolated render, the style
 * lock (flat shading, vertex colours, MeshLambertMaterial, sun + hemisphere light, gradient sky, fog), shadows
 * that follow the quality preset, and live input (look turns the orbit, move zooms and circles).
 *
 * Draw calls: sky, ground, props, clouds, gem (+ props and gem again for the shadow map) = 7 at most.
 */
import * as THREE from 'three';
import type { System } from '../../core/Loop';
import { services } from '../../core/Services';
import { Sky } from './Sky';
import { DEV_PALETTE, buildClouds, buildGem, buildGround, buildProps } from './devWorld';

export interface DevSceneOptions {
  /** Vertical field of view in degrees (Settings.fov). */
  fov: number;
  /** World seed. The default is the year The Pilgrim's Progress was published. */
  seed?: number;
}

const DEFAULT_SEED = 1678;
const SUN_DIRECTION = new THREE.Vector3(0.55, 0.62, 0.42).normalize();
const FOG = { near: 70, far: 240 };
const CAMERA = { near: 0.1, far: 1000 };
const ORBIT = {
  radius: 18,
  minRadius: 7,
  maxRadius: 40,
  pitch: 0.26, // radians above the target
  minPitch: 0.04,
  maxPitch: 1.1,
  targetY: 1.4,
  speed: (Math.PI * 2) / 90, // one lap every 90 s
  zoomSpeed: 10, // m/s at full stick
  circleSpeed: 0.9, // rad/s at full stick
};
const SHADOW = { extent: 34, distance: 90, bias: -0.0004, normalBias: 0.03 };
const GEM = { y: 2.0, bob: 0.18, bobSpeed: 1.6, spin: 0.9 };
const CLOUD_DRIFT = 0.006; // rad/s

export class DevScene implements System {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private readonly sky: Sky;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly ground: THREE.Mesh;
  private readonly props: THREE.Mesh;
  private readonly clouds: THREE.Mesh;
  private readonly gem: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly target = new THREE.Vector3(0, ORBIT.targetY, 0);

  // Simulated state (update) and the previous step's copy (for render interpolation).
  private yaw = 0.6;
  private pitch = ORBIT.pitch;
  private radius = ORBIT.radius;
  private time = 0;
  private readonly prev = { yaw: this.yaw, pitch: this.pitch, radius: this.radius, time: 0 };
  private disposed = false;

  constructor(opts: DevSceneOptions) {
    const seed = opts.seed ?? DEFAULT_SEED;
    const P = DEV_PALETTE;

    this.camera = new THREE.PerspectiveCamera(opts.fov, 1, CAMERA.near, CAMERA.far);
    this.scene.name = 'dev-scene';
    this.scene.fog = new THREE.Fog(P.skyHorizon, FOG.near, FOG.far);

    this.sky = new Sky(
      { top: P.skyTop, horizon: P.skyHorizon, bottom: P.skyBottom, sun: P.sun },
      SUN_DIRECTION,
    );

    // One shared material for every solid in the scene (GDD 2.11).
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.ground = this.mesh('ground', buildGround(seed), false, true);
    this.props = this.mesh('props', buildProps(seed + 1), true, true);
    this.clouds = this.mesh('clouds', buildClouds(seed + 2), false, false);
    this.gem = this.mesh('gem', buildGem(seed + 3), true, false);
    this.gem.position.set(0, GEM.y, 0);

    this.hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, 1.35);
    this.sun = new THREE.DirectionalLight(P.sunLight, 2.6);
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(SHADOW.distance);
    this.sun.castShadow = true; // the renderer's shadow map (quality preset) decides if it is drawn
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW.extent;
    cam.right = cam.top = SHADOW.extent;
    cam.near = 1;
    cam.far = SHADOW.distance * 2;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = SHADOW.bias;
    this.sun.shadow.normalBias = SHADOW.normalBias;
    const size = services.tryGet('quality')?.preset.shadowMapSize ?? 1024;
    this.sun.shadow.mapSize.set(size, size);

    this.scene.add(this.sky.mesh, this.ground, this.props, this.clouds, this.gem, this.hemi, this.sun);
    this.placeCamera(this.yaw, this.pitch, this.radius);
  }

  setFov(fov: number): void {
    if (!Number.isFinite(fov) || fov === this.camera.fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Fixed 60 Hz step: advance the orbit and the animated props, apply this step's input. */
  update(dt: number): void {
    if (this.disposed) return;
    this.prev.yaw = this.yaw;
    this.prev.pitch = this.pitch;
    this.prev.radius = this.radius;
    this.prev.time = this.time;

    this.time += dt;
    this.yaw += ORBIT.speed * dt;
    const input = services.tryGet('input');
    if (input) {
      // look.x > 0 turns the view right, which means orbiting the other way; look.y > 0 looks up.
      this.yaw -= input.look.x - input.move.x * ORBIT.circleSpeed * dt;
      this.pitch = clamp(this.pitch - input.look.y, ORBIT.minPitch, ORBIT.maxPitch);
      this.radius = clamp(
        this.radius - input.move.y * ORBIT.zoomSpeed * dt,
        ORBIT.minRadius,
        ORBIT.maxRadius,
      );
    }
  }

  /** Per rendered frame: interpolate between the last two steps so motion is smooth on any display rate. */
  render(alpha: number): void {
    if (this.disposed) return;
    const p = this.prev;
    this.placeCamera(
      lerp(p.yaw, this.yaw, alpha),
      lerp(p.pitch, this.pitch, alpha),
      lerp(p.radius, this.radius, alpha),
    );
    const t = lerp(p.time, this.time, alpha);
    this.gem.rotation.y = t * GEM.spin;
    this.gem.position.y = GEM.y + Math.sin(t * GEM.bobSpeed) * GEM.bob;
    this.clouds.rotation.y = t * CLOUD_DRIFT;
  }

  /** Frees every geometry, material and shadow map this scene created. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.ground, this.props, this.clouds, this.gem]) mesh.geometry.dispose();
    this.material.dispose();
    this.sky.dispose();
    this.sun.dispose(); // also frees its shadow map
    this.hemi.dispose();
    this.scene.clear();
    this.scene.fog = null;
  }

  private mesh(name: string, geometry: THREE.BufferGeometry, cast: boolean, receive: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }

  private placeCamera(yaw: number, pitch: number, radius: number): void {
    const flat = Math.cos(pitch) * radius;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * flat,
      this.target.y + Math.sin(pitch) * radius,
      this.target.z + Math.cos(yaw) * flat,
    );
    this.camera.lookAt(this.target);
    this.sky.follow(this.camera.position);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
