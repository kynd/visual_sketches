// Watercolour drivers: math_sketches Fluid IV's watercolour solver, painted by
// automatic pens instead of the pointer. Clock and pens: js/fluid/fluid-demo.js.

import { mountFluidDemo, seededPalette, DRIVER_OPTIONS, BRUSH_OPTIONS } from '../../js/fluid/fluid-demo.js';
import { hash } from '../../js/fluid/drivers.js';

let paper = [1, 1, 1];

mountFluidDemo({
  title: 'Watercolour drivers',
  recordName: 'watercolour-drivers',
  unit: 'pigment',
  onReset(p) {
    const palette = seededPalette(p.seed);
    const light = palette.filter(e => e.L > 0.7);   // paper from the lightest steps
    paper = light[Math.floor(hash(p.seed, 999) * light.length)].rgb;
    return palette;
  },
  brush: p => ({ colours: p.colours }),
  fluid: p => ({ dryRate: p.dry }),
  view: p => ({ view: +p.view, baseColor: paper, relief: p.relief, lLow: p.lLow, lHigh: p.lHigh }),
  panel: [
    { id: 'driver', label: 'Driver', type: 'select', value: 'wander', options: DRIVER_OPTIONS },
    { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 8, step: 1, value: 3 },
    { id: 'speed', label: 'Pen speed', type: 'range', min: 0.25, max: 3, step: 0.05, value: 1, format: v => `×${v.toFixed(2)}` },
    { id: 'brush', label: 'Brush', type: 'select', value: 'drag', options: BRUSH_OPTIONS },
    { id: 'size', label: 'Brush size', type: 'range', min: 0.2, max: 3, step: 0.05, value: 0.5, format: v => `×${v.toFixed(2)}` },
    { id: 'colours', label: 'Colours', type: 'select', value: 'stroke',
      options: [['stroke', 'New per stroke'], ['pen', 'One per pen'], ['one', 'One for all']] },
    { id: 'seed', label: 'Palette', type: 'range', min: 0, max: 99, step: 1, value: 1 },
    { type: 'group', label: 'Fluid', open: false },
    { id: 'force', label: 'Push strength', type: 'range', min: 0, max: 4, step: 0.05, value: 1, format: v => `×${v.toFixed(2)}` },
    { id: 'viscosity', label: 'Viscosity', type: 'range', min: 0, max: 1, step: 0.01, value: 0.05 },
    { id: 'vorticity', label: 'Vorticity', type: 'range', min: 0, max: 40, step: 1, value: 0 },
    { id: 'dry', label: 'Drying rate', type: 'range', min: 0.02, max: 1, step: 0.01, value: 0.1, format: v => v.toFixed(2) },
    { id: 'grid', label: 'Grid cells', type: 'select', value: '512',
      options: [['256', '256'], ['384', '384'], ['512', '512']] },
    { type: 'group', label: 'View', open: false },
    { id: 'view', label: 'View', type: 'select', value: '0', options: [
      ['0', 'Paint'], ['1', 'Lit paint'], ['2', 'Speed'], ['3', 'Vorticity'],
      ['4', 'Pressure'], ['5', 'Water'], ['6', 'Sky reflection']] },
    { id: 'relief', label: 'Relief height', type: 'range', min: 0, max: 4, step: 0.05, value: 1,
      visible: v => v.view === '1' || v.view === '6' },
    { id: 'lLow', label: 'Sky L, down', type: 'range', min: 0, max: 1, step: 0.01, value: 0.2, visible: v => v.view === '6' },
    { id: 'lHigh', label: 'Sky L, up', type: 'range', min: 0, max: 1, step: 0.01, value: 0.8, visible: v => v.view === '6' },
  ],
});
