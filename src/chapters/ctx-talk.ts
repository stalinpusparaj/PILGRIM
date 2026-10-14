/**
 * Chapter conversations (ChapterContext.talk): the chapter's DialogueRunner (registered 'dialogue' for the
 * chapter's life; it listens to nothing) with the chapter's TalkHost, and a DialoguePanel made for each talk and
 * freed after it, so no panel listens to 'dialogue:*' between talks (a runner someone else starts keeps its own
 * panel). Talks run one after another.
 *
 * Around a talk: the player is locked ('locked': no input, physics on), the partner NPC stops, faces the player
 * and looks at him, the player turns to face the partner, followers stop following, the HUD hides, the partner
 * is met (`state.meet(recipe)`, FRIENDS MET). Everything is put back at the end (also when the chapter goes).
 */
import * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { DialogueRunner } from '../narrative/Dialogue';
import { DialoguePanel } from '../ui/DialoguePanel';
import type { Companion } from '../npc/Companion';
import type { NPC } from '../npc/NPC';
import type { PlaySession } from '../world/PlaySession';
import { TalkHost } from './ctx-host';

export interface TalkKitDeps {
  session: PlaySession;
  npc(id: string): NPC | null;
  companions(): readonly Companion[];
}

export class TalkKit {
  readonly host: TalkHost;
  private chain: Promise<void> = Promise.resolve();
  private readonly runner: DialogueRunner;
  private panel: DialoguePanel | null = null;
  private talking = false;
  private disposed = false;
  private readonly look = new THREE.Vector3();

  constructor(private readonly deps: TalkKitDeps) {
    const { session } = deps;
    this.host = new TalkHost({
      actor: (speaker) => this.actorOf(speaker),
      camera: session.view,
      rig: session.camera,
      reduceMotion: () => services.tryGet('settings')?.data.reduceMotion ?? false,
    });
    this.runner = new DialogueRunner(this.host);
  }

  /** True while a chapter conversation is on screen. */
  get active(): boolean {
    return this.talking;
  }

  talk(graphId: string, partner: string | null): Promise<void> {
    const next = this.chain.then(() => this.run(graphId, partner));
    this.chain = next.catch(() => {});
    return next;
  }

  /** Per rendered frame: the held camera shot. */
  render(frameDt: number): void {
    if (this.talking) this.host.update(frameDt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runner.stop(); // resolves the running talk; run() puts everything back
    this.closePanel();
    this.runner.dispose();
  }

  // ---------------------------------------------------------------------------------------------- private

  private actorOf(speaker: string): ReturnType<TalkHost['actor']> {
    if (speaker === 'christian') return this.deps.session.player.character;
    return this.deps.npc(speaker)?.character ?? this.deps.session.world.npcs.get(speaker) ?? null;
  }

  private async run(graphId: string, partnerId: string | null): Promise<void> {
    if (this.disposed) return;
    const { session } = this.deps;
    const player = session.player;
    const partner = partnerId ? this.deps.npc(partnerId) : null;
    const wasPlaying = player.mode === 'play';
    if (wasPlaying) player.mode = 'locked';
    const followers = this.deps.companions().filter((c) => c.following);
    for (const c of followers) c.following = false;
    if (partner) this.faceEachOther(partner);
    if (partner) session.state.meet(partner.character.recipe.id);
    events.emit('hud:visible', { on: false });
    this.talking = true;
    this.panel = new DialoguePanel(this.runner);
    this.host.begin(partnerId);
    try {
      await this.runner.play(graphId);
    } finally {
      this.host.end();
      this.closePanel();
      this.talking = false;
      partner?.lookAt(null);
      if (!session.isDisposed) {
        for (const c of followers) c.following = true;
        events.emit('hud:visible', { on: true });
        if (wasPlaying && player.mode === 'locked') player.mode = 'play';
      }
    }
  }

  private faceEachOther(npc: NPC): void {
    const player = this.deps.session.player;
    const p = player.controller.position;
    npc.stop();
    npc.face(p);
    npc.lookAt(() => this.look.copy(player.renderPosition).setY(player.renderPosition.y + 1.4));
    const yaw = Math.atan2(npc.position.x - p.x, npc.position.z - p.z);
    if (Number.isFinite(yaw)) player.teleport(p, yaw);
  }

  private closePanel(): void {
    this.panel?.dispose();
    this.panel = null;
  }
}
