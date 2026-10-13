/**
 * Quality presets (GDD 2.11 / 2.15 budgets) and the 'auto' level picker.
 *
 * 'auto' runs a short in-house GPU benchmark once (first launch) and caches the result in
 * localStorage. The benchmark renders our own flat-shaded instanced icosahedrons offscreen; no assets.
 */
import * as THREE from 'three';
import { events } from './Events';
import { services } from './Services';

export type QualityLevel = 'low' | 'medium' | 'high';
export type QualitySetting = QualityLevel | 'auto';

export interface QualityPreset {
  level: QualityLevel;
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  drawDistance: number;
  grassDensity: number;
  crowdMax: number;
  particlesMax: number;
  bloom: boolean;
  rimLight: boolean;
  maxDrawCalls: number;
}

declare module './Services' {
  interface ServiceMap {
    quality: Quality;
  }
}

/** Desktop presets. Touch devices get smaller shadow maps and the mobile draw-call budget (see adapt()). */
export const PRESETS: Record<QualityLevel, QualityPreset> = Object.freeze({
  low: Object.freeze({
    level: 'low',
    pixelRatioCap: 1,
    shadows: false, // GDD 2.11: shadows off on Low; blob shadows still drawn by characters
    shadowMapSize: 512, // unused: Low never renders shadows, whatever the Shadows setting (DECISIONS #77)
    drawDistance: 120,
    grassDensity: 0.35,
    crowdMax: 12,
    particlesMax: 200,
    bloom: false,
    rimLight: false,
    maxDrawCalls: 80,
  }),
  medium: Object.freeze({
    level: 'medium',
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    drawDistance: 200,
    grassDensity: 0.7,
    crowdMax: 30,
    particlesMax: 500,
    bloom: false,
    rimLight: false,
    maxDrawCalls: 120,
  }),
  high: Object.freeze({
    level: 'high',
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 1024, // GDD 2.11 STYLE LOCK: one 1024 shadow map on desktop
    drawDistance: 300,
    grassDensity: 1,
    crowdMax: 60,
    particlesMax: 1000,
    bloom: true,
    rimLight: true,
    maxDrawCalls: 150,
  }),
});

const LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
const BENCH_STORAGE_KEY = 'pilgrim.quality.bench.v1';
export const COARSE_POINTER_QUERY = '(pointer: coarse)';
/** Shortest screen side (CSS px) at or below which a touch device counts as a phone/small tablet. */
const SMALL_SCREEN_MAX_PX = 820;
/** Median benchmark frame time thresholds (ms, includes the read-back sync). Tunable on real devices. */
const HIGH_MAX_MS = 4;
const MEDIUM_MAX_MS = 9;
/** Mobile budget from GDD 2.15 (< 80 draw calls). */
const MOBILE_MAX_DRAW_CALLS = 80;

const BENCH = {
  instances: 200,
  detail: 3, // 320 faces per icosahedron, ~64k triangles total
  width: 960,
  height: 540,
  msaaSamples: 4, // matches antialias: true
  warmupFrames: 2,
  frames: 36,
  minFrames: 5,
  deadlineMs: 850, // whole benchmark incl. shader compile stays under 1 s
  compileWaitMs: 300,
  yieldEvery: 6, // let the loading screen breathe
} as const;

export function isQualityLevel(value: unknown): value is QualityLevel {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

export function isCoarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(COARSE_POINTER_QUERY).matches;
  } catch {
    return false;
  }
}

/** Coarse pointer and a small screen: never auto-picks High. */
export function isSmallTouchScreen(): boolean {
  if (!isCoarsePointer()) return false;
  const shortest =
    typeof screen !== 'undefined' && screen.width > 0
      ? Math.min(screen.width, screen.height)
      : Math.min(window.innerWidth, window.innerHeight);
  return shortest <= SMALL_SCREEN_MAX_PX;
}

/** Touch devices: shadow map at most 512 (1024 on High) and the mobile draw-call budget. */
function adapt(base: QualityPreset, coarse: boolean): QualityPreset {
  if (!coarse) return base;
  return Object.freeze({
    ...base,
    shadowMapSize: Math.min(base.shadowMapSize, base.level === 'high' ? 1024 : 512),
    maxDrawCalls: Math.min(base.maxDrawCalls, MOBILE_MAX_DRAW_CALLS),
  });
}

function levelForMs(ms: number): QualityLevel {
  if (ms <= HIGH_MAX_MS) return 'high';
  if (ms <= MEDIUM_MAX_MS) return 'medium';
  return 'low';
}

interface BenchRecord {
  v: 1;
  medianMs: number;
  frames: number;
  at: number;
}

function readBenchCache(): BenchRecord | null {
  try {
    const raw = localStorage.getItem(BENCH_STORAGE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const rec = data as Partial<Record<keyof BenchRecord, unknown>>;
    if (
      rec.v !== 1 ||
      typeof rec.medianMs !== 'number' ||
      !Number.isFinite(rec.medianMs) ||
      rec.medianMs <= 0
    ) {
      return null;
    }
    return {
      v: 1,
      medianMs: rec.medianMs,
      frames: typeof rec.frames === 'number' ? rec.frames : 0,
      at: typeof rec.at === 'number' ? rec.at : 0,
    };
  } catch {
    return null;
  }
}

function writeBenchCache(record: BenchRecord): void {
  try {
    localStorage.setItem(BENCH_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage blocked or full: the benchmark simply runs again next launch.
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Renders ~200 instanced flat-shaded icosahedrons with a sun + sky light into an MSAA render target,
 * syncing each frame with a 1-pixel read-back. Returns the median frame time in ms and the frame count.
 * Disposes everything it creates and restores the renderer's render target.
 */
async function runBenchmark(renderer: THREE.WebGLRenderer): Promise<{ medianMs: number; frames: number }> {
  if (renderer.getContext().isContextLost()) throw new Error('WebGL context is lost');
  const started = performance.now();
  const previousTarget = renderer.getRenderTarget();

  const target = new THREE.WebGLRenderTarget(BENCH.width, BENCH.height, { samples: BENCH.msaaSamples });
  const geometry = new THREE.IcosahedronGeometry(0.48, BENCH.detail);
  const material = new THREE.MeshLambertMaterial({ flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, BENCH.instances);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  const sky = new THREE.HemisphereLight(0xcfe8ff, 0x6b5a3a, 0.9);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, BENCH.width / BENCH.height, 0.1, 50);

  try {
    // 10 x 5 x 4 grid, deterministic jitter and colours (golden-ratio sequence), layers overlap for overdraw.
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < BENCH.instances; i++) {
      const jitter = (i * 0.618034) % 1;
      const x = (i % 10) - 4.5 + (jitter - 0.5) * 0.3;
      const y = (Math.floor(i / 10) % 5) - 2 + (jitter - 0.5) * 0.3;
      const z = -Math.floor(i / 50) * 1.1;
      matrix.makeTranslation(x * 1.05, y * 1.05, z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.setHSL(jitter, 0.55, 0.6));
    }
    scene.background = new THREE.Color(0x9cc9e8);
    sun.position.set(3, 5, 4);
    scene.add(mesh, sun, sky);
    camera.position.set(0, 0, 6.2);
    camera.lookAt(0, 0, -1.6);

    // Compile with the target bound (programs depend on it), then restore before awaiting so the
    // renderer is never left pointing at our target while other code might render.
    renderer.setRenderTarget(target);
    const compiled = renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(previousTarget);
    await Promise.race([compiled, delay(BENCH.compileWaitMs)]);

    const pixel = new Uint8Array(4);
    const frame = (): number => {
      mesh.rotation.y += 0.004; // keep the grid filling the view
      const t0 = performance.now();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel); // blocks until the GPU is done
      return performance.now() - t0;
    };

    for (let i = 0; i < BENCH.warmupFrames; i++) frame();
    const times: number[] = [];
    while (times.length < BENCH.frames) {
      times.push(frame());
      if (times.length >= BENCH.minFrames && performance.now() - started > BENCH.deadlineMs) break;
      if (times.length % BENCH.yieldEvery === 0) await delay(0);
    }
    if (renderer.getContext().isContextLost()) throw new Error('WebGL context lost during benchmark');
    return { medianMs: median(times), frames: times.length };
  } finally {
    renderer.setRenderTarget(previousTarget);
    scene.clear();
    mesh.dispose();
    geometry.dispose();
    material.dispose();
    sun.dispose();
    sky.dispose();
    target.dispose();
  }
}

export class Quality {
  private current: QualityPreset;
  private chosen: QualitySetting = 'auto';
  private benchMs: number | null = null;
  /** Bumped by every set(); an auto pick that finishes after a manual set() is discarded. */
  private version = 0;
  private pending: Promise<QualityLevel> | null = null;

  constructor() {
    this.current = adapt(PRESETS.medium, isCoarsePointer());
    services.register('quality', this);
  }

  /** The active preset (already adapted for touch devices). */
  get preset(): QualityPreset {
    return this.current;
  }

  get level(): QualityLevel {
    return this.current.level;
  }

  /** The last setting passed to resolve(): a level, or 'auto'. */
  get setting(): QualitySetting {
    return this.chosen;
  }

  /** Median benchmark frame time in ms once 'auto' has resolved (from cache or a fresh run). */
  get benchmarkMs(): number | null {
    return this.benchMs;
  }

  /**
   * Resolves a setting to a preset and applies it with set(). 'auto' runs the benchmark once (first
   * launch) and caches it; later launches reuse the cache. Call it before the loop starts.
   */
  async resolve(setting: QualitySetting, renderer: THREE.WebGLRenderer): Promise<QualityPreset> {
    if (isQualityLevel(setting)) {
      this.chosen = setting;
      this.set(setting);
      return this.current;
    }
    this.chosen = 'auto';
    const version = this.version;
    const level = await this.autoLevel(renderer);
    if (this.version === version && this.chosen === 'auto') this.set(level);
    return this.current;
  }

  /** Applies a level and emits 'quality:changed' (also when the level is unchanged, so listeners re-sync). */
  set(level: QualityLevel): void {
    if (!isQualityLevel(level)) {
      console.warn(`[quality] unknown level "${String(level)}" ignored`);
      return;
    }
    this.version++;
    this.current = adapt(PRESETS[level], isCoarsePointer());
    events.emit('quality:changed', { level });
  }

  /** Debug: forget the cached benchmark so the next resolve('auto') measures again. */
  forgetBenchmark(): void {
    this.benchMs = null;
    try {
      localStorage.removeItem(BENCH_STORAGE_KEY);
    } catch {
      // Storage blocked: nothing cached anyway.
    }
  }

  private autoLevel(renderer: THREE.WebGLRenderer): Promise<QualityLevel> {
    this.pending ??= this.measure(renderer).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async measure(renderer: THREE.WebGLRenderer): Promise<QualityLevel> {
    let level: QualityLevel;
    const cached = readBenchCache();
    if (cached) {
      this.benchMs = cached.medianMs;
      level = levelForMs(cached.medianMs);
    } else {
      try {
        const result = await runBenchmark(renderer);
        this.benchMs = result.medianMs;
        level = levelForMs(result.medianMs);
        writeBenchCache({
          v: 1,
          medianMs: Math.round(result.medianMs * 100) / 100,
          frames: result.frames,
          at: Date.now(),
        });
      } catch (err) {
        console.warn('[quality] benchmark failed; using medium', err);
        level = 'medium';
      }
    }
    // Phones and small tablets never auto-pick High (the player can still choose it).
    if (level === 'high' && isSmallTouchScreen()) level = 'medium';
    return level;
  }
}
