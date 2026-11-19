# Visual Sketches — Technical Reference

A collection of small interactive studies in real-time graphics. Each page takes one question — how to draw something, how fast it can go, what it costs — and answers it with demos that run in the browser. See `writing-style-guide.md` for prose conventions.

---

## Stack

| Layer | Choice |
|---|---|
| Site framework | Astro 4.x, `output: 'static'`, base `/visual_sketches` |
| Graphics | WebGL2 (raw, GLSL ES 3.00) for particle demos; Three.js `0.169.0` via importmap allowed |
| Video | WebCodecs `VideoEncoder` + `mp4-muxer@5.2.1`; `fflate@0.8.2` for PNG zips; `MediaRecorder` for realtime |
| Noise | Simplex noise with analytic gradient from webgl-noise (Gustavson & McEwan, MIT), inlined in `flow-glsl.js` |
| Environment maps | Procedural equirectangular maps, ideas from geom (`oklch-envmap.js`, `lab-envmap.js`, sound-fill) |
| Fonts | `Lora` / `Sora` + `Google Sans Code` via Google Fonts |
| Math rendering | KaTeX `0.16.11` via CDN |

---

## Directory layout

```
/
├── src/
│   ├── pages/
│   │   ├── index.astro              ← renders content/pages/index.md
│   │   ├── [...slug].astro          ← renders other content-collection pages
│   │   ├── particle-rendering.astro
│   │   ├── noise-flow.astro
│   │   └── environment-maps.astro
│   ├── content/pages/index.md       ← intro page (placeholder)
│   └── layouts/PageLayout.astro
│
├── public/
│   ├── demos/
│   │   ├── particles-impostors/         index.html, main.js
│   │   ├── particles-shadow-map/        index.html, main.js
│   │   ├── particles-opacity-shadows/   index.html, main.js
│   │   ├── flow-plume/                  index.html, main.js
│   │   ├── flow-streamlines/            index.html, main.js
│   │   ├── flow-sphere/                 index.html, main.js
│   │   ├── flow-lattice/                index.html, main.js
│   │   ├── env-geom/                    index.html, main.js
│   │   └── env-sky/                     index.html, main.js
│   ├── js/
│   │   ├── demo-shell.js
│   │   ├── recorder.js
│   │   └── particles/
│   │       ├── gl.js        ← Program wrapper, mat4, OrbitCamera, GpuTimer, icosphere
│   │       ├── glsl.js      ← particle uber-shader, ground and inset shaders
│   │       ├── scene.js     ← ParticleScene: program cache, uniforms, draw calls, light frustum
│   │       ├── flow-glsl.js ← noise-flow position pass: simplex noise + gradient, curl noise, 4 modes
│   │       ├── flow-demo.js ← mountFlowDemo(), positionTargets(), shadowTargets()
│   │       ├── env-glsl.js  ← environment maps (equirect generation) + ENV_SHADING
│   │       └── env-plume.js ← mountEnvPlume(): env pass → plume → sun shadow → env-lit camera pass
│   └── styles/demo-ui.css
│
├── CLAUDE.md
├── documentation.md        ← this file
└── writing-style-guide.md
```

Demo folder names are kebab-case, no numeric prefix, and match the display name.

---

## Demo shell (`public/js/demo-shell.js`)

Each demo's `index.html` contains only the canvas inside `.canvas-wrap`, the `?embedded` resize script, and `main.js`. `main.js` calls:

```js
shell = mountShell({
  title: 'Impostor spheres',          // shown in the control bar
  recordName: 'particles-impostors',  // prefix for recorded file names
  render,                             // render(t): pure function of time
  findMax: { id: 'count' },           // optional: adds the Find max button for a range param
  panel: [ /* param specs */ ],
});
render(0);                            // poster frame
```

`mountShell` builds the control bar (title, Find max, Record, play/pause, fps meter), the params panel (top left), the stats label (bottom left) and the message box, and returns:

| Field | Purpose |
|---|---|
| `shell.params.values` | live parameter values, keyed by spec `id` |
| `shell.params.set(id, v, silent?)` | set a value, update the UI, fire `onParam` + redraw unless `silent` |
| `shell.loop` | `Loop` — `play()`, `pause()`, `redraw()`, `time`, `setTime(t)`, `render(t)` |
| `shell.setStats(name, fn)` | the two-line stats label |
| `shell.message(text)` | centred message box (empty string hides it) |
| `shell.overlay` | `#overlay` element for demo-specific captions |

`window.demo` is set to the shell for console debugging.

### Param specs

```js
{ id, label, type: 'range',  min, max, step, value, format?: v => string, visible?: values => bool }
{ id, label, type: 'select', value, options: [[value, label], ...], visible? }
{ id, label, type: 'toggle', value: bool, visible? }
```

Select values are strings. `visible` hides rows that don't apply to the current settings (e.g. *Mesh detail* only for the mesh method).

### Loop and timing

The loop follows geom's play/pause pattern: `play()` records `start = performance.now()` and starts rAF; `pause()` accumulates `pausedAt`; frame time is `pausedAt + (now - start) * 0.001`. The fps meter averages over 0.5 s windows. **Find max** starts playback and raises the target range parameter by one `step` per window while fps ≥ 55, skipping one window after each change to let it settle; on the first window below, it steps back once and stops.

---

## Recorder (`public/js/recorder.js`)

Attached to every demo by `mountShell`. The **Record** button toggles a panel (top right).

| Mode | How it works | When to use |
|---|---|---|
| Frame-accurate MP4 | Pauses the loop, then for `n = 0 … duration·fps − 1`: `render(t0 + n/fps)`, `new VideoFrame(canvas, { timestamp: n·1e6/fps })`, `VideoEncoder.encode()`; muxes with `mp4-muxer` (`fastStart: 'in-memory'`). Keyframe every 2 s. Backpressure: waits while `encodeQueueSize > 6`. | Default. Exact frame timing regardless of render speed. |
| Frame-accurate PNG (.zip) | Same stepping; each frame is copied to a 2D canvas (the WebGL drawing buffer is cleared after the task) and saved as PNG into a streaming `fflate` `Zip` with `ZipPassThrough` (no recompression). | Lossless frames for compositing. Large: the zip lives in memory until saved. |
| Realtime | `canvas.captureStream(fps)` → `MediaRecorder` (MP4/H.264 when supported, else WebM). Plays the demo; stops at *Duration* or on Stop. | Quick capture of interactive sessions (camera drags, param tweaks). Frames drop/duplicate if rendering is slow. |

- **Size**: frame-accurate modes can set `canvas.width/height` to 1920×1080 or 3840×2160 for the recording and restore afterwards. Demos must read canvas size every frame.
- **Codec**: tries H.264 High profile levels 5.2 → 4.0, then Main/Baseline, via `VideoEncoder.isConfigSupported`.
- Only the WebGL canvas is captured — no HTML overlay.
- Libraries are loaded with dynamic `import()` from jsDelivr on first use.

---

## Particle engine (`public/js/particles/`)

### Zero-buffer particles

Particle positions are computed in the vertex shader from the particle index (`gl_VertexID` for points, `gl_InstanceID` for instanced draws) and `uTime`. A PCG hash turns the index into four random numbers; `particlePos(id)` places the particle in one of three formations (`uFormation`): 0 cloud (exponential radial falloff, differential rotation), 1 ring (twisting torus), 2 sheet (grid with travelling waves). No vertex buffers are needed for points and quads — draws bind an empty VAO. Count range: 2¹⁰ – 2²⁴ (log₂ slider in half-octave steps).

### Uber-shader defines (`glsl.js`)

`particleShaders(defines)` assembles one source with these switches:

| Define | Meaning |
|---|---|
| `METHOD_POINTS` | `gl.POINTS`, one vertex per particle, `gl_PointSize` from projected radius, clamped to `ALIASED_POINT_SIZE_RANGE` |
| `METHOD_BILLBOARD` | `drawArraysInstanced(TRIANGLE_STRIP, 0, 4, N)`, view-aligned quad, corners from `gl_VertexID` |
| `METHOD_MESH` | `drawElementsInstanced` of an icosphere (subdivision 0–3 → 20–1280 triangles), capped at 2²¹ instances |
| `PASS_CAMERA` | shaded camera pass |
| `PASS_SHADOW_DEPTH` | light-view depth-only pass (points, flat disc at centre depth, no `gl_FragDepth`) |
| `PASS_OPACITY` | light-view coverage splat into 16 slices (4 MRT outputs) |
| `EXACT_DEPTH` | impostors write `gl_FragDepth` from the reconstructed sphere point (disables early-Z) |
| `SHADOW_MAP_PIXEL` / `SHADOW_MAP_PARTICLE` | shadow-map lookup in the fragment / vertex shader |
| `OPACITY_SHADOW` | per-particle opacity-map lookup in the vertex shader |
| `POS_TEXTURE` | read centre (xyz) and radius (w) from `uPosTex` (RGBA32F, width `uPosW`) at texel `id + uIdOffset` instead of `particlePos()`; radius ≤ 0 clips the particle away |
| `ENV_LIGHTING` | shade with `envShade()` / `envOutput()` from `env-glsl.js`; pass `ENV_SHADING` as `particleShaders(defines, extra)` |
| `ALBEDO <v>` | replace the 0.88 material with `<v>` (same lights) — used for the dark core in *Flow on a sphere* |

`PASS_SHADOW_DEPTH` also works with `METHOD_BILLBOARD` (quad expanded in light space) for spheres too large for `gl_PointSize`. The radius is passed to the fragment shader as `flat vRad`, so it may vary per particle.

`ParticleScene.program(defines, kind)` caches compiled programs by define list. `Program.set()` / `setAll()` silently skip uniforms that a variant doesn't use.

### Impostor shading

Sprite coordinate `q ∈ [-1,1]²` → discard if `|q| > 1` → view-space normal `(q, √(1−|q|²))` → world normal via `uCamRot` (camera-to-world mat3). Surface point `pV = centre + n·r` (used for exact depth and per-pixel shadow lookups).

### Lighting

`stdLighting(nor, rd, sh)` reproduces geom's studio look; `sh` scales the key diffuse and specular only:

| Element | Value |
|---|---|
| Material | `vec3(0.88)` |
| Ambient | `0.13` |
| Key light dir | `normalize(vec3(0.6, 1.0, 0.7))` (also the shadow-casting light, `KEY_LIGHT` in JS) |
| Key diffuse | `0.84` |
| Fill light dir / coeff | `normalize(vec3(-0.8, 0.3, 0.5))` / `0.28` |
| Specular | `vec3(0.40)`, power `72` |
| Fresnel rim | `vec3(0.12, 0.18, 0.38) × 0.6`, power `4` |
| Gamma | `pow(col, vec3(0.4545))` at the end of the fragment shader |

Ground: plane at `y = −1.25`, half-size 4, material 0.55, faded to black toward the edge. The default camera (yaw 2.3) sits away from the fill light so shadowed particles stay visibly darker.

### Light frustum

Orthographic, eye at `KEY_LIGHT × 5` looking at the origin, half-width 2.2, near 0.5, far 12. Opacity slices span light distance `5 ± 2.2` in 16 steps of 0.275.

### Shadow map demo

`DEPTH_COMPONENT24` texture, `COMPARE_REF_TO_TEXTURE` + `LINEAR` (hardware 2×2 PCF per tap), sampled through `sampler2DShadow`. PCF radius 0/1/2 → 1/9/25 taps. Bias `(0.6·r + 0.004) / (far − near)`. The debug inset temporarily switches the texture to `COMPARE_MODE NONE` + `NEAREST` (24-bit depth isn't linearly filterable without comparison).

### Opacity shadow map demo

Four `RGBA32F` targets (when `EXT_float_blend` + `OES_texture_float_linear` exist, else `RGBA16F`; requires `EXT_color_buffer_float`), additive blending, no depth test. Slice `k` (1…16) accumulates coverage of every particle with slice coordinate `f ≤ k`. Coverage per particle: `π d²/4` for diameter `d < 1` texel, else 1 per covered texel. Lookup interpolates the two bracketing slices with a one-slice lag toward the light (avoids self-shadowing); transmittance `exp(−k·c)`.

### Noise flow (`flow-glsl.js`, `flow-demo.js`)

`mountFlowDemo({ title, recordName, mode, panel, layout, findMax })` builds a whole demo. `layout(values)` returns `{ n, maxRadius, coreR?, uniforms, info }`. Each frame:

1. **Position pass** — full-screen quad into an RGBA32F texture `1024 × ceil((n+1)/1024)`; the fragment for particle `i` writes `vec4(centre, radius)`. Texel `n` holds the optional core sphere (`uCoreR`). Requires `EXT_color_buffer_float`.
2. **Light pass** — `METHOD_POINTS + PASS_SHADOW_DEPTH + POS_TEXTURE`; the core (if any) is a one-instance billboard with `uIdOffset = n`.
3. **Camera pass** — ground, then `METHOD_* + PASS_CAMERA + SHADOW_MAP_PIXEL + POS_TEXTURE`; the core adds `EXACT_DEPTH` and `ALBEDO 0.16`.

Two `GpuTimer`s split GPU time into *flow* (pass 1) and *shading* (passes 2–3).

Noise: webgl-noise `snoise(vec3, out grad)` (analytic gradient). `curlNoise(p, t)` = curl of three offset potentials, each drifting in its own direction at `uEvolve`.

| Mode | Kernel |
|---|---|
| `plume` | Emitter disc on the floor (`uEmitR`), `v = uFlow·curl + (0, uRise, 0) − p.xz·uContain`. Lifetime `uLife × [0.7, 1.3]`, random phase; the life counter seeds the spawn point. Replays the life from birth with fixed step `h = life/uSteps` (RK2 midpoint, last step partial) so the path is identical every frame. |
| `stream` | Line = `id / uLineLen`, bead `k = id % uLineLen`. Seed uniform in a ball of radius 1.05. Traces `k + fract(uTime·uAlong/uSpacing)` steps of length `uSpacing` along the unit direction of `curl + containVel(p, 1)` (field frozen at `uTime`). Ends taper. Cost O(L²) per line. |
| `surface` | Unit sphere; scalar noise (2 octaves) gradient `g` projected to the tangent plane; `v = uFlow·(n × g + uGather·g)`; renormalized after each step. Lifetimes as in `plume`; fade in over the first 35% of life. |
| `lattice` | `uSide³` grid in a cube of half-size `uHalf`; radius `½·spacing·uFill·smoothstep(uThreshold, +0.35, ρ)`, with ρ two noise octaves sampled at `p + uWarp·curl/4 − uRise·t·ŷ`. |

### Environment maps (`env-glsl.js`, `env-plume.js`)

`mountEnvPlume({ title, recordName, envs, defaults })` — the curl-noise plume (`flow-glsl.js` `plume` mode, Noise frequency 1.0, 24 steps) lit by an environment map.

- **Map**: 2048×1024 `RGBA16F`, 12 mip levels, `REPEAT` in u. `envMapShaders()` renders environment `uEnv` per texel from `dirFromUv()`: `u = atan(z, x)/2π + ½`, `v = asin(y)/π + ½`. Re-rendered when the env or Sun strength changes, and every frame for animated envs; then `generateMipmap`. All lookups use `textureLod` (no seam at the atan wrap); *Blur* is the LOD.
- **Envs** (`ENV_LIST`): 0 studio softboxes, 1 OKLCH hue sphere, 2 CIELAB hue sphere (both: azimuth → hue, elevation → lightness, max in-gamut chroma by 20-step bisection, after geom's `oklch-envmap.js` / `lab-envmap.js`), 3 anisotropic wave, 4 drifting caustic (geom sound-fill modes 1 and 3, mirrored at u = ½, smooth per-band levels instead of FFT), 5 clear, 6 sunset, 7 cloudy (cloud layer at `d.xz/d.y`, 5-octave fbm, lit by a density difference toward the sun), 8 overcast (CIE `(1+2 sin θ)/3`), 9 night (hashed stars, Milky Way band, moon), 10 aurora (8 curtain layers across the default view direction), 11 underwater (Snell's window at cos 48.6°, ripples, shafts).
- **Land** (envs ≥ 5, below the horizon): `0.3·(env(zenith) + uSunCol·max(sun.y, 0))` under a haze band (0.06 rad; 0.6 under water). The ground plane uses the same formula with the zenith texel, then fades into the background, so they meet without a seam.
- **Sun**: `SUN` table in `env-plume.js` — direction (env frame), colour, gain per env. *Rotation* turns the env (`uEnvRot`) and the sun together. `ParticleScene.setLight(dir, pts)` refits a square orthographic frustum around the floor corners and the plume's top corners every frame; bias adds `3·half/res`.
- **Shading** (`ENV_SHADING`): `E = envSample(normal or reflect(rd, n), uBlur)`, `a = mix(1, shadow, uOcclusion)`. Paint `E·(0.4a + 0.75·s·(n·l)·C)`, Light `0.8·(E·a + s·(n·l)·C)`, Mirror `0.9·E·a·(0.6 + 0.4(1−n·v)⁵)`, plus a Blinn-Phong sun highlight. Output: exposure → ACES (Narkowicz) → gamma.
- **Passes**: env (unit 2) → plume positions (unit 1) → sun depth (unit 0) → background (`backgroundShaders`, view ray from `uCamRot` + `uProj`) → ground (`envGroundShaders`) → spheres (`ENV_LIGHTING`) → optional env inset.

`shaderHead(defines, extra)` in `glsl.js` returns header + shared uniforms/functions for shaders outside the uber-shader.

### GPU timing

`GpuTimer` wraps `EXT_disjoint_timer_query_webgl2` (`TIME_ELAPSED_EXT`), polls results non-blockingly and keeps an exponential moving average. Not all browsers expose it; the stats line says so.

---

## Page conventions

- Pages are `.astro` files under `src/pages/` (or Markdown in `src/content/pages/`), wrapped in `PageLayout` with a `title` and `slug` matching the `navItems` entry.
- Structure per demo: `section.demo-section#id` → `.demo-header` (h2 + "open full size ↗") → `.demo-embed` iframe → `.prose` (explanation, `.subhead` for sub-topics, `.page-note` for details, `<details><summary>Controls</summary>` for UI).
- `.page-note` blocks start with `<strong>Label.</strong>` lead-ins; multiple labelled topics share one note, separated by `<br /><br />`.
- Math in `.astro`: `{"\\( … \\)"}` inline, `<div class="math-block">{"\\[ … \\]"}</div>` for display.

## Sketch pages

Sketch = in-progress work that runs in dev but is excluded from production. Add nav entries inside the `import.meta.env.DEV` block in `PageLayout.astro`, put pages under `src/pages/sketches/` and assets under `public/sketches/<name>/`. `npm run build:prod` removes `dist/sketches/` after building; the GitHub Actions workflow uses it.
