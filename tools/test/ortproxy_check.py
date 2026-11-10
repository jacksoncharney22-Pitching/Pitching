#!/usr/bin/env python3
"""onnxruntime's background worker (ortboot.js): on by default, and safe if it can't start.

  python3 tools/test/ortproxy_check.py tools/test/fixtures/maher_fast.json.gz [--rtm]

Needs `python3 tools/test/serve.py . 8766 &`. Runs the learned 3D model (lifter.js) on a saved clip four ways and
fails unless all four give identical 3D and the page carries on:
  fast    - Fast/High: only the learned 3D uses onnxruntime, so it stays on the page (no worker)
  worker  - Max: the stronger tracker started onnxruntime first, asking for the worker (now the default): model runs in onnxruntime's background worker
  page    - ?ortproxy=0, the old way (on the page)
  broken  - the worker can't be created (as on a browser that refuses it): must fall back to the page
  silent  - the worker starts but never answers: must give up after the wait and fall back
Prints window.__ortProxy and how long the page froze (longest gap in a 50 ms heartbeat). --rtm also loads the
stronger body tracker (large download from the repo) to check its session starts after a fallback.
"""
import gzip, json, sys, os, hashlib
from playwright.sync_api import sync_playwright

args = [a for a in sys.argv[1:] if not a.startswith('--')]
RTM = '--rtm' in sys.argv
NOGPU = "try { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }) } catch (e) {}"
BROKEN = NOGPU + """
const W0 = window.Worker; window.Worker = function (u, o) { if (/ort\\.(all|wasm)\\.min\\.js/.test(String(u))) throw new Error('test: worker refused'); return new W0(u, o) };"""
SILENT = NOGPU + """
window.__ortProxyWait = 3000;
const W0 = window.Worker; window.Worker = function (u, o) { if (/ort\\.(all|wasm)\\.min\\.js/.test(String(u))) return new W0(URL.createObjectURL(new Blob(['onmessage=()=>{}'])), o); return new W0(u, o) };"""
CASES = [('fast', '', NOGPU), ('worker', '', NOGPU), ('page', '?ortproxy=0', NOGPU), ('broken', '', BROKEN), ('silent', '', SILENT)]
JS = r"""async ([raw, rtm, fast]) => {
  const v = [...document.scripts].map(s => s.src).find(s => /app\.js\?v=/.test(s)).split('?')[1];
  const L = await import('./lifter.js?' + v), B = await import('./ortboot.js?' + v);
  // as in Max accuracy: the stronger tracker starts onnxruntime first and asks for the worker (Fast/High: lifter alone)
  if (!fast) await B.ortReady(new URL('ort/ort.all.min.js', document.baseURI).href, new URL('ort/', document.baseURI).href, 1, true);
  const g = []; let on = true, t = performance.now(); (function hb() { setTimeout(() => { const n = performance.now(); g.push(n - t); t = n; if (on) hb() }, 50) })();
  const t0 = performance.now();
  const out = await L.learnDepth(raw, () => {});
  const ms = performance.now() - t0; on = false;
  let rtmOk = null;
  if (rtm) { const R = await import('./rtm.js?' + v); try {
    await R.loadRTM(() => {});
    // one look at a drawn stick figure: the tracker's numbers must match too
    const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d');
    x.fillStyle = '#6a8'; x.fillRect(0, 0, 640, 480); x.strokeStyle = '#222'; x.lineWidth = 14; x.beginPath();
    x.arc(320, 110, 26, 0, 7); x.moveTo(320, 136); x.lineTo(320, 260); x.lineTo(270, 380); x.moveTo(320, 260); x.lineTo(380, 370);
    x.moveTo(320, 170); x.lineTo(250, 220); x.moveTo(320, 170); x.lineTo(400, 140); x.stroke();
    const look = await R.rtmLook(c, 640, 480, [220, 70, 430, 400]);
    rtmOk = R.rtmBackend() + ' look ' + JSON.stringify(look).length + ':' + [...JSON.stringify(look)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(16) } catch (e) { rtmOk = 'FAILED: ' + e.message } }
  return { l3: JSON.stringify(out), proxy: window.__ortProxy, ms, froze: Math.max(0, ...g) - 50, rtmOk };
}"""
bad = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    for fx in args:
        raw = json.load(gzip.open(fx)); ref = None
        for name, flag, init in CASES:
            pg = b.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.add_init_script(init)
            for pat in ('**/three.min.js', '**/OrbitControls.js'): pg.route(pat, lambda r: r.fulfill(body='', content_type='application/javascript'))
            pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            pg.goto('http://localhost:8766/index.html' + flag); pg.wait_for_timeout(1000)
            r = pg.evaluate(JS, [raw, RTM, name == 'fast'])
            h = hashlib.sha1(r['l3'].encode()).hexdigest()[:12]
            if ref is None: ref = h
            want = {'fast': False, 'worker': True, 'page': False, 'broken': False, 'silent': False}[name]
            ok = h == ref and r['l3'] != 'null' and bool((r['proxy'] or {}).get('on')) == want and not (RTM and str(r['rtmOk']).startswith('FAILED'))
            if name in ('broken', 'silent'): ok = ok and (r['proxy'] or {}).get('fellBack')
            bad += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {os.path.basename(fx)} {name:6s} 3D {h} · {r['ms']/1000:.1f} s · page froze {r['froze']/1000:.2f} s"
                  f" · {json.dumps(r['proxy'])}" + (f" · tracker {r['rtmOk']}" if RTM else '') + (f" · page errors {errs}" if errs else ''))
            pg.close()
    b.close()
sys.exit(1 if bad else 0)
