# Visual Sketches

A collection of small interactive studies in real-time graphics, built with Astro and WebGL2.

## Pages

- **Visual Sketches** — intro (placeholder)
- **Particle rendering** — how many lit spheres a GPU can draw per frame: impostor sprites vs. instanced quads vs. meshes, shadow maps, and opacity shadow maps
- **Noise flow** — shadow-mapped spheres moved by 3D noise: a curl-noise plume, streamline beads, flow on a sphere, and a noise lattice
- **Environment maps** — the plume lit by equirectangular environment maps: geom's OKLCH/CIELAB hue spheres, wrapped 2D fills and studio softboxes, plus procedural skies
- **Shape morphing** — morphs through up to five of geom's shapes, as particles projected onto each surface or as a ray-marched blend of distance fields

Every demo can record its canvas: realtime capture, or frame-accurate MP4 / PNG sequences rendered at an exact frame rate.

## Development

```bash
npm install
npm run dev -- --port 4330
```

Open `http://localhost:4330/visual_sketches/`.

`npm run build:prod` builds the static site into `dist/` without dev-only sketch pages.

See `documentation.md` for the technical reference.
