#!/usr/bin/env python3
"""The pose-model worker quitting in the middle of the pitch finder: does the page carry on by itself?

  python3 tools/test/serve.py . 8766 &
  python3 tools/test/posestall_check.py [outdir]

Serves a poseworker.js that answers 6 frames and then quits without a word (as a phone short of memory can do),
uploads a 2 s test-pattern clip and waits for the pitch finder. Fails unless the finder finishes (on the page,
window.__poseFellBack set) within 90 s and there are no page errors. Normal run ~20 s headless; this one ~45 s.
THREE_JS / ORBIT_JS as for export_check.py if the CDNs are blocked.
"""
import os, sys, time, subprocess
from playwright.sync_api import sync_playwright
out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/posestall"; os.makedirs(out, exist_ok=True)
vid = os.path.join(out, "testsrc.webm")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=60:duration=2",
                "-c:v", "libvpx-vp9", "-b:v", "2M", "-deadline", "realtime", vid], check=True)
here = os.path.dirname(os.path.abspath(__file__))
real = open(os.path.join(here, "..", "..", "poseworker.js")).read()
HEAD = "self.onmessage = async ({ data: m }) => {"
assert HEAD in real, "poseworker.js changed: update the stub"
stub = real.replace(HEAD, "let quitAfter = 0;\n" + HEAD + "\n  if (m.type === 'detect' && ++quitAfter > 6) { self.close(); return }", 1)
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/index.html"); T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]); pg = b.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
    if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
    pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    pg.route("**/poseworker.js*", lambda r: r.fulfill(body=stub, content_type="application/javascript"))
    pg.goto(URL); pg.wait_for_timeout(1500)
    pg.set_input_files("#fileIn", vid); t0 = time.time(); fm = ""
    while time.time() - t0 < 300:
        fm = pg.evaluate("document.getElementById('pitchFindMsg').innerText.replace(/\\s+/g, ' ')")
        if fm and "Finding" not in fm: break
        pg.wait_for_timeout(2000)
    secs = time.time() - t0; fell = pg.evaluate("window.__poseFellBack || ''"); b.close()
ok = secs < 90 and fell and fm and "Finding" not in fm and not errs
print(f"{'ok  ' if ok else 'FAIL'} finder finished in {secs:.0f} s after the worker quit (carried on on the page: {fell or 'no'}): {fm[:90]!r}"
      + (f", page errors {errs}" if errs else ""))
sys.exit(0 if ok else 1)
