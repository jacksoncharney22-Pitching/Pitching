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
    # renaming sticks, in the list and on the results page
    answers = ["Bob bullpen", "Bob"]   # pitch name, then pitcher
    pg.on("dialog", lambda d: d.accept(answers.pop(0)) if answers else d.dismiss())
    pg.evaluate("() => document.querySelector('.rec-ren').click()"); pg.wait_for_timeout(600)
    pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(1000)
    nm = pg.evaluate("() => document.querySelector('.rec-name').textContent"); print("renamed to:", nm)
    if nm != "Bob bullpen": bad.append(f"rename: {nm}")
    pg.evaluate("() => document.querySelector('.rec-open').click()"); pg.wait_for_selector("#ptable tbody tr", state="attached", timeout=60000); pg.wait_for_timeout(1500)
    if pg.evaluate("() => !document.getElementById('vidOv').hidden"): bad.append("overlay video offered without a video")
    t = pg.evaluate("() => window.__lastData && window.__lastData.name")
    if t != "Bob bullpen": bad.append(f"name on results: {t}")
    print("rows in angle table:", pg.locator("#ptable tbody tr").count())
    # the over-time view plots each saved pitch that has the reading
    pg.evaluate("""raw => new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1); r.onsuccess = () => { const t = r.result.transaction('analyses', 'readwrite');
      t.objectStore('analyses').add({ date: Date.now() + 1000, name: 'Newer pitch', hand: 'auto', frames: raw.frames.length, fps: raw.fps, data: { name: 'Newer pitch', pitcher: 'Ann' }, blob: null, raw }); t.oncomplete = res; t.onerror = () => rej(t.error) } })""", raw)
    pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(1500)
    pg.evaluate("() => { document.getElementById('recentWrap').open = true; document.getElementById('trendGo').click() }"); pg.wait_for_selector(".tr-svg", timeout=60000)
    dots = pg.locator(".tr-dot").count(); print("over-time chart points:", dots)
    if dots != 2: bad.append(f"over-time chart: {dots} points, expected 2")
    pg.select_option("#trN", "Bob"); pg.wait_for_timeout(300); dots = pg.locator(".tr-dot").count(); print("points for one pitcher:", dots)
    if dots != 1: bad.append(f"pitcher filter: {dots} points, expected 1")
    pg.evaluate("() => document.getElementById('cmpBack').click()")
    # a new clip from another spot than the pitcher's last one gets the note; from the same spot it doesn't
    sv = "dir => window.__saveHistory({ name: 'Spot', pitcher: 'Bob', throwHand: 'R', frames: 100, fps: 60, cameraDir: dir }, null)"
    openBob = "() => [...document.querySelectorAll('.rec-open')].find(b => b.textContent.includes('Bob bullpen')).click()"
    def note():
        pg.evaluate(openBob); pg.wait_for_selector("#ptable tbody tr", state="attached", timeout=60000); pg.wait_for_timeout(800)
        t = pg.evaluate("() => { const n = document.getElementById('numsChanged'); return n.hidden ? '' : n.textContent }"); pg.evaluate("() => document.querySelector('[data-go=home], #resBack, #backHome')?.click()"); return t
    pg.evaluate(sv, [1, 0, 0]); pg.evaluate(sv, [0, 0, 1]); pg.wait_for_timeout(100); t = note(); print("spot note:", t[:90])
    if "different spot" not in t: bad.append("no different-spot note")
    pg.evaluate(sv, [0.02, 0, 1]); pg.wait_for_timeout(100); t = note()
    if "different spot" in t: bad.append("spot note on the same spot")
    # a pitch saved with only its analysed window as video (keepclip.js): the video starts at that window, so the viewer
    # must be told the pitch starts clipStart seconds earlier than in the upload
    pg.evaluate("""raw => new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1); r.onsuccess = () => { const t = r.result.transaction('analyses', 'readwrite'); t.objectStore('analyses').clear();
      t.objectStore('analyses').add({ date: Date.now(), name: 'Clip pitch', hand: 'auto', frames: raw.frames.length, fps: raw.fps, data: { name: 'Clip pitch' }, blob: new Blob(['x'], { type: 'video/mp4' }), clipStart: (raw.start || 0) - 0.25, raw }); t.oncomplete = res; t.onerror = () => rej(t.error) } })""", raw)
    pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(1500)
    pg.evaluate("() => document.querySelector('.rec-open').click()"); pg.wait_for_selector("#ptable tbody tr", state="attached", timeout=60000); pg.wait_for_timeout(1000)
    st = pg.evaluate("() => window.__lastData && window.__lastData.start")
    print("pitch-only video: start in the saved video", st, "(want 0.25)")
    if st is None or abs(st - 0.25) > 1e-6: bad.append(f"pitch-only video start: {st}")
    if len(sys.argv) > 2: pg.screenshot(path=sys.argv[2])
    b.close()
print("page errors:", errs)
if errs or bad: print("FAIL", bad); sys.exit(1)
print("ok")
