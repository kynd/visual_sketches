// Colour flow: the same solver and pens as Watercolour drivers, but without
// paper, water or pigment. The whole frame is one coloured liquid, filled with
// a starting pattern and stirred by the pens. Clock and pens: js/fluid/fluid-demo.js.

import { mountFluidDemo, seededPalette, DRIVER_OPTIONS, BRUSH_OPTIONS } from '../../js/fluid/fluid-demo.js';
import { hash } from '../../js/fluid/drivers.js';

const PATTERNS = [['0', 'Stripes'], ['1', 'Rings'], ['2', 'Cells'], ['3', 'Marbled bands']];

mountFluidDemo({
  title: 'Colour flow',
  recordName: 'colour-flow',
  plain: true,
  resetOn: ['pattern', 'band'],
  onReset(p, sim) {
    const palette = seededPalette(p.seed);
    // Shuffle the entries so neighbouring bands differ in hue and lightness.
    const cols = palette.map((e, k) => [hash(p.seed, 700, k), e.rgb]).sort((a, b) => a[0] - b[0]).map(e => e[1]);
    const [ax, ay] = sim.domain;
    sim.fillPattern({
      pattern: +p.pattern, cols, scale: p.band,
      angle: hash(p.seed, 701) * Math.PI,
      centre: [ax * (0.3 + 0.4 * hash(p.seed, 702)), ay * (0.3 + 0.4 * hash(p.seed, 703))],
    });
    return palette;
  },
  brush: p => ({ colours: p.colours, ink: p.ink, vivid: false }),
  fluid: p => ({ sharp: p.advect === 'mac' }),
  view: p => ({ view: +p.view, relief: p.relief, lLow: p.lLow, lHigh: p.lHigh, baseColor: [0, 0, 0] }),
  panel: [
    { id: 'driver', label: 'Driver', type: 'select', value: 'loops', options: DRIVER_OPTIONS },
    { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 8, step: 1, value: 3 },
    { id: 'speed', label: 'Pen speed', type: 'range', min: 0.25, max: 3, step: 0.05, value: 1, format: v => `×${v.toFixed(2)}` },
    { id: 'brush', label: 'Brush', type: 'select', value: 'drag', options: BRUSH_OPTIONS },
    { id: 'size', label: 'Brush size', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1, format: v => `×${v.toFixed(2)}` },
    { id: 'colours', label: 'Pen colour', type: 'select', value: 'stroke',
      options: [['none', 'None (stir only)'], ['stroke', 'New per stroke'], ['pen', 'One per pen'], ['one', 'One for all']] },
    { id: 'ink', label: 'Ink amount', type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.6, visible: v => v.colours !== 'none' },
    { id: 'seed', label: 'Palette', type: 'range', min: 0, max: 99, step: 1, value: 1 },
    { id: 'pattern', label: 'Start pattern', type: 'select', value: '3', options: PATTERNS },
    { id: 'band', label: 'Band width', type: 'range', min: 0.02, max: 0.3, step: 0.01, value: 0.07 },
    { type: 'group', label: 'Fluid', open: false },
    { id: 'force', label: 'Push strength', type: 'range', min: 0, max: 4, step: 0.05, value: 1, format: v => `×${v.toFixed(2)}` },
    { id: 'viscosity', label: 'Viscosity', type: 'range', min: 0, max: 1, step: 0.01, value: 0.02 },
    { id: 'vorticity', label: 'Vorticity', type: 'range', min: 0, max: 40, step: 1, value: 6 },
    { id: 'advect', label: 'Advection', type: 'select', value: 'mac',
      options: [['mac', 'MacCormack'], ['linear', 'Semi-Lagrangian']] },
    { id: 'grid', label: 'Grid cells', type: 'select', value: '512',
      options: [['256', '256'], ['384', '384'], ['512', '512']] },
    { type: 'group', label: 'View', open: false },
    { id: 'view', label: 'View', type: 'select', value: '0', options: [
      ['0', 'Colour'], ['1', 'Lit colour'], ['2', 'Speed'], ['3', 'Vorticity'],
      ['4', 'Pressure'], ['6', 'Sky reflection']] },
    { id: 'relief', label: 'Relief height', type: 'range', min: 0, max: 4, step: 0.05, value: 1,
      visible: v => v.view === '1' || v.view === '6' },
    { id: 'lLow', label: 'Sky L, down', type: 'range', min: 0, max: 1, step: 0.01, value: 0.2, visible: v => v.view === '6' },
    { id: 'lHigh', label: 'Sky L, up', type: 'range', min: 0, max: 1, step: 0.01, value: 0.8, visible: v => v.view === '6' },
  ],
});
