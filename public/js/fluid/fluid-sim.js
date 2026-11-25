// Fluid on the GPU: a stable-fluids Navier–Stokes solver (velocity and
// pressure grid) carrying a colour field (dye). Ported from math_sketches
// Fluid IV to raw WebGL2, with grids shaped to the canvas instead of a cropped
// square. Two modes:
//   watercolour (default) — dye is pigment that moves only where the paper is
//     wet, and stains the paper it passes over (Fluid IV);
//   plain — the dye is the liquid itself: it fills the frame, moves wherever
//     the flow goes, and is advected with MacCormack to stay sharp.
//
// Domain units: the short side of the frame is 1, so the domain is
// (aspect, 1) in landscape and (1, 1/aspect) in portrait. Velocity is stored
// in sim texels per second, as in the original.

import { Program } from '../particles/gl.js';
import * as G from './fluid-glsl.js';

const PRESSURE_IT = 32;
const VISCOSITY_IT = 16;

// Gaussian radii (domain units², before the brush's radius scale), as in Fluid IV.
const R_VELOCITY = 0.0016, R_DYE = 0.0009, R_WATER = 0.0020;

// Fluid IV's key light for the lit view, normalize(0.45, 0.30, 0.75).
const DEFAULT_LIGHT = (() => { const l = Math.hypot(0.45, 0.30, 0.75); return [0.45 / l, 0.30 / l, 0.75 / l]; })();

export class FluidSim {
  constructor(gl, { plain = false } = {}) {
    this.gl = gl;
    this.plain = plain;
    this.supported = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    const P = fs => new Program(gl, G.VS, fs);
    this.p = {
      advect: P(G.ADVECT), divergence: P(G.DIVERGENCE), curl: P(G.CURL), vorticity: P(G.VORTICITY),
      pressure: P(G.PRESSURE), gradient: P(G.GRADIENT), viscosity: P(G.VISCOSITY), scale: P(G.SCALE),
      paper: P(G.PAPER), splat: P(G.SPLAT), display: P(G.DISPLAY),
      maccormack: P(G.MACCORMACK), pattern: P(G.PATTERN),
    };
    this.vao = gl.createVertexArray();
    this.targets = [];
    this.simW = this.simH = this.dyeW = this.dyeH = 0;
    this.zoom = { uZoomRate: 0, uZoomCentre: [0.5, 0.5] };
    this.splatBuf = { A: new Float32Array(4 * G.MAX_SPLATS), B: new Float32Array(4 * G.MAX_SPLATS), C: new Float32Array(4 * G.MAX_SPLATS) };
  }

  // ── Targets ────────────────────────────────────────────────────────────
  target(w, h, internal, format, filter) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const t = { tex, fbo, w, h };
    this.targets.push(t);
    return t;
  }
  double(...args) {
    const d = { read: this.target(...args), write: this.target(...args) };
    d.swap = () => { [d.read, d.write] = [d.write, d.read]; };
    return d;
  }

  // Allocate the grids: `n` sim cells along the short side, dye at twice that.
  resize(aspect, n) {
    const gl = this.gl;
    for (const t of this.targets) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    this.targets = [];
    this.domain = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect];
    this.n = n;
    this.simW = Math.round(n * this.domain[0]); this.simH = Math.round(n * this.domain[1]);
    this.dyeW = this.simW * 2; this.dyeH = this.simH * 2;
    const { simW: sw, simH: sh, dyeW: dw, dyeH: dh } = this;
    const N = gl.NEAREST, L = gl.LINEAR;
    this.velocity = this.double(sw, sh, gl.RG32F, gl.RG, N);
    this.pressure = this.double(sw, sh, gl.R32F, gl.RED, N);
    this.viscTmp = this.double(sw, sh, gl.RG32F, gl.RG, N);
    this.velSource = this.target(sw, sh, gl.RG32F, gl.RG, N);
    this.divergence = this.target(sw, sh, gl.R32F, gl.RED, N);
    this.curl = this.target(sw, sh, gl.R16F, gl.RED, L);
    this.pressureSmooth = this.target(sw, sh, gl.R16F, gl.RED, L);
    this.dye = this.double(dw, dh, gl.RGBA16F, gl.RGBA, L);
    this.wetness = this.double(dw, dh, gl.R16F, gl.RED, L);
    this.paper = this.double(dw, dh, gl.RGBA16F, gl.RGBA, L);
    if (this.plain) {
      this.dyeFwd = this.target(dw, dh, gl.RGBA16F, gl.RGBA, L);
      this.dyeBack = this.target(dw, dh, gl.RGBA16F, gl.RGBA, L);
    }
    this.simTexel = [1 / sw, 1 / sh];
    this.dyeTexel = [1 / dw, 1 / dh];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.clear();
  }

  clear() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    for (const t of this.targets) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── Passes ─────────────────────────────────────────────────────────────
  // textures: { uniformName: target } bound to units 0…n; dst: target or null (canvas).
  pass(prog, dst, uniforms, textures = {}, w, h) {
    const gl = this.gl;
    prog.use();
    let unit = 0;
    for (const k in textures) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, textures[k].tex);
      prog.set(k, unit++);
    }
    prog.setAll(uniforms);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
    gl.viewport(0, 0, dst ? dst.w : w, dst ? dst.h : h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // splats: [{ x, y, vx, vy, color: [r, g, b], radius, water, amount }]
  applySplats(splats) {
    if (!splats.length) return;
    const { A, B, C } = this.splatBuf;
    for (let s = 0; s < splats.length; s += G.MAX_SPLATS) {
      const batch = splats.slice(s, s + G.MAX_SPLATS);
      batch.forEach((p, i) => {
        A.set([p.x, p.y, p.vx, p.vy], i * 4);
        B.set([p.color[0], p.color[1], p.color[2], p.radius], i * 4);
        C.set([p.water, p.amount, 0, 0], i * 4);
      });
      const common = { uDomain: this.domain, uCount: batch.length, uA: A, uB: B, uC: C };
      this.pass(this.p.splat, this.velocity.write, { ...common, uTexel: this.simTexel, uMode: 0, uRadius: R_VELOCITY }, { uTarget: this.velocity.read });
      this.velocity.swap();
      this.pass(this.p.splat, this.dye.write, { ...common, uTexel: this.dyeTexel, uMode: 2, uRadius: R_DYE }, { uTarget: this.dye.read });
      this.dye.swap();
      if (this.plain) continue;
      this.pass(this.p.splat, this.wetness.write, { ...common, uTexel: this.dyeTexel, uMode: 1, uRadius: R_WATER }, { uTarget: this.wetness.read });
      this.wetness.swap();
    }
  }

  // Fill the dye with a starting pattern (plain mode).
  // o: { pattern (0 stripes, 1 rings, 2 cells, 3 marble, 4 gradient from cols[0] to cols[1]), cols: [[r,g,b]…], scale, angle, centre: [x, y] }
  fillPattern(o) {
    const n = Math.min(o.cols.length, G.MAX_PATTERN_COLS);
    const cols = new Float32Array(3 * G.MAX_PATTERN_COLS);
    for (let i = 0; i < n; i++) cols.set(o.cols[i], i * 3);
    this.pass(this.p.pattern, this.dye.read, {
      uTexel: this.dyeTexel, uDomain: this.domain, uPattern: o.pattern, uCount: n, uCols: cols,
      uScale: o.scale, uAngle: o.angle, uCentre: o.centre,
    });
  }

  // Continuous zoom for the following steps: advection also carries
  // everything outward from centre (uv) at rate (1/s), magnifying velocity and
  // dye by about e^(rate·dt) per step. Velocity keeps its magnitude, so
  // magnified eddies turn more slowly. rate 0 turns it off.
  setZoom(rate, centre) {
    this.zoom.uZoomRate = rate;
    this.zoom.uZoomCentre = centre;
  }

  // One time step. f: { viscosity (texel²/s), vorticity, dryRate (1/s), sharp (plain: MacCormack) }
  step(dt, f) {
    const { p, velocity, pressure, viscTmp, wetness, dye, paper } = this;
    const st = this.simTexel, dtx = this.dyeTexel;

    // 1. vorticity confinement
    this.pass(p.curl, this.curl, { uTexel: st }, { uVelocity: velocity.read });
    this.pass(p.vorticity, velocity.write, { uTexel: st, uCurlAmt: f.vorticity, uDt: dt }, { uVelocity: velocity.read, uCurl: this.curl });
    velocity.swap();

    // 2. implicit viscous diffusion
    if (f.viscosity > 1e-4) {
      this.pass(p.scale, this.velSource, { uTexel: st, uValue: 1 }, { uTexture: velocity.read });
      this.pass(p.scale, viscTmp.read, { uTexel: st, uValue: 1 }, { uTexture: velocity.read });
      for (let i = 0; i < VISCOSITY_IT; i++) {
        this.pass(p.viscosity, viscTmp.write, { uTexel: st, uAlpha: f.viscosity * dt }, { uVelocity: viscTmp.read, uSource: this.velSource });
        viscTmp.swap();
      }
      this.pass(p.scale, velocity.write, { uTexel: st, uValue: 1 }, { uTexture: viscTmp.read });
      velocity.swap();
    }

    // 3. self-advection (no wetness gate: the air/water flow moves everywhere)
    this.pass(p.advect, velocity.write, { uTexel: st, uVelTexel: st, uSrcTexel: st, uDt: dt, uDissipation: 0.22, uUseWetness: 0, ...this.zoom },
      { uVelocity: velocity.read, uSource: velocity.read, uWetness: wetness.read });
    velocity.swap();

    // 4. projection
    this.pass(p.divergence, this.divergence, { uTexel: st }, { uVelocity: velocity.read });
    this.pass(p.scale, pressure.write, { uTexel: st, uValue: 0.8 }, { uTexture: pressure.read });
    pressure.swap();
    for (let i = 0; i < PRESSURE_IT; i++) {
      this.pass(p.pressure, pressure.write, { uTexel: st }, { uPressure: pressure.read, uDivergence: this.divergence });
      pressure.swap();
    }
    this.pass(p.gradient, velocity.write, { uTexel: st }, { uPressure: pressure.read, uVelocity: velocity.read });
    velocity.swap();

    if (this.plain) { this.advectDye(dt, f.sharp !== false); return; }

    // 5. the paper dries
    this.pass(p.scale, wetness.write, { uTexel: dtx, uValue: Math.exp(-f.dryRate * dt) }, { uTexture: wetness.read });
    wetness.swap();

    // 6. the paper takes the stain before this step's advection moves the dye
    this.pass(p.paper, paper.write, { uTexel: dtx }, { uPaper: paper.read, uDye: dye.read, uWetness: wetness.read });
    paper.swap();

    // 7. pigment moves only where the paper is wet
    this.pass(p.advect, dye.write, { uTexel: dtx, uVelTexel: st, uSrcTexel: dtx, uDt: dt, uDissipation: 0, uUseWetness: 1, ...this.zoom },
      { uVelocity: velocity.read, uSource: dye.read, uWetness: wetness.read });
    dye.swap();
  }

  // Plain mode: carry the colour along the flow everywhere, no dissipation.
  advectDye(dt, sharp) {
    const { p, velocity, dye } = this;
    const st = this.simTexel, dtx = this.dyeTexel;
    const adv = (dst, src, d) => this.pass(p.advect, dst,
      { uTexel: dtx, uVelTexel: st, uSrcTexel: dtx, uDt: d, uDissipation: 0, uUseWetness: 0, ...this.zoom },
      { uVelocity: velocity.read, uSource: src, uWetness: this.wetness.read });
    if (!sharp) { adv(dye.write, dye.read, dt); dye.swap(); return; }
    adv(this.dyeFwd, dye.read, dt);
    adv(this.dyeBack, this.dyeFwd, -dt);
    this.pass(p.maccormack, dye.write, { uTexel: dtx, uVelTexel: st, uSrcTexel: dtx, uDt: dt, ...this.zoom },
      { uVelocity: velocity.read, uSource: dye.read, uForward: this.dyeFwd, uBackward: this.dyeBack });
    dye.swap();
  }

  // Draw to the canvas. v: { view, baseColor, relief, lLow, lHigh, time, lightDir?, lightNorm? }
  // lightDir (unit, toward the light) defaults to Fluid IV's upper-right key light.
  display(w, h, v) {
    const gl = this.gl;
    const lightDir = v.lightDir || DEFAULT_LIGHT, lightNorm = v.lightNorm ?? 0.94;
    if (v.view >= 6 || v.view === 1) {
      this.pass(this.p.scale, this.pressureSmooth, { uTexel: this.simTexel, uValue: 1 }, { uTexture: this.pressure.read });
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    this.pass(this.p.display, null, {
      uTexel: [1 / w, 1 / h], uRes: [w, h], uDomain: this.domain, uSimTexel: this.simTexel,
      uView: v.view, uPlain: this.plain ? 1 : 0, uBaseColor: v.baseColor, uRelief: v.relief, uLLow: v.lLow, uLHigh: v.lHigh, uTime: v.time,
      uLightDir: lightDir, uLightNorm: lightNorm,
    }, {
      uDye: this.dye.read, uVelocity: this.velocity.read, uCurl: this.curl,
      uPressure: (v.view >= 6 || v.view === 1) ? this.pressureSmooth : this.pressure.read,
      uWetness: this.wetness.read, uPaper: this.paper.read,
    }, w, h);
  }
}
