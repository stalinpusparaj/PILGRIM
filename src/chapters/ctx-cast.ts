/**
 * The chapter's cast: every `level.npcs` entry with a built Character wrapped as an NPC (src/npc/NPC.ts), except
 * 'christian' (the player is Christian), and the companions made from them (src/npc/Companion.ts). The cast owns
 * the wrappers: each fixed step / frame it updates and renders every NPC that is not a companion; a Companion
 * updates, renders and disposes its own NPC (src/npc/Companion.ts). Removing a companion therefore gives the id
 * a fresh NPC wrapper. dispose() frees companions, then the other NPCs; the Characters belong to the World.
 * Allocation-free per step.
 */
import { Companion, type BarkSet } from '../npc/Companion';
import { NPC } from '../npc/NPC';
import { PLAYER_SPEAKER } from '../narrative/dialogue-rules';
import type { PlaySession } from '../world/PlaySession';

export class ChapterCast {
  private readonly byId = new Map<string, NPC>();
  private readonly list: NPC[] = [];
  private readonly followers: Companion[] = [];
  /** NPCs a companion drives (and disposes). */
  private readonly led = new Set<NPC>();
  private disposed = false;

  constructor(private readonly session: PlaySession) {
    for (const def of session.world.level.npcs) {
      if (def.id === PLAYER_SPEAKER || this.byId.has(def.id)) continue;
      const character = session.world.npcs.get(def.id);
      if (!character) continue;
      this.wrap(def.id);
    }
  }

  get npcs(): readonly NPC[] {
    return this.list;
  }

  get companions(): readonly Companion[] {
    return this.followers;
  }

  npc(id: string): NPC | null {
    return this.byId.get(id) ?? null;
  }

  addCompanion(npcId: string, barks?: BarkSet): Companion {
    const have = this.followers.find((c) => c.npc.id === npcId);
    if (have) return have;
    const npc = this.byId.get(npcId);
    if (!npc || this.disposed) throw new Error(`[chapter] there is no NPC "${npcId}" to follow the player`);
    const side = this.followers.length % 2 === 0 ? 'left' : 'right';
    const companion = new Companion({ npc, session: this.session, barks, side });
    this.followers.push(companion);
    this.led.add(npc);
    return companion;
  }

  removeCompanion(npcId: string): void {
    const i = this.followers.findIndex((c) => c.npc.id === npcId);
    if (i < 0) return;
    const companion = this.followers.splice(i, 1)[0]!;
    const npc = companion.npc;
    companion.dispose(); // disposes its NPC too
    this.led.delete(npc);
    const at = this.list.indexOf(npc);
    if (at >= 0) this.list.splice(at, 1);
    this.byId.delete(npcId);
    // A fresh wrapper where the companion stopped (the Character never moved away from it).
    if (!this.disposed) this.wrap(npcId);
  }

  update(dt: number): void {
    if (this.disposed) return;
    for (let i = 0; i < this.followers.length; i++) this.followers[i]!.update(dt);
    for (let i = 0; i < this.list.length; i++) {
      const npc = this.list[i]!;
      if (!this.led.has(npc)) npc.update(dt);
    }
  }

  render(alpha: number): void {
    if (this.disposed) return;
    for (let i = 0; i < this.followers.length; i++) this.followers[i]!.render(alpha);
    for (let i = 0; i < this.list.length; i++) {
      const npc = this.list[i]!;
      if (!this.led.has(npc)) npc.render(alpha);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.followers.splice(0)) c.dispose();
    for (const n of this.list.splice(0)) if (!this.led.has(n)) n.dispose();
    this.led.clear();
    this.byId.clear();
  }

  private wrap(id: string): void {
    const character = this.session.world.npcs.get(id);
    if (!character) return;
    const npc = new NPC({ id, character, session: this.session });
    this.byId.set(id, npc);
    this.list.push(npc);
  }
}
