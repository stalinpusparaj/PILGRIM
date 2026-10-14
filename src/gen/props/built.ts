/**
 * Registry of man-made prop builders (GDD 2.12 "Prop builders"). Every builder takes (rng, palette, params) and
 * returns geometry at the origin, facing +Z, standing on y = 0, with colliders in local space and optional glow
 * geometry. Builders live in the built-*.ts files by theme; shared helpers are in built-kit.ts.
 */
import type { PropBuilder } from '../types';
import { buildArrow, buildBook, buildBoot, buildCoverRock, buildFarLight } from './built-chapter';
import {
  buildCastleRidge,
  buildMountainOverhang,
  buildTownGate,
  buildTownWall,
  buildVillageDoor,
} from './built-chapter-town';
import { buildGate, buildWicketGate } from './built-gates';
import { buildHouseA, buildHouseB, buildHouseC } from './built-houses';
import { buildCage, buildCandle, buildFlag, buildLamp, buildSign, buildStall } from './built-market';
import { buildArbour, buildCross, buildTomb, buildWaystone } from './built-sacred';
import { buildCastleTower, buildMountainPeak, buildPalaceTower } from './built-towers';
import { buildBridgePlank, buildFence, buildStile, buildWall } from './built-walls';
import { buildBarrel, buildBench, buildCart, buildCrate, buildWell } from './built-yard';

export const BUILT_PROPS: Record<string, PropBuilder> = {
  fence: buildFence,
  wall: buildWall,
  stile: buildStile,
  bridge_plank: buildBridgePlank,
  gate: buildGate,
  wicket_gate: buildWicketGate,
  house_a: buildHouseA,
  house_b: buildHouseB,
  house_c: buildHouseC,
  waystone: buildWaystone,
  arbour: buildArbour,
  cross: buildCross,
  tomb: buildTomb,
  stall: buildStall,
  cage: buildCage,
  flag: buildFlag,
  sign: buildSign,
  lamp: buildLamp,
  candle: buildCandle,
  well: buildWell,
  bench: buildBench,
  barrel: buildBarrel,
  crate: buildCrate,
  cart: buildCart,
  palace_tower: buildPalaceTower,
  castle_tower: buildCastleTower,
  mountain_peak: buildMountainPeak,
  // Phase 4 (Chapters I-IV): built-chapter.ts and built-chapter-town.ts.
  book: buildBook,
  far_light: buildFarLight,
  boot: buildBoot,
  cover_rock: buildCoverRock,
  arrow: buildArrow,
  town_wall: buildTownWall,
  town_gate: buildTownGate,
  village_door: buildVillageDoor,
  mountain_overhang: buildMountainOverhang,
  castle_ridge: buildCastleRidge,
};
