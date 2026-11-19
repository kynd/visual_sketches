// Ray-marched shape morph: one full-screen pass marches the blend of two
// signed distance fields, mix(dA, dB, s), and shades the hit with the
// environment-map lighting from env-glsl.js. Shadows are soft shadow rays
// through the same field instead of a shadow map.

import { createGL, OrbitCamera, GpuTimer, Program } from './gl.js';
import { shaderHead } from './glsl.js';
import { ENV_SHADING, envInsetShaders } from './env-glsl.js';
import { SHAPES_GLSL } from './shapes-glsl.js';
import { CAM_YAW, Environment, envSpecs, ALL_ENVS } from './env-common.js';
import { shapeSpecs, morphState } from './shapes.js';
import { speedSpec, range } from './flow-demo.js';
import { mountShell } from '../demo-shell.js';

const MARCH_FS = /* glsl */`
uniform int   uShapeA;
uniform int   uShapeB;
uniform float uMix;
uniform float uScale;
uniform float uSpin;
uniform float uTilt;
uniform float uShapeTime;
uniform int   uSteps;
uniform float uSoft;        // soft-shadow sharpness k
uniform int   uGround;
uniform float uGroundY;
uniform float uGroundHalf;
in vec2 vNdc;
out vec4 fragColor;

float sceneD(vec3 p) {
  vec3 q = worldToShape(p, uSpin, uTilt, uScale);
  float d = shapeSDF(uShapeA, q, uShapeTime);
  if (uMix > 0.0 && uShapeB != uShapeA) d = mix(d, shapeSDF(uShapeB, q, uShapeTime), uMix);
  return d * uScale;
}

vec3 sceneN(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.001;
  return normalize(k.xyy * sceneD(p + k.xyy * e) + k.yyx * sceneD(p + k.yyx * e)
                 + k.yxy * sceneD(p + k.yxy * e) + k.xxx * sceneD(p + k.xxx * e));
}

// Entry and exit distances of a ray through the bounding sphere (x > y: miss).
vec2 bound(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// Soft shadow (Inigo Quilez): the closest the ray passes to the surface,
// relative to how far it has travelled, approximates the penumbra.
float softShadow(vec3 ro, vec3 rd, float R) {
  vec2 tb = bound(ro, rd, R);
  if (tb.x > tb.y || tb.y < 0.0) return 1.0;
  float res = 1.0, t = max(tb.x, 0.02);
  for (int i = 0; i < 64; i++) {
    float h = sceneD(ro + rd * t);
    res = min(res, uSoft * h / t);
    t += clamp(h, 0.01, 0.2);
    if (res < 0.002 || t > tb.y) break;
  }
  return clamp(res, 0.0, 1.0);
}

// Five samples along the normal: how much nearby surface crowds the point.
float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0, w = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.02 + 0.07 * float(i);
    occ += (h - sceneD(p + n * h)) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
}

void main() {
  vec3 rd = normalize(uCamRot * vec3(vNdc.x / uProj[0][0], vNdc.y / uProj[1][1], -1.0));
  vec3 ro = uCamPos;
  float R = 1.3 * uScale;

  float tHit = -1.0;
  vec2 tb = bound(ro, rd, R);
  if (tb.x < tb.y && tb.y > 0.0) {
    float t = max(tb.x, 0.0);
    for (int i = 0; i < 512; i++) {
      if (i >= uSteps) break;
      float d = sceneD(ro + rd * t);
      if (d < 0.0004 * t) { tHit = t; break; }
      t += d * 0.8;                       // under-step: blended and implicit fields are not exact distances
      if (t > tb.y) break;
    }
  }
  float tg = rd.y < 0.0 ? (uGroundY - ro.y) / rd.y : -1.0;

  vec3 col;
  if (tHit > 0.0 && (tg < 0.0 || tHit < tg)) {
    vec3 p = ro + rd * tHit, n = sceneN(p);
    float sh = softShadow(p + n * 0.004, uKeyDir, R);
    col = envShade(n, rd, sh) * mix(1.0, ambientOcclusion(p, n), 0.7);
  } else if (uGround == 1 && tg > 0.0) {
    vec3 p = ro + rd * tg;
    float sh = uKeyDir.y > 0.0 ? softShadow(p + vec3(0.0, 0.002, 0.0), uKeyDir, R) : 1.0;
    vec3 sky = envSample(vec3(0.0, 1.0, 0.0), 0.0);
    vec3 g = 0.3 * (sky * mix(1.0, sh, uOcclusion) + max(uKeyDir.y, 0.0) * sh * uSunCol);
    col = mix(g, envBackground(rd), smoothstep(uGroundHalf * 0.35, uGroundHalf, length(p.xz)));
  } else {
    col = envBackground(rd);
  }
  fragColor = vec4(envOutput(col), 1.0);
}`;

const FULLSCREEN_VS = /* glsl */`
out vec2 vNdc;
void main() {
  vNdc = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  gl_Position = vec4(vNdc, 0.0, 1.0);
}`;

export function mountShapeMarch({ title, recordName, defaults }) {
  const canvas = document.getElementById('canvas');
  const gl = createGL(canvas);
  const timer = new GpuTimer(gl);
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');
  let shell;
  const camera = new OrbitCamera(canvas, { yaw: CAM_YAW, pitch: 0.1, dist: 4.8, onChange: () => shell.loop.redraw() });
  const vao = gl.createVertexArray();
  const drawQuad = () => { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null); };

  let marchProg = null, insetProg = null, environment = null;
  if (floatOK) {
    const head = shaderHead([], ENV_SHADING + SHAPES_GLSL);
    marchProg = new Program(gl, head + FULLSCREEN_VS, head + MARCH_FS);
    const s = envInsetShaders(head);
    insetProg = new Program(gl, s.vs, s.fs);
    environment = new Environment(gl, drawQuad);
  }

  const caption = document.createElement('div');
  caption.className = 'inset-caption';
  caption.textContent = 'Environment map (equirectangular)';

  function render(t) {
    if (!floatOK) return;
    const p = shell.params.values;
    const time = t * p.speed;
    const m = morphState(p, time);
    const f = environment.frame(p, t);
    camera.yawOffset = p.orbit > 0 ? 2 * Math.PI * t / p.orbit : 0;
    const { rot, proj, eye } = camera.matrices(canvas.width / canvas.height);
    const U = {
      ...f.uniforms,
      uCamRot: rot, uProj: proj, uCamPos: eye, uKeyDir: new Float32Array(f.sunWorld),
      uShapeA: m.a, uShapeB: m.b, uMix: m.mix, uShapeTime: time,
      uScale: p.scale, uSpin: time * p.spin * Math.PI / 180, uTilt: p.tilt * Math.PI / 180,
      uSteps: p.steps, uSoft: p.soft, uGround: p.ground ? 1 : 0, uGroundY: -1.25, uGroundHalf: 4.0,
    };

    timer.poll();
    timer.begin();
    environment.bind(f, p, t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    marchProg.use().setAll(U);
    drawQuad();
    if (p.inset) {
      const h = Math.round(canvas.height * 0.2), mg = Math.round(canvas.height * 0.03);
      gl.viewport(canvas.width - 2 * h - mg, mg, 2 * h, h);
      insetProg.use().setAll(U);
      drawQuad();
    }
    timer.end();

    caption.style.display = p.inset ? '' : 'none';
    caption.style.bottom = `${Math.round(canvas.clientHeight * 0.23) + 6}px`;
    const gpu = timer.available ? (timer.ms === null ? 'GPU — ms' : `GPU ${timer.ms.toFixed(2)} ms`) : 'GPU timer not exposed by this browser';
    shell.setStats(`Ray-marched SDF · ${m.label}`, `${gpu} · up to ${p.steps} steps per pixel · ${canvas.width}×${canvas.height}`);
  }

  shell = mountShell({
    title, recordName, render,
    panel: [
      { type: 'group', label: 'Lighting', open: false },
      ...envSpecs(ALL_ENVS, defaults),
      { type: 'group', label: 'Shapes' },
      speedSpec(),
      ...shapeSpecs(),
      { type: 'group', label: 'Rendering', open: false },
      { id: 'steps', label: 'March steps', type: 'range', min: 32, max: 512, step: 16, value: 160, format: v => String(v) },
      range('soft', 'Shadow sharpness', 2, 64, 1, 12, 0),
      { id: 'ground', label: 'Ground', type: 'toggle', value: true },
      { id: 'inset', label: 'Show env map', type: 'toggle', value: false },
    ],
  });
  shell.overlay.appendChild(caption);
  if (!floatOK) shell.message('This demo needs EXT_color_buffer_float to render the environment map into a float texture, and this browser does not expose it.');
  render(0);
  return shell;
}
