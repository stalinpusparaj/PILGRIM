/**
 * The title screen's background (GDD 2.14 "Title screen": "slow camera drift over a generated landscape with the
 * far shining light"). Builds `content/levels/title.json` with the normal world builder, adds the far light as a
 * tall soft pillar of light, and drifts the camera slowly along the start of the Way, looking down the valley
 * towards the light. Everything placed comes from the level file:
 *
 * - zone type "farLight" (circle): where the light stands (`x`, `z`), its radius `r` and its `height` (m);
 * - zone type "cameraRail" ('way' band): the camera glides between `from` and `to` along `path` (default the main
 *   Way), `height` m above the ground and `offset` m to the right of travel, there and back in `seconds`.
 *
 * Cheap on every quality: the level is small and open, the light is 3 draw calls. With Reduce camera motion the
 * camera holds still at the start of the rail and the light does not breathe.
 *
 *   const scene = new TitleScene(engine);
 *   await scene.start();      // resolves once the landscape is on screen
 *   scene.dispose();          // the caller then shows something else
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { PRESETS } from '../core/Quality';
import { precompile } from '../core/compile';
import { cylinder, lowSphere, merge, part } from '../gen/geom';
import type { Palette } from '../gen/palette';
import type { Way } from '../gen/Way';
import { buildWorld, loadLevel } from '../world/LevelLoader';
import type { LevelZone } from '../world/LevelTypes';
import type { World } from '../world/World';
import { reduceMotion } from './menu-screen';

const LEVEL_ID = 'title';
const CAMERA = { fov: 55, near: 0.5, far: 900 };
/** Fallbacks when the level's zones leave a value out. */
const RAIL_DEFAULTS = { from: 0, to: 0.3, height: 7, offset: 0, seconds: 75 };
const LIGHT_DEFAULTS = { r: 3, height: 50 };
/** How far ahead on the Way (fraction of its length) the camera's eye rests, and how much the light pulls it. */
const LOOK_AHEAD = 0.12;
const LOOK_AT_LIGHT = 0.55;
/** Breathing of the halo: very slow and soft (GDD 2.15: no flashes). */
/** How far the light's core is lifted from the palette's light colour toward white. */
const CORE_WHITE = 0.7;
const WHITE = new THREE.Color(0xffffff);
const BREATHE = { period: 11, depth: 0.12 };

interface Rail {
  way: Way;
  from: number;
  to: number;
  height: number;
  offset: number;
  seconds: number;
}

interface FarLight {
  group: THREE.Group;
  flare: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  top: THREE.Vector3;
  dispose(): void;
}

export class TitleScene {
  readonly camera: THREE.PerspectiveCamera;
  private current: World | null = null;
  private rail: Rail | null = null;
  private light: FarLight | null = null;
  private removeSystem: (() => void) | null = null;
  private readonly offs: Array<() => void> = [];
  private time = 0;
  private started = false;
  private shown = false;
  private disposed = false;
  private readonly pos = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(private readonly engine: Engine) {
    const fov = services.tryGet('settings')?.data.fov ?? CAMERA.fov;
    this.camera = new THREE.PerspectiveCamera(fov, 1, CAMERA.near, CAMERA.far);
    this.camera.name = 'title:camera';
  }

  get ready(): boolean {
    return this.shown && !this.disposed;
  }

  get world(): World | null {
    return this.current;
  }

  /** Builds the landscape and puts it on screen. Rejects when it cannot be built (the caller keeps its backdrop). */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    const level = await loadLevel(LEVEL_ID);
    if (this.disposed) return;
    const preset = services.tryGet('quality')?.preset ?? PRESETS.medium;
    const world = await buildWorld(level, preset, () => {});
    if (this.disposed) {
      world.dispose();
      return;
    }
    this.current = world;
    this.rail = readRail(level.zones, world);
    this.light = buildFarLight(level.zones, world);
    if (this.light) world.scene.add(this.light.group);
    this.place(0);
    try {
      await precompile(this.engine.renderer, world.scene, this.camera);
    } catch (err) {
      console.warn('[title] shader precompile failed; shaders compile on first draw', err);
    }
    if (this.disposed) return;
    this.removeSystem = this.engine.loop.add({ render: (_a, frameDt) => this.frame(frameDt) }, 0);
    this.offs.push(
      events.on('settings:changed', ({ key }) => {
        if (key !== 'fov') return;
        const fov = services.tryGet('settings')?.data.fov;
        if (fov !== undefined) {
          this.camera.fov = fov;
          this.camera.updateProjectionMatrix();
        }
      }),
    );
    this.engine.setView(world.scene, this.camera);
    this.shown = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeSystem?.();
    this.removeSystem = null;
    for (const off of this.offs.splice(0)) off();
    if (this.light) {
      this.light.group.removeFromParent();
      this.light.dispose();
      this.light = null;
    }
    this.current?.dispose();
    this.current = null;
    this.rail = null;
  }

  // ------------------------------------------------------------------------------------------- per frame

  private frame(frameDt: number): void {
    const world = this.current;
    if (!world) return;
    const still = reduceMotion();
    if (!still) this.time += frameDt;
    this.place(this.time);
    if (this.light) {
      this.light.flare.quaternion.copy(this.camera.quaternion);
      const breathe = still ? 0 : Math.sin((this.time / BREATHE.period) * Math.PI * 2);
      this.light.haloMat.opacity = 1 - BREATHE.depth * (0.5 + 0.5 * breathe);
    }
    world.update(frameDt, this.camera);
  }

  /** Camera on the rail at time `t` (s): there and back with eased ends, looking down the valley to the light. */
  private place(t: number): void {
    const world = this.current;
    const rail = this.rail;
    if (!world || !rail) return;
    const phase = (t / rail.seconds) % 2;
    const p = phase < 1 ? phase : 2 - phase;
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * p);
    const u = rail.from + (rail.to - rail.from) * eased;
    rail.way.sample(u, this.pos);
    rail.way.tangent(u, this.tan);
    const len = Math.hypot(this.tan.x, this.tan.z) || 1;
    // Right of travel (facing +Z, right is -X), the convention level files use for `offset`.
    this.pos.x += (-this.tan.z / len) * rail.offset;
    this.pos.z += (this.tan.x / len) * rail.offset;
    const ground = Math.max(world.terrain.heightAt(this.pos.x, this.pos.z), this.pos.y);
    this.pos.y = ground + rail.height;
    this.camera.position.copy(this.pos);

    rail.way.sample(Math.min(1, u + LOOK_AHEAD), this.ahead);
    this.ahead.y += 1.5;
    this.look.copy(this.ahead);
    if (this.light) this.look.lerp(this.light.top, LOOK_AT_LIGHT);
    this.camera.lookAt(this.look);
    world.setShadowFocus(this.ahead);
  }
}

// ----------------------------------------------------------------------------------------------- helpers

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readRail(zones: readonly LevelZone[], world: World): Rail {
  const z = zones.find((zone) => zone.type === 'cameraRail');
  const path = typeof z?.path === 'string' ? z.path : 'way';
  const way = world.wayById(path) ?? world.ways.main;
  const from = Math.min(1, Math.max(0, num(z?.from, RAIL_DEFAULTS.from)));
  const to = Math.min(1, Math.max(0, num(z?.to, RAIL_DEFAULTS.to)));
  return {
    way,
    from,
    to,
    height: num(z?.height, RAIL_DEFAULTS.height),
    offset: num(z?.offset, RAIL_DEFAULTS.offset),
    seconds: Math.max(10, num(z?.seconds, RAIL_DEFAULTS.seconds)),
  };
}

/**
 * The far shining light: a glowing core, crossed soft halo planes and a flare. The core has its own unfogged,
 * additive material (the shared 'glow' one took the haze colour at this distance and read as a dull post).
 */
function buildFarLight(zones: readonly LevelZone[], world: World): FarLight | null {
  const z = zones.find((zone) => zone.type === 'farLight');
  if (!z) return null;
  const at = Array.isArray(z.at) ? z.at : null;
  const x = num(z.x, num(at?.[0], 0));
  const zz = num(z.z, num(at?.[2], 0));
  const r = Math.max(0.5, num(z.r, LIGHT_DEFAULTS.r));
  const height = Math.max(4, num(z.height, LIGHT_DEFAULTS.height));
  const hex = lightColour(world.palette);

  const group = new THREE.Group();
  group.name = 'title:farLight';
  group.position.set(x, world.terrain.heightAt(x, zz) - 0.5, zz);

  const coreHex = `#${new THREE.Color(hex).lerp(WHITE, CORE_WHITE).getHexString()}`;
  const coreGeo = merge([
    part(cylinder(r * 0.16, r * 0.3, height, 8), coreHex),
    part(lowSphere(r * 0.75, 1), coreHex, { pos: [0, height, 0] }),
  ]);
  // Additive like the halo: the core adds light to whatever is behind it, so it is always the brightest part.
  const coreMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  coreMat.name = 'title:farLight:core';
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.name = 'title:farLight:core';
  core.renderOrder = 1;

  const haloMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  haloMat.name = 'title:farLight:halo';
  const halo = new THREE.Mesh(haloGeometry(r * 7, height * 1.15, hex), haloMat);
  halo.name = 'title:farLight:halo';
  halo.renderOrder = 2;
  const flare = new THREE.Mesh(flareGeometry(r * 10, hex), haloMat);
  flare.name = 'title:farLight:flare';
  flare.position.y = height;
  flare.renderOrder = 3;
  group.add(core, halo, flare);

  const top = new THREE.Vector3(x, group.position.y + height * 0.7, zz);
  return {
    group,
    flare,
    haloMat,
    top,
    dispose: () => {
      coreGeo.dispose();
      coreMat.dispose();
      halo.geometry.dispose();
      flare.geometry.dispose();
      haloMat.dispose();
    },
  };
}

function lightColour(pal: Palette): string {
  return pal.accents['horizonLight'] ?? pal.sky.sun;
}

/** Three vertical planes crossing on the axis; RGBA vertex colours fade to nothing at the sides and the top. */
function haloGeometry(width: number, height: number, hex: string): THREE.BufferGeometry {
  const cols = 5;
  const rows = 5;
  const c = new THREE.Color(hex);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let plane = 0; plane < 3; plane++) {
    const a = (plane * Math.PI) / 3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const base = pos.length / 3;
    for (let j = 0; j < rows; j++) {
      const v = j / (rows - 1);
      for (let i = 0; i < cols; i++) {
        const u = i / (cols - 1) - 0.5;
        pos.push(u * width * dx, v * height, u * width * dz);
        const side = Math.pow(1 - Math.abs(u) * 2, 2);
        const alpha = 0.32 * side * (1 - Math.pow(v, 1.6)) * (0.6 + 0.4 * (1 - v));
        col.push(c.r, c.g, c.b, alpha);
      }
    }
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const k = base + j * cols + i;
        idx.push(k, k + 1, k + cols, k + 1, k + cols + 1, k + cols);
      }
    }
  }
  return indexedGeometry(pos, col, idx);
}

/** A round soft glow facing the camera: a fan from a bright centre to a clear rim. */
function flareGeometry(radius: number, hex: string): THREE.BufferGeometry {
  const seg = 18;
  const c = new THREE.Color(hex);
  const pos: number[] = [0, 0, 0];
  const col: number[] = [c.r, c.g, c.b, 0.9];
  const idx: number[] = [];
  for (let ring = 1; ring <= 2; ring++) {
    const rr = ring === 1 ? radius * 0.3 : radius;
    const alpha = ring === 1 ? 0.35 : 0;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * rr, Math.sin(a) * rr, 0);
      col.push(c.r, c.g, c.b, alpha);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % seg);
    idx.push(0, a, b);
    const oa = a + seg;
    const ob = b + seg;
    idx.push(a, oa, ob, a, ob, b);
  }
  return indexedGeometry(pos, col, idx);
}

function indexedGeometry(pos: number[], col: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
