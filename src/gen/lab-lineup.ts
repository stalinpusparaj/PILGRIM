/**
 * Character Lab groups: the cast lineup (every recipe side by side on a low wooden stage, idling, blinking and
 * changing expression on a staggered timer) and the "crowd of 100" (instanced citizens via CrowdMesh).
 */
import * as THREE from 'three';
import { CharacterFactory, type Character, type CharacterRecipe } from './CharacterFactory';
import { CrowdMesh } from './CrowdMesh';
import { CrowdShadow } from './CrowdShadow';
import type { BlobShadows } from './BlobShadows';
import { bevelBox, merge, part } from './geom';
import { mat } from './materials';
import { getPalette, shade, vary, type PaletteId } from './palette';
import { Rng, hashString } from './rng';
import type { Yielder } from './yielder';
import { EXPRESSIONS, type Expression } from './lab-recipe';

/** Lineup spacing between characters (m). */
export const LINEUP_SPACING = 1.6;
const STAGE = { height: 0.12, depth: 1.5, margin: 0.9 };
/** Seconds between random expression changes, per character. */
const EXPRESSION_INTERVAL: [number, number] = [2.2, 4.8];
/** Chance a timed change goes back to the recipe's own default face. */
const BACK_TO_DEFAULT = 0.3;

export class LabLineup {
  readonly group = new THREE.Group();
  readonly characters: Character[] = [];
  /** Total CharacterFactory.build time for the whole lineup (ms). */
  buildMs = 0;

  private readonly stage: THREE.Mesh;
  private readonly timers: number[] = [];
  private readonly rng = new Rng(hashString('lab-lineup'));
  private randomFaces = true;
  readonly recipes: CharacterRecipe[];

  constructor(
    recipes: readonly CharacterRecipe[],
    private readonly blobs: BlobShadows,
  ) {
    this.recipes = [...recipes];
    this.group.name = 'lab-lineup';
    const width = Math.max(1, recipes.length - 1) * LINEUP_SPACING + STAGE.margin * 2;
    const pal = getPalette('test');
    const wood = shade(pal.ground.pathEdge, -0.1);
    const geo = merge([
      part(bevelBox(width, STAGE.height, STAGE.depth, 0.04), wood, { pos: [0, STAGE.height / 2, 0] }),
      part(bevelBox(width - 0.1, 0.02, STAGE.depth - 0.1, 0.01), pal.ground.path, {
        pos: [0, STAGE.height + 0.005, 0],
      }),
    ]);
    this.stage = new THREE.Mesh(geo, mat('lambert'));
    this.stage.name = 'lab-lineup-stage';
    this.stage.castShadow = true;
    this.stage.receiveShadow = true;
    this.group.add(this.stage);
  }

  /** Width of the row of characters (m). */
  get width(): number {
    return Math.max(0, this.recipes.length - 1) * LINEUP_SPACING;
  }

  /** Feet position of slot `i` in lineup space. */
  slot(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set((i - (this.recipes.length - 1) / 2) * LINEUP_SPACING, STAGE.height + 0.015, 0);
  }

  /** Builds every character, time-sliced so the page never freezes. Stops early when `cancelled()`. */
  async populate(
    y: Yielder,
    cancelled: () => boolean,
    onEach?: (c: Character, i: number) => void,
  ): Promise<void> {
    for (let i = this.characters.length; i < this.recipes.length; i++) {
      await y.tick();
      if (cancelled()) return;
      const c = this.buildOne(i);
      this.characters.push(c);
      this.timers.push(0.8 + i * 0.35 + this.rng.range(0, 1.2)); // staggered first change
      onEach?.(c, i);
    }
  }

  /** Swaps slot `i` for a fresh build of `recipe` (after a colour/build edit). Returns the new character. */
  replace(i: number, recipe: CharacterRecipe): Character | null {
    const old = this.characters[i];
    if (!old) return null;
    this.blobs.unfollow(old);
    old.root.removeFromParent();
    old.dispose();
    this.recipes[i] = recipe;
    const c = this.buildOne(i);
    this.characters[i] = c;
    return c;
  }

  /** Same face on everyone for `seconds`, then the random changes resume (staggered). */
  holdExpression(e: Expression, seconds: number): void {
    this.characters.forEach((c, i) => {
      c.setExpression(e);
      this.timers[i] = seconds + i * 0.12;
    });
  }

  setRandomFaces(on: boolean): void {
    this.randomFaces = on;
  }

  update(dt: number): void {
    for (let i = 0; i < this.characters.length; i++) {
      const c = this.characters[i]!;
      c.update(dt);
      if (!this.randomFaces) continue;
      const left = (this.timers[i] ?? 0) - dt;
      if (left > 0) {
        this.timers[i] = left;
        continue;
      }
      const next: Expression = this.rng.chance(BACK_TO_DEFAULT)
        ? (c.recipe.expression ?? 'neutral')
        : this.rng.pick(EXPRESSIONS);
      c.setExpression(next);
      this.timers[i] = this.rng.range(EXPRESSION_INTERVAL[0], EXPRESSION_INTERVAL[1]);
    }
  }

  dispose(): void {
    for (const c of this.characters) {
      this.blobs.unfollow(c);
      c.root.removeFromParent();
      c.dispose();
    }
    this.characters.length = 0;
    this.stage.geometry.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }

  private buildOne(i: number): Character {
    const recipe = this.recipes[i]!;
    const t0 = performance.now();
    const c = CharacterFactory.build(recipe, new Rng(hashString(recipe.id)));
    this.buildMs += performance.now() - t0;
    c.mesh.castShadow = true;
    this.slot(i, c.root.position);
    c.root.rotation.set(0, 0, 0);
    this.group.add(c.root);
    this.blobs.follow(c);
    // Desync idle breathing and blinks: advance each character by a different short warm-up.
    const warm = this.rng.int(0, 40);
    for (let k = 0; k < warm; k++) c.update(1 / 30);
    return c;
  }
}

/** Where a crowd citizen stands; kept so the crowd can be re-tinted without moving. */
interface Placement {
  mesh: CrowdMesh;
  index: number;
  pos: THREE.Vector3;
  rotY: number;
  phase: number;
  r: number;
}

const CROWD = { cols: 10, spacing: 1.35, jitter: 0.3, turn: 0.6 };

/**
 * A grid of instanced citizens: one CrowdMesh (1 draw call) per crowd recipe, plus one CrowdShadow that draws
 * every citizen's shadow into `sun`'s shadow map (1 more call when shadows are on). Their blob shadows join the
 * stage's BlobShadows (the scene's one blob call, already drawn for the cast).
 */
export class LabCrowd {
  readonly group = new THREE.Group();
  readonly meshes: CrowdMesh[] = [];
  readonly shadow: CrowdShadow;
  readonly total: number;
  private readonly placements: Placement[] = [];

  constructor(
    recipes: readonly CharacterRecipe[],
    total: number,
    center: THREE.Vector3,
    palette: PaletteId,
    sun: THREE.DirectionalLight,
    private readonly blobs: BlobShadows,
  ) {
    this.group.name = 'lab-crowd';
    this.total = recipes.length > 0 ? total : 0;
    this.shadow = new CrowdShadow(Math.max(1, this.total), sun);
    this.group.add(this.shadow.mesh);
    if (this.total === 0) return;
    const rng = new Rng(hashString('lab-crowd'));
    const perRecipe = Math.ceil(total / recipes.length);
    for (const r of recipes) {
      const m = new CrowdMesh(r, perRecipe);
      m.count = 0;
      m.mesh.name = `lab-crowd-${r.id}`;
      this.meshes.push(m);
      this.group.add(m.mesh);
      blobs.addCrowd(m);
    }

    // Shuffle the grid slots so body types mix, then deal recipes round-robin (even counts per mesh).
    const slots = Array.from({ length: total }, (_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [slots[i], slots[j]] = [slots[j]!, slots[i]!];
    }
    const rows = Math.ceil(total / CROWD.cols);
    for (let n = 0; n < total; n++) {
      const s = slots[n]!;
      const col = s % CROWD.cols;
      const row = Math.floor(s / CROWD.cols);
      const mesh = this.meshes[n % this.meshes.length]!;
      const pos = new THREE.Vector3(
        center.x + (col - (CROWD.cols - 1) / 2) * CROWD.spacing + rng.range(-CROWD.jitter, CROWD.jitter),
        center.y,
        center.z + (row - (rows - 1) / 2) * CROWD.spacing + rng.range(-CROWD.jitter, CROWD.jitter),
      );
      const index = mesh.count;
      mesh.count = index + 1;
      const rotY = rng.range(-CROWD.turn, CROWD.turn); // roughly facing the camera (+Z)
      this.shadow.set(n, pos, rotY, mesh.height, mesh.width);
      this.placements.push({ mesh, index, pos, rotY, phase: rng.range(0, Math.PI * 2), r: rng.next() });
    }
    this.tint(palette);
  }

  /** Re-tints every citizen from a chapter palette (crowds take their clothing colours from the chapter). */
  tint(palette: PaletteId): void {
    const tints = crowdTints(palette);
    for (const p of this.placements) {
      const base = tints[Math.floor(p.r * tints.length) % tints.length]!;
      p.mesh.set(p.index, p.pos, p.rotY, vary(base, 0.06, (p.r * 7.31) % 1), p.phase);
    }
  }

  /** Draw calls for the whole crowd: one per body type, plus one for every citizen's shadow. */
  drawCalls(shadows: boolean): number {
    let n = 0;
    for (const m of this.meshes) if (m.count > 0) n += m.mesh.castShadow && shadows ? 2 : 1;
    return n + (shadows && this.shadow.count > 0 ? 1 : 0);
  }

  update(t: number): void {
    for (const m of this.meshes) m.update(t);
  }

  dispose(): void {
    for (const m of this.meshes) {
      this.blobs.removeCrowd(m);
      m.mesh.removeFromParent();
      m.dispose();
    }
    this.meshes.length = 0;
    this.shadow.dispose();
    this.placements.length = 0;
    this.group.removeFromParent();
  }
}

/** Clothing tints for a palette: its GDD accents plus a few ground tones (some palettes have no accents). */
export function crowdTints(id: PaletteId): string[] {
  const pal = getPalette(id);
  const g = pal.ground;
  return [...Object.values(pal.accents), g.mid, g.path, g.pathEdge, g.detour, pal.water.shallow];
}
