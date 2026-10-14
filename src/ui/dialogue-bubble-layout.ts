/**
 * Screen placement for world-space speech bubbles (src/narrative/SpeechBubbles.ts): the anchor above a
 * character's head, its projection to the screen, edge clamping and the upward stacking of bubbles that overlap.
 * Pure math over plain objects; no DOM, no allocation per frame.
 */
import * as THREE from 'three';
import type { Character } from '../gen/CharacterFactory';

/** One bubble as the layout sees it (sizes in CSS px, unscaled; positions in px from the top-left). */
export interface ScreenBox {
  /** Creation order: among bubbles at the same height the newest sits lowest (piles grow upward). */
  order: number;
  /** Unscaled size of the bubble box. */
  w: number;
  h: number;
  /** Projected head point (input) / clamped bubble centre and bottom (output). */
  anchorX: number;
  x: number;
  bottom: number;
  scale: number;
  /** In front of the camera, on screen, near enough. */
  visible: boolean;
  /** Fading out: keeps its place, is not an obstacle. */
  leaving: boolean;
  /** Px the bubble is pushed up to clear the ones below it (target, and the eased value shown). */
  targetLift: number;
  lift: number;
}

/** Space between the head and the bubble's tail tip, and between stacked bubbles (px). */
const TAIL_GAP = 16;
const STACK_GAP = 6;
const EDGE = 10;
/** Head clearance above the top of the hair (m), and extra room for tall headwear (head radii). */
const CLEARANCE = 0.1;
const HAT_EXTRA: Readonly<Record<string, number>> = {
  tall: 1.1,
  wig: 0.45,
  helmet: 0.35,
  droopy: 0.4,
  hood: 0.15,
  cap: 0.15,
  mirrorMask: 0.1,
  scarf: 0.1,
};
/** Bubbles are hidden beyond this distance (m) and shrink towards MIN_SCALE with distance. */
const MAX_DIST = 45;
const MIN_SCALE = 0.72;

const headOffset = new WeakMap<Character, number>();

/** Metres above the head bone where the bubble's tail points (rest pose, measured once per character). */
function offsetFor(c: Character): number {
  const cached = headOffset.get(c);
  if (cached !== undefined) return cached;
  let y = 0;
  for (let o: THREE.Object3D | null = c.bones.head ?? null; o && o !== c.root; o = o.parent)
    y += o.position.y;
  const headR = c.animator.params.rig?.headR ?? c.height * 0.16;
  const hat = HAT_EXTRA[c.recipe.parts.hat ?? 'none'] ?? 0;
  const off = Math.max(0.05, c.height - y) + CLEARANCE + hat * headR;
  headOffset.set(c, off);
  return off;
}

/** World point just above the character's head (follows the animated head bone). */
export function headAnchor(c: Character, out: THREE.Vector3): THREE.Vector3 {
  const head = c.bones.head;
  const e = c.root.matrixWorld.elements;
  const sy = Math.hypot(e[4], e[5], e[6]) || 1;
  if (!head) {
    c.root.getWorldPosition(out);
    out.y += (c.height + CLEARANCE) * sy;
    return out;
  }
  head.getWorldPosition(out);
  out.y += offsetFor(c) * sy;
  return out;
}

const view = new THREE.Vector3();
const projected = { x: 0, y: 0, scale: 1 };

/** Screen point (px) and distance scale for a world point, or null when behind the camera or too far. */
export function projectAnchor(
  p: THREE.Vector3,
  cam: THREE.Camera,
  width: number,
  height: number,
): { readonly x: number; readonly y: number; readonly scale: number } | null {
  view.copy(p).applyMatrix4(cam.matrixWorldInverse);
  const dist = -view.z;
  if (dist < 0.05 || dist > MAX_DIST) return null;
  view.copy(p).project(cam);
  if (!Number.isFinite(view.x) || !Number.isFinite(view.y)) return null;
  projected.x = ((view.x + 1) / 2) * width;
  projected.y = ((1 - view.y) / 2) * height;
  projected.scale = Math.max(MIN_SCALE, Math.min(1, 1.12 - dist / 40));
  return projected;
}

const active: ScreenBox[] = [];
const placedTop: number[] = [];

function byHeight(a: ScreenBox, b: ScreenBox): number {
  return b.bottom - a.bottom || b.order - a.order;
}

/**
 * Clamps each visible bubble inside the screen (centre x, bottom above the head with room for the tail) and
 * stacks overlapping bubbles upward: the lowest (then the newest) keeps its place, the others move up just
 * enough to clear it. Writes x, bottom and targetLift.
 */
export function layoutBubbles(list: readonly ScreenBox[], width: number, height: number): void {
  active.length = 0;
  for (const b of list) {
    if (!b.visible || b.leaving) continue;
    const w = b.w * b.scale;
    const h = b.h * b.scale;
    b.x = w >= width - 2 * EDGE ? width / 2 : clamp(b.anchorX, EDGE + w / 2, width - EDGE - w / 2);
    b.bottom = clamp(b.bottom - TAIL_GAP * b.scale, Math.min(height - EDGE, EDGE + h), height - EDGE);
    active.push(b);
  }
  active.sort(byHeight);
  placedTop.length = 0;
  for (let i = 0; i < active.length; i++) {
    const b = active[i];
    const w = b.w * b.scale;
    const h = b.h * b.scale;
    let bottom = b.bottom;
    for (let pass = 0, moved = true; moved && pass <= i; pass++) {
      moved = false;
      for (let j = 0; j < i; j++) {
        const o = active[j];
        const ow = o.w * o.scale;
        if (Math.abs(b.x - o.x) >= (w + ow) / 2 + STACK_GAP) continue;
        const oTop = placedTop[j];
        const oBottom = oTop + o.h * o.scale;
        if (bottom <= oTop - STACK_GAP || bottom - h >= oBottom + STACK_GAP) continue;
        bottom = oTop - STACK_GAP;
        moved = true;
      }
    }
    placedTop[i] = bottom - h;
    b.targetLift = Math.max(0, b.bottom - bottom);
  }
  active.length = 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

let reduceQuery: MediaQueryList | null = null;

/** Settings > Reduce motion (the body class) or the OS setting: stacked bubbles snap instead of easing. */
export function reduceMotion(): boolean {
  if (typeof document !== 'undefined' && document.body?.classList.contains('reduce-motion')) return true;
  if (typeof matchMedia !== 'function') return false;
  reduceQuery ??= matchMedia('(prefers-reduced-motion: reduce)');
  return reduceQuery.matches;
}
