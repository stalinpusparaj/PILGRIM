/**
 * Cutscene system (GDD 2.5 "Cutscenes: spline rails, letterbox bars, gentle eased moves. No shaky cam.";
 * Phase 3 item 2): camera rails, letterbox, actor tracks, timed events, hold Space / pad A / the ring for 1 s to
 * skip. Data types: cutscene-types.ts. One CutscenePlayer per Engine ('cutscene' service); it adds itself to the
 * loop at order 950 (after gameplay and the follow camera, before the Engine renders at 1000), so do not call
 * update()/render() yourself.
 *
 *   const cutscenes = new CutscenePlayer(engine);
 *   const result = await cutscenes.play(def, { actors: { christian: player.character, evangelist }, ground: terrain });
 *
 * While a cutscene plays:
 * - the 'cameraRig' service (follow camera) is suspended and engine.camera is driven here; at the end the rig
 *   resumes with a blend from the last frame (def.blendOut, default 0.8 s) and the FOV eases back. With no rig,
 *   the camera is put back exactly where it was. A cutscene without camera cues leaves the camera alone.
 *   Shot FOVs are designed for 16:9 and widen on narrower screens (cutscene-camera.ts fitFov).
 *   With Reduce camera motion (or the OS setting) every shot holds its final framing: cuts instead of moves.
 * - the letterbox slides in; `hud:visible {on:false}` hides the HUD (`{on:true}` at the end).
 * - gameplay input is off through Input.setGameplayActive(false) — the switch Input documents for menus and
 *   cutscenes: held keys are released (a Space already held for a jump never counts as a skip), touch controls
 *   hide, the mouse is freed. It is switched back on at the end (`restoreGameplay: false` leaves it off), unless
 *   a conversation is still running (story-input.ts): then the DialoguePanel gives it back when the talk ends.
 *   Chosen over a Player mode flag because it needs nothing from the Player and also covers touch controls;
 *   the Player can still follow 'cutscene:start' / 'cutscene:end' to stop its own physics.
 * - the loop's pause stops the scene (update() is not called while paused); render keeps the frame.
 * On skip (or when a fixed `duration` cuts actions short) every actor jumps to its end state, lines on screen
 * close, and remaining events marked `essential` fire in order, so game state is the same either way.
 */
import type * as THREE from 'three';
import { events } from '../core/Events';
import { services } from '../core/Services';
import type { System } from '../core/Loop';
import type { CameraRig } from '../core/CameraRig';
import type { Engine } from '../core/Engine';
import type { Character } from '../gen/CharacterFactory';
import { Letterbox, reducedMotion } from '../ui/Letterbox';
import type { CutsceneContext, CutsceneDef, CutsceneResult, TimedEvent } from './cutscene-types';
import { CameraDirector, FovTween } from './cutscene-camera';
import { ActorRunner, type ActorEnv } from './cutscene-actors';
import { SkipControl } from './cutscene-skip';
import { Captions } from './cutscene-caption';
import { LineTracker, fireEvent, resolveSay, sortEvents } from './cutscene-events';
import { dialogueHoldsInput } from './story-input';

export type * from './cutscene-types';
export { shots, cutTo, retime, type ShotOptions } from './cutscene-shots';
export { headOf, headPosition } from './cutscene-math';
export { gaitFor, DEFAULT_MOVE_SPEED } from './cutscene-actors';
export { SKIP_HOLD_SECONDS } from './cutscene-skip';

declare module '../core/Services' {
  interface ServiceMap {
    cutscene: CutscenePlayer;
  }
}
declare module '../core/Events' {
  interface EventMap {
    'cutscene:start': { id: string };
    'cutscene:end': { id: string; result: CutsceneResult };
  }
}

/** Loop order: after gameplay systems and the follow camera, before the Engine's render (1000). */
export const CUTSCENE_ORDER = 950;
const DEFAULT_BLEND_OUT = 0.8;
/** A scene waiting for a walk to finish gives up this long after its last cue (a blocked or endless path). */
const WALK_GRACE = 30;

interface Session {
  def: CutsceneDef;
  ctx: CutsceneContext;
  skippable: boolean;
  runners: ActorRunner[];
  animate: Character[];
  events: TimedEvent[];
  nextEvent: number;
  time: number;
  prevTime: number;
  /** End time: def.duration, or the last cue (then also waiting for walks). */
  end: number;
  fixed: boolean;
  /** False for a cutscene without camera cues: the gameplay camera (and its rig) is left alone. */
  drivesCamera: boolean;
  rig: CameraRig | null;
  camera: THREE.PerspectiveCamera;
  lines: LineTracker;
  resolve: (r: CutsceneResult) => void;
}

export class CutscenePlayer implements System {
  /** Cutscenes stop with the pause menu and the hidden-tab pause (no update() while the loop is paused). */
  readonly updateWhenPaused = false;
  private readonly engine: Engine;
  private readonly letterbox: Letterbox;
  private readonly ownLetterbox: boolean;
  private readonly skipUi: SkipControl;
  private readonly captions: Captions;
  private readonly director: CameraDirector;
  private readonly fovTween = new FovTween();
  private readonly removeSystem: () => void;
  private session: Session | null = null;
  private disposed = false;

  constructor(engine: Engine) {
    this.engine = engine;
    const shared = services.tryGet('letterbox');
    this.letterbox = shared ?? new Letterbox();
    this.ownLetterbox = !shared;
    // Captions first: the skip hint hides while a caption shows (a CSS sibling rule in letterbox.css).
    this.captions = new Captions(this.letterbox.bottom);
    this.skipUi = new SkipControl(this.letterbox.bottom);
    this.director = new CameraDirector(engine.camera);
    this.removeSystem = engine.loop.add(this, CUTSCENE_ORDER);
    if (!services.has('cutscene')) services.register('cutscene', this);
  }

  get playing(): boolean {
    return this.session !== null;
  }

  /** Id of the cutscene playing, or null. */
  get current(): string | null {
    return this.session?.def.id ?? null;
  }

  /** Seconds into the cutscene playing (0 when none). */
  get time(): number {
    return this.session?.time ?? 0;
  }

  /**
   * Plays a cutscene; resolves 'done' at its end or 'skipped'. A cutscene already playing is skipped first (its
   * essential events fire). After dispose() it resolves 'skipped' at once.
   */
  play(def: CutsceneDef, ctx: CutsceneContext = {}): Promise<CutsceneResult> {
    if (this.disposed) return Promise.resolve('skipped');
    if (this.session) this.finish('skipped');
    return new Promise<CutsceneResult>((resolve) => this.begin(def, ctx, resolve));
  }

  /** Skips the cutscene playing (as a full hold would). `force` also skips one that is not skippable. */
  skip(force = false): void {
    const s = this.session;
    if (s && (s.skippable || force)) this.finish('skipped');
  }

  update(dt: number): void {
    const s = this.session;
    if (!s) return;
    s.prevTime = s.time;
    s.time += dt;
    for (const c of s.animate) c.update(dt);
    for (const r of s.runners) r.step(s.time);
    while (s.nextEvent < s.events.length && s.events[s.nextEvent]!.at <= s.time) {
      fireEvent(s.events[s.nextEvent++]!, s.def.id);
      if (this.session !== s) return; // an event ended or replaced this cutscene
    }
    this.captions.update(dt);
    const keyHeld = services.tryGet('input')?.held('skip') ?? false;
    if (s.skippable && this.skipUi.update(dt, keyHeld)) {
      this.finish('skipped');
      return;
    }
    if (s.time >= s.end) {
      const walking = !s.fixed && s.runners.some((r) => r.moving);
      if (!walking || s.time >= s.end + WALK_GRACE) this.finish('done');
    }
  }

  render(alpha: number, frameDt: number): void {
    this.fovTween.update(frameDt);
    const s = this.session;
    if (!s) return;
    const loop = this.engine.loop;
    const dt = loop.paused ? 0 : frameDt * loop.timeScale;
    // The fixed clock interpolated like every other render (one step behind, never ahead of the actions).
    const t = s.prevTime + (s.time - s.prevTime) * Math.min(1, Math.max(0, alpha));
    for (const r of s.runners) r.pose(t, dt);
    if (s.drivesCamera) this.director.apply(t, dt);
  }

  /** Ends a cutscene still playing (as skipped: actors to their end state, essential events fired). */
  dispose(): void {
    if (this.disposed) return;
    if (this.session) this.finish('skipped');
    this.disposed = true;
    this.removeSystem();
    this.fovTween.cancel();
    this.skipUi.dispose();
    this.captions.dispose();
    if (this.ownLetterbox) this.letterbox.dispose();
    else this.letterbox.show(false);
    if (services.tryGet('cutscene') === this) services.unregister('cutscene');
  }

  // ------------------------------------------------------------------------------------------- session

  private begin(def: CutsceneDef, ctx: CutsceneContext, resolve: (r: CutsceneResult) => void): void {
    const actors = ctx.actors ?? {};
    const lines = new LineTracker();
    const say = resolveSay(ctx, (c, key, o) => this.captions.say(c, key, o));
    const runners: ActorRunner[] = [];
    const env: ActorEnv = {
      actors,
      ground: ctx.ground,
      say: (c, a) => lines.add(say(c, a.key, { mood: a.mood, params: a.params })),
    };
    for (const track of def.actors ?? []) {
      const c = actors[track.actor];
      if (c) runners.push(new ActorRunner(track.actor, c, track.actions, env));
      else
        console.warn(
          `[cutscene] "${def.id}": no actor "${track.actor}" in the context; its track is skipped`,
        );
    }
    const animate: Character[] = [];
    for (const name of ctx.animate ?? []) {
      const c = actors[name];
      if (c && !animate.includes(c)) animate.push(c);
    }
    const evs = sortEvents(def.events);
    const camera = this.engine.camera;
    this.director.load(def.camera ?? [], actors, ctx.ground);
    this.director.begin(camera);
    this.director.still = reducedMotion();
    let last = this.director.endTime;
    for (const r of runners) last = Math.max(last, r.lastAt);
    if (evs.length > 0) last = Math.max(last, evs[evs.length - 1]!.at);
    const fixed = def.duration !== undefined && Number.isFinite(def.duration);
    const drivesCamera = this.director.trackCount > 0;
    const rig = drivesCamera ? (services.tryGet('cameraRig') ?? null) : null;

    this.session = {
      def,
      ctx,
      skippable: def.skippable !== false,
      runners,
      animate,
      events: evs,
      nextEvent: 0,
      time: 0,
      prevTime: 0,
      end: fixed ? Math.max(0, def.duration!) : last,
      fixed,
      drivesCamera,
      rig,
      camera,
      lines,
      resolve,
    };
    this.fovTween.cancel();
    rig?.suspend();
    this.letterbox.show(true);
    events.emit('hud:visible', { on: false });
    services.tryGet('input')?.setGameplayActive(false);
    this.letterbox.bottom.style.setProperty('--ring-space', def.skippable === false ? '0px' : '84px');
    if (def.skippable !== false) this.skipUi.start();
    else this.skipUi.stop();
    events.emit('cutscene:start', { id: def.id });
  }

  private finish(result: CutsceneResult): void {
    const s = this.session;
    if (!s) return;
    this.session = null; // first: anything below that calls back into the player sees no scene
    for (const r of s.runners) {
      try {
        r.finish();
      } catch (err) {
        console.error(`[cutscene] "${s.def.id}": actor "${r.name}" could not reach its end state`, err);
      }
    }
    if (result === 'skipped') s.lines.closeAll();
    else s.lines.forget();
    this.captions.clear();
    this.skipUi.stop();

    const blend = Math.max(0, s.def.blendOut ?? DEFAULT_BLEND_OUT);
    if (s.rig) {
      this.fovTween.start(s.camera, this.director.startFov, blend);
      s.rig.resume(blend);
    } else if (s.drivesCamera) {
      this.director.restore();
    }
    this.letterbox.show(false);
    events.emit('hud:visible', { on: true });
    // A conversation still on screen keeps the input; the DialoguePanel hands it back when it ends.
    if (s.ctx.restoreGameplay !== false && !dialogueHoldsInput())
      services.tryGet('input')?.setGameplayActive(true);
    // Last, so an essential event may even start the next cutscene on a clean slate.
    for (; s.nextEvent < s.events.length; s.nextEvent++) {
      const e = s.events[s.nextEvent]!;
      if (e.essential) fireEvent(e, s.def.id);
    }
    events.emit('cutscene:end', { id: s.def.id, result });
    s.resolve(result);
  }
}
