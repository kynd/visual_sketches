// Particle uber-shader. Every demo assembles its programs from this one
// source with #defines, so the particle motion, the sphere impostor and the
// lighting are identical across demos and only the technique changes.
//
// Method defines (camera pass): METHOD_POINTS | METHOD_BILLBOARD | METHOD_MESH
// Pass defines:                 PASS_CAMERA | PASS_SHADOW_DEPTH | PASS_OPACITY
// Options:                      EXACT_DEPTH, SHADOW_MAP_PIXEL, SHADOW_MAP_PARTICLE, OPACITY_SHADOW,
//                               ENV_LIGHTING (needs env-glsl.js passed as 'extra')
// Source:                       POS_TEXTURE — read centre + radius from a texture written by a
//                               compute-style pass (see flow-glsl.js) instead of particlePos()

export const KEY_LIGHT = (() => { const v = [0.6, 1.0, 0.7]; const l = Math.hypot(...v); return v.map(c => c / l); })();

const HEADER = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
`;

// Shared uniforms + functions available to both stages.
const COMMON = /* glsl */`
uniform float uTime;
uniform int   uFormation;   // 0 cloud, 1 ring, 2 sheet
uniform int   uCount;
uniform float uRadius;
uniform mat4  uView;
uniform mat4  uProj;
uniform mat3  uCamRot;      // camera-to-world rotation
uniform vec3  uCamPos;
uniform vec3  uKeyDir;

// Light-space transforms (orthographic, key light direction)
uniform mat4  uLightView;
uniform mat4  uLightProj;
uniform float uLightRes;    // light-map resolution in texels
uniform float uLightHalf;   // half-width of the light frustum in world units

// Shadow map
uniform sampler2DShadow uShadowMap;
uniform float uShadowBias;
uniform int   uPcf;         // kernel radius: 0 → 1 tap, 1 → 3×3, 2 → 5×5

// Opacity shadow map: 16 slices packed into 4 RGBA targets
uniform sampler2D uOpa0;
uniform sampler2D uOpa1;
uniform sampler2D uOpa2;
uniform sampler2D uOpa3;
uniform float uOpaNear;     // light distance of slice 0
uniform float uOpaStep;     // slice spacing
uniform float uOpaK;        // absorption per unit of accumulated coverage

#ifdef POS_TEXTURE
uniform highp sampler2D uPosTex;  // RGBA32F: xyz = centre, w = radius (0 hides the particle)
uniform int   uPosW;              // texture width; particle i lives at (i % W, i / W)
uniform int   uIdOffset;          // first texel of this draw (WebGL2 has no base instance)
#endif

const float TAU = 6.28318530718;

// PCG hash — turns a particle index into reproducible pseudo-random numbers,
// so no per-particle buffer is needed at all.
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(inout uint s) { s = pcg(s); return float(s) * (1.0 / 4294967296.0); }

vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// Particle position as a pure function of (index, time).
vec3 particlePos(uint id) {
  uint s = id * 1664525u + 1013904223u;
  float a = rnd(s), b = rnd(s), c = rnd(s), d = rnd(s);
  float t = uTime;
  if (uFormation == 0) {
    // Cloud: centrally dense, flattening outward, with differential rotation (inner orbits faster).
    float r  = -0.30 * log(1.0 - a * 0.985);          // exponential falloff, soft edge
    float cz = b * 2.0 - 1.0, sz = sqrt(1.0 - cz * cz), ph = c * TAU;
    vec3 p = r * vec3(sz * cos(ph), cz * mix(0.8, 0.25, clamp(r / 1.2, 0.0, 1.0)), sz * sin(ph));
    p.xz = rot2(p.xz, t * 0.5 / (0.2 + r));
    p.y += 0.07 * sin(t * 1.3 + d * TAU + r * 5.0);
    return p;
  } else if (uFormation == 1) {
    // Ring: torus whose cross-section twists as it travels around.
    float th = a * TAU + t * 0.25;
    float m  = 0.32 * sqrt(b);
    float ph = c * TAU + t * 1.1 + th * 3.0;
    float R  = 1.0 + m * cos(ph);
    return vec3(R * cos(th), m * sin(ph) + 0.12 * sin(th * 2.0 + t), R * sin(th));
  }
  // Sheet: regular grid displaced by travelling waves.
  int side = int(ceil(sqrt(float(uCount))));
  int iid = int(id);
  vec2 g = (vec2(float(iid % side), float(iid / side)) + 0.5) / float(side) * 2.0 - 1.0;
  vec2 xz = g * 1.4;
  float y = 0.20 * sin(2.6 * xz.x + t) * cos(2.2 * xz.y + t * 0.7)
          + 0.08 * sin(5.0 * (xz.x + xz.y) - t * 1.7);
  return vec3(xz.x, y + 0.15, xz.y);
}

float shadowMapLookup(vec3 wp) {
  vec4 lp = uLightProj * uLightView * vec4(wp, 1.0);
  vec3 s = lp.xyz * 0.5 + 0.5;
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  float z = s.z - uShadowBias;
  float texel = 1.0 / uLightRes;
  float sum = 0.0, cnt = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    if (abs(x) > uPcf || abs(y) > uPcf) continue;
    sum += texture(uShadowMap, vec3(s.xy + vec2(x, y) * texel, z));  // hardware 2×2 compare + bilinear
    cnt += 1.0;
  }
  return sum / cnt;
}

// Accumulated coverage in front of world point wp, read from the opacity slices.
// 'lag' pushes the lookup toward the light (in slices) so a particle never shadows itself.
float opticalDepth(vec3 wp, float lag) {
  vec4 lv = uLightView * vec4(wp, 1.0);
  vec2 uv = lv.xy / uLightHalf * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  float f = clamp((-lv.z - uOpaNear) / uOpaStep - lag, 0.0, 16.0);
  vec4 a = texture(uOpa0, uv), b = texture(uOpa1, uv), c = texture(uOpa2, uv), d = texture(uOpa3, uv);
  float s[17] = float[17](0.0, a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, c.x, c.y, c.z, c.w, d.x, d.y, d.z, d.w);
  int i = int(floor(f));
  return mix(s[i], s[min(i + 1, 16)], fract(f));
}

// Studio lighting (same parameters as geom's lighting.glsl); 'sh' scales the key light.
vec3 stdLighting(vec3 nor, vec3 rd, float sh) {
  vec3  lk = uKeyDir;
  float dk = max(dot(nor, lk), 0.0) * sh;
  vec3  lf = normalize(vec3(-0.8, 0.3, 0.5));
  float df = max(dot(nor, lf), 0.0) * 0.28;
#ifdef ALBEDO
  vec3 col = vec3(ALBEDO) * (0.13 + dk * 0.84 + df) / 0.88;   // darker material, same light rig
#else
  vec3 col = vec3(0.88) * (0.13 + dk * 0.84 + df);
#endif
  vec3 hv = normalize(lk - rd);
  col += vec3(0.40) * pow(max(dot(nor, hv), 0.0), 72.0) * sh;
  float fr = pow(1.0 - max(dot(nor, -rd), 0.0), 4.0);
  col += vec3(0.12, 0.18, 0.38) * fr * 0.6;
  return col;
}
`;

const VS = /* glsl */`
uniform float uViewportH;
uniform float uMaxPointSize;
#ifdef METHOD_MESH
layout(location = 0) in vec3 aPos;
#endif
out vec3  vCenterV;
out vec2  vQ;
out vec3  vNormalW;
out vec3  vWorld;
out float vShadow;
out float vLightDist;
out float vCover;
flat out float vRad;

void main() {
#ifdef METHOD_POINTS
  uint id = uint(gl_VertexID);
#else
  uint id = uint(gl_InstanceID);
#endif
#ifdef POS_TEXTURE
  int ti = int(id) + uIdOffset;
  vec4 pt = texelFetch(uPosTex, ivec2(ti % uPosW, ti / uPosW), 0);
  vec3 c = pt.xyz;
  float rad = pt.w;
  if (rad <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }  // clipped away
#else
  vec3 c = particlePos(id);
  float rad = uRadius;
#endif
  vRad = rad;

#if defined(PASS_SHADOW_DEPTH) || defined(PASS_OPACITY)
  // Light pass: point sprites in an orthographic light view (quads for spheres
  // too large for gl_PointSize).
  vec4 lv = uLightView * vec4(c, 1.0);
  #ifdef METHOD_BILLBOARD
  vec2 q = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vQ = q;
  lv.xy += q * rad;
  #endif
  gl_Position = uLightProj * lv;
  float diam = rad / uLightHalf * uLightRes;      // diameter in light-map texels
  gl_PointSize = clamp(diam, 1.0, uMaxPointSize);
  vCover = diam < 1.0 ? 0.785398 * diam * diam : 1.0; // sub-texel particles deposit partial coverage
  vLightDist = -lv.z;
#else
  vec4 cv = uView * vec4(c, 1.0);
  vCenterV = cv.xyz;
  #if defined(METHOD_POINTS)
  gl_Position = uProj * cv;
  gl_PointSize = clamp(rad * uProj[1][1] * uViewportH / -cv.z, 1.0, uMaxPointSize);
  #elif defined(METHOD_BILLBOARD)
  vec2 q = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vQ = q;
  gl_Position = uProj * vec4(cv.xyz + vec3(q * rad, 0.0), 1.0);
  #else
  vNormalW = aPos;
  vWorld = c + aPos * rad;
  gl_Position = uProj * uView * vec4(vWorld, 1.0);
  #endif

  #if defined(SHADOW_MAP_PARTICLE)
  vShadow = shadowMapLookup(c + uKeyDir * rad);
  #elif defined(OPACITY_SHADOW)
  vShadow = exp(-uOpaK * opticalDepth(c, 1.0));
  #else
  vShadow = 1.0;
  #endif
#endif
}
`;

const FS = /* glsl */`
in vec3  vCenterV;
in vec2  vQ;
in vec3  vNormalW;
in vec3  vWorld;
in float vShadow;
in float vLightDist;
in float vCover;
flat in float vRad;

#ifdef PASS_OPACITY
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
#else
out vec4 fragColor;
#endif

void main() {
#if defined(PASS_SHADOW_DEPTH)
  #ifdef METHOD_BILLBOARD
  vec2 q = vQ;
  #else
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  #endif
  if (dot(q, q) > 1.0) discard;          // depth comes from the flat disc at the centre
#elif defined(PASS_OPACITY)
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  if (vCover >= 1.0 && dot(q, q) > 1.0) discard;
  // Slice k (light distance uOpaNear + (k+1)*step) accumulates every particle in front of it.
  float f = (vLightDist - uOpaNear) / uOpaStep;
  vec4 k0 = vec4(1.0, 2.0, 3.0, 4.0);
  o0 = vCover * step(vec4(f), k0);
  o1 = vCover * step(vec4(f), k0 + 4.0);
  o2 = vCover * step(vec4(f), k0 + 8.0);
  o3 = vCover * step(vec4(f), k0 + 12.0);
#else
  #ifdef METHOD_MESH
  vec3 n  = normalize(vNormalW);
  vec3 wp = vWorld;
  vec3 rd = normalize(wp - uCamPos);
  #else
    #ifdef METHOD_POINTS
  vec2 q = gl_PointCoord * 2.0 - 1.0; q.y = -q.y;
    #else
  vec2 q = vQ;
    #endif
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  // Impostor: rebuild a hemisphere normal from the sprite coordinate.
  vec3 nV = vec3(q, sqrt(1.0 - d2));
  vec3 pV = vCenterV + nV * vRad;
  vec3 n  = uCamRot * nV;
  vec3 wp = uCamPos + uCamRot * pV;
  vec3 rd = uCamRot * normalize(vCenterV);
    #ifdef EXACT_DEPTH
  vec4 clip = uProj * vec4(pV, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
    #endif
  #endif
  float sh = vShadow;
  #ifdef SHADOW_MAP_PIXEL
  sh = shadowMapLookup(wp + n * vRad * 0.15);
  #endif
  #ifdef ENV_LIGHTING
  fragColor = vec4(envOutput(envShade(n, rd, sh)), 1.0);   // env-glsl.js, injected as 'extra'
  #else
  vec3 col = stdLighting(n, rd, sh);
  fragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
  #endif
#endif
}
`;

// 'extra' is GLSL appended after the common block — e.g. the environment-map
// shading from env-glsl.js, used with the ENV_LIGHTING define.
export function particleShaders(defines, extra = '') {
  const head = HEADER + defines.map(d => `#define ${d}\n`).join('') + COMMON + extra;
  return { vs: head + VS, fs: head + FS };
}

// Header + defines + shared uniforms/functions (+ extra), for shaders that live
// outside this file but use the same uniforms (env-glsl.js).
export function shaderHead(defines = [], extra = '') {
  return HEADER + defines.map(d => `#define ${d}\n`).join('') + COMMON + extra;
}

// Ground plane and debug inset share the uniforms above.
export function groundShaders(defines) {
  const head = HEADER + defines.map(d => `#define ${d}\n`).join('') + COMMON;
  const vs = head + /* glsl */`
uniform float uGroundY;
uniform float uGroundHalf;
out vec3 vWorld;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vWorld = vec3(c.x * uGroundHalf, uGroundY, c.y * uGroundHalf);
  gl_Position = uProj * uView * vec4(vWorld, 1.0);
}`;
  const fs = head + /* glsl */`
uniform float uGroundHalf;
in vec3 vWorld;
out vec4 fragColor;
void main() {
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 rd = normalize(vWorld - uCamPos);
  float sh = 1.0;
#if defined(SHADOW_MAP_PIXEL) || defined(SHADOW_MAP_PARTICLE)
  sh = shadowMapLookup(vWorld);
#elif defined(OPACITY_SHADOW)
  sh = exp(-uOpaK * opticalDepth(vWorld, 0.0));
#endif
  float dk = max(dot(n, uKeyDir), 0.0) * sh;
  vec3 col = vec3(0.55) * (0.10 + dk * 0.84);
  col *= smoothstep(uGroundHalf, uGroundHalf * 0.35, length(vWorld.xz));
  fragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
}`;
  return { vs, fs };
}

// Small inset that visualises a light-space map.
export function insetShaders(kind) {
  const vs = HEADER + /* glsl */`
out vec2 vUv;
void main() {
  vUv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}`;
  const fs = HEADER + /* glsl */`
uniform sampler2D uTex;
uniform float uOpaK;
in vec2 vUv;
out vec4 fragColor;
void main() {
${kind === 'depth'
    ? '  float v = texture(uTex, vUv).r; v = 1.0 - smoothstep(0.25, 0.85, v);'
    : '  float v = 1.0 - exp(-uOpaK * texture(uTex, vUv).w);'}
  fragColor = vec4(vec3(v), 1.0);
}`;
  return { vs, fs };
}
