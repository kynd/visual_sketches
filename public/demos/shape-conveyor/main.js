// Morph conveyor: two shapes stand side by side (top and bottom on a portrait
// canvas). At every morph the whole row moves one place — a shape enters, the
// first moves over while morphing into the next shape, the second leaves —
// with particles travelling in straight lines.
import { mountEnvParticles } from '../../js/particles/env-plume.js';
import { ALL_ENVS } from '../../js/particles/env-common.js';
import { shapeSpecs, conveyorState } from '../../js/particles/shapes.js';

const HALF_SHORT = 4.8 * Math.tan(20 * Math.PI / 180);   // half the view's shorter side at the default camera distance

// Station spacing and shape scale for the canvas shape: the stations sit at
// 40% of the half-width (or half-height) from the centre.
function layout(p, ctx) {
  const vertical = ctx.aspect < 1;
  const halfLong = HALF_SHORT * Math.max(ctx.aspect, 1 / ctx.aspect);
  const spacing = 0.8 * halfLong;
  const r = ctx.camRot;
  const axis = vertical ? [-r[3], -r[4], -r[5]] : [r[0], r[1], r[2]];   // screen down, or screen right
  return { vertical, spacing, axis, scale: p.scale * Math.min(1, spacing / 2.6) };
}

// The light frustum covers the floor and both directions the row can run.
const BOUNDS = [];
for (const x of [-4, 4]) for (const y of [-2.6, 2.6]) for (const z of [-4, 4]) BOUNDS.push([x, y, z]);

mountEnvParticles({
  title: 'Morph conveyor',
  recordName: 'shape-conveyor',
  envs: ALL_ENVS,
  defaults: { env: 'oklch', shading: '0', lookup: '0', exposure: 1.6, background: '1' },
  closed: ['Lighting', 'Particles', 'Shadows'],
  kernel: {
    mode: 'conveyor', group: 'Shapes',
    count: 17.5, radius: 0.006,
    bounds: BOUNDS,
    specs: [
      ...shapeSpecs({ slots: [16, 3, 14, 20, 8], scale: 0.85 }),   // gyroid, torus, dodecahedron, harmonic sphere, death star
      { id: 'phase', label: 'Phase offset', type: 'range', min: 1, max: 4, step: 1, value: 1, format: v => String(v) },
      { id: 'project', label: 'Projection steps', type: 'range', min: 1, max: 12, step: 1, value: 6, format: v => String(v) },
    ],
    ground: (p, ctx) => ctx.aspect >= 1,          // a vertical row would run through the floor
    uniforms: (p, time, ctx) => {
      const L = layout(p, ctx);
      const m = conveyorState(p, time);
      return {
        uGroupA: new Int32Array(m.A), uGroupB: new Int32Array(m.B), uGroupPos: new Float32Array(m.pos),
        uMix: m.mix, uAxis: new Float32Array(L.axis), uSpacing: L.spacing,
        uScale: L.scale, uSpin: time * p.spin * Math.PI / 180, uTilt: p.tilt * Math.PI / 180,
        uProject: p.project, uFreq: 1.2, uEvolve: 0.4,
      };
    },
    info: (p, time) => conveyorState(p, time).label,
  },
});
