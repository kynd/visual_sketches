// OKLCH palette for the watercolour demo, after the Palette Maker in the draw
// project (Palette.js + color.js, as copied into math_sketches Fluid IV):
// a few hues, each expanded into several lightness steps with the most vivid
// lightness snapped onto a step. Seeded instead of Math.random().

export function oklchToLinear(L, C, Hdeg) {
  const h = Hdeg * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function inGamut(L, C, H) {
  return oklchToLinear(L, C, H).every(v => v >= -5e-4 && v <= 1.0005);
}

function maxChromaAt(L, H) {
  if (!inGamut(L, 0, H)) return 0;
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(L, mid, H)) lo = mid; else hi = mid; }
  return lo;
}

function mostVibrantL(H) {
  let bestL = 0.5, bestC = 0;
  for (let i = 0; i <= 60; i++) {
    const L = 0.05 + i * 0.9 / 60, C = maxChromaAt(L, H);
    if (C > bestC) { bestC = C; bestL = L; }
  }
  return bestL;
}

function lightnessSteps(H, N, hi, lo) {
  const vibL = mostVibrantL(H);
  let k = 0, minD = Infinity;
  for (let i = 0; i < N; i++) {
    const d = Math.abs(hi - i * (hi - lo) / (N - 1) - vibL);
    if (d < minD) { minD = d; k = i; }
  }
  const adj = Math.max(lo, Math.min(hi, vibL));
  const out = new Array(N);
  out[k] = adj;
  for (let i = 0; i < k; i++) out[i] = adj + (hi - adj) * (k - i) / k;
  for (let i = k + 1; i < N; i++) out[i] = adj - (adj - lo) * (i - k) / (N - 1 - k);
  return out;
}

// Entries { L, C, H, rgb (linear) } for every hue × lightness step.
export function paletteFromHues(hues, { nLum = 4, lumHigh = 0.88, lumLow = 0.32, vibHigh = 0.95, vibLow = 0.35 } = {}) {
  const entries = [];
  for (const H of hues) {
    for (const L of lightnessSteps(H, nLum, lumHigh, lumLow)) {
      const maxC = maxChromaAt(L, H);
      const C = maxC * (vibLow + (vibHigh - vibLow) * Math.min(1, maxC / 0.4));
      entries.push({ L, C, H, rgb: oklchToLinear(L, C, H).map(v => Math.max(0, Math.min(1, v))) });
    }
  }
  return entries;
}

// A pigment: the entry's colour rescaled so its brightest channel is `peak`,
// so dark or muted entries still paint as a loaded brush of that hue.
export function vividize(rgb, peak = 0.42) {
  const k = peak / Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
  return rgb.map(v => v * k);
}
