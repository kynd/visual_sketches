// Shared runner for the fluid demos: the shell, the fixed-step clock and the
// automatic pens.
//
// The simulation runs in fixed steps of 1/60 s. render(t) advances it to step
// floor(60 t) and draws, so the image depends only on t and the settings in
// effect: the recorder's render(t0 + n / fps) replays exactly. Going back in
// time, changing the canvas shape, or changing a parameter listed in `resetOn`
// starts a fresh sheet, which is run for WARMUP steps before its first frame.
//
// One seed sets everything: the palette, every random choice of the pens and
// the panel settings (cfg.derive). It starts as ?seed=N from the URL, or a
// random number; typing a seed or pressing Random re-derives the settings,
// and any setting can still be changed by hand afterwards.

import { mountShell } from '../demo-shell.js';
import { createGL } from '../particles/gl.js';
import { FluidSim } from './fluid-sim.js';
import { paletteFromHues } from './palette.js';
import { penSplats, hash } from './drivers.js';

export const DT = 1 / 60;
const WARMUP = 180;        // steps run before the first frame of a fresh sheet
const MAX_CATCHUP = 4;     // steps per frame while playing; beyond that the pens skip ahead

export const DRIVER_OPTIONS = [
  ['wander', 'Wander'], ['scribble', 'Scribble'], ['loops', 'Loops'],
  ['lines', 'Lines'], ['taps', 'Taps'], ['writing', 'Handwriting'], ['mixed', 'Mixed'],
];
export const BRUSH_OPTIONS = [['drag', 'Drag'], ['parallel', 'Parallel'], ['splash', 'Splash'], ['explode', 'Explode']];

// Five seeded hues × four lightness steps.
export function seededPalette(seed) {
  return paletteFromHues(Array.from({ length: 5 }, (_, k) => hash(seed, 500, k) * 360));
}

// Draws for deriving settings from a seed: each call takes the next hashed number.
export function seedDraws(seed) {
  let k = 0;
  const r = () => hash(seed, 900, k++);
  return {
    r,
    // Uniform in [lo, hi], rounded to the slider step.
    range: (lo, hi, step) => +(Math.round((lo + r() * (hi - lo)) / step) * step).toFixed(4),
    // One of `opts`, with optional relative weights.
    pick(opts, w = opts.map(() => 1)) {
      let x = r() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < opts.length; i++) if ((x -= w[i]) < 0) return opts[i];
      return opts[opts.length - 1];
    },
  };
}

// Settings every fluid demo derives the same way; cfg.derive adds the rest.
function deriveCommon(g) {
  return {
    driver: g.pick(DRIVER_OPTIONS.map(d => d[0])),
    pens: g.pick([1, 2, 3, 4, 5, 6], [1, 3, 3, 2, 1, 1]),
    speed: g.range(0.6, 1.6, 0.05),
    brush: g.pick(BRUSH_OPTIONS.map(b => b[0]), [5, 2, 1.5, 1.5]),
    force: g.range(0.6, 1.8, 0.05),
  };
}

// cfg: { title, recordName, panel, plain?, resetOn: [ids], derive(g) → settings,
//        onReset(p, sim) → palette, brush(p) → extra penSplats options,
//        fluid(p, n) → step options, view(p) → display options, unit: stats noun,
//        warmup?: steps run before a fresh sheet's first frame (default WARMUP),
//        onStep?(sim, p, step): called before each solver step; a function of the step number }
// Expected params: driver, pens, speed, brush, size, force, viscosity, vorticity, grid.
// The Seed row is added at the top of the panel here.
export function mountFluidDemo(cfg) {
  const canvas = document.getElementById('canvas');
  const gl = createGL(canvas);
  const sim = new FluidSim(gl, { plain: !!cfg.plain });
  const resetOn = new Set(['seed', 'grid', ...(cfg.resetOn || [])]);

  let shell = null;
  let step = 0, dclock = 0, lastKeys = [], needsReset = true, simAspect = 0, palette = [];

  function reset(target, p) {
    const aspect = canvas.width / canvas.height;
    sim.resize(aspect, +p.grid);
    simAspect = aspect;
    palette = cfg.onReset(p, sim);
    step = target - (cfg.warmup ?? WARMUP);
    dclock = step * DT * p.speed;
    lastKeys = [];
    needsReset = false;
  }

  function simStep(p) {
    const n = sim.n / 512;      // grid scale relative to Fluid IV's 512 cells per unit
    sim.applySplats(penSplats({
      driver: p.driver, pens: p.pens, seed: p.seed, tau: dclock, dtau: DT * p.speed, dt: DT, step,
      dom: sim.domain, palette, brush: p.brush, size: p.size,
      kv: 100 * p.force * n, ks: p.force * n, lastKeys, ...cfg.brush(p),
    }));
    cfg.onStep?.(sim, p, step);
    sim.step(DT, { viscosity: p.viscosity * n * n, vorticity: p.vorticity, ...cfg.fluid(p) });
    step++;
    dclock += DT * p.speed;
  }

  function render(t) {
    const p = shell.params.values;
    const target = Math.floor(t * 60 + 1e-6);
    const aspect = canvas.width / canvas.height;
    let fresh = false;
    if (needsReset || target < step || Math.abs(aspect - simAspect) > 1e-3) { reset(target, p); fresh = true; }
    if (!fresh && shell.loop.playing && target - step > MAX_CATCHUP) {
      dclock += (target - MAX_CATCHUP - step) * DT * p.speed;
      step = target - MAX_CATCHUP;
    }
    while (step < target) simStep(p);
    sim.display(canvas.width, canvas.height, { time: step * DT, ...cfg.view(p) });
    const label = DRIVER_OPTIONS.find(d => d[0] === p.driver)[1];
    shell.setStats(`${label} · ${p.pens} pen${p.pens > 1 ? 's' : ''} · seed ${p.seed}`,
      `grid ${sim.simW}×${sim.simH} · ${cfg.unit || 'colour'} ${sim.dyeW}×${sim.dyeH}`);
  }

  const ids = new Set(cfg.panel.map(s => s.id).filter(Boolean));
  function derive(seed) {
    const g = seedDraws(seed);
    const all = { ...deriveCommon(g), ...cfg.derive(g) };
    return Object.fromEntries(Object.entries(all).filter(([k]) => ids.has(k)));
  }
  const urlSeed = new URLSearchParams(location.search).get('seed');
  const seed0 = urlSeed !== null && /^\d+$/.test(urlSeed) ? Math.min(+urlSeed, 999999) : Math.floor(Math.random() * 1e6);
  const init = derive(seed0);
  const panel = [
    { id: 'seed', label: 'Seed', type: 'seed', value: seed0 },
    ...cfg.panel.map(s => (s.id in init ? { ...s, value: init[s.id] } : s)),
  ];

  shell = mountShell({
    title: cfg.title, recordName: cfg.recordName, render, panel,
    onParam(id, v) {
      if (id === 'seed') for (const [k, x] of Object.entries(derive(v))) shell.params.set(k, x, true);
      if (resetOn.has(id)) needsReset = true;
    },
  });

  if (!sim.supported) {
    shell.message('This demo needs float render targets (EXT_color_buffer_float), which this browser does not provide.');
  } else {
    render(0);   // poster frame
  }
  return shell;
}
