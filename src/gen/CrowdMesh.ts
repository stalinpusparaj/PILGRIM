/**
 * Instanced crowds (GDD 2.12): one InstancedMesh per crowd recipe/body type, built from the same parts as a
 * character but static (no skeleton) and at a lower LOD. A `tint` vertex attribute marks the main clothing (1) so
 * the per-instance colour recolours only that, never skin, face or hair; a vertex-shader bob/sway driven by `uTime`
 * and a per-instance phase keeps the crowd alive. One draw call per CrowdMesh.
 */
import * as THREE from 'three';
import { colorOf } from './geom';
import { Rng, hashString } from './rng';
import type { CharacterRecipe } from './char-types';
import { CharacterFactory } from './CharacterFactory';
import { normaliseRecipe } from './char-recipes';
import { assemble } from './char-build';
import { bakeStatic } from './char-parts';
import { EXPRESSION_DEFS } from './face';

const VERTEX_PARS = /* glsl */ `
attribute float tint;
attribute float crowdPhase;
uniform float uTime;
uniform float uHeight;
`;

// Gentle idle life: side sway and forward nod that grow with height (feet stay planted) plus a breathing squash.
const VERTEX_BEGIN = /* glsl */ `
vec3 transformed = vec3( position );
{
  float h = clamp( position.y / uHeight, 0.0, 1.0 );
  float ph = crowdPhase;
  transformed.x += sin( uTime * 1.6 + ph ) * 0.05 * h * position.y;
  transformed.z += sin( uTime * 1.1 + ph * 1.7 ) * 0.03 * h * position.y;
  transformed.y *= 1.0 + 0.018 * sin( uTime * 3.2 + ph * 2.3 );
}
`;

const VERTEX_COLOR = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR
  vColor.rgb = color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb = mix( vColor.rgb, instanceColor.rgb, tint );
#endif
`;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const HEX = /^#[0-9a-fA-F]{6}$/;

export class CrowdMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly max: number;
  /** Citizen height (m, top of the head) and width (m, across the arms): sizes for a CrowdShadow proxy. */
  readonly height: number;
  readonly width: number;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly phase: THREE.InstancedBufferAttribute;
  private readonly uniforms: { uTime: { value: number }; uHeight: { value: number } };
  private disposed = false;

  constructor(recipe: CharacterRecipe | string, max: number) {
    const r =
      typeof recipe === 'string'
        ? (CharacterFactory.recipes()[recipe] ?? normaliseRecipe({ id: recipe }, recipe))
        : normaliseRecipe(recipe, recipe.id);
    this.max = Math.max(1, Math.floor(max));
    const mouth = EXPRESSION_DEFS[r.expression ?? 'neutral'].mouth;
    const crowdRecipe: CharacterRecipe = { ...r, burden: false, glow: false };
    const { parts, layout } = assemble(crowdRecipe, new Rng(hashString(`crowd:${r.id}`)), 'crowd', [mouth]);
    const geometry = bakeStatic(parts.items, (bone) => bone === 'sack' || bone === 'ropes');
    // The tint attribute travels with the geometry; the phase is per instance.
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(this.max), 1);
    for (let i = 0; i < this.max; i++) this.phase.setX(i, (i * 2.39996) % (Math.PI * 2));
    geometry.setAttribute('crowdPhase', this.phase);

    this.uniforms = { uTime: { value: 0 }, uHeight: { value: Math.max(0.5, layout.height) } };
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.material.name = 'crowd';
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uHeight = this.uniforms.uHeight;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <begin_vertex>', VERTEX_BEGIN)
        .replace('#include <color_vertex>', VERTEX_COLOR);
    };
    this.material.customProgramCacheKey = () => 'pilgrim-crowd-v1';

    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.max);
    this.mesh.name = `crowd:${r.id}`;
    // Always present so USE_INSTANCING_COLOR is defined; white tint keeps the recipe colour until set().
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3).fill(1), 3);
    this.mesh.count = 0;
    // Shadows come from one CrowdShadow for the whole crowd (1 draw call), not from every body type.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = null;
    this.height = this.uniforms.uHeight.value;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    this.width = box ? Math.max(0.2, box.max.x - box.min.x) : 0.6;
  }

  get count(): number {
    return this.mesh.count;
  }

  set count(n: number) {
    this.mesh.count = Math.max(0, Math.min(this.max, Math.floor(n)));
    this.mesh.boundingSphere = null; // recomputed lazily by the next frustum test
  }

  /** Places citizen `i` (pos on the ground, facing rotY), tinted `tint` on its clothing, with an idle phase. */
  set(i: number, pos: THREE.Vector3, rotY: number, tint: string, phase?: number): void {
    if (this.disposed || i < 0 || i >= this.max) return;
    tmpQ.setFromAxisAngle(UP, rotY);
    this.mesh.setMatrixAt(i, tmpM.compose(pos, tmpQ, ONE));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.setColorAt(i, colorOf(HEX.test(tint) ? tint : '#FFFFFF'));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.phase.setX(i, phase ?? (i * 2.39996) % (Math.PI * 2));
    this.phase.needsUpdate = true;
    if (i >= this.mesh.count) this.mesh.count = i + 1;
    this.mesh.boundingSphere = null;
  }

  /** t = seconds (e.g. loop.elapsed). */
  update(t: number): void {
    this.uniforms.uTime.value = t;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
