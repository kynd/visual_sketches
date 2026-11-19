// The curl-noise plume under procedural skies. Each sky brings its own sun
// (or moon), which casts the shadows.
import { mountEnvPlume } from '../../js/particles/env-plume.js';

mountEnvPlume({
  title: 'Plume under the sky',
  recordName: 'env-sky',
  envs: ['clear', 'sunset', 'cloudy', 'overcast', 'night', 'aurora', 'underwater'],
  defaults: { env: 'sunset', shading: '1', lookup: '0', exposure: 1.0, background: '0' },
});
