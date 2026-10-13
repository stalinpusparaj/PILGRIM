/**
 * A positional ambience emitter (town bell tower, frog pond, candle, river bank): the `spot` version of a bed
 * behind a PannerNode at a fixed world position, using the shared ctx.listener. It only runs while the
 * listener is within reach (with hysteresis), so a level full of emitters costs nothing while they are far away.
 */
import type { Rng } from '../gen/rng';
import { Bed } from './amb-bed';
import type { AmbHost, BedDef } from './amb-types';
import type { AmbienceId } from './types';

const FADE_IN = 1.2;
const FADE_OUT = 1.5;
/** Stops at reach * this (starts at reach), so walking along the edge does not flap. */
export const EMITTER_HYSTERESIS = 1.15;

export class Emitter {
  readonly reach: number;
  private readonly panner: PannerNode;
  private bed: Bed | null = null;
  private readonly dying = new Set<Bed>();
  private serial = 0;
  private disposed = false;

  constructor(
    private readonly host: AmbHost,
    readonly id: AmbienceId,
    private readonly def: BedDef,
    readonly x: number,
    readonly y: number,
    readonly z: number,
    private readonly rng: Rng,
    dest: AudioNode,
    hrtf: boolean,
  ) {
    this.reach = def.reach;
    const p = host.ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = def.ref;
    p.maxDistance = def.reach * 2;
    p.rolloffFactor = 1;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
    p.connect(dest);
    this.panner = p;
  }

  get liveShots(): number {
    let n = this.bed?.liveShots ?? 0;
    for (const b of this.dying) n += b.liveShots;
    return n;
  }

  get active(): boolean {
    return this.bed !== null;
  }

  /** Still sounding (active or fading out). */
  get busy(): boolean {
    return this.bed !== null || this.dying.size > 0;
  }

  dist2(lx: number, ly: number, lz: number): number {
    const dx = this.x - lx;
    const dy = this.y - ly;
    const dz = this.z - lz;
    return dx * dx + dy * dy + dz * dz;
  }

  activate(t: number): void {
    if (this.bed || this.disposed) return;
    const bed = new Bed(this.host, this.def, this.rng.fork(++this.serial), this.panner, true);
    bed.start(t, FADE_IN);
    this.bed = bed;
  }

  deactivate(t: number): void {
    const bed = this.bed;
    if (!bed) return;
    bed.fadeOut(t, FADE_OUT);
    this.dying.add(bed);
    this.bed = null;
  }

  tick(now: number, until: number): void {
    this.bed?.tick(now, until);
    for (const b of this.dying) {
      if (now < b.deadAt) continue;
      b.dispose();
      this.dying.delete(b);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bed?.dispose();
    this.bed = null;
    for (const b of this.dying) b.dispose();
    this.dying.clear();
    this.panner.disconnect();
  }
}
