/**
 * Generated speaker portraits for the dialogue panel (GDD 2.8 "a bottom panel with portrait icon"; GDD 2.3: no
 * image files). A portrait is the character's own head, rendered once:
 *
 * - CharacterFactory builds the recipe into a small offscreen scene (hemisphere + warm key light, no fog, no
 *   shadows), the face is set to the requested expression and settled, and a 3/4 head-and-shoulders camera
 *   renders it with the Engine's renderer into an sRGB render target (the GPU encodes sRGB on write, so there is
 *   no banding) at twice the final size.
 * - The pixels are read back once and composited on a 2D canvas: a soft circle in the recipe's own colours behind
 *   the head (supersampled down, so edges are smooth), clipped to a circle with a thin rim.
 * - The result is cached as a PNG data URL per recipe id + expression (small LRU). The temporary character, the
 *   render target and the canvases are freed straight away.
 *
 * Returns null when there is no renderer (tests, lost context): the panel then shows a coloured initial instead.
 *
 *   const url = portraitUrl('evangelist', 'happy');
 *   await preloadPortraits(['christian_burdened', 'evangelist']);   // one per frame, before a conversation
 */
import * as THREE from 'three';
import { services } from '../core/Services';
import { CharacterFactory, type CharacterRecipe, type Expression } from '../gen/CharacterFactory';
import { mix, shade } from '../gen/palette';

/** Final portrait edge in px (shown at ~64-96 CSS px, so this covers 2x screens). */
export const PORTRAIT_SIZE = 160;
const SUPERSAMPLE = 2;
const MAX_CACHED = 48;
const FOV = 26;
/** Frame height in head radii and how far below the head centre the frame is centred (shows the shoulders). */
const FRAME_HEADS = 4;
const FRAME_DROP = 0.32;
/** Face settle: blend the expression in without reaching the first blink (>= 0.5 s). */
const SETTLE_STEPS = 8;
const SETTLE_DT = 0.04;

export interface PortraitColors {
  /** Circle centre and edge colours. */
  inner: string;
  outer: string;
  /** Rim colour. */
  rim: string;
}

const cache = new Map<string, string>();

function recipeOf(recipe: CharacterRecipe | string): CharacterRecipe | null {
  if (typeof recipe !== 'string') return recipe;
  return CharacterFactory.recipes()[recipe] ?? null;
}

/** The background colours for a recipe (also used by the panel's fallback when no portrait can be rendered). */
export function portraitColors(recipe: CharacterRecipe | string): PortraitColors {
  const r = recipeOf(recipe);
  const base = r?.colors.top ?? '#C9A66B';
  const accent = r?.colors.accent ?? r?.colors.trim ?? r?.colors.hat ?? shade(base, -0.25);
  return {
    inner: mix(base, '#FFF4DC', 0.72),
    outer: mix(base, '#FFF4DC', 0.35),
    rim: mix(accent, '#3B2A1F', 0.15),
  };
}

/**
 * The portrait for a recipe (data URL), rendered on first use and cached. `expression` defaults to the recipe's
 * own. Null when it cannot be rendered right now.
 */
export function portraitUrl(recipe: CharacterRecipe | string, expression?: Expression): string | null {
  const r = recipeOf(recipe);
  const id = typeof recipe === 'string' ? recipe : recipe.id;
  const expr = expression ?? r?.expression ?? 'neutral';
  const key = `${id}:${expr}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key); // LRU: move to the newest end
    cache.set(key, hit);
    return hit;
  }
  const url = render(r ?? id, expr);
  if (url === null) return null;
  cache.set(key, url);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return url;
}

/** True when the portrait is already cached (no render needed). `expression` defaults like portraitUrl(). */
export function hasPortrait(id: string, expression?: Expression): boolean {
  return cache.has(`${id}:${expression ?? recipeOf(id)?.expression ?? 'neutral'}`);
}

/** Renders portraits ahead of a conversation, one per animation frame so no single frame stalls. */
export async function preloadPortraits(
  entries: ReadonlyArray<string | { recipe: string; expression?: Expression }>,
): Promise<void> {
  for (const e of entries) {
    const id = typeof e === 'string' ? e : e.recipe;
    const expr = typeof e === 'string' ? undefined : e.expression;
    if (hasPortrait(id, expr)) continue;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    portraitUrl(id, expr);
  }
}

/** Drops every cached portrait (language or quality changes do not need this; leak tests and recipes edits do). */
export function clearPortraits(): void {
  cache.clear();
}

// -------------------------------------------------------------------------------------------- render

const tmpHead = new THREE.Vector3();

function render(recipe: CharacterRecipe | string, expression: Expression): string | null {
  const engine = services.tryGet('engine');
  if (!engine || engine.contextLost || typeof document === 'undefined') return null;
  const renderer = engine.renderer;
  const px = PORTRAIT_SIZE * SUPERSAMPLE;

  const scene = new THREE.Scene();
  scene.name = 'portrait';
  const hemi = new THREE.HemisphereLight('#FFF3E0', '#7A6A58', 1.15);
  const key = new THREE.DirectionalLight('#FFE9C8', 1.7);
  key.position.set(-1.4, 2.2, 2.4);
  scene.add(hemi, key, key.target);

  const character = CharacterFactory.build(recipe);
  const target = new THREE.WebGLRenderTarget(px, px, { colorSpace: THREE.SRGBColorSpace, depthBuffer: true });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  try {
    scene.add(character.root);
    character.setExpression(expression);
    for (let i = 0; i < SETTLE_STEPS; i++) character.update(SETTLE_DT);
    character.root.updateMatrixWorld(true);

    const camera = frameHead(character.bones.head, character.height, headRadius(character));
    key.target.position.copy(tmpHead);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(px * px * 4);
    renderer.readRenderTargetPixels(target, 0, 0, px, px, pixels);
    return composite(pixels, px, portraitColors(recipe));
  } catch (err) {
    console.warn('[Portraits] could not render a portrait', err);
    return null;
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    target.dispose();
    character.dispose();
    scene.clear();
  }
}

function headRadius(c: { height: number; animator: { params: { rig?: { headR: number } } } }): number {
  const r = c.animator.params.rig?.headR;
  return r !== undefined && Number.isFinite(r) && r > 0 ? r : c.height * 0.16;
}

/** A 3/4 head-and-shoulders camera from the character's right, so the face looks to the viewer's right (towards the
 * panel text; the panel mirrors the player's portrait). Leaves the head centre in `tmpHead`. */
function frameHead(headBone: THREE.Bone | undefined, height: number, headR: number): THREE.PerspectiveCamera {
  if (headBone) headBone.getWorldPosition(tmpHead).y += headR * 0.8;
  else tmpHead.set(0, height - headR, 0);
  const halfH = (FRAME_HEADS * headR) / 2;
  const dist = halfH / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const camera = new THREE.PerspectiveCamera(FOV, 1, Math.max(0.01, dist * 0.2), dist * 4);
  const look = tmpHead.clone();
  look.y -= headR * FRAME_DROP;
  camera.position.set(look.x - dist * 0.42, look.y + dist * 0.12, look.z + dist * 0.9);
  camera.lookAt(look);
  camera.updateMatrixWorld(true);
  return camera;
}

/** Circle background + the rendered head (flipped right way up, supersampled down) → PNG data URL. */
function composite(pixels: Uint8Array, px: number, colors: PortraitColors): string | null {
  const src = document.createElement('canvas');
  src.width = px;
  src.height = px;
  const out = document.createElement('canvas');
  out.width = PORTRAIT_SIZE;
  out.height = PORTRAIT_SIZE;
  const sctx = src.getContext('2d');
  const octx = out.getContext('2d');
  if (!sctx || !octx) return null;
  try {
    const image = sctx.createImageData(px, px);
    const row = px * 4;
    for (let y = 0; y < px; y++) image.data.set(pixels.subarray((px - 1 - y) * row, (px - y) * row), y * row);
    sctx.putImageData(image, 0, 0);

    const s = PORTRAIT_SIZE;
    const c = s / 2;
    const rim = Math.max(2, s * 0.03);
    octx.save();
    octx.beginPath();
    octx.arc(c, c, c - rim / 2, 0, Math.PI * 2);
    octx.closePath();
    octx.clip();
    const grad = octx.createRadialGradient(c, c * 0.8, s * 0.08, c, c, c);
    grad.addColorStop(0, colors.inner);
    grad.addColorStop(1, colors.outer);
    octx.fillStyle = grad;
    octx.fillRect(0, 0, s, s);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(src, 0, 0, px, px, 0, 0, s, s);
    octx.restore();
    octx.beginPath();
    octx.arc(c, c, c - rim / 2, 0, Math.PI * 2);
    octx.lineWidth = rim;
    octx.strokeStyle = colors.rim;
    octx.stroke();
    return out.toDataURL('image/png');
  } finally {
    src.width = src.height = 0; // free the backing stores now, not at the next GC
    out.width = out.height = 0;
  }
}
