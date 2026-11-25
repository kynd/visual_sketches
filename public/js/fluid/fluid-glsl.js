// Shaders for the watercolour fluid (ported from math_sketches Fluid IV,
// navier-stokes-4/shaders, to GLSL ES 3.00 and non-square grids).
//
// Every pass draws one full-screen triangle strip; the vertex shader also
// hands the fragment shader its four neighbour coordinates on the target grid.

export const VS = /* glsl */`#version 300 es
uniform vec2 uTexel;
out vec2 vUv, vL, vR, vT, vB;
void main() {
  vUv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEAD = /* glsl */`#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv, vL, vR, vT, vB;
out vec4 o;
`;

// Semi-Lagrangian advection (Stam 1999). With the wetness gate on, the
// tracing velocity is scaled by how wet the paper is, and a traced sample is
// blended in by its own pigment coverage so unpainted texels don't drag
// black into painted ones.
export const ADVECT = HEAD + /* glsl */`
uniform sampler2D uVelocity, uSource, uWetness;
uniform vec2 uVelTexel, uSrcTexel;
uniform float uDt, uDissipation;
uniform int uUseWetness;
vec4 bilerp(sampler2D s, vec2 uv, vec2 ts) {
  vec2 st = uv / ts - 0.5;
  vec2 i = floor(st), f = fract(st);
  vec4 a = texture(s, (i + vec2(0.5, 0.5)) * ts);
  vec4 b = texture(s, (i + vec2(1.5, 0.5)) * ts);
  vec4 c = texture(s, (i + vec2(0.5, 1.5)) * ts);
  vec4 d = texture(s, (i + vec2(1.5, 1.5)) * ts);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec2 vel = bilerp(uVelocity, vUv, uVelTexel).xy;
  if (uUseWetness == 1) vel *= smoothstep(0.02, 0.18, texture(uWetness, vUv).x);
  vec4 q = bilerp(uSource, vUv - uDt * vel * uVelTexel, uSrcTexel);
  if (uUseWetness == 1) {
    vec4 cur = texture(uSource, vUv);
    q.rgb = mix(cur.rgb, q.rgb, q.a);
    q.a = max(cur.a, q.a);
  }
  o = q / (1.0 + uDissipation * uDt);
}`;

export const DIVERGENCE = HEAD + /* glsl */`
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

export const CURL = HEAD + /* glsl */`
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).y, R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x, B = texture(uVelocity, vB).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

// Vorticity confinement (Fedkiw et al. 2001).
export const VORTICITY = HEAD + /* glsl */`
uniform sampler2D uVelocity, uCurl;
uniform float uCurlAmt, uDt;
void main() {
  float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x, B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 g = 0.5 * vec2(abs(R) - abs(L), abs(T) - abs(B));
  vec2 N = g / (length(g) + 1e-5);
  vec2 vel = texture(uVelocity, vUv).xy + uCurlAmt * C * vec2(N.y, -N.x) * uDt;
  o = vec4(clamp(vel, -2000.0, 2000.0), 0.0, 1.0);
}`;

// One Jacobi sweep of lap(p) = div u, Neumann walls.
export const PRESSURE = HEAD + /* glsl */`
uniform sampler2D uPressure, uDivergence;
void main() {
  float C = texture(uPressure, vUv).x;
  float L = vL.x < 0.0 ? C : texture(uPressure, vL).x;
  float R = vR.x > 1.0 ? C : texture(uPressure, vR).x;
  float T = vT.y > 1.0 ? C : texture(uPressure, vT).x;
  float B = vB.y < 0.0 ? C : texture(uPressure, vB).x;
  o = vec4((L + R + T + B - texture(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
}`;

// u <- u - grad p, free-slip walls.
export const GRADIENT = HEAD + /* glsl */`
uniform sampler2D uPressure, uVelocity;
void main() {
  float C = texture(uPressure, vUv).x;
  float L = vL.x < 0.0 ? C : texture(uPressure, vL).x;
  float R = vR.x > 1.0 ? C : texture(uPressure, vR).x;
  float T = vT.y > 1.0 ? C : texture(uPressure, vT).x;
  float B = vB.y < 0.0 ? C : texture(uPressure, vB).x;
  vec2 vel = texture(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B);
  vec2 m = vec2(1.0);
  if (vL.x < 0.0 || vR.x > 1.0) m.x = -1.0;
  if (vB.y < 0.0 || vT.y > 1.0) m.y = -1.0;
  o = vec4(vel * m, 0.0, 1.0);
}`;

// One Jacobi sweep of the implicit viscous solve (I - nu dt lap) u = u_old.
export const VISCOSITY = HEAD + /* glsl */`
uniform sampler2D uVelocity, uSource;
uniform float uAlpha;
void main() {
  vec2 C = texture(uVelocity, vUv).xy;
  vec2 L = vL.x < 0.0 ? -C : texture(uVelocity, vL).xy;
  vec2 R = vR.x > 1.0 ? -C : texture(uVelocity, vR).xy;
  vec2 T = vT.y > 1.0 ? -C : texture(uVelocity, vT).xy;
  vec2 B = vB.y < 0.0 ? -C : texture(uVelocity, vB).xy;
  o = vec4((texture(uSource, vUv).xy + uAlpha * (L + R + T + B)) / (1.0 + 4.0 * uAlpha), 0.0, 1.0);
}`;

// Scale a field: copies (1), decays the pressure guess (0.8), dries wetness.
export const SCALE = HEAD + /* glsl */`
uniform sampler2D uTexture;
uniform float uValue;
void main() { o = uValue * texture(uTexture, vUv); }`;

// The paper keeps a permanent stain: its colour drifts toward the dye while
// wet, and its coverage only ever grows. Weighted by the dye's own coverage,
// so water with no pigment in it leaves no mark.
export const PAPER = HEAD + /* glsl */`
uniform sampler2D uPaper, uDye, uWetness;
void main() {
  vec4 paper = texture(uPaper, vUv), dye = texture(uDye, vUv);
  float w = clamp(texture(uWetness, vUv).x, 0.0, 1.0) * dye.a;
  o = vec4(mix(paper.rgb, dye.rgb, w), max(paper.a, w));
}`;

// Batched Gaussian splats. Each entry: uA = (x, y, vx, vy) with x, y in
// domain units (short side = 1) and v in texels/s; uB = (r, g, b, radius
// scale); uC = (water, pigment amount). Mode 0 adds momentum, 1 takes the max
// of the water, 2 mixes the dye toward the colour in order.
export const MAX_SPLATS = 48;
export const SPLAT = HEAD + /* glsl */`
#define MAX ${MAX_SPLATS}
uniform sampler2D uTarget;
uniform vec2 uDomain;
uniform float uRadius;
uniform int uCount, uMode;
uniform vec4 uA[MAX], uB[MAX], uC[MAX];
void main() {
  vec4 cur = texture(uTarget, vUv);
  vec2 p = vUv * uDomain;
  for (int i = 0; i < MAX; i++) {
    if (i >= uCount) break;
    vec2 d = p - uA[i].xy;
    float q = dot(d, d) / (uRadius * uB[i].w);
    if (q > 18.0) continue;
    float g = exp(-q);
    if (uMode == 0) cur.xy += g * uA[i].zw;
    else if (uMode == 1) cur.x = max(cur.x, g * uC[i].x);
    else {
      float w = clamp(g * uC[i].y, 0.0, 1.0);
      cur.rgb = mix(cur.rgb, uB[i].rgb, w);
      cur.a = max(cur.a, w);
    }
  }
  o = cur;
}`;

// MacCormack correction (Selle et al. 2008): forward-advected F, then B = F
// advected back; the estimate F + (src - B) / 2 is clamped to the four source
// texels the backward trace lands between, which keeps it stable.
export const MACCORMACK = HEAD + /* glsl */`
uniform sampler2D uVelocity, uSource, uForward, uBackward;
uniform vec2 uVelTexel, uSrcTexel;
uniform float uDt;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 st = (vUv - uDt * vel * uVelTexel) / uSrcTexel - 0.5;
  vec2 i = floor(st);
  vec4 a = texture(uSource, (i + vec2(0.5, 0.5)) * uSrcTexel);
  vec4 b = texture(uSource, (i + vec2(1.5, 0.5)) * uSrcTexel);
  vec4 c = texture(uSource, (i + vec2(0.5, 1.5)) * uSrcTexel);
  vec4 d = texture(uSource, (i + vec2(1.5, 1.5)) * uSrcTexel);
  vec4 lo = min(min(a, b), min(c, d)), hi = max(max(a, b), max(c, d));
  vec4 f = texture(uForward, vUv);
  o = clamp(f + 0.5 * (texture(uSource, vUv) - texture(uBackward, vUv)), lo, hi);
}`;

// Starting colour patterns for the plain liquid, in domain units (short side
// = 1). Colours come from uCols (already shuffled); each region takes one.
export const MAX_PATTERN_COLS = 20;
export const PATTERN = HEAD + /* glsl */`
uniform vec2 uDomain;
uniform int uPattern, uCount;
uniform float uScale, uAngle;
uniform vec2 uCentre;
uniform vec3 uCols[${MAX_PATTERN_COLS}];
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
vec3 pick(float k) { int n = max(uCount, 1); return uCols[int(mod(k, float(n)))]; }
void main() {
  vec2 p = vUv * uDomain;
  vec2 dir = vec2(cos(uAngle), sin(uAngle));
  vec3 col;
  if (uPattern == 0) {                        // stripes
    col = pick(floor(dot(p, dir) / uScale + 1000.0));
  } else if (uPattern == 1) {                 // rings
    col = pick(floor(length(p - uCentre) / uScale));
  } else if (uPattern == 2) {                 // cells (jittered Voronoi)
    vec2 g = p / (uScale * 2.5), gi = floor(g);
    float best = 1e9; vec2 id = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 c = gi + vec2(x, y), q = c + h22(c);
      float d = dot(g - q, g - q);
      if (d < best) { best = d; id = c; }
    }
    col = pick(floor(h21(id) * 997.0));
  } else if (uPattern == 4) {                 // linear gradient from uCols[0] to uCols[1] along dir
    float ext = 0.5 * (abs(dir.x) * uDomain.x + abs(dir.y) * uDomain.y);
    float t = clamp(0.5 + dot(p - 0.5 * uDomain, dir) / (2.0 * ext), 0.0, 1.0);
    col = mix(uCols[0], uCols[1], t);
  } else {                                    // marbled bands
    vec2 n = vec2(-dir.y, dir.x);
    float w = 0.35 * sin(dot(p, n) * 3.1 + 1.3) + 0.22 * sin(dot(p, dir) * 5.3 + dot(p, n) * 2.1)
            + 0.12 * sin(dot(p, n) * 9.7 - dot(p, dir) * 4.4);
    col = pick(floor((dot(p, dir) + w) / uScale + 1000.0));
  }
  o = vec4(col, 1.0);
}`;

const OKLCH = /* glsl */`
const float PI = 3.14159265359;
vec3 oklabToLinear(float L, float a, float b) {
  float l_ = L + 0.3963377774*a + 0.2158037573*b;
  float m_ = L - 0.1055613458*a - 0.0638541728*b;
  float s_ = L - 0.0894841775*a - 1.2914855480*b;
  float l = l_*l_*l_, m = m_*m_*m_, s = s_*s_*s_;
  return vec3( 4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
              -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
              -0.0041960863*l - 0.7034186147*m + 1.7076147010*s);
}
bool inGamut(vec3 c) { return all(greaterThanEqual(c, vec3(-0.001))) && all(lessThanEqual(c, vec3(1.001))); }
float maxChroma(float L, float H) {
  float lo = 0.0, hi = 0.4;
  for (int i = 0; i < 16; i++) {
    float mid = 0.5 * (lo + hi);
    if (inGamut(oklabToLinear(L, mid * cos(H), mid * sin(H)))) lo = mid; else hi = mid;
  }
  return lo;
}
vec3 oklch(float L, float C, float H) { return clamp(oklabToLinear(L, C * cos(H), C * sin(H)), 0.0, 1.0); }
float squash(float x, float k) { return x / (abs(x) + k); }
`;

// Views: 0 paint, 1 paint lit by the pressure relief (light uLightDir), 2 speed, 3 vorticity,
// 4 pressure, 5 water, 6 pressure relief reflecting an OKLCH sky. With uPlain
// the paint is the dye alone (no paper or water).
export const DISPLAY = /* glsl */`#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uDye, uVelocity, uCurl, uPressure, uWetness, uPaper;
uniform vec3 uBaseColor;
uniform vec2 uRes, uDomain, uSimTexel;
uniform int uView, uPlain;
uniform float uRelief, uLLow, uLHigh, uTime;
uniform vec3 uLightDir;      // unit vector toward the light, for the lit view
uniform float uLightNorm;    // the lit view divides by this; 0.30 + 0.85 * uLightDir.z leaves flat areas unchanged
out vec4 o;
${OKLCH}
float heightAt(vec2 uv) {
  vec2 s = 2.0 * uSimTexel;
  float h = texture(uPressure, uv).x * 0.25;
  h += (texture(uPressure, uv + vec2(s.x, 0.0)).x + texture(uPressure, uv - vec2(s.x, 0.0)).x
      + texture(uPressure, uv + vec2(0.0, s.y)).x + texture(uPressure, uv - vec2(0.0, s.y)).x) * 0.125;
  h += (texture(uPressure, uv + s).x + texture(uPressure, uv - s).x
      + texture(uPressure, uv + vec2(s.x, -s.y)).x + texture(uPressure, uv + vec2(-s.x, s.y)).x) * 0.0625;
  return squash(h, 220.0) * 0.34 * uRelief;
}
vec3 reliefNormal(vec2 uv) {
  float e = 0.006;
  vec2 ex = vec2(e / uDomain.x, 0.0), ey = vec2(0.0, e / uDomain.y);
  return normalize(vec3(heightAt(uv - ex) - heightAt(uv + ex), heightAt(uv - ey) - heightAt(uv + ey), 2.0 * e));
}
vec3 paint(vec2 uv) {
  if (uPlain == 1) return texture(uDye, uv).rgb;
  vec4 paper = texture(uPaper, uv);
  vec3 col = mix(uBaseColor, paper.rgb, paper.a);
  vec4 dye = texture(uDye, uv);
  return mix(col, dye.rgb, clamp(texture(uWetness, uv).x * 1.8, 0.0, 1.0) * dye.a);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col;
  if (uView == 0) {
    col = paint(uv);
  } else if (uView == 1) {
    vec3 n = reliefNormal(uv), V = vec3(0.0, 0.0, 1.0);
    vec3 lk = uLightDir;
    float diff = max(dot(n, lk), 0.0);
    float spec = pow(max(dot(n, normalize(lk + V)), 0.0), 48.0);
    float fr = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0);
    vec3 base = paint(uv);
    col = base * (0.30 + 0.85 * diff) / uLightNorm + vec3(spec * 0.40) + base * fr * 0.25;
  } else if (uView == 2) {
    vec2 v = texture(uVelocity, uv).xy;
    float m = 1.0 - exp(-length(v) * 0.0025);
    float H = mod(atan(v.y, v.x), 2.0 * PI);
    float L = 0.05 + 0.70 * pow(m, 0.85);
    col = oklch(L, maxChroma(L, H) * (0.35 + 0.55 * m), H);
  } else if (uView == 3) {
    float w = squash(texture(uCurl, uv).x, 45.0);
    float H = w > 0.0 ? 0.62 : 3.95;
    float L = 0.05 + 0.80 * pow(abs(w), 0.55);
    col = oklch(L, maxChroma(L, H) * 0.92, H);
  } else if (uView == 4) {
    float p = squash(texture(uPressure, uv).x, 220.0);
    float H = p > 0.0 ? 1.55 : 4.90;
    float L = 0.05 + 0.78 * pow(abs(p), 0.85);
    col = oklch(L, maxChroma(L, H) * 0.88, H);
  } else if (uView == 5) {
    float H = 4.6;
    col = mix(vec3(1.0), oklch(0.42, maxChroma(0.42, H) * 0.9, H), clamp(texture(uWetness, uv).x, 0.0, 1.0));
  } else {
    vec3 n = reliefNormal(uv);
    vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
    float H = mod(atan(r.y, r.x) + uTime * 0.06, 2.0 * PI);
    float L = mix(uLLow, uLHigh, 0.5 + 0.5 * asin(clamp(r.z, -1.0, 1.0)) / (PI * 0.5));
    col = oklch(L, maxChroma(L, H), H);
    col = mix(col * 0.55, col, 0.5 + 0.5 * pow(1.0 - n.z, 4.0));
  }
  o = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
}`;
