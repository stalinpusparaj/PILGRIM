/**
 * Gradient sky dome with a soft sun disc (GDD 2.11 "Gentle gradient skies", GDD 2.12 "Sky").
 *
 * A low-poly sphere seen from inside, coloured per pixel from the view direction: `top` overhead, `horizon`
 * at eye level (use the same colour for the scene fog so distant ground melts into the sky) and `bottom`
 * below the horizon. No textures. The dome follows the camera, so it never clips against the far plane.
 * Tone mapping and the output colour space are applied like any lit material, so fog and horizon match.
 */
import * as THREE from 'three';

export interface SkyColors {
  top: THREE.ColorRepresentation;
  horizon: THREE.ColorRepresentation;
  bottom: THREE.ColorRepresentation;
  sun: THREE.ColorRepresentation;
}

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  // Wide soft band at the horizon, deeper colour overhead.
  vec3 color = h >= 0.0
    ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.5, h), 0.7))
    : mix(uHorizon, uBottom, smoothstep(0.0, 0.25, -h));
  float s = max(dot(dir, uSunDir), 0.0);
  color += uSun * (smoothstep(0.9993, 0.9996, s) * 0.9 + pow(s, 24.0) * 0.18);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  /** `radius` must stay below the camera's far plane. */
  constructor(colors: SkyColors, sunDirection: THREE.Vector3, radius = 450) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(colors.top) },
        uHorizon: { value: new THREE.Color(colors.horizon) },
        uBottom: { value: new THREE.Color(colors.bottom) },
        uSun: { value: new THREE.Color(colors.sun) },
        uSunDir: { value: sunDirection.clone().normalize() },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000; // drawn first; everything else paints over it
    this.mesh.matrixAutoUpdate = false;
  }

  /** Keeps the dome centred on the camera. Call once per rendered frame. */
  follow(position: THREE.Vector3): void {
    this.mesh.position.copy(position);
    this.mesh.updateMatrix();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
