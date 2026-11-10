#!/usr/bin/env python3
"""Is the "about N s left" on the tracking screen honest on a slow device?

  python3 tools/test/serve.py . 8766 &
  python3 tools/test/eta_check.py <clip.webm> [cpu slow-down, e.g. 4] [fast|high]

Runs the clip through the real page with Chromium's CPU slow-down (CDP Emulation.setCPUThrottlingRate), reads the
progress line every 3 s until the tracking ends, and compares each "about ... left" with the time it actually took.
Prints the guesses (said vs real) and the worst ratio; FAIL if a guess made after 25% of tracking is off by more than 2x.
THREE_JS / ORBIT_JS as for export_check.py if the CDNs are blocked. A test-pattern clip is fine (nobody in it still tracks).
"""
import sys, os, re, time
from playwright.sync_api import sync_playwright
VID = sys.argv[1]; RATE = float(sys.argv[2]) if len(sys.argv) > 2 else 4; Q = sys.argv[3] if len(sys.argv) > 3 else "fast"
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/index.html"); T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")
def secs(txt):
    m = re.search(r"about (\d+) (s|min) left", txt or "")
    return None if not m else int(m.group(1)) * (60 if m.group(2) == "min" else 1)
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
    if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
    pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    pg.goto(URL); pg.wait_for_timeout(1500)
    pg.select_option("#qualSel", Q); pg.set_input_files("#fileIn", VID)
    for i in range(300):
        fm = pg.evaluate("document.getElementById('pitchFindMsg').textContent")
        if fm and "Finding" not in fm: break
        pg.wait_for_timeout(1000)
    cdp = pg.context.new_cdp_session(pg); cdp.send("Emulation.setCPUThrottlingRate", {"rate": RATE})
    pg.click("#analyze"); t0 = time.time(); seen = []
    while time.time() - t0 < 3600:
        st = pg.evaluate("[document.body.dataset.view, document.querySelector('#stTrack').dataset.state, document.querySelector('#stTrack small').textContent, document.getElementById('bar').style.width]")
        if st[0] != "progress" or st[1] == "done": break
        seen.append((time.time() - t0, st[2], st[3])); pg.wait_for_timeout(3000)
    tEnd = time.time() - t0
    print(f"CPU x{RATE}, {Q}: tracking ended after {tEnd:.0f} s (view {st[0]})")
    worst = 1; bad = 0
    for t, txt, w in seen:
        s = secs(txt)
        if s is None: continue
        real = tEnd - t; r = max(s, 1) / max(real, 1); frac = t / tEnd
        flag = frac > 0.25 and (r > 2 or r < 0.5); bad += flag
        if frac > 0.25: worst = max(worst, r, 1 / r)
        print(f"  {t:5.0f} s ({w:>6}): said {s:4d} s left, really {real:4.0f} s  x{r:.2f}{'  <-- off' if flag else ''}")
    print(f"worst guess after 25%: x{worst:.2f}"); b.close()
sys.exit(1 if bad else 0)
