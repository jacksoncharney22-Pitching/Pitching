#!/usr/bin/env python3
"""Recent's pitch-only video (keepclip.js): does every frame of the small saved video line up with the upload?

  python3 tools/test/keepclip_check.py <video> [--fps 60] [--start 1.0] [--frames 60]

Needs `python3 tools/test/serve.py . 8766 &`. Steps through the video as the tracker does (frame i at
start + (i + 0.5) / fps), writes each frame with clipKeeper, then plays the result back the way the viewer does
(frame i at (i + 0.5) / fps) and compares each frame with the upload's at the same moment, also with the frames
either side: fails unless every frame matches best at its own position. Use a video whose every frame differs
(e.g. `ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=60 -t 4 -c:v libvpx-vp9 out.webm`). Prints sizes.
"""
import sys, os, json
from playwright.sync_api import sync_playwright
VID = sys.argv[1]
arg = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
FPS, START, N = arg('--fps', 60.0), arg('--start', 1.0), arg('--frames', 60)
JS = r"""async ([b64, fps, start, N]) => {
  const v0 = [...document.scripts].map(s => s.src).find(s => /app\.js\?v=/.test(s)).split('?')[1];
  const K = await import('./keepclip.js?' + v0);
  const up = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'video/webm' });
  const open = async b => { const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(b); await new Promise(r => v.onloadeddata = r); return v };
  const seek = (v, t) => new Promise(r => { v.onseeked = r; v.currentTime = t });
  const v = await open(up), W = v.videoWidth, H = v.videoHeight;
  const keep = await K.clipKeeper(W, H, fps); if (!keep) return { err: 'no keeper (browser cannot write video)' };
  const sm = document.createElement('canvas'); sm.width = 64; sm.height = 36; const g = sm.getContext('2d', { willReadFrequently: true });
  const px = el => { g.drawImage(el, 0, 0, 64, 36); return g.getImageData(0, 0, 64, 36).data };
  const ref = [];
  for (let i = 0; i < N; i++) { await seek(v, start + (i + 0.5) / fps); await keep.add(v); ref.push(px(v)) }
  const out = await keep.finish(); if (!out) return { err: 'finish gave nothing' };
  const c = await open(out);
  const d = (a, b) => { let s = 0; for (let k = 0; k < a.length; k += 4) s += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]); return s / (a.length / 4 * 3) };
  let bad = [], worst = 0;
  for (let i = 0; i < N; i++) {
    await seek(c, (i + 0.5) / fps); const p = px(c);
    const own = d(p, ref[i]); worst = Math.max(worst, own);
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < N && d(p, ref[j]) <= own) bad.push(i);
  }
  return { size: out.size, type: out.type, w: c.videoWidth, h: c.videoHeight, dur: c.duration, bad, worst };
}"""
import base64
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    for pat in ('**/three.min.js', '**/OrbitControls.js'): pg.route(pat, lambda r: r.fulfill(body='', content_type='application/javascript'))
    pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    pg.goto('http://localhost:8766/index.html'); pg.wait_for_timeout(1000)
    r = pg.evaluate(JS, [base64.b64encode(open(VID, 'rb').read()).decode(), FPS, START, N])
    b.close()
up = os.path.getsize(VID)
print(json.dumps(r))
ok = 'err' not in r and not r['bad'] and not errs
if 'size' in r: print(f"upload {up/1e6:.1f} MB -> pitch-only {r['size']/1e6:.2f} MB ({r['w']}x{r['h']}, {r['dur']:.2f} s); frames off by one: {len(r['bad'])}; worst own-frame difference {r['worst']:.1f}/255")
if errs: print('page errors', errs)
print('ok' if ok else 'FAIL'); sys.exit(0 if ok else 1)
