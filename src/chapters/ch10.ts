/**
 * CHAPTER X — FAITHFUL AND VANITY FAIR (GDD 2.10).
 *
 * Beats, each in its own module:
 *  1. Faithful walks ahead; running past him trips a proud Christian, Faithful helps him up (ch10-pride.ts).
 *  2. Talkative cannot stop talking: piled-up bubbles, then the question that shows he only talks (ch10-talkative.ts).
 *  3. Evangelist warns them that one will go to the King first.
 *  4. Vanity Fair: stall-keepers, "Yes please" sacks that slow him, the staring crowd, "We buy the truth"
 *     (ch10-fair.ts).
 *  5-7. The arrest, the cage, the trial with its jury of twelve, night, and the chariot of light for Faithful
 *     (ch10-trial.ts, ch10-jury.ts, ch10-chariot.ts).
 *  8. The night sneak past lantern-carrying watchmen to the gate, where Hopeful joins (ch10-night.ts).
 *
 * Stage flags (a chapter reopened at a waystone picks up from them): 'ch10.faithfulJoined', 'ch10.talkativeDone',
 * 'ch10.arrested', 'ch10.escaped'. A chapter reopened mid-trial (arrested, not escaped) plays the fair again.
 */
import { FAITHFUL_BARKS, PrideTrip } from './ch10-pride';
import { TalkativeBeat } from './ch10-talkative';
import { Fair } from './ch10-fair';
import { NightSneak } from './ch10-night';
import { Trial } from './ch10-trial';
import type { ChapterContext, ChapterScript } from './types';

const HOPEFUL_BARKS = {
  idle: ['bark.ch10.hopeful.idle.1', 'bark.ch10.hopeful.idle.2'],
  cheer: ['bark.ch10.hopeful.cheer.1', 'bark.ch10.hopeful.cheer.2'],
  lowHope: ['bark.ch10.hopeful.lowHope.1'],
};

type Stage = 'road' | 'fair' | 'trial' | 'sneak' | 'free';

class Chapter10 {
  private stage: Stage = 'road';
  private ending = false;
  private readonly pride: PrideTrip;
  private readonly talkative: TalkativeBeat;
  private readonly fair: Fair;
  private readonly night: NightSneak;
  private readonly trial: Trial;

  constructor(private readonly ctx: ChapterContext) {
    this.pride = new PrideTrip(ctx, () => this.faithfulFollows());
    this.talkative = new TalkativeBeat(ctx);
    this.night = new NightSneak(ctx);
    this.fair = new Fair(ctx, () => void this.arrest());
    this.trial = new Trial(ctx, this.fair, this.night);
  }

  start(): void {
    const ctx = this.ctx;
    const s = ctx.state;
    const escaped = s.flag('ch10.escaped') === true;
    if (s.flag('ch10.arrested') === true && !escaped) s.setFlag('ch10.arrested', false);

    ctx.objective('ch10.objective.openRoad');
    ctx.music('pilgrim', 'calm');
    ctx.ambience('hills');

    this.night.start();
    this.trial.start();
    this.fair.start(escaped);
    this.talkative.start();
    this.pride.start();

    if (escaped) {
      this.stage = 'free';
      for (const id of ['faithful', 'talkative']) this.hide(id);
      ctx.addCompanion('hopeful', HOPEFUL_BARKS);
      ctx.objective('ch10.objective.pressOn');
    } else if (s.flag('ch10.faithfulJoined') === true) {
      this.faithfulFollows();
    }

    ctx.onTrigger('evangelist_warns', () => {
      void ctx.talk('ch10_evangelist_warn', { with: 'evangelist_brief' }).then(() => {
        if (this.stage === 'road') ctx.objective('ch10.objective.enterFair');
      });
    });
    ctx.onTrigger('fair_enter', () => {
      if (this.stage === 'road') this.stage = 'fair';
    });
    ctx.onTrigger('hopeful_joins', () => void this.hopefulJoins(), { once: false });
    ctx.onTrigger('ch10_end', () => this.end(), { once: false });
  }

  update(dt: number): void {
    this.pride.update(dt);
    this.fair.update(dt);
    this.trial.update(dt);
    this.night.update(dt);
  }

  private faithfulFollows(): void {
    if (this.ctx.state.flag('ch10.arrested') === true) return;
    this.ctx.addCompanion('faithful', FAITHFUL_BARKS);
  }

  private async arrest(): Promise<void> {
    if (this.stage === 'trial' || this.stage === 'sneak' || this.stage === 'free') return;
    this.stage = 'trial';
    await this.trial.run();
    if (!this.ctx.session.isDisposed) this.stage = 'sneak';
  }

  /** At the gate after the sneak: Hopeful, a young man of the fair moved by Faithful, joins. */
  private async hopefulJoins(): Promise<void> {
    const ctx = this.ctx;
    if (this.stage !== 'sneak') return;
    this.stage = 'free';
    this.night.escape();
    await ctx.talk('ch10_hopeful_join', { with: 'hopeful' });
    if (ctx.session.isDisposed) return;
    ctx.state.setFlag('ch10.escaped', true);
    ctx.addCompanion('hopeful', HOPEFUL_BARKS);
    ctx.state.meet('hopeful');
    ctx.music('pilgrim', 'calm');
    ctx.ambience('hills');
    ctx.objective('ch10.objective.pressOn');
  }

  private end(): void {
    if (this.ending || this.stage !== 'free') return;
    this.ending = true;
    this.ctx.complete();
  }

  private hide(id: string): void {
    const n = this.ctx.npc(id);
    if (n) n.character.root.visible = false;
  }
}

let running: Chapter10 | null = null;

const script: ChapterScript = {
  id: 'ch10',
  level: 'ch10',
  start(ctx: ChapterContext) {
    running = new Chapter10(ctx);
    running.start();
    ctx.own(() => {
      running = null;
    });
  },
  update(dt) {
    running?.update(dt);
  },
  dispose() {
    running = null;
  },
};

export default script;
