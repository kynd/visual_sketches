// Shared runner for the fluid demos: the shell, the fixed-step clock and the
// automatic pens.
//
// The simulation runs in fixed steps of 1/60 s. render(t) advances it to step
// floor(60 t) and draws, so the image depends only on t and the settings in
// effect: the recorder's render(t0 + n / fps) replays exactly. Going back in
// time, changing the canvas shape, or changing a parameter listed in `resetOn`
// starts a fresh sheet, which is run for WARMUP steps before its first frame.

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

// cfg: { title, recordName, panel, plain?, resetOn: [ids],
//        onReset(p, sim) → palette, brush(p) → extra penSplats options,
//        fluid(p, n) → step options, view(p) → display options, unit: stats noun,
//        warmup?: steps run before a fresh sheet's first frame (default WARMUP) }
// Expected params: driver, pens, speed, brush, size, seed, force, viscosity, vorticity, grid.
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
    shell.setStats(`${label} · ${p.pens} pen${p.pens > 1 ? 's' : ''}`,
      `grid ${sim.simW}×${sim.simH} · ${cfg.unit || 'colour'} ${sim.dyeW}×${sim.dyeH}`);
  }

  shell = mountShell({
    title: cfg.title, recordName: cfg.recordName, render, panel: cfg.panel,
    onParam(id) { if (resetOn.has(id)) needsReset = true; },
  });

  if (!sim.supported) {
    shell.message('This demo needs float render targets (EXT_color_buffer_float), which this browser does not provide.');
  } else {
    render(0);   // poster frame
  }
  return shell;
}
