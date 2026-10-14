/**
 * The faces, gestures and talking mouths of the characters in a running dialogue. Remembers how each actor was
 * before the dialogue touched it and puts it back at the end: expression, full-body clip, overlay, talking.
 *
 * - Upper-body clips (point, wave, read...) are overlays that last for the current line only.
 * - Full-body clips: one-shots (hop, trip...) fall back by themselves; loops (sit, kneel, pray...) last until
 *   the dialogue ends, then the clip the actor had before comes back.
 */
import { CLIPS, isUpperClip, type AnimName } from '../gen/anim';
import type { Character, Expression } from '../gen/CharacterFactory';
import type { DialogueHost } from './DialogueTypes';

interface Before {
  /** The face before the dialogue, when the dialogue changed it. */
  expr: Expression | null;
  /** The full-body clip before the dialogue, and the loop the dialogue started over it. */
  clip: AnimName;
  loop: AnimName | null;
}

export function isAnimName(name: string): name is AnimName {
  return Object.hasOwn(CLIPS, name);
}

export class ActorStage {
  private readonly before = new Map<Character, Before>();
  private readonly lineOverlays = new Map<Character, AnimName>();
  private talker: Character | null = null;
  private readonly warned = new Set<string>();

  constructor(private readonly host: DialogueHost) {}

  /** The host's actor for a speaker (null when the host throws or has none). */
  actor(speaker: string): Character | null {
    try {
      return this.host.actor(speaker) ?? null;
    } catch (err) {
      console.error(`[dialogue] host.actor("${speaker}") threw`, err);
      return null;
    }
  }

  setExpression(c: Character | null, e: Expression | null): void {
    if (!c || !e) return;
    const b = this.touch(c);
    b.expr ??= c.expression;
    c.setExpression(e);
  }

  /** Plays a clip by name on an actor. Unknown names warn once (dev) and do nothing. */
  play(c: Character | null, name: string): void {
    if (!c) return;
    if (!isAnimName(name)) {
      if (import.meta.env.DEV && !this.warned.has(name)) console.warn(`[dialogue] unknown anim "${name}"`);
      this.warned.add(name);
      return;
    }
    const b = this.touch(c);
    if (isUpperClip(name)) {
      c.animator.overlay(name, { restart: true });
      this.lineOverlays.set(c, name);
    } else {
      c.animator.play(name, { restart: !CLIPS[name].loop });
      if (CLIPS[name].loop) b.loop = name;
    }
  }

  /** Mouth flap for the line's speaker (only one actor talks at a time). */
  talk(c: Character | null, on: boolean): void {
    if (on) {
      if (this.talker && this.talker !== c) this.talker.setTalking(false);
      this.talker = c;
      c?.setTalking(true);
      return;
    }
    this.talker?.setTalking(false);
    this.talker = null;
  }

  /** The current line was left: stop talking and clear the gestures it started. */
  endLine(): void {
    this.talk(null, false);
    for (const [c, name] of this.lineOverlays) {
      if (c.animator.overlayName === name) c.animator.overlay(null);
    }
    this.lineOverlays.clear();
  }

  /** The dialogue ended: every touched actor goes back to how it was. */
  restore(): void {
    this.endLine();
    for (const [c, b] of this.before) {
      if (b.expr !== null && c.expression !== b.expr) c.setExpression(b.expr);
      // Only undo a loop the dialogue started and that is still playing (the game may have moved on).
      if (b.loop !== null && c.animator.current === b.loop && b.loop !== b.clip) c.animator.play(b.clip);
    }
    this.before.clear();
  }

  private touch(c: Character): Before {
    let b = this.before.get(c);
    if (!b) {
      b = { expr: null, clip: c.animator.current, loop: null };
      this.before.set(c, b);
    }
    return b;
  }
}
