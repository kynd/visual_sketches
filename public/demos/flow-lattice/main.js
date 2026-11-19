// Noise lattice: spheres on a fixed cubic grid, each sized by a rising,
// curl-warped noise density. Nothing moves; the pattern flows through.
import { mountFlowDemo, methodSpec, speedSpec, range, shadowSpecs } from '../../js/particles/flow-demo.js';

const HALF = 1.0;

mountFlowDemo({
  title: 'Noise lattice',
  recordName: 'flow-lattice',
  mode: 'lattice',
  findMax: { id: 'side' },
  panel: [
    methodSpec(),
    { id: 'side', label: 'Grid size', type: 'range', min: 16, max: 128, step: 4, value: 56,
      format: v => `${v}³ = ${(v ** 3).toLocaleString()}` },
    range('fill', 'Sphere size', 0.2, 1.4, 0.01, 0.95),
    speedSpec(),
    range('threshold', 'Threshold', -1, 1, 0.01, 0.3),
    range('freq', 'Noise frequency', 0.3, 4, 0.05, 0.9),
    range('rise', 'Rise speed', 0, 1, 0.01, 0.15),
    range('warp', 'Warp', 0, 1.5, 0.01, 0.6),
    range('evolve', 'Field evolution', 0, 2, 0.01, 0.3),
    ...shadowSpecs(),
  ],
  layout: p => {
    const side = p.side;
    const spacing = 2 * HALF / side;
    return {
      n: side ** 3,
      maxRadius: 0.5 * spacing * p.fill,
      info: `${side}³ grid`,
      uniforms: {
        uSide: side, uHalf: HALF, uFill: p.fill, uThreshold: p.threshold,
        uFreq: p.freq, uRise: p.rise, uWarp: p.warp, uEvolve: p.evolve, uContain: 0,
      },
    };
  },
});
