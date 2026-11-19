// Ray-marched shape morph: one full-screen pass marches the blend of two
// signed distance fields, mix(dA, dB, s), and shades the hit with the
// environment-map lighting from env-glsl.js. Shadows are soft shadow rays
// through the same field instead of a shadow map.

import { createGL, OrbitCamera, GpuTimer, Program } from './gl.js';
import { shaderHead, KEY_LIGHT } from './glsl.js';
import { ENV_SHADING, envInsetShaders } from './env-glsl.js';
import { SHAPES_GLSL } from './shapes-glsl.js';
import { CAM_YAW, Environment, envSpecs, bgSpec, ALL_ENVS } from './env-common.js';
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
// Rendering methods carried over from geom
uniform int   uMethod;      // 0 environment map, 1 studio, 2 rim light + SSS, 3 flash light
uniform vec3  uStudioKey;   // geom's key light direction
uniform float uRimPow;      // rim exponent p
uniform float uRimBase;     // face-on fill
uniform float uSssStr;      // subsurface glow strength
uniform float uSssDensity;  // how fast the glow falls off with thickness
uniform float uFlashRate;   // flashes per second (stands in for geom's audio)
uniform float uClock;       // seconds, for the flash lights
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

// Thickness along the view ray: march through the interior to the back face
// (geom lighting-rendering). Thin parts give short distances and glow.
float thickness(vec3 ro, vec3 rd, float t) {
  float tb = t + 0.005;
  for (int i = 0; i < 48; i++) {
    float d = sceneD(ro + rd * tb);
    if (d > 0.0) break;
    tb += max(-d, 0.005);
  }
  return tb - t;
}

// geom lighting.glsl: key + fill, Blinn-Phong, Fresnel rim; sh shadows the key.
vec3 studioLight(vec3 n, vec3 rd, float sh) {
  vec3 lk = uStudioKey;
  float dk = max(dot(n, lk), 0.0) * sh;
  float df = max(dot(n, normalize(vec3(-0.8, 0.3, 0.5))), 0.0) * 0.28;
  vec3 col = vec3(0.88) * (0.13 + dk * 0.84 + df);
  col += vec3(0.40) * pow(max(dot(n, normalize(lk - rd)), 0.0), 72.0) * sh;
  col += vec3(0.12, 0.18, 0.38) * pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * 0.6;
  return col;
}

// geom rim-lighting.glsl: bright silhouette, dark face-on, thin parts glow.
vec3 rimLight(vec3 n, vec3 rd, float thick) {
  float ndv = abs(dot(n, -rd));
  float rim = pow(1.0 - ndv, uRimPow);
  float sss = exp(-thick * uSssDensity);
  return vec3(ndv * ndv * uRimBase) + vec3(0.92, 0.96, 1.00) * (rim + sss * uSssStr);
}

// geom flash-light: two lights orbiting at different speeds. geom drives them
// with the audio's left/right levels; here each fires a decaying flash on a
// clock, the second one slower and offset so they rarely coincide.
float flash(float t, float rate, float phase) { return exp(-6.0 * fract(t * rate + phase)); }
vec3 flashLight(vec3 n, vec3 rd) {
  vec3 mat = vec3(0.88);
  float a1 = uClock * 3.5, a2 = uClock * 2.1 + 1.9;
  vec3 l1 = normalize(vec3(sin(a1), 0.35, cos(a1))), l2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  vec3 c1 = mat * max(dot(n, l1), 0.0) * 0.85 + vec3(0.45) * pow(max(dot(n, normalize(l1 - rd)), 0.0), 56.0) * 0.45;
  vec3 c2 = mat * max(dot(n, l2), 0.0) * 0.85 + vec3(0.45) * pow(max(dot(n, normalize(l2 - rd)), 0.0), 56.0) * 0.45;
  float f1 = flash(uClock, uFlashRate, 0.0), f2 = flash(uClock, uFlashRate * 0.618, 0.37);
  return c1 * max(f1 * f1, 0.015) + c2 * f2 * f2;      // light 1 never fully dark, as in geom
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

  // The environment method lights with the map's sun; geom's studio look with
  // its own key light. Rim and flash lighting cast no directional shadow.
  vec3 key = uMethod == 1 ? uStudioKey : uKeyDir;
  bool shadows = uMethod <= 1;
  vec3 bg = envOutput(envBackground(rd));               // display space
  float bgA = uBgMode == 3 ? 0.0 : 1.0;                 // no background: transparent

  if (tHit > 0.0 && (tg < 0.0 || tHit < tg)) {
    vec3 p = ro + rd * tHit, n = sceneN(p);
    float sh = shadows ? softShadow(p + n * 0.004, key, R) : 1.0;
    float occ = mix(1.0, ambientOcclusion(p, n), 0.7);
    float thick = (uMethod == 2 || uSssStr > 0.0) ? thickness(ro, rd, tHit) : 100.0;
    float sss = exp(-thick * uSssDensity) * uSssStr;
    vec3 col;
    if (uMethod == 0) {
      // geom env-map: the glow takes the map's colour along the normal.
      col = envOutput(envShade(n, rd, sh) * occ + envSample(n, uBlur) * sss);
    } else {
      vec3 lin = uMethod == 1 ? studioLight(n, rd, sh) * occ + vec3(0.88) * sss
               : uMethod == 2 ? rimLight(n, rd, thick)
               :                flashLight(n, rd) + vec3(0.88) * sss;
      col = pow(max(lin, 0.0), vec3(0.4545));
    }
    fragColor = vec4(col, 1.0);
  } else if (uGround == 1 && tg > 0.0) {
    vec3 p = ro + rd * tg;
    float sh = shadows && key.y > 0.0 ? softShadow(p + vec3(0.0, 0.002, 0.0), key, R) : 1.0;
    vec3 g;
    if (uMethod == 0) {
      vec3 sky = envSample(vec3(0.0, 1.0, 0.0), 0.0);
      g = envOutput(0.3 * (sky * mix(1.0, sh, uOcclusion) + max(key.y, 0.0) * sh * uSunCol));
    } else {
      // geom's studio floor; rim and flash scenes get the floor's ambient only.
      float lit = uMethod == 1 ? max(key.y, 0.0) * sh * 0.84 : 0.0;
      g = pow(vec3(0.55) * (0.10 + lit), vec3(0.4545));
    }
    float fade = smoothstep(uGroundHalf * 0.35, uGroundHalf, length(p.xz));
    float a = mix(1.0, bgA, fade);
    fragColor = vec4(mix(g, bg * bgA, fade), a);         // premultiplied
  } else {
    fragColor = vec4(bg * bgA, bgA);
  }
}`;

const FULLSCREEN_VS = /* glsl */`
out vec2 vNdc;
void main() {
  vNdc = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  gl_Position = vec4(vNdc, 0.0, 1.0);
}`;

export function mountShapeMarch({ title, recordName, defaults }) {
  const canvas = document.getElementById('canvas');
  const gl = createGL(canvas, { alpha: true });
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
      uMethod: parseInt(p.method, 10), uStudioKey: new Float32Array(KEY_LIGHT),
      uRimPow: p.rimPow, uRimBase: p.rimBase, uSssStr: p.sssStr, uSssDensity: p.sssDensity,
      uFlashRate: p.flashRate, uClock: time,
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
    const methodName = ['Environment map', 'Studio', 'Rim light + SSS', 'Flash light'][parseInt(p.method, 10)];
    shell.setStats(`Ray-marched SDF · ${methodName} · ${m.label}`, `${gpu} · up to ${p.steps} steps per pixel · ${canvas.width}×${canvas.height}`);
  }

  shell = mountShell({
    title, recordName, render,
    panel: [
      bgSpec(),
      { id: 'method', label: 'Rendering', type: 'select', value: '0',
        options: [['0', 'Environment map'], ['1', 'Studio'], ['2', 'Rim light + SSS'], ['3', 'Flash light']] },
      { type: 'group', label: 'Lighting', open: false },
      ...envSpecs(ALL_ENVS, defaults),
      { type: 'group', label: 'Shapes' },
      speedSpec(),
      ...shapeSpecs(),
      { type: 'group', label: 'Rendering', open: false },
      { ...range('rimPow', 'Rim exponent', 1, 6, 0.1, 3, 1), visible: v => v.method === '2' },
      { ...range('rimBase', 'Face-on fill', 0, 0.3, 0.005, 0, 3), visible: v => v.method === '2' },
      range('sssStr', 'SSS strength', 0, 1.5, 0.01, 0.3),
      range('sssDensity', 'SSS density', 0.5, 8, 0.1, 2.5, 1),
      { ...range('flashRate', 'Flash rate (/s)', 0.1, 4, 0.05, 0.8), visible: v => v.method === '3' },
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
