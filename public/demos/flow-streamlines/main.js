// Streamline beads: particles strung along streamlines of a curl-noise field,
// sliding along them. Each bead traces its line from the seed every frame.
import { mountFlowDemo, methodSpec, countSpec, radiusSpec, speedSpec, range, shadowSpecs } from '../../js/particles/flow-demo.js';

mountFlowDemo({
  title: 'Streamline beads',
  recordName: 'flow-streamlines',
  mode: 'stream',
  panel: [
    methodSpec(),
    countSpec(16),
    radiusSpec(0.008),
    speedSpec(),
    { id: 'len', label: 'Beads per line', type: 'range', min: 8, max: 256, step: 8, value: 64, format: v => String(v) },
    range('spacing', 'Bead spacing', 0.004, 0.06, 0.001, 0.018, 3),
    range('along', 'Flow speed', 0, 1, 0.01, 0.15),
    range('freq', 'Noise frequency', 0.3, 4, 0.05, 1.1),
    range('evolve', 'Field evolution', 0, 2, 0.01, 0.12),
    range('contain', 'Containment', 0, 8, 0.1, 3, 1),
    ...shadowSpecs(),
  ],
  layout: p => {
    const lines = Math.max(1, Math.floor(Math.round(2 ** p.count) / p.len));
    return {
      n: lines * p.len,
      maxRadius: p.radius,
      info: `${lines.toLocaleString()} lines × ${p.len} beads`,
      uniforms: {
        uLineLen: p.len, uSpacing: p.spacing, uAlong: p.along, uFreq: p.freq,
        uEvolve: p.evolve, uContain: p.contain, uSize: p.radius,
      },
    };
  },
});
