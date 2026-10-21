/**
 * CHAPTER V — THE INTERPRETER'S HOUSE (GDD 2.10).
 *
 * Six rooms, each a toy-puzzle with a short lesson that pays off in a later chapter
 * (GDD 2.10, Room → Pay-off mapping).  The Interpreter accompanies Christian room to
 * room.  After all six rooms a final word sends him on toward the Cross.
 *
 * Positions come from the level file: landmark 'house_door', the per-room triggers
 * 'room1_look' … 'room6_look', and the exit trigger 'ch05_end'.
 */
import type { ChapterContext, ChapterScript } from './types';

// ─── constants ───────────────────────────────────────────────────────────────

const ROOM_COUNT = 6;

const ROOM: {
  trigger: string;
  graph: string;
  objective: string;
  doneFlag: string;
}[] = [
  {
    trigger: 'room1_look',
    graph: 'ch05_room1',
    objective: 'ch05.objective.room1',
    doneFlag: 'ch05.room1Done',
  },
  {
    trigger: 'room2_look',
    graph: 'ch05_room2',
    objective: 'ch05.objective.room2',
    doneFlag: 'ch05.room2Done',
  },
  {
    trigger: 'room3_look',
    graph: 'ch05_room3',
    objective: 'ch05.objective.room3',
    doneFlag: 'ch05.room3Done',
  },
  {
    trigger: 'room4_look',
    graph: 'ch05_room4',
    objective: 'ch05.objective.room4',
    doneFlag: 'ch05.room4Done',
  },
  {
    trigger: 'room5_look',
    graph: 'ch05_room5',
    objective: 'ch05.objective.room5',
    doneFlag: 'ch05.room5Done',
  },
  {
    trigger: 'room6_look',
    graph: 'ch05_room6',
    objective: 'ch05.objective.room6',
    doneFlag: 'ch05.room6Done',
  },
];

// ─── chapter class ────────────────────────────────────────────────────────────

class Chapter5 {
  private ending = false;
  private roomsVisited = 0;

  constructor(private readonly ctx: ChapterContext) {}

  start(): void {
    const ctx = this.ctx;

    // Restore progress (waystone reload)
    this.roomsVisited = 0;
    for (const r of ROOM) {
      if (ctx.state.flag(r.doneFlag) === true) this.roomsVisited++;
    }

    ctx.objective('ch05.objective.enterHouse');
    ctx.music('interpreter', 'calm');
    ctx.ambience('candle');

    ctx.onTrigger('house_arrive', () => {
      ctx.objective('ch05.objective.rooms');
      ctx.guide({ npc: 'interpreter' });
      void ctx.talk('ch05_interpreter_welcome', { with: 'interpreter' });
    });

    for (const room of ROOM) {
      ctx.onTrigger(
        room.trigger,
        () => void this.visitRoom(room),
        { once: false },
      );
    }

    ctx.onTrigger('ch05_end', () => void this.end(), { once: false });
  }

  private async visitRoom(room: {
    trigger: string;
    graph: string;
    objective: string;
    doneFlag: string;
  }): Promise<void> {
    if (this.ctx.state.flag(room.doneFlag) === true) return;
    this.ctx.objective(room.objective);
    await this.ctx.talk(room.graph, { with: 'interpreter' });
    this.ctx.state.setFlag(room.doneFlag, true);
    this.roomsVisited++;
    if (this.roomsVisited === ROOM_COUNT - 1) {
      this.ctx.objective('ch05.objective.lastRoom');
    }
  }

  private async end(): Promise<void> {
    if (this.ending) return;
    if (this.roomsVisited < ROOM_COUNT) {
      this.ctx.toast('ch05.toast.seeAllRooms');
      return;
    }
    this.ending = true;
    const ctx = this.ctx;
    ctx.objective(null);
    ctx.guide(null);
    await ctx.talk('ch05_interpreter_farewell', { with: 'interpreter' });
    ctx.complete();
  }
}

// ─── script export ────────────────────────────────────────────────────────────

let running: Chapter5 | null = null;

const script: ChapterScript = {
  id: 'ch05',
  level: 'ch05',
  start(ctx) {
    running = new Chapter5(ctx);
    running.start();
  },
  dispose() {
    running = null;
  },
};

export default script;
