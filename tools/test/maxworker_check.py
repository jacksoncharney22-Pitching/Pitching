#!/usr/bin/env python3
"""Max accuracy check: do Max's MediaPipe models run off the page (in the pose worker) and give the SAME tracker output
as running them on the page?

  python3 tools/test/maxworker_check.py <fixture.json.gz> <outdir> [--frames 30] [--from 0.45] [--nortm]

Needs `python3 tools/test/serve.py . 8766 &` and THREE_JS / ORBIT_JS as for export_check.py. Draws the same synthetic
filled-in figure as finder_check.py (not real footage, nothing committed) for a short stretch of the fixture
(`--frames` frames at 60 fps, starting `--from` of the way through), runs Max accuracy on it once in the worker and once
with ?poseworker=0, and fails unless both raw tracker outputs are byte-identical, the worker run stayed in the worker,
and there were no page errors. Prints both times and the page's longest freeze. --nortm blocks the stronger tracker
(RTMPose) so Max's "still look" MediaPipe models are used instead. The page run also turns off onnxruntime's
background proxy (`--pageflag`), so it is the old way end to end. `--only worker|page` runs one side (two can run at
once in separate shells), `--only compare` then compares them. Max is slow headless: keep --frames small.
"""
import gzip, json, sys, os, subprocess, time, shutil, hashlib
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

FX, OUT = sys.argv[1], sys.argv[2]
arg = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
NF, FROM, NORTM = arg('--frames', 30), arg('--from', 0.45), '--nortm' in sys.argv
PAD = 12      # extra frames after the trimmed stretch: seeking right at a clip's last frame can land on the one before
ONLY, PFLAG = arg('--only', ''), arg('--pageflag', '?poseworker=0&ortproxy=0')   # --only worker|page|compare (parallel runs)
os.makedirs(OUT, exist_ok=True)
T3, ORB = os.environ.get('THREE_JS'), os.environ.get('ORBIT_JS')

def make_clip(out):
    r = json.load(gzip.open(FX)); W, H = 1280, 720
    fr = [f['img'] for f in r['frames'] if f and f.get('img')]
    a = int(len(fr) * FROM); seq = fr[a:a + NF + PAD]
    tmp = os.path.join(OUT, 'fr'); os.makedirs(tmp, exist_ok=True)
    for i, P in enumerate(seq):
        im = Image.new('RGB', (W, H), (96, 140, 80)); d = ImageDraw.Draw(im)
        d.rectangle([0, 0, W, int(H * 0.35)], fill=(150, 170, 190))
        pt = lambda j: (P[j][0] * W, P[j][1] * H)
        L = lambda a, b, c, w: d.line([pt(a), pt(b)], fill=c, width=w, joint='curve')
        skin, shirt, pants = (224, 172, 140), (30, 60, 140), (230, 230, 230)
        for a_, b_ in [(23, 25), (25, 27), (24, 26), (26, 28)]: L(a_, b_, pants, 30)
        for a_, b_ in [(27, 31), (28, 32)]: L(a_, b_, (20, 20, 20), 16)
        d.polygon([pt(11), pt(12), pt(24), pt(23)], fill=shirt)
        for a_, b_ in [(11, 13), (12, 14)]: L(a_, b_, shirt, 26)
        for a_, b_ in [(13, 15), (14, 16)]: L(a_, b_, skin, 20)
        for j in (15, 16): x, y = pt(j); d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=skin)
        nx, ny = pt(0); hs = 32
        d.line([((pt(11)[0] + pt(12)[0]) / 2, (pt(11)[1] + pt(12)[1]) / 2), (nx, ny)], fill=skin, width=22)
        d.ellipse([nx - hs, ny - hs * 1.2, nx + hs, ny + hs], fill=skin)
        for j in (2, 5): x, y = pt(j); d.ellipse([x - 4, y - 3, x + 4, y + 3], fill=(30, 30, 30))
        im.save(os.path.join(tmp, f'{i:05d}.png'))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '60', '-i', os.path.join(tmp, '%05d.png'),
                    '-c:v', 'libvpx-vp9', '-b:v', '2M', '-an', out], check=True)
    shutil.rmtree(tmp)

def run(vid, flag, tag):
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        if T3: pg.route('**/three.min.js', lambda r: r.fulfill(path=T3, content_type='application/javascript'))
        if ORB: pg.route('**/OrbitControls.js', lambda r: r.fulfill(path=ORB, content_type='application/javascript'))
        pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
        if NORTM: pg.route('**/rtm/**', lambda r: r.abort())
        pg.add_init_script("window.__beat=[];(function hb(){const t=performance.now();setTimeout(()=>{__beat.push(performance.now()-t);hb()},50)})();")
        pg.goto('http://localhost:8766/index.html' + flag); pg.wait_for_timeout(1500)
        pg.select_option('#qualSel', 'max'); pg.set_input_files('#fileIn', vid); pg.wait_for_timeout(1500)
        for i in range(600):
            if 'Finding' not in pg.evaluate("document.getElementById('pitchFindMsg').textContent"): break
            pg.wait_for_timeout(1000)
        # the whole (short) clip, whatever the finder chose
        pg.evaluate("(()=>{const s=document.getElementById('trimStart'),e=document.getElementById('trimEnd');s.value=0;e.value=(%f).toFixed(2);s.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('input'))})()" % (NF / 60))
        pg.wait_for_timeout(500); pg.evaluate("window.__beat=[]")
        pg.click('#analyze'); t0 = time.time()
        last, lastT = '', time.time()
        while time.time() - t0 < 5400 and pg.evaluate("document.body.dataset.view") != 'results':
            if errs: break
            if pg.evaluate("document.body.dataset.view") == 'prep':   # back on the upload screen: the run stopped with an error
                errs.append('STOPPED with: ' + pg.evaluate("document.getElementById('prepErr').textContent")[:200]); break
            pg.wait_for_timeout(3000)
            # where it is: a run that hangs (no progress for 5 min) is reported with the step it stopped on
            st = pg.evaluate("[...document.querySelectorAll('#stModel,#stTrack,#stBuild')].map(e=>e.dataset.state+':'+e.querySelector('small').textContent).join(' | ')")
            if st != last: last, lastT = st, time.time(); print(f'  {tag} {round(time.time()-t0)}s {st[:160]}', flush=True)
            elif time.time() - lastT > 300: errs.append('HUNG for 5 min at: ' + st[:200]); break
        secs = round(time.time() - t0)
        raw = pg.evaluate('JSON.stringify(window.__lastRaw && {frames: window.__lastRaw.frames, fps: window.__lastRaw.fps})')
        looks = pg.evaluate('JSON.stringify(window.__lastLooks)')
        r = {'secs': secs, 'view': pg.evaluate("document.body.dataset.view"), 'engine': pg.evaluate("window.__engine"),
             'fellBack': pg.evaluate("window.__poseFellBack || null"),
             'freeze': pg.evaluate("Math.round(Math.max(0, ...__beat) - 50)"), 'slow': pg.evaluate("__beat.filter(x => x > 300).length"),
             'errors': errs[:5], 'hash': hashlib.md5((raw or '').encode()).hexdigest()[:12],
             'lookHash': hashlib.md5((looks or '').encode()).hexdigest()[:12]}
        open(os.path.join(OUT, f'raw_max_{tag}.json'), 'w').write(raw or 'null')
        open(os.path.join(OUT, f'looks_max_{tag}.json'), 'w').write(looks or 'null')
        b.close(); return r

vid = os.path.join(OUT, 'max_mannequin.webm')
if not os.path.exists(vid): make_clip(vid)
if ONLY in ('worker', 'page'):
    r = run(vid, '' if ONLY == 'worker' else PFLAG, ONLY); print(ONLY + ':', r, flush=True)
    json.dump(r, open(os.path.join(OUT, f'run_{ONLY}.json'), 'w')); sys.exit(0)
if ONLY == 'compare': w, pg_ = [json.load(open(os.path.join(OUT, f'run_{t}.json'))) for t in ('worker', 'page')]
else:
    w = run(vid, '', 'worker'); print('worker:', w, flush=True)
    pg_ = run(vid, PFLAG, 'page'); print('page:  ', pg_, flush=True)
same = w['lookHash'] == pg_['lookHash'] and w['hash'] == pg_['hash']
print('tracker output identical' if same else 'TRACKER OUTPUT DIFFERS (both saved in the outdir)')
ok = same and w['view'] == 'results' and not w['fellBack'] and not w['errors'] and not pg_['errors']
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
