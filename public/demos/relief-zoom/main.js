// Relief zoom: Pressure relief with a continuous zoom. Advection carries the
// velocity and colour outward from a centre that drifts with value noise
// (FluidSim.setZoom), so the frame keeps diving into the liquid while the pens
// stir it. Clock and pens: js/fluid/fluid-demo.js.

import { mountFluidDemo, seededPalette, DRIVER_OPTIONS, BRUSH_OPTIONS, DT } from '../../js/fluid/fluid-demo.js';
import { fbm } from '../../js/fluid/drivers.js';

const deg = Math.PI / 180;

mountFluidDemo({
  title: 'Relief zoom',
  recordName: 'relief-zoom',
  plain: true,
  warmup: 60,     // 1 s: the first frame still shows most of the gradient
  onReset(p, sim) {
    // Palette entries are 5 hues × 4 lightness steps, lightest first.
    // Top of the frame: hue 0 at its lightest; bottom: hue 1 at its darkest.
    const palette = seededPalette(p.seed);
    sim.fillPattern({ pattern: 4, cols: [palette[7].rgb, palette[0].rgb], scale: 1, angle: Math.PI / 2, centre: [0, 0] });
    return palette;
  },
  derive: g => ({
    size: g.range(0.6, 1.6, 0.05),
    colours: g.pick(['none', 'stroke', 'pen', 'one'], [0.5, 4, 2, 1]),
    ink: g.range(0.3, 0.8, 0.05),
    viscosity: g.range(0, 0.06, 0.01),
    vorticity: g.range(2, 14, 1),
    relief: g.range(0.6, 2, 0.05),
    elev: g.range(40, 85, 1),
    zoom: g.range(0.08, 0.35, 0.01),
    wander: g.range(0.1, 0.35, 0.01),
    drift: g.range(0.1, 0.5, 0.01),
  }),
  brush: p => ({ colours: p.colours, ink: p.ink, vivid: false }),
  fluid: () => ({ sharp: true }),
  // Zoom centre in uv: 0.5 plus two octaves of value noise in time, kept off the edges.
  onStep(sim, p, step) {
    const t = step * DT * p.drift;
    const c = k => Math.min(0.9, Math.max(0.1, 0.5 + p.wander * 1.5 * fbm(p.seed, 300 + k, t)));
    sim.setZoom(p.zoom, [c(0), c(1)]);
  },
  view: p => {
    // Light from the top edge of the frame (+y), raised `elev` above the surface.
    const e = p.elev * deg;
    const lightDir = [0, Math.cos(e), Math.sin(e)];
    return { view: +p.view, relief: p.relief, lLow: 0.2, lHigh: 0.8, baseColor: [0, 0, 0],
             lightDir, lightNorm: 0.30 + 0.85 * lightDir[2] };
  },
  panel: [
    { id: 'driver', label: 'Driver', type: 'select', value: 'wander', options: DRIVER_OPTIONS },
    { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 8, step: 1, value: 3 },
    { id: 'speed', label: 'Pen speed', type: 'range', min: 0.25, max: 3, step: 0.05, value: 1, format: v => `×${v.toFixed(2)}` },
    { id: 'brush', label: 'Brush', type: 'select', value: 'drag', options: BRUSH_OPTIONS },
    { id: 'size', label: 'Brush size', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1, format: v => `×${v.toFixed(2)}` },
    { id: 'colours', label: 'Pen colour', type: 'select', value: 'stroke',
      options: [['none', 'None (stir only)'], ['stroke', 'New per stroke'], ['pen', 'One per pen'], ['one', 'One for all']] },
    { id: 'ink', label: 'Ink amount', type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.6, visible: v => v.colours !== 'none' },
    { type: 'group', label: 'Zoom', open: true },
    { id: 'zoom', label: 'Zoom rate', type: 'range', min: 0, max: 1, step: 0.01, value: 0.2,
      format: v => v.toFixed(2) },
    { id: 'wander', label: 'Centre range', type: 'range', min: 0, max: 0.4, step: 0.01, value: 0.25 },
    { id: 'drift', label: 'Centre speed', type: 'range', min: 0.02, max: 1, step: 0.01, value: 0.25 },
    { type: 'group', label: 'Fluid', open: false },
    { id: 'force', label: 'Push strength', type: 'range', min: 0, max: 4, step: 0.05, value: 1, format: v => `×${v.toFixed(2)}` },
    { id: 'viscosity', label: 'Viscosity', type: 'range', min: 0, max: 1, step: 0.01, value: 0.02 },
    { id: 'vorticity', label: 'Vorticity', type: 'range', min: 0, max: 40, step: 1, value: 6 },
    { id: 'grid', label: 'Grid cells', type: 'select', value: '512',
      options: [['256', '256'], ['384', '384'], ['512', '512']] },
    { type: 'group', label: 'Light', open: true },
    { id: 'view', label: 'View', type: 'select', value: '1',
      options: [['1', 'Lit relief'], ['0', 'Colour only'], ['4', 'Pressure']] },
    { id: 'relief', label: 'Relief height', type: 'range', min: 0, max: 4, step: 0.05, value: 1, visible: v => v.view === '1' },
    { id: 'elev', label: 'Light elevation', type: 'range', min: 5, max: 90, step: 1, value: 80,
      format: v => `${v}°`, visible: v => v.view === '1' },
  ],
});
