# Checks the two "Download video" files against the analysis: right length, and in the overlay video each picture really is the
# source frame the skeleton on it was computed for (no stale, skipped or shifted frames, so the skeleton can't drift off the pitcher).
#   python3 tools/test/serve.py . 8766 &
#   python3 tools/test/video_check.py <fixture.json[.gz]> <outdir>
# The source video is generated (never a real clip): every frame carries its own number as a black/white barcode across the top.
# THREE_JS / ORBIT_JS: local three.js files when the CDNs are blocked (see clip_run.py).
import sys, os, json, gzip, subprocess
import numpy as np
from playwright.sync_api import sync_playwright
fx, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
raw = json.load(gzip.open(fx) if fx.endswith(".gz") else open(fx))
name = os.path.basename(fx).split(".")[0]
vfps = raw.get("videoFps") or raw["fps"]
W, H = raw["width"] & ~1, raw["height"] & ~1
BITS, BAND, SPAN = 12, 0.12, 0.55   # 12 bits of frame number in the top 12% of the picture, left part only (the overlay draws its angle panel top right)
total = int(((raw.get("start") or 0) + len(raw["frames"]) / vfps + 1) * vfps)
vid = os.path.join(out, "barcode.webm")
def bar(n):
    f = np.full((H, W, 3), 90, np.uint8)
    for b in range(BITS):
        x0, x1 = int(W * SPAN * b / BITS), int(W * SPAN * (b + 1) / BITS)
        f[: int(H * BAND), x0:x1] = 255 if (n >> (BITS - 1 - b)) & 1 else 0
    return f
ff = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(vfps), "-i", "-",
                       "-c:v", "libvpx-vp9", "-b:v", "2M", "-deadline", "realtime", "-cpu-used", "8", "-g", "1", vid], stdin=subprocess.PIPE)
for n in range(total): ff.stdin.write(bar(n).tobytes())
ff.stdin.close(); ff.wait()
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
    pg.evaluate("""async ([raw, name]) => {
      const blob = await (await fetch('__testsrc.webm')).blob();
      await new Promise((res, rej) => { const r = indexedDB.open('charney-pitching', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('analyses', { keyPath: 'id', autoIncrement: true });
        r.onsuccess = () => { const t = r.result.transaction('analyses', 'readwrite'); t.objectStore('analyses').clear();
          t.objectStore('analyses').add({ date: Date.now(), name, hand: 'auto', frames: raw.frames.length, fps: raw.fps, data: { name }, blob, raw });
          t.oncomplete = res; t.onerror = () => rej(t.error) }; r.onerror = () => rej(r.error) }) }""", [raw, name])
    pg.reload(); pg.wait_for_selector(".rec-open", state="attached"); pg.wait_for_timeout(1500)
    pg.evaluate("() => document.querySelector('.rec-open').click()"); pg.wait_for_selector("#ptable tbody tr", state="attached", timeout=60000); pg.wait_for_timeout(2000)
    info = pg.evaluate("() => { const d = window.__lastData; return { frames: d.frames, start: d.start ?? null, videoFps: d.videoFps ?? null, fps: d.fps } }")
    def grab(btn, path):
        with pg.expect_download(timeout=280000) as d: pg.evaluate(f"() => document.getElementById('{btn}').click()")
        d.value.save_as(path)
    ov, sk = os.path.join(out, "overlay.mp4"), os.path.join(out, "skeleton.mp4")
    grab("vidOv", ov); pg.wait_for_timeout(3000); grab("vidSkel", sk)
    b.close()
def count(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip().split(",")
    return int(r[0]), int(r[1]), int(r[2])
T = info["frames"]; rate = 0.5; print("analysis:", info)
for label, path in (("overlay", ov), ("skeleton", sk)):
    w, h, n = count(path); dur = T / (raw.get("videoFps") or raw["fps"])
    want = int(np.ceil(dur / rate * 30)) + 1 + 20
    print(f"{label}: {w}x{h}, {n} frames (expected {want})")
    if n != want: bad.append(f"{label} video has {n} frames, expected {want}")
# read each overlay picture's barcode
w, h, _ = count(ov)
p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-i", ov, "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)
seq = []
while True:
    buf = p.stdout.read(w * h)
    if len(buf) < w * h: break
    f = np.frombuffer(buf, np.uint8).reshape(h, w); n = 0
    for b_ in range(BITS):
        x0, x1 = int(w * SPAN * b_ / BITS), int(w * SPAN * (b_ + 1) / BITS)
        n = n * 2 + (1 if np.median(f[int(h * BAND * 0.2):int(h * BAND * 0.8), x0 + 3:x1 - 3]) > 127 else 0)
    seq.append(n)
s0 = int(round((raw.get("start") or 0) * vfps))
N = len(seq) - 20; moving = seq[:N]
ft = lambda i: max(0, min(T - 1, min(T / vfps, i / 30 * rate) * vfps - 0.5))
exp = [s0 + int(np.floor(ft(i) + 0.5)) for i in range(N)]   # Math.round, as in viewer.js (Python rounds halves to even)
off = [a - b for a, b in zip(moving, exp)]
print(f"source frames shown: {moving[0]} .. {moving[-1]} (expected {exp[0]} .. {exp[-1]}); wrong frames: {sum(1 for o in off if o)} of {N}, largest offset {max(off, key=abs)}")
if any(abs(o) > 1 for o in off): bad.append(f"overlay shows the wrong source frame on {sum(1 for o in off if abs(o) > 1)} of {N} pictures")
if sum(1 for o in off if o) > 0.1 * N: bad.append(f"overlay is one frame off on {sum(1 for o in off if o)} of {N} pictures")
if errs: bad.append("page errors: " + "; ".join(errs[:3]))
print("\n".join("BAD: " + x for x in bad) or "videos match the analysis")
sys.exit(1 if bad else 0)
