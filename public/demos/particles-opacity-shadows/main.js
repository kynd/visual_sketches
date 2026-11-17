// Opacity shadow maps: particles splat their coverage into 16 depth slices
// seen from the light (additive blending, low resolution), and each particle
// reads its transmittance once, in the vertex shader.
import { createGL, OrbitCamera, GpuTimer } from '../../js/particles/gl.js';
import { ParticleScene, commonSpecs, METHOD_LABEL, gpuLine } from '../../js/particles/scene.js';
import { mountShell } from '../../js/demo-shell.js';

const canvas = document.getElementById('canvas');
const gl = createGL(canvas);
const scene = new ParticleScene(gl);
const timer = new GpuTimer(gl);
const floatOK = !!gl.getExtension('EXT_color_buffer_float');
// 32-bit slices need float blending and float filtering; otherwise fall back to half floats.
const full32 = floatOK && !!gl.getExtension('EXT_float_blend') && !!gl.getExtension('OES_texture_float_linear');
const SLICE_FORMAT = full32 ? gl.RGBA32F : gl.RGBA16F;
let shell;
const camera = new OrbitCamera(canvas, { onChange: () => shell.loop.redraw() });

const SLICES = 16;
let opa = null;
function opacityTarget(res) {
  if (opa && opa.res === res) return opa;
  if (opa) { opa.texs.forEach(t => gl.deleteTexture(t)); gl.deleteFramebuffer(opa.fbo); }
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const texs = [];
  for (let i = 0; i < SLICES / 4; i++) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, SLICE_FORMAT, res, res);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
    texs.push(tex);
  }
  gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  opa = { fbo, texs, res };
  return opa;
}

const caption = document.createElement('div');
caption.className = 'inset-caption';
caption.textContent = 'Total coverage (light view)';

function render(t) {
  const p = shell.params.values;
  if (!floatOK) return;
  const n = scene.count(p);
  const res = parseInt(p.res, 10);
  const om = opacityTarget(res);
  const L = scene.light;
  const U = scene.uniforms(p, t, camera, canvas);
  Object.assign(U, {
    uLightRes: res,
    uOpa0: 0, uOpa1: 1, uOpa2: 2, uOpa3: 3,
    uOpaNear: L.dist - L.half,
    uOpaStep: (2 * L.half) / SLICES,
    uOpaK: p.density,
  });

  timer.poll();
  timer.begin();

  // Pass 1 — splat coverage into the slices (no depth test, additive).
  gl.bindFramebuffer(gl.FRAMEBUFFER, om.fbo);
  gl.viewport(0, 0, res, res);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  scene.program(['METHOD_POINTS', 'PASS_OPACITY']).use().setAll(U);
  scene.draw('points', n);
  gl.disable(gl.BLEND);

  // Pass 2 — camera view.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  om.texs.forEach((tex, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); });
  if (p.ground) {
    scene.program(['OPACITY_SHADOW'], 'ground').use().setAll(U);
    scene.drawQuad();
  }
  scene.program([scene.methodDefine(p.method), 'PASS_CAMERA', 'OPACITY_SHADOW']).use().setAll(U);
  scene.draw(p.method, n);

  if (p.inset) {
    const [x, y, w, h] = scene.insetViewport(canvas);
    gl.viewport(x, y, w, h);
    gl.disable(gl.DEPTH_TEST);
    scene.program([], 'inset-opacity').use().set('uTex', 3).set('uOpaK', p.density);
    scene.drawQuad();
    gl.enable(gl.DEPTH_TEST);
  }
  gl.activeTexture(gl.TEXTURE0);
  timer.end();

  caption.style.display = p.inset ? '' : 'none';
  caption.style.bottom = `${Math.round(canvas.clientHeight * 0.29) + 6}px`;
  shell.setStats(
    `${METHOD_LABEL[p.method]} · ${n.toLocaleString()} particles`,
    `${gpuLine(timer)} · 2 passes · ${SLICES} slices at ${res}² (${full32 ? '32' : '16'}-bit) · per-particle lookup`,
  );
}

shell = mountShell({
  title: 'Opacity shadow maps',
  recordName: 'particles-opacity-shadows',
  render,
  findMax: { id: 'count' },
  panel: [
    ...commonSpecs({ methods: ['points', 'billboard'], count: 19, radius: 0.006 }),
    { id: 'res', label: 'Map size', type: 'select', value: '256',
      options: [['64', '64²'], ['128', '128²'], ['256', '256²'], ['512', '512²']] },
    { id: 'density', label: 'Density', type: 'range', min: 0, max: 4, step: 0.05, value: 1.2, format: v => v.toFixed(2) },
    { id: 'ground', label: 'Ground', type: 'toggle', value: true },
    { id: 'inset', label: 'Show map', type: 'toggle', value: false },
  ],
});
shell.overlay.appendChild(caption);
if (!floatOK) shell.message('This demo needs EXT_color_buffer_float to render into half-float targets, and this browser does not expose it.');

render(0);
