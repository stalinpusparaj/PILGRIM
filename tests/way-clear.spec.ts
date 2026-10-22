import { expect, test } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';

/**
 * GDD 2.2 "The way is narrow" — but never shut: in every chapter a player-sized capsule can walk the whole main Way
 * from its start to its end. Each 0.5 m along the Way's centre line some point across its band (centre, then up to
 * ±1 m) must be free of colliders; a blocked stretch names the nearest landmark so a prop dropped on the road shows
 * at once. Story locks are skipped: gates the story carries Christian through, a stile he climbs, and the places
 * a script blocks until it is solved (the smoking pit Prayer clears, Doubting Castle's three locked doors).
 */

const CHAPTERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', 'epilogue'];
/** Landmarks the Way runs into on purpose (the story carries Christian through them, or he climbs them). */
const OPENED_BY_STORY = new Set(['wicket_gate', 'celestial_gate', 'meadow_stile']);
/** Trigger or zone ids whose area a script keeps shut until its puzzle is solved. */
const STORY_LOCKS: Record<string, readonly string[]> = {
  '9': ['ember_pit'],
  '11': ['cell_door', 'outer_door', 'iron_gate'],
};

interface Blocked {
  at: [number, number];
  landmark: string;
}

for (const chapter of CHAPTERS) {
  test(`the main Way of chapter ${chapter} is walkable end to end`, async ({ page }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    await page.goto(`/?chapter=${chapter}&skipIntro=1`);
    await waitForMode(page);
    await page.waitForFunction(() => (window as unknown as { __pilgrim: { play: unknown } }).__pilgrim.play != null, null, {
      timeout: 60_000,
    });
    await frames(page, 5);
    const locks = STORY_LOCKS[chapter] ?? [];
    const blocked = await page.evaluate((lockIds: readonly string[]): Blocked[] => {
      interface V { x: number; y: number; z: number }
      const play = (window as unknown as {
        __pilgrim: {
          play: {
            col: { overlaps(x: number, y: number, z: number, r: number, h: number, s?: number): boolean };
            world: {
              terrain: { heightAt(x: number, z: number): number };
              level: {
                landmarks: Array<{ id: string; at?: number[] }>;
                triggers: Array<{ id: string; at: number[]; r?: number; size?: number[] }>;
                zones: Array<{ id: string; x?: number; z?: number; r?: number }>;
              };
              ways: { main: { length: number; halfWidth: number; sample(t: number): V; tangent(t: number): V } };
            };
          };
        };
      }).__pilgrim.play;
      const way = play.world.ways.main;
      const lvl = play.world.level;
      const locked: Array<[number, number, number]> = [];
      for (const t of lvl.triggers)
        if (lockIds.includes(t.id)) locked.push([t.at[0]!, t.at[2]!, (t.r ?? Math.max(...(t.size ?? [4]))) + 1]);
      for (const z of lvl.zones)
        if (lockIds.includes(z.id) && z.x !== undefined && z.z !== undefined) locked.push([z.x, z.z, (z.r ?? 4) + 1]);
      const out: Blocked[] = [];
      const reach = Math.min(1, way.halfWidth - 0.35);
      const offsets = [0, reach / 2, -reach / 2, reach, -reach];
      for (let d = 1; d < way.length - 1; d += 0.5) {
        const t = d / way.length;
        const p = way.sample(t);
        if (locked.some(([x, z, r]) => Math.hypot(p.x - x, p.z - z) < r)) continue;
        const tg = way.tangent(t);
        const len = Math.hypot(tg.x, tg.z) || 1;
        const nx = -tg.z / len;
        const nz = tg.x / len;
        const free = offsets.some((o) => {
          const x = p.x + nx * o;
          const z = p.z + nz * o;
          return !play.col.overlaps(x, play.world.terrain.heightAt(x, z), z, 0.35, 1.5, 0.3);
        });
        if (free) continue;
        let landmark = '?';
        let best = Infinity;
        for (const l of play.world.level.landmarks) {
          if (!l.at) continue;
          const dist = Math.hypot(l.at[0]! - p.x, l.at[2]! - p.z);
          if (dist < best) [best, landmark] = [dist, l.id];
        }
        out.push({ at: [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10], landmark });
      }
      return out;
    }, locks);
    const unexpected = blocked.filter((b) => !OPENED_BY_STORY.has(b.landmark));
    expect(unexpected, JSON.stringify(unexpected)).toEqual([]);
    expect(problems, problems.join('\n')).toEqual([]);
  });
}
