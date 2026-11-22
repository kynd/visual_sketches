// Screen-space blur that grows with distance from the centre of the frame.
// The camera pass renders into an offscreen texture (begin), which is then
// drawn to the canvas through a disc gather whose radius depends on where the
// pixel sits (end). The texture is mipmapped so wide discs read prefiltered
// texels and stay smooth with a fixed number of taps.

import { Program } from './gl.js';

const UNIT = 3;   // texture unit the scene is read from (0 shadow map, 1 positions, 2 environment)

const VS = /* glsl */`#version 300 es
out vec2 vUv;
void main() {
  vUv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2  uRes;      // texture size in pixels
uniform float uRadius;   // disc radius at the long edge, in pixels
uniform float uFocus;    // distance (long edge = 1) that stays sharp
in vec2 vUv;
out vec4 fragColor;
const int N = 48;
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 q = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0) / max(aspect, 1.0);
  float r = uRadius * smoothstep(uFocus, 1.0, length(q));
  if (r < 0.5) { fragColor = textureLod(uScene, vUv, 0.0); return; }
  float lod = max(0.0, log2(2.0 * r / sqrt(float(N))));
  vec4 sum = vec4(0.0);
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 0.5) / float(N);
    float a = float(i) * 2.39996323;                 // golden angle
    vec2 o = vec2(cos(a), sin(a)) * sqrt(f) * r;
    sum += textureLod(uScene, vUv + o / uRes, lod);
  }
  fragColor = sum / float(N);   // premultiplied, so a transparent background blurs correctly
}`;

export class ScreenBlur {
  constructor(gl, drawQuad) {
    this.gl = gl;
    this.drawQuad = drawQuad;
    this.prog = new Program(gl, VS, FS);
    this.tex = gl.createTexture();
    this.depth = gl.createRenderbuffer();
    this.fbo = gl.createFramebuffer();
    this.w = 0;
    this.h = 0;
  }

  // Bind the offscreen target at w × h (reallocated when the size changes).
  begin(w, h) {
    const gl = this.gl;
    if (w !== this.w || h !== this.h) {
      gl.activeTexture(gl.TEXTURE0 + UNIT);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
      this.w = w;
      this.h = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
  }

  // Draw the blurred texture to the canvas. radius: pixels at the long edge; focus: sharp zone (0–1).
  end(radius, focus) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.prog.use().setAll({ uScene: UNIT, uRes: new Float32Array([this.w, this.h]), uRadius: radius, uFocus: focus });
    this.drawQuad();
    gl.enable(gl.DEPTH_TEST);
  }
}
