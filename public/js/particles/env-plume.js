// The curl-noise plume lit by an environment map. Each frame:
//   0. environment pass — one environment rendered into an equirectangular
//      RGBA16F texture with mipmaps (only when it changes or is animated)
//   1. position pass   — the plume kernel from flow-glsl.js
//   2. light pass      — shadow depth from the environment's sun
//   3. camera pass     — background, ground, spheres shaded from the map

import { createGL, OrbitCamera, GpuTimer, Program } from './gl.js';
import { ParticleScene, METHOD_LABEL } from './scene.js';
import { particleShaders, shaderHead, KEY_LIGHT } from './glsl.js';
import { flowShaders } from './flow-glsl.js';
import { ENV_LIST, ENV_SHADING, envMapShaders, backgroundShaders, envGroundShaders, envInsetShaders } from './env-glsl.js';
import { POS_W, positionTargets, shadowTargets, methodSpec, countSpec, radiusSpec, speedSpec, range } from './flow-demo.js';
import { mountShell } from '../demo-shell.js';

const ENV_W = 2048, ENV_H = 1024, ENV_LEVELS = 12;
const CAM_YAW = 2.3;

// Direction toward a light at 'offset' degrees of azimuth from the default
// camera's view direction and 'elev' degrees above the horizon.
function fromView(offset, elev) {
  const az = CAM_YAW + offset * Math.PI / 180, el = elev * Math.PI / 180;
  return [-Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
}

// The shadow-casting light that belongs to each environment (environment frame).
const SUN = {
  studio:     { dir: KEY_LIGHT,           col: [1.0, 1.0, 1.0],    gain: 1.0 },
  oklch:      { dir: KEY_LIGHT,           col: [1.0, 1.0, 1.0],    gain: 1.0 },
  lab:        { dir: KEY_LIGHT,           col: [1.0, 1.0, 1.0],    gain: 1.0 },
  wave:       { dir: KEY_LIGHT,           col: [1.0, 1.0, 1.0],    gain: 1.0 },
  caustic:    { dir: KEY_LIGHT,           col: [1.0, 1.0, 1.0],    gain: 1.0 },
  clear:      { dir: fromView(140, 50),   col: [1.0, 0.93, 0.82],  gain: 1.5 },
  sunset:     { dir: fromView(18, 6),     col: [1.0, 0.50, 0.22],  gain: 2.2 },
  cloudy:     { dir: fromView(-120, 38),  col: [1.0, 0.95, 0.88],  gain: 1.1 },
  overcast:   { dir: fromView(60, 55),    col: [0.9, 0.93, 1.0],   gain: 0.2 },
  night:      { dir: fromView(-25, 28),   col: [0.55, 0.65, 1.0],  gain: 0.3 },
  aurora:     { dir: fromView(150, 25),   col: [0.45, 0.85, 0.65], gain: 0.18 },
  underwater: { dir: fromView(120, 72),   col: [0.55, 0.9, 1.0],   gain: 1.1 },
};

// World-space points the light frustum must cover: the floor and the plume's volume.
const BOUNDS = [];
for (const x of [-4, 4]) for (const z of [-4, 4]) BOUNDS.push([x, -1.25, z]);
for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6]) BOUNDS.push([x, 2.6, z]);

export function mountEnvPlume({ title, recordName, envs, defaults }) {
  const canvas = document.getElementById('canvas');
  const gl = createGL(canvas);
  const scene = new ParticleScene(gl);
  const flowTimer = new GpuTimer(gl);
  const drawTimer = new GpuTimer(gl);
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');
  let shell;
  const camera = new OrbitCamera(canvas, { yaw: CAM_YAW, pitch: 0.1, dist: 4.8, onChange: () => shell.loop.redraw() });

  const posTarget = positionTargets(gl);
  const shadowTarget = shadowTargets(gl);
  let flowProg = null, envProg = null, bgProg = null, groundProg = null, insetProg = null;
  const particleProgs = new Map();
  if (floatOK) {
    let s = flowShaders('plume');      flowProg = new Program(gl, s.vs, s.fs);
    s = envMapShaders();               envProg = new Program(gl, s.vs, s.fs);
    const head = shaderHead([], ENV_SHADING);
    s = backgroundShaders(head);       bgProg = new Program(gl, s.vs, s.fs);
    s = envGroundShaders(head);        groundProg = new Program(gl, s.vs, s.fs);
    s = envInsetShaders(head);         insetProg = new Program(gl, s.vs, s.fs);
  }
  function particleProg(method) {
    const defs = [scene.methodDefine(method), 'PASS_CAMERA', 'SHADOW_MAP_PIXEL', 'POS_TEXTURE', 'ENV_LIGHTING'];
    if (!particleProgs.has(method)) {
      const s = particleShaders(defs, ENV_SHADING);
      particleProgs.set(method, new Program(gl, s.vs, s.fs));
    }
    return particleProgs.get(method);
  }

  // Environment target: mipmapped so blurred lookups are a single textureLod.
  let env = null, envKey = '';
  if (floatOK) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, ENV_LEVELS, gl.RGBA16F, ENV_W, ENV_H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    env = { tex, fbo };
  }

  const envById = Object.fromEntries(ENV_LIST.map(([id, key, label, animated]) => [key, { id, key, label, animated }]));
  const ms = timer => (timer.ms === null ? '—' : timer.ms.toFixed(2));

  function render(t) {
    if (!floatOK) return;
    const p = shell.params.values;
    const E = envById[p.env];
    const sun = SUN[p.env];
    const n = Math.round(2 ** p.count);
    const res = parseInt(p.res, 10);
    const sm = shadowTarget(res);
    const pt = posTarget(n);
    const time = t * p.speed;

    // The environment turns about the vertical axis; the sun turns with it.
    const rot = t * p.rotation * Math.PI / 180;
    const c = Math.cos(rot), s = Math.sin(rot);
    const [lx, ly, lz] = sun.dir;
    const sunWorld = [c * lx - s * lz, ly, s * lx + c * lz];
    scene.setLight(sunWorld, BOUNDS);
    const L = scene.light;

    const U = scene.uniforms({ ...p, formation: '0' }, t, camera, canvas);
    Object.assign(U, {
      uTime: time, uCount: n,
      uPosTex: 1, uPosW: POS_W, uIdOffset: 0,
      uShadowMap: 0, uLightRes: res, uPcf: parseInt(p.pcf, 10),
      uShadowBias: (p.radius * 0.6 + 0.004 + 3 * L.half / res) / (L.far - L.near),
      uEnvTex: 2, uEnvRot: rot, uBlur: p.blur, uOcclusion: p.occlusion, uExposure: p.exposure,
      uSunCol: new Float32Array(sun.col.map(v => v * sun.gain * p.sun)),
      uShading: parseInt(p.shading, 10), uLookup: parseInt(p.lookup, 10), uBgMode: parseInt(p.background, 10),
    });

    flowTimer.poll();
    flowTimer.begin();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // Pass 0 — environment, only when it changed (static maps render once).
    const key = `${E.key}|${p.sun}|${E.animated ? t : ''}`;
    gl.activeTexture(gl.TEXTURE2);
    if (key !== envKey) {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, env.fbo);
      gl.viewport(0, 0, ENV_W, ENV_H);
      envProg.use().setAll({ uEnv: E.id, uTime: t, uSunDir: new Float32Array(sun.dir), uSunCol: U.uSunCol });
      scene.drawQuad();
      gl.bindTexture(gl.TEXTURE_2D, env.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      envKey = key;
    }
    gl.bindTexture(gl.TEXTURE_2D, env.tex);

    // Pass 1 — plume positions.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pt.fbo);
    gl.viewport(0, 0, POS_W, pt.h);
    flowProg.use().setAll({
      uTime: time, uCount: n, uPosW: POS_W, uCoreR: 0,
      uFlow: p.flow, uRise: p.rise, uFreq: 1.0, uEvolve: p.evolve,
      uLife: p.life, uSteps: 24, uSize: p.radius, uEmitR: 0.3, uContain: 0.25,
    });
    scene.drawQuad();
    flowTimer.end();

    drawTimer.poll();
    drawTimer.begin();
    gl.bindTexture(gl.TEXTURE_2D, pt.tex);

    // Pass 2 — sun's-eye depth.
    gl.bindFramebuffer(gl.FRAMEBUFFER, sm.fbo);
    gl.viewport(0, 0, res, res);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    scene.program(['METHOD_POINTS', 'PASS_SHADOW_DEPTH', 'POS_TEXTURE']).use().setAll(U);
    scene.draw('points', n);

    // Pass 3 — camera: background, ground, spheres.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sm.tex);
    gl.disable(gl.DEPTH_TEST);
    bgProg.use().setAll(U);
    scene.drawQuad();
    gl.enable(gl.DEPTH_TEST);
    if (p.ground) {
      groundProg.use().setAll(U);
      scene.drawQuad();
    }
    particleProg(p.method).use().setAll(U);
    scene.draw(p.method, n);

    if (p.inset) {
      const h = Math.round(canvas.height * 0.2), m = Math.round(canvas.height * 0.03);
      gl.viewport(canvas.width - 2 * h - m, m, 2 * h, h);
      gl.disable(gl.DEPTH_TEST);
      insetProg.use().setAll(U);
      scene.drawQuad();
      gl.enable(gl.DEPTH_TEST);
    }
    drawTimer.end();

    caption.style.display = p.inset ? '' : 'none';
    caption.style.bottom = `${Math.round(canvas.clientHeight * 0.23) + 6}px`;
    const gpu = flowTimer.available ? `GPU: env + flow ${ms(flowTimer)} ms + shading ${ms(drawTimer)} ms` : 'GPU timer not exposed by this browser';
    shell.setStats(`${METHOD_LABEL[p.method]} · ${n.toLocaleString()} spheres · ${E.label}`, `${gpu} · shadow map ${res}²`);
  }

  const caption = document.createElement('div');
  caption.className = 'inset-caption';
  caption.textContent = 'Environment map (equirectangular)';

  const d = { shading: '0', lookup: '0', blur: 0, exposure: 1.2, background: '1', ...defaults };
  shell = mountShell({
    title, recordName, render, findMax: { id: 'count' },
    panel: [
      { id: 'env', label: 'Environment', type: 'select', value: d.env, options: envs.map(k => [k, envById[k].label]) },
      { id: 'shading', label: 'Shading', type: 'select', value: d.shading,
        options: [['0', 'Paint (map as colour)'], ['1', 'Light (map as light)'], ['2', 'Mirror']] },
      { id: 'lookup', label: 'Lookup', type: 'select', value: d.lookup, options: [['0', 'Normal'], ['1', 'Reflection']] },
      range('blur', 'Blur (mip level)', 0, 8, 0.25, d.blur),
      range('exposure', 'Exposure', 0.2, 4, 0.05, d.exposure),
      range('sun', 'Sun strength', 0, 3, 0.05, 1),
      range('occlusion', 'Occlusion', 0, 1, 0.01, 0.5),
      range('rotation', 'Rotation (°/s)', -20, 20, 0.5, 0, 1),
      { id: 'background', label: 'Background', type: 'select', value: d.background,
        options: [['0', 'Environment'], ['1', 'Dimmed'], ['2', 'Black']] },
      methodSpec(),
      countSpec(16),
      radiusSpec(0.012),
      speedSpec(),
      range('flow', 'Turbulence', 0, 1.5, 0.01, 0.3),
      range('rise', 'Rise speed', 0, 1, 0.01, 0.36),
      range('evolve', 'Field evolution', 0, 2, 0.01, 0.12),
      range('life', 'Lifetime (s)', 1, 10, 0.1, 4.5, 1),
      { id: 'res', label: 'Map size', type: 'select', value: '2048',
        options: [['1024', '1024²'], ['2048', '2048²'], ['4096', '4096²']] },
      { id: 'pcf', label: 'Filter', type: 'select', value: '1',
        options: [['0', '1 tap'], ['1', '3×3 taps'], ['2', '5×5 taps']] },
      { id: 'ground', label: 'Ground', type: 'toggle', value: true },
      { id: 'inset', label: 'Show env map', type: 'toggle', value: false },
    ],
  });
  shell.overlay.appendChild(caption);
  if (!floatOK) shell.message('This demo needs EXT_color_buffer_float to render into float textures, and this browser does not expose it.');
  render(0);
  return shell;
}
