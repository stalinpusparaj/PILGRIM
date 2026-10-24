/**
 * Touch phones and tablets (DECISIONS #390). Budget phones run the 3D world and Web Audio on a tight CPU, so the
 * audio gets more breathing room there: a bigger output buffer, a longer scheduling look-ahead (a busy frame
 * no longer makes notes late, which were dropped and heard as stutters), a shorter reverb and fewer voices.
 */
export const LOW_POWER_AUDIO: boolean =
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
