/**
 * Chapter dioramas (DECISIONS #396): a small 3D picture of each land, built from the chapter's palette and the
 * prop kit (diorama-recipes.ts) and rendered once by the game's own renderer into an offscreen target. The
 * pixels become an image URL for the chapter tiles, the loading screen and the chapter card, replacing the
 * generated pictures. ~100 ms per land on a budget phone; kept in memory for the session.
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import { cylinder, lowSphere, merge, paint, part, xform } from './geom';
import { mat } from './materials';
import { getPalette, mix, shade, type Palette } from './palette';
import { buildProp } from './props/index';
import { Rng } from './rng';
import { applyAtmosphere } from './Sky';
import { DIORAMAS, type DioramaRecipe } from './diorama-recipes';

/** 16:9 picture size by quality level: sharp on strong devices, light on budget phones. */
const SIZES = { low: [480, 270, 0], medium: [640, 360, 4], high: [960, 540, 4] } as const;

const cache = new Map<number, Promise<string | null>>();
/** The sky wall is never fogged (it is the far distance), so it keeps its gradient; app-lifetime like mat(). */
const skyMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false });

/** An image URL of chapter `n`'s diorama (1-13, 14 = the Epilogue), or null when it cannot be drawn. */
export function chapterDiorama(n: number): Promise<string | null> {
  let p = cache.get(n);
  if (!p) {
    p = render(n).catch((err: unknown) => {
      console.warn(`[diorama] chapter ${n}`, err);
      return null;
    });
    cache.set(n, p);
  }
  return p;
}

/** The URL if it is already drawn (no waiting), else null. */
const done = new Map<number, string>();
export function chapterDioramaNow(n: number): string | null {
  return done.get(n) ?? null;
}

async function render(n: number): Promise<string | null> {
  const recipe = DIORAMAS[n];
  const engine = services.tryGet('engine');
  if (!recipe || !engine || engine.contextLost) return null;
  await new Promise<void>((r) => setTimeout(r, 0)); // never inside someone else's frame
  const renderer = engine.renderer;
  const scene = new THREE.Scene();
  const pal = getPalette(recipe.palette);
  const geos: THREE.BufferGeometry[] = [];
  const atmosphere = applyAtmosphere(scene, pal);
  scene.fog = new THREE.Fog(pal.fog.color, 45, 170);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55)); // pictures sit behind text: a touch brighter than the world
  build(scene, recipe, pal, geos);

  const [W, H, samples] = SIZES[services.tryGet('quality')?.level ?? 'medium'];
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.5, 200);
  camera.position.set(0, 4.6, 17);
  camera.lookAt(0, 3.6, -8);
  atmosphere.focus(new THREE.Vector3(0, 0, -6));

  const target = new THREE.WebGLRenderTarget(W, H, { samples });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const prev = renderer.getRenderTarget();
  let url: string | null = null;
  try {
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, px);
    url = await toUrl(px, W, H);
  } finally {
    renderer.setRenderTarget(prev);
    target.dispose();
    atmosphere.dispose();
    for (const g of geos) g.dispose();
  }
  if (url) done.set(n, url);
  return url;
}

function build(scene: THREE.Scene, r: DioramaRecipe, pal: Palette, geos: THREE.BufferGeometry[]): void {
  const rng = new Rng(r.seed);
  const add = (g: THREE.BufferGeometry, kind: 'lambert' | 'unlit' | 'glow' | THREE.Material = 'lambert'): void => {
    geos.push(g);
    scene.add(new THREE.Mesh(g, typeof kind === 'string' ? mat(kind) : kind));
  };
  // Sky: a tall gradient wall far behind, horizon to zenith.
  const sky = new THREE.PlaneGeometry(400, 120, 1, 8).toNonIndexed();
  sky.translate(0, 40, -90);
  sky.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(sky.attributes.position!.count * 3), 3));
  paint(sky, (p) => mix(pal.sky.horizon, pal.sky.top, Math.min(1, Math.max(0, (p.y + 5) / 80))));
  add(sky, skyMaterial);
  // The hill the scene stands on, and rolling hills behind it.
  const base = r.ground ?? 'mid';
  const ground = cylinder(34, 34, 2, 28);
  xform(ground, { pos: [0, -2, -6] }); // geom cylinders stand on y = 0: the top is the ground plane
  paint(ground, (p) => mix(pal.ground[base], pal.ground.low, Math.min(1, Math.hypot(p.x, p.z + 6) / 34)));
  add(ground);
  const hills: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const x = -42 + i * 14 + rng.range(-3, 3);
    const s = rng.range(9, 16);
    hills.push(part(lowSphere(1, 1), rng.chance(0.5) ? pal.ground.high : pal.ground.mid, {
      pos: [x, -s * 0.12, -38 - rng.range(0, 14)],
      scale: [s * 1.7, s * 0.42, s],
    }));
  }
  add(merge(hills));
  // The Way: a warm ribbon winding from the front to the landmark.
  const way: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const z = 14 - t * 26;
    const x = Math.sin(t * 2.6 + 0.4) * 2.2 * (1 - t * 0.4);
    const nx = Math.sin((i + 1) / 15 * 2.6 + 0.4) * 2.2 - x;
    const glowPath = shade(pal.ground.path, 0.12);
    way.push(part(cylinder(1.35, 1.35, 0.12, 10), i % 2 ? glowPath : mix(glowPath, pal.ground.pathEdge, 0.2), {
      pos: [x, 0, z],
      rot: [0, Math.atan2(nx, -1.7), 0],
      scale: [1, 1, 1.3],
    }));
  }
  add(merge(way));
  // Landmarks.
  for (const [type, x, z, rotY, scale, params] of r.props) {
    const res = buildProp(type, rng.fork(type + x), pal, params ?? {});
    xform(res.geometry, { pos: [x, 0, z], rot: [0, rotY, 0], scale });
    add(res.geometry);
    if (res.glow) {
      xform(res.glow, { pos: [x, 0, z], rot: [0, rotY, 0], scale });
      add(res.glow, 'glow');
    }
  }
  if (r.glow) {
    const [x, y, z, radius, accent] = r.glow;
    const g = lowSphere(radius, 2);
    xform(g, { pos: [x, y, z] });
    paint(g, pal.accents[accent] ?? pal.sky.sun);
    add(g, 'glow');
  }
}

/** RGBA rows (bottom-up from WebGL) to a JPEG object URL. */
async function toUrl(px: Uint8Array, W: number, H: number): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  const row = W * 4;
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return blob ? URL.createObjectURL(blob) : null;
}
