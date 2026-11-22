// Position pass for the noise-flow demos. A full-screen quad over an RGBA32F
// texture runs one fragment per particle; each fragment computes that
// particle's centre (xyz) and radius (w) as a pure function of its index and
// uTime. The particle uber-shader then reads it back with POS_TEXTURE.
//
// Mode defines: MODE_PLUME | MODE_STREAM | MODE_SURFACE | MODE_LATTICE

import { SHAPES_GLSL } from './shapes-glsl.js';

const HEADER = /* glsl */`#version 300 es
precision highp float;
precision highp int;
`;

// 3D simplex noise with its analytic gradient — Stefan Gustavson and Ian
// McEwan's webgl-noise (MIT), noise3Dgrad. The gradient is exact for the
// function, which keeps curl noise divergence-free.
export const NOISE = /* glsl */`
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v, out vec3 grad) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x  = x_ * ns.x + ns.yyyy;
  vec4 y  = y_ * ns.x + ns.yyyy;
  vec4 h  = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m  = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  grad = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  grad *= 105.0;
  return 105.0 * dot(m4, pdotx);
}
float snoise(vec3 v) { vec3 g; return snoise(v, g); }
`;

const COMMON = /* glsl */`
uniform float uTime;      // demo time × Speed
uniform int   uCount;
uniform int   uPosW;
uniform float uFreq;      // noise frequency (features per world unit)
uniform float uEvolve;    // how fast the field changes shape
uniform float uFlow;      // velocity scale
uniform float uContain;   // strength of the soft wall
uniform float uSize;      // sphere radius
uniform float uLife;      // particle lifetime, seconds
uniform int   uSteps;     // integration steps per lifetime
uniform float uCoreR;     // radius of the solid core written after the last particle (0 = none)

const float TAU = 6.28318530718;
const float FLOOR_Y = -1.25;

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(inout uint s) { s = pcg(s); return float(s) * (1.0 / 4294967296.0); }

vec3 randomDir(inout uint s) {
  float z = rnd(s) * 2.0 - 1.0, a = rnd(s) * TAU, r = sqrt(1.0 - z * z);
  return vec3(r * cos(a), z, r * sin(a));
}

// Curl of a vector potential made of three noise fields. Each component drifts
// through the noise in its own direction, so the field changes shape over time
// instead of sliding by rigidly. curl(ψ) is divergence-free: the flow swirls
// but never piles particles up or thins them out.
vec3 curlNoise(vec3 p, float t) {
  vec3 q = p * uFreq;
  float e = t * uEvolve;
  vec3 g1, g2, g3;
  snoise(q + e * vec3( 0.31, -0.17,  0.05), g1);
  snoise(q + vec3( 31.4,  17.3,  -9.1) + e * vec3(-0.12,  0.26,  0.21), g2);
  snoise(q + vec3(-23.7,  41.9,  13.2) + e * vec3( 0.19,  0.08, -0.29), g3);
  return vec3(g3.y - g2.z, g1.z - g3.x, g2.x - g1.y);
}

// Soft wall: pushes back anything outside a ball of radius R, harder the farther out.
vec3 containVel(vec3 p, float R) {
  float l = length(p);
  return l > R ? -p * ((l - R) / l) * uContain : vec3(0.0);
}

// Lifetime bookkeeping shared by the respawning modes. Every particle lives
// for 'life' seconds with a random phase; 'cycle' numbers its incarnations so
// each one can start somewhere new.
struct Life { float life; float age; float born; uint cycle; };
Life lifeOf(inout uint s) {
  Life L;
  L.life = uLife * (0.7 + 0.6 * rnd(s));
  float c = uTime / L.life + rnd(s);
  L.age = fract(c) * L.life;
  L.born = uTime - L.age;
  L.cycle = uint(int(floor(c)));
  return L;
}
`;

// ── Curl-noise plume ─────────────────────────────────────────────────────
// Emitted from a disc on the floor, carried up by buoyancy and stirred by
// curl noise. Integration replays the particle's whole life from its birth with
// a fixed step, so the trajectory is identical every frame.
const PLUME = /* glsl */`
uniform float uRise;
uniform float uEmitR;

vec3 vel(vec3 p, float t) {
  vec3 v = uFlow * curlNoise(p, t);
  v.y += uRise;
  v.xz -= p.xz * uContain;              // gentle pull back toward the axis
  return v;
}

vec4 particle(uint id) {
  uint s = id * 1664525u + 1013904223u;
  Life L = lifeOf(s);
  float sz = uSize * (0.55 + 0.45 * rnd(s));
  uint e = pcg(id ^ (L.cycle * 2654435761u));
  float a = rnd(e) * TAU, r = uEmitR * sqrt(rnd(e));
  vec3 p = vec3(r * cos(a), FLOOR_Y + sz + 0.08 * rnd(e), r * sin(a));
  float h = L.life / float(uSteps);
  for (int k = 0; k < uSteps; k++) {
    float dt = min(h, L.age - float(k) * h);   // full steps, then one partial step
    if (dt <= 0.0) break;
    float t = L.born + float(k) * h;
    vec3 v1 = vel(p, t);
    p += vel(p + v1 * dt * 0.5, t + dt * 0.5) * dt;   // midpoint (RK2)
    p.y = max(p.y, FLOOR_Y + sz);
  }
  float u = L.age / L.life;
  return vec4(p, sz * smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.55, 1.0, u)));
}
`;

// ── Streamline beads ─────────────────────────────────────────────────────
// Particles grouped into lines. Bead k of a line sits k spacings along the
// streamline that starts at the line's seed, traced through the field as it is
// at time uTime. Shifting every bead by a fraction of a spacing makes the
// beads travel along the line; the ends taper so the wrap-around is invisible.
const STREAM = /* glsl */`
uniform int   uLineLen;   // beads per line
uniform float uSpacing;   // world distance between neighbouring beads
uniform float uAlong;     // bead speed along the line, world units per second

vec3 dir(vec3 p) {
  vec3 v = curlNoise(p, uTime) + containVel(p, 1.0);
  return v / max(length(v), 1e-4);
}

vec4 particle(uint id) {
  int line = int(id) / uLineLen, k = int(id) % uLineLen;
  uint s = uint(line) * 1664525u + 1013904223u;
  vec3 p = randomDir(s) * 1.05 * pow(rnd(s), 1.0 / 3.0);   // uniform in a ball
  float arc = float(k) + fract(uTime * uAlong / uSpacing);  // position along the line, in beads
  for (int j = 0; j <= uLineLen; j++) {
    float ds = min(1.0, arc - float(j)) * uSpacing;
    if (ds <= 0.0) break;
    p += dir(p + dir(p) * ds * 0.5) * ds;                  // midpoint step along the unit direction
  }
  float u = arc / float(uLineLen);
  return vec4(p, uSize * smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.75, u));
}
`;

// ── Flow on a sphere ─────────────────────────────────────────────────────
// Particles confined to a unit sphere. With one scalar noise field ψ, the
// tangential gradient ∇ψ points uphill and n × ∇ψ circles around the peaks;
// mixing the two gives spirals that drain into the noise maxima.
const SURFACE = /* glsl */`
uniform float uGather;

vec3 vel(vec3 p, float t) {
  vec3 n = normalize(p);
  vec3 q = p * uFreq;
  float e = t * uEvolve;
  vec3 g1, g2;
  snoise(q + e * vec3(0.21, -0.13, 0.17), g1);
  snoise(q * 2.1 + vec3(13.7, -4.1, 7.3) + e * vec3(-0.30, 0.20, 0.25), g2);
  vec3 g = g1 + 0.7 * g2;
  g -= n * dot(n, g);                   // keep the tangential part
  return uFlow * (cross(n, g) + uGather * g);
}

vec4 particle(uint id) {
  uint s = id * 1664525u + 1013904223u;
  Life L = lifeOf(s);
  float sz = uSize * (0.6 + 0.4 * rnd(s));
  uint e = pcg(id ^ (L.cycle * 2654435761u));
  vec3 p = randomDir(e);
  float h = L.life / float(uSteps);
  for (int k = 0; k < uSteps; k++) {
    float dt = min(h, L.age - float(k) * h);
    if (dt <= 0.0) break;
    float t = L.born + float(k) * h;
    vec3 v1 = vel(p, t);
    p = normalize(p + vel(normalize(p + v1 * dt * 0.5), t + dt * 0.5) * dt);  // step, then back onto the sphere
  }
  float u = L.age / L.life;
  // Fade in slowly: young particles are still spread out; the pattern forms as they converge.
  return vec4(p, sz * smoothstep(0.0, 0.35, u) * (1.0 - smoothstep(0.75, 1.0, u)));
}
`;

// ── Noise lattice ────────────────────────────────────────────────────────
// Spheres fixed on a cubic grid; each one's radius is the noise density at its
// grid point. The density field rises and is warped by curl noise, so the
// pattern flows through a lattice that never moves.
const LATTICE = /* glsl */`
uniform int   uSide;       // grid points per edge
uniform float uHalf;       // half-size of the cube
uniform float uThreshold;  // density where spheres start to appear
uniform float uFill;       // largest radius as a fraction of half the grid spacing
uniform float uWarp;       // curl-noise displacement of the density lookup
uniform float uRise;       // upward drift of the density field

vec4 particle(uint id) {
  int i = int(id);
  ivec3 g = ivec3(i % uSide, (i / uSide) % uSide, i / (uSide * uSide));
  vec3 p = ((vec3(g) + 0.5) / float(uSide) * 2.0 - 1.0) * uHalf;
  vec3 w = p + uWarp * curlNoise(p, uTime) * 0.25 - vec3(0.0, uTime * uRise, 0.0);
  vec3 q = w * uFreq;
  float d = snoise(q) + 0.5 * snoise(q * 2.03 + vec3(11.0, -7.0, 3.0) - vec3(0.0, uTime * uRise * uFreq, 0.0));
  float spacing = 2.0 * uHalf / float(uSide);
  return vec4(p, 0.5 * spacing * uFill * smoothstep(uThreshold, uThreshold + 0.35, d));
}
`;

// ── Shape morph ──────────────────────────────────────────────────────────
// Every particle owns a random seed point near the shape. It is projected onto
// shape A and onto shape B (Newton steps along the distance gradient), and the
// particle sits on the blend of the two projections. While the blend runs,
// curl noise lifts the particles off the surface and sets them down again.
const MORPH_COMMON = SHAPES_GLSL + /* glsl */`
uniform float uMix;       // 0 = shape A, 1 = shape B (already eased)
uniform float uScale;     // world size of shape space
uniform float uSpin;      // rotation about the shape's y axis, radians
uniform float uTilt;      // then a tilt about x, radians
uniform float uSwirl;     // curl-noise displacement during a morph
uniform int   uProject;   // projection steps

vec3 shapeGrad(int id, vec3 q) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.003;
  return k.xyy * shapeSDF(id, q + k.xyy * e, uTime) + k.yyx * shapeSDF(id, q + k.yyx * e, uTime)
       + k.yxy * shapeSDF(id, q + k.yxy * e, uTime) + k.xxx * shapeSDF(id, q + k.xxx * e, uTime);
}

// Closest-point projection: step against the gradient by the distance.
vec3 project(int id, vec3 q) {
  for (int i = 0; i < 12; i++) {
    if (i >= uProject) break;
    float d = shapeSDF(id, q, uTime);
    vec3 g = shapeGrad(id, q);
    q -= d * g / max(length(g), 1e-6);
  }
  return q;
}
`;

const MORPH = MORPH_COMMON + /* glsl */`
uniform int   uShapeA;
uniform int   uShapeB;

vec4 particle(uint id) {
  uint s = id * 1664525u + 1013904223u;
  vec3 seed = randomDir(s) * 1.1 * pow(rnd(s), 1.0 / 3.0);   // uniform in a ball, shape space
  float sz = uSize * (0.7 + 0.3 * rnd(s));
  vec3 a = project(uShapeA, seed);
  vec3 q = a;
  if (uMix > 0.0 && uShapeB != uShapeA) q = mix(a, project(uShapeB, seed), uMix);
  vec3 p = shapeToWorld(q, uSpin, uTilt, uScale);
  float w = sin(3.14159265 * uMix);
  if (w > 0.0) p += uSwirl * w * 0.08 * curlNoise(p * 0.9 + seed, uTime);
  return vec4(p, sz);
}
`;

// ── Morph conveyor ───────────────────────────────────────────────────────
// Four particle groups take turns at five places along a line: off-screen
// before (−2), the side station before the centre (−1), the centre (0), the
// side station after it (1) and off-screen after (2). Every morph moves each
// group one place along while it morphs one step through the shape list, so
// particles travel in straight lines (no swirl). The off-screen places lie far
// enough out that a shape there is wholly outside the view (main.js sets the
// spacing), so the group leaving the far end slips back to the start unseen.
const CONVEYOR = MORPH_COMMON + /* glsl */`
uniform ivec4 uGroupA;    // per group: shape it is morphing from
uniform ivec4 uGroupB;    //            shape it is morphing to
uniform vec4  uGroupPos;  //            place along the line: −2 … 2, 0 = centre
uniform vec3  uAxis;      // world direction of the line (screen right, or screen down)
uniform float uSpacing;   // world distance between neighbouring places

vec4 particle(uint id) {
  int g = int(id % 4u);
  float x = uGroupPos[g];
  if (x <= -2.0 || x >= 2.0) return vec4(0.0);   // parked off-screen during the hold
  uint s = (id / 4u) * 1664525u + 1013904223u;
  vec3 seed = randomDir(s) * 1.1 * pow(rnd(s), 1.0 / 3.0);
  float sz = uSize * (0.7 + 0.3 * rnd(s));
  int A = uGroupA[g], B = uGroupB[g];
  vec3 q = project(A, seed);
  vec3 n = normalize(shapeGrad(A, q));
  if (uMix > 0.0 && B != A) {
    vec3 qB = project(B, seed);
    vec3 m = mix(n, normalize(shapeGrad(B, qB)), uMix);
    n = length(m) > 1e-3 ? normalize(m) : n;
    q = mix(q, qB, uMix);
  }
  gNormal = shapeToWorld(n, uSpin, uTilt, 1.0);   // world surface normal (rotation only)
  vec3 p = shapeToWorld(q, uSpin, uTilt, uScale) + uAxis * x * uSpacing;
  return vec4(p, sz);
}
`;

const MODES = { plume: PLUME, stream: STREAM, surface: SURFACE, lattice: LATTICE, morph: MORPH, conveyor: CONVEYOR };

// normals: also write gNormal (set by the mode's particle()) to a second target.
export function flowShaders(mode, { normals = false } = {}) {
  const vs = HEADER + /* glsl */`
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  gl_Position = vec4(c, 0.0, 1.0);
}`;
  const fs = HEADER + NOISE + COMMON + 'vec3 gNormal = vec3(0.0);\n' + MODES[mode] + /* glsl */`
layout(location = 0) out vec4 o;
${normals ? 'layout(location = 1) out vec4 oN;' : ''}
vec4 run() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int id = px.y * uPosW + px.x;
  if (id == uCount) return vec4(0.0, 0.0, 0.0, uCoreR);  // optional solid core sphere
  if (id > uCount) return vec4(0.0);
  return particle(uint(id));
}
void main() {
  o = run();
  ${normals ? 'oN = vec4(gNormal, 0.0);' : ''}
}`;
  return { vs, fs };
}
