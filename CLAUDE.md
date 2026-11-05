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
- **Cache busting:** `index.html` loads `viewer.js?v=<stamp>` and `app.js?v=<stamp>`. After changing any JS, bump
  the stamp on both lines (use `date +%s`). The other modules are imported by `app.js` without stamps.
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
   `tools/test/baseline.json`. Any FAIL is a behaviour change: either fix it, or, if the new result is
   genuinely better (check the video), re-record with `--update` and say so in the commit.
2. **Full check in the real app:** `python3 tools/test/serve.py . 8766 &` then
   `python3 tools/test/clip_run.py <fast|high|max> <clip.webm> <outdir> strip`. It prints the trim, events, net
   check, fit ("skeleton within X cm of the video") and page errors, and saves `raw_<q>.json`, `app_0..3.png` and
   `strip.png`. **Look at `strip.png`**: the skeleton must match the video through foot strike, arm cocked and
   release. Then run `regress.mjs` on the new raw file.
   - Headless Chromium has no H.264: convert to WebM first (`ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 4M -an out.webm`).
   - In a cloud sandbox the three.js CDNs may be blocked: set `THREE_JS` / `ORBIT_JS` to local files
     (`ORBIT_JS=tools/test/orbit_stub.js` works with any three.js build).
   - Fast takes ~5 min headless on a 4 s clip; Max takes much longer (software GPU).
3. Do not commit pitching videos to this repo (it is published as a website, and most clips are other people's
   footage). Fixtures are tracker output only.

## Reference clips and known-good results

| Clip | What makes it hard | Known good |
| --- | --- | --- |
| Cooper Maher (side, through a net) | Net in front; camera zooms after release | Net detected (k≈19); real speed at 60 fps; leg lift 0.95 s, foot strike ~1.56 s, arm cocked ~1.68 s, release ~1.77 s; fit 2.4 cm (max) / 2.9 cm (fast) |
| Tom Hackimer | Speed-ramped slow motion | Read as 16× slow; no whole-body left/right flips |
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
- Don't change the look of the app without telling the owner first.

## Daily work sessions

A scheduled session runs each weekday morning. It reads `TODO.md`, picks one big project from that weekday's theme
(Mon accuracy, Tue speed and reliability, Wed pitching measurements, Thu testing, Fri coaching report), posts a short
plan to Jackson, then works through it: measure before and after (accuracy benchmark in `tools/test/bench`,
`tools/test/regress.mjs`), ship, keep `TODO.md` up to date, and end with a summary in pitching terms. Items under
"Ideas" or anything changing the look of the app need Jackson's go-ahead first.
