// Particles projected onto shapes from the geom project, morphing from one
// to the next: each particle blends between its closest points on the two
// shapes, lifted by curl noise in between. Lit by the environment maps.
import { mountEnvParticles } from '../../js/particles/env-plume.js';
import { ALL_ENVS } from '../../js/particles/env-common.js';
import { shapeSpecs, morphState } from '../../js/particles/shapes.js';
import { range } from '../../js/particles/flow-demo.js';

mountEnvParticles({
  title: 'Particle morph',
  recordName: 'shape-particles',
  envs: ALL_ENVS,
  defaults: { env: 'oklch', shading: '0', lookup: '0', exposure: 1.6, background: '1' },
  closed: ['Lighting', 'Particles', 'Shadows'],
  kernel: {
    mode: 'morph', group: 'Shapes',
    count: 17, radius: 0.007,
    specs: [
      ...shapeSpecs(),
      range('swirl', 'Swirl', 0, 3, 0.05, 1),
      { id: 'project', label: 'Projection steps', type: 'range', min: 1, max: 12, step: 1, value: 6, format: v => String(v) },
    ],
    uniforms: (p, time) => {
      const m = morphState(p, time);
      return {
        uShapeA: m.a, uShapeB: m.b, uMix: m.mix,
        uScale: p.scale, uSpin: time * p.spin * Math.PI / 180, uTilt: p.tilt * Math.PI / 180,
        uSwirl: p.swirl, uProject: p.project, uFreq: 1.2, uEvolve: 0.4,
      };
    },
    info: (p, time) => morphState(p, time).label,
  },
});
