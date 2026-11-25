// Automatic pens for the watercolour fluid. Each driver is a pure function of
// (seed, pen, driver time): it says whether the pen is down and, if it is,
// gives the current stroke's path as a function of time. The brushes turn
// pen samples into splats; their randomness is hashed from the step number,
// so a run replays identically.

import { vividize } from './palette.js';

// ── Hashing and noise ────────────────────────────────────────────────────
export function hash(...v) {
  let h = 0x9e3779b9;
  for (const x of v) {
    h = Math.imul(h ^ (Math.floor(x) | 0), 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

// Value noise with quintic interpolation (smooth position and velocity), −1…1.
function vnoise(seed, salt, x) {
  const i = Math.floor(x), f = x - i;
  const a = hash(seed, salt, i) * 2 - 1, b = hash(seed, salt, i + 1) * 2 - 1;
  return a + (b - a) * f * f * f * (f * (f * 6 - 15) + 10);
}
export const fbm = (seed, salt, x) => (vnoise(seed, salt, x) + 0.5 * vnoise(seed, salt + 101, 2.03 * x + 17.1)) / 1.5;
const soft = v => v / Math.sqrt(1 + v * v);                 // squashes any value into (−1, 1)
const smooth = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const ramp = (s, dur, a) => smooth(Math.min(s / a, (dur - s) / a));

// Pen-down windows: time is cut into periods of P seconds; in period k the
// pen goes down after a short random delay and stays down for a random
// fraction of the period. Each pen has its own phase.
function strokeWindow(seed, pen, tau, P, dLo, dHi, salt) {
  const off = hash(seed, pen, salt) * P;
  const x = (tau + off) / P, k = Math.floor(x), u = x - k;
  const a = hash(seed, pen, k, salt + 1) * 0.12;
  const d = dLo + hash(seed, pen, k, salt + 2) * (dHi - dLo);
  if (u < a || u >= a + d) return null;
  return { k, s: (u - a) * P, dur: d * P, start: (k + a) * P - off };
}

const MARGIN = 0.07;
const place = (dom, vx, vy) => [dom[0] / 2 + (dom[0] / 2 - MARGIN) * vx, dom[1] / 2 + (dom[1] / 2 - MARGIN) * vy];

// ── Drivers: (seed, pen, tau, dom, pens) → null | { key, env, at(tau), tap? } ─
export const DRIVERS = {
  // A smooth random walk over the whole frame, lifting the pen between strokes.
  wander(seed, i, tau, dom) {
    const w = strokeWindow(seed, i, tau, 2.6, 0.5, 0.85, 10);
    if (!w) return null;
    const at = t => place(dom, soft(1.7 * fbm(seed, i * 8 + 1, t * 0.6)), soft(1.7 * fbm(seed, i * 8 + 2, t * 0.6)));
    return { key: w.k, env: ramp(w.s, w.dur, 0.12), at };
  },

  // Fast tight loops around a slowly drifting centre.
  scribble(seed, i, tau, dom) {
    const w = strokeWindow(seed, i, tau, 3.5, 0.75, 0.95, 20);
    if (!w) return null;
    const omega = 2 * Math.PI * (1.3 + 0.9 * hash(seed, i, 21));
    const at = t => {
      const c = place(dom, 0.85 * soft(2.2 * fbm(seed, i * 8 + 3, t * 0.15)), 0.85 * soft(2.2 * fbm(seed, i * 8 + 4, t * 0.15)));
      const r = 0.05 + 0.035 * fbm(seed, i * 8 + 5, t * 0.4);
      const ph = omega * t + 1.5 * fbm(seed, i * 8 + 6, t * 0.3);
      return [c[0] + r * Math.cos(ph), c[1] + r * Math.sin(ph) * (0.8 + 0.4 * fbm(seed, i * 8 + 7, t * 0.2))];
    };
    return { key: w.k, env: ramp(w.s, w.dur, 0.15), at };
  },

  // Fluid IV's Drag & Swirl gusts: a loop around a random centre that
  // ramps in, holds and ramps out.
  loops(seed, i, tau, dom) {
    const w = strokeWindow(seed, i, tau, 1.5, 0.65, 0.95, 30);
    if (!w) return null;
    const h = n => hash(seed, i, w.k, 30 + n);
    const c = place(dom, (h(1) * 2 - 1) * 0.8, (h(2) * 2 - 1) * 0.8);
    const a0 = h(3) * 6.283, speed = (h(4) < 0.5 ? 1 : -1) * (2.2 + 2.2 * h(5));
    const R = 0.09 + 0.09 * h(6), wf = 0.6 + 0.7 * h(7), ph = h(8) * 6.283;
    const at = t => {
      const s = t - w.start;
      const ang = a0 + s * speed + 0.5 * Math.sin(s * wf + ph);
      const r = R * (1 + 0.25 * Math.sin(s * 0.9 + ph * 1.7));
      return [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
    };
    const u = w.s / w.dur;
    return { key: w.k, env: u < 0.25 ? smooth(u / 0.25) : u > 0.75 ? smooth((1 - u) / 0.25) : 1, at };
  },

  // Quick, slightly bent strokes along random chords.
  lines(seed, i, tau, dom) {
    const w = strokeWindow(seed, i, tau, 1.2, 0.3, 0.55, 40);
    if (!w) return null;
    const h = n => hash(seed, i, w.k, 40 + n);
    const c = place(dom, (h(1) * 2 - 1) * 0.6, (h(2) * 2 - 1) * 0.6);
    const a = h(3) * 6.283, len = 0.45 + 0.45 * h(4), bend = (h(5) * 2 - 1) * 0.15;
    const d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
    const at = t => {
      const u = (t - w.start) / w.dur, along = (u - 0.5) * len, side = bend * len * (1 - (2 * u - 1) ** 2);
      return [c[0] + d[0] * along + n[0] * side, c[1] + d[1] * along + n[1] * side];
    };
    return { key: w.k, env: ramp(w.s, w.dur, 0.04), at };
  },

  // Single taps at random spots; each tap is one burst.
  taps(seed, i, tau, dom) {
    const w = strokeWindow(seed, i, tau, 0.55, 0.15, 0.3, 50);
    if (!w) return null;
    const p = place(dom, (hash(seed, i, w.k, 51) * 2 - 1) * 0.85, (hash(seed, i, w.k, 52) * 2 - 1) * 0.85);
    return { key: w.k, env: 1, at: () => p, tap: true };
  },

  // Cursive-like loops written left to right in rows, top to bottom, with
  // gaps between words. Pens share the rows, each starting on its own line.
  writing(seed, i, tau, dom, pens) {
    const lineH = 0.2, rows = Math.max(1, Math.floor((dom[1] - 2 * MARGIN) / lineH));
    const vx = 0.2, width = dom[0] - 2 * MARGIN - 0.08, lineDur = width / vx + 0.5;
    const off = Math.round(i * rows / pens) * lineDur;
    const x = tau + off, L = Math.floor(x / lineDur), s = x - L * lineDur;
    if (s > width / vx) return null;
    const wk = Math.floor(s / 0.9), u = s / 0.9 - wk;
    if (u > 0.62 + 0.3 * hash(seed, i, L, wk, 60)) return null;
    const row = ((L % rows) + rows) % rows;
    const y0 = dom[1] - MARGIN - 0.6 * lineH - row * lineH;
    const omega = 2 * Math.PI * 1.5, ph = hash(seed, i, L, 61) * 6.283;
    const at = t => {
      const q = t + off - L * lineDur;
      const r = 0.05 + 0.012 * fbm(seed, i * 8 + 62, q * 0.9);
      return [MARGIN + 0.04 + vx * q + r * Math.cos(omega * q + ph),
              y0 + 1.5 * r * Math.sin(omega * q + ph) + 0.02 * fbm(seed, i * 8 + 63, q * 0.5)];
    };
    return { key: L, env: ramp(u * 0.9, 0.9, 0.05), at };
  },
};

// Mixed: each pen switches to a randomly chosen driver every MIX_EPOCH seconds
// of driver time, on its own phase, so different pens run different drivers
// at once. The pen stays up for the first MIX_GAP seconds of each epoch so the
// switch never joins two drivers' paths in one stroke.
const MIX_EPOCH = 6, MIX_GAP = 0.25;
const MIX_NAMES = Object.keys(DRIVERS);
DRIVERS.mixed = (seed, i, tau, dom, pens) => {
  const x = (tau + hash(seed, i, 200) * MIX_EPOCH) / MIX_EPOCH, e = Math.floor(x);
  if ((x - e) * MIX_EPOCH < MIX_GAP) return null;
  const name = MIX_NAMES[Math.floor(hash(seed, i, e, 201) * MIX_NAMES.length)];
  const st = DRIVERS[name](seed, i, tau, dom, pens);
  // Numeric key (the colour hash floors it): unique per epoch and stroke.
  return st && { ...st, key: e * 100003 + st.key };
};

// ── Brushes ──────────────────────────────────────────────────────────────
// o: { driver, pens, seed, tau, dtau, dt, step, dom, palette, colours, brush,
//      size, kv (texels/s per domain unit/s), ks (texel-speed scale), lastKeys,
//      ink? (pigment amount multiplier, default 1), vivid? (default true) }
// colours: 'stroke' | 'pen' | 'one' | 'none' (push only, no colour).
export function penSplats(o) {
  const out = [];
  const drv = DRIVERS[o.driver];
  const sz = o.size;
  const ink = o.colours === 'none' ? 0 : (o.ink ?? 1);
  const splat = (x, y, vx, vy, color, radius, amount) => {
    if (x < 0 || y < 0 || x > o.dom[0] || y > o.dom[1]) return;
    out.push({ x, y, vx, vy, color, radius, water: 0.5, amount: amount * ink });
  };
  // A stroke segment from p0 to p1 carrying velocity v, split so the dye stays continuous.
  const segment = (p0, p1, v, color, amount) => {
    const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const m = Math.min(6, Math.max(1, Math.ceil(dist / (0.012 * Math.sqrt(sz)))));
    for (let j = 1; j <= m; j++) {
      const f = j / m;
      splat(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, v[0] / m, v[1] / m, color, sz, amount);
    }
  };
  const burst = (p, color, i, droplets) => {
    if (droplets) {        // Fluid IV's random splashes: a ring of small drops
      const n = 8 + Math.floor(hash(o.seed, i, o.step, 90) * 6);
      for (let j = 0; j < n; j++) {
        const h = k => hash(o.seed, i, o.step, j, 91 + k);
        const a = h(0) * 6.283, r = (0.01 + 0.06 * h(1)) * sz, sp = (700 + 2000 * h(2)) * o.ks;
        splat(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r, Math.cos(a) * sp, Math.sin(a) * sp, color, 0.45 * sz, 0.35 + 0.3 * h(3));
      }
    } else {               // Fluid IV's Explode brush: an even radial burst
      const rot = hash(o.seed, i, o.step, 95) * 6.283;
      for (let j = 0; j < 16; j++) {
        const h = k => hash(o.seed, i, o.step, j, 96 + k);
        const a = rot + j / 16 * 6.283 + (h(0) - 0.5) * 0.35, sp = (2600 + 2200 * h(1)) * o.ks;
        splat(p[0], p[1], Math.cos(a) * sp, Math.sin(a) * sp, color, 1.5 * sz, 1);
      }
    }
  };

  for (let i = 0; i < o.pens; i++) {
    const st = drv(o.seed, i, o.tau, o.dom, o.pens);
    if (!st) { o.lastKeys[i] = null; continue; }
    const isNew = o.lastKeys[i] !== st.key;
    o.lastKeys[i] = st.key;

    const ck = o.colours === 'stroke' ? hash(o.seed, i, st.key, 77) : o.colours === 'pen' ? hash(o.seed, i, 78) : hash(o.seed, 79);
    const rgb = o.palette[Math.floor(ck * o.palette.length)].rgb;
    const color = o.vivid === false ? rgb : vividize(rgb);
    const p1 = st.at(o.tau), p0 = isNew ? p1 : st.at(o.tau - o.dtau);

    if (st.tap) { if (isNew) burst(p1, color, i, o.brush === 'splash'); continue; }

    const d = [p1[0] - p0[0], p1[1] - p0[1]], moved = Math.hypot(d[0], d[1]);
    const v = [d[0] / o.dt * o.kv * st.env, d[1] / o.dt * o.kv * st.env];
    if (o.brush === 'drag') {
      if (moved > 1e-5 || isNew) segment(p0, p1, v, color, st.env);
    } else if (o.brush === 'parallel') {
      if (moved < 1e-5) continue;
      const nx = -d[1] / moved, ny = d[0] / moved;
      for (let k = -2; k <= 2; k++) {
        const ox = nx * k * 0.09 * sz, oy = ny * k * 0.09 * sz;
        segment([p0[0] + ox, p0[1] + oy], [p1[0] + ox, p1[1] + oy], v, color, st.env);
      }
    } else if (o.brush === 'splash') {   // Fluid IV's Splash brush: drops flung off the moving pen
      for (let j = 0; j < 4; j++) {
        const h = k => hash(o.seed, i, o.step, j, 80 + k);
        const a = h(0) * 6.283, r = (0.03 + 0.16 * h(1)) * sz, sp = (900 + 2200 * h(2)) * o.ks;
        splat(p1[0] + Math.cos(a) * r, p1[1] + Math.sin(a) * r,
          Math.cos(a) * sp + v[0] * 0.15, Math.sin(a) * sp + v[1] * 0.15, color, 0.35 * sz, (0.55 + 0.35 * h(3)) * st.env);
      }
    } else if (isNew || (o.step + i * 3) % 7 === 0) {   // explode, every 7 steps (~0.12 s)
      burst(p1, color, i, false);
    }
  }
  return out;
}
