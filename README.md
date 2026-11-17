# Visual Sketches

A collection of small interactive studies in real-time graphics, built with Astro and WebGL2.

## Pages

- **Visual Sketches** — intro (placeholder)
- **Particle rendering** — how many lit spheres a GPU can draw per frame: impostor sprites vs. instanced quads vs. meshes, shadow maps, and opacity shadow maps

Every demo can record its canvas: realtime capture, or frame-accurate MP4 / PNG sequences rendered at an exact frame rate.

## Development

```bash
npm install
npm run dev -- --port 4330
```

Open `http://localhost:4330/visual_sketches/`.

`npm run build:prod` builds the static site into `dist/` without dev-only sketch pages.

See `documentation.md` for the technical reference.
