// Curl-noise plume: particles emitted from a disc on the floor rise with
// buoyancy and are stirred by divergence-free curl noise. Each frame replays
// every particle's life from its birth, so a frame depends only on the time.
import { mountFlowDemo, methodSpec, countSpec, radiusSpec, speedSpec, range, shadowSpecs } from '../../js/particles/flow-demo.js';

mountFlowDemo({
  title: 'Curl-noise plume',
  recordName: 'flow-plume',
  mode: 'plume',
  panel: [
    methodSpec(),
    countSpec(17),
    radiusSpec(0.008),
    speedSpec(),
    range('flow', 'Turbulence', 0, 1.5, 0.01, 0.3),
    range('rise', 'Rise speed', 0, 1, 0.01, 0.36),
    range('freq', 'Noise frequency', 0.3, 4, 0.05, 1.0),
    range('evolve', 'Field evolution', 0, 2, 0.01, 0.12),
    range('life', 'Lifetime (s)', 1, 10, 0.1, 4.5, 1),
    { id: 'steps', label: 'Steps per life', type: 'range', min: 4, max: 64, step: 1, value: 24, format: v => String(v) },
    ...shadowSpecs(),
  ],
  layout: p => ({
    n: Math.round(2 ** p.count),
    maxRadius: p.radius,
    info: `${p.steps} RK2 steps per life`,
    uniforms: {
      uFlow: p.flow, uRise: p.rise, uFreq: p.freq, uEvolve: p.evolve,
      uLife: p.life, uSteps: p.steps, uSize: p.radius, uEmitR: 0.3, uContain: 0.25,
    },
  }),
});
