# Saved pitches: the newest 6 keep their video, up to 30 are kept, and an old one without its video still opens.
#   python3 tools/test/serve.py . 8766 &
#   python3 tools/test/history_check.py <fixture.json[.gz]>
# Exits 1 on a wrong count or a page error. THREE_JS / ORBIT_JS as in clip_run.py.
import sys, os, json, gzip
from playwright.sync_api import sync_playwright
fx = sys.argv[1]; raw = json.load(gzip.open(fx) if fx.endswith(".gz") else open(fx))
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/"); T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")
errs, bad = [], []
COUNT = """() => new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1); r.onsuccess = () => { const q = r.result.transaction('analyses').objectStore('analyses').getAll();
  q.onsuccess = () => { const a = q.result.sort((x, y) => y.date - x.date); res([a.length, a.filter(x => x.blob).length, a.slice(0, 6).every(x => x.blob)]) } }; r.onerror = () => rej(r.error) })"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 900})
    if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
    if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
    pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1500)
    # saveHistory stores the page's lastRaw; a small fake is enough for the counts
    save = """async n => { for (let i = 0; i < n; i++) { await window.__saveHistory({ name: 'P' + i, throwHand: 'R', frames: 100, fps: 60 }, new Blob(['x'.repeat(1000)], { type: 'video/webm' })); await new Promise(r => setTimeout(r, 3)) } }"""
    pg.evaluate(save, 8); c = pg.evaluate(COUNT); print("after 8 saves (total, with video, newest 6 have video):", c)
    if c != [8, 6, True]: bad.append(f"after 8: {c}")
    pg.evaluate(save, 26); c = pg.evaluate(COUNT); print("after 34 saves:", c)
    if c != [30, 6, True]: bad.append(f"after 34: {c}")
    # an old pitch with no video opens with its numbers
    pg.evaluate("""raw => new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1); r.onsuccess = () => { const t = r.result.transaction('analyses', 'readwrite'); t.objectStore('analyses').clear();
      t.objectStore('analyses').add({ date: Date.now(), name: 'Old pitch', hand: 'auto', frames: raw.frames.length, fps: raw.fps, data: { name: 'Old pitch' }, blob: null, raw }); t.oncomplete = res; t.onerror = () => rej(t.error) } })""", raw)
    pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(1500)
    meta = pg.evaluate("() => document.querySelector('.rec-meta').textContent"); print("list says:", meta)
    if "no video" not in meta: bad.append("no 'no video' note")
    pg.evaluate("() => document.querySelector('.rec-open').click()"); pg.wait_for_selector("#ptable tbody tr", state="attached", timeout=60000); pg.wait_for_timeout(1500)
    if pg.evaluate("() => !document.getElementById('vidOv').hidden"): bad.append("overlay video offered without a video")
    print("rows in angle table:", pg.locator("#ptable tbody tr").count())
    if len(sys.argv) > 2: pg.screenshot(path=sys.argv[2])
    b.close()
print("page errors:", errs)
if errs or bad: print("FAIL", bad); sys.exit(1)
print("ok")
