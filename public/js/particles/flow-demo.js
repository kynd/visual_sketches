// Shared frame for the noise-flow demos: a position pass writes every
// particle's centre and radius into a float texture, then the shadow-mapped
// sphere renderer from the particle-rendering page draws them twice (light
// depth, camera) reading positions from that texture.

import { createGL, OrbitCamera, GpuTimer, Program } from './gl.js';
import { ParticleScene, METHOD_LABEL } from './scene.js';
import { flowShaders } from './flow-glsl.js';
import { mountShell, formatCount } from '../demo-shell.js';

export const POS_W = 1024;   // position texture width; height grows with the count

export const methodSpec = () => ({
  id: 'method', label: 'Method', type: 'select', value: 'points',
  options: [['points', METHOD_LABEL.points], ['billboard', METHOD_LABEL.billboard]],
});
export const countSpec = (value, max = 21) => ({
  id: 'count', label: 'Count', type: 'range', min: 12, max, step: 0.5, value,
  format: v => formatCount(Math.round(2 ** v)),
});
export const radiusSpec = value => ({
  id: 'radius', label: 'Radius', type: 'range', min: 0.002, max: 0.04, step: 0.001, value, format: v => v.toFixed(3),
});
export const speedSpec = () => ({
  id: 'speed', label: 'Speed', type: 'range', min: 0, max: 3, step: 0.05, value: 1, format: v => v.toFixed(2),
});
export const range = (id, label, min, max, step, value, digits = 2) => ({
  id, label, type: 'range', min, max, step, value, format: v => v.toFixed(digits),
});
export const shadowSpecs = () => [
  { id: 'res', label: 'Map size', type: 'select', value: '2048',
    options: [['512', '512²'], ['1024', '1024²'], ['2048', '2048²'], ['4096', '4096²']] },
  { id: 'pcf', label: 'Filter', type: 'select', value: '1',
    options: [['0', '1 tap'], ['1', '3×3 taps'], ['2', '5×5 taps']] },
  { id: 'ground', label: 'Ground', type: 'toggle', value: true },
  { id: 'inset', label: 'Show map', type: 'toggle', value: false },
];

// Position texture: one RGBA32F texel per particle (+1 for an optional core).
// Returns get(n) → { tex, fbo, h }, reallocating only when the height changes.
export function positionTargets(gl, { normals = false } = {}) {
  let pos = null;
  return n => {
    const h = Math.max(1, Math.ceil((n + 1) / POS_W));
    if (pos && pos.h === h) return pos;
    if (pos) { gl.deleteTexture(pos.tex); if (pos.nrm) gl.deleteTexture(pos.nrm); gl.deleteFramebuffer(pos.fbo); }
    const target = format => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, POS_W, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return tex;
    };
    const tex = target(gl.RGBA32F);
    const nrm = normals ? target(gl.RGBA16F) : null;   // optional second output: per-particle surface normal
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (nrm) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nrm, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    pos = { tex, nrm, fbo, h };
    return pos;
  };
}

// Depth-only shadow map with hardware comparison (as in the shadow-map demo).
// Returns get(res) → { tex, fbo, res }.
export function shadowTargets(gl) {
  let shadow = null;
  return res => {
    if (shadow && shadow.res === res) return shadow;
    if (shadow) { gl.deleteTexture(shadow.tex); gl.deleteFramebuffer(shadow.fbo); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, res, res);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadow = { tex, fbo, res };
    return shadow;
  };
}

// layout(values) → { n, maxRadius, uniforms, info }
//   n          particle count
//   maxRadius  largest sphere radius (sets the shadow bias)
//   uniforms   position-pass uniforms for this mode
//   info       mode-specific text for the stats line
export function mountFlowDemo({ title, recordName, mode, panel, layout, findMax = { id: 'count' } }) {
  const canvas = document.getElementById('canvas');
  const gl = createGL(canvas);
  const scene = new ParticleScene(gl);
  const flowTimer = new GpuTimer(gl);
  const drawTimer = new GpuTimer(gl);
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');
  let shell;
  const camera = new OrbitCamera(canvas, { onChange: () => shell.loop.redraw() });
  const src = flowShaders(mode);
  const flowProg = floatOK ? new Program(gl, src.vs, src.fs) : null;

  const posTarget = positionTargets(gl);
  const shadowTarget = shadowTargets(gl);

  const caption = document.createElement('div');
  caption.className = 'inset-caption';
  caption.textContent = 'Shadow map (light view)';

  // The core is one large sphere stored in texel n. It is drawn as an instanced
  // quad, since a sprite that size would exceed the hardware point-size limit.
  function drawCore(defines, U, n) {
    scene.program(['METHOD_BILLBOARD', 'POS_TEXTURE', ...defines]).use().setAll(U).set('uIdOffset', n);
    scene.draw('billboard', 1);
  }

  const ms = timer => (timer.ms === null ? '—' : timer.ms.toFixed(2));

  function render(t) {
    if (!floatOK) return;
    const p = shell.params.values;
    const lay = layout(p);
    const n = lay.n;
    const res = parseInt(p.res, 10);
    const sm = shadowTarget(res);
    const pt = posTarget(n);
    const L = scene.light;
    const time = t * p.speed;
    const U = scene.uniforms({ ...p, count: Math.log2(n), formation: '0' }, t, camera, canvas);
    Object.assign(U, {
      uTime: time,
      uCount: n,
      uPosTex: 1, uPosW: POS_W,
      uLightRes: res,
      uShadowMap: 0,
      uPcf: parseInt(p.pcf, 10),
      uShadowBias: (lay.maxRadius * 0.6 + 0.004) / (L.far - L.near),
    });

    // Pass 1 — positions: one fragment per particle.
    flowTimer.poll();
    flowTimer.begin();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pt.fbo);
    gl.viewport(0, 0, POS_W, pt.h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const coreR = lay.coreR || 0;
    flowProg.use().setAll({ uTime: time, uCount: n, uPosW: POS_W, uCoreR: coreR, ...lay.uniforms });
    scene.drawQuad();
    flowTimer.end();

    drawTimer.poll();
    drawTimer.begin();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, pt.tex);

    // Pass 2 — light view, depth only.
    gl.bindFramebuffer(gl.FRAMEBUFFER, sm.fbo);
    gl.viewport(0, 0, res, res);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    scene.program(['METHOD_POINTS', 'PASS_SHADOW_DEPTH', 'POS_TEXTURE']).use().setAll(U).set('uIdOffset', 0);
    scene.draw('points', n);
    if (coreR > 0) drawCore(['PASS_SHADOW_DEPTH'], U, n);

    // Pass 3 — camera view: ground, then spheres, both reading the shadow map per pixel.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sm.tex);
    if (p.ground) {
      scene.program(['SHADOW_MAP_PIXEL'], 'ground').use().setAll(U);
      scene.drawQuad();
    }
    scene.program([scene.methodDefine(p.method), 'PASS_CAMERA', 'SHADOW_MAP_PIXEL', 'POS_TEXTURE']).use().setAll(U).set('uIdOffset', 0);
    scene.draw(p.method, n);
    if (coreR > 0) drawCore(['PASS_CAMERA', 'SHADOW_MAP_PIXEL', 'EXACT_DEPTH', 'ALBEDO 0.16'], U, n);

    if (p.inset) {
      const [x, y, w, h] = scene.insetViewport(canvas);
      gl.viewport(x, y, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      scene.program([], 'inset-depth').use().set('uTex', 0);
      scene.drawQuad();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.enable(gl.DEPTH_TEST);
    }
    drawTimer.end();

    caption.style.display = p.inset ? '' : 'none';
    caption.style.bottom = `${Math.round(canvas.clientHeight * 0.29) + 6}px`;
    const gpu = flowTimer.available
      ? `GPU: flow ${ms(flowTimer)} ms + shading ${ms(drawTimer)} ms`
      : 'GPU timer not exposed by this browser';
    shell.setStats(`${METHOD_LABEL[p.method]} · ${n.toLocaleString()} spheres · ${lay.info}`, `${gpu} · shadow map ${res}²`);
  }

  shell = mountShell({ title, recordName, render, findMax, panel });
  shell.overlay.appendChild(caption);
  if (!floatOK) shell.message('This demo needs EXT_color_buffer_float to write particle positions into a float texture, and this browser does not expose it.');
  render(0);
  return shell;
}
