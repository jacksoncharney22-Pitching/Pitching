#!/usr/bin/env python3
"""Skeleton build in the background worker (analysisworker.js): same results as on the page?

  python3 tools/test/anaworker_check.py tools/test/fixtures/*.json.gz

Needs `python3 tools/test/serve.py . 8766 &` (THREE_JS / ORBIT_JS as for export_check.py if the CDNs are blocked).
For each saved tracker output it reads the slow-motion speed and builds the skeleton both in the worker and on the
page (same lab arm library), and fails unless the results are identical. Also prints how long the page froze
(longest gap in a 50 ms heartbeat) during each: the point of the worker is that the page keeps moving.
"""
import gzip, json, sys, os
from playwright.sync_api import sync_playwright

T3, ORB = os.environ.get('THREE_JS'), os.environ.get('ORBIT_JS')
JS = r"""async ([raw]) => {
  const v = [...document.scripts].map(s => s.src).find(s => /app\.js\?v=/.test(s)).split('?')[1];
  const P = await import('./pipeline.js?' + v);
  const armLib = await (await fetch('armlib.json?v=2')).json();
  const beat = () => { const g = []; let on = true, t = performance.now(); (function hb() { setTimeout(() => { const n = performance.now(); g.push(n - t); t = n; if (on) hb() }, 50) })(); return () => { on = false; return Math.max(0, ...g) - 50 } };
  const w = new Worker('analysisworker.js?' + v, { type: 'module' });
  const ask = m => new Promise((res, rej) => { w.onmessage = ({ data }) => data.ok ? res(data.r) : rej(new Error(data.err)); w.onerror = e => rej(new Error(e.message)); w.postMessage(m) });
  let stop = beat(); let t0 = performance.now();
  const sW = await ask({ id: 1, op: 'slow', raw });
  const r = structuredClone(raw); r.fps = raw.fps * 1;
  const dW = await ask({ id: 2, op: 'analyse', raw: r, o: { hand: 'auto' }, libs: { armLib }, useArm: true });
  const tW = performance.now() - t0, fW = stop();
  stop = beat(); t0 = performance.now();
  await new Promise(r => setTimeout(r, 120));
  const sP = P.detectSlowFactor(raw);
  const dP = structuredClone(P.analyse(structuredClone(raw), { hand: 'auto', armLib }));
  await new Promise(r => setTimeout(r, 120));
  const tP = performance.now() - t0 - 240, fP = stop();
  w.terminate();
  return { same: JSON.stringify(dW) === JSON.stringify(dP) && JSON.stringify(sW) === JSON.stringify(sP),
           slow: sW.factor, events: (dW.phases || []).map(p => p.t ?? p.time ?? p), tW, tP, fW, fP };
}"""
bad = 0
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    if T3: pg.route('**/three.min.js', lambda r: r.fulfill(path=T3, content_type='application/javascript'))
    if ORB: pg.route('**/OrbitControls.js', lambda r: r.fulfill(path=ORB, content_type='application/javascript'))
    pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    pg.goto('http://localhost:8766/index.html'); pg.wait_for_timeout(1500)
    for fx in sys.argv[1:]:
        raw = json.load(gzip.open(fx))
        r = pg.evaluate(JS, [raw])
        ok = r['same']; bad += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {os.path.basename(fx)}: identical={ok} slow {r['slow']}x · worker {r['tW']/1000:.1f} s, "
              f"page froze {r['fW']/1000:.2f} s · on the page {r['tP']/1000:.1f} s, page froze {r['fP']/1000:.2f} s")
    b.close()
if errs: print('page errors:', errs); bad += 1
sys.exit(1 if bad else 0)
