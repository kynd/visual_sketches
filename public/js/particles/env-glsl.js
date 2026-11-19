// Environment maps for the particle demos.
//
// 1. envMapShaders()  — renders one environment into an equirectangular
//    RGBA16F texture (linear, HDR). u = azimuth, v = elevation.
// 2. ENV_SHADING      — GLSL appended to the particle uber-shader (with the
//    ENV_LIGHTING define), the ground and the background: samples that texture
//    by direction and shades a sphere with it.

import { NOISE } from './flow-glsl.js';

const HEADER = /* glsl */`#version 300 es
precision highp float;
precision highp int;
`;

const FULLSCREEN_VS = HEADER + /* glsl */`
out vec2 vUv;
void main() {
  vUv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}`;

// ── Environment generation ───────────────────────────────────────────────
const ENV_COMMON = /* glsl */`
uniform int   uEnv;
uniform float uTime;
uniform vec3  uSunDir;    // toward the sun (or moon / key light), environment frame
uniform vec3  uSunCol;    // the same light's colour × strength, for lighting the land
in vec2 vUv;
out vec4 o;

const float PI  = 3.14159265359;
const float TAU = 6.28318530718;

// Equirectangular: u ∈ [0,1) is azimuth atan(z, x), v ∈ [0,1] is elevation asin(y).
vec3 dirFromUv(vec2 uv) {
  float ph = (uv.x - 0.5) * TAU, th = (uv.y - 0.5) * PI;
  return vec3(cos(th) * cos(ph), sin(th), cos(th) * sin(ph));
}

float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * snoise(p);
    p = p * 2.03 + vec3(1.7, -3.1, 2.3);
    a *= 0.5;
  }
  return s;
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
`;

// Ideas carried over from geom's environment maps.
const ENV_GEOM = /* glsl */`
// ── OKLCH / CIELAB hue spheres (geom: oklch-envmap.js, lab-envmap.js) ──
// Azimuth → hue, elevation → lightness, chroma = the most the sRGB gamut allows.
vec3 oklabToLinear(float L, float a, float b) {
  float l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  float m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  float s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  float l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return vec3( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
              -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
              -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
vec3 labToLinear(float L, float a, float b) {
  const float EPS = 216.0 / 24389.0, KAPPA = 24389.0 / 27.0;
  float fy = (L + 16.0) / 116.0, fx = a / 500.0 + fy, fz = fy - b / 200.0;
  float rx = fx * fx * fx > EPS ? fx * fx * fx : (116.0 * fx - 16.0) / KAPPA;
  float ry = L > KAPPA * EPS ? fy * fy * fy : L / KAPPA;
  float rz = fz * fz * fz > EPS ? fz * fz * fz : (116.0 * fz - 16.0) / KAPPA;
  vec3 xyz = vec3(0.9504492182750991 * rx, ry, 1.0889166484304715 * rz);
  return vec3( 3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z,
              -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z,
               0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z);
}
bool inGamut(vec3 c) { return all(greaterThanEqual(c, vec3(-0.001))) && all(lessThanEqual(c, vec3(1.001))); }

vec3 envOklch(vec2 uv) {
  float L = uv.y, H = uv.x * TAU, lo = 0.0, hi = 0.5;
  for (int i = 0; i < 20; i++) {
    float mid = 0.5 * (lo + hi);
    if (inGamut(oklabToLinear(L, mid * cos(H), mid * sin(H)))) lo = mid; else hi = mid;
  }
  return clamp(oklabToLinear(L, lo * cos(H), lo * sin(H)), 0.0, 1.0);
}
vec3 envLab(vec2 uv) {
  float L = uv.y * 100.0, H = uv.x * TAU, lo = 0.0, hi = 200.0;
  for (int i = 0; i < 20; i++) {
    float mid = 0.5 * (lo + hi);
    if (inGamut(labToLinear(L, mid * cos(H), mid * sin(H)))) lo = mid; else hi = mid;
  }
  return clamp(labToLinear(L, lo * cos(H), lo * sin(H)), 0.0, 1.0);
}
vec3 oklch(float L, float C, float H) { return clamp(oklabToLinear(L, C * cos(H), C * sin(H)), 0.0, 1.0); }
float maxChroma(float L, float H) {
  float lo = 0.0, hi = 0.5;
  for (int i = 0; i < 16; i++) {
    float mid = 0.5 * (lo + hi);
    if (inGamut(oklabToLinear(L, mid * cos(H), mid * sin(H)))) lo = mid; else hi = mid;
  }
  return lo;
}

// ── 2D fills wrapped as an equirectangular map (geom: sound-fill-3d) ──
// The fill is mirrored at u = 0.5 so the seam at u = 0 / 1 disappears.
vec2 fillUv(vec2 uv) {
  float m = uv.x < 0.5 ? uv.x * 2.0 : (1.0 - uv.x) * 2.0;
  return vec2((m * 2.0 - 1.0) * 1.78, uv.y * 2.0 - 1.0);
}
// Stand-in for an FFT band: a slow, smooth level per band instead of audio.
float band(float fk, float t) {
  return clamp(0.45 + 0.30 * sin(t * 0.37 + fk * 11.3) + 0.20 * sin(t * 0.83 + fk * 5.1), 0.0, 1.0);
}
// Anisotropic wave (geom fill mode 1): 12 plane waves, x squeezed 0.4×.
vec3 envWave(vec2 uv0) {
  vec2 uv = fillUv(uv0), s = vec2(uv.x * 0.4, uv.y);
  float I = 0.0;
  for (int k = 0; k < 12; k++) {
    float fk = (float(k) + 0.5) / 12.0, amp = band(fk, uTime), ang = TAU * float(k) / 12.0;
    I += amp * cos(dot(vec2(cos(ang), sin(ang)), s) * (2.0 + amp * 6.5) + uTime * (0.35 + amp));
  }
  I /= 12.0;
  float H = mod(uv.x * 0.8 + I * PI + uTime * 0.1, TAU);
  float L = 0.20 + 0.58 * (0.5 + 0.5 * I);
  return oklch(L, maxChroma(L, H) * 0.9, H);
}
// Drifting caustic (geom fill mode 3): 7 drifting waves sharpened into bands.
vec3 envCaustic(vec2 uv0) {
  vec2 uv = fillUv(uv0);
  float I = 0.0, H = 0.0;
  for (int k = 0; k < 7; k++) {
    float fk = (float(k) + 0.5) / 7.0, amp = band(fk, uTime), ang = TAU * float(k) / 7.0;
    float w = amp * cos(dot(vec2(cos(ang), sin(ang)), uv) * (1.8 + amp * 5.5) + float(k + 1) * 0.73 * uTime);
    I += w;
    H += abs(w) * fk;
  }
  I /= 7.0;
  float I2 = 0.5 + 0.5 * cos(I * 3.0 * PI);
  H = mod(H * TAU + uTime * 0.25, TAU);
  float L = 0.18 + 0.62 * I2;
  return oklch(L, maxChroma(L, H) * 0.9 * I2, H);
}

// ── Studio (geom: lighting.glsl) as an environment ──
// The key and fill lights become rectangular softboxes; a cool strip low
// behind the subject stands in for the Fresnel rim.
float softbox(vec3 d, vec3 c, vec2 size) {
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), c)), u = cross(c, r);
  float z = dot(d, c);
  if (z <= 0.0) return 0.0;
  vec2 q = vec2(dot(d, r), dot(d, u)) / z / size;
  vec2 e = smoothstep(vec2(1.0), vec2(0.85), abs(q));
  return e.x * e.y;
}
vec3 envStudio(vec3 d) {
  vec3 col = vec3(0.012) + vec3(0.025) * smoothstep(-0.2, 1.0, d.y);
  col += vec3(4.0) * softbox(d, uSunDir, vec2(0.45, 0.32));
  col += vec3(1.1) * softbox(d, normalize(vec3(-0.8, 0.3, 0.5)), vec2(0.35, 0.5));
  col += vec3(0.12, 0.18, 0.38) * 1.5 * exp(-pow((d.y - 0.05) / 0.06, 2.0));
  return col;
}
`;

// Nature-inspired skies. Values are linear and HDR: the sun disc is far brighter than 1.
const ENV_NATURE = /* glsl */`
vec3 sunDisc(vec3 d, float size, vec3 col) {
  float mu = dot(d, uSunDir);
  return col * smoothstep(cos(size * 1.15), cos(size), mu);
}
// Clouds on a flat layer above the viewer: d is projected onto the plane y = 1.
float cloudDensity(vec3 d, float cover, float scale, vec2 wind) {
  vec2 p = d.xz / max(d.y, 0.03) * scale + wind * uTime;
  float n = fbm(vec3(p, uTime * 0.02), 5);
  return smoothstep(1.0 - cover, 1.35 - cover, n * 0.5 + 0.5);
}

vec3 envClear(vec3 d) {
  float y = max(d.y, 0.0), mu = max(dot(d, uSunDir), 0.0);
  vec3 sky = mix(vec3(0.62, 0.76, 0.92), vec3(0.08, 0.24, 0.62), pow(y, 0.45));
  sky += vec3(1.0, 0.9, 0.7) * (0.35 * pow(mu, 8.0) + 1.2 * pow(mu, 300.0));
  sky += sunDisc(d, 0.012, vec3(60.0, 54.0, 46.0));
  return sky;
}

vec3 envSunset(vec3 d) {
  float y = max(d.y, 0.0), mu = max(dot(d, uSunDir), 0.0);
  float az = 0.5 + 0.5 * dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz));   // 1 toward the sun
  vec3 horizon = mix(vec3(0.30, 0.10, 0.20), vec3(0.95, 0.30, 0.06), az * az);
  vec3 mid = mix(vec3(0.16, 0.08, 0.24), vec3(0.50, 0.16, 0.16), az * az);
  vec3 sky = mix(horizon, mid, smoothstep(0.0, 0.18, y));
  sky = mix(sky, vec3(0.03, 0.05, 0.18), smoothstep(0.12, 0.85, y));
  sky += vec3(1.2, 0.42, 0.10) * (0.5 * pow(mu, 12.0) + 2.0 * pow(mu, 400.0));
  sky += sunDisc(d, 0.02, vec3(40.0, 16.0, 5.0));
  // Thin streaks of cloud, lit from below on the sun side.
  if (d.y > 0.0) {
    vec2 p = d.xz / max(d.y, 0.03) * vec2(0.25, 1.1) + vec2(0.02, 0.0) * uTime;
    float c = smoothstep(0.1, 0.6, fbm(vec3(p, 3.0), 4) * 0.5 + 0.5) * smoothstep(0.0, 0.08, d.y) * (1.0 - smoothstep(0.35, 0.7, d.y));
    sky = mix(sky, mix(vec3(0.20, 0.10, 0.18), vec3(1.6, 0.6, 0.25), pow(az, 3.0)), c * 0.8);
  }
  return sky;
}

vec3 envCloudy(vec3 d) {
  float y = max(d.y, 0.0), mu = max(dot(d, uSunDir), 0.0);
  vec3 sky = mix(vec3(0.70, 0.78, 0.86), vec3(0.18, 0.34, 0.66), pow(y, 0.5));
  sky += vec3(1.0, 0.92, 0.8) * (0.25 * pow(mu, 6.0) + pow(mu, 300.0));
  sky += sunDisc(d, 0.012, vec3(40.0, 36.0, 30.0));
  if (d.y > 0.0) {
    vec2 wind = vec2(0.03, 0.012);
    float c = cloudDensity(d, 0.55, 0.35, wind);
    // Light: step the density lookup toward the sun; denser there → darker underside.
    vec3 ds = normalize(d + uSunDir * 0.08);
    float shade = clamp(1.0 - 1.4 * (cloudDensity(ds, 0.55, 0.35, wind) - c), 0.35, 1.0);
    vec3 cloud = mix(vec3(0.38, 0.40, 0.46), vec3(1.25, 1.2, 1.12), shade);
    cloud += vec3(1.0, 0.9, 0.75) * 1.5 * pow(mu, 20.0) * (1.0 - c);    // silver lining
    float fade = smoothstep(0.0, 0.15, d.y);
    sky = mix(sky, cloud, c * fade);
  }
  return sky;
}

vec3 envOvercast(vec3 d) {
  float y = max(d.y, 0.0);
  // CIE overcast sky: the zenith is about three times brighter than the horizon.
  vec3 sky = vec3(0.62, 0.64, 0.68) * (1.0 + 2.0 * y) / 3.0 * 1.6;
  if (d.y > 0.0) {
    vec2 p = d.xz / max(d.y, 0.05) * 0.4 + vec2(0.05, 0.02) * uTime;
    float n = fbm(vec3(p, uTime * 0.03), 5);
    sky *= 1.0 + (0.45 * n - 0.25) * smoothstep(0.02, 0.35, d.y);   // flatten toward the haze at the horizon
  }
  return sky;
}

vec3 stars(vec3 d, float density) {
  vec3 p = d * 220.0, c = floor(p);
  float h = hash13(c);
  if (h > density) return vec3(0.0);
  vec3 f = fract(p) - 0.5 - 0.3 * (vec3(hash13(c + 1.3), hash13(c + 2.7), hash13(c + 4.1)) - 0.5);
  float tw = 0.7 + 0.3 * sin(uTime * (2.0 + 4.0 * hash13(c + 7.7)) + h * 100.0);
  vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.7), hash13(c + 9.1));
  return tint * exp(-dot(f, f) * 60.0) * tw * (2.0 + 6.0 * hash13(c + 5.5));
}

vec3 envNight(vec3 d) {
  float y = max(d.y, 0.0), mu = max(dot(d, uSunDir), 0.0);
  vec3 sky = mix(vec3(0.020, 0.028, 0.055), vec3(0.004, 0.007, 0.020), pow(y, 0.5));
  if (d.y > 0.0) {
    // A band of faint stars and dust along a tilted great circle.
    float g = exp(-pow(dot(d, normalize(vec3(0.3, 0.55, 0.78))) / 0.22, 2.0));
    float dust = fbm(d * 6.0, 4) * 0.5 + 0.5;
    sky += vec3(0.05, 0.05, 0.07) * g * dust;
    sky += stars(d, 0.06 + 0.10 * g) * smoothstep(0.0, 0.1, d.y);
  }
  sky += vec3(0.4, 0.45, 0.6) * (0.08 * pow(mu, 10.0) + 0.5 * pow(mu, 200.0));
  sky += sunDisc(d, 0.035, vec3(9.0, 9.5, 10.0)) * (0.85 + 0.15 * fbm(d * 60.0, 3));
  return sky;
}

vec3 envAurora(vec3 d) {
  vec3 sky = mix(vec3(0.015, 0.03, 0.04), vec3(0.003, 0.006, 0.015), pow(max(d.y, 0.0), 0.5));
  if (d.y > 0.0) {
    sky += stars(d, 0.05) * smoothstep(0.0, 0.1, d.y) * 0.7;
    // Curtains: a wavy line on a layer, repeated over several heights so
    // the light seems to hang in vertical folds. Green low, violet high.
    vec3 acc = vec3(0.0);
    // The band lies across the default view direction (azimuth of CAM_YAW in env-plume.js).
    const vec2 F = vec2(-0.746, 0.666), S = vec2(0.666, 0.746);
    for (int k = 0; k < 8; k++) {
      float h = 1.0 + float(k) * 0.12;
      vec2 p = d.xz / max(d.y, 0.04) * h;
      float a = dot(p, S), b = dot(p, F);
      float line = b - 6.5 + 0.5 * sin(a * 0.7 + uTime * 0.15) + 0.35 * snoise(vec3(a * 0.6, 0.0, uTime * 0.08));
      float curtain = exp(-line * line * 6.0);
      float rays = 0.55 + 0.45 * snoise(vec3(a * 6.0, float(k) * 0.3, uTime * 0.25));
      vec3 c = mix(vec3(0.1, 1.0, 0.45), vec3(0.6, 0.2, 0.9), float(k) / 7.0);
      acc += c * curtain * rays * (1.0 - float(k) / 9.0);
    }
    sky += acc * 0.8 * smoothstep(0.0, 0.12, d.y);
  }
  sky += sunDisc(d, 0.03, vec3(5.0, 5.2, 5.6));
  return sky;
}

vec3 envUnderwater(vec3 d) {
  // Deep water fades from blue-green overhead to black below.
  vec3 col = mix(vec3(0.0, 0.015, 0.03), vec3(0.02, 0.22, 0.30), smoothstep(-0.8, 0.6, d.y));
  // Snell's window: light from above the surface arrives within ~48.6° of vertical.
  float w = smoothstep(0.62, 0.70, d.y);
  if (w > 0.0) {
    vec2 p = d.xz / d.y * 3.0;
    float rip = abs(snoise(vec3(p, uTime * 0.4))) + 0.5 * abs(snoise(vec3(p * 2.1, uTime * 0.6)));
    col += vec3(0.5, 0.85, 0.95) * w * (0.8 + 1.4 * pow(1.0 - clamp(rip, 0.0, 1.0), 6.0));
  }
  float mu = max(dot(d, uSunDir), 0.0);
  col += vec3(0.6, 0.95, 1.0) * (0.25 * pow(mu, 6.0) + 3.0 * pow(mu, 200.0));
  // Shafts: brightness streaks that fan out from the sun direction.
  vec3 q = normalize(d - uSunDir * dot(d, uSunDir));
  col += vec3(0.1, 0.3, 0.35) * pow(mu, 3.0) * smoothstep(0.2, 0.9, snoise(vec3(q * 4.0 + vec3(0.0, uTime * 0.1, 0.0))));
  return col;
}
`;

export const ENV_LIST = [
  // id, key, label, animated
  [0, 'studio', 'Studio softboxes', false],
  [1, 'oklch', 'OKLCH hue sphere', false],
  [2, 'lab', 'CIELAB hue sphere', false],
  [3, 'wave', 'Anisotropic wave', true],
  [4, 'caustic', 'Drifting caustic', true],
  [5, 'clear', 'Clear day', false],
  [6, 'sunset', 'Sunset', true],
  [7, 'cloudy', 'Cloudy sky', true],
  [8, 'overcast', 'Overcast', true],
  [9, 'night', 'Night sky', true],
  [10, 'aurora', 'Aurora', true],
  [11, 'underwater', 'Underwater', true],
];

export function envMapShaders() {
  const fs = HEADER + NOISE + ENV_COMMON + ENV_GEOM + ENV_NATURE + /* glsl */`
void main() {
  vec3 d = dirFromUv(vUv);
  vec3 c;
  if      (uEnv == 0)  c = envStudio(d);
  else if (uEnv == 1)  c = envOklch(vUv);
  else if (uEnv == 2)  c = envLab(vUv);
  else if (uEnv == 3)  c = envWave(vUv);
  else if (uEnv == 4)  c = envCaustic(vUv);
  else if (uEnv == 5)  c = envClear(d);
  else if (uEnv == 6)  c = envSunset(d);
  else if (uEnv == 7)  c = envCloudy(d);
  else if (uEnv == 8)  c = envOvercast(d);
  else if (uEnv == 9)  c = envNight(d);
  else if (uEnv == 10) c = envAurora(d);
  else                 c = envUnderwater(d);
  // Land for the skies: a grey ground (albedo 0.3) lit by the zenith and the
  // sun, exactly like the ground plane, under a band of haze at the horizon.
  if (uEnv >= 5 && d.y < 0.0) {
    vec3 zenith = vec3(0.0, 1.0, 0.0), hz = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0));
    vec3 sky0, haze;
    if      (uEnv == 5) { sky0 = envClear(zenith);    haze = envClear(hz); }
    else if (uEnv == 6) { sky0 = envSunset(zenith);   haze = envSunset(hz); }
    else if (uEnv == 7) { sky0 = envCloudy(zenith);   haze = envCloudy(hz); }
    else if (uEnv == 8) { sky0 = envOvercast(zenith); haze = envOvercast(hz); }
    else if (uEnv == 9) { sky0 = envNight(zenith);    haze = envNight(hz); }
    else if (uEnv == 10){ sky0 = envAurora(zenith);   haze = envAurora(hz); }
    else                { sky0 = envUnderwater(zenith); haze = envUnderwater(hz); }
    vec3 ground = 0.3 * (sky0 + uSunCol * max(uSunDir.y, 0.0));
    // Under water, the seabed disappears into the blue over a much longer distance.
    c = mix(haze, ground, smoothstep(0.0, uEnv == 11 ? -0.6 : -0.06, d.y));
  }
  o = vec4(max(c, 0.0), 1.0);
}`;
  return { vs: FULLSCREEN_VS, fs };
}

// ── Shading with the environment ─────────────────────────────────────────
// Appended to the shared COMMON block, so uKeyDir, uCamRot etc. are available.
export const ENV_SHADING = /* glsl */`
uniform highp sampler2D uEnvTex;
uniform float uEnvRot;      // radians: world → environment rotation about y
uniform float uBlur;        // mip level of the lookup
uniform float uOcclusion;   // how much the sun's shadow also darkens environment light
uniform float uExposure;
uniform vec3  uSunCol;      // shadow-casting light colour × strength (linear)
uniform int   uShading;     // 0 paint, 1 light, 2 mirror
uniform int   uLookup;      // 0 normal, 1 reflection
uniform int   uBgMode;      // 0 environment, 1 dimmed, 2 black

vec3 envSample(vec3 d, float lod) {
  float c = cos(uEnvRot), s = sin(uEnvRot);
  d = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  return textureLod(uEnvTex, uv, lod).rgb;    // explicit LOD: no seam at the atan wrap
}

vec3 envBackground(vec3 rd) {
  if (uBgMode == 2) return vec3(0.0);
  return envSample(rd, 0.0) * (uBgMode == 1 ? 0.05 : 1.0);
}

vec3 envShade(vec3 n, vec3 rd, float sh) {
  vec3 dir = uLookup == 0 ? n : reflect(rd, n);
  vec3 E = envSample(dir, uBlur);
  float vis = mix(1.0, sh, uOcclusion);
  float ndl = max(dot(n, uKeyDir), 0.0) * sh;
  vec3 spec = uSunCol * pow(max(dot(n, normalize(uKeyDir - rd)), 0.0), 72.0) * sh;
  if (uShading == 0) return E * (0.4 * vis + 0.75 * ndl * uSunCol) + 0.35 * spec;    // paint (geom)
  if (uShading == 1) return 0.8 * (E * vis + ndl * uSunCol) + 0.25 * spec;           // light
  float fr = 0.6 + 0.4 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);                     // mirror
  return 0.9 * E * vis * fr + 0.3 * spec;
}

// Exposure, ACES filmic curve (Narkowicz fit), gamma.
vec3 envOutput(vec3 c) {
  c *= uExposure;
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(c, 0.0, 1.0), vec3(0.4545));
}
`;

// Background: the environment seen through each pixel's view ray.
export function backgroundShaders(head) {
  const vs = head + /* glsl */`
out vec2 vNdc;
void main() {
  vNdc = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  gl_Position = vec4(vNdc, 0.0, 1.0);
}`;
  const fs = head + /* glsl */`
in vec2 vNdc;
out vec4 fragColor;
void main() {
  vec3 rd = normalize(uCamRot * vec3(vNdc.x / uProj[0][0], vNdc.y / uProj[1][1], -1.0));
  fragColor = vec4(envOutput(envBackground(rd)), 1.0);
}`;
  return { vs, fs };
}

// Ground lit by the sky straight above (a heavily blurred lookup) plus the
// shadowed sun, fading into the background toward its edge.
export function envGroundShaders(head) {
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
  vec3 rd = normalize(vWorld - uCamPos);
  float sh = shadowMapLookup(vWorld);
  vec3 sky = envSample(vec3(0.0, 1.0, 0.0), 0.0);    // the zenith, as the land in the map uses
  vec3 col = 0.3 * (sky * mix(1.0, sh, uOcclusion) + max(uKeyDir.y, 0.0) * sh * uSunCol);
  col = mix(col, envBackground(rd), smoothstep(uGroundHalf * 0.35, uGroundHalf, length(vWorld.xz)));
  fragColor = vec4(envOutput(col), 1.0);
}`;
  return { vs, fs };
}

// Inset showing the equirectangular map itself.
export function envInsetShaders(head) {
  const fs = head + /* glsl */`
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = vec4(envOutput(textureLod(uEnvTex, vUv, 0.0).rgb), 1.0); }`;
  return { vs: FULLSCREEN_VS, fs };
}
