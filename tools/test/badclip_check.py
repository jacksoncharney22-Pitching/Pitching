#!/usr/bin/env python3
"""Odd uploads through the real page: does the coach always get a plain message (or results), never a hang or a page error?

  python3 tools/test/serve.py . 8766 &
  python3 tools/test/badclip_check.py <outdir> [names...]

Makes each file with ffmpeg (test patterns, never real clips), uploads it like a coach would, waits for the pitch
finder, presses Build skeleton (Fast) and waits for either the results or a message on the trim screen.
  notvideo   random bytes called clip.mp4
  audio      a sound-only .webm (no picture)
  short      0.3 s test pattern
  noperson   2 s test pattern at 60 fps (nobody in it)
  portrait4k 1.5 s portrait 2160x3840 test pattern
Prints, per file: what the finder said, how the build ended (results / message / still busy at the limit), the
message text, seconds, page errors. FAIL if a page error, a message with programmer words, or still busy at the limit.
THREE_JS / ORBIT_JS as for export_check.py if the CDNs are blocked. Takes several minutes (Fast tracking is slow headless).
"""
import sys, os, subprocess, time, re
from playwright.sync_api import sync_playwright

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
pick = sys.argv[2:]
FF = ["ffmpeg", "-loglevel", "error", "-y"]
def make(name):
    p = os.path.join(out, name + (".mp4" if name == "notvideo" else ".webm"))
    if name == "notvideo": open(p, "wb").write(os.urandom(200000))
    elif name == "audio": subprocess.run(FF + ["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "libopus", p], check=True)
    elif name == "short": subprocess.run(FF + ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=0.3", "-c:v", "libvpx-vp9", "-b:v", "1M", "-deadline", "realtime", p], check=True)
    elif name == "noperson": subprocess.run(FF + ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=60:duration=2", "-c:v", "libvpx-vp9", "-b:v", "2M", "-deadline", "realtime", p], check=True)
    elif name == "portrait4k": subprocess.run(FF + ["-f", "lavfi", "-i", "testsrc2=size=2160x3840:rate=30:duration=1.5", "-c:v", "libvpx-vp9", "-b:v", "8M", "-deadline", "realtime", "-cpu-used", "8", p], check=True)
    return p
NAMES = pick or ["notvideo", "audio", "short", "noperson", "portrait4k"]
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/index.html")
T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")
LIMIT = int(os.environ.get("BADCLIP_LIMIT", "600"))
CODEY = re.compile(r"undefined|NaN|TypeError|ReferenceError|null\b|is not a function|Cannot read|\[object", re.I)
bad = 0
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"])
    for name in NAMES:
        f = make(name)
        pg = b.new_page(viewport={"width": 1280, "height": 900}); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
        if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
        pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
        pg.goto(URL); pg.wait_for_timeout(1500)
        pg.select_option("#qualSel", "fast"); pg.set_input_files("#fileIn", f); t0 = time.time()
        perr = lambda: pg.evaluate("(() => { const e = document.getElementById('prepErr'); return e && !e.hidden ? e.textContent.trim() : '' })()")
        for i in range(120):
            fm = pg.evaluate("document.getElementById('pitchFindMsg').textContent.trim()")
            if (fm and "Finding" not in fm) or perr(): break
            pg.wait_for_timeout(1000)
        tf = time.time() - t0
        pg.screenshot(path=os.path.join(out, f"{name}_prep.png"))
        msg0 = perr()
        state, msg = "?", msg0
        if not pg.evaluate("document.getElementById('analyze').disabled"):
            pg.click("#analyze"); t1 = time.time(); state = "busy"
            while time.time() - t1 < LIMIT:
                v = pg.evaluate("document.body.dataset.view")
                if v == "results": state = "results"; break
                if v == "prep":
                    state = "message"; msg = perr() or "(back on the trim screen, no message)"; break
                if v == "home": state = "home"; break
                pg.wait_for_timeout(2000)
            if state == "busy": msg = pg.evaluate("document.getElementById('progress').innerText.replace(/\\s+/g, ' ').slice(0, 200)")
            pg.screenshot(path=os.path.join(out, f"{name}_end.png"))
        else: state = "build disabled"
        secs = time.time() - t0
        ok = not errs and state != "busy" and not CODEY.search(msg or "") and not CODEY.search(fm or "")
        bad += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {name:10s} finder ({tf:.0f} s): {fm[:110]!r}\n     build: {state} after {secs:.0f} s: {msg[:220]!r}"
              + (f"\n     page errors: {errs[:3]}" if errs else ""), flush=True)
        pg.close()
    b.close()
sys.exit(1 if bad else 0)
