// Ray-marched morph between shapes from the geom project: the scene is
// mix(dA, dB, s) of two signed distance fields, lit by the environment maps.
import { mountShapeMarch } from '../../js/particles/shape-march.js';

mountShapeMarch({
  title: 'SDF morph',
  recordName: 'shape-sdf',
  defaults: { env: 'oklch', shading: '0', lookup: '0', exposure: 1.6, background: '1' },
});
