/**
 * `?chapter=test` dev surface of the ChapterManager: the public face the test world used to have (Phase 1
 * world checks read it as `window.__pilgrim.testWorld`): `ready`, `current` (the World), `play`, `camera`,
 * `progressLog` (every loading-bar value of the last build), the fly cameras (`setCameraMode`: follow = the
 * gameplay camera, orbit, overview; F1 buttons only, since keys 1-3 now pick dialogue choices) and
 * `rebuild()` (the chapter disposed and built again: the leak check).
 */
import type * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { PLAY_ORDER, type PlaySession } from './PlaySession';
import { TestCamera, type TestCameraMode } from './TestCamera';
import type { World } from './World';

const RESUME_BLEND = 0.8;

export interface DevChapterSource {
  readonly progressLog: number[];
  readonly session: PlaySession | null;
  readonly building: boolean;
  restart(): Promise<void>;
}

export class ChapterDevProbe {
  private mode: TestCameraMode = 'follow';
  private rig: TestCamera | null = null;
  private rigFor: PlaySession | null = null;
  private suspended = false;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly engine: Engine,
    private readonly src: DevChapterSource,
  ) {
    this.offs.push(
      engine.loop.add({ render: (_a, frameDt) => this.fly(frameDt) }, PLAY_ORDER.cameraOverride),
    );
    const debug = services.tryGet('debug');
    if (debug) {
      this.offs.push(
        debug.addButton('Chapter', 'Gameplay cam', () => this.setCameraMode('follow')),
        debug.addButton('Chapter', 'Orbit cam', () => this.setCameraMode('orbit')),
        debug.addButton('Chapter', 'Overview', () => this.setCameraMode('overview')),
        debug.addButton('Chapter', 'Rebuild chapter', () => void this.rebuild()),
      );
    }
  }

  /** Loading-bar values of the last build, in order. */
  get progressLog(): number[] {
    return this.src.progressLog;
  }

  get ready(): boolean {
    return this.src.session !== null && !this.src.building;
  }

  get current(): World | null {
    return this.src.session?.world ?? null;
  }

  get play(): PlaySession | null {
    return this.src.session;
  }

  get camera(): THREE.PerspectiveCamera | null {
    return this.src.session?.view ?? null;
  }

  get cameraMode(): TestCameraMode {
    return this.mode;
  }

  setCameraMode(mode: TestCameraMode): void {
    this.mode = mode;
    this.sync();
  }

  rebuild(): Promise<void> {
    this.detach();
    return this.src.restart();
  }

  /** The chapter is going: the fly rig lets go of its camera. */
  detach(): void {
    if (this.rigFor && this.suspended && !this.rigFor.isDisposed) this.rigFor.camera.resume(0);
    this.suspended = false;
    this.rig?.dispose();
    this.rig = null;
    this.rigFor = null;
  }

  dispose(): void {
    this.detach();
    for (const off of this.offs.splice(0)) off();
  }

  private sync(): void {
    const session = this.src.session;
    if (!session) return;
    if (this.rigFor !== session) {
      this.detach();
      this.rig = new TestCamera(
        session.view,
        this.engine.canvas,
        session.world.terrain,
        session.world.level.size,
      );
      this.rigFor = session;
    }
    this.rig!.setMode(this.mode);
    const fly = this.mode !== 'follow';
    if (fly !== this.suspended) {
      if (fly) session.camera.suspend();
      else session.camera.resume(RESUME_BLEND);
      this.suspended = fly;
    }
    services.tryGet('input')?.setGameplayActive(this.mode !== 'orbit');
    events.emit('hud:visible', { on: this.mode === 'follow' });
  }

  private fly(frameDt: number): void {
    const session = this.src.session;
    if (!session || session !== this.rigFor || !this.rig || this.mode === 'follow') return;
    const player = session.player;
    this.rig.update(frameDt, player.renderPosition, player.character.root.rotation.y, {
      burdened: session.state.burden,
      reduceMotion: services.tryGet('settings')?.data.reduceMotion ?? false,
    });
  }
}
