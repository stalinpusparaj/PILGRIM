/**
 * Keeps the shared AudioListener (SFX panners, babble, ambience emitters) on the camera. Called once per frame,
 * so it allocates nothing and skips the AudioParam writes when the camera did not move.
 */

export class ListenerSync {
  /** Last written position (x, y, z), forward (x, y, z) and up (x, y, z). */
  private readonly last = new Float64Array(9).fill(Number.NaN);
  /** AudioListener has positionX & co (Firefox only has setPosition / setOrientation). */
  private readonly params: boolean;

  constructor(private readonly listener: AudioListener) {
    this.params = 'positionX' in listener && listener.positionX instanceof AudioParam;
  }

  get x(): number {
    return this.last[0] ?? 0;
  }
  get y(): number {
    return this.last[1] ?? 0;
  }
  get z(): number {
    return this.last[2] ?? 0;
  }

  /** Moves the listener to a camera world matrix (column-major, three.js Matrix4.elements). True if it moved. */
  update(e: ArrayLike<number>): boolean {
    const px = e[12] ?? 0;
    const py = e[13] ?? 0;
    const pz = e[14] ?? 0;
    // The camera looks down its local -Z; its up is local +Y.
    let fx = -(e[8] ?? 0);
    let fy = -(e[9] ?? 0);
    let fz = -(e[10] ?? 1);
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    let ux = e[4] ?? 0;
    let uy = e[5] ?? 1;
    let uz = e[6] ?? 0;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const l = this.last;
    const same =
      l[0] === px && l[1] === py && l[2] === pz && l[3] === fx && l[4] === fy && l[5] === fz && l[6] === ux;
    if (same && l[7] === uy && l[8] === uz) return false;
    l[0] = px;
    l[1] = py;
    l[2] = pz;
    l[3] = fx;
    l[4] = fy;
    l[5] = fz;
    l[6] = ux;
    l[7] = uy;
    l[8] = uz;
    const L = this.listener;
    if (this.params) {
      L.positionX.value = px;
      L.positionY.value = py;
      L.positionZ.value = pz;
      L.forwardX.value = fx;
      L.forwardY.value = fy;
      L.forwardZ.value = fz;
      L.upX.value = ux;
      L.upY.value = uy;
      L.upZ.value = uz;
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    return true;
  }
}
