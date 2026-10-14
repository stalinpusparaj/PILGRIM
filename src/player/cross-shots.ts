/**
 * The Cross's camera shots (GDD 2.5: eased moves, toy-diorama framing), as goal positions, look-at points and fields
 * of view that CrossCamera eases to (on a rail round Christian) and tracks:
 * - kneel:  from the side away from the tomb and a little behind him, looking ahead and up past him: Christian
 *           kneeling with the sack on his back at the foot of the cross he faces (both in frame; on narrow screens
 *           the camera goes further behind him so they line up in depth instead of across the screen);
 * - chase:  over his shoulder from the side away from the tomb, so he and the tomb line up in depth. The camera
 *           stays there (it never flies past him): the view follows the burden tumbling away (on a narrow screen
 *           it stays on him while the sack rolls off behind him) and settles on the tomb's mouth with a slow push
 *           in (a narrower field of view) as it gets there;
 * - return: in front of Christian and out to the side, clear of the cross, the full field of view again, for the
 *           stretch and the leap of joy.
 */
import * as THREE from 'three';
import type { SackRoll } from './cross-roll';
import type { TombInfo } from './cross-path';
import { smoothstep } from './cross-types';

export type Shot = 'none' | 'kneel' | 'chase' | 'return';

const UP = new THREE.Vector3(0, 1, 0);
/** Wide (16:9) and narrow (portrait phone) framings; aspects in between are mixed. */
const KNEEL_WIDE = { back: 0.4, side: 4.2, up: 1.3, ahead: 1.2, look: 1.7 } as const;
const KNEEL_NARROW = { back: 3.6, side: 0.45, up: 1.2, ahead: 2.0, look: 1.8 } as const;
/** Watching it go: back from him (away from the tomb), out to the kneel shot's side, raised. */
const WATCH_WIDE = { back: 2.2, side: 2.2, up: 1.8 } as const;
/** Narrow: high (the line down to the tomb passes over his head) and inside the 2.6 m to the cross he faces. */
const WATCH_NARROW = { back: 1.8, side: 0.6, up: 3.2 } as const;
const WATCH_CHEST = 0.85;
const ASPECT = { narrow: 0.6, wide: 1.5 } as const;
/** In front of him, out to the side, clear of the cross he faces (it stands about 2.6 m ahead). */
const RETURN = { ahead: 2.4, side: 2.3, up: 1.5, look: 1.05 } as const;
/** The push in: the view fits `fit` m of height and `fitWide` m of width round the tomb's mouth (`look` m up),
 *  never wider than the start. */
const TOMB_VIEW = { look: 0.4, fit: 4.5, fitWide: 4, minFov: 20 } as const;

export class CrossShots {
  /** Live goals (CrossCamera keeps tracking these). */
  readonly pos = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  /** Vertical field of view (degrees) for the shot. */
  fov = 55;
  /** The camera's field of view when the scene began (wide shots use it). */
  baseFov = 55;
  /** +1: the camera works on the player's right, -1: left (always the side away from the tomb). */
  side = 1;
  /** Width / height of the view (the kneel shot frames Christian and the cross for it). */
  aspect = 16 / 9;
  private readonly f = new THREE.Vector3(0, 0, 1);
  private readonly r = new THREE.Vector3(-1, 0, 0);
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  /** Horizontal direction from Christian to the tomb (the over-the-shoulder shot looks along it). */
  private readonly w = new THREE.Vector3(0, 0, 1);

  /** Player frame from his facing; picks the side the tomb is on. */
  setFrame(forward: THREE.Vector3, feet: THREE.Vector3, tomb: THREE.Vector3 | null): void {
    this.f.copy(forward).setY(0);
    if (this.f.lengthSq() < 1e-6) this.f.set(0, 0, 1);
    this.f.normalize();
    this.r.set(-this.f.z, 0, this.f.x);
    if (tomb) {
      this.side = this.r.dot(this.a.copy(tomb).sub(feet)) >= 0 ? -1 : 1;
      this.w.copy(tomb).sub(feet).setY(0);
      if (this.w.lengthSq() < 1e-6) this.w.copy(this.f);
      this.w.normalize();
    }
  }

  /** Unit facing used for the shots (and where the sack lands: behind it). */
  get forward(): THREE.Vector3 {
    return this.f;
  }

  /** A portrait screen: the over-the-shoulder shot starts early, during the rope snaps (CrossDrop). */
  get narrow(): boolean {
    return this.wide < 0.5;
  }

  /** 0 on a portrait phone, 1 on a wide screen. */
  private get wide(): number {
    return smoothstep(ASPECT.narrow, ASPECT.wide, Number.isFinite(this.aspect) ? this.aspect : 16 / 9);
  }

  update(shot: Shot, feet: THREE.Vector3, roll: SackRoll | null, tomb: TombInfo | null): void {
    const s = this.side;
    const k = this.wide;
    const mix = (narrow: number, wide: number): number => narrow + (wide - narrow) * k;
    this.fov = this.baseFov;
    if (shot === 'kneel') {
      const N = KNEEL_NARROW;
      const W = KNEEL_WIDE;
      this.pos
        .copy(feet)
        .addScaledVector(this.f, -mix(N.back, W.back))
        .addScaledVector(this.r, mix(N.side, W.side) * s)
        .addScaledVector(UP, mix(N.up, W.up));
      this.look
        .copy(feet)
        .addScaledVector(UP, mix(N.look, W.look))
        .addScaledVector(this.f, mix(N.ahead, W.ahead));
    } else if (shot === 'return') {
      this.pos
        .copy(feet)
        .addScaledVector(this.f, RETURN.ahead)
        .addScaledVector(this.r, RETURN.side * s)
        .addScaledVector(UP, RETURN.up);
      this.look.copy(feet).addScaledVector(UP, RETURN.look);
    } else if (shot === 'chase' && tomb) {
      const onPath = !roll || roll.phase === 'path' || roll.phase === 'fall';
      const q = roll ? (onPath ? roll.progress : 1) : 0;
      const N = WATCH_NARROW;
      const W = WATCH_WIDE;
      this.pos
        .copy(feet)
        .addScaledVector(this.w, -mix(N.back, W.back))
        .addScaledVector(this.r, mix(N.side, W.side) * s)
        .addScaledVector(UP, mix(N.up, W.up));
      // Between him and the sack at first (on a narrow screen at him: the sack rolls away behind him, in line with
      // the tomb), then into the tomb's mouth.
      const sack = 0.6 * k;
      this.a
        .copy(feet)
        .addScaledVector(UP, WATCH_CHEST)
        .lerp(roll?.pos ?? this.a, roll ? sack + (1 - sack) * smoothstep(0, 0.3, q) : 0);
      this.b.copy(tomb.mouth).addScaledVector(UP, TOMB_VIEW.look);
      const toTomb = smoothstep(0.45, 1, q);
      this.look.lerpVectors(this.a, this.b, toTomb);
      const dist = Math.max(1, this.pos.distanceTo(this.b));
      const aspect = Number.isFinite(this.aspect) && this.aspect > 0.1 ? this.aspect : 16 / 9;
      const fitH = Math.atan(TOMB_VIEW.fit / 2 / dist);
      const fitW = Math.atan(TOMB_VIEW.fitWide / 2 / (dist * aspect));
      const fit = THREE.MathUtils.radToDeg(2 * Math.max(fitH, fitW));
      const tombFov = Math.min(this.baseFov, Math.max(TOMB_VIEW.minFov, fit));
      this.fov = this.baseFov + (tombFov - this.baseFov) * toTomb;
    }
  }
}
