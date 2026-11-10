#!/usr/bin/env python3
"""Full Fast run with Recent's pitch-only video (?keepclip=1): does the re-opened pitch show the same picture?

  python3 tools/test/keepclip_run.py <clip.webm> <outdir> [fast|high|max]

Needs `python3 tools/test/serve.py . 8766 &` and THREE_JS / ORBIT_JS. Analyses the clip, screenshots the viewer at each
event, reads what Recent saved (video size and type, clipStart), re-opens it from Recent and screenshots the same
events: fails unless the saved video is the pitch-only one and every event's picture matches the first open
(mean pixel difference under 6/255; the video is re-encoded, so not zero). Use a synthetic clip
(finder_check.py / maxworker_check.py write one): no pitching videos in the repo.
"""
import sys, os, time, json
from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright
VID, OUT = sys.argv[1], sys.argv[2]; Q = sys.argv[3] if len(sys.argv) > 3 else 'fast'
os.makedirs(OUT, exist_ok=True)
T3, ORB = os.environ.get('THREE_JS'), os.environ.get('ORBIT_JS')
REC = """() => new Promise(res => { const r = indexedDB.open('charney-pitching', 1); r.onsuccess = () => { const q = r.result.transaction('analyses').objectStore('analyses').getAll();
  q.onsuccess = () => { const a = q.result.sort((x, y) => y.date - x.date)[0]; res(a ? { size: a.blob && a.blob.size, type: a.blob && a.blob.type, clipStart: a.clipStart ?? null, start: a.data && a.data.start } : null) } } })"""
def shots(pg, tag):
    out = []
    for i, bt in enumerate(pg.query_selector_all('#phases button')[1:5]):
        bt.click(); pg.wait_for_timeout(1500); p = os.path.join(OUT, f'{tag}_{i}.png'); pg.locator('#theater').screenshot(path=p); out.append(p)
    return out
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={'width': 1440, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    if T3: pg.route('**/three.min.js', lambda r: r.fulfill(path=T3, content_type='application/javascript'))
    if ORB: pg.route('**/OrbitControls.js', lambda r: r.fulfill(path=ORB, content_type='application/javascript'))
    pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    pg.goto('http://127.0.0.1:8766/index.html?keepclip=1'); pg.wait_for_timeout(1500)
    pg.select_option('#qualSel', Q); pg.set_input_files('#fileIn', VID); pg.wait_for_timeout(1500)
    for i in range(300):
        if 'Finding' not in pg.evaluate("document.getElementById('pitchFindMsg').textContent"): break
        pg.wait_for_timeout(1000)
    pg.click('#analyze'); t0 = time.time()
    while time.time() - t0 < 3000 and pg.evaluate("document.body.dataset.view") != 'results': pg.wait_for_timeout(3000)
    print('analysed in', round(time.time() - t0), 's', flush=True)
    A = shots(pg, 'first'); rec = pg.evaluate(REC); print('saved:', json.dumps(rec), '· upload', os.path.getsize(VID), 'bytes', flush=True)
    pg.reload(); pg.wait_for_selector('.rec-open', state='attached'); pg.wait_for_timeout(1500)
    pg.evaluate("() => document.querySelector('.rec-open').click()"); pg.wait_for_selector('#ptable tbody tr', state='attached', timeout=120000); pg.wait_for_timeout(2000)
    B = shots(pg, 'reopen'); b.close()
bad = []
if not rec or rec['clipStart'] is None: bad.append('pitch-only video not saved')
for a, c in zip(A, B):
    d = sum(ImageStat.Stat(ImageChops.difference(Image.open(a).convert('RGB'), Image.open(c).convert('RGB'))).mean) / 3
    print(os.path.basename(a), 'vs re-open: mean difference', round(d, 2)); bad += [f'{a}: {d:.1f}'] if d > 6 else []
if errs: print('page errors', errs); bad.append('page errors')
print('FAIL ' + str(bad) if bad else 'ok'); sys.exit(1 if bad else 0)
