/**
 * Ambience recipes, one per AmbienceId (GDD 2.13 "Ambience per zone, positional where useful"). Each bed sits
 * at about -30..-24 dBFS RMS on the ambience bus before the player's volume, with soft events on top, so it
 * never competes with dialogue or music. Recipes live in amb-beds-places.ts and amb-beds-nature.ts.
 */
import type { AmbienceId } from './types';
import type { BedDef } from './amb-types';
import { candle, dungeon, fair, town, valley } from './amb-beds-places';
import { birdsong, bog, hills, meadow, night, rain, river, wind } from './amb-beds-nature';

export const BEDS: Readonly<Record<AmbienceId, BedDef>> = {
  town,
  bog,
  hills,
  wind,
  candle,
  fair,
  river,
  birdsong,
  rain,
  valley,
  night,
  dungeon,
  meadow,
};

/** True for a known AmbienceId (guards data that came from JSON). */
export function isAmbienceId(v: unknown): v is AmbienceId {
  return typeof v === 'string' && Object.hasOwn(BEDS, v);
}
