/**
 * GLSL for `src/gen/Particles.ts`: camera-facing quads billboarded in the vertex shader from per-instance
 * attributes, shapes drawn with math in the fragment shader (no textures), premultiplied output so alpha-blended
 * and additive particles share one draw call (blend ONE, ONE_MINUS_SRC_ALPHA).
 *
 * Instance attributes:
 *   aOffset xyz world position, w rotation (rad)
 *   aSize   x width, y height, z shape id (fx/particlePresets SHAPE), w additive share (0..1)
 *   aColor  rgb linear colour, a alpha
 *   aVel    xyz velocity, w streak stretch per m/s (> 0 aligns the quad with the on-screen velocity)
 */

export const PARTICLE_VERTEX = /* glsl */ `
attribute vec4 aOffset; // xyz world position, w rotation
attribute vec4 aSize;   // x width, y height, z shape, w additive share
attribute vec4 aColor;  // rgb linear colour, a alpha
attribute vec4 aVel;    // xyz velocity, w streak stretch (0 = free rotation)
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
varying float vAdd;
varying float vFogDepth;
void main() {
  vec4 mv = viewMatrix * vec4(aOffset.xyz, 1.0);
  vec2 c = position.xy;
  if (aVel.w > 0.0) {
    vec2 d = (viewMatrix * vec4(aVel.xyz, 0.0)).xy;
    float len = length(d);
    vec2 ay = len > 1e-4 ? d / len : vec2(0.0, 1.0);
    vec2 ax = vec2(ay.y, -ay.x);
    mv.xy += ax * (c.x * aSize.x) + ay * (c.y * (aSize.y + aVel.w * len));
  } else {
    float cs = cos(aOffset.w);
    float sn = sin(aOffset.w);
    vec2 q = c * aSize.xy;
    mv.xy += vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
  }
  vUv = c * 2.0;
  vColor = aColor;
  vShape = aSize.z;
  vAdd = aSize.w;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
uniform vec3 fogColor;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;
uniform float fogFar;
#endif
#endif
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
varying float vAdd;
varying float vFogDepth;
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// Signed distance to an n-pointed star (outer radius ro, inner radius ri), negative inside: fold the angle
// into half a point, then measure to the edge from the tip to the valley.
float star(vec2 p, float n, float ro, float ri) {
  float seg = 6.2831853 / n;
  float a = abs(mod(atan(p.x, p.y) + seg * 0.5, seg) - seg * 0.5);
  vec2 q = length(p) * vec2(cos(a), sin(a));
  vec2 e = ri * vec2(cos(seg * 0.5), sin(seg * 0.5)) - vec2(ro, 0.0);
  vec2 w = q - vec2(ro, 0.0);
  float h = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
  return length(w - e * h) * sign(w.x * e.y - w.y * e.x);
}
void main() {
  float shape = floor(vShape + 0.5);
  float r = length(vUv);
  vec3 col = vColor.rgb;
  float a;
  if (shape < 0.5) { // soft puff with a gentle centre
    a = (1.0 - smoothstep(0.4, 1.0, r)) * (1.0 - 0.3 * r);
  } else if (shape < 1.5) { // cartoon star with a darker outline
    float d = star(vUv, 5.0, 0.98, 0.45);
    float w = max(fwidth(d), 1e-4);
    a = 1.0 - smoothstep(-w, w, d);
    col *= mix(1.0, 0.7, smoothstep(-0.17 - w, -0.17 + w, d));
  } else if (shape < 2.5) { // twinkle: thin four-point glint around a glowing core
    float d = star(vUv, 4.0, 1.0, 0.16);
    a = max(1.0 - smoothstep(-0.05, 0.12, d), (1.0 - smoothstep(0.0, 0.5, r)) * 0.7);
  } else if (shape < 3.5) { // 'Z' with an outline so it reads on bright skies
    float d = min(segment(vUv, vec2(-0.5, 0.62), vec2(0.5, 0.62)), segment(vUv, vec2(0.5, 0.62), vec2(-0.5, -0.62)));
    d = min(d, segment(vUv, vec2(-0.5, -0.62), vec2(0.5, -0.62))) - 0.17;
    float w = max(fwidth(d), 1e-4);
    a = 1.0 - smoothstep(-w, w, d);
    col *= mix(1.0, 0.62, smoothstep(-0.07 - w, -0.07 + w, d));
  } else { // streak
    a = (1.0 - smoothstep(0.2, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.3, 1.0, abs(vUv.y)));
  }
  a *= vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  float f = 0.0;
  vec3 fogged = gl_FragColor.rgb;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      f = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      f = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    fogged = mix(fogged, fogColor, f);
  #endif
  // Premultiplied: alpha-blended particles fade into the fog colour, additive ones fade out.
  vec3 rgb = mix(fogged, gl_FragColor.rgb * (1.0 - f), vAdd);
  gl_FragColor = vec4(rgb * a, a * (1.0 - vAdd));
}
`;
