/**
 * Who drives the active camera. The gameplay follow camera (src/player/Camera.ts, Phase 2) registers itself as the
 * 'cameraRig' service; cutscenes and dialogue camera cuts (src/narrative/Cutscene.ts, Phase 3) suspend it, move
 * `engine.camera` themselves, then resume it (it blends back from wherever the camera was left).
 */
import type * as THREE from 'three';

export interface CameraRig {
  /** True while a cutscene/dialogue owns the camera. */
  readonly suspended: boolean;
  /** Stop driving the camera (it keeps its last transform). Nested calls are counted. */
  suspend(): void;
  /** Take the camera back, blending from its current transform over `blend` seconds (default 0.6). */
  resume(blend?: number): void;
  /** Point of interest the follow camera looks at (the player's head height), for cutscene framing. */
  focus(out: THREE.Vector3): THREE.Vector3;
}

declare module './Services' {
  interface ServiceMap {
    cameraRig: CameraRig;
  }
}
