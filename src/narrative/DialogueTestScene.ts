/**
 * `?dialogue=test` (dev): the Phase 3 acceptance demo for dialogue. A small dusk stage outside the city gate
 * (content/levels/dialogue_test.json: palette 'city', 120 m, a short Way, a few props) with Christian (burdened)
 * and Evangelist standing on the Way facing each other, a fixed two-shot camera, a tiny Hope lantern readout,
 * the current language and two controls: "Play sample" and "English | தமிழ்".
 *
 * "Play sample" plays the graph `test_evangelist` from content/dialogue/test.json through the real pipeline
 * (DialogueRunner + DialoguePanel + SpeechBubbles, see dtest-talk.ts) with this scene as the DialogueHost
 * (dtest-host.ts): actors are the level's NPCs (the runner plays their anim / expr and flaps the speaker's mouth
 * while a line types), camera shots cut instantly with the Cutscene shot helpers and blend back to the two-shot
 * on release. A GameState is registered when none exists so Hope effects land (shown with a "+5" chip).
 * Switching language mid-talk is allowed. Music and ambience come from the level file.
 *
 *   const demo = new DialogueTestScene(engine);
 *   await demo.start();   // resolves when the stage is on screen
 *   await demo.play();    // the sample conversation (also the button)
 *   demo.dispose();       // the engine is left drawing an empty scene
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { System } from '../core/Loop';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { PRESETS } from '../core/Quality';
import { precompile } from '../core/compile';
import { createGameState, type GameState } from '../core/GameState';
import type { AmbienceId, SongId } from '../audio/types';
import type {} from '../audio/events'; // audio events on the bus
import type { Character } from '../gen/CharacterFactory';
import { Loading } from '../ui/Loading';
import { buildWorld, loadLevel } from '../world/LevelLoader';
import type { World } from '../world/World';
import { DemoCamera } from './dtest-camera';
import { DemoHost } from './dtest-host';
import { DemoTalk, loadSampleGraph, SAMPLE_GRAPH } from './dtest-talk';
import { DemoUi } from './dtest-ui';

const LEVEL_ID = 'dialogue_test';
/** The level's NPC ids that play the scene (speaker ids in the dialogue graph). */
const CAST = ['christian', 'evangelist'] as const;
const CAMERA = { fov: 55, near: 0.1, far: 600 };
/** Hope we start from when this scene owns the GameState, so a "+5" is visible (a new save starts at 100). */
const DEMO_HOPE = 50;
/** If Hope is this high when "Play sample" is pressed, it drops back to DEMO_HOPE first. */
const HOPE_RESET_ABOVE = 90;
const END_BLEND = 0.8;
const DEBUG_GROUP = 'Dialogue test';
const AMBIENCE: readonly AmbienceId[] = [
  'town',
  'bog',
  'hills',
  'wind',
  'candle',
  'fair',
  'river',
  'birdsong',
  'rain',
  'valley',
  'night',
  'dungeon',
  'meadow',
];
const SONGS: readonly SongId[] = [
  'pilgrim',
  'burden',
  'wiseman',
  'interpreter',
  'apollyon',
  'valley',
  'vanity',
  'despair',
  'mountains',
  'celestial',
  'tension',
  'title',
];

export class DialogueTestScene {
  readonly camera: THREE.PerspectiveCamera;

  private readonly loading = new Loading();
  private readonly blank = new THREE.Scene();
  private readonly system: System;
  private readonly offs: Array<() => void> = [];
  private readonly state: GameState;
  private readonly ownState: boolean;
  private ui: DemoUi | null = null;
  private world: World | null = null;
  private rig: DemoCamera | null = null;
  private host: DemoHost | null = null;
  private talk: DemoTalk | null = null;
  private removeSystem: (() => void) | null = null;
  private ownRig = false;
  private playing: Promise<void> | null = null;
  private pendingPlay = false;
  private started = false;
  private disposed = false;
  private readonly focus = new THREE.Vector3();

  constructor(private readonly engine: Engine) {
    const fov = services.tryGet('settings')?.data.fov ?? CAMERA.fov;
    this.camera = new THREE.PerspectiveCamera(fov, 1, CAMERA.near, CAMERA.far);
    this.blank.name = 'dialogue-test:blank';
    this.blank.background = new THREE.Color(0x2b2235);
    const existing = services.tryGet('state');
    this.ownState = existing === undefined;
    this.state = existing ?? createGameState();
    if (this.ownState) this.state.setHope(DEMO_HOPE);
    this.system = {
      update: () => this.step(),
      render: (_alpha, frameDt) => this.frame(frameDt),
    };
  }

  /** True once the stage is built and on screen. */
  get ready(): boolean {
    return this.world !== null && this.talk !== null && !this.disposed;
  }

  /** True while the sample conversation runs. */
  get active(): boolean {
    return this.playing !== null;
  }

  /** Builds the stage behind the loading screen; resolves once it is on screen. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    services.tryGet('input')?.setGameplayActive(false); // a menu-like demo: free mouse, no touch sticks
    this.engine.setView(this.blank, this.camera);
    this.removeSystem = this.engine.loop.add(this.system, 0);
    this.offs.push(
      events.on('settings:changed', ({ key }) => {
        if (key !== 'fov') return;
        const fov = services.tryGet('settings')?.data.fov;
        if (fov === undefined) return;
        if (this.rig) this.rig.setBaseFov(fov);
        else {
          this.camera.fov = fov;
          this.camera.updateProjectionMatrix();
        }
      }),
    );
    this.loading.show({ kicker: t('ui.dialogueTest.kicker'), title: t('ui.dialogueTest.title') });
    try {
      const [level, graph] = await Promise.all([loadLevel(LEVEL_ID), loadSampleGraph()]);
      if (this.disposed) return;
      const preset = services.tryGet('quality')?.preset ?? PRESETS.medium;
      const world = await buildWorld(level, preset, (p) => this.loading.setProgress(p * 0.97));
      if (this.disposed) {
        world.dispose();
        return;
      }
      this.world = world;
      this.adopt(world);
      this.talk?.setGraph(graph);
      try {
        await precompile(this.engine.renderer, world.scene, this.camera);
      } catch (err) {
        console.warn('[dialogue test] shader precompile failed; shaders compile on first draw', err);
      }
      if (this.disposed) return;
      this.engine.setView(world.scene, this.camera);
      this.loading.setProgress(1);
      this.startAudio(world);
      this.installUi(graph !== null);
      this.installDebug();
      if (graph === null)
        console.warn(`[dialogue test] no graph "${SAMPLE_GRAPH}" in content/dialogue/test.json`);
      await this.loading.hide();
      if (!this.disposed) this.ui?.focusPlay();
    } catch (err) {
      if (!this.disposed) this.loading.showError(`The dialogue test could not start: ${describe(err)}`);
      throw err;
    }
  }

  /** Plays the sample conversation (once at a time). Resolves when it ends. */
  play(): Promise<void> {
    if (this.playing) return this.playing;
    const talk = this.talk;
    const host = this.host;
    if (!talk || !host || this.disposed) return Promise.resolve();
    if (this.ownState && this.state.hope > HOPE_RESET_ABOVE) this.state.setHope(DEMO_HOPE);
    this.ui?.setPlaying(true);
    const run = talk
      .play()
      .catch((err: unknown) => console.error('[dialogue test] the sample conversation failed', err))
      .finally(() => {
        if (this.playing === run) this.playing = null;
        host.endConversation();
        this.rig?.reset(END_BLEND);
        if (!this.disposed) {
          this.ui?.setPlaying(false);
          this.ui?.focusPlay();
        }
      });
    this.playing = run;
    return run;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeSystem?.();
    this.removeSystem = null;
    for (const off of this.offs.splice(0)) off();
    this.talk?.dispose();
    this.talk = null;
    this.host?.endConversation();
    this.host = null;
    this.ui?.dispose();
    this.ui = null;
    if (this.ownRig && this.rig && services.tryGet('cameraRig') === this.rig)
      services.unregister('cameraRig');
    this.rig = null;
    if (this.world) {
      events.emit('ambience:set', { id: null });
      events.emit('music:stop', { fade: 0.6 });
    }
    this.world?.dispose();
    this.world = null;
    this.loading.dispose();
    if (this.ownState && services.tryGet('state') === this.state) services.unregister('state');
    this.engine.setView(new THREE.Scene(), new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, 100));
  }

  // ------------------------------------------------------------------------------------------ building

  private adopt(world: World): void {
    const cast = new Map<string, Character>();
    for (const id of CAST) {
      const c = world.npcs.get(id);
      if (c) cast.set(id, c);
      else console.warn(`[dialogue test] the level has no NPC "${id}"`);
    }
    const a = cast.get(CAST[0]);
    const b = cast.get(CAST[1]);
    if (a && b) {
      // Face each other exactly, whatever rotY the level file gives.
      const pa = a.root.position;
      const pb = b.root.position;
      a.root.rotation.y = Math.atan2(pb.x - pa.x, pb.z - pa.z);
      b.root.rotation.y = Math.atan2(pa.x - pb.x, pa.z - pb.z);
    }
    const first = a ?? b;
    if (!first) throw new Error('[dialogue test] the level has no actors');
    const rig = new DemoCamera(this.camera, first, b ?? first, world.terrain, world.palette.light.sunDir);
    this.rig = rig;
    // Stands in for the gameplay follow camera: dialogue cuts and cutscenes suspend and resume it.
    this.ownRig = !services.has('cameraRig');
    if (this.ownRig) services.register('cameraRig', rig);
    this.host = new DemoHost(cast, this.camera, rig);
    this.talk = new DemoTalk(this.host, this.camera);
  }

  private startAudio(world: World): void {
    const amb = AMBIENCE.find((id) => id === world.level.ambience);
    if (amb) events.emit('ambience:set', { id: amb });
    const song = SONGS.find((id) => id === world.level.music);
    if (song) events.emit('music:play', { id: song, state: 'calm' });
  }

  private installUi(hasGraph: boolean): void {
    const ui = new DemoUi({ play: () => (this.pendingPlay = true) });
    this.ui = ui;
    ui.setHope(this.state.hope);
    if (!hasGraph) ui.setMissing();
    this.offs.push(
      events.on('hope:changed', ({ value, delta }) => ui.setHope(value, delta)),
      events.on('state:reset', () => ui.setHope(services.tryGet('state')?.hope ?? 0)),
      events.on('lang:changed', () => ui.refresh()),
    );
  }

  // ------------------------------------------------------------------------------------------ per frame

  /** Fixed step: gamepad focus for the overlay; a play request starts on the next step, so the press that
   * made it (A is also "skip") is never seen by the dialogue panel. */
  private step(): void {
    if (this.pendingPlay) {
      this.pendingPlay = false;
      void this.play();
      return;
    }
    if (this.playing) return;
    const input = services.tryGet('input');
    if (input) this.ui?.padStep(input);
  }

  private frame(frameDt: number): void {
    const world = this.world;
    const rig = this.rig;
    if (!world || !rig) return;
    const loop = this.engine.loop;
    const dt = loop.paused ? 0 : frameDt * loop.timeScale;
    const reduceMotion = services.tryGet('settings')?.data.reduceMotion ?? false;
    rig.update(frameDt, false, reduceMotion);
    this.host?.update(frameDt, reduceMotion);
    rig.focus(this.focus);
    world.setShadowFocus(this.focus);
    world.update(dt, this.camera);
    this.talk?.update();
  }

  // ---------------------------------------------------------------------------------------------- debug

  private installDebug(): void {
    const debug = services.tryGet('debug');
    if (!debug) return;
    const g = DEBUG_GROUP;
    this.offs.push(
      debug.addReadout('Hope', () => String(Math.round(this.state.hope))),
      debug.addReadout('Dialogue', () => (this.playing ? 'playing' : 'idle')),
      debug.addReadout('Last shot', () => {
        const log = this.host?.log ?? [];
        for (let i = log.length - 1; i >= 0; i--) if (log[i]!.kind === 'cam') return log[i]!.detail;
        return '-';
      }),
      debug.addButton(g, 'Play sample', () => (this.pendingPlay = true)),
      debug.addButton(g, 'Stop', () => this.talk?.stop()),
      debug.addButton(g, 'Hope 50', () => this.state.setHope(DEMO_HOPE)),
      debug.addButton(g, 'Hope 20', () => this.state.setHope(20)),
    );
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
