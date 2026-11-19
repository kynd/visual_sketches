// The curl-noise plume shaded with environment maps carried over from geom:
// OKLCH and CIELAB hue spheres, two 2D fills wrapped around the scene, and
// the studio light rig as softboxes.
import { mountEnvPlume } from '../../js/particles/env-plume.js';

mountEnvPlume({
  title: 'Plume in geom environments',
  recordName: 'env-geom',
  envs: ['oklch', 'lab', 'wave', 'caustic', 'studio'],
  defaults: { env: 'oklch', shading: '0', lookup: '0', exposure: 1.6, background: '1' },
});
