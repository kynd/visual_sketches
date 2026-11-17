// Minimal WebGL2 helpers shared by the particle demos: program wrapper,
// column-major mat4 math, an orbit camera and a GPU timer.

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: true, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  return gl;
}

// ── Program ──────────────────────────────────────────────────────────────
function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}  ${l}`).join('\n');
    console.error(numbered);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vsSrc, fsSrc) {
    this.gl = gl;
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Link error:\n${gl.getProgramInfoLog(p)}`);
    this.p = p;
    this.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      this.u[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type };
    }
  }
  use() { this.gl.useProgram(this.p); return this; }
  set(name, v) {
    const u = this.u[name];
    if (!u) return this;           // uniform optimised out or unused in this variant
    const gl = this.gl;
    switch (u.type) {
      case gl.FLOAT:      gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      default:            gl.uniform1i(u.loc, v); break;   // int, bool, samplers
    }
    return this;
  }
  setAll(obj) { for (const k in obj) this.set(k, obj[k]); return this; }
}

// ── mat4 (column-major Float32Array) ─────────────────────────────────────
export const mat4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
  },
  // Returns { view, rot } where rot is the camera-to-world rotation (mat3).
  lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const view = new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
    ]);
    const rot = new Float32Array([xx, xy, xz, yx, yy, yz, zx, zy, zz]);
    return { view, rot };
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
};

// ── Orbit camera ─────────────────────────────────────────────────────────
// Drag to orbit, wheel to zoom. Calls onChange so a paused demo can redraw.
export class OrbitCamera {
  constructor(canvas, { yaw = 2.3, pitch = 0.3, dist = 4.4, fov = 40, onChange = () => {} } = {}) {
    Object.assign(this, { yaw, pitch, dist, fov: fov * Math.PI / 180, onChange });
    let drag = null;
    canvas.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      this.yaw   -= (e.clientX - drag.x) * 0.006;
      this.pitch  = Math.max(-1.45, Math.min(1.45, this.pitch + (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY };
      this.onChange();
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist = Math.max(0.6, Math.min(14, this.dist * Math.exp(e.deltaY * 0.001)));
      this.onChange();
    }, { passive: false });
  }
  matrices(aspect) {
    const cp = Math.cos(this.pitch);
    const eye = [this.dist * cp * Math.sin(this.yaw), this.dist * Math.sin(this.pitch), this.dist * cp * Math.cos(this.yaw)];
    const { view, rot } = mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const proj = mat4.perspective(this.fov, aspect, 0.05, 60);
    return { view, rot, proj, eye: new Float32Array(eye) };
  }
}

// ── GPU timer (EXT_disjoint_timer_query_webgl2, when the browser exposes it) ──
export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.ms = null;
    this.cur = null;
  }
  get available() { return !!this.ext; }
  begin() {
    if (!this.ext || this.pending.length > 6) return;
    this.cur = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.cur);
  }
  end() {
    if (!this.cur) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.cur);
    this.cur = null;
  }
  poll() {
    const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (!disjoint) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.ms = this.ms === null ? ms : this.ms * 0.85 + ms * 0.15;
      }
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }
}

// ── Geometry ─────────────────────────────────────────────────────────────
// Unit icosphere: subdivisions 0..3 → 20, 80, 320, 1280 triangles.
export function icosphere(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(v => { const l = Math.hypot(...v); return v.map(c => c / l); });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (cache.has(key)) return cache.get(key);
      const m = verts[a].map((c, i) => c + verts[b][i]);
      const l = Math.hypot(...m);
      verts.push(m.map(c => c / l));
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  return { positions: new Float32Array(verts.flat()), indices: new Uint16Array(faces.flat()), triangles: faces.length };
}
