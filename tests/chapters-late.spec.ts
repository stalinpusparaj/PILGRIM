import { expect, test, type Page } from '@playwright/test';
import { frames, waitForMode, watchConsole } from './support';
import { logged, waitSim } from './play-support';

/**
 * CHAPTERS V–XIII and the EPILOGUE played through by script on `/?chapter=N&skipIntro=1`: Christian is stood on
 * every story trigger in Way order, every conversation is answered (first choice) and skipped through, and each
 * chapter's own key action is done (the Interpreter's six room puzzles, kneel at the Cross, reach for the sword in Apollyon's Phase 3, pray at the
 * smoking pit, the Key of Promise on Doubting Castle's three locks, show the Roll at the Gate). Each chapter must reach
 * 'chapter:complete' with a clean console: no missing dialogue, text key, recipe or trigger.
 */

type Step =
  | string // stand on this level trigger
  | { use: string } // the named interactable's onUse (as if [E] was pressed beside it)
  | { key: string } // a key press (Q = pray)
  | { door: string } // west of this Ch XI lock: the Satchel's Key of Promise "Use"
  | { roll: true } // the Roll in hand (a chapter started on its own has none yet)
  | { flag: string } // wait until this GameState flag is true
  | { apollyon: 'fall' }; // once the fight runs, skip it to Phase 3 (the fight itself: tests/combat.spec.ts)

const PLAN: Array<{ n: string; chapter: number; steps: Step[] }> = [
  {
    n: '5',
    chapter: 5,
    steps: [
      'house_arrive',
      'room1_look',
      { use: 'room1_lamp_0' },
      { use: 'room1_lamp_1' },
      { use: 'room1_lamp_2' },
      'room2_look',
      { use: 'room2_sweep' },
      { use: 'room2_jug' },
      'room3_look',
      'room4_look',
      { use: 'room4_oil' },
      'room5_look',
      { use: 'room5_name' },
      { key: 'Escape' }, // no name for the scribe this time (tests/ch05.spec.ts writes one)
      'room6_look',
      { use: 'room6_open' },
      'ch05_end',
    ],
  },
  {
    n: '6',
    chapter: 6,
    steps: [
      'hill_base',
      'cross_near',
      { use: 'cross_kneel' },
      { flag: 'ch06.crossDone' },
      'sleepers_near',
      { use: 'talk:simple' },
      'wall_jumpers',
      'ch06_end',
    ],
  },
  {
    n: '7',
    chapter: 7,
    steps: [
      { roll: true },
      'spring_arrive',
      { use: 'spring_drink' },
      'detour_warning',
      'timorous_run',
      'arbour_reach',
      { use: 'arbour_sit' },
      { flag: 'rollLost' },
      { use: 'roll_find' },
      'lion_zone',
      'palace_enter',
      'armoury_trigger',
      { flag: 'ch07.armouryDone' },
      'roof_arrive',
      'ch07_end',
    ],
  },
  {
    n: '8',
    chapter: 8,
    steps: [
      'sisters_farewell',
      'apollyon_approach',
      { apollyon: 'fall' },
      { use: 'reach_sword' },
      { flag: 'ch08.fightDone' },
      'ch08_end',
    ],
  },
  {
    n: '9',
    chapter: 9,
    steps: [
      'valley_enter',
      'two_men_warn',
      'whisper_zone_1',
      'whisper_zone_2',
      'ember_pit_near',
      { key: 'KeyQ' },
      { flag: 'ch09.pitDone' },
      'whisper_zone_3',
      'voice_ahead',
      'whisper_zone_4',
      'dawn_breaks',
      'trap_section',
      'ch09_end',
    ],
  },
  {
    n: '10',
    chapter: 10,
    steps: [
      'faithful_seen',
      'faithful_joins',
      { flag: 'ch10.faithfulJoined' },
      'talkative_meets',
      { flag: 'ch10.talkativeDone' },
      'evangelist_warns',
      'fair_enter',
      'buy_truth',
      { flag: 'ch10.faithfulGone' },
      'hopeful_joins',
      { flag: 'ch10.escaped' },
      'ch10_end',
    ],
  },
  {
    n: '11',
    chapter: 11,
    steps: [
      'by_ends_meet',
      'demas_wave',
      'pillar_salt',
      'river_reach',
      'stile_cross',
      'storm_trigger',
      'shelter_reach',
      { flag: 'ch11.carried' },
      'dungeon_door',
      { door: 'cell_door' },
      { door: 'outer_door' },
      { door: 'iron_gate' },
      { use: 'iron_gate_push' },
      { flag: 'ch11.dungeonDone' },
      'escape_trigger',
      { use: 'warning_sign' },
      'ch11_end',
    ],
  },
  {
    n: '12',
    chapter: 12,
    steps: [
      'shepherds_meet',
      'viewpoint_reach',
      { use: 'looking_glass_use' },
      { flag: 'ch12.glassDone' }, // the glass settles by itself (tests/ch12.spec.ts holds Pray)
      'ignorance_meets',
      'fork_flatterer',
      'fork_correct',
      'atheist_near',
      'enchanted_warning',
      'ch12_end',
    ],
  },
  {
    n: '13',
    chapter: 13,
    steps: [
      { roll: true },
      'beulah_walk',
      'river_reach',
      'river_wade',
      'far_bank',
      'gate_near',
      'ch13_end',
      { use: 'show_roll_gate' },
    ],
  },
  { n: 'epilogue', chapter: 14, steps: ['christiana_start', 'secret_arrives', 'far_light_view_trig'] },
];

interface Win {
  __log: Array<{ name: string; payload: unknown }>;
  __pilgrim: {
    events: { on(name: string, fn: (p: unknown) => void): () => void; emit(name: string, p?: unknown): void };
    services: { tryGet(key: string): unknown; get(key: string): unknown };
    play: {
      teleport(x: number, z: number, facing?: number): void;
      state: { flag(k: string): unknown; giveRoll(): void; hasRoll: boolean };
      world: { level: { triggers: Array<{ id: string; at: [number, number, number] }> } };
    } | null;
  };
}
interface Runner {
  active: boolean;
  phase: string;
  choose(i: number): void;
  skipScene(): void;
}
interface Thing {
  onUse(): void;
}

/** Answers (first choice) and skips every conversation until none runs for a moment. */
async function settle(page: Page): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 400 && quiet < 4; i++) {
    const busy = await page.evaluate(() => {
      const r = (window as unknown as Win).__pilgrim.services.tryGet('dialogue') as Runner | undefined;
      if (!r?.active) return false;
      if (r.phase === 'choosing') r.choose(0);
      else r.skipScene();
      return true;
    });
    quiet = busy ? 0 : quiet + 1;
    await page.waitForTimeout(120);
  }
}

async function step(page: Page, s: Step): Promise<void> {
  if (typeof s === 'string') {
    await page.evaluate((id) => {
      const play = (window as unknown as Win).__pilgrim.play!;
      const t = play.world.level.triggers.find((x) => x.id === id);
      if (!t) throw new Error(`no trigger ${id}`);
      play.teleport(t.at[0], t.at[2], Math.PI / 2);
    }, s);
    await waitSim(page, 0.5);
    await expect
      .poll(() => logged(page, 'trigger:enter'), { timeout: 8000 })
      .toContainEqual(expect.objectContaining({ id: s }));
  } else if ('use' in s) {
    const id = s.use;
    const has = (k: string): Promise<boolean> =>
      page.evaluate((key) => {
        const inter = (window as unknown as Win).__pilgrim.services.get('interactables') as {
          get(id: string): Thing | null;
        };
        return inter.get(key) != null;
      }, k);
    await expect.poll(() => has(id), { timeout: 20_000, message: `interactable ${id}` }).toBe(true);
    await page.evaluate((key) => {
      const inter = (window as unknown as Win).__pilgrim.services.get('interactables') as {
        get(id: string): Thing | null;
      };
      inter.get(key)!.onUse();
    }, id);
  } else if ('key' in s) {
    await page.keyboard.press(s.key);
  } else if ('door' in s) {
    await page.evaluate((id) => {
      const play = (window as unknown as Win).__pilgrim.play!;
      const t = play.world.level.triggers.find((x) => x.id === id)!;
      play.teleport(t.at[0] - 1.5, t.at[2], Math.PI / 2);
    }, s.door);
    await waitSim(page, 0.4);
    const canUse = await page.evaluate(() => {
      const m = (window as unknown as Win).__pilgrim.services.get('chapters') as {
        context: { canUseItem(id: string): boolean } | null;
      };
      return m.context?.canUseItem('key_promise') ?? false;
    });
    expect(canUse, `Use on the Key at ${s.door}`).toBe(true);
    await page.evaluate(() =>
      (window as unknown as Win).__pilgrim.events.emit('satchel:use', { id: 'key_promise' }),
    );
  } else if ('apollyon' in s) {
    const phase = s.apollyon;
    await expect
      .poll(
        async () => {
          await settle(page);
          return page.evaluate(() => (window as unknown as Win).__pilgrim.services.tryGet('apollyon') != null);
        },
        { timeout: 30_000, message: 'the Apollyon fight starts' },
      )
      .toBe(true);
    await page.evaluate((p) => {
      const f = (window as unknown as Win).__pilgrim.services.get('apollyon') as { skipTo(p: string): void };
      f.skipTo(p);
    }, phase);
  } else if ('roll' in s) {
    await page.evaluate(() => (window as unknown as Win).__pilgrim.play!.state.giveRoll());
  } else {
    const key = s.flag;
    await expect
      .poll(
        async () => {
          await settle(page);
          return page.evaluate((k) => (window as unknown as Win).__pilgrim.play!.state.flag(k), key);
        },
        { timeout: 60_000 },
      )
      .toBe(true);
  }
  await settle(page);
}

for (const plan of PLAN) {
  test(`chapter ${plan.n} plays through to its end with a clean console`, async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await page.goto(`/?chapter=${plan.n}&skipIntro=1`);
    await waitForMode(page);
    await page.waitForFunction(() => (window as unknown as Win).__pilgrim.play != null, null, {
      timeout: 30_000,
    });
    await page.evaluate(() => {
      const w = window as unknown as Win;
      w.__log = [];
      for (const name of ['trigger:enter', 'chapter:complete'])
        w.__pilgrim.events.on(name, (payload) => w.__log.push({ name, payload }));
    });
    await page.addStyleTag({ content: '.pg-click-to-play { display: none !important; }' });
    await frames(page, 20);
    for (const s of plan.steps) await step(page, s);
    await expect
      .poll(
        async () => {
          await settle(page);
          return logged(page, 'chapter:complete');
        },
        { timeout: 30_000 },
      )
      .toContainEqual({ chapter: plan.chapter });
    expect(problems, problems.join('\n')).toEqual([]);
  });
}
