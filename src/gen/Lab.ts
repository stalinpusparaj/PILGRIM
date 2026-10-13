/**
 * Character Lab (`?lab=1`, GDD 2.12): a dev tool to review the cast before chapters are built.
 *
 * - Turntable: one character on a round plinth, every animation (full body + upper-body overlays), the eight
 *   expressions, talking, the Burden size, live colour pickers and build sliders (the character is rebuilt on
 *   change), "Copy recipe JSON".
 * - Lineup: every recipe side by side (1.6 m apart) idling, blinking and changing faces on a staggered timer,
 *   seen from the gameplay camera distance (GDD 2.5), or a wide shot of the whole cast.
 * - Crowd of 100: the eight crowd recipes as instanced CrowdMeshes in a grid (draw-call check).
 * - Readouts: draw calls, triangles, the focused character's meshes/triangles and build time.
 *
 * The Lab is a System on the engine loop; it owns its scene, camera, panel and every character it builds.
 * Files: lab-stage (scene), lab-camera (shots), lab-cast (characters + anim state), lab-lineup (lineup, crowd),
 * lab-panel (DOM), lab-recipe (editing helpers).
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { System } from '../core/Loop';
import { events } from '../core/Events';
import { services } from '../core/Services';
import { PRESETS } from '../core/Quality';
import { isFormField, listen } from '../ui/dom';
import { CharacterFactory, type Character, type CharacterRecipe } from './CharacterFactory';
import { CLIPS } from './anim';
import { PALETTES, type PaletteId } from './palette';
import { LabStage } from './lab-stage';
import { LabCamera } from './lab-camera';
import { LabCast } from './lab-cast';
import { labReadouts } from './lab-readouts';
import type { LabInternals } from './lab-probe';
import { LabCrowd } from './lab-lineup';
import { LabPanel, type LabPanelHandlers, type LabShot, type LabView } from './lab-panel';
import { cloneRecipe, copyText, recipeJson, setBuild, setColour } from './lab-recipe';

const DEFAULT_FOV = 55;
/** Turntable spin (rad/s): a full turn in ~14 s. */
const SPIN_SPEED = 0.45;
const READOUT_SECONDS = 0.25;
/** Colour pickers and sliders fire continuously; rebuild at most this often (ms). */
const REBUILD_GAP_MS = 90;
const CROWD_SIZE = 100;
const CROWD_CENTER = new THREE.Vector3(0, 0, -11);
const CROWD_PREFIX = 'crowd_';
/** Look at this fraction of the character's height (head/chest), as the gameplay camera does. */
const LOOK_FRACTION = 0.62;
const FALLBACK_HEIGHT = 1.5;

export class Lab implements System {
  readonly updateWhenPaused = true;

  private stage: LabStage | null = null;
  private cam: LabCamera | null = null;
  private panel: LabPanel | null = null;
  private cast: LabCast | null = null;
  private crowd: LabCrowd | null = null;
  private crowdPalette: PaletteId = 'city';
  private controls: LabPanelHandlers | null = null;

  private recipes: Record<string, CharacterRecipe> = {};
  private ids: string[] = [];
  private readonly edits = new Map<string, CharacterRecipe>();
  private currentId = '';

  private view: LabView = 'turntable';
  private shot: LabShot = 'gameplay';
  private focus = 0;
  private rotate = true;
  private spin = 0;
  private time = 0;
  private rebuildDirty = false;
  private lastBuildAt = 0;
  private readoutTimer = 0;
  private removeSystem: (() => void) | null = null;
  private readonly offs: Array<() => void> = [];
  private started = false;
  private disposed = false;

  constructor(private readonly engine: Engine) {}

  /** Builds the scene, the panel and the first character, then joins the engine loop. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    const quality = services.tryGet('quality')?.preset ?? PRESETS.medium;
    const fov = services.tryGet('settings')?.data.fov ?? DEFAULT_FOV;

    this.recipes = CharacterFactory.recipes();
    this.ids = Object.keys(this.recipes);
    if (this.ids.length === 0) throw new Error('[Lab] content/characters/recipes.json has no recipes');

    const stage = new LabStage(quality);
    this.stage = stage;
    this.cam = new LabCamera(this.engine.canvas, fov);
    this.engine.setView(stage.scene, this.cam.camera);
    // The Lab is a tool screen: no pointer lock, no touch gameplay controls.
    services.tryGet('input')?.setGameplayActive(false);

    this.cast = new LabCast(stage, this.ids, (id) => this.recipeOf(id), {
      status: (text) => this.panel?.setStatus(text),
      anim: (name) => this.panel?.setActive('anim', name),
      overlay: (name) => this.panel?.setActive('overlay', name),
    });
    this.controls = this.handlers(this.cast);
    this.panel = new LabPanel(this.controls, {
      recipes: this.ids.map((id) => this.recipeOf(id)),
      clips: Object.values(CLIPS),
      palettes: Object.keys(PALETTES) as PaletteId[],
      crowdPalette: this.crowdPalette,
      moveSpeed: this.cast.moveSpeed,
    });
    this.panel.setView(this.view);
    this.panel.setActive('shot', this.shot);
    this.panel.setActive('anim', this.cast.anim);

    // Only the wide lineup shot depends on the aspect ratio; other shots keep the user's orbit.
    this.offs.push(
      events.on('resize', () => {
        if (this.view === 'lineup' && this.shot === 'wide') this.reframe(0);
      }),
      listen(window, 'keydown', this.onKey),
    );

    this.selectRecipe(this.ids[0]!);
    this.reframe(0);
    this.removeSystem = this.engine.loop.add(this, 0);
  }

  update(dt: number): void {
    if (this.disposed || !this.stage || !this.cast) return;
    this.time += dt;
    if (this.view === 'turntable' && this.rotate) {
      this.spin = (this.spin + SPIN_SPEED * dt) % (Math.PI * 2);
      this.stage.turntable.rotation.y = this.spin;
    }
    this.cast.update(dt, this.view === 'lineup');
    this.crowd?.update(this.time);
  }

  render(_alpha: number, frameDt: number): void {
    if (this.disposed || !this.stage || !this.cam || !this.cast) return;
    if (this.rebuildDirty && performance.now() - this.lastBuildAt >= REBUILD_GAP_MS) this.rebuild(true);
    this.cam.update(frameDt);
    this.stage.update(frameDt, this.cam.camera);
    this.readoutTimer += frameDt;
    if (this.readoutTimer >= READOUT_SECONDS) {
      this.readoutTimer = 0;
      this.refreshReadouts(this.cast);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeSystem?.();
    this.removeSystem = null;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.panel?.dispose();
    this.cam?.dispose();
    this.cast?.dispose();
    this.crowd?.dispose();
    const scene = this.stage?.scene;
    this.stage?.dispose();
    // Never leave the engine drawing a scene whose geometry is gone (it would be re-uploaded).
    if (scene && this.engine.scene === scene) {
      this.engine.setView(new THREE.Scene(), new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 500));
    }
    this.panel = null;
    this.controls = null;
    this.cam = null;
    this.cast = null;
    this.crowd = null;
    this.stage = null;
  }

  /** Test and console hook (`window.__pilgrim.lab`, lab-probe.ts): the panel's actions and the live cast. */
  inspect(): LabInternals | null {
    const { controls, cast, stage, cam } = this;
    if (!controls || !cast || !stage || !cam || this.disposed) return null;
    return {
      ids: this.ids,
      controls,
      cast,
      crowd: this.crowd,
      scene: stage.scene,
      blobs: stage.blobs,
      camera: cam.camera,
      turntable: stage.turntable,
      recipeOf: (id) => this.recipeOf(id),
    };
  }

  // ---------------------------------------------------------------- panel actions

  private handlers(cast: LabCast): LabPanelHandlers {
    return {
      selectRecipe: (id) => this.selectRecipe(id),
      setView: (v) => this.setView(v),
      setShot: (s) => {
        this.shot = s;
        this.panel?.setActive('shot', s);
        this.reframe();
      },
      step: (dir) => this.step(dir),
      setCrowd: (on) => this.setCrowd(on),
      setCrowdPalette: (id) => {
        this.crowdPalette = id;
        this.crowd?.tint(id);
      },
      setRotate: (on) => {
        this.rotate = on;
      },
      play: (name) => {
        const speed = cast.play(name);
        if (speed !== null) this.panel?.setMoveSpeed(speed);
        this.panel?.setActive('anim', name);
      },
      overlay: (name) => {
        cast.setOverlay(name);
        this.panel?.setActive('overlay', name);
      },
      setRepeat: (on) => {
        cast.repeat = on;
      },
      setMoveSpeed: (v) => cast.setMoveSpeed(v),
      setExpression: (e) => {
        cast.setExpression(e);
        this.panel?.setActive('expr', e);
      },
      setRandomFaces: (on) => cast.lineup?.setRandomFaces(on),
      setTalking: (on) => cast.setTalking(on),
      setBurden: (s) => cast.setBurden(s),
      setColour: (key, hex) => {
        setColour(this.editable(), key, hex);
        this.rebuildDirty = true;
      },
      setBuild: (key, v) => {
        setBuild(this.editable(), key, v);
        this.rebuildDirty = true;
      },
      resetRecipe: () => {
        this.edits.delete(this.currentId);
        this.rebuild(true);
        this.panel?.showRecipe(this.recipeOf(this.currentId), cast.burdenSize);
        this.panel?.setStatus('Reset to recipes.json');
      },
      copyJson: () => void this.copyJson(),
    };
  }

  private selectRecipe(id: string): void {
    const cast = this.cast;
    if (!cast || !this.recipes[id]) return;
    this.currentId = id;
    this.focus = this.ids.indexOf(id);
    const recipe = this.recipeOf(id);
    cast.expression = recipe.expression ?? 'neutral';
    cast.burdenSize = recipe.burden ? 1 : 0;
    this.rebuild(false);
    this.panel?.showRecipe(recipe, cast.burdenSize);
    this.panel?.setActive('recipe', id);
    this.panel?.setActive('expr', cast.expression);
    this.reframe();
  }

  private step(dir: -1 | 1): void {
    const n = this.ids.length;
    const i = (this.ids.indexOf(this.currentId) + dir + n) % n;
    this.selectRecipe(this.ids[i]!);
  }

  private setView(v: LabView): void {
    if (!this.stage || !this.cast) return;
    this.view = v;
    this.panel?.setView(v);
    this.stage.turntable.visible = v === 'turntable';
    this.cast.showLineup(v === 'lineup');
    this.reframe();
  }

  private setCrowd(on: boolean): void {
    if (!this.stage) return;
    if (on && !this.crowd) {
      const recipes = this.ids.filter((id) => id.startsWith(CROWD_PREFIX)).map((id) => this.recipeOf(id));
      if (recipes.length === 0) {
        this.panel?.setStatus('No crowd_* recipes in recipes.json');
        return;
      }
      this.crowd = new LabCrowd(
        recipes,
        CROWD_SIZE,
        CROWD_CENTER,
        this.crowdPalette,
        this.stage.sun,
        this.stage.blobs,
      );
      this.stage.scene.add(this.crowd.group);
      if (this.view === 'turntable' && this.shot !== 'wide') {
        this.shot = 'wide';
        this.panel?.setActive('shot', 'wide');
      }
    } else if (!on && this.crowd) {
      this.crowd.dispose();
      this.crowd = null;
    }
    this.reframe();
  }

  private async copyJson(): Promise<void> {
    const text = recipeJson(this.recipeOf(this.currentId));
    const result = await copyText(text);
    if (this.disposed) return;
    if (result === 'manual') {
      this.panel?.showJson(text);
      this.panel?.setStatus('Clipboard blocked: press Ctrl+C / Cmd+C');
    } else {
      this.panel?.setStatus(`Copied ${this.currentId} JSON`);
    }
  }

  // ---------------------------------------------------------------- recipes

  private recipeOf(id: string): CharacterRecipe {
    const r = this.edits.get(id) ?? this.recipes[id];
    if (!r) throw new Error(`[Lab] unknown recipe "${id}"`);
    return r;
  }

  /** The current recipe's editable copy (edits stay for the session; "Reset recipe" drops them). */
  private editable(): CharacterRecipe {
    let r = this.edits.get(this.currentId);
    if (!r) {
      r = cloneRecipe(this.recipeOf(this.currentId));
      this.edits.set(this.currentId, r);
    }
    return r;
  }

  private rebuild(syncLineup: boolean): void {
    this.rebuildDirty = false;
    this.cast?.rebuild(this.currentId, syncLineup);
    this.lastBuildAt = performance.now();
  }

  // ---------------------------------------------------------------- camera and readouts

  /** Moves the camera to the current shot and fits the shadow frustum to what is on show. */
  private reframe(seconds = 0.6): void {
    const { stage, cam, cast } = this;
    if (!stage || !cam || !cast) return;
    const subject = new THREE.Vector3();
    let height = cast.character?.height ?? FALLBACK_HEIGHT;
    let half = 2.5;
    const lineup = cast.lineup;
    if (this.view === 'lineup' && lineup) {
      lineup.slot(this.focus, subject);
      height = lineup.characters[this.focus]?.height ?? height;
      half = lineup.width / 2 + 1;
      if (this.shot === 'wide') cam.frameRow(new THREE.Vector3(), lineup.width, 0.9, seconds);
      else cam.shot(this.shot, subject, height * LOOK_FRACTION, seconds);
    } else {
      subject.set(0, stage.plinthTop, 0);
      cam.shot(this.shot, subject, height * LOOK_FRACTION, seconds);
    }
    if (this.crowd) {
      // Cover the cast and the crowd grid behind it.
      const back = Math.abs(CROWD_CENTER.z) + 7;
      stage.fitShadow(new THREE.Vector3(0, 0, -back / 2), Math.max(half, back / 2 + 1));
    } else {
      stage.fitShadow(new THREE.Vector3(), half);
    }
  }

  private focusCharacter(cast: LabCast): Character | null {
    if (this.view === 'lineup') return cast.lineup?.characters[this.focus] ?? null;
    return cast.character;
  }

  private refreshReadouts(cast: LabCast): void {
    const rows = labReadouts(this.engine, cast, this.focusCharacter(cast), this.crowd, this.ids.length);
    this.panel?.setReadouts(rows);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat || isFormField(e.target)) return;
    if (e.code === 'ArrowLeft') this.step(-1);
    else if (e.code === 'ArrowRight') this.step(1);
  };
}
