/**
 * Faces (GDD 2.11): dot eyes with a shine that blink, dark bar brows and eight swappable mouths. Every face part is
 * part of the character's single SkinnedMesh, bound rigidly to its own face bone, so expressions cost no extra draw
 * calls: blink = eye bone Y scale, brows = brow bone rotation/offset, mouth swap = active mouth bone scale 1, the
 * rest 0.
 */
import type * as THREE from 'three';
import { bevelBox, lowSphere, part } from './geom';
import { mix } from './palette';
import type { Rng } from './rng';
import { EXPRESSIONS, MOUTHS, type Expression, type MouthShape } from './char-types';
import { type BuildCtx, clipTris, ellipse, lightness, slab, surfaceRot } from './char-parts';
import { faceAnchors } from './rig';

export { EXPRESSIONS, MOUTHS };
export type { Expression, MouthShape };

const EYE = '#1E1719';
const LINE = '#40161C';
const INSIDE = '#4A1A22';
const TONGUE = '#D9707A';
const TEETH = '#FFFFFF';

interface ExprDef {
  /** Brow tilt in radians: + = angry (inner ends down), - = worried (inner ends up). */
  brow: number;
  /** Brow lift in head radii. */
  browY: number;
  /** Uniform eye scale. */
  eye: number;
  /** Eye openness 0..1 (sleepy is half closed). */
  lid: number;
  mouth: MouthShape;
}

/**
 * Highest brow lift (head radii). The brows rest at 0.29 r; the hero fringe starts at char-head.ts FRINGE.hero
 * (0.5 r, its lowest facet ~0.45 r over the brows), so a lifted brow (half-height 0.0375 r, x up to ±0.52 r)
 * stays on skin with a margin for the hair jitter and never slides under the fringe.
 */
export const BROW_LIFT_MAX = 0.09;

export const EXPRESSION_DEFS: Readonly<Record<Expression, ExprDef>> = {
  neutral: { brow: 0, browY: 0, eye: 1, lid: 1, mouth: 'neutral' },
  happy: { brow: -0.12, browY: 0.04, eye: 1, lid: 0.82, mouth: 'smile' },
  sad: { brow: -0.4, browY: 0.02, eye: 0.95, lid: 0.78, mouth: 'frown' },
  scared: { brow: -0.34, browY: 0.065, eye: 1.25, lid: 1, mouth: 'wavy' },
  surprised: { brow: -0.1, browY: BROW_LIFT_MAX, eye: 1.3, lid: 1, mouth: 'o' },
  angry: { brow: 0.46, browY: -0.05, eye: 0.95, lid: 0.85, mouth: 'frown' },
  sleepy: { brow: -0.08, browY: -0.04, eye: 1, lid: 0.32, mouth: 'neutral' },
  determined: { brow: 0.26, browY: -0.03, eye: 1, lid: 0.88, mouth: 'flat' },
};

// ------------------------------------------------------------------ geometry

type Outline = Array<[number, number]>;

function stadium(hw: number, hh: number): Outline {
  const pts: Outline = [];
  const cx = Math.max(0, hw - hh);
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * Math.PI;
    pts.push([cx + Math.cos(a) * hh, Math.sin(a) * hh]);
  }
  for (let i = 0; i <= 4; i++) {
    const a = Math.PI / 2 + (i / 4) * Math.PI;
    pts.push([-cx + Math.cos(a) * hh, Math.sin(a) * hh]);
  }
  return pts;
}

function arcBand(cx: number, cy: number, rad: number, t: number, a0: number, a1: number, n = 6): Outline {
  const outer: Outline = [];
  const inner: Outline = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    outer.push([cx + Math.cos(a) * (rad + t / 2), cy + Math.sin(a) * (rad + t / 2)]);
    inner.push([cx + Math.cos(a) * (rad - t / 2), cy + Math.sin(a) * (rad - t / 2)]);
  }
  return [...outer, ...inner.reverse()];
}

const deg = (d: number): number => (d * Math.PI) / 180;

/** The pieces of one mouth shape: outline, colour and forward offset (local XY, mouth centre at 0,0). */
function mouthPieces(shape: MouthShape, w: number): Array<{ o: Outline; hex: string; z: number }> {
  switch (shape) {
    case 'neutral':
      return [{ o: stadium(0.42 * w, 0.1 * w), hex: LINE, z: 0 }];
    case 'flat':
      return [{ o: stadium(0.72 * w, 0.1 * w), hex: LINE, z: 0 }];
    case 'smile':
      return [{ o: arcBand(0, 0.45 * w, 0.72 * w, 0.21 * w, deg(205), deg(335)), hex: LINE, z: 0 }];
    case 'frown':
      return [{ o: arcBand(0, -0.66 * w, 0.72 * w, 0.21 * w, deg(30), deg(150)), hex: LINE, z: 0 }];
    case 'o':
      return [{ o: ellipse(0.25 * w, 0.32 * w, 9), hex: INSIDE, z: 0 }];
    case 'open':
      return [
        { o: ellipse(0.46 * w, 0.38 * w, 10), hex: INSIDE, z: 0 },
        { o: ellipse(0.28 * w, 0.12 * w, 8, 0, -0.2 * w), hex: TONGUE, z: 0.02 * w },
      ];
    case 'wavy': {
      const top: Outline = [];
      const bot: Outline = [];
      for (let i = 0; i <= 5; i++) {
        const x = (-0.66 + (1.32 * i) / 5) * w;
        const y = (i % 2 === 0 ? 0.08 : -0.08) * w;
        top.push([x, y + 0.095 * w]);
        bot.push([x, y - 0.095 * w]);
      }
      return [{ o: [...bot, ...top.reverse()], hex: LINE, z: 0 }];
    }
    case 'grin': {
      const d: Outline = [
        [-0.62 * w, 0.14 * w],
        [0.62 * w, 0.14 * w],
      ];
      for (let i = 1; i < 8; i++) {
        const a = -(i / 8) * Math.PI;
        d.push([Math.cos(a) * 0.62 * w, 0.14 * w + Math.sin(a) * 0.5 * w]);
      }
      return [
        { o: d, hex: INSIDE, z: 0 },
        {
          o: [
            [-0.5 * w, 0.02 * w],
            [0.5 * w, 0.02 * w],
            [0.52 * w, 0.13 * w],
            [-0.52 * w, 0.13 * w],
          ],
          hex: TEETH,
          z: 0.02 * w,
        },
      ];
    }
  }
}

/** Bends a flat feature around the head (sphere radius r) so its ends don't float. */
function wrap(g: THREE.BufferGeometry, r: number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, p.getZ(i) - (r - Math.sqrt(Math.max(0, r * r - x * x))));
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Eyes, brows and the requested mouth shapes, each on its own face bone. */
export function buildFace(ctx: BuildCtx, mouths: readonly MouthShape[]): void {
  const { L, parts } = ctx;
  const r = L.body.headR;
  const a = faceAnchors(r);
  const masked = L.faceFrontZ !== null;
  const hair = ctx.col('hair', '#4A3426');
  const browC = ctx.col(
    'brows',
    lightness(hair) > 0.4 ? mix(hair, '#6B635D', 0.55) : mix(hair, '#2A1E1A', 0.5),
  );
  const hero = ctx.lod === 'hero';
  // Recipe brow size (Obstinate's big frown brows): longer and thicker bars.
  const bs = ctx.recipe.face?.brows ?? 1;
  for (const [side, n] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const e = L.pos[`eye${n}`]!;
    const rot = masked ? ([0, 0, 0] as [number, number, number]) : surfaceRot(r, side * a.eye[0], a.eye[1]);
    // Only the front half of each dot shows (the back sits inside the head).
    const eye = clipTris(lowSphere(a.eyeR, hero ? 1 : 0), (_x, _y, z) => z > -a.eyeR * 0.2);
    parts.add(part(eye, EYE, { scale: [1, 1.2, 0.5], rot, pos: [e.x, e.y, e.z] }), `eye${n}`);
    if (hero) {
      const shine = clipTris(lowSphere(a.eyeR * 0.34, 0), (_x, _y, z) => z > -a.eyeR * 0.1);
      parts.add(
        part(shine, '#FFFFFF', { pos: [e.x - a.eyeR * 0.3, e.y + a.eyeR * 0.4, e.z + a.eyeR * 0.36] }),
        `eye${n}`,
      );
    }
    const b = L.pos[`brow${n}`]!;
    const br = masked ? ([0, 0, 0] as [number, number, number]) : surfaceRot(r, side * a.brow[0], a.brow[1]);
    parts.add(
      part(bevelBox(r * 0.3 * bs, r * 0.075 * bs, r * 0.07, r * 0.025 * Math.min(1, bs)), browC, {
        rot: [br[0], br[1], -side * 0.08],
        pos: [b.x, b.y, b.z],
      }),
      `brow${n}`,
    );
  }
  const m = L.pos.mouth_neutral!;
  const mrot = surfaceRot(r, 0, a.mouth[1]);
  const w = r * 0.25;
  for (const shape of mouths) {
    for (const piece of mouthPieces(shape, w)) {
      const g = wrap(slab(piece.o, r * 0.03), r);
      parts.add(
        part(g, piece.hex, { rot: mrot, pos: [m.x, m.y, m.z - r * 0.012 + piece.z] }),
        `mouth_${shape}`,
      );
    }
  }
}

// ------------------------------------------------------------------ runtime

const BLINK = 0.12;
const EASE = 0.05; // expression blend time constant (~0.15 s to settle)

/** Drives the face bones of one character: expression blending, blinking and the talking mouth flap. */
export class FaceRig {
  /** Head nod (radians about X) for the talking layer; the Character applies it on the head bone. */
  headNod = 0;
  private def: ExprDef;
  private expr: Expression;
  private readonly cur: { brow: number; browY: number; eye: number; lid: number };
  private readonly eyeL: THREE.Bone;
  private readonly eyeR: THREE.Bone;
  private readonly browL: THREE.Bone;
  private readonly browR: THREE.Bone;
  private readonly browRestY: number;
  private readonly mouthBones: THREE.Bone[];
  private readonly r: number;
  private readonly rng: Rng;
  private time = 0;
  private blinkWait: number;
  private blinkT = -1;
  private doublePending = false;
  private closed = false;
  private closedAmt = 0;
  private override: MouthShape | null = null;
  private talking = false;
  private talkAmt = 0;
  private flapOpen = false;
  private flapTimer = 0;
  private flapShape: MouthShape = 'open';
  private flapAmp = 1;
  private nod = 0;
  private shown: MouthShape;
  private pop = 1;

  constructor(bones: Record<string, THREE.Bone>, headR: number, rng: Rng, expression: Expression) {
    const need = (n: string): THREE.Bone => {
      const b = bones[n];
      if (!b) throw new Error(`FaceRig: missing bone "${n}"`);
      return b;
    };
    this.eyeL = need('eyeL');
    this.eyeR = need('eyeR');
    this.browL = need('browL');
    this.browR = need('browR');
    this.browRestY = this.browL.position.y;
    this.mouthBones = MOUTHS.map((m) => need(`mouth_${m}`));
    this.r = headR;
    this.rng = rng;
    this.expr = expression;
    this.def = EXPRESSION_DEFS[expression];
    this.cur = { brow: this.def.brow, browY: this.def.browY, eye: this.def.eye, lid: this.def.lid };
    this.shown = this.def.mouth;
    this.blinkWait = rng.range(0.5, 3);
    this.update(0);
  }

  get expression(): Expression {
    return this.expr;
  }

  setExpression(e: Expression): void {
    this.expr = e;
    this.def = EXPRESSION_DEFS[e] ?? EXPRESSION_DEFS.neutral;
  }

  setMouth(shape: MouthShape | null): void {
    this.override = shape;
  }

  setTalking(on: boolean): void {
    if (on && !this.talking) this.flapTimer = 0;
    this.talking = on;
  }

  setEyesClosed(closed: boolean): void {
    this.closed = closed;
  }

  update(dt: number): void {
    this.time += dt;
    const k = 1 - Math.exp(-dt / EASE);
    const d = this.def;
    const c = this.cur;
    c.brow += (d.brow - c.brow) * k;
    c.browY += (d.browY - c.browY) * k;
    c.eye += (d.eye - c.eye) * k;
    c.lid += (d.lid - c.lid) * k;
    this.updateBlink(dt);
    this.closedAmt += ((this.closed ? 1 : 0) - this.closedAmt) * (1 - Math.exp(-dt / 0.06));
    const blinkC = this.blinkT >= 0 ? 1 - Math.abs((this.blinkT / BLINK) * 2 - 1) : 0;
    const shut = Math.max(blinkC, this.closedAmt);
    const ey = c.eye * (c.lid + (0.1 - c.lid) * shut);
    this.eyeL.scale.set(c.eye, ey, c.eye);
    this.eyeR.scale.set(c.eye, ey, c.eye);
    const by = this.browRestY + (Math.min(BROW_LIFT_MAX, c.browY) - 0.025 * shut) * this.r;
    this.browL.position.y = by;
    this.browR.position.y = by;
    this.browL.rotation.z = c.brow;
    this.browR.rotation.z = -c.brow;
    this.updateMouth(dt);
  }

  private updateBlink(dt: number): void {
    if (this.closed || this.def.lid < 0.5) {
      this.blinkT = -1; // sleepy or eyes closed: no blinking
      return;
    }
    if (this.blinkT < 0) {
      this.blinkWait -= dt;
      if (this.blinkWait <= 0) this.blinkT = 0;
      return;
    }
    this.blinkT += dt;
    if (this.blinkT < BLINK) return;
    this.blinkT = -1;
    if (this.doublePending) {
      this.doublePending = false;
      this.blinkWait = this.rng.range(2, 5);
    } else if (this.rng.chance(0.2)) {
      this.doublePending = true;
      this.blinkWait = 0.07;
    } else {
      this.blinkWait = this.rng.range(2, 5);
    }
  }

  private updateMouth(dt: number): void {
    const rng = this.rng;
    if (this.talking) {
      this.flapTimer -= dt;
      if (this.flapTimer <= 0) {
        this.flapOpen = !this.flapOpen;
        const half = 1 / (2 * rng.range(8.5, 10.5));
        if (this.flapOpen) {
          this.flapShape = rng.chance(0.7) ? 'open' : 'o';
          this.flapAmp = rng.range(0.7, 1.1);
          this.flapTimer = half * rng.range(0.85, 1.15);
        } else {
          this.flapTimer = rng.chance(0.07) ? rng.range(0.1, 0.18) : half * rng.range(0.85, 1.15);
        }
      }
    } else {
      this.flapOpen = false;
    }
    this.talkAmt += ((this.talking ? 1 : 0) - this.talkAmt) * (1 - Math.exp(-dt / 0.12));
    this.nod += ((this.flapOpen ? -0.03 : 0.006) - this.nod) * (1 - Math.exp(-dt / 0.05));
    this.headNod = this.talkAmt * (this.nod + 0.018 * Math.sin(this.time * 14.5));

    const flapping = this.override === null && this.talking && this.flapOpen;
    const want = this.override ?? (flapping ? this.flapShape : this.def.mouth);
    if (want !== this.shown) {
      this.shown = want;
      this.pop = 0;
    }
    this.pop = Math.min(1, this.pop + dt / 0.09);
    const s = 0.72 + 0.28 * (1 - (1 - this.pop) * (1 - this.pop));
    const sy = flapping ? s * this.flapAmp : s;
    for (let i = 0; i < MOUTHS.length; i++) {
      const on = MOUTHS[i] === this.shown;
      this.mouthBones[i]!.scale.set(on ? s : 0, on ? sy : 0, on ? s : 0);
    }
  }
}
