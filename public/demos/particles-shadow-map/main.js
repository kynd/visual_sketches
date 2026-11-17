// Shadow-mapped impostor spheres: a depth pass from the key light, then a
// camera pass that compares each surface point against that depth.
import { createGL, OrbitCamera, GpuTimer } from '../../js/particles/gl.js';
import { ParticleScene, commonSpecs, METHOD_LABEL, gpuLine } from '../../js/particles/scene.js';
import { mountShell } from '../../js/demo-shell.js';

const canvas = document.getElementById('canvas');
const gl = createGL(canvas);
const scene = new ParticleScene(gl);
const timer = new GpuTimer(gl);
let shell;
const camera = new OrbitCamera(canvas, { onChange: () => shell.loop.redraw() });

// Depth-only render target with hardware depth comparison enabled.
let shadow = null;
function shadowTarget(res) {
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
}

const caption = document.createElement('div');
caption.className = 'inset-caption';
caption.textContent = 'Shadow map (light view)';

function render(t) {
  const p = shell.params.values;
  const n = scene.count(p);
  const res = parseInt(p.res, 10);
  const sm = shadowTarget(res);
  const U = scene.uniforms(p, t, camera, canvas);
  const L = scene.light;
  Object.assign(U, {
    uLightRes: res,
    uShadowMap: 0,
    uPcf: parseInt(p.pcf, 10),
    uShadowBias: (p.radius * 0.6 + 0.004) / (L.far - L.near),
  });

  timer.poll();
  timer.begin();

  // Pass 1 — light view, depth only.
  gl.bindFramebuffer(gl.FRAMEBUFFER, sm.fbo);
  gl.viewport(0, 0, res, res);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  scene.program(['METHOD_POINTS', 'PASS_SHADOW_DEPTH']).use().setAll(U);
  scene.draw('points', n);

  // Pass 2 — camera view: ground, then particles, both reading the shadow map.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sm.tex);
  const lookup = p.lookup === 'pixel' ? 'SHADOW_MAP_PIXEL' : 'SHADOW_MAP_PARTICLE';
  if (p.ground) {
    scene.program(['SHADOW_MAP_PIXEL'], 'ground').use().setAll(U);
    scene.drawQuad();
  }
  scene.program([scene.methodDefine(p.method), 'PASS_CAMERA', lookup]).use().setAll(U);
  scene.draw(p.method, n);

  // Optional inset: the raw depth map as seen from the light.
  if (p.inset) {
    const [x, y, w, h] = scene.insetViewport(canvas);
    gl.viewport(x, y, w, h);
    gl.disable(gl.DEPTH_TEST);
    // Raw depth reads need compare mode off — and NEAREST, since 24-bit depth isn't linearly filterable.
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
  timer.end();

  caption.style.display = p.inset ? '' : 'none';
  caption.style.bottom = `${Math.round(canvas.clientHeight * 0.29) + 6}px`;
  shell.setStats(
    `${METHOD_LABEL[p.method]} · ${n.toLocaleString()} particles`,
    `${gpuLine(timer)} · 2 passes · shadow map ${res}² · ${p.lookup === 'pixel' ? 'per-pixel' : 'per-particle'} lookup`,
  );
}

shell = mountShell({
  title: 'Shadow-mapped spheres',
  recordName: 'particles-shadow-map',
  render,
  findMax: { id: 'count' },
  panel: [
    ...commonSpecs({ methods: ['points', 'billboard'], count: 17, radius: 0.012 }),
    { id: 'res', label: 'Map size', type: 'select', value: '2048',
      options: [['512', '512²'], ['1024', '1024²'], ['2048', '2048²'], ['4096', '4096²']] },
    { id: 'pcf', label: 'Filter', type: 'select', value: '1',
      options: [['0', '1 tap'], ['1', '3×3 taps'], ['2', '5×5 taps']] },
    { id: 'lookup', label: 'Lookup', type: 'select', value: 'pixel',
      options: [['pixel', 'Per pixel'], ['particle', 'Per particle']] },
    { id: 'ground', label: 'Ground', type: 'toggle', value: true },
    { id: 'inset', label: 'Show map', type: 'toggle', value: false },
  ],
});
shell.overlay.appendChild(caption);

render(0);
