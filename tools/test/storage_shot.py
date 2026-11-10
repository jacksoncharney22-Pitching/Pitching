# Screenshot of the "saved without its video" note on the results page (desktop and phone width), for checking the look.
#   python3 tools/test/storage_shot.py <fixture.json.gz> <outdir>     (server and THREE_JS / ORBIT_JS as in storage_check.py)
import sys, os, json, gzip
from playwright.sync_api import sync_playwright
raw = json.load(gzip.open(sys.argv[1])); OUT = sys.argv[2]; os.makedirs(OUT, exist_ok=True)
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/"); T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")
sys.path.insert(0, os.path.dirname(__file__)); from storage_check import FULL  # noqa
errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in ((1280, 900, "desktop"), (390, 844, "phone")):
        ctx = b.new_context(viewport={"width": w, "height": h}); pg = ctx.new_page()
        if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
        if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
        pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(1000)
        pg.evaluate("""raw => new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1); r.onupgradeneeded = () => r.result.createObjectStore('analyses', { keyPath: 'id', autoIncrement: true });
          r.onsuccess = () => { const t = r.result.transaction('analyses', 'readwrite'); t.objectStore('analyses').add({ date: Date.now(), name: 'Bullpen pitch', hand: 'auto', frames: raw.frames.length, fps: raw.fps, data: { name: 'Bullpen pitch' }, blob: null, raw }); t.oncomplete = res; t.onerror = () => rej(t.error) } })""", raw)
        pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(800)
        pg.evaluate(FULL)
        pg.evaluate("() => window.__saveHistory({ name: 'X', throwHand: 'R', frames: 10, fps: 60 }, new Blob(['x'], { type: 'video/webm' }))")
        pg.evaluate("() => [...document.querySelectorAll('.rec-open')].find(b => b.textContent.includes('Bullpen')).click()")
        pg.wait_for_selector("#ptable tbody tr", state="attached", timeout=60000); pg.wait_for_timeout(1500)
        print(tag, "note:", pg.evaluate("() => { const n = document.getElementById('numsChanged'); return n.hidden ? '(hidden)' : n.textContent.slice(0, 80) }"))
        pg.screenshot(path=f"{OUT}/note_{tag}.png"); ctx.close()
    b.close()
print("page errors:", errs); sys.exit(1 if errs else 0)
