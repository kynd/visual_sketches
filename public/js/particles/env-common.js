// Environment-map lighting shared by every environment-lit demo: the
// equirectangular map target (env-glsl.js generates it), each environment's
// sun, and the lighting controls.

import { Program, } from './gl.js';
import { KEY_LIGHT } from './glsl.js';
import { ENV_LIST, envMapShaders } from './env-glsl.js';
import { range } from './flow-demo.js';

export const CAM_YAW = 2.3;
const ENV_W = 2048, ENV_H = 1024, ENV_LEVELS = 12;
export const ENV_UNIT = 2;   // texture unit the map is bound to

// Direction toward a light at 'offset' degrees of azimuth from the default
// camera's view direction and 'elev' degrees above the horizon.
function fromView(offset, elev) {
  const az = CAM_YAW + offset * Math.PI / 180, el = elev * Math.PI / 180;
  return [-Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
}

// The shadow-casting light that belongs to each environment (environment frame).
export const SUN = {
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

export const ENV_BY_KEY = Object.fromEntries(ENV_LIST.map(([id, key, label, animated]) => [key, { id, key, label, animated }]));
export const ALL_ENVS = ENV_LIST.map(e => e[1]);

// Lighting controls. d: defaults for env, shading, lookup, blur, exposure, background.
export function envSpecs(envs, defaults) {
  const d = { shading: '0', lookup: '0', blur: 0, exposure: 1.2, background: '1', ...defaults };
  return [
    { id: 'env', label: 'Environment', type: 'select', value: d.env, options: envs.map(k => [k, ENV_BY_KEY[k].label]) },
    { id: 'shading', label: 'Shading', type: 'select', value: d.shading, options: [['0', 'Paint'], ['1', 'Light'], ['2', 'Mirror']] },
    { id: 'lookup', label: 'Lookup', type: 'select', value: d.lookup, options: [['0', 'Normal'], ['1', 'Reflection']] },
    range('blur', 'Blur (mip level)', 0, 8, 0.25, d.blur),
    range('exposure', 'Exposure', 0.2, 4, 0.05, d.exposure),
    range('sun', 'Sun strength', 0, 3, 0.05, 1),
    range('occlusion', 'Occlusion', 0, 1, 0.01, 0.5),
    range('rotation', 'Rotation (°/s)', -20, 20, 0.5, 0, 1),
    { id: 'orbit', label: 'Camera orbit', type: 'range', min: 0, max: 120, step: 1, value: 0, format: v => (v > 0 ? `${v} s` : 'Off') },
    { id: 'background', label: 'Background', type: 'select', value: d.background, options: [['0', 'Environment'], ['1', 'Dimmed'], ['2', 'Black']] },
  ];
}

export class Environment {
  constructor(gl, drawQuad) {
    this.gl = gl;
    this.drawQuad = drawQuad;
    const s = envMapShaders();
    this.prog = new Program(gl, s.vs, s.fs);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, ENV_LEVELS, gl.RGBA16F, ENV_W, ENV_H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.tex = tex;
    this.key = '';
  }

  // Per-frame state: the environment turns about y by 'rotation' °/s and the
  // sun turns with it. Returns the world sun direction and the env uniforms.
  frame(p, t) {
    const E = ENV_BY_KEY[p.env], sun = SUN[p.env];
    const rot = t * p.rotation * Math.PI / 180;
    const c = Math.cos(rot), s = Math.sin(rot);
    const [lx, ly, lz] = sun.dir;
    const sunCol = new Float32Array(sun.col.map(v => v * sun.gain * p.sun));
    return {
      E, sun, rot, sunCol,
      sunWorld: [c * lx - s * lz, ly, s * lx + c * lz],
      uniforms: {
        uEnvTex: ENV_UNIT, uEnvRot: rot, uBlur: p.blur, uOcclusion: p.occlusion, uExposure: p.exposure,
        uSunCol: sunCol, uShading: parseInt(p.shading, 10), uLookup: parseInt(p.lookup, 10), uBgMode: parseInt(p.background, 10),
      },
    };
  }

  // Render the map if it changed (always, for animated maps) and bind it.
  bind(f, p, t) {
    const gl = this.gl;
    const key = `${f.E.key}|${p.sun}|${f.E.animated ? t : ''}`;
    gl.activeTexture(gl.TEXTURE0 + ENV_UNIT);
    if (key !== this.key) {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, ENV_W, ENV_H);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      this.prog.use().setAll({ uEnv: f.E.id, uTime: t, uSunDir: new Float32Array(f.sun.dir), uSunCol: f.sunCol });
      this.drawQuad();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.key = key;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
  }
}
