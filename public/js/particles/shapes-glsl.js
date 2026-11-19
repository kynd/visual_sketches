// Shape library for the morphing demos, gathered from the geom project:
// signed distance functions (geom sdf-functions.glsl, after Inigo Quilez's
// primitives), Platonic solids (geom platonic-functions.glsl) and implicit
// surfaces (geom's scalar and moving scalar fields).
//
//   float shapeSDF(int id, vec3 p, float t)
//
// returns a (signed) distance to shape 'id' in shape space, where every shape
// fits in a ball of radius about 0.9. Implicit surfaces f(p) = 0 are turned
// into approximate distances with f / |∇f| (one Newton step's worth), which is
// accurate near the surface. Ids match SHAPES in shapes.js.

export const SHAPES_GLSL = /* glsl */`
float dot2(vec2 v) { return dot(v, v); }
float dot2(vec3 v) { return dot(v, v); }

// ── SDF primitives ───────────────────────────────────────────────────────
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdBoxFrame(vec3 p, vec3 b, float e) {
  p = abs(p) - b;
  vec3 q = abs(p + e) - e;
  return min(min(
    length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
    length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
    length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}
float sdTorus(vec3 p, vec2 t) { return length(vec2(length(p.xz) - t.x, p.y)) - t.y; }
float sdCappedTorus(vec3 p, vec2 sc, float ra, float rb) {
  p.x = abs(p.x);
  float k = (sc.y * p.x > sc.x * p.y) ? dot(p.xy, sc) : length(p.xy);
  return sqrt(dot(p, p) + ra * ra - 2.0 * ra * k) - rb;
}
float sdLink(vec3 p, float le, float r1, float r2) {
  vec3 q = vec3(p.x, max(abs(p.y) - le, 0.0), p.z);
  return length(vec2(length(q.xy) - r1, q.z)) - r2;
}
float sdHexPrism(vec3 p, vec2 h) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
  vec2 d = vec2(length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x), p.z - h.y);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdCappedCone(vec3 p, float h, float r1, float r2) {
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2, h), k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, (q.y < 0.0) ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot2(k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot2(ca), dot2(cb)));
}
float sdDeathStar(vec3 p2, float ra, float rb, float d) {
  float a = (ra * ra - rb * rb + d * d) / (2.0 * d);
  float b = sqrt(max(ra * ra - a * a, 0.0));
  vec2 p = vec2(p2.x, length(p2.yz));
  if (p.x * b - p.y * a > d * max(b - p.y, 0.0)) return length(p - vec2(a, b));
  return max(length(p) - ra, -(length(p - vec2(d, 0.0)) - rb));
}
float sdCutHollowSphere(vec3 p, float r, float h, float t) {
  float w = sqrt(r * r - h * h);
  vec2 q = vec2(length(p.xz), p.y);
  return ((h * q.x < w * q.y) ? length(q - vec2(w, h)) : abs(length(q) - r)) - t;
}
float sdPyramid(vec3 p, float h) {
  float m2 = h * h + 0.25;
  p.xz = abs(p.xz);
  p.xz = (p.z > p.x) ? p.zx : p.xz;
  p.xz -= 0.5;
  vec3 q = vec3(p.z, h * p.y - 0.5 * p.x, h * p.x + 0.5 * p.y);
  float s = max(-q.x, 0.0);
  float t = clamp((q.y - 0.5 * p.z) / (m2 + 0.25), 0.0, 1.0);
  float a = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
  float b = m2 * (q.x + 0.5 * t) * (q.x + 0.5 * t) + (q.y - m2 * t) * (q.y - m2 * t);
  float d2 = min(q.y, -q.x * m2 - q.y * 0.5) > 0.0 ? 0.0 : min(a, b);
  return sqrt((d2 + q.z * q.z) / m2) * sign(max(q.z, -p.y));
}
float sdRhombus(vec3 p, float la, float lb, float h, float ra) {
  p = abs(p);
  float f = clamp((la * p.x - lb * p.z + lb * lb) / (la * la + lb * lb), 0.0, 1.0);
  vec2 w = p.xz - vec2(la, lb) * vec2(f, 1.0 - f);
  vec2 q = vec2(length(w) * sign(w.x) - ra, p.y - h);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
}

// ── Platonic solids, unit circumradius ───────────────────────────────────
const float SH_PHI = 1.61803398875;
const float SH_S3 = 0.57735027;
float sdTetra(vec3 p) {
  float d = max(max(p.x + p.y - p.z, p.x - p.y + p.z), max(-p.x + p.y + p.z, -p.x - p.y - p.z));
  return d * SH_S3 - 0.33333333;
}
float sdOcta(vec3 p) {
  p = abs(p);
  float m = p.x + p.y + p.z - 1.0;
  vec3 q;
  if      (3.0 * p.x < m) q = p.xyz;
  else if (3.0 * p.y < m) q = p.yzx;
  else if (3.0 * p.z < m) q = p.zxy;
  else return m * SH_S3;
  float k = clamp(0.5 * (q.z - q.y + 1.0), 0.0, 1.0);
  return length(vec3(q.x, q.y - 1.0 + k, q.z - k));
}
float sdDodeca(vec3 p) {
  vec3 q = abs(p);
  float a = (q.y + SH_PHI * q.z) / 1.90211303;
  float b = (q.x + SH_PHI * q.y) / 1.90211303;
  float c = (SH_PHI * q.x + q.z) / 1.90211303;
  return max(max(a, b), c) - 0.79465448;
}
float sdIcosa(vec3 p) {
  vec3 q = abs(p);
  float dA = (q.x + q.y + q.z) * SH_S3;
  float dB = (SH_PHI * q.y + q.z / SH_PHI) * SH_S3;
  float dC = (q.x / SH_PHI + SH_PHI * q.z) * SH_S3;
  float dD = (SH_PHI * q.x + q.y / SH_PHI) * SH_S3;
  return max(max(dA, dB), max(dC, dD)) - 0.79465448;
}

// ── Implicit surfaces f(p) = 0 (some animated with t, as in geom) ────────
float implicitF(int id, vec3 p, float t) {
  if (id == 16) {                                     // gyroid, cell size breathing
    vec3 q = p * (4.8 + 0.8 * sin(t * 0.5));
    return cos(q.x) * sin(q.y) + cos(q.y) * sin(q.z) + cos(q.z) * sin(q.x);
  }
  if (id == 17) {                                     // Schwarz P, threshold sliding
    vec3 q = p * 4.5;
    return cos(q.x) + cos(q.y) + cos(q.z) - 0.5 * sin(t * 0.55);
  }
  if (id == 18) {                                     // tanglecube, constant sliding
    vec3 u = p * 2.6;
    vec3 u2 = u * u;
    float c = 11.8 + 0.8 * sin(t * 0.45);           // around the classic 11.8, where it stays connected
    return dot(u2 * u2, vec3(1.0)) - 5.0 * dot(u2, vec3(1.0)) + c;
  }
  if (id == 19) {                                     // Chmutov T₄, scale pulsing
    vec3 u = p * 1.22 * (1.02 + 0.13 * sin(t * 0.58));
    vec3 u2 = u * u;
    vec3 T4 = 8.0 * u2 * u2 - 8.0 * u2 + 1.0;
    return T4.x + T4.y + T4.z;
  }
  if (id == 20) {                                     // harmonic sphere, bumps rotating
    float lon = atan(p.z, p.x) - t * 0.38;
    float lat = atan(p.y, length(p.xz));
    float r = 0.72 + 0.16 * sin(3.0 * lon) * sin(2.0 * lat);
    return dot(p, p) - r * r;
  }
  if (id == 21) {                                     // pulsing torus with travelling waves
    float th = atan(p.z, p.x);
    float R = 0.58 + 0.13 * sin(t * 0.70) + 0.05 * sin(t * 1.83);
    float rt = 0.13 + 0.048 * sin(3.0 * th - t * 1.10) + 0.022 * sin(7.0 * th + t * 0.68);
    float qr = length(p.xz) - R;
    return qr * qr + p.y * p.y - rt * rt;
  }
  // 22: oscillating spheroid — prolate ↔ oblate through the P₂ mode
  float rl = length(p);
  float ct = rl > 0.001 ? p.y / rl : 0.0;
  float amp = 0.16 * sin(t * 0.85) + 0.07 * sin(t * 2.13 + 1.0);
  return rl - (0.72 + amp * 0.5 * (3.0 * ct * ct - 1.0));
}

float shapeSDF(int id, vec3 p, float t) {
  if (id == 0)  return sdSphere(p, 0.80);
  if (id == 1)  return sdRoundBox(p, vec3(0.50), 0.12);
  if (id == 2)  return sdBoxFrame(p, vec3(0.56), 0.06);
  if (id == 3)  return sdTorus(p, vec2(0.58, 0.20));
  if (id == 4)  return sdCappedTorus(p, vec2(0.866, 0.500), 0.62, 0.14);
  if (id == 5)  return sdLink(p, 0.28, 0.42, 0.11);
  if (id == 6)  return sdHexPrism(p, vec2(0.50, 0.46));
  if (id == 7)  return sdCappedCone(p, 0.62, 0.55, 0.14);
  if (id == 8)  return sdDeathStar(p, 0.76, 0.40, 0.62);
  if (id == 9)  return sdCutHollowSphere(p - vec3(0.0, 0.3, 0.0), 0.82, 0.20, 0.045);
  if (id == 10) return sdPyramid((p + vec3(0.0, 0.62, 0.0)) / 1.5, 0.85) * 1.5;
  if (id == 11) return sdRhombus(p, 0.62, 0.50, 0.30, 0.08);
  if (id == 12) return sdTetra(p / 0.95) * 0.95;
  if (id == 13) return sdOcta(p / 0.9) * 0.9;
  if (id == 14) return sdDodeca(p / 0.9) * 0.9;
  if (id == 15) return sdIcosa(p / 0.9) * 0.9;
  // Implicit: distance ≈ f / |∇f|, gradient by tetrahedral differences.
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.002;
  float f = implicitF(id, p, t);
  vec3 g = (k.xyy * implicitF(id, p + k.xyy * e, t) + k.yyx * implicitF(id, p + k.yyx * e, t)
          + k.yxy * implicitF(id, p + k.yxy * e, t) + k.xxx * implicitF(id, p + k.xxx * e, t)) / (4.0 * e);
  float d = f / max(length(g), 1e-3);
  if (id == 16) d = abs(d) - 0.03;                    // the gyroid as a thin sheet
  if (id == 16 || id == 17) d = max(d, length(p) - 0.9);   // triply periodic: clip to a ball
  return d;
}

// Rotation about y, for the shape's spin.
vec3 shapeRotY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
// Rotation about x, for the shape's tilt toward the viewer.
vec3 shapeRotX(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}
// Shape space → world: spin about the shape's own axis, then tilt, then scale.
vec3 shapeToWorld(vec3 q, float spin, float tilt, float scale) { return shapeRotX(shapeRotY(q, spin), tilt) * scale; }
vec3 worldToShape(vec3 p, float spin, float tilt, float scale) { return shapeRotY(shapeRotX(p / scale, -tilt), -spin); }
`;
