# Runs one clip through the real app in headless Chromium and saves what it produced.
#   python3 tools/test/clip_run.py <quality: fast|high|max> <video> <out folder> [strip]
# Needs: the site served on 127.0.0.1:8766 (tools/test/serve.py), Playwright with Chromium.
# Headless Chromium has no H.264, so convert .mp4/.mov to WebM first:
#   ffmpeg -i clip.mp4 -c:v libvpx-vp9 -b:v 4M -an clip.webm
# If cdnjs/jsdelivr are blocked (cloud sandbox), point THREE_JS and ORBIT_JS at local copies of three.min.js (r128)
# and OrbitControls.js, e.g. from `npm pack three@0.128.0`. If neither can be had, ORBIT_JS=tools/test/orbit_stub.js
# with any three.js build works for screenshots (the 3D view just can't be dragged).
# Saves: raw_<quality>.json (tracker output, input for regress.mjs), app_0..3.png (leg lift, foot strike, arm cocked,
# release), and with "strip": strip.png, 12 frames every 2nd frame from 4 before foot strike.
# Prints: the pitch finder's trim, event times, the net check, the result line (fit in cm) and any page errors.
import time, sys, os
from playwright.sync_api import sync_playwright
q, VID, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('APP_URL', 'http://127.0.0.1:8766/index.html')
T3, ORB = os.environ.get('THREE_JS'), os.environ.get('ORBIT_JS')
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={'width': 1440, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:300])); pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' else None)
    if T3: pg.route('**/three.min.js', lambda r: r.fulfill(path=T3, content_type='application/javascript'))
    if ORB: pg.route('**/OrbitControls.js', lambda r: r.fulfill(path=ORB, content_type='application/javascript'))
    pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    pg.goto(URL); pg.wait_for_timeout(1500)
    pg.select_option('#qualSel', q); pg.set_input_files('#fileIn', VID); pg.wait_for_timeout(1500)
    for i in range(300):
        m = pg.evaluate("document.getElementById('pitchFindMsg').textContent")
        if 'Finding' not in m: break
        pg.wait_for_timeout(1000)
    print('finder:', m[:150], pg.evaluate("[+document.getElementById('trimStart').value, +document.getElementById('trimEnd').value]"), flush=True)
    pg.click('#analyze'); t0 = time.time()
    while time.time() - t0 < 5000 and pg.evaluate("document.body.dataset.view") != 'results':
        pg.wait_for_timeout(5000)
    print('view', pg.evaluate("document.body.dataset.view"), round(time.time() - t0), 's', flush=True)
    open(os.path.join(OUT, f'raw_{q}.json'), 'w').write(pg.evaluate('JSON.stringify(window.__lastRaw)'))
    pg.wait_for_timeout(1500)
    for i, bt in enumerate(pg.query_selector_all('#phases button')[1:5]):
        bt.click(); pg.wait_for_timeout(1200)
        pg.locator('#theater').screenshot(path=os.path.join(OUT, f'app_{i}.png'))
    if len(sys.argv) > 4:
        from PIL import Image
        bts = pg.query_selector_all('#phases button'); bts[2].click(); pg.wait_for_timeout(800)
        for k in range(4): pg.click('#prevBtn'); pg.wait_for_timeout(150)
        tiles = []
        for j in range(12):
            pg.wait_for_timeout(700); p = os.path.join(OUT, f'st_{j}.png'); pg.locator('#theater').screenshot(path=p); tiles.append(Image.open(p))
            pg.click('#nextBtn'); pg.wait_for_timeout(150); pg.click('#nextBtn')
        w, h = tiles[0].size; M = Image.new('RGB', (w * 3, h * 4))
        for j, t in enumerate(tiles): M.paste(t, ((j % 3) * w, (j // 3) * h))
        M.resize((w * 3 // 2, h * 2)).save(os.path.join(OUT, 'strip.png'))
    print('phases', pg.evaluate("[...document.querySelectorAll('#phases button')].map(b=>b.textContent).join(' | ')"))
    print('net', pg.evaluate('JSON.stringify(window.__net)'))
    print('skeleton built on the', pg.evaluate('window.__anaWhere || "(not recorded)"'))
    print('meta', pg.evaluate("document.getElementById('resMeta').textContent"))
    print('errors', errs[:5]); b.close()
