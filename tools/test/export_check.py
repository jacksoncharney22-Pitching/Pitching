# Opens a saved fixture in the real app through the "Recent" history list (no tracking, so it takes seconds), then
# checks that the PDF and CSV downloads say the same as the angle table on screen, and that re-opening the saved
# analysis gives the same numbers again.
#   python3 tools/test/serve.py . 8766 &
#   python3 tools/test/export_check.py <fixture.json[.gz]> <outdir> [--hand R|L]
# The video is a generated test pattern (ffmpeg testsrc), never a real clip. Saves screen.png, the PDF (+ .txt) and
# the CSV in <outdir>, prints mismatches, and exits 1 if any.
# THREE_JS / ORBIT_JS: local three.js r128 files when the CDNs are blocked (see clip_run.py).
import sys, os, json, gzip, subprocess, re, csv, io
from playwright.sync_api import sync_playwright
fx, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
raw = json.load(gzip.open(fx) if fx.endswith(".gz") else open(fx))
name = os.path.basename(fx).split(".")[0]
vfps = raw.get("videoFps") or raw["fps"]
dur = (raw.get("start") or 0) + len(raw["frames"]) / vfps + 1
vid = os.path.join(out, "testsrc.webm")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size={raw['width']}x{raw['height']}:rate={round(vfps)}:duration={dur:.2f}",
                "-c:v", "libvpx-vp9", "-b:v", "1M", "-deadline", "realtime", vid], check=True)
URL = os.environ.get("APP_URL", "http://127.0.0.1:8766/")
T3, ORB = os.environ.get("THREE_JS"), os.environ.get("ORBIT_JS")
errs, bad = [], []

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1400, "height": 1000}, accept_downloads=True)
    pg = ctx.new_page()
    if T3: pg.route("**/three.min.js", lambda r: r.fulfill(path=T3, content_type="application/javascript"))
    if ORB: pg.route("**/OrbitControls.js", lambda r: r.fulfill(path=ORB, content_type="application/javascript"))
    pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    pg.route("**/__testsrc.webm", lambda r: r.fulfill(path=vid, content_type="video/webm"))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1500)
    # a history record like the app saves (data is rebuilt from raw when it's opened)
    pg.evaluate("""async ([raw, name]) => {
      const blob = await (await fetch('__testsrc.webm')).blob();
      await new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('analyses', { keyPath: 'id', autoIncrement: true });
        r.onsuccess = () => { const t = r.result.transaction('analyses', 'readwrite'); t.objectStore('analyses').clear();
          t.objectStore('analyses').add({ date: Date.now(), name, hand: 'auto', frames: raw.frames.length, fps: raw.fps, data: { name }, blob, raw });
          t.oncomplete = res; t.onerror = () => rej(t.error) }; r.onerror = () => rej(r.error) }) }""", [raw, name])

    # first open as soon as the Recent list appears (a visitor clicking straight away), the second after a pause
    # (on a slow connection: every request takes 1.5 s, so the lab-throw library may not have arrived yet)
    cdp = ctx.new_cdp_session(pg)
    def open_saved(pause=0, slow=False):
        cdp.send("Network.enable"); cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 1500 if slow else 0, "downloadThroughput": -1, "uploadThroughput": -1})
        pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(pause)
        pg.evaluate("() => document.querySelector('.rec-open').click()"); pg.wait_for_selector("#ptable tbody tr", state="attached", timeout=60000); pg.wait_for_timeout(1500)
        return pg.evaluate("""() => [...document.querySelectorAll('#ptable tr')].map(tr => [...tr.children].map(td => td.firstChild ? (td.firstChild.textContent || '').trim() : ''))""")
    t1 = open_saved(3000)
    strip = lambda: pg.evaluate("() => document.getElementById('delStrip').innerText.replace(/\\s+/g, ' ').trim()")
    s1 = strip()
    pg.screenshot(path=os.path.join(out, "screen.png"))
    phases = pg.evaluate("() => window.__lastData.phases.filter(p => !['Start','Finish'].includes(p.name)).map(p => [p.name, p.frame])")
    with pg.expect_download(timeout=120000) as d: pg.click("#pdfBtn")
    pdf = os.path.join(out, f"{name}.pdf"); d.value.save_as(pdf)
    with pg.expect_download(timeout=30000) as d: pg.click("#csvBtn")
    csvp = os.path.join(out, f"{name}.csv"); d.value.save_as(csvp)
    t0 = open_saved(0, slow=True)
    s0 = strip()
    t2 = open_saved(3000)                # re-open: the saved record now holds the rebuilt result
    s2 = strip()
    # move foot strike 3 frames later by hand, then re-open: the hand-set foot strike must still be there
    pg.evaluate("() => document.querySelectorAll('#ptable th[data-f]')[1].click()"); pg.wait_for_timeout(300)
    pg.evaluate("() => document.activeElement && document.activeElement.blur()")
    for _ in range(3): pg.evaluate("() => dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))")
    pg.wait_for_timeout(300)
    pg.evaluate("() => { document.getElementById('phaseSel').value = 'footStrike'; document.getElementById('phaseSet').click() }")
    pg.wait_for_selector("#ptable tbody tr", state="attached"); pg.wait_for_timeout(1500)
    fs_set = pg.evaluate("() => window.__lastData.phases.find(p => p.name === 'Foot strike').frame")
    t3 = pg.evaluate("""() => [...document.querySelectorAll('#ptable tr')].map(tr => [...tr.children].map(td => td.firstChild ? (td.firstChild.textContent || '').trim() : ''))""")
    t4 = open_saved(3000)
    fs_back = pg.evaluate("() => window.__lastData.phases.find(p => p.name === 'Foot strike').frame")
    # the slot card says when it was read at a release moved by hand (one frame moves the slot a lot), and only then
    slot_tip = lambda: pg.evaluate("() => { const c = [...document.querySelectorAll('#delStrip .dcard')].find(d => /Arm slot/.test(d.innerText)); return c ? c.title : '' }")
    if "by hand" in slot_tip(): bad.append("slot card says release was set by hand after only foot strike moved")
    pg.evaluate("() => document.querySelectorAll('#ptable th[data-f]')[3].click()"); pg.wait_for_timeout(300)
    pg.evaluate("() => document.activeElement && document.activeElement.blur()")
    pg.evaluate("() => dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))"); pg.wait_for_timeout(300)
    pg.evaluate("() => { document.getElementById('phaseSel').value = 'release'; document.getElementById('phaseSet').click() }")
    pg.wait_for_selector("#ptable tbody tr", state="attached"); pg.wait_for_timeout(1500)
    tip_set = slot_tip()
    pg.screenshot(path=os.path.join(out, "release_by_hand.png")); open_saved(3000); tip_back = slot_tip()
    print("slot card after moving release by hand:", tip_set[-90:])
    if "by hand" not in tip_set or "by hand" not in tip_back: bad.append(f"slot card note for a hand-set release missing (set: {'by hand' in tip_set}, re-opened: {'by hand' in tip_back})")
    # (the record now has release moved by hand; the checks below only look at the trunk-rotation note)
    # a saved number that differs from the rebuilt one by 3° or more gets the note, once; no difference, no note
    note = lambda: pg.evaluate("() => { const n = document.getElementById('numsChanged'); return n.hidden ? null : n.innerText }")
    note_none = note()
    pg.evaluate("""() => new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1); r.onsuccess = () => { const db = r.result;
      db.transaction('analyses').objectStore('analyses').getAll().onsuccess = e => { const it = e.target.result[0], f = it.data.phases.find(p => p.name === 'Release').frame;
        it.data.metrics.trunkRot[f] -= 7; const q = db.transaction('analyses', 'readwrite').objectStore('analyses').put(it); q.onsuccess = res; q.onerror = () => rej(q.error) } } })""")
    open_saved(1000); note_on = note()
    open_saved(1000); note_off = note()
    b.close()

# screen table: {(group, row label): [values at LL, FS, AC, R]}
scr, grp = {}, None
for r in t1:
    if len(r) == 1 or (len(r) > 1 and all(c == "" for c in r[1:])): grp = r[0]; continue
    if r[0] == "Angle" or r[0].startswith("*"): continue
    scr[(grp, r[0])] = r[1:]
if t0 != t1: bad.append("opening a saved analysis straight away on a slow connection gave different numbers")
if t1 != t2: bad.append("re-opening the saved analysis changed the angle table")
if not s1: bad.append("Delivery numbers missing on the results page")
if len({s0, s1, s2}) != 1: bad.append(f"Delivery numbers changed on re-opening: {s1} / {s0} / {s2}")
print("changed-numbers note:", note_on)
if note_none: bad.append(f"changed-numbers note shown with nothing changed: {note_none}")
if not note_on or "Trunk rotation at release" not in note_on: bad.append(f"changed-numbers note missing or wrong: {note_on}")
if note_off: bad.append(f"changed-numbers note shown a second time: {note_off}")
fs_auto = dict(phases)["Foot strike"]
print(f"foot strike: found at frame {fs_auto}, moved by hand to {fs_set}, after re-opening {fs_back}")
if fs_set != fs_auto + 3: bad.append(f"moving foot strike by hand didn't take (frame {fs_auto} -> {fs_set}, wanted {fs_auto + 3})")
if fs_back != fs_set or t3 != t4: bad.append("re-opening lost the foot strike set by hand")
# PDF table rows -> screen rows
PDFROWS = {"Throwing elbow flexion": ("Throwing arm", "Elbow flexion"), "Throwing shoulder abduction": ("Throwing arm", "Shoulder abduction"),
           "Glove arm abduction": ("Glove arm", "Shoulder abduction"), "Lead knee flexion": ("Lead leg", "Knee flexion"),
           "Lead hip flexion": ("Lead leg", "Hip flexion"), "Back knee flexion": ("Back leg", "Knee flexion"),
           "Pelvis rotation": ("Pelvis", "Rotation"), "Trunk rotation": ("Trunk", "Rotation"), "Hip-shoulder separation": ("Trunk", "Hip–shoulder separation"),
           "Trunk forward tilt": ("Trunk", "Forward tilt"), "Trunk side tilt": ("Trunk", "Lateral tilt"), "Pelvis tilt": ("Pelvis", "Lateral tilt")}
txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
open(pdf + ".txt", "w").write(txt)
norm = lambda s: s.replace("°", "").replace("−", "-").replace("—", "-").strip()
for lbl, key in PDFROWS.items():
    m = re.search(r"^\s*" + re.escape(lbl) + r"\s+(.+)$", txt, re.M)
    if not m: bad.append(f"PDF: no row '{lbl}'"); continue
    got = m.group(1).split(); want = [norm(v) for v in scr.get(key, [])]
    if [norm(g) for g in got] != want: bad.append(f"PDF {lbl}: {got} vs screen {scr.get(key)}")
if ("*" in txt) != any("*" in v for v in sum(scr.values(), [])): bad.append("PDF and screen disagree on the * for blurred values")
# CSV: values at each key frame vs the screen (screen shows whole degrees)
rows = list(csv.reader(io.StringIO(open(csvp, encoding="utf-8-sig").read())))
hdr = rows[0]; print("CSV columns:", len(hdr), "rows:", len(rows) - 1)
fcol = next((i for i, h in enumerate(hdr) if h.lower().startswith("frame")), None)
checked = 0
for (g, lbl), vals in scr.items():
    col = next((i for i, h in enumerate(hdr) if h.startswith(f"{g} {lbl} (")), None)
    if col is None or fcol is None: continue
    for (pn, f), v in zip(phases, vals):
        row = next((r for r in rows[1:] if r[fcol] == str(f)), None)
        if row is None or norm(v) in ("-", ""): continue
        cv = row[col]
        if cv == "": bad.append(f"CSV {hdr[col]} at {pn}: empty, screen {v}"); continue
        sv = float(norm(v).replace("*", "").replace(",", "").replace("/s", ""))
        if abs(float(cv) - sv) > 0.51 + (0.5 if "speed" in hdr[col].lower() else 0): bad.append(f"CSV {hdr[col]} at {pn}: {cv} vs screen {v}")
        checked += 1
# delivery numbers: every one on the screen is also in the spreadsheet, after the table
blank = next((i for i, r in enumerate(rows) if not r), None)
dcsv = {r[0]: r[1] for r in rows[blank + 1:] if len(r) == 2} if blank else {}
if blank is None or not dcsv: bad.append("CSV has no delivery numbers")
for k, v in dcsv.items():
    if f"{k} {v}" not in s1: bad.append(f"CSV delivery number {k} = {v} isn't what the screen shows: {s1}")
print("delivery numbers in CSV:", dcsv)
print(f"checked {len(PDFROWS)} PDF rows and {checked} CSV values against the screen")
for e in errs: print("PAGE ERROR:", e)
for x in bad: print("MISMATCH:", x)
print("ok" if not bad and not errs else f"{len(bad)} mismatches, {len(errs)} page errors")
sys.exit(1 if bad or errs else 0)
