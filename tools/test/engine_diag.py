#!/usr/bin/env python3
"""Why does the pose model see (or not see) a pitcher in a given browser engine? A step-by-step check, no app flow.

  BROWSER=webkit python3 tools/test/engine_diag.py <clip.webm|.mp4>

Needs `python3 tools/test/serve.py . 8766 &`. Made for the Safari-engine finding (2026-11-10: in WebKit the pitch
finder's model fell back from its worker to the page and saw the body in 0 of 45 looks). It prints, one line each:
the video (does it play, size, are its pixels real when drawn to a canvas, also via createImageBitmap as the worker
path does), WebGL/WebGL2/OffscreenCanvas support, the pose model on the page with the GPU and the CPU setting fed a
canvas / the video / a bitmap, and the pose worker's start-up (its error message if it fails).
"""
import os, sys, json
from playwright.sync_api import sync_playwright

CLIP = sys.argv[1]
JS = r"""
async () => {
  const out = {}, P = (k, v) => { out[k] = v };
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = '/__diag_clip';
  document.body.appendChild(v);
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video error ' + (v.error && v.error.code))); setTimeout(() => rej(new Error('no loadeddata in 15 s')), 15000) });
    v.currentTime = Math.min(1.5, v.duration / 2);
    await new Promise((res, rej) => { v.onseeked = res; setTimeout(() => rej(new Error('no seeked in 8 s')), 8000) });
    P('video', { w: v.videoWidth, h: v.videoHeight, dur: +v.duration.toFixed(2), canPlayWebm: v.canPlayType('video/webm; codecs="vp9"'), canPlayMp4: v.canPlayType('video/mp4; codecs="avc1.42E01E"') });
  } catch (e) { P('video', 'FAILED: ' + e.message); return out }
  const stats = src => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); g.drawImage(src, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const y = (d[i] + d[i + 1] + d[i + 2]) / 3; s += y; s2 += y * y; n++ }
    const m = s / n; return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(1) } };
  try { P('pixels_video', stats(v)) } catch (e) { P('pixels_video', 'FAILED: ' + e.message) }
  let bm = null;
  try { bm = await createImageBitmap(v); P('pixels_bitmap', { w: bm.width, h: bm.height, ...stats(bm) }) } catch (e) { P('pixels_bitmap', 'FAILED: ' + e.message) }
  const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext('2d').drawImage(v, 0, 0);
  const gl = (k, c) => { try { return !!c.getContext(k) } catch (e) { return 'err ' + e.message } };
  P('gfx', { webgl: gl('webgl', document.createElement('canvas')), webgl2: gl('webgl2', document.createElement('canvas')),
             offscreen: typeof OffscreenCanvas, offscreenWebgl2: typeof OffscreenCanvas === 'function' ? gl('webgl2', new OffscreenCanvas(8, 8)) : null,
             wasmSimd: typeof WebAssembly === 'object', ua: navigator.userAgent });
  const txt = await (await fetch('pose_landmarker_full.b64.txt')).text(), bin = atob(txt.replace(/\s+/g, '')), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let PL;
  try { PL = (await import('./lib/vision_bundle.mjs')).PoseLandmarker } catch (e) { P('import', 'FAILED: ' + e.message); return out }
  const fileset = { wasmLoaderPath: location.origin + '/wasm/vision_wasm_internal.js', wasmBinaryPath: location.origin + '/wasm/vision_wasm_internal.wasm' };
  for (const delegate of ['GPU', 'CPU']) {
    const r = {};
    let t;
    try { t = await PL.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: bytes.slice(), delegate }, runningMode: 'IMAGE', numPoses: 1, minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3 }) }
    catch (e) { P('model_' + delegate, 'create FAILED: ' + String(e && e.message || e).slice(0, 200)); continue }
    for (const [k, src] of [['canvas', cv], ['video', v], ['bitmap', bm]]) {
      if (!src) continue;
      try { const t0 = performance.now(), res = t.detect(src), L = res.landmarks && res.landmarks[0];
        r[k] = L ? { seen: true, ms: Math.round(performance.now() - t0), nose: [+L[0].x.toFixed(3), +L[0].y.toFixed(3)], lAnkle: [+L[27].x.toFixed(3), +L[27].y.toFixed(3)] } : { seen: false, ms: Math.round(performance.now() - t0) } }
      catch (e) { r[k] = 'FAILED: ' + String(e && e.message || e).slice(0, 200) }
    }
    try { t.close() } catch (e) {}
    P('model_' + delegate, r);
  }
  // the pitch finder's way: VIDEO mode, seeking through the clip, one look per seek
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const t = await PL.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: bytes.slice(), delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3 });
      let seen = 0, n = 0, errs = [];
      for (let i = 0; i < 12; i++) {
        v.currentTime = Math.min(v.duration - 0.01, (i + 0.5) * v.duration / 12);
        await new Promise(res => { v.onseeked = res; setTimeout(res, 8000) });
        try { const r = t.detectForVideo(v, i * 100 + 1); n++; if (r.landmarks && r.landmarks[0]) seen++ } catch (e) { errs.push(String(e.message || e).slice(0, 120)) }
      }
      t.close(); P('video_mode_' + delegate, { seen, of: n, errs: errs.slice(0, 2) });
    } catch (e) { P('video_mode_' + delegate, 'FAILED: ' + String(e && e.message || e).slice(0, 200)) }
  }
  // can a worker make a WebGL context at all? (MediaPipe needs one even on the CPU setting, to read pictures)
  try {
    const src = "let r={};try{r.offscreen=typeof OffscreenCanvas;const c=new OffscreenCanvas(8,8);r.webgl2=!!c.getContext('webgl2');r.webgl=!!new OffscreenCanvas(8,8).getContext('webgl')}catch(e){r.err=String(e)}postMessage(r)";
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    P('worker_gl', await new Promise(res => { w.onmessage = e => res(e.data); setTimeout(() => res('no answer'), 5000) })); w.terminate();
  } catch (e) { P('worker_gl', 'FAILED: ' + e.message) }
  // the worker path, as poseModels starts it
  try {
    const w = new Worker(new URL('poseworker.js', location.href), { type: 'module' });
    const reply = await new Promise(res => { w.onmessage = ({ data }) => res(data); w.onerror = e => res({ ok: false, err: 'onerror: ' + (e.message || 'no message') }); setTimeout(() => res({ ok: false, err: 'no answer in 60 s' }), 60000);
      const b = bytes.slice(); w.postMessage({ type: 'init', id: 1, key: 0, base: location.origin + '/', bytes: b, mode: 'IMAGE', poses: 1 }, [b.buffer]) });
    let det = null;
    if (reply.ok) { const b2 = await createImageBitmap(cv); det = await new Promise(res => { w.onmessage = ({ data }) => res(data.ok ? { seen: !!(data.r.landmarks && data.r.landmarks[0]) } : { err: data.err }); setTimeout(() => res({ err: 'no answer in 20 s' }), 20000); w.postMessage({ type: 'detect', id: 2, key: 0, bitmap: b2, ts: 1 }, [b2]) }) }
    P('worker', { init: reply.ok ? 'ok' : reply.err, detect: det }); w.terminate();
  } catch (e) { P('worker', 'FAILED to start: ' + e.message) }
  return out;
}
"""

with sync_playwright() as p:
    b = getattr(p, os.environ.get('BROWSER', 'chromium')).launch(); pg = b.new_page()
    logs = []; pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'[:200])); pg.on('pageerror', lambda e: logs.append('pageerror: ' + str(e)[:200]))
    ct = 'video/webm' if CLIP.endswith('.webm') else 'video/mp4'
    pg.route('**/__diag_clip', lambda r: r.fulfill(path=CLIP, content_type=ct))
    pg.goto('http://localhost:8766/version.txt')                            # any page on the server: same origin, no app start-up
    r = pg.evaluate(JS)
    b.close()
for k, v in r.items(): print(f'{k}: {json.dumps(v)}')
print('console:', *logs[-15:], sep='\n  ')
