/**
 * Renderer, active view and frame loop (GDD 2.15 "Stack" / "Engine rules").
 *
 * Owns the WebGLRenderer (MSAA, sRGB output, ACES tone mapping), keeps the drawing buffer matched to
 * the canvas size and a capped device pixel ratio, survives WebGL context loss, and renders the
 * active scene/camera as the last system of the Loop.
 */
import * as THREE from 'three';
import { events } from './Events';
import { services } from './Services';
import { Loop, type System } from './Loop';
import { t } from './I18n';
import { COARSE_POINTER_QUERY, PRESETS, isCoarsePointer, type QualityPreset } from './Quality';

declare module './Services' {
  interface ServiceMap {
    engine: Engine;
  }
}

export interface EngineStats {
  /** Rendered frames per second, averaged over ~0.5 s. */
  fps: number;
  /** CPU ms per rendered frame (fixed steps + render submission), averaged over ~0.5 s. */
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

const DPR_CAP_DESKTOP = 2;
const DPR_CAP_MOBILE = 1.5;
const MIN_RESOLUTION_SCALE = 0.5;
const RENDER_ORDER = 1000;
const STATS_WINDOW_SEC = 0.5;
const DEFAULT_FOV = 55;

/** Fallback look for the context-loss overlay, used only if no stylesheet styles `.ctx-overlay`. */
const OVERLAY_STYLE = [
  'position:fixed',
  'inset:0',
  'z-index:1000',
  'display:flex',
  'align-items:center',
  'justify-content:center',
  'padding:16px',
  'text-align:center',
  'background:rgba(28,22,36,0.85)',
  'color:#fff7e8',
  'font-size:clamp(20px,4vw,32px)',
  'font-weight:600',
  'pointer-events:auto',
].join(';');

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly loop: Loop;
  /** Active scene (set by whoever owns the current mode). */
  scene: THREE.Scene;
  /** Active camera. */
  camera: THREE.PerspectiveCamera;
  readonly stats: EngineStats = {
    fps: 0,
    frameMs: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
  };

  private quality: QualityPreset = PRESETS.medium;
  private resolutionScale = 1;
  private coarse: boolean;
  private readonly coarseQuery: MediaQueryList | null;
  private resizeObserver: ResizeObserver | null = null;

  private cssWidth = 0;
  private cssHeight = 0;
  private pixelRatioApplied = 0;
  private devicePixelRatioSeen = 0;
  private sizeDirty = true;
  private aspectCamera: THREE.PerspectiveCamera | null = null;
  private aspectValue = 0;
  /** Shadow state last applied to each scene: mapSize * 2 + (enabled ? 1 : 0). Numbers, so no per-frame garbage. */
  private sceneShadowState = new WeakMap<THREE.Object3D, number>();

  private lost = false;
  private overlay: HTMLDivElement | null = null;
  private overlayFallback = false;
  private canvasStyled = false;
  private readyEmitted = false;
  private disposed = false;
  private readonly removeRenderSystem: () => void;

  private statFrames = 0;
  private statTime = 0;
  private statWork = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.applyFallbackCanvasStyle();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES at exposure 1 measured best (Phase 2 colour pass): sunlit ground lands within ~2.5 dE of its vertex
    // colour; AgX greys the world (chroma x0.64), Neutral oversaturates and darkens. Dark faces were the light
    // balance, fixed in palette.ts.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // r186 removed PCFSoftShadowMap; PCFShadowMap is the soft-filtered PCF path now.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.enabled = this.quality.shadows;

    // A default view so rendering never crashes before a mode sets its own.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 500);

    this.coarse = isCoarsePointer();
    this.coarseQuery =
      typeof window.matchMedia === 'function' ? window.matchMedia(COARSE_POINTER_QUERY) : null;
    this.coarseQuery?.addEventListener('change', this.onPointerChange);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(canvas);
    }
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.loop = new Loop();
    const renderSystem: System = { render: (_alpha, frameDt) => this.renderFrame(frameDt) };
    this.removeRenderSystem = this.loop.add(renderSystem, RENDER_ORDER);

    this.applySize();
    services.register('engine', this);
  }

  /** True between 'context:lost' and 'context:restored'. */
  get contextLost(): boolean {
    return this.lost;
  }

  /** Pixel ratio currently applied to the drawing buffer. */
  get pixelRatio(): number {
    return this.pixelRatioApplied;
  }

  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
    this.syncCameraAspect();
    this.syncSceneShadows(scene);
  }

  /** Pixel ratio cap, shadows on/off and shadow map size. Shadow-casting lights added later should
   *  read `services.get('quality').preset.shadowMapSize` themselves. */
  applyQuality(preset: QualityPreset): void {
    this.quality = preset;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.syncSceneShadows(this.scene);
    this.sizeDirty = true;
    this.applySize();
  }

  /** 0.5..1, multiplies the (capped) device pixel ratio. */
  setResolutionScale(scale: number): void {
    const clamped = Number.isFinite(scale) ? Math.min(1, Math.max(MIN_RESOLUTION_SCALE, scale)) : 1;
    if (clamped === this.resolutionScale) return;
    this.resolutionScale = clamped;
    this.sizeDirty = true;
    this.applySize();
  }

  start(): void {
    if (this.disposed) return;
    this.loop.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.removeRenderSystem();

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.coarseQuery?.removeEventListener('change', this.onPointerChange);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.overlay?.remove();
    this.overlay = null;
    this.removeFallbackCanvasStyle();
    this.renderer.dispose();
    if (services.tryGet('engine') === this) services.unregister('engine');
  }

  // ---------------------------------------------------------------- frame

  private adaptiveScale = 1;
  private adaptiveTime = 0;
  private adaptiveFrames = 0;

  private renderFrame(frameDt: number): void {
    if (this.disposed) return;
    if (this.sizeDirty || window.devicePixelRatio !== this.devicePixelRatioSeen) this.applySize();
    if (this.lost) return;

    // `scene` and `camera` are public fields; catch direct assignment as well as setView().
    if (this.camera !== this.aspectCamera || this.camera.aspect !== this.aspectValue) this.syncCameraAspect();
    this.syncSceneShadows(this.scene);

    this.renderer.render(this.scene, this.camera);
    this.updateStats(frameDt);
    this.adaptMobileResolution(frameDt);

    if (!this.readyEmitted) {
      this.readyEmitted = true;
      events.emit('engine:ready');
    }
  }

  /** Slow windows avoid oscillation. Only auto-quality mobile play changes resolution. */
  private adaptMobileResolution(dt: number): void {
    if (!this.coarse || this.loop.paused || services.tryGet('quality')?.setting !== 'auto') {
      this.adaptiveTime = 0;
      this.adaptiveFrames = 0;
      if (this.adaptiveScale !== 1) { this.adaptiveScale = 1; this.sizeDirty = true; }
      return;
    }
    if (dt <= 0 || dt > 0.1) return;
    this.adaptiveTime += dt;
    this.adaptiveFrames++;
    if (this.adaptiveTime < 5) return;
    const fps = this.adaptiveFrames / this.adaptiveTime;
    const target = this.loop.frameCap;
    const next = fps < target * 0.78 ? Math.max(0.65, this.adaptiveScale - 0.1)
      : fps > target * 0.96 ? Math.min(1, this.adaptiveScale + 0.05) : this.adaptiveScale;
    if (next !== this.adaptiveScale) { this.adaptiveScale = next; this.sizeDirty = true; }
    this.adaptiveTime = 0;
    this.adaptiveFrames = 0;
  }

  private updateStats(frameDt: number): void {
    const info = this.renderer.info; // autoReset stays true: render counters are per frame
    const s = this.stats;
    s.drawCalls = info.render.calls;
    s.triangles = info.render.triangles;
    s.geometries = info.memory.geometries;
    s.textures = info.memory.textures;

    this.statFrames++;
    this.statTime += frameDt;
    this.statWork += performance.now() - this.loop.frameStartMs;
    if (this.statTime >= STATS_WINDOW_SEC) {
      s.fps = this.statFrames / this.statTime;
      s.frameMs = this.statWork / this.statFrames;
      this.statFrames = 0;
      this.statTime = 0;
      this.statWork = 0;
    }
  }

  // ---------------------------------------------------------------- size

  private readonly onResize = (): void => {
    this.sizeDirty = true;
  };

  private readonly onPointerChange = (): void => {
    this.coarse = isCoarsePointer();
    this.sizeDirty = true;
  };

  private targetPixelRatio(): number {
    const device = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const cap = Math.min(this.coarse ? DPR_CAP_MOBILE : DPR_CAP_DESKTOP, this.quality.pixelRatioCap);
    return Math.min(device, cap) * this.resolutionScale * this.adaptiveScale;
  }

  /** Matches the drawing buffer to the canvas CSS size × capped pixel ratio. Emits 'resize' on CSS size change. */
  private applySize(): void {
    this.sizeDirty = false;
    this.devicePixelRatioSeen = window.devicePixelRatio;
    const width = Math.max(1, Math.round(this.canvas.clientWidth || window.innerWidth || 1));
    const height = Math.max(1, Math.round(this.canvas.clientHeight || window.innerHeight || 1));
    const ratio = this.targetPixelRatio();
    const cssChanged = width !== this.cssWidth || height !== this.cssHeight;
    if (!cssChanged && ratio === this.pixelRatioApplied) return;

    this.cssWidth = width;
    this.cssHeight = height;
    this.pixelRatioApplied = ratio;
    // One buffer reallocation; CSS (not three) owns the canvas's displayed size.
    this.renderer.setDrawingBufferSize(width, height, ratio);
    this.syncCameraAspect();
    if (cssChanged) events.emit('resize', { width, height });
  }

  private syncCameraAspect(): void {
    const aspect = this.cssHeight > 0 ? this.cssWidth / this.cssHeight : 1;
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    this.aspectCamera = this.camera;
    this.aspectValue = aspect;
  }

  /**
   * The canvas is sized by CSS and the drawing buffer follows it. If no stylesheet positions the canvas,
   * pin it full-screen so the measure → resize cycle cannot grow without bound.
   */
  private applyFallbackCanvasStyle(): void {
    const style = this.canvas.style;
    if (style.width || style.height || getComputedStyle(this.canvas).position !== 'static') return;
    style.position = 'fixed';
    style.inset = '0';
    style.width = '100%';
    style.height = '100%';
    style.display = 'block';
    this.canvasStyled = true;
  }

  private removeFallbackCanvasStyle(): void {
    if (!this.canvasStyled) return;
    for (const prop of ['position', 'inset', 'width', 'height', 'display'])
      this.canvas.style.removeProperty(prop);
    this.canvasStyled = false;
  }

  // ---------------------------------------------------------------- shadows

  /**
   * Brings a scene in line with the shadow preset: resizes (and frees) shadow maps of shadow-casting
   * lights, and flags materials for recompilation when shadows were toggled (three bakes that into
   * the shader program).
   */
  private syncSceneShadows(root: THREE.Object3D): void {
    const enabled = this.renderer.shadowMap.enabled;
    const size = this.quality.shadowMapSize;
    const state = size * 2 + (enabled ? 1 : 0);
    const previous = this.sceneShadowState.get(root);
    if (previous === state) return;
    this.sceneShadowState.set(root, state);
    const toggled = previous === undefined || (previous & 1) !== (state & 1);

    root.traverse((obj) => {
      if ((obj instanceof THREE.DirectionalLight || obj instanceof THREE.SpotLight) && obj.castShadow) {
        const shadow = obj.shadow;
        const resized = shadow.mapSize.x !== size || shadow.mapSize.y !== size;
        if (resized) shadow.mapSize.set(size, size);
        if ((resized || !enabled) && shadow.map) {
          shadow.map.dispose(); // re-created at the new size on the next shadow pass
          shadow.map = null;
        }
      } else if (toggled && obj instanceof THREE.Mesh) {
        const material: THREE.Material | THREE.Material[] = obj.material;
        if (Array.isArray(material)) for (const m of material) m.needsUpdate = true;
        else material.needsUpdate = true;
      }
    });
  }

  // ---------------------------------------------------------------- context loss

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault(); // allows the browser to restore the context
    if (this.lost) return;
    this.lost = true;
    this.showOverlay(true);
    events.emit('context:lost');
  };

  private readonly onContextRestored = (): void => {
    if (!this.lost) return;
    this.lost = false;
    // three re-creates its GL state; re-apply our per-scene state and buffer size on the next frame.
    this.sceneShadowState = new WeakMap();
    this.pixelRatioApplied = 0;
    this.sizeDirty = true;
    this.showOverlay(false);
    events.emit('context:restored');
  };

  private showOverlay(visible: boolean): void {
    if (!visible) {
      if (this.overlay) this.overlay.style.display = 'none';
      return;
    }
    if (!this.overlay) {
      const el = document.createElement('div');
      el.className = 'ctx-overlay';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.append(document.createElement('span'));
      (document.getElementById('ui') ?? document.body).appendChild(el);
      // Inline fallback only when no stylesheet styles `.ctx-overlay` (it would override styles.css).
      this.overlayFallback = getComputedStyle(el).position === 'static';
      if (this.overlayFallback) el.style.cssText = OVERLAY_STYLE;
      this.overlay = el;
    }
    const label = this.overlay.firstElementChild;
    if (label) label.textContent = t('ui.context.restoring');
    this.overlay.style.display = this.overlayFallback ? 'flex' : '';
  }
}
