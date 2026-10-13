/**
 * Character Lab cast: the turntable character and the lineup, plus the animation/face state the Lab applies
 * to every character it builds (current clip, overlay, repeat, move speed, expression, talking, Burden size).
 */
import * as THREE from 'three';
import { CharacterFactory, type Character, type CharacterRecipe } from './CharacterFactory';
import { CLIPS, NOMINAL_SPEED } from './anim';
import type { AnimName, ProcClip } from './anim/types';
import { Rng, hashString } from './rng';
import { Yielder } from './yielder';
import type { LabStage } from './lab-stage';
import { LabLineup } from './lab-lineup';
import type { Expression } from './lab-recipe';

/** Gameplay move speeds (m/s, GDD 2.7.1) for the speed-driven clips so strides match; others keep the slider. */
const CLIP_SPEED = NOMINAL_SPEED;
/** How long a clicked expression holds on the whole lineup before random faces resume (s). */
const LINEUP_FACE_HOLD = 4;

/** What the cast reports back to the Lab's panel. */
export interface CastEvents {
  status(text: string): void;
  anim(name: AnimName): void;
  overlay(name: AnimName | null): void;
}

export class LabCast {
  character: Character | null = null;
  lineup: LabLineup | null = null;
  /** Last turntable build time (ms). */
  buildMs = 0;

  anim: AnimName = 'idle';
  overlayName: AnimName | null = null;
  repeat = true;
  moveSpeed = 0;
  expression: Expression = 'neutral';
  talking = false;
  burdenSize = 1;

  /** The one-shot (full body / overlay) that last settled without repeating; see onClipEnd. */
  private settledAnim: AnimName | null = null;
  private settledOverlay: AnimName | null = null;
  private lineupToken = 0;
  private disposed = false;

  constructor(
    private readonly stage: LabStage,
    private readonly ids: readonly string[],
    private readonly recipeOf: (id: string) => CharacterRecipe,
    private readonly notify: CastEvents,
  ) {}

  /** (Re)builds the turntable character; after an edit (`syncLineup`) also the lineup's copy of it. */
  rebuild(id: string, syncLineup: boolean): void {
    const recipe = this.recipeOf(id);
    this.disposeCharacter();
    const t0 = performance.now();
    const c = CharacterFactory.build(recipe, new Rng(hashString(recipe.id)));
    this.buildMs = performance.now() - t0;
    c.mesh.castShadow = true;
    c.root.position.set(0, this.stage.plinthTop, 0);
    this.stage.turntable.add(c.root);
    this.stage.blobs.follow(c);
    this.character = c;
    this.applyState(c, true);

    const i = this.ids.indexOf(id);
    if (syncLineup && this.lineup && i < this.lineup.characters.length) {
      const lc = this.lineup.replace(i, recipe);
      if (lc) this.applyState(lc, false);
    }
  }

  /** Shows the lineup, building it (time-sliced) the first time. */
  showLineup(visible: boolean): void {
    if (this.lineup) {
      this.lineup.group.visible = visible;
      return;
    }
    if (!visible) return;
    const lineup = new LabLineup(
      this.ids.map((id) => this.recipeOf(id)),
      this.stage.blobs,
    );
    this.lineup = lineup;
    this.stage.scene.add(lineup.group);
    const token = ++this.lineupToken;
    const cancelled = (): boolean => this.disposed || token !== this.lineupToken;
    const y = new Yielder();
    this.notify.status('Building lineup...');
    lineup
      .populate(y, cancelled, (c) => this.applyState(c, false))
      .then(() => {
        if (cancelled()) return;
        const ms = y.finish();
        this.notify.status(`Lineup: ${lineup.characters.length} characters, ${ms.toFixed(0)} ms work`);
      })
      .catch((err: unknown) => console.error('[Lab] lineup build failed', err));
  }

  /** Full-body clip on everyone. Returns the move speed it switched to (locomotion clips), else null. */
  play(name: AnimName): number | null {
    this.anim = name;
    this.settledAnim = null;
    const speed = CLIP_SPEED[name] ?? null;
    if (speed !== null) this.moveSpeed = speed;
    for (const c of this.all()) {
      c.animator.params.speed = this.moveSpeed;
      c.animator.play(name, { fade: 0.25, restart: true });
    }
    return speed;
  }

  setOverlay(name: AnimName | null): void {
    this.overlayName = name;
    this.settledOverlay = null;
    for (const c of this.all()) {
      c.animator.overlay(name, { fade: 0.2 });
      c.setTalking(this.mouthFlaps());
    }
  }

  setMoveSpeed(v: number): void {
    this.moveSpeed = v;
    for (const c of this.all()) c.animator.params.speed = v;
  }

  setExpression(e: Expression): void {
    this.expression = e;
    this.character?.setExpression(e);
    this.lineup?.holdExpression(e, LINEUP_FACE_HOLD);
  }

  setTalking(on: boolean): void {
    this.talking = on;
    for (const c of this.all()) c.setTalking(this.mouthFlaps());
  }

  /** The mouth flaps with the Talking toggle, and while the talk overlay plays (GDD 2.12: head bob + mouth flap). */
  private mouthFlaps(): boolean {
    return this.talking || this.overlayName === 'talk';
  }

  setBurden(s: number): void {
    this.burdenSize = s;
    for (const c of this.all()) if (c.recipe.burden) c.setBurdenSize(s);
  }

  /** Fixed step: only the visible group animates. */
  update(dt: number, lineupView: boolean): void {
    if (lineupView) this.lineup?.update(dt);
    else this.character?.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lineupToken++; // cancels a lineup still being built
    this.disposeCharacter();
    this.lineup?.dispose();
    this.lineup = null;
  }

  /** Applies the Lab's animation/face state to a freshly built character. */
  private applyState(c: Character, face: boolean): void {
    const a = c.animator;
    a.params.speed = this.moveSpeed;
    a.play(this.anim, { fade: 0, restart: true });
    a.overlay(this.overlayName, { fade: 0 });
    const previous = a.onEnd;
    a.onEnd = (name: AnimName) => {
      previous?.(name);
      this.onClipEnd(c, name);
    };
    c.setTalking(this.mouthFlaps());
    if (c.recipe.burden) c.setBurdenSize(this.burdenSize);
    if (face) c.setExpression(this.expression);
  }

  /**
   * One-shot finished: repeat it (Repeat toggle) or settle back to idle / no overlay. Every character in the
   * lineup ends at once, so the clip that just settled is remembered for the ones that report after the first.
   */
  private onClipEnd(c: Character, name: AnimName): void {
    const clip = CLIPS[name] as ProcClip | undefined;
    if (this.disposed || !clip || clip.loop) return;
    const a = c.animator;
    if (name === this.overlayName || name === this.settledOverlay) {
      if (this.repeat && name === this.overlayName) {
        a.overlay(null, { fade: 0 });
        a.overlay(name, { fade: 0.1 });
        return;
      }
      a.overlay(null, { fade: 0.2 });
      c.setTalking(this.talking);
      if (name === this.overlayName) {
        this.overlayName = null;
        this.settledOverlay = name;
        this.notify.overlay(null);
      }
      return;
    }
    if (name !== this.anim && name !== this.settledAnim) return; // a clip the user already moved away from
    if (this.repeat && name === this.anim) {
      a.play(name, { fade: 0.15, restart: true });
      return;
    }
    a.play('idle', { fade: 0.3 });
    if (name === this.anim) {
      this.anim = 'idle';
      this.settledAnim = name;
      this.notify.anim('idle');
    }
  }

  private disposeCharacter(): void {
    if (!this.character) return;
    this.stage.blobs.unfollow(this.character);
    this.character.root.removeFromParent();
    this.character.dispose();
    this.character = null;
  }

  private all(): Character[] {
    const list = this.lineup ? [...this.lineup.characters] : [];
    if (this.character) list.push(this.character);
    return list;
  }
}

/** Visible meshes (= draw calls without shadows) and triangles under a character root. */
export function meshStats(root: THREE.Object3D): { meshes: number; triangles: number } {
  let meshes = 0;
  let triangles = 0;
  root.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes++;
    const g = o.geometry as THREE.BufferGeometry;
    const count = g.index ? g.index.count : g.getAttribute('position').count;
    triangles += Math.floor(count / 3);
  });
  return { meshes, triangles };
}
