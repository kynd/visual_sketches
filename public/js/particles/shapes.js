// Shape list and morph timeline shared by the morphing demos. Ids match
// shapeSDF() in shapes-glsl.js.

import { range } from './flow-demo.js';

export const SHAPES = [
  // [id, label, family]
  [0, 'Sphere', 'SDF'], [1, 'Rounded box', 'SDF'], [2, 'Box frame', 'SDF'], [3, 'Torus', 'SDF'],
  [4, 'Capped torus', 'SDF'], [5, 'Link', 'SDF'], [6, 'Hexagonal prism', 'SDF'], [7, 'Capped cone', 'SDF'],
  [8, 'Death star', 'SDF'], [9, 'Cut hollow sphere', 'SDF'], [10, 'Pyramid', 'SDF'], [11, 'Rhombus', 'SDF'],
  [12, 'Tetrahedron', 'Platonic'], [13, 'Octahedron', 'Platonic'], [14, 'Dodecahedron', 'Platonic'], [15, 'Icosahedron', 'Platonic'],
  [16, 'Gyroid (pulsing)', 'Implicit'], [17, 'Schwarz P (sliding)', 'Implicit'], [18, 'Tanglecube', 'Implicit'],
  [19, 'Chmutov T₄', 'Implicit'], [20, 'Harmonic sphere', 'Implicit'], [21, 'Pulsing torus', 'Implicit'],
  [22, 'Oscillating spheroid', 'Implicit'],
];
const LABEL = Object.fromEntries(SHAPES.map(([id, label]) => [id, label]));

const DEFAULT_SLOTS = [3, 14, 16, 2, 20];   // torus, dodecahedron, gyroid, box frame, harmonic sphere

// Five shape slots (slots 2–5 can be empty), hold and morph durations,
// size and spin.
export function shapeSpecs() {
  const opts = SHAPES.map(([id, label]) => [String(id), label]);
  const slots = DEFAULT_SLOTS.map((id, i) => ({
    id: `shape${i + 1}`, label: `Shape ${i + 1}`, type: 'select', value: String(id),
    options: i === 0 ? opts : [['-1', 'None'], ...opts],
  }));
  return [
    ...slots,
    range('hold', 'Hold (s)', 0, 10, 0.1, 1.5, 1),
    range('morph', 'Morph (s)', 0.2, 10, 0.1, 2.5, 1),
    range('scale', 'Shape size', 0.5, 1.6, 0.01, 1.2),
    range('spin', 'Spin (°/s)', -90, 90, 1, 15, 0),
    range('tilt', 'Tilt (°)', -90, 90, 1, 25, 0),
  ];
}

// Which two shapes to blend at time t, and how far. Shapes are visited in
// slot order and loop; each holds for 'hold' seconds, then morphs into the
// next over 'morph' seconds with a smootherstep ease.
export function morphState(p, t) {
  const ids = [1, 2, 3, 4, 5].map(i => parseInt(p[`shape${i}`], 10)).filter(id => id >= 0);
  const n = ids.length;
  if (n < 2) return { a: ids[0], b: ids[0], mix: 0, label: LABEL[ids[0]] };
  const period = p.hold + p.morph;
  const c = Math.floor(t / period), u = t - c * period;
  const k = ((c % n) + n) % n;
  const a = ids[k], b = ids[(k + 1) % n];
  const x = u < p.hold ? 0 : Math.min(1, (u - p.hold) / p.morph);
  const mix = x * x * x * (x * (x * 6 - 15) + 10);
  const label = mix === 0 ? LABEL[a] : `${LABEL[a]} → ${LABEL[b]} ${Math.round(mix * 100)}%`;
  return { a, b, mix, label };
}
