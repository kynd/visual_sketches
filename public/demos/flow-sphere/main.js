// Flow on a sphere: particles confined to a unit sphere, driven by a mix of
// the noise gradient (gather toward peaks) and its rotation (swirl around them).
import { mountFlowDemo, methodSpec, countSpec, radiusSpec, speedSpec, range, shadowSpecs } from '../../js/particles/flow-demo.js';

mountFlowDemo({
  title: 'Flow on a sphere',
  recordName: 'flow-sphere',
  mode: 'surface',
  panel: [
    methodSpec(),
    countSpec(17),
    radiusSpec(0.006),
    speedSpec(),
    range('flow', 'Flow strength', 0, 1, 0.01, 0.3),
    range('gather', 'Gather', 0, 2, 0.01, 0.7),
    range('freq', 'Noise frequency', 0.3, 5, 0.05, 1.4),
    range('evolve', 'Field evolution', 0, 2, 0.01, 0.15),
    range('life', 'Lifetime (s)', 1, 10, 0.1, 6, 1),
    { id: 'steps', label: 'Steps per life', type: 'range', min: 4, max: 64, step: 1, value: 36, format: v => String(v) },
    { id: 'core', label: 'Solid core', type: 'toggle', value: true },
    ...shadowSpecs(),
  ],
  layout: p => ({
    n: Math.round(2 ** p.count),
    maxRadius: p.radius,
    coreR: p.core ? 0.985 : 0,
    info: `${p.steps} RK2 steps per life`,
    uniforms: {
      uFlow: p.flow, uGather: p.gather, uFreq: p.freq, uEvolve: p.evolve,
      uLife: p.life, uSteps: p.steps, uSize: p.radius,
    },
  }),
});
