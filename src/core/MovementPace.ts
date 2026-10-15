export type MovementPace = 'slow' | 'normal' | 'fast';
/** Fast preserves the responsive tuning; Normal and Slow offer gentler exploration. */
export const MOVEMENT_PACE: Readonly<Record<MovementPace, number>> = Object.freeze({
  slow: 2 / 3,
  normal: 0.8,
  fast: 1,
});
export function movementPaceScale(pace: MovementPace | undefined): number {
  return MOVEMENT_PACE[pace ?? 'normal'] ?? MOVEMENT_PACE.normal;
}
