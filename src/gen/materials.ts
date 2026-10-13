/**
 * Shared, app-lifetime materials (GDD 2.11: one shared material per material type to keep draw calls and shader
 * programs low). Chapters never dispose these. Every material reads vertex colours; lit ones are flat-shaded.
 */
import * as THREE from 'three';

export type MaterialKind =
  'lambert' | 'toon' | 'glow' | 'skinned' | 'path' | 'unlit' | 'unlitTransparent' | 'decal';

const cache = new Map<MaterialKind, THREE.Material>();
let toonRamp: THREE.DataTexture | null = null;

/** A 3-step lighting ramp generated in code (no image file). */
function getToonRamp(): THREE.DataTexture {
  if (!toonRamp) {
    const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
    toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.generateMipmaps = false;
    toonRamp.needsUpdate = true;
  }
  return toonRamp;
}

function create(kind: MaterialKind): THREE.Material {
  switch (kind) {
    case 'lambert':
    case 'skinned': // three.js enables skinning per object, so the same material type serves SkinnedMesh
      return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    case 'toon':
      return new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp() });
    case 'path':
      // The Way ribbon sits a hair above the terrain; polygon offset avoids z-fighting.
      return new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    case 'glow':
      // Unlit and bright: candle flames, the far light, Shining Ones. Picked up by bloom on High.
      return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    case 'unlit':
      return new THREE.MeshBasicMaterial({ vertexColors: true });
    case 'unlitTransparent':
      return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    case 'decal':
      // Flat marks laid on the ground (character blob shadows): RGBA vertex colours, drawn over the terrain and
      // the Way ribbon (which has its own offset) without z-fighting, never writing depth.
      return new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
  }
}

export function mat(kind: MaterialKind): THREE.Material {
  let m = cache.get(kind);
  if (!m) {
    m = create(kind);
    m.name = `shared:${kind}`;
    cache.set(kind, m);
  }
  return m;
}

/** Only for app shutdown / tests. Chapters must not call this. */
export function disposeSharedMaterials(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
  toonRamp?.dispose();
  toonRamp = null;
}
