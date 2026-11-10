# How long "Over time" takes to re-read N saved pitches (first open, no in-memory copies yet), and the page's longest
# freeze while it does. Each saved pitch is the fixture's tracker output under a different name.
#   python3 tools/test/serve.py . 8766 &
#   python3 tools/test/trend_time.py <fixture.json[.gz]> [N=10] [?flags, e.g. ?analysisworker=0] [cores]
# `cores` fakes navigator.hardwareConcurrency (the number of re-read workers follows it). THREE_JS / ORBIT_JS as in clip_run.py.
import sys, os, json, gzip, time
from playwright.sync_api import sync_playwright
fx = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 10
FLAG = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != '-' else ''; CORES = sys.argv[4] if len(sys.argv) > 4 else None
raw = json.load(gzip.open(fx) if fx.endswith(".gz") else open(fx))
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/index.html"); T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 900})
    if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
    if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
    pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    if CORES: pg.add_init_script(f"Object.defineProperty(navigator, 'hardwareConcurrency', {{ get: () => {CORES} }})")
    pg.add_init_script("window.__beat=[];(function hb(){const t=performance.now();setTimeout(()=>{__beat.push(performance.now()-t);hb()},50)})();")
    pg.goto(URL + FLAG); pg.wait_for_timeout(1500)
    pg.evaluate("""([raw, n]) => new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1); r.onsuccess = () => { const t = r.result.transaction('analyses', 'readwrite');
      for (let i = 0; i < n; i++) t.objectStore('analyses').add({ date: Date.now() - 1000 * (n - i), name: 'Pitch ' + i, pitcher: 'Ann', hand: 'auto', frames: raw.frames.length, fps: raw.fps, data: { name: 'Pitch ' + i, pitcher: 'Ann' }, blob: null, raw });
      t.oncomplete = res; t.onerror = () => rej(t.error) } })""", [raw, N])
    pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(3000)
    pg.evaluate("window.__beat=[]"); t0 = time.time()
    pg.evaluate("() => { document.getElementById('recentWrap').open = true; document.getElementById('trendGo').click() }")
    pg.wait_for_selector(".tr-svg", timeout=600000); secs = time.time() - t0
    dots = pg.locator(".tr-dot").count()
    fr = pg.evaluate("Math.round(Math.max(0, ...__beat) - 50)")
    b.close()
print(f"{N} pitches{(' ' + FLAG) if FLAG else ''}{(' cores=' + CORES) if CORES else ''}: {secs:.1f} s, {dots} points, longest freeze {fr} ms, errors {errs[:3]}")
sys.exit(1 if errs or dots != N else 0)
