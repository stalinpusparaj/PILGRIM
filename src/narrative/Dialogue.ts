/**
 * The dialogue runner (GDD 2.8): plays a dialogue graph node by node. UI-agnostic: it emits events and waits
 * for the UI to call back (the full protocol is in DialogueTypes.ts). Registered as the 'dialogue' service so
 * the DialoguePanel and SpeechBubbles can find it.
 *
 *   const runner = new DialogueRunner({ actor: (s) => world.npcs.get(s) ?? (s === 'christian' ? player.character : null),
 *                                       camera: (shot, speaker) => dialogueCam.cut(shot, speaker) });
 *   await runner.play('ch01_evangelist');      // loads content/dialogue/ch01.json on first use
 *
 * - play() while a graph runs queues the new one; it starts when the current one ends. Each play() resolves
 *   when its own graph has ended (or was dropped by stop()).
 * - Conditions and state effects go through the 'state' service (GameState); faces, gestures and talking go to
 *   the host's actors and are put back at the end; camera shots go to the host (or 'dialogue:cam').
 * - Music is ducked ('audio:duck') from 'dialogue:start' to 'dialogue:end' (GDD 2.13).
 */
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { GameState } from '../core/GameState';
import type { Character } from '../gen/CharacterFactory';
import '../audio/events';
import { ActorStage } from './dialogue-actors';
import { applyEffects, sendShot, stateReader, type EffectTarget } from './dialogue-effects';
import { CAM_RELEASE, MAX_CHOICES, evalCond, type CondReader } from './dialogue-rules';
import { findDialogue } from './dialogue-registry';
import { exprFor, moodFor, recipeFor, textCps, voiceFor } from './dialogue-voice';
import type {
  DialogueChoice,
  DialogueChoiceView,
  DialogueGraph,
  DialogueHost,
  DialogueLine,
  DialogueNode,
  EffectContext,
} from './DialogueTypes';

export type * from './DialogueTypes';
export {
  CAM_RELEASE,
  MAX_CHOICES,
  MAX_LINES_IN_A_ROW,
  PLAYER_SPEAKER,
  evalCond,
  graphKeys,
  parseCond,
  validateGraph,
} from './dialogue-rules';
export type { CondReader, ValidateOptions } from './dialogue-rules';
export { dialogueFileIds, findDialogue, loadDialogues, peekDialogue } from './dialogue-registry';
export { parseDialogueFile } from './dialogue-parse';
export { DEFAULT_VOICE, TEXT_SPEED_CPS, speakLine, textCps, voiceFor } from './dialogue-voice';

declare module '../core/Services' {
  interface ServiceMap {
    dialogue: DialogueRunner;
  }
}

/**
 * idle: nothing playing. loading: a graph file is loading. typing: a line was emitted and is being revealed.
 * shown: the line is fully shown, waiting for advance(). choosing: choices are up, waiting for choose().
 * busy: moving between nodes (only seen from inside event handlers).
 */
export type DialoguePhase = 'idle' | 'loading' | 'typing' | 'shown' | 'choosing' | 'busy';

export interface DialogueRunnerOptions {
  /** Register as the 'dialogue' service (default true: the game's main runner). */
  register?: boolean;
  /** Session state for conditions and effects (default: the 'state' service at the time of use). */
  state?: () => GameState | undefined;
}

interface QueueItem {
  graph: DialogueGraph | string;
  resolve: () => void;
}

interface Running {
  graph: DialogueGraph;
  nodes: Map<string, DialogueNode>;
  resolve: () => void;
  node: DialogueNode | null;
  /** Visible choices of the current node (cond passed), max 3. */
  choices: DialogueChoice[];
  lines: number;
  /** A camera shot is out: send 'release' at the end. */
  shots: boolean;
}

export class DialogueRunner {
  private run: Running | null = null;
  private now: DialoguePhase = 'idle';
  private readonly queue: QueueItem[] = [];
  private pending: QueueItem | null = null;
  private skipping = false;
  private disposed = false;
  private shown: DialogueLine | null = null;
  private readonly stage: ActorStage;
  private readonly reader: CondReader;
  private readonly target: EffectTarget;
  private readonly registered: boolean;

  constructor(host: DialogueHost, opts: DialogueRunnerOptions = {}) {
    const state = opts.state ?? ((): GameState | undefined => services.tryGet('state'));
    this.stage = new ActorStage(host);
    this.reader = stateReader(state);
    this.target = { host, stage: this.stage, state, onShot: (shot) => this.onShot(shot) };
    this.registered = opts.register !== false;
    if (this.registered) services.register('dialogue', this);
  }

  /** True while a graph is playing. */
  get active(): boolean {
    return this.run !== null;
  }

  /** True while a graph is playing, loading or queued. */
  get busy(): boolean {
    return this.run !== null || this.pending !== null || this.queue.length > 0;
  }

  get phase(): DialoguePhase {
    return this.run === null && this.pending !== null ? 'loading' : this.now;
  }

  /** Id of the playing graph. */
  get graphId(): string | null {
    return this.run?.graph.id ?? null;
  }

  /** The line on screen (from 'dialogue:line' until it is left), e.g. for a UI that mounts late. */
  get line(): DialogueLine | null {
    return this.shown;
  }

  /** The choices on screen while the phase is 'choosing' (as in 'dialogue:choices'), else empty. */
  get choices(): DialogueChoiceView[] {
    if (this.now !== 'choosing' || !this.run) return [];
    return this.run.choices.map((c, index) => ({ index, key: c.text }));
  }

  /** The host's Character for a speaker (null when unknown). DialoguePanel anchors bubble lines with it. */
  actor(speaker: string): Character | null {
    return this.stage.actor(speaker);
  }

  /** Plays a graph (or a graph id: its file loads on first use). Resolves when it has ended. */
  play(graph: DialogueGraph | string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.queue.push({ graph, resolve });
      this.pump();
    });
  }

  /** UI: the current line is fully shown. Choices (if any) are emitted now. Idempotent. */
  lineDone(): void {
    const r = this.run;
    if (!r?.node || this.now !== 'typing') return;
    this.stage.talk(null, false);
    if (!r.choices.length) {
      this.now = 'shown';
      return;
    }
    this.now = 'choosing';
    events.emit('dialogue:choices', {
      graph: r.graph.id,
      node: r.node.id,
      speaker: r.node.speaker,
      choices: this.choices,
    });
  }

  /** UI: the player moves on from a shown line (implies lineDone() while typing; ignored while choosing). */
  advance(): void {
    if (this.now === 'typing') this.lineDone();
    const r = this.run;
    if (!r?.node || this.now !== 'shown') return;
    const node = r.node;
    this.leaveLine(r);
    if (this.run !== r) return;
    if (node.effects?.end) this.finish(r);
    else this.goTo(node.next);
  }

  /** What Space does: reveal the whole line while typing ('dialogue:reveal'), else advance(). */
  skipLine(): void {
    const r = this.run;
    if (r?.node && this.now === 'typing') {
      events.emit('dialogue:reveal', { graph: r.graph.id, node: r.node.id });
      this.lineDone();
    } else if (this.now === 'shown') {
      this.advance();
    }
  }

  /** Hold Space: skip to the next choice (shown at once, choices up) or the end. Skipped lines' effects still apply. */
  skipScene(): void {
    const r = this.run;
    if (!r?.node || (this.now !== 'typing' && this.now !== 'shown')) return;
    if (r.choices.length) {
      this.skipLine();
      return;
    }
    const node = r.node;
    this.leaveLine(r);
    if (this.run !== r) return;
    if (node.effects?.end) {
      this.finish(r);
      return;
    }
    this.skipping = true;
    this.goTo(node.next);
  }

  /** UI: the player picked choice `index` (the `index` from 'dialogue:choices'). */
  choose(index: number): void {
    const r = this.run;
    if (!r?.node || this.now !== 'choosing') return;
    const choice = Number.isInteger(index) ? r.choices[index] : undefined;
    if (!choice) return;
    const node = r.node;
    this.now = 'busy';
    events.emit('dialogue:chose', { graph: r.graph.id, node: node.id, index, key: choice.text });
    this.leaveLine(r);
    if (this.run !== r) return;
    applyEffects(choice.effects, this.ctx(r, node, 'choice'), this.target);
    if (this.run !== r) return;
    if (choice.effects?.end) this.finish(r);
    else this.goTo(choice.next ?? node.next);
  }

  /** Ends the playing graph now (no further effects) and drops queued ones; their play() calls resolve. */
  stop(): void {
    const dropped = this.queue.splice(0);
    const pending = this.pending;
    this.pending = null;
    pending?.resolve();
    for (const q of dropped) q.resolve();
    if (this.run) this.finish(this.run);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    if (this.registered && services.tryGet('dialogue') === this) services.unregister('dialogue');
  }

  // ------------------------------------------------------------------------------------------- internals

  private pump(): void {
    if (this.run || this.pending || this.disposed) return;
    const item = this.queue.shift();
    if (!item) return;
    if (typeof item.graph !== 'string') {
      this.begin(item.graph, item.resolve);
      return;
    }
    const id = item.graph;
    this.pending = item;
    void findDialogue(id).then((graph) => {
      if (this.pending !== item) return; // stop() or dispose() already resolved it
      this.pending = null;
      if (graph) {
        this.begin(graph, item.resolve);
        return;
      }
      console.warn(`[dialogue] unknown dialogue "${id}"`);
      item.resolve();
      this.pump();
    });
  }

  private begin(graph: DialogueGraph, resolve: () => void): void {
    const first = graph.nodes[0];
    if (!first) {
      console.warn(`[dialogue] "${graph.id}" has no nodes`);
      resolve();
      this.pump();
      return;
    }
    const r: Running = {
      graph,
      nodes: new Map(graph.nodes.map((n) => [n.id, n])),
      resolve,
      node: null,
      choices: [],
      lines: 0,
      shots: false,
    };
    this.run = r;
    this.now = 'busy';
    this.skipping = false;
    events.emit('dialogue:start', {
      id: graph.id,
      speakers: [...new Set(graph.nodes.map((n) => n.speaker))],
    });
    if (this.run !== r) return;
    events.emit('audio:duck', { on: true, by: 'dialogue' });
    this.goTo(first.id);
  }

  /** Enters node `id`: skips nodes whose cond fails, applies effects, then shows the line (or ends). */
  private goTo(id: string | undefined): void {
    const r = this.run;
    if (!r) return;
    this.now = 'busy';
    let next = id;
    // Each node is entered at most once per call unless the graph loops without a line to stop on.
    for (let guard = 0; ; guard++) {
      if (next === undefined) return this.finish(r);
      const node = r.nodes.get(next);
      if (!node || guard > r.nodes.size) {
        console.warn(`[dialogue] ${r.graph.id}: ${node ? 'endless loop' : `unknown node "${next}"`}; ending`);
        return this.finish(r);
      }
      if (!evalCond(node.cond, this.reader)) {
        next = node.next;
        continue;
      }
      r.node = node;
      applyEffects(node.effects, this.ctx(r, node, 'node'), this.target);
      if (this.run !== r) return;
      r.choices = (node.choices ?? []).filter((c) => evalCond(c.cond, this.reader)).slice(0, MAX_CHOICES);
      if (this.skipping && !r.choices.length) {
        if (node.effects?.end) return this.finish(r);
        next = node.next;
        continue;
      }
      const skipped = this.skipping;
      this.skipping = false;
      this.showLine(r, node);
      // A scene skip lands on the question already revealed, with its choices up.
      if (skipped && this.run === r && this.phase === 'typing') this.skipLine();
      return;
    }
  }

  private showLine(r: Running, node: DialogueNode): void {
    const actor = this.stage.actor(node.speaker);
    const expr = exprFor(node.expr, node.mood);
    this.stage.setExpression(actor, expr);
    if (node.anim) this.stage.play(actor, node.anim);
    this.stage.talk(actor, true);
    r.lines++;
    const line: DialogueLine = {
      graph: r.graph.id,
      node: node.id,
      speaker: node.speaker,
      recipe: recipeFor(node.speaker, actor),
      key: node.text,
      mood: moodFor(node.mood, node.expr),
      expr,
      bubble: node.bubble === true,
      voice: voiceFor(node.speaker, actor),
      cps: textCps(),
      hasChoices: r.choices.length > 0,
      index: r.lines,
    };
    this.shown = line;
    this.now = 'typing';
    events.emit('dialogue:line', line);
  }

  /** The current line goes away: mouths stop, line gestures end, the UI hides it. */
  private leaveLine(r: Running): void {
    this.now = 'busy';
    this.stage.endLine();
    const was = this.shown;
    this.shown = null;
    if (was) events.emit('dialogue:lineEnd', { graph: r.graph.id, node: was.node });
  }

  private finish(r: Running): void {
    if (this.run !== r) return;
    if (this.shown) this.leaveLine(r);
    this.stage.restore();
    if (r.shots) sendShot(CAM_RELEASE, this.ctx(r, r.node ?? r.graph.nodes[0], 'node'), this.target);
    this.run = null;
    this.now = 'idle';
    this.skipping = false;
    events.emit('audio:duck', { on: false, by: 'dialogue' });
    events.emit('dialogue:end', { id: r.graph.id });
    r.resolve();
    this.pump();
  }

  private onShot(shot: string): void {
    if (this.run) this.run.shots = shot !== CAM_RELEASE;
  }

  private ctx(r: Running, node: DialogueNode, from: EffectContext['from']): EffectContext {
    return { graph: r.graph.id, node: node.id, speaker: node.speaker, from };
  }
}
