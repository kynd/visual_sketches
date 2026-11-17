// Impostor spheres without shadows: one draw call, three ways to submit it.
import { createGL, OrbitCamera, GpuTimer } from '../../js/particles/gl.js';
import { ParticleScene, commonSpecs, METHOD_LABEL, MESH_MAX_LOG2, gpuLine } from '../../js/particles/scene.js';
import { mountShell } from '../../js/demo-shell.js';

const canvas = document.getElementById('canvas');
const gl = createGL(canvas);
const scene = new ParticleScene(gl);
const timer = new GpuTimer(gl);
let shell;
const camera = new OrbitCamera(canvas, { onChange: () => shell.loop.redraw() });

function render(t) {
  const p = shell.params.values;
  const n = scene.count(p);
  const detail = parseInt(p.detail, 10);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  timer.poll();
  timer.begin();
  const defines = [scene.methodDefine(p.method), 'PASS_CAMERA', p.exact && p.method !== 'mesh' ? 'EXACT_DEPTH' : null];
  scene.program(defines).use().setAll(scene.uniforms(p, t, camera, canvas));
  scene.draw(p.method, n, detail);
  timer.end();

  const tris = p.method === 'mesh' ? n * scene.meshes[detail].triangles : p.method === 'billboard' ? n * 2 : 0;
  const capped = p.method === 'mesh' && p.count > MESH_MAX_LOG2 ? ' (capped)' : '';
  shell.setStats(
    `${METHOD_LABEL[p.method]} · ${n.toLocaleString()} particles${capped}`,
    `${gpuLine(timer)} · 1 draw call${tris ? ` · ${(tris / 1e6).toFixed(tris < 1e7 ? 2 : 0)}M triangles` : ''}`,
  );
}

shell = mountShell({
  title: 'Impostor spheres',
  recordName: 'particles-impostors',
  render,
  findMax: { id: 'count' },
  panel: [
    ...commonSpecs({ methods: ['points', 'billboard', 'mesh'] }),
    { id: 'exact', label: 'Exact depth', type: 'toggle', value: false, visible: v => v.method !== 'mesh' },
    { id: 'detail', label: 'Mesh detail', type: 'select', value: '1', visible: v => v.method === 'mesh',
      options: [['0', '20 triangles'], ['1', '80 triangles'], ['2', '320 triangles'], ['3', '1280 triangles']] },
  ],
});

render(0);
