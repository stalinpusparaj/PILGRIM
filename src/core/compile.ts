/**
 * Shader precompile without console noise. three's `compileAsync()` asks for KHR_parallel_shader_compile and logs
 * "THREE.WebGLRenderer: KHR_parallel_shader_compile extension not supported." where the GPU lacks it (SwiftShader,
 * older drivers). There `compile()` does the same work synchronously, so use it instead; `extensions.has()` checks
 * without warning.
 */
import type * as THREE from 'three';

export function precompile(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
): Promise<unknown> {
  if (renderer.extensions.has('KHR_parallel_shader_compile')) return renderer.compileAsync(scene, camera);
  try {
    renderer.compile(scene, camera);
    return Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}
