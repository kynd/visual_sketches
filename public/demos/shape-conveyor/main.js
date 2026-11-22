// Morph conveyor: two shapes stand side by side (top and bottom on a portrait
// canvas). At every morph the whole row moves one place — a shape enters, the
// first moves over while morphing into the next shape, the second leaves —
// with particles travelling in straight lines.
import { mountEnvParticles } from '../../js/particles/env-plume.js';
import { ALL_ENVS } from '../../js/particles/env-common.js';
import { shapeSpecs, conveyorState } from '../../js/particles/shapes.js';

const BASE_SIZE = 0.85;   // world size at Shape scale ×1
const CAM_DIST = 4.8;     // default camera distance
const HALF_SHORT = CAM_DIST * Math.tan(20 * Math.PI / 180);   // half the view's shorter side at that distance
const SHAPE_R = 1.1;      // shape-space radius every particle stays within (the seed ball)

// Station spacing and shape scale for the canvas shape. The stations sit at
// least 40% of the half-width (or half-height) from the centre; the off-screen
// places are 1.5 spacings out, and the spacing grows until a shape there is
// wholly outside the view: the distance from its bounding ball's centre to the
// side plane of the view frustum, cos a · (X − halfLong), must exceed its radius.
function layout(p, aspect) {
  const halfLong = HALF_SHORT * Math.max(aspect, 1 / aspect);
  const base = 0.8 * halfLong;
  const scale = BASE_SIZE * p.scale * Math.min(1, base / 2.6);
  const cosA = 1 / Math.hypot(1, halfLong / CAM_DIST);
  const spacing = Math.max(base, (halfLong + 1.05 * SHAPE_R * scale / cosA) / 1.5);
  return { spacing, scale };
}

// The light frustum covers the floor and the whole row, which can run along
// any horizontal direction (camera right) or vertically (portrait).
function bounds(p, { aspect }) {
  const { spacing, scale } = layout(p, aspect);
  const e = 1.5 * spacing + SHAPE_R * scale;
  const pts = [];
  for (const x of [-e, e]) for (const y of [-e, e]) for (const z of [-e, e]) pts.push([x, y, z]);
  for (const x of [-4, 4]) for (const z of [-4, 4]) pts.push([x, -1.25, z]);
  return pts;
}

mountEnvParticles({
  title: 'Morph conveyor',
  recordName: 'shape-conveyor',
  envs: ALL_ENVS,
  defaults: { env: 'oklch', shading: '0', lookup: '0', exposure: 1.6, background: '1', rotation: 10, bg: false, ground: false },
  closed: ['Lighting', 'Particles', 'Shadows'],
  kernel: {
    mode: 'conveyor', group: 'Shapes',
    count: 17.5, radius: 0.006,
    bounds,
    specs: [
      { id: 'scale', label: 'Shape scale', type: 'range', min: 0.25, max: 3, step: 0.05, value: 1.5, format: v => `×${v.toFixed(2)}` },
      // gyroid, torus, dodecahedron, harmonic sphere, death star; Shape scale above replaces the shared Shape size
      ...shapeSpecs({ slots: [16, 3, 14, 20, 8] }).filter(s => s.id !== 'scale'),
      { id: 'phase', label: 'Phase offset', type: 'range', min: 1, max: 4, step: 1, value: 1, format: v => String(v) },
      { id: 'project', label: 'Projection steps', type: 'range', min: 1, max: 12, step: 1, value: 6, format: v => String(v) },
    ],
    ground: (p, ctx) => ctx.aspect >= 1,          // a vertical row would run through the floor
    uniforms: (p, time, ctx) => {
      const L = layout(p, ctx.aspect);
      const r = ctx.camRot;
      const axis = ctx.aspect < 1 ? [-r[3], -r[4], -r[5]] : [r[0], r[1], r[2]];   // screen down, or screen right
      const m = conveyorState(p, time);
      return {
        uGroupA: new Int32Array(m.A), uGroupB: new Int32Array(m.B), uGroupPos: new Float32Array(m.pos),
        uMix: m.mix, uAxis: new Float32Array(axis), uSpacing: L.spacing,
        uScale: L.scale, uSpin: time * p.spin * Math.PI / 180, uTilt: p.tilt * Math.PI / 180,
        uProject: p.project, uFreq: 1.2, uEvolve: 0.4,
      };
    },
    info: (p, time) => conveyorState(p, time).label,
  },
});
