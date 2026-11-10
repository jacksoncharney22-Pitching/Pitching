#!/usr/bin/env python3
"""The skeleton-build worker going wrong in the middle of a build: does the page take over quickly, with the same numbers?

  python3 tools/test/serve.py . 8766 &
  python3 tools/test/anastall_check.py tools/test/fixtures/staumont_fast.json.gz [outdir]

Opens a saved fixture through the Recent list (like export_check.py, a test-pattern video, no tracking) five ways:
  normal   the real worker                                     -> built in the worker
  silent   a worker that takes the request and never answers  -> page takes over after the stall limit
  dies     a worker that says "still here" once, then quits     -> page takes over after the stall limit
  crash    a worker whose script fails to load                 -> page takes over at once
  slow     the real worker, but it spends 10 s first, saying "still here" every 2 s  -> must stay in the worker
The page runs with ?anastall=6 (6 s of silence = stopped), so the whole check takes about a minute. Fails unless every
way shows the same angle table as normal, the right place (worker/page), no page errors, and the take-over came
within stall limit + 8 s. THREE_JS / ORBIT_JS as for export_check.py if the CDNs are blocked.
"""
import sys, os, json, gzip, subprocess, time
from playwright.sync_api import sync_playwright

fx = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/anastall"
os.makedirs(out, exist_ok=True)
raw = json.load(gzip.open(fx) if fx.endswith(".gz") else open(fx))
name = os.path.basename(fx).split(".")[0]
vfps = raw.get("videoFps") or raw["fps"]
dur = (raw.get("start") or 0) + len(raw["frames"]) / vfps + 1
vid = os.path.join(out, "testsrc.webm")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size={raw['width']}x{raw['height']}:rate={round(vfps)}:duration={dur:.2f}",
                "-c:v", "libvpx-vp9", "-b:v", "1M", "-deadline", "realtime", vid], check=True)
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/") + "?anastall=6"
T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")
here = os.path.dirname(os.path.abspath(__file__))
real = open(os.path.join(here, "..", "..", "analysisworker.js")).read()
HOOK = "self.onmessage = async ({ data: m }) => {\n  alive(m.id);"
assert HOOK in real, "analysisworker.js changed: update the 'slow' stub"
STUBS = {
    "normal": None,
    "silent": "self.onmessage = () => {};",
    "dies": "self.onmessage = ({ data }) => { self.postMessage({ id: data.id, alive: true }); self.close() };",
    "crash": "throw new Error('broken worker (test)');",
    "slow": real.replace(HOOK, HOOK + "\n  for (let k = 0; k < 5; k++) { await new Promise(r => setTimeout(r, 2000)); alive(m.id) }"),
}
WANT = {"normal": "worker", "silent": "page", "dies": "page", "crash": "page", "slow": "worker"}
TABLE = """() => [...document.querySelectorAll('#ptable tr')].map(tr => [...tr.children].map(td => td.firstChild ? (td.firstChild.textContent || '').trim() : ''))"""
bad, ref = 0, None

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    for way, stub in STUBS.items():
        ctx = b.new_context(viewport={"width": 1400, "height": 1000})
        pg = ctx.new_page(); errs = []
        if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
        if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
        pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
        pg.route("**/__testsrc.webm", lambda r: r.fulfill(path=vid, content_type="video/webm"))
        if stub is not None:
            serve = (lambda body: (lambda r: r.fulfill(body=body, content_type="application/javascript")))(stub)
            pg.route("**/analysisworker.js*", serve)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(1500)
        pg.evaluate("""async ([raw, name]) => {
          const blob = await (await fetch('__testsrc.webm')).blob();
          await new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('analyses', { keyPath: 'id', autoIncrement: true });
            r.onsuccess = () => { const t = r.result.transaction('analyses', 'readwrite'); t.objectStore('analyses').clear();
              t.objectStore('analyses').add({ date: Date.now(), name, hand: 'auto', frames: raw.frames.length, fps: raw.fps, data: { name }, blob, raw });
              t.oncomplete = res; t.onerror = () => rej(t.error) }; r.onerror = () => rej(r.error) }) }""", [raw, name])
        pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(2000)
        t0 = time.time()
        pg.evaluate("() => document.querySelector('.rec-open').click()")
        pg.wait_for_selector("#ptable tbody tr", state="attached", timeout=120000)
        secs = time.time() - t0
        pg.wait_for_timeout(1000)
        tab = pg.evaluate(TABLE)
        where = pg.evaluate("() => window.__anaWhere || ''")
        why = pg.evaluate("() => window.__anaFellBack || ''")
        if way == "normal": ref = tab
        same = tab == ref
        quick = secs < 6 + 8 + (10 if way == "slow" else 0)
        ok = same and where == WANT[way] and quick and not errs
        bad += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {way:7s} results in {secs:5.1f} s, built on the {where or '?'}"
              f"{' (' + why + ')' if why else ''}, same numbers as normal: {same}" + (f", page errors: {errs}" if errs else ""))
        if way == "silent": pg.screenshot(path=os.path.join(out, "silent.png"))
        ctx.close()
    b.close()
sys.exit(1 if bad else 0)
