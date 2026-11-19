// Shared particle scene: program cache, draw calls, uniforms, light frustum
// and the panel controls every particle demo has in common.

import { Program, mat4, icosphere } from './gl.js';
import { particleShaders, groundShaders, insetShaders, KEY_LIGHT } from './glsl.js';
import { formatCount } from '../demo-shell.js';

export const MESH_MAX_LOG2 = 21;   // instanced meshes are capped at 2M spheres

export const FORMATIONS = [['0', 'Cloud'], ['1', 'Ring'], ['2', 'Sheet']];
export const METHOD_LABEL = { points: 'Point sprites', billboard: 'Instanced quads', mesh: 'Instanced meshes' };
const METHOD_DEFINE = { points: 'METHOD_POINTS', billboard: 'METHOD_BILLBOARD', mesh: 'METHOD_MESH' };

export function commonSpecs({ methods, count = 18, radius = 0.008, maxLog2 = 24 }) {
  return [
    { id: 'method', label: 'Method', type: 'select', value: methods[0], options: methods.map(m => [m, METHOD_LABEL[m]]) },
    { id: 'count', label: 'Count', type: 'range', min: 10, max: maxLog2, step: 0.5, value: count, format: v => formatCount(Math.round(2 ** v)) },
    { id: 'radius', label: 'Radius', type: 'range', min: 0.001, max: 0.05, step: 0.001, value: radius, format: v => v.toFixed(3) },
    { id: 'formation', label: 'Formation', type: 'select', value: '0', options: FORMATIONS },
    { id: 'speed', label: 'Speed', type: 'range', min: 0, max: 3, step: 0.05, value: 1, format: v => v.toFixed(2) },
  ];
}

export class ParticleScene {
  constructor(gl) {
    this.gl = gl;
    this.programs = new Map();
    this.maxPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    this.emptyVao = gl.createVertexArray();
    this.meshes = [];
    for (let d = 0; d <= 3; d++) {
      const m = icosphere(d);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.meshes.push({ vao, count: m.indices.length, triangles: m.triangles });
    }

    // Orthographic light looking along the key-light direction.
    const half = 2.2, dist = 5;
    const eye = KEY_LIGHT.map(c => c * dist);
    const { view } = mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
    this.light = {
      half, dist, near: 0.5, far: 12, view, dir: KEY_LIGHT,
      proj: mat4.ortho(-half, half, -half, half, 0.5, 12),
    };
  }

  // Aim the shadow-casting light along 'dir' (unit vector toward the light) and
  // fit a square orthographic frustum around the world-space points 'pts'.
  setLight(dir, pts) {
    const up = Math.abs(dir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
    const dist = 20;
    const { view } = mat4.lookAt(dir.map(c => c * dist), [0, 0, 0], up);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [px, py, pz] of pts) {
      const x = view[0] * px + view[4] * py + view[8] * pz + view[12];
      const y = view[1] * px + view[5] * py + view[9] * pz + view[13];
      const z = view[2] * px + view[6] * py + view[10] * pz + view[14];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const half = Math.max(x1 - x0, y1 - y0) / 2 * 1.02;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const near = -z1 - 0.5, far = -z0 + 0.5;
    this.light = { half, dist, near, far, view, dir, proj: mat4.ortho(cx - half, cx + half, cy - half, cy + half, near, far) };
  }

  program(defines, kind = 'particle') {
    const key = kind + ':' + defines.filter(Boolean).join(',');
    let p = this.programs.get(key);
    if (!p) {
      const defs = defines.filter(Boolean);
      const src = kind === 'ground' ? groundShaders(defs) : kind === 'inset-depth' ? insetShaders('depth')
        : kind === 'inset-opacity' ? insetShaders('opacity') : particleShaders(defs);
      p = new Program(this.gl, src.vs, src.fs);
      this.programs.set(key, p);
    }
    return p;
  }

  methodDefine(method) { return METHOD_DEFINE[method]; }

  count(values) {
    let log2 = values.count;
    if (values.method === 'mesh') log2 = Math.min(log2, MESH_MAX_LOG2);
    return Math.round(2 ** log2);
  }

  uniforms(values, t, camera, canvas) {
    const { view, rot, proj, eye } = camera.matrices(canvas.width / canvas.height);
    return {
      uTime: t * values.speed,
      uFormation: parseInt(values.formation, 10),
      uCount: this.count(values),
      uRadius: values.radius,
      uView: view, uProj: proj, uCamRot: rot, uCamPos: eye,
      uKeyDir: new Float32Array(this.light.dir),
      uViewportH: canvas.height,
      uMaxPointSize: this.maxPointSize,
      uLightView: this.light.view,
      uLightProj: this.light.proj,
      uLightHalf: this.light.half,
      uGroundY: -1.25,
      uGroundHalf: 4.0,
    };
  }

  // Draws N particles with the currently bound program.
  draw(method, n, meshDetail = 1) {
    const gl = this.gl;
    if (method === 'mesh') {
      const m = this.meshes[meshDetail];
      gl.bindVertexArray(m.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, n);
    } else {
      gl.bindVertexArray(this.emptyVao);
      if (method === 'points') gl.drawArrays(gl.POINTS, 0, n);
      else gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    gl.bindVertexArray(null);
  }

  // Full-screen-ish quad helpers (ground plane, inset) — vertices come from gl_VertexID.
  drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  // Square inset in the bottom-right corner of the canvas.
  insetViewport(canvas) {
    const s = Math.round(canvas.height * 0.26), m = Math.round(canvas.height * 0.03);
    return [canvas.width - s - m, m, s, s];
  }
}

export function gpuLine(timer) {
  if (!timer.available) return 'GPU timer not exposed by this browser';
  return timer.ms === null ? 'GPU — ms' : `GPU ${timer.ms.toFixed(2)} ms`;
}
