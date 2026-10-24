/**
 * IMA ADPCM, 4 bits per sample (mono), for baked phone music kept on the device (music-bake.ts, DECISIONS #393):
 * 4x smaller than 16-bit PCM, decoded in a few milliseconds. Our own code, the textbook algorithm.
 */
const STEPS = new Int32Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
  118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
]);
const INDEX = new Int32Array([-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]);

/** Encodes samples in [-1, 1] to 4-bit codes, two per byte (low nibble first). */
export function adpcmEncode(x: Float32Array): Uint8Array {
  const out = new Uint8Array((x.length + 1) >> 1);
  let pred = 0;
  let idx = 0;
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-32768, Math.min(32767, Math.round(x[i]! * 32767)));
    const step = STEPS[idx]!;
    let diff = s - pred;
    let code = 0;
    if (diff < 0) {
      code = 8;
      diff = -diff;
    }
    let delta = step >> 3;
    if (diff >= step) { code |= 4; diff -= step; delta += step; } // prettier-ignore
    if (diff >= step >> 1) { code |= 2; diff -= step >> 1; delta += step >> 1; } // prettier-ignore
    if (diff >= step >> 2) { code |= 1; delta += step >> 2; } // prettier-ignore
    pred = code & 8 ? Math.max(-32768, pred - delta) : Math.min(32767, pred + delta);
    idx = Math.max(0, Math.min(88, idx + INDEX[code]!));
    out[i >> 1]! |= i & 1 ? code << 4 : code;
  }
  return out;
}

/** Decodes `length` samples from 4-bit codes into [-1, 1]. */
export function adpcmDecode(codes: Uint8Array, length: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  let pred = 0;
  let idx = 0;
  for (let i = 0; i < length; i++) {
    const code = (codes[i >> 1]! >> (i & 1 ? 4 : 0)) & 15;
    const step = STEPS[idx]!;
    let delta = step >> 3;
    if (code & 4) delta += step;
    if (code & 2) delta += step >> 1;
    if (code & 1) delta += step >> 2;
    pred = code & 8 ? Math.max(-32768, pred - delta) : Math.min(32767, pred + delta);
    idx = Math.max(0, Math.min(88, idx + INDEX[code]!));
    out[i] = pred / 32767;
  }
  return out;
}
