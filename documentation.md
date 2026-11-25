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
| Shapes | geom's SDF primitives (after Inigo Quilez), Platonic solids and implicit surfaces, in `shapes-glsl.js` |
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
│   │   ├── environment-maps.astro
│   │   ├── shape-morphing.astro
│   │   └── watercolour-fluid.astro
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
│   │   ├── env-sky/                     index.html, main.js
│   │   ├── shape-particles/             index.html, main.js
│   │   ├── shape-conveyor/              index.html, main.js
│   │   ├── shape-sdf/                   index.html, main.js
│   │   ├── watercolour-drivers/         index.html, main.js
│   │   ├── colour-flow/                 index.html, main.js
│   │   ├── fluid-relief/                index.html, main.js
│   │   └── relief-zoom/                 index.html, main.js
│   ├── js/
│   │   ├── demo-shell.js
│   │   ├── recorder.js
│   │   ├── fluid/
│   │   │   ├── fluid-glsl.js ← solver, splat, MacCormack, pattern and display shaders (GLSL ES 3.00)
│   │   │   ├── fluid-sim.js  ← FluidSim({ plain }): grids shaped to the canvas, step(), applySplats(), fillPattern(), display()
│   │   │   ├── fluid-demo.js ← mountFluidDemo(): shell + fixed-step clock + pens, shared by the three fluid demos
│   │   │   ├── drivers.js    ← DRIVERS (automatic pens), penSplats() brushes, hash()
│   │   │   └── palette.js    ← seeded OKLCH palette after draw's Palette Maker
│   │   └── particles/
│   │       ├── gl.js        ← Program wrapper, mat4, OrbitCamera, GpuTimer, icosphere
│   │       ├── glsl.js      ← particle uber-shader, ground and inset shaders
│   │       ├── scene.js     ← ParticleScene: program cache, uniforms, draw calls, light frustum
│   │       ├── flow-glsl.js ← noise-flow position pass: simplex noise + gradient, curl noise, 4 modes
│   │       ├── flow-demo.js ← mountFlowDemo(), positionTargets(gl, { normals }), shadowTargets()
│   │       ├── env-glsl.js  ← environment maps (equirect generation) + ENV_SHADING
│   │       ├── env-common.js ← Environment (map target + pass), SUN table, envSpecs()
│   │       ├── env-plume.js ← mountEnvParticles(kernel) / mountEnvPlume(): env → positions → sun shadow → env-lit spheres
│   │       ├── screen-blur.js ← ScreenBlur: offscreen target + blur that grows away from the frame centre
│   │       ├── shapes-glsl.js ← shapeSDF(): 23 shapes from geom (SDF, Platonic, implicit)
│   │       ├── shapes.js    ← SHAPES list, morphState() timeline, shapeSpecs()
│   │       └── shape-march.js ← mountShapeMarch(): ray-marched SDF morph with env lighting
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
  title: 'Impostor spheres',          // not drawn on the canvas (the page names the demo)
  recordName: 'particles-impostors',  // prefix for recorded file names
  render,                             // render(t): pure function of time
  findMax: { id: 'count' },           // optional: adds the Find max button for a range param
  panel: [ /* param specs */ ],
});
render(0);                            // poster frame
```

`mountShell` builds the control bar (UI, Find max, Record, play/pause, fps meter), the params panel (top left), the stats label (bottom left) and the message box, and returns:

| Field | Purpose |
|---|---|
| `shell.params.values` | live parameter values, keyed by spec `id` |
| `shell.params.set(id, v, silent?)` | set a value, update the UI, fire `onParam` + redraw unless `silent` |
| `shell.loop` | `Loop` — `play()`, `pause()`, `redraw()`, `time`, `setTime(t)`, `render(t)` |
| `shell.setStats(name, fn)` | the two-line stats label |
| `shell.message(text)` | centred message box (empty string hides it) |
| `shell.overlay` | `#overlay` element for demo-specific captions |

`window.demo` is set to the shell for console debugging.

**Layout.** No title is drawn on the canvas. `fitPanel()` keeps the params panel clear of the stats label: when one column would reach within 12 px of the label, the panel switches to a CSS grid with `grid-auto-flow: column` and as many rows per column as fit (rows get `min-height: 22px` so the columns line up). Columns stop short of the recorder panel (300 px kept free on the right); if that still isn't enough, the panel gets a `max-height` and scrolls. It runs on load, after web fonts load, on every parameter change, when a group opens or closes, and when the UI is shown.

**Canvas size.** The top bar's size select (`SIZES`: 1920×1080, 1080×1920, 1600×1200, 1200×1600, 1080×1080) sets the drawing buffer to that resolution; CSS scales the canvas to the largest rectangle of the same shape that fits the frame (`.canvas-wrap`, 1920×1080, or 960×540 embedded), centred. The embedded view therefore renders as many pixels as the full-size one. `?size=1080x1920` in the URL sets the start; `shell.setSize('1600x1200')` and `shell.size` work from code. `OrbitCamera` treats its fov as spanning the shorter side, so portrait views widen vertically instead of cropping. The panel and stats stay on the frame (`shell.frame`, i.e. `#overlay`); `shell.overlay` is `.canvas-layer`, a layer that tracks the canvas rectangle, for captions that belong to the image.

**UI toggle.** The *UI* button (or the H key, outside form fields) toggles `.ui-hidden` on `.canvas-wrap`: everything in `#overlay` except the message box is hidden, plus Find max and the fps meter (class `ui-hide`) and the bar's scrim. UI, Record and play/pause stay, and so does the recorder panel. `shell.setUi(bool)` sets it from code.

### Param specs

```js
{ id, label, type: 'range',  min, max, step, value, format?: v => string, visible?: values => bool }
{ id, label, type: 'select', value, options: [[value, label], ...], visible? }
{ id, label, type: 'toggle', value: bool, visible? }
{ type: 'group', label, open?: bool }   // collapsible header for the rows that follow
```

Select values are strings. A `group` spec starts a collapsible section that runs to the next group; collapsed rows are hidden like `visible: false` ones. `visible` hides rows that don't apply to the current settings (e.g. *Mesh detail* only for the mesh method).

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

- **Size**: frame-accurate modes record at the canvas resolution or at 2× on each side, resizing `canvas.width/height` for the recording and restoring them afterwards. `attachRecorder` returns `{ updateSizes }`, which the shell calls when the canvas size changes, to refresh the option labels. Demos must read canvas size every frame.
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
| `SURFACE_NORMAL` | with `POS_TEXTURE` + `ENV_LIGHTING`: read a per-particle normal from `uNrmTex` (same layout) and rotate the env lookup normal about `a × N` by `uSurfNormal` × the angle between the view direction `a` and `N`; shading uses `envShadeL(n, ln, rd, sh)` (sun/spec on `n`, env on `ln`) |
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

### Environment maps (`env-glsl.js`, `env-common.js`, `env-plume.js`)

`mountEnvParticles({ title, recordName, envs, defaults, kernel, closed })` — particles from any `flow-glsl.js` position kernel lit by an environment map. `kernel` = `{ mode, group, specs, count, radius, uniforms(p, time, ctx), info(p, time, ctx), bounds, ground, normals, blur }` (see the comment in `env-plume.js`); `normals: true` gives the position target a second RGBA16F attachment that `flowShaders(mode, { normals: true })` fills from the mode's `gNormal`, bound on unit 4 for `SURFACE_NORMAL`; `blur(p) → { radius, focus }` renders the camera pass into a `ScreenBlur` target (unit 3) and draws it back through a 48-tap golden-angle disc gather, radius `smoothstep(focus, 1, d)` × radius (d = distance from the centre, long edge = 1), mip level `log2(2r/√48)`; panel groups are Lighting, Particles, the kernel's group and Shadows, and `closed` lists those that start collapsed. `mountEnvPlume({ title, recordName, envs, defaults })` is the curl-noise plume kernel (Noise frequency 1.0, 24 steps). The map target, its pass, the `SUN` table and the lighting controls (`envSpecs`) live in `env-common.js` (`Environment.frame(p, t)` → sun + uniforms; `Environment.bind()` re-renders when needed and binds unit 2).

- **Map**: 2048×1024 `RGBA16F`, 12 mip levels, `REPEAT` in u. `envMapShaders()` renders environment `uEnv` per texel from `dirFromUv()`: `u = atan(z, x)/2π + ½`, `v = asin(y)/π + ½`. Re-rendered when the env or Sun strength changes, and every frame for animated envs; then `generateMipmap`. All lookups use `textureLod` (no seam at the atan wrap); *Blur* is the LOD.
- **Envs** (`ENV_LIST`): 0 studio softboxes, 1 OKLCH hue sphere, 2 CIELAB hue sphere (both: azimuth → hue, elevation → lightness, max in-gamut chroma by 20-step bisection, after geom's `oklch-envmap.js` / `lab-envmap.js`), 3 anisotropic wave, 4 drifting caustic (geom sound-fill modes 1 and 3, mirrored at u = ½, smooth per-band levels instead of FFT), 5 clear, 6 sunset, 7 cloudy (cloud layer at `d.xz/d.y`, 5-octave fbm, lit by a density difference toward the sun), 8 overcast (CIE `(1+2 sin θ)/3`), 9 night (hashed stars, Milky Way band, moon), 10 aurora (8 curtain layers across the default view direction), 11 underwater (Snell's window at cos 48.6°, ripples, shafts).
- **Land** (envs ≥ 5, below the horizon): `0.3·(env(zenith) + uSunCol·max(sun.y, 0))` under a haze band (0.06 rad; 0.6 under water). The ground plane uses the same formula with the zenith texel, then fades into the background, so they meet without a seam.
- **Sun**: `SUN` table in `env-common.js` — direction (env frame), colour, gain per env. *Rotation* turns the env (`uEnvRot`) and the sun together. `ParticleScene.setLight(dir, pts)` refits a square orthographic frustum around the floor corners and the plume's top corners every frame; bias adds `3·half/res`.
- **Shading** (`ENV_SHADING`): `E = envSample(normal or reflect(rd, n), uBlur)`, `a = mix(1, shadow, uOcclusion)`. Paint `E·(0.4a + 0.75·s·(n·l)·C)`, Light `0.8·(E·a + s·(n·l)·C)`, Mirror `0.9·E·a·(0.6 + 0.4(1−n·v)⁵)`, plus a Blinn-Phong sun highlight. Output: exposure → ACES (Narkowicz) → gamma.
- **Camera orbit**: `OrbitCamera.yawOffset` is set every frame to `2π·t / orbit` (0 when off) and added to the dragged yaw, so the orbit is a pure function of time.
- **Background toggle** (`bgSpec()`, id `bg`, above the panel groups in every env-lit demo): off sets `uBgMode = 3` — no background pass, clear alpha 0, the ground fades to transparent (premultiplied) and `envBackground()` returns black. These demos create their context with `createGL(canvas, { alpha: true })`, so PNG recordings carry alpha; MP4 shows black. The select formerly labelled Background is now *Backdrop* (Environment / Dimmed / Black).
- **Passes**: env (unit 2) → plume positions (unit 1) → sun depth (unit 0) → background (`backgroundShaders`, view ray from `uCamRot` + `uProj`) → ground (`envGroundShaders`) → spheres (`ENV_LIGHTING`) → optional env inset.

`shaderHead(defines, extra)` in `glsl.js` returns header + shared uniforms/functions for shaders outside the uber-shader.

### Shape morphing (`shapes-glsl.js`, `shapes.js`, `shape-march.js`)

- **Shapes** (`shapeSDF(id, p, t)`, shape space radius ≈ 0.9): 0–11 SDF primitives after geom `sdf-functions.glsl` (sphere, rounded box, box frame, torus, capped torus, link, hexagonal prism, capped cone, death star, cut hollow sphere, pyramid, rhombus); 12–15 Platonic solids after geom `platonic-functions.glsl` (tetra, octa, dodeca, icosa, scaled 0.9–0.95); 16–22 implicit surfaces after geom's scalar / moving scalar fields (gyroid sheet, Schwarz P, tanglecube at c = 11.8 ± 0.8, Chmutov T₄, harmonic sphere, pulsing torus, oscillating spheroid). Implicit distance = `f / |∇f|` (tetrahedral gradient, ε = 0.002); gyroid `|d| − 0.03`; gyroid and Schwarz P clipped by `|p| − 0.9`.
- **Placement**: `shapeToWorld(q, spin, tilt, scale)` = scale · Rx(tilt) · Ry(spin) · q; `worldToShape` inverts it.
- **Timeline** (`morphState(p, t)`): slots `shape1`–`shape5` (`-1` = None) in order, looping; each cycle = Hold + Morph; blend `s` = smootherstep `6x⁵ − 15x⁴ + 10x³`. Returns `{ a, b, mix, label }`.
- **Particle morph** (`flow-glsl.js` `morph` mode via `mountEnvParticles`): seed uniform in a ball of radius 1.1 (shape space); `project(id, seed)` = `uProject` steps of `q −= d ∇d/|∇d|`; position = `mix(projA, projB, s)` → world, plus `0.08 · uSwirl · sin(πs) · curlNoise`.
- **Morph conveyor** (`flow-glsl.js` `conveyor` mode, `conveyorState(p, t)` in `shapes.js`): particle `id` belongs to group `id mod 4`. At the hold of move `c`, group `g` is at place `m = ((g + c) mod 4) − 2` (−2 off-screen before, −1/0/1 visible with 0 at the centre, 2 off-screen after); during the move it is at `m + s` and blends shape `S[(k+1)c − k·m]` → the next one, `k` = Phase offset. World position = shape position + `uAxis · x · uSpacing`; `uAxis` = camera right (aspect ≥ 1) or camera down (portrait). World scale = 0.81 × Shape scale × min(1, h / h₁₆:₉) with `h` the view's half-length along the axis at the default distance; spacing = Shape spacing × h (independent of scale); the off-screen places sit `uOuter` = max(spacing, h + 1.05 · 1.1 · scale / cos a − spacing) beyond the side places, so a shape (bounding radius 1.1 in shape space) there is wholly outside the frustum (`a` = view half-angle along the axis); offset along the axis = `x · uSpacing` for |x| ≤ 1, else `sign(x) · (uSpacing + (|x| − 1) · uOuter)`. Groups parked off-screen during the hold skip projection. No swirl. The kernel also writes `gNormal` (normalised `shapeGrad`, mixed between the two shapes, rotated to world) for `SURFACE_NORMAL`, default turn ×2. Defaults: background and ground off, environment rotation 10°/s, Edge blur 12 px, Sharp radius 0.3. Kernel hooks used: `bounds(p, { aspect })`, `ground` (hidden on portrait), `uniforms/info(p, time, ctx)` with `ctx = { aspect, camRot }`, `normals`, `blur`. `Program.set` handles `ivec2–4` uniforms.
- **SDF morph** (`mountShapeMarch`): full-screen pass, `d = mix(dA, dB, s) · scale` in shape space; bounding sphere radius `1.3 · scale`; sphere tracing with 0.8 under-stepping, hit when `d < 0.0004 t`, up to *March steps*; tetrahedral normal (ε = 0.001); soft shadow `min(k·h/t)` over ≤ 64 steps toward the sun (skipped when the shadow ray misses the bounding sphere); 5-tap AO along the normal (×0.7 blend); ground plane at y = −1.25 with the same formula as `envGroundShaders`. Shading `envShade()` / `envOutput()`.
- **SDF rendering methods** (`uMethod`, after geom): 0 environment map (`envShade`, + `envSample(n) · sss`); 1 studio (geom `lighting.glsl`, key `KEY_LIGHT`, soft shadow from the key, + white sss); 2 rim light + SSS (geom `rim-lighting.glsl`: `|n·v|²·base + (0.92, 0.96, 1)·((1 − |n·v|)^p + sss·strength)`, no shadow); 3 flash light (geom flash-light: lights orbiting at 3.5 and 2.1 rad/s; brightness `max(f₁², 0.015)` and `f₂²` with `f = exp(−6·fract(t·rate + phase))`, rates `r` and `0.618r`). `sss = exp(−thickness · density) · strength`; thickness = interior march from the hit to the back face (≤ 48 steps), skipped when strength is 0 and the method isn't rim. Methods 1–3 output plain gamma like geom; the environment method uses `envOutput`. The ground uses the env formula for method 0 and geom's studio floor otherwise.

### GPU timing

`GpuTimer` wraps `EXT_disjoint_timer_query_webgl2` (`TIME_ELAPSED_EXT`), polls results non-blockingly and keeps an exponential moving average. Not all browsers expose it; the stats line says so.

---

## Watercolour fluid (`public/js/fluid/`)

Port of math_sketches Fluid IV (`navier-stokes-4`) from Three.js to raw WebGL2, with automatic pens in place of the pointer. Four demos share it through `mountFluidDemo(cfg)` (hooks: `onReset(p, sim) → palette`, `brush(p)`, `fluid(p)`, `view(p)`, `derive(g)`, `onStep(sim, p, step)`, `resetOn`, `warmup`): **Watercolour drivers** (watercolour mode), **Colour flow**, **Pressure relief** and **Relief zoom** (all `plain` mode).

- **Seed** (`fluid-demo.js`): `mountFluidDemo` puts a `type: 'seed'` row (integer field 0–999999 + Random button, in `demo-shell.js`) at the top of the panel. Initial value: `?seed=N` from the URL, else `Math.random()`. `seedDraws(seed)` gives `r()` = `hash(seed, 900, k++)`, `range(lo, hi, step)` and `pick(opts, weights)`; `deriveCommon` draws driver, pens, speed, brush and force, then `cfg.derive(g)` the demo's own settings, in a fixed order. On a seed change every derived value is set silently (`params.set(id, v, true)`) and the sheet resets. View, Grid cells, Advection and the Sky L sliders are never derived. The palette, pen paths and pattern placement use the seed directly. The stats label shows the seed.

- **Solver** (`FluidSim.step`): curl → vorticity confinement → 16 Jacobi viscosity sweeps (implicit) → velocity self-advection (dissipation 0.22) → divergence, pressure ×0.8 warm start, 32 Jacobi sweeps, gradient subtraction → wetness × e^(−k·dt) → paper stain → pigment advection gated by smoothstep(0.02, 0.18, wetness). Free-slip walls, DT = 1/60. Requires `EXT_color_buffer_float`.
- **Grids**: shaped to the canvas aspect. Domain units have the short side = 1; sim grid = `n` cells per unit (`Grid cells`, default 512 → 910×512 at 16:9), pigment/water/paper at 2n. Velocity in sim cells/s; pen push = 100 · v · force · n/512, viscosity × (n/512)². Formats: velocity RG32F, pressure/divergence R32F (NEAREST); curl, smoothed pressure R16F, water R16F, pigment and paper RGBA16F (LINEAR).
- **Splats**: batched, up to 48 per pass (`uA` = x, y, vx, vy; `uB` = rgb, radius scale; `uC` = water, pigment amount); three passes per batch: velocity (add, r² = 0.0016·scale), pigment (ordered mix, 0.0009), water (max, 0.0020).
- **Changes from Fluid IV**: paper stain and displayed pigment are weighted by pigment coverage (`dye.a`), so unpigmented water no longer darkens the paper; paper colour comes from palette entries with L > 0.7; grids follow the canvas instead of cropping a square.
- **Drivers** (`drivers.js`): pure functions of (seed, pen, driver time) → `null` (pen up) or `{ key, env, at(τ), tap? }`. Pen-down windows from `strokeWindow(P, dLo, dHi)`; random values from `hash(...)`; smooth paths from two-octave quintic value noise. Wander, Scribble, Loops (Fluid IV gusts), Lines, Taps, Handwriting (trochoid rows), Mixed (`DRIVERS.mixed`: per pen, a hashed choice of the other six every 6 s of driver time on a per-pen phase, pen up for the first 0.25 s; key = epoch·100003 + inner key so stroke colours stay distinct). Brushes: Drag, Parallel (5 heads), Splash (4 drops/step), Explode (16 rays every 7 steps).
- **Plain mode** (`new FluidSim(gl, { plain: true })`, Colour flow): no wetness, paper or drying; splats skip the water pass; the dye is advected everywhere with dissipation 0, by MacCormack (forward, backward with −dt, `φ̂ + ½(φ − φ̃)` clamped to the 4 source texels at the backward trace; two extra targets `dyeFwd`/`dyeBack`) or plain semi-Lagrangian (`Advection`). `fillPattern({ pattern, cols, scale, angle, centre })` fills the dye: 0 stripes, 1 rings, 2 jittered Voronoi cells (size 2.5·scale), 3 stripes displaced by three sines, 4 linear gradient from `cols[0]` to `cols[1]` along `angle` across the whole domain; colours are the 20 palette entries in seeded order, unbrightened (`vivid: false` in `penSplats`). Pens: `colours: 'none'` pushes only, `ink` scales the dye amount. Display `uPlain` shows the dye directly (view 0) and lights it in view 1. Derived ranges: brush ×0.6–1.6, ink 0.3–0.8, vorticity 2–14, viscosity 0–0.06, pattern (marbled bands weighted ×2), band width 0.04–0.15. Reset also on Start pattern and Band width.
- **Lit view light** (`display(w, h, { lightDir, lightNorm })`, view 1): diffuse 0.30 + 0.85·max(n·l, 0) divided by `lightNorm`, plus Blinn specular (exponent 48, ×0.40) and a Fresnel rim; n from the smoothed pressure height `squash(p, 220)·0.34·Relief`. Defaults keep Fluid IV's key light, normalize(0.45, 0.30, 0.75), and `lightNorm` 0.94. **Pressure relief** (`fluid-relief/`) fills pattern 4 (palette[0], hue 0 lightest, at the top; palette[7], hue 1 darkest, at the bottom), paints a new palette colour per stroke by default (`colours: 'stroke'`, ink 0.6), and lights from the top edge: l = (0, cos e, sin e) with e = Light elevation (default 80°) and `lightNorm` = 0.30 + 0.85 sin e, so flat areas show the gradient unchanged.
- **Relief zoom** (`relief-zoom/`, copy of Pressure relief): `onStep` (called before every solver step, warm-up included) calls `sim.setZoom(Zoom rate, c)`. `ADVECT` and `MACCORMACK` add `uZoomRate · (uv − uZoomCentre)` to the backtrace (uv units/s) for velocity self-advection and dye advection, which magnifies both by ≈ e^(rate·dt) per step; it is not in the velocity field, so projection never sees it. Pressure is not zoomed (warm start only); velocity magnitude is kept. Don't resample maps with a separate magnify pass: on the NEAREST velocity/pressure grids it duplicates fixed rows/columns every 1/(z−1) texels and leaves a grid of straight lines. Centre `c` per axis = clamp(0.5 + 1.5 · Centre range · `fbm(seed, 300 + axis, step·DT·Centre speed)`, 0.1, 0.9) (`fbm` exported from `drivers.js`). Derived: rate 0.08–0.35, range 0.1–0.35, speed 0.1–0.5.
- **Time** (`fluid-demo.js`): `render(t)` steps the sim to `floor(60t)`; the driver clock advances by DT × Pen speed per step. Going back in time, or changing Seed, Grid cells or canvas aspect, starts a fresh sheet painted for 180 warm-up steps (`cfg.warmup` overrides; Pressure relief uses 60). While playing, at most 4 steps per frame (the pens skip ahead beyond that); the recorder (loop paused) is never capped. Verified: frame-by-frame stepping and a single jump give identical pixels.

---

## Page conventions

- Pages are `.astro` files under `src/pages/` (or Markdown in `src/content/pages/`), wrapped in `PageLayout` with a `title` and `slug` matching the `navItems` entry.
- Structure per demo: `section.demo-section#id` → `.demo-header` (h2 + "open full size ↗") → `.demo-embed` iframe → `.prose` (explanation, `.subhead` for sub-topics, `.page-note` for details, `<details><summary>Controls</summary>` for UI).
- `.page-note` blocks start with `<strong>Label.</strong>` lead-ins; multiple labelled topics share one note, separated by `<br /><br />`.
- Math in `.astro`: `{"\\( … \\)"}` inline, `<div class="math-block">{"\\[ … \\]"}</div>` for display.

## Sketch pages

Sketch = in-progress work that runs in dev but is excluded from production. Add nav entries inside the `import.meta.env.DEV` block in `PageLayout.astro`, put pages under `src/pages/sketches/` and assets under `public/sketches/<name>/`. `npm run build:prod` removes `dist/sketches/` after building; the GitHub Actions workflow uses it.
