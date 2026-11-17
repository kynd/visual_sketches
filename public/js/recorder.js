// Video recorder shared by every demo. Three modes:
//
//  realtime  — MediaRecorder on canvas.captureStream(). Records what plays on
//              screen, at whatever rate the browser manages to present frames.
//  mp4       — frame-accurate. Pauses the demo, renders frame n at
//              t = t0 + n / fps, wraps the canvas in a VideoFrame stamped with
//              exactly n / fps seconds, encodes it with WebCodecs (H.264) and
//              muxes to MP4. Output timing is exact no matter how slowly each
//              frame renders.
//  png       — frame-accurate PNG sequence in a .zip (lossless, large).
//
// Only the WebGL canvas is captured; HTML overlays (labels, controls) are not.

const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.mjs';
const FFLATE_URL = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const yieldUI = () => new Promise(r => setTimeout(r, 0));

async function pickAvcCodec(w, h, fps, bitrate) {
  // High profile at decreasing levels; 5.2 covers 4K60, 4.0 covers 1080p30.
  for (const codec of ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4D0028', 'avc1.42001F']) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* try next */ }
  }
  return null;
}

export function attachRecorder({ canvas, wrap, loop, render, button, name }) {
  const panel = el('div', 'rec-panel panel-box');
  panel.innerHTML = `
    <div class="params-row"><span class="params-lbl">Mode</span>
      <select class="sd-select params-select" data-k="mode">
        <option value="mp4">Frame-accurate MP4</option>
        <option value="png">Frame-accurate PNG (.zip)</option>
        <option value="realtime">Realtime</option>
      </select></div>
    <div class="params-row" data-for="offline"><span class="params-lbl">Size</span>
      <select class="sd-select params-select" data-k="size">
        <option value="canvas">Canvas</option>
        <option value="1920x1080">1920 × 1080</option>
        <option value="3840x2160">3840 × 2160</option>
      </select></div>
    <div class="params-row"><span class="params-lbl">Frame rate</span>
      <input class="rec-num" data-k="fps" type="number" min="1" max="240" step="1" value="60"><span class="params-val">fps</span></div>
    <div class="params-row"><span class="params-lbl">Duration</span>
      <input class="rec-num" data-k="duration" type="number" min="0.1" max="600" step="0.5" value="10"><span class="params-val">s</span></div>
    <div class="params-row" data-for="offline"><span class="params-lbl">Start at</span>
      <select class="sd-select params-select" data-k="from">
        <option value="current">Current time</option>
        <option value="zero">t = 0</option>
      </select></div>
    <div class="params-row" data-for="video"><span class="params-lbl">Bitrate</span>
      <input class="rec-num" data-k="bitrate" type="number" min="1" max="200" step="1" value="40"><span class="params-val">Mbps</span></div>
    <div class="params-row rec-actions">
      <button class="bar-btn active" data-k="go">Start</button>
      <span class="rec-status"></span>
    </div>`;
  wrap.appendChild(panel);

  const $ = k => panel.querySelector(`[data-k="${k}"]`);
  const status = panel.querySelector('.rec-status');
  const goBtn = $('go');
  const setStatus = t => { status.textContent = t; };

  const refresh = () => {
    const mode = $('mode').value;
    panel.querySelectorAll('[data-for="offline"]').forEach(r => { r.style.display = mode === 'realtime' ? 'none' : ''; });
    panel.querySelectorAll('[data-for="video"]').forEach(r => { r.style.display = mode === 'png' ? 'none' : ''; });
  };
  $('mode').addEventListener('change', refresh);
  refresh();

  button.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    button.classList.toggle('active', open || busy);
  });

  let busy = false, cancel = false, realtimeStop = null;

  goBtn.addEventListener('click', async () => {
    if (busy) {                         // acts as Stop / Cancel while running
      cancel = true;
      realtimeStop?.();
      return;
    }
    const opts = {
      mode: $('mode').value,
      fps: Math.max(1, Math.min(240, parseFloat($('fps').value) || 60)),
      duration: Math.max(0.1, parseFloat($('duration').value) || 10),
      bitrate: Math.max(1, parseFloat($('bitrate').value) || 40) * 1e6,
      size: $('size').value,
      from: $('from').value,
    };
    busy = true; cancel = false;
    goBtn.textContent = opts.mode === 'realtime' ? 'Stop' : 'Cancel';
    button.classList.add('recording');
    try {
      if (opts.mode === 'realtime') await recordRealtime(opts);
      else await recordOffline(opts);
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    } finally {
      busy = false; realtimeStop = null;
      goBtn.textContent = 'Start';
      button.classList.remove('recording');
    }
  });

  // ── Realtime: MediaRecorder ─────────────────────────────────────────────
  async function recordRealtime({ fps, duration, bitrate }) {
    const types = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('MediaRecorder is not supported here.');
    const stream = canvas.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; });
    loop.play();
    rec.start(250);
    const t0 = performance.now();
    let timer;
    const stop = () => { clearInterval(timer); if (rec.state !== 'inactive') rec.stop(); };
    realtimeStop = stop;
    timer = setInterval(() => {
      const el = (performance.now() - t0) / 1000;
      setStatus(`● ${el.toFixed(1)} / ${duration} s`);
      if (el >= duration) stop();
    }, 100);
    await done;
    stream.getTracks().forEach(t => t.stop());
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    download(new Blob(chunks, { type: mimeType.split(';')[0] }), `${name}-realtime-${stamp()}.${ext}`);
    setStatus(`Saved .${ext}`);
  }

  // ── Frame-accurate: render each frame at t = t0 + n / fps ──────────────
  async function recordOffline({ mode, fps, duration, bitrate, size, from }) {
    const wasPlaying = loop.playing;
    loop.pause();
    const t0 = from === 'zero' ? 0 : loop.time;
    const total = Math.max(1, Math.round(duration * fps));

    const prevW = canvas.width, prevH = canvas.height;
    let W = prevW, H = prevH;
    if (size !== 'canvas') [W, H] = size.split('x').map(Number);
    W -= W % 2; H -= H % 2;            // H.264 needs even dimensions

    let encoder = null, muxer = null, target = null, zip = null, zipDone = null, ctx2d = null;
    if (mode === 'mp4') {
      if (!window.VideoEncoder) throw new Error('WebCodecs (VideoEncoder) is not available in this browser.');
      setStatus('Loading muxer…');
      const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);
      const cfg = await pickAvcCodec(W, H, fps, bitrate);
      if (!cfg) throw new Error(`No H.264 encoder supports ${W}×${H}.`);
      target = new ArrayBufferTarget();
      muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
      let encErr = null;
      encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encErr = e; } });
      encoder.configure({ ...cfg, latencyMode: 'quality' });
      encoder._err = () => encErr;
    } else {
      setStatus('Loading zip…');
      const { Zip, ZipPassThrough } = await import(FFLATE_URL);
      const parts = [];
      zipDone = new Promise((resolve, reject) => {
        zip = new Zip((err, data, final) => {
          if (err) { reject(err); return; }
          parts.push(data);
          if (final) resolve(new Blob(parts, { type: 'application/zip' }));
        });
      });
      zip.ZipPassThrough = ZipPassThrough;
      const c2 = document.createElement('canvas');
      c2.width = W; c2.height = H;
      ctx2d = c2.getContext('2d');
    }

    canvas.width = W; canvas.height = H;
    const keyEvery = Math.max(1, Math.round(fps * 2));
    const pad = String(total).length;
    const tStart = performance.now();
    let n = 0;
    try {
      for (; n < total && !cancel; n++) {
        render(t0 + n / fps);
        if (mode === 'mp4') {
          if (encoder._err()) throw encoder._err();
          const frame = new VideoFrame(canvas, { timestamp: Math.round(n * 1e6 / fps), duration: Math.round(1e6 / fps) });
          encoder.encode(frame, { keyFrame: n % keyEvery === 0 });
          frame.close();
          while (encoder.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 2));
        } else {
          ctx2d.drawImage(canvas, 0, 0);     // copy before the drawing buffer is cleared
          const blob = await new Promise(r => ctx2d.canvas.toBlob(r, 'image/png'));
          const file = new zip.ZipPassThrough(`${name}_${String(n).padStart(pad, '0')}.png`);
          zip.add(file);
          file.push(new Uint8Array(await blob.arrayBuffer()), true);
        }
        if (n % 4 === 0) {
          const rate = (n + 1) / ((performance.now() - tStart) / 1000);
          setStatus(`Frame ${n + 1} / ${total} · ${rate.toFixed(1)} frames/s`);
          await yieldUI();
        }
      }
    } finally {
      canvas.width = prevW; canvas.height = prevH;
    }

    if (cancel) {
      encoder?.close();
      setStatus('Cancelled');
    } else if (mode === 'mp4') {
      setStatus('Finishing…');
      await encoder.flush();
      encoder.close();
      muxer.finalize();
      download(new Blob([target.buffer], { type: 'video/mp4' }), `${name}-${fps}fps-${W}x${H}-${stamp()}.mp4`);
      setStatus(`Saved ${total} frames`);
    } else {
      setStatus('Finishing…');
      zip.end();
      download(await zipDone, `${name}-${fps}fps-${W}x${H}-${stamp()}.zip`);
      setStatus(`Saved ${total} frames`);
    }

    loop.setTime(t0);
    if (wasPlaying) loop.play(); else loop.redraw();
  }
}
