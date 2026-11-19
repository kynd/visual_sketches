// Shared demo shell: builds the control bar, parameter panel and stats label
// inside .canvas-wrap, runs the play/pause loop, and wires the recorder.
// Demos supply a pure render(t) — everything visible must be a function of t
// so the frame-accurate recorder can reproduce any frame exactly.

import { attachRecorder } from './recorder.js';

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="13" height="13"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="13" height="13"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ── Loop ─────────────────────────────────────────────────────────────────
export class Loop {
  constructor(render, playBtn) {
    this.render = render;
    this.playBtn = playBtn;
    this.playing = false;
    this.pausedAt = 0;
    this.start = 0;
    this.rafId = null;
    this.onTick = null;    // (fps|null) called every ~0.5 s while playing
    this._frames = 0; this._last = 0;
    playBtn.addEventListener('click', () => this.toggle());
    this.updateBtn();
  }
  get time() { return this.playing ? this.pausedAt + (performance.now() - this.start) * 0.001 : this.pausedAt; }
  setTime(t) { this.pausedAt = t; this.start = performance.now(); if (!this.playing) this.redraw(); }
  updateBtn() {
    this.playBtn.innerHTML = this.playing ? PAUSE_ICON : PLAY_ICON;
    this.playBtn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
  }
  play() {
    if (this.playing) return;
    this.playing = true;
    this.start = performance.now();
    this._frames = 0; this._last = this.start;
    this.updateBtn();
    const frame = now => {
      this.rafId = requestAnimationFrame(frame);
      this.render(this.pausedAt + (now - this.start) * 0.001);
      this._frames++;
      if (now - this._last >= 500) {
        const fps = this._frames * 1000 / (now - this._last);
        this._frames = 0; this._last = now;
        this.onTick?.(fps);
      }
    };
    this.rafId = requestAnimationFrame(frame);
  }
  pause() {
    if (!this.playing) return;
    this.pausedAt += (performance.now() - this.start) * 0.001;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.updateBtn();
    this.onTick?.(null);
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  redraw() { if (!this.playing) this.render(this.pausedAt); }
}

// ── Parameter panel ──────────────────────────────────────────────────────
// spec: { id, label, type: 'range'|'select'|'toggle', ...,
//         visible?: values => bool, format?: v => string }
export function buildPanel(container, specs, onChange) {
  const values = {};
  const rows = [];
  const api = {
    values,
    set(id, v, silent = false) {
      const r = rows.find(r => r.spec.id === id);
      values[id] = v;
      r.sync();
      api.refresh();
      if (!silent) onChange(id, v);
    },
    spec(id) { return specs.find(s => s.id === id); },
    refresh() { for (const r of rows) r.row.style.display = !r.spec.visible || r.spec.visible(values) ? '' : 'none'; },
  };
  for (const spec of specs) {
    values[spec.id] = spec.value;
    const row = el('div', 'params-row');
    row.appendChild(el('span', 'params-lbl', spec.label));
    let sync;
    if (spec.type === 'range') {
      const input = el('input', 'params-sl');
      Object.assign(input, { type: 'range', min: spec.min, max: spec.max, step: spec.step, value: spec.value });
      const val = el('span', 'params-val');
      const fmt = spec.format || (v => String(v));
      input.addEventListener('input', () => { values[spec.id] = parseFloat(input.value); val.textContent = fmt(values[spec.id]); api.refresh(); onChange(spec.id, values[spec.id]); });
      sync = () => { input.value = values[spec.id]; val.textContent = fmt(values[spec.id]); };
      row.append(input, val);
    } else if (spec.type === 'select') {
      const sel = el('select', 'sd-select params-select');
      for (const [v, label] of spec.options) { const o = el('option', '', label); o.value = v; sel.appendChild(o); }
      sel.addEventListener('change', () => { values[spec.id] = sel.value; api.refresh(); onChange(spec.id, sel.value); });
      sync = () => { sel.value = values[spec.id]; };
      row.appendChild(sel);
    } else if (spec.type === 'toggle') {
      const btn = el('button', 'bar-btn params-toggle', spec.text || 'On');
      btn.addEventListener('click', () => { values[spec.id] = !values[spec.id]; sync(); api.refresh(); onChange(spec.id, values[spec.id]); });
      sync = () => { btn.classList.toggle('active', !!values[spec.id]); btn.textContent = values[spec.id] ? 'On' : 'Off'; };
      row.appendChild(btn);
    }
    sync();
    rows.push({ spec, row, sync });
    container.appendChild(row);
  }
  api.refresh();
  return api;
}

// ── Shell ────────────────────────────────────────────────────────────────
// Canvas resolutions: [width, height, aspect label]. The drawing buffer is
// always this size; CSS scales the canvas to fit the frame.
export const SIZES = [
  [1920, 1080, '16:9'], [1080, 1920, '9:16'],
  [1600, 1200, '4:3'], [1200, 1600, '3:4'],
  [1080, 1080, '1:1'],
];

export function mountShell({ title, panel, render, onParam, findMax, recordName }) {
  const canvas = document.getElementById('canvas');
  const wrap = canvas.closest('.canvas-wrap');

  // 'title' is kept for the page <title> and callers, but no longer drawn on the canvas.
  const bar = el('div', 'ctrl-bar scrim');
  const r1 = el('div', 'ctrl-bar-r1');
  r1.appendChild(el('div', 'ctrl-bar-spacer'));
  const sizeSel = el('select', 'bar-select ui-hide');
  sizeSel.title = 'Canvas resolution';
  sizeSel.setAttribute('aria-label', 'Canvas resolution');
  for (const [w, h, a] of SIZES) { const o = el('option', '', `${w} × ${h} (${a})`); o.value = `${w}x${h}`; sizeSel.appendChild(o); }
  r1.appendChild(sizeSel);
  const uiBtn = el('button', 'bar-btn active', 'UI');
  uiBtn.title = 'Show or hide the controls and stats (H)';
  r1.appendChild(uiBtn);
  const maxBtn = findMax ? el('button', 'bar-btn ui-hide', 'Find max') : null;
  if (maxBtn) r1.appendChild(maxBtn);
  const recBtn = el('button', 'bar-btn', 'Record');
  const playBtn = el('button', 'play-btn');
  r1.append(recBtn, playBtn);
  const r2 = el('div', 'ctrl-bar-r2');
  const fpsEl = el('span', 'fps-inline ui-hide', 'paused');
  r2.appendChild(fpsEl);
  bar.append(r1, r2);

  // Demo captions belong to the image, so they live in a layer that tracks
  // the canvas rectangle; the panel and stats stay on the whole frame.
  const canvasLayer = el('div', 'canvas-layer');
  wrap.appendChild(canvasLayer);
  const overlay = el('div');
  overlay.id = 'overlay';
  const panelEl = el('div', 'params-panel panel-box');
  const label = el('div', 'shape-label');
  const statName = el('div', 'shape-label-name');
  const statFn = el('div', 'shape-label-fn');
  label.append(statName, statFn);
  const msg = el('div', 'demo-msg');
  overlay.append(panelEl, label, msg);
  wrap.append(overlay, bar);

  const loop = new Loop(t => render(t), playBtn);
  const params = buildPanel(panelEl, panel, (id, v) => { onParam?.(id, v); loop.redraw(); fitPanel(); });

  // Keep the panel clear of the stats label: if one column of controls would
  // reach it, lay the rows out in as many columns as needed.
  function fitPanel() {
    panelEl.style.display = '';
    panelEl.style.gridTemplateRows = '';
    const top = panelEl.offsetTop;
    const limit = label.offsetTop - 12;                       // stats label's top edge, less a margin
    if (top + panelEl.offsetHeight <= limit) return;
    const rows = [...panelEl.children].filter(r => r.style.display !== 'none');
    const rowH = Math.max(22, ...rows.map(r => r.offsetHeight)) + 6;   // grid rows get min-height 22px
    const pad = panelEl.offsetHeight - panelEl.clientHeight + 20; // borders + padding
    const perCol = Math.max(1, Math.floor((limit - top - pad + 6) / rowH));
    panelEl.style.display = 'grid';
    panelEl.style.gridTemplateRows = `repeat(${perCol}, auto)`;
  }

  // UI toggle: hides the parameter panel, stats, fps meter, captions and
  // Find max; the UI, Record and play/pause buttons stay.
  function setUi(on) {
    wrap.classList.toggle('ui-hidden', !on);
    uiBtn.classList.toggle('active', on);
    if (on) fitPanel();
  }
  uiBtn.addEventListener('click', () => setUi(wrap.classList.contains('ui-hidden')));
  window.addEventListener('keydown', e => {
    if (e.key !== 'h' && e.key !== 'H') return;
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    setUi(wrap.classList.contains('ui-hidden'));
  });

  // Canvas size: the drawing buffer is the chosen resolution; CSS scales the
  // canvas to the largest rectangle of that shape that fits the frame
  // (1920×1080, or 960×540 embedded), centred.
  let size = [SIZES[0][0], SIZES[0][1]];
  function fitCanvas() {
    const fw = wrap.clientWidth, fh = wrap.clientHeight, [rw, rh] = size;
    const k = Math.min(fw / rw, fh / rh), w = rw * k, h = rh * k;
    const box = { position: 'absolute', left: `${(fw - w) / 2}px`, top: `${(fh - h) / 2}px`, width: `${w}px`, height: `${h}px` };
    Object.assign(canvas.style, box);
    Object.assign(canvasLayer.style, box);
    canvas.width = rw; canvas.height = rh;
  }
  function setSize(value, redraw = true) {
    const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(String(value).trim());
    const s = (m && SIZES.find(([w, h]) => w === +m[1] && h === +m[2])) || SIZES[0];
    size = [s[0], s[1]];
    sizeSel.value = `${s[0]}x${s[1]}`;
    fitCanvas();
    recorder?.updateSizes();
    if (redraw) loop.redraw();
  }
  sizeSel.addEventListener('change', () => setSize(sizeSel.value));
  let recorder = null;
  // ?size=1600x1200 in the URL picks the starting resolution.
  setSize(new URLSearchParams(location.search).get('size') || '', false);

  const shell = {
    canvas, wrap, loop, params, overlay: canvasLayer, frame: overlay,
    get size() { return size; },
    setSize,
    fps: null,
    setStats(name, fn) { statName.textContent = name; statFn.textContent = fn; },
    setUi,
    message(text) { msg.textContent = text || ''; msg.style.display = text ? 'block' : 'none'; },
  };
  shell.message('');
  window.demo = shell;   // handy for poking at parameters from the console

  // Find max: raise the count by half an octave while the frame rate holds.
  let finding = null;
  if (maxBtn) {
    const { id, target = 55 } = findMax;
    maxBtn.addEventListener('click', () => {
      if (finding) { finding = null; maxBtn.classList.remove('active'); return; }
      finding = { settle: 1 };
      maxBtn.classList.add('active');
      loop.play();
    });
    shell.stopFinding = () => { finding = null; maxBtn.classList.remove('active'); };
    shell._onFps = fps => {
      if (!finding || fps === null) { if (fps === null) shell.stopFinding(); return; }
      if (finding.settle-- > 0) return;            // skip the window right after a change
      const s = params.spec(id);
      const v = params.values[id];
      if (fps >= target) {
        if (v + s.step > s.max) { shell.stopFinding(); return; }
        params.set(id, +(v + s.step).toFixed(3));
        finding.settle = 1;
      } else {
        params.set(id, Math.max(s.min, +(v - s.step).toFixed(3)));
        shell.stopFinding();
      }
    };
  }
  loop.onTick = fps => {
    shell.fps = fps;
    fpsEl.textContent = fps === null ? 'paused' : `${fps.toFixed(0)} fps`;
    shell._onFps?.(fps);
  };

  recorder = attachRecorder({ canvas, wrap, loop, render, button: recBtn, name: recordName || 'demo' });
  fitPanel();
  document.fonts?.ready.then(fitPanel);   // row heights change once the web fonts load

  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    loop.pause();
    shell.message('The GPU reset the WebGL context (the frame took too long). Reload the page to continue.');
  });

  return shell;
}

export function formatCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
  return String(n);
}
