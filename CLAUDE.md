# Feole Pitching

Turns a video of a pitcher into a 3D skeleton with delivery events (leg lift, foot strike, arm cocked, release,
finish) and joint angles (pelvis, trunk, hip-shoulder separation, throwing arm, legs). Owner: Jackson Charney.
He is a baseball person, not a programmer: explain results in pitching terms, not code terms, and show him a
picture or numbers from a real clip rather than describing a change.

## How it runs

- **Static site, no build step, no server code.** Everything runs in the visitor's browser; videos never leave it
  (except the optional "Ultra" mode, below). The repo root *is* the website.
- **Deploy = push to `main`.** GitHub Pages (`.nojekyll`) rebuilds in about a minute. `netlify.toml` is there for
  Netlify too. Check with `gh run list -L 3` (the "pages build and deployment" run).
- **Cache busting:** `index.html` loads `viewer.js?v=<stamp>` and `app.js?v=<stamp>`, and an import map gives every
  module app.js imports (pipeline.js, fuse.js, rtm.js, ...) the same stamp. After changing any JS, bump every stamp in
  `index.html` at once: `sed -i -E "s/\?v=[0-9]+/?v=$(date +%s)/g" index.html`. A new module needs a line in the import map.
- `version.txt` is a human-readable version note; update it for notable releases.

## Files

| File | What it does |
| --- | --- |
| `index.html` | All markup and CSS. Loads three.js r128 + OrbitControls from CDNs, fonts from Google Fonts. |
| `app.js` | UI and orchestration: upload, pitch finder/trim, tracking (`trackSimple` for fast/high, `trackMax` for max), slow-motion resolution, results, history (IndexedDB), video export. |
| `pipeline.js` | The analysis, no DOM: `analyse(raw, opts)` builds the 3D skeleton, events and metrics; `detectSlowFactor(raw)` reads the true playback speed from the motion. Runs in Node too. |
| `viewer.js` | 3D skeleton viewer (three.js) and the angle panel. |
| `fuse.js` | Picks the pitcher among detected people; fuses tracker candidates. |
| `rtm.js` + `rtm/`, `ort/` | RTMPose-x tracker (onnxruntime-web, WebGPU/WASM), used by Max accuracy. Weights split into `rtm/*.wasm` parts. |
| `lib/vision_bundle.mjs`, `model/`, `wasm/` | MediaPipe pose landmarker (fast/high, and fallback). |
| `lifter.js` + `lifter/` | Learned 3D depth model (ONNX) that adds how far joints are from the camera. |
| `armzoom.js` | Re-tracks the throwing arm in zoomed crops (Max accuracy). |
| `net.js` | Detects a net/backstop between camera and pitcher and cleans it out of the frames the tracker reads (never out of what the user sees). |
| `multiview.js` | Combines 2–3 camera angles of the same pitch. |
| `editor.js` | Trim editor. |
| `poseworker.js` | Runs the MediaPipe pose models (pitch finder, Fast/High tracker) in a background worker so the page doesn't freeze (falls back to the page; `?poseworker=0` forces that). Checked by `tools/test/finder_check.py [--compare]`. |
| `compare.js` | Compare two saved pitches, and one reading over time. Bold limits come from `tools/test/comparecheck.mjs --json`. |
| `report.js`, `pdf.js` | Coaching report and PDF export. |
| `opencap.js` | Imports OpenCap `.trc` marker files as a skeleton. |
| `ultra.js` + `ultra/` | "Ultra" mode: sends the clip to a Modal GPU service running GVHMR (SMPL-X). `ultra/app.py` is the Modal app. Waiting on the owner's SMPL-X account; credentials live only in GitHub repo secrets and the Modal secret `smplx` (never print or ask for their values). |
| `tools/test/` | Test tools (below). |

Data flow: video → tracker per frame → `raw` (`{fps, videoFps, width, height, frames, l3, slowNote}`) →
`analyse(raw)` → `{phases, pose, metrics, throwHand, …}` → viewer. In the page, the last `raw` is on
`window.__lastRaw` and the net check result on `window.__net`.

## Testing (do this for every change to tracking or analysis)

1. **Fast check, no browser:** `node tools/test/regress.mjs` re-analyses the saved tracker output in
   `tools/test/fixtures/` and compares event times (±0.05 s), speed reading and throwing hand with
   `tools/test/baseline.json`; each clip is also run mirrored as a left-hander (same events and angles, other hand). Any FAIL is a behaviour change: either fix it, or, if the new result is
   genuinely better (check the video), re-record with `--update` and say so in the commit.
   For speed-only changes, `node tools/test/samecheck.mjs --save before.json` on the old code and `samecheck.mjs before.json` on the new must say "all results identical" (it also prints the time).
   For skeleton changes also run `node tools/test/perview.mjs <copy of the previous version>`: the averages can hide a reading getting much worse on a few views.
   `node tools/test/slowmo.mjs` checks the slow-motion reading on every benchmark pitch at 1×/2×/4×/8× (~4 min).
   Both run on GitHub Actions on every push (`.github/workflows/tests.yml`); a red X on a commit means one failed.
2. **Full check in the real app:** `python3 tools/test/serve.py . 8766 &` then
   `python3 tools/test/clip_run.py <fast|high|max> <clip.webm> <outdir> strip`. It prints the trim, events, net
   check, fit ("skeleton within X cm of the video") and page errors, and saves `raw_<q>.json`, `app_0..3.png` and
   `strip.png`. **Look at `strip.png`**: the skeleton must match the video through foot strike, arm cocked and
   release. Then run `regress.mjs` on the new raw file.
   - Headless Chromium used to have no H.264 (the cloud sandbox's one plays it as of 2026-11-10); if a clip won't load, convert to WebM (`ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 4M -an out.webm`).
   - In a cloud sandbox the three.js CDNs may be blocked: set `THREE_JS` / `ORBIT_JS` to local files
     (`ORBIT_JS=tools/test/orbit_stub.js` works with any three.js build).
   - Fast takes ~5 min headless on a 4 s clip; Max takes much longer (software GPU).
   - Exports and saved history: `python3 tools/test/export_check.py tools/test/fixtures/<clip>.json.gz <outdir>` opens
     a fixture through the Recent list (seconds, no tracking) and checks the PDF and CSV match the screen, that
     re-opening (also straight away on a slow connection) gives the same numbers, and that a hand-moved foot strike
     survives re-opening.
3. Do not commit pitching videos to this repo (it is published as a website, and most clips are other people's
   footage). Fixtures are tracker output only.

## Reference clips and known-good results

| Clip | What makes it hard | Known good |
| --- | --- | --- |
| Cooper Maher (side, through a net) | Net in front; camera zooms after release | Net detected (k≈19); real speed at 60 fps; leg lift 0.95 s, foot strike ~1.56 s, arm cocked ~1.72 s (the app now keeps it 17-50 ms before release, as on every lab pitch), release ~1.75-1.77 s; fit 2.4 cm (max) / 2.9 cm (fast) |
| Tom Hackimer | Speed-ramped slow motion | Read as 16× slow; no whole-body left/right flips; foot strike ~0.45-0.47 s, arm cocked ~0.57 s, release ~0.59 s (2026-11-09, not yet checked by eye) |
| Jordan Staumont | Camera behind the pitcher | Shoulders not mirrored; real speed |
| Sale, Ohtani, Flaherty, McKenzie, Joyce | Crowds/fences behind | Net check must stay **off** |

Past bugs worth guarding against: the follow-through mistaken for release (made Maher read as 2× slow, arm looked
like it was "falling"); left/right whole-body flips in slow motion; mirrored shoulders from behind; crowds
detected as a net.

## Conventions

- Plain JavaScript ES modules, no framework, no bundler, no npm dependencies at runtime.
- Code comments explain *why* in plain language; keep that style.
- Keep backups or small focused commits; commit messages describe the effect for the pitcher/clip, e.g.
  "Clips filmed through a net: …".
- Jackson gave free rein (2026-11-09): the look and layout of the app, the report and the PDF can be changed
  without asking, when it makes the app better for pitchers and coaches. Check every look change with screenshots
  at desktop and phone width, keep everything that worked working, and tell him what changed (with a screenshot or
  a clear description) in the notification and the end-of-day summary.

## Working with Jarvis

Jackson also runs **Jarvis**, a Claude Managed Agent with its own copy of this repo (`/workspace/Pitching`), pushing
to `main` like the hourly sessions. Jarvis and the hourly sessions coordinate only through `TODO.md`:
- Before starting an item, write "(<who> working on this, <time ET>)" next to it in "Today", commit and push, so two
  workers never take the same item. Skip items another worker has claimed in the last 2 hours.
- Pull (rebase) right before every push; never force-push `main`.
- Sign "Today" notes with who wrote them ("Jarvis 10:15:", "9:40 session:").

## Daily work sessions

Work runs all day, every day: a planning session at 8:15 ET, then a work session every hour at :40, round the clock
(9:40 through 7:40 the next morning). Each one works until just before the next starts and hands over through the
"Today" section of `TODO.md`. Themes: Mon accuracy, Tue speed and reliability, Wed pitching measurements, Thu
testing, Fri coaching report, Sat accuracy, Sun testing; any session may take on whatever will make the app better
(new features, look and layout, "Ideas" items) once the day's project is done or blocked. Every finished item sends
Jackson a phone notification; the 21:40 session sends the day's summary. Measure before and after (accuracy
benchmark `node tools/test/bench.mjs`, `tools/test/regress.mjs`), ship, keep `TODO.md` up to date.
