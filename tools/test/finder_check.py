#!/usr/bin/env python3
"""Pitch finder check: does the finder's pose model run off the page (in its worker) without freezing the page,
and give the same readings as running it on the page?

  python3 tools/test/finder_check.py <fixture.json.gz> <outdir> [--compare]

Needs `python3 tools/test/serve.py . 8766 &` and THREE_JS / ORBIT_JS as for export_check.py. It draws a synthetic
filled-in figure (shirt, pants, face) on the fixture's 2D tracker points (not real footage, nothing is committed),
loads it, lets the pitch finder scan it and prints where the model ran, how long it took and the page's longest
freeze. Fails if the model didn't run in the worker, the finder saw no body, there were page errors, or the page
froze for over 1 s (it froze ~0.8-1.3 s at EVERY look when the model ran on the page). With --compare it also runs
with ?poseworker=0 and fails unless the stride/leg-lift readings are identical (on WebM a look can come out
differently from run to run on EITHER path, seek timing, so one mismatch is worth a re-run before believing it).
"""
import gzip, json, sys, os, subprocess, time, shutil
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

FX, OUT = sys.argv[1], sys.argv[2]; COMPARE = '--compare' in sys.argv
os.makedirs(OUT, exist_ok=True)
T3, ORB = os.environ.get('THREE_JS'), os.environ.get('ORBIT_JS')

def make_clip(fx, out, reps=1):
    r = json.load(gzip.open(fx)); W, H = 1280, 720
    fr = [f['img'] for f in r['frames'] if f and f.get('img')]
    tmp = os.path.join(OUT, 'fr'); os.makedirs(tmp, exist_ok=True)
    seq = []
    for k in range(reps): seq += [fr[0]] * 60 + fr + [fr[-1]] * 60          # stand, pitch, hold
    for i, P in enumerate(seq):
        im = Image.new('RGB', (W, H), (96, 140, 80)); d = ImageDraw.Draw(im)
        d.rectangle([0, 0, W, int(H * 0.35)], fill=(150, 170, 190))
        pt = lambda j: (P[j][0] * W, P[j][1] * H)
        L = lambda a, b, c, w: d.line([pt(a), pt(b)], fill=c, width=w, joint='curve')
        skin, shirt, pants = (224, 172, 140), (30, 60, 140), (230, 230, 230)
        for a, b in [(23, 25), (25, 27), (24, 26), (26, 28)]: L(a, b, pants, 30)
        for a, b in [(27, 31), (28, 32)]: L(a, b, (20, 20, 20), 16)
        d.polygon([pt(11), pt(12), pt(24), pt(23)], fill=shirt)
        for a, b in [(11, 13), (12, 14)]: L(a, b, shirt, 26)
        for a, b in [(13, 15), (14, 16)]: L(a, b, skin, 20)
        for j in (15, 16): x, y = pt(j); d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=skin)
        nx, ny = pt(0); hs = 32
        d.line([((pt(11)[0] + pt(12)[0]) / 2, (pt(11)[1] + pt(12)[1]) / 2), (nx, ny)], fill=skin, width=22)
        d.ellipse([nx - hs, ny - hs * 1.2, nx + hs, ny + hs], fill=skin)
        for j in (2, 5): x, y = pt(j); d.ellipse([x - 4, y - 3, x + 4, y + 3], fill=(30, 30, 30))
        im.save(os.path.join(tmp, f'{i:05d}.png'))
    enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'] if out.endswith('.mp4') else ['-c:v', 'libvpx-vp9', '-b:v', '2M']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '60', '-i', os.path.join(tmp, '%05d.png'), *enc, '-an', out], check=True)
    shutil.rmtree(tmp)

def scan(vid, flag):
    with sync_playwright() as p:
        b = getattr(p, os.environ.get('BROWSER', 'chromium')).launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        if T3: pg.route('**/three.min.js', lambda r: r.fulfill(path=T3, content_type='application/javascript'))
        if ORB: pg.route('**/OrbitControls.js', lambda r: r.fulfill(path=ORB, content_type='application/javascript'))
        pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
        # page heartbeat: a 50 ms timer that can't fire while the page is frozen
        pg.add_init_script("window.__beat=[];(function hb(){const t=performance.now();setTimeout(()=>{__beat.push(performance.now()-t);hb()},50)})();")
        pg.goto('http://localhost:8766/index.html' + flag); pg.wait_for_timeout(1500)
        t0 = time.time(); pg.evaluate("window.__beat=[]")
        pg.set_input_files('#fileIn', vid)
        pg.wait_for_function("window.__finderDbg", timeout=900000, polling=500); pg.wait_for_timeout(800)
        # with the one-video rule the trim thumbnails take their turn next: the player must come back after that
        try: pg.wait_for_function("document.getElementById('prepVideo').getAttribute('src')", timeout=30000, polling=300)
        except Exception: pass
        r = pg.evaluate("({solo: window.__soloDbg || null, player: !!document.getElementById('prepVideo').getAttribute('src'), one: !!window.__oneVideo, cpu: !!window.__poseWorkerCpu, where: __finderDbg.where, stride: __finderDbg.stride, lift: __finderDbg.lift, cand: __finderDbg.cand.length, freeze: Math.round(Math.max(0, ...__beat) - 50), slow: __beat.filter(x => x > 300).length})")
        r['secs'] = round(time.time() - t0, 1); r['errors'] = errs[:5]
        b.close(); return r

# MP4 (H.264) with MP4=1: Linux WebKit never finishes a seek in a WebM (Safari users upload MP4/MOV anyway)
vid = os.path.join(OUT, 'finder_mannequin.mp4' if os.environ.get('MP4') else 'finder_mannequin.webm')
FLAG = '?gpufail=1' if '--gpufail' in sys.argv else '?onevideo=1' if '--onevideo' in sys.argv else ''   # --onevideo: fake Safari's one-video rule
make_clip(FX, vid)
if '--clip-only' in sys.argv: print(vid); sys.exit(0)             # just the synthetic clip (engine_diag.py uses it)
w = scan(vid, FLAG)
seen = sum(x is not None for x in w['stride'])
print('one-video checks:', json.dumps(w['solo'])[:600])
print(f"worker: model ran on the {w['where']}{' (processor setting)' if w['cpu'] else ''}, {w['secs']} s, body seen in {seen}/{len(w['stride'])} looks, longest page freeze {w['freeze']} ms, {w['slow']} freezes over 0.3 s, errors {w['errors']}{', one-video rule found: other videos let go while reading' if w['one'] else ''}{'' if w['player'] else ', TRIM PLAYER LEFT EMPTY'}")
# WebKit: no WebGL inside a worker, so the model runs on the page there (that's expected, not a failure)
WK = os.environ.get('BROWSER') == 'webkit'
ok = (w['where'] == 'worker' or WK) and (w['cpu'] or 'gpufail' not in FLAG) and (w['one'] or 'onevideo' not in FLAG) and w['player'] and seen > len(w['stride']) * 0.5 and not w['errors'] and (w['freeze'] < 1000 or WK)
if COMPARE:
    p_ = scan(vid, '?poseworker=0')
    print(f"page:   model ran on the {p_['where']}, {p_['secs']} s, longest page freeze {p_['freeze']} ms, {p_['slow']} freezes over 0.3 s")
    json.dump({'worker': w, 'page': p_}, open(os.path.join(OUT, 'finder_readings.json'), 'w'))
    same = p_['stride'] == w['stride'] and p_['lift'] == w['lift']
    print('readings identical' if same else 'READINGS DIFFER (both saved in finder_readings.json)')
    ok = ok and same
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
