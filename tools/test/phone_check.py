# Phone check: open the app as an iPhone and an Android phone, open a saved pitch from Recent,
# and report page errors, sideways scrolling, things wider than the screen and tiny tap targets.
#   python3 tools/test/phone_check.py <fixture.json.gz> <outdir>
# (server and THREE_JS / ORBIT_JS as in export_check.py). Prints, per screen: sideways scroll in px, things wider than
# the screen, and buttons under 32 px (too small for a thumb); saves screenshots. Emulated in Chromium, not real Safari.
import sys, os, json, gzip
from playwright.sync_api import sync_playwright
raw = json.load(gzip.open(sys.argv[1])); OUT = sys.argv[2]; os.makedirs(OUT, exist_ok=True)
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/"); T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")

AUDIT = """() => {
  const W = document.documentElement.clientWidth, out = {sideScroll: document.documentElement.scrollWidth - W, wide: [], tiny: []};
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const name = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '');
    let p = el.parentElement, clipped = false;
    while (p && p !== document.body) { const pc = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(pc.overflowX)) { clipped = true; break } p = p.parentElement }
    if (!clipped && (r.right > W + 1 || r.left < -1)) out.wide.push(name + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    if (el.matches('button, a[href], input, select, label.btn, [role=button]') && (r.height < 32 || r.width < 32) && el.offsetParent) out.tiny.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent||el.value||'').trim().slice(0,20) + '"');
  }
  out.wide = out.wide.slice(0, 15); out.tiny = [...new Set(out.tiny)].slice(0, 25); return out }"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for dev in ("iPhone 13", "Pixel 7"):
        errs = []; tag = dev.replace(" ", "_")
        ctx = b.new_context(**p.devices[dev]); pg = ctx.new_page()
        if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
        if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
        pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.on("console", lambda m: m.type == "error" and errs.append("console: " + m.text[:200]))
        pg.goto(URL); pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{OUT}/{tag}_1_home.png", full_page=True)
        print(dev, "HOME", pg.evaluate(AUDIT))
        pg.evaluate("""raw => new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1); r.onupgradeneeded = () => r.result.createObjectStore('analyses', { keyPath: 'id', autoIncrement: true });
          r.onsuccess = () => { const t = r.result.transaction('analyses', 'readwrite'); t.objectStore('analyses').add({ date: Date.now(), name: 'Bullpen pitch', hand: 'auto', frames: raw.frames.length, fps: raw.fps, data: { name: 'Bullpen pitch' }, blob: null, raw }); t.oncomplete = res; t.onerror = () => rej(t.error) } })""", raw)
        pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(800)
        pg.locator("#recentWrap > summary").tap(); pg.wait_for_timeout(500)
        pg.screenshot(path=f"{OUT}/{tag}_2_recent.png", full_page=True)
        print(dev, "RECENT", pg.evaluate(AUDIT))
        pg.locator(".rec-open", has_text="Bullpen").first.tap()
        pg.wait_for_selector("#ptable tbody tr", state="attached", timeout=90000); pg.wait_for_timeout(2500)
        pg.screenshot(path=f"{OUT}/{tag}_3_results_top.png")
        pg.screenshot(path=f"{OUT}/{tag}_4_results_full.png", full_page=True)
        print(dev, "RESULTS", pg.evaluate(AUDIT))
        print(dev, "page errors:", errs)
        ctx.close()
    b.close()
