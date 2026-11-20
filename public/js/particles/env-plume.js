// Particles lit by an environment map. Each frame:
//   0. environment pass — env-common.js (only when the map changes or is animated)
//   1. position pass   — a kernel from flow-glsl.js (the plume, shape morphing…)
//   2. light pass      — shadow depth from the environment's sun
//   3. camera pass     — background, ground, spheres shaded from the map
//
// mountEnvParticles() takes the kernel as configuration; mountEnvPlume() is
// the curl-noise plume used on the Environment maps page.

import { createGL, OrbitCamera, GpuTimer, Program } from './gl.js';
import { ParticleScene, METHOD_LABEL } from './scene.js';
import { particleShaders, shaderHead } from './glsl.js';
import { flowShaders } from './flow-glsl.js';
import { ENV_SHADING, backgroundShaders, envGroundShaders, envInsetShaders } from './env-glsl.js';
import { CAM_YAW, Environment, envSpecs, bgSpec } from './env-common.js';
import { POS_W, positionTargets, shadowTargets, methodSpec, countSpec, radiusSpec, speedSpec, range } from './flow-demo.js';
import { mountShell } from '../demo-shell.js';

// World-space points the light frustum must cover: the floor and the particles' volume.
const BOUNDS = [];
for (const x of [-4, 4]) for (const z of [-4, 4]) BOUNDS.push([x, -1.25, z]);
for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6]) BOUNDS.push([x, 2.6, z]);

// kernel: {
//   mode      — flow-glsl.js mode name
//   specs     — extra panel controls (after Method / Count / Radius / Speed)
//   count, radius — defaults for those controls
//   uniforms(p, time) → position-pass uniforms (time = t × Speed)
//   info(p, time)     → text for the stats line
//   group             — panel group label for the kernel's controls
//   bounds            — world points the shadow frustum must cover (default: floor + plume volume)
//   ground(p, ctx)    → false to hide the floor (ctx: { aspect, camRot })
//   uniforms and info also receive ctx as their third argument
// }
// closed: panel groups that start collapsed ('Lighting', 'Particles', 'Shadows', or kernel.group).
export function mountEnvParticles({ title, recordName, envs, defaults, kernel, closed = [] }) {
  const canvas = document.getElementById('canvas');
  const gl = createGL(canvas, { alpha: true });
  const scene = new ParticleScene(gl);
  const flowTimer = new GpuTimer(gl);
  const drawTimer = new GpuTimer(gl);
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');
  let shell;
  const camera = new OrbitCamera(canvas, { yaw: CAM_YAW, pitch: 0.1, dist: 4.8, onChange: () => shell.loop.redraw() });

  const posTarget = positionTargets(gl);
  const shadowTarget = shadowTargets(gl);
  let flowProg = null, bgProg = null, groundProg = null, insetProg = null, environment = null;
  const particleProgs = new Map();
  if (floatOK) {
    let s = flowShaders(kernel.mode);  flowProg = new Program(gl, s.vs, s.fs);
    const head = shaderHead([], ENV_SHADING);
    s = backgroundShaders(head);       bgProg = new Program(gl, s.vs, s.fs);
    s = envGroundShaders(head);        groundProg = new Program(gl, s.vs, s.fs);
    s = envInsetShaders(head);         insetProg = new Program(gl, s.vs, s.fs);
    environment = new Environment(gl, () => scene.drawQuad());
  }
  function particleProg(method) {
    if (!particleProgs.has(method)) {
      const s = particleShaders([scene.methodDefine(method), 'PASS_CAMERA', 'SHADOW_MAP_PIXEL', 'POS_TEXTURE', 'ENV_LIGHTING'], ENV_SHADING);
      particleProgs.set(method, new Program(gl, s.vs, s.fs));
    }
    return particleProgs.get(method);
  }

  const ms = timer => (timer.ms === null ? '—' : timer.ms.toFixed(2));

  function render(t) {
    if (!floatOK) return;
    const p = shell.params.values;
    const n = Math.round(2 ** p.count);
    const res = parseInt(p.res, 10);
    const sm = shadowTarget(res);
    const pt = posTarget(n);
    const time = t * p.speed;

    const f = environment.frame(p, t);
    scene.setLight(f.sunWorld, kernel.bounds || BOUNDS);
    const L = scene.light;

    // Camera orbit about the vertical axis: one full turn every p.orbit seconds (0 = off).
    camera.yawOffset = p.orbit > 0 ? 2 * Math.PI * t / p.orbit : 0;
    const U = scene.uniforms({ ...p, formation: '0' }, t, camera, canvas);
    Object.assign(U, f.uniforms, {
      uTime: time, uCount: n,
      uPosTex: 1, uPosW: POS_W, uIdOffset: 0,
      uShadowMap: 0, uLightRes: res, uPcf: parseInt(p.pcf, 10),
      uShadowBias: (p.radius * 0.6 + 0.004 + 3 * L.half / res) / (L.far - L.near),
    });
    const ctx = { aspect: canvas.width / canvas.height, camRot: U.uCamRot };
    const showGround = p.ground && (!kernel.ground || kernel.ground(p, ctx) !== false);

    flowTimer.poll();
    flowTimer.begin();
    environment.bind(f, p, t);                         // pass 0

    // Pass 1 — particle positions.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pt.fbo);
    gl.viewport(0, 0, POS_W, pt.h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    flowProg.use().setAll({ uTime: time, uCount: n, uPosW: POS_W, uCoreR: 0, uSize: p.radius, ...kernel.uniforms(p, time, ctx) });
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
    gl.clearColor(0, 0, 0, p.bg ? 1 : 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sm.tex);
    if (p.bg) {
      gl.disable(gl.DEPTH_TEST);
      bgProg.use().setAll(U);
      scene.drawQuad();
    }
    gl.enable(gl.DEPTH_TEST);
    if (showGround) {
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
    const gpu = flowTimer.available ? `GPU: env + positions ${ms(flowTimer)} ms + shading ${ms(drawTimer)} ms` : 'GPU timer not exposed by this browser';
    const info = kernel.info ? kernel.info(p, time, ctx) : f.E.label;
    shell.setStats(`${METHOD_LABEL[p.method]} · ${n.toLocaleString()} spheres · ${info}`, `${gpu} · shadow map ${res}²`);
  }

  const caption = document.createElement('div');
  caption.className = 'inset-caption';
  caption.textContent = 'Environment map (equirectangular)';

  shell = mountShell({
    title, recordName, render, findMax: { id: 'count' },
    panel: [
      bgSpec(),
      { type: 'group', label: 'Lighting', open: !closed.includes('Lighting') },
      ...envSpecs(envs, defaults),
      { type: 'group', label: 'Particles', open: !closed.includes('Particles') },
      methodSpec(),
      countSpec(kernel.count ?? 16),
      radiusSpec(kernel.radius ?? 0.012),
      speedSpec(),
      ...(kernel.group ? [{ type: 'group', label: kernel.group, open: !closed.includes(kernel.group) }] : []),
      ...kernel.specs,
      { type: 'group', label: 'Shadows', open: !closed.includes('Shadows') },
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

// The curl-noise plume (Environment maps page).
export function mountEnvPlume({ title, recordName, envs, defaults }) {
  return mountEnvParticles({
    title, recordName, envs, defaults,
    kernel: {
      mode: 'plume', group: 'Plume',
      count: 16, radius: 0.012,
      specs: [
        range('flow', 'Turbulence', 0, 1.5, 0.01, 0.3),
        range('rise', 'Rise speed', 0, 1, 0.01, 0.36),
        range('evolve', 'Field evolution', 0, 2, 0.01, 0.12),
        range('life', 'Lifetime (s)', 1, 10, 0.1, 4.5, 1),
      ],
      uniforms: p => ({
        uFlow: p.flow, uRise: p.rise, uFreq: 1.0, uEvolve: p.evolve,
        uLife: p.life, uSteps: 24, uEmitR: 0.3, uContain: 0.25,
      }),
    },
  });
}
