# Feole Pitching to-do list

The daily work session picks its work from here. Jackson adds items any time ("add X to the list").
Each day has a theme (Sat = accuracy, Sun = testing). Pick **one big project** from today's theme (a few hours of real work: measure, build,
test, ship), then quick items if time is left. Top of each list = most important. Move finished items to Done
with the date. When a theme has fewer than 3 items left, add new ones that fit it (and say so in the summary).

Measure before and after every change. The accuracy benchmark (`tools/test/bench`, 10 real pitches with
motion-capture truth, 5 camera angles each) is the scorecard for anything that claims to be "more accurate".

## Today (2026-11-10, Tuesday: speed and reliability; plan written 8:15 ET)
Most Tuesday items were finished overnight (workers for finder/tracker/analysis/Max, faster analysis, pitch-only Recent
video, phone buttons). The rebuild is Jackson's top priority and step 4 needs no clip, so it's today's big project.

**Big project: rebuild step 4 — does the lab-matched body (`?bodyfit=1`) follow UNUSUAL deliveries, and is it reliable
enough to become the default?** The fit pulls every pitcher toward real lab deliveries; the risk is that a sidearm,
very short/long stride, slide-step or big trunk tilt gets flattened toward "average". Steps:
1. Build `tools/test/unusual.mjs`: pick the most unusual lab deliveries NOT in the benchmark (lowest/highest arm slot,
   shortest/longest stride, most/least trunk tilt at release, quickest leg lift = slide-step-like, lefties), rebuild a
   library WITHOUT them (`bodylib_build.py --exclude`), make 2D "tracker" points by projecting their true 3D through
   the 5 benchmark cameras with tracker-like noise (noise measured from bench raw vs truth), and score app vs app+fit
   on joints, arm slot, stride, trunk tilt, separation. (Lab data: download steps in the rebuild section.)
2. Find where the fit flattens an unusual pitcher (signed error on the reading that makes him unusual) and fix it
   (weaker prior on the shapes the video clearly decides, or a 2D-residual check that falls back to the app's own
   body), without losing the benchmark gains (`BODYFIT=1 bench.mjs`, perview --check).
3. "How unusual is this delivery": distance from the library average (in shapes), shown as a plain note if the fit
   is trusted less there; report it per test pitcher.
4. Speed/reliability of the fit (Tuesday): it adds 0.4-0.7 s per analysis; profile and cut it (samecheck-identical),
   and make sure a fit that fails or produces junk can never break a build (fallback to the app's body, page-error check).
- Follow-on items (in order, any session):
  (a) DONE/closed 9:40 (no gain, see below) Analysis memory/GC: typed arrays in the hottest loops (despike tried, slower: try `lift`/`oePass`), samecheck-identical.
  (b) Max accuracy profile on the synthetic clip: where do the minutes go (tracker passes, arm-zoom, net, learned 3D)?
  (c) A visible "Lab-matched body (trial)" switch on the trim screen instead of the URL flag (look change, screenshots
      at desktop and phone width), so Jackson can try it without editing the address.
  (d) Late-started slow motion (Thursday list): the 18:40 window idea (fixed fraction of foot strike->release,
      interpolated), test at 2x first.
  (e) Delete the old `wip-max-worker` branch (everything is on main). 7:40: deleting a branch is blocked for these sessions
      (permission), so leave it; it does no harm. (Its parallel re-read pool shipped 7:40, 1153829.)
- **8:15 session progress (big project):** step 1 DONE: `tools/test/unusual_make.py` (14 unusual lab pitchers not in the
  benchmark: 2 each sidearm-ish, very high slot, short stride, long stride, quick leg lift, big side tilt, lefty; truth put in
  the benchmark frame via a donor benchmark pitch (lab->truth fit 0-0.9 cm), tracker points = true projection through the
  donor view's fitted camera + the donor view's OWN tracker error at the same moment of the delivery (2D, world, learned
  depth)); validated with `--selftest` (benchmark pitches remade from another pitch's noise: app joints 9.9 -> 10.6 cm,
  angles 6.8 -> 7.8: slightly harder than the real views, same picture). `node tools/test/unusual.mjs <dir> <lib>` scores
  app vs fit, signed, plus "keeps % of the pitcher's own difference" (slope of reading vs truth). Lab data download steps:
  rebuild section; `python3 tools/bodylib_build.py <landmarks> <metadata> --exclude <dir>/exclude_users.txt <out.json>`
  makes the library without them. Also works on the real benchmark: `node tools/test/unusual.mjs tools/test/bench tools/test/bench/bodylib_holdout.json`.
  Step 2 SHIPPED (trial flag): FINDING: the fit flattened unusual pitchers toward the lab average (front knee kept 31-44%
  of his difference vs app 80%, worse error than the app alone 8.4 vs 6.6 deg; trunk turn late 49-56% vs 86-88%;
  separation 54-63% vs 86-93%). Fix: after the fit, knees/feet move fully and hips/shoulders half-way toward the tracker's
  2D point in the picture plane (depth stays the fit's; per frame, clipped 4%, smoothed 20 ms): unusual front knee
  8.4/7.4/8.2 -> 6.1/5.0/5.3, separation 6.1/6.6/6.8 -> 5.5/5.7/5.8; benchmark joints 7.9 -> 7.6 cm, arm 8.8 -> 8.5,
  knee 5.3/5.1/6.5 -> 5.0/4.4/4.8, separation 4.7/3.6/4.7 -> 4.1/3.3/4.0 (d64d205, 1022b80). Weaker prior (lam 0.15/0.3)
  barely helps (knee 8.4 -> 8.0); full share on shoulders makes benchmark trunk at arm cocked noisier.
  Step 3 DROPPED as a screen note: the fit's distance from the library average barely separates the unusual pitchers
  (mean 9.2 vs 8.5 for the benchmark's, camera-to-camera spread +-2-3), so it can't tell a coach "unusual".
  Step 4: fit 2.8x faster, bit-identical (f508209, 0.40 -> 0.14 s per clip); fit refused when its median 2D miss > 7% of
  body height (8c7ca8e; lab 1.6-4.1%, Maher/Staumont 3.7-4.2%, scrambled clips 9-37%, Hackimer 8.4% -> app body;
  `tools/test/fitguard.mjs` on GitHub).
  Still open from the big project: side tilt with the fit on the extremes (1393/1729 big tilt read 7-10 deg too small,
  2905 tiny tilt +7): fit keeps 72-75% at MER/BR vs app ~100%; pelvis late 54-61% (app 55-65%: both low). Stride with the
  fit keeps 58% (app 64%). App alone (not the fit): arm slot keeps 80% (sidearm reads +13-14 deg high, very high slots
  -3 to -9), shoulder abduction at MER/BR only 51-55%, layback 60-63% (the lab-throw arm match is what keeps them that
  high: without it 26-39%): worth a Monday/Saturday look.
- 8:15 also shipped: (c) DONE: "Lab-matched body (trial)" tick box on the trim screen above Build skeleton (e951330;
  remembered per device in localStorage `fp-labbody`; ?bodyfit=1/0 still force it; bodylib.json only downloads when on;
  screenshots desktop + iPhone 13, export_check passes off and on). Results line says "lab-matched body (trial)" or
  "not used: it didn't line up with this video" (4cde360).
- 8:15 tried, no gain (drop): side tilt with the fit: giving shoulders/hips the full VERTICAL picture share (`residTrunkV` 1)
  keeps 77% vs 75%: the remaining tilt flattening is depth (side-on cameras), not the picture plane.
- 8:15 tried, no gain (drop): (d) late-started slow motion, wrist speed over an exact fraction of foot strike -> release
  (interpolated, not rounded): `slowmo.mjs --late 20` 227 -> 227 of 240, `--late 30` 229 -> 229. The window rounding isn't it.
- **9:40 SHIPPED (ea2d3f3): arm slot read from the picture when the camera is nearly straight behind/in front.** Finding:
  from straight behind, the plain 2D shoulder->wrist angle around release reads the true slot within 3-5 deg and keeps
  100% of the pitcher's difference (unusual set and benchmark), while the 3D arm is ~9 deg off there (sidearm read high).
  From 45 deg the picture reads 3-9 deg high, from the side it's useless. So `deliveryMeasures` blends toward the picture
  slot with weight face^12 (face = cos^2 of the camera's angle off the plate line, from D.cameraDir; uses D.img).
  Benchmark (measures.mjs) slot 6.21 -> 5.81 deg off, r 0.85 -> 0.87; unusual set 10.3 -> 10.2, keeps 80 -> 82%; sidearm
  from behind 1562 +15 -> +6, 3252 +11 -> +8, 1394 +10 -> +3 (1393 -1 -> +9, worse). Tried weights face^1/2/3 (45-deg views
  get worse: front_3b 8.5 -> 11.4) and face^6 (same as 12). Maher/Staumont/Hackimer unchanged (side / 54-deg cameras),
  regress ok, export_check ok, comparecheck slot rows ~same (limit still 9).
  Still open: 45-degree cameras (behind_3b/front_3b) — picture keeps 115-118% with a +3/+9 bias: a proper geometric
  read (picture angle corrected for the camera's angle) might help there; side views need the 3D arm.
- **9:40 FINDING (events on unusual deliveries, worth a session):** `node <scratch>/relchk`-style check (app events vs truth
  frame, 60 fps): benchmark 60 views: release off >=2 frames on 1, foot strike >=3 on 0. Unusual 70 views: release >=2 on 5
  (all late, 4 of 5 from behind: 1393 behind +3, 2907 behind_3b +4, 2923 behind +4, 2993 behind +2), foot strike >=3 on 10
  (2923 behind +10 frames). A late release ruins the slot there (2923 behind reads -14 deg: arm already past release,
  pointing down; truth 34). Caveat: the tracker noise is borrowed from another pitcher's view lined up by delivery phase,
  so check whether the donor's noise (not the delivery) causes it before tuning events (remake with another donor).
  9:40 follow-up: the borrowed noise is NOT the cause (`unusual_make.py --selftest`, ordinary pitches with another view's
  noise: release >=2 frames 0 of 60, foot strike >=3 1 of 60). But the foot strike "misses" are 2923_4 on all 5 views
  (+8-10 frames) and that is the LAB's event being odd, not the app: the truth ankle is still moving 4.8 m/s forward and
  dropping at the lab's force-plate foot strike (frame 53) and stops at 61, where the app puts it. Don't tune foot strike
  on 2923_4 (drop it from event scoring). Also tried: widening the foot strike <-> arm cocked gap limit `_fsGapMax`
  0.183 -> 0.25/0.35 (lab: 3.5% of 403 pitches have a gap over 0.183 s): unusual set no change, benchmark FS 13.9 -> 14.4 ms
  (worse): keep 0.183. Remaining real item: release read 2-4 frames late on 4 behind/behind_3b views (1393, 2907, 2923,
  2993); a late release ruins slot and release angles there.
- 9:40 tried, no gain (drop, don't repeat): despike with flat Float64Arrays and an index-based median (no iterator):
  samecheck identical, but 5.7-6.3 s vs 5.4-5.9 s before (despike self time 0.77 -> 0.59 s, noise eats it). Analysis
  speed is now 0.23 s per clip in Node; more micro-tuning isn't worth a session: item (a) closed.
- 9:40 partial (b) Max profile: synthetic 30-frame figure clip, headless 2 cores, worker path: model ready 6 s, then Pass 1
  (full picture, stronger tracker RTMPose on the processor) ~8 s PER FRAME (frame 3 at 54 s, frame 24 at 229 s; it
  estimated 25-29 min for this angle). So the first pass alone is most of Max; passes 2/3 and arm zoom not reached in the
  session. Next: time passes 2/3/arm zoom separately (`maxworker_check.py ... --only worker`, run in the background at
  session start, ~30 min), and check whether pass 1 runs RTMPose twice per frame (plain + mirrored) and whether the
  mirrored look could be skipped where the plain one is confident.
- **9:40 SHIPPED (6c6e973): half of the "geometric" slot below, on every camera** (on top of the face^12 blend):
  benchmark slot 5.8 -> 5.4 deg off, every camera better or equal (behind 4.6->4.5, behind_3b 4.1->4.0, front_3b 5.1->3.9,
  side_open 4.3->3.6, side_back 10.9->10.9); unusual 10.2 -> 9.5 (behind_3b 10.1 -> 10.6, the only one worse); measures.mjs
  6.21 -> 5.39, r 0.85 -> 0.88. Compare slot limit 9 -> 8 (comparecheck), card "about 5 deg". Real clips: Maher fast/max
  29.0/27.6 -> 23.7/19.9 (fast vs max now 3.8 apart, was 1.4: check by eye when Maher's video arrives), Hackimer 15.5 -> -4.8
  (he's a low-slot reliever; confirm with his video), Staumont 65.4 -> 64.4. Weight `globalThis.__slotGeo` (default 0.5)
  for experiments. perview: no skeleton angle changed; regress, export_check (Maher max, Staumont) ok.
  Benchmark side_back still reads slot 10.9 HIGH on every pitcher (bias = error): worth a look (depth of the throwing hand
  from that camera).
- 9:40 tried (full weight), promising but NOT shipped (one camera worse): "geometric" slot: turn the app's 3D shoulder->wrist so its
  picture direction matches the tracker's 2D one, keep its depth (along the camera axis), then read the slot (every view,
  replaces the face^12 blend). Benchmark (unusual.mjs on tools/test/bench) 5.8 -> 5.6 deg, keeps 94 -> 98%; unusual set
  10.2 -> 9.7, keeps 82 -> 91%; side_open 4.3 -> 3.1 / 8.8 -> 8.4, front_3b 5.1 -> 4.4 / 8.7 -> 8.2, side_back 15.0 -> 12.1
  (unusual) BUT behind_3b worse on both sets (4.1 -> 4.8, 10.1 -> 12.1). Suspect: camera looking down (benchmark cameras
  tilt 8 deg) so picture "up" isn't world up; try using the camera's tilt (opts._camTilt / camtilt.mjs) or weighting by
  how much the picture shows of the slot plane. Code was a 7-line block in deliveryMeasures after the blend (ex = [ez2,0,-ez0]
  from horizontal cameraDir, sign from the app's own projection, in-picture length kept).
- 9:40 wrap-up (10:22): tests for 6c6e973 passed (accuracy, per-view, compare, regression, slow-motion); the exports job and
  website deploy 215 were still running: check them first (export_check passed locally on Maher max and Staumont).
- **10:40 SHIPPED (9be43a9): release from a camera behind the pitcher no longer 2-4 frames late on unusual deliveries.**
  Cause: from behind, the hand's fastest motion on screen comes ~3 frames AFTER release on every lab view (behind +3,
  45-deg behind +3/+4, front_3b +2, side 0/-1), the learned-3D peak is also late there, so the lab-throw match had to
  move release 3-4 frames; it could only move 50 ms and, pinned at that limit with an edge speed, the "edge" rule threw
  the shift away (relShift = 0). Fix: on-screen guess moved earlier by fs*0.05*camDir[0]^2 when the camera is behind
  (`opts._relCamB`), and the lab-throw shift range +-50 -> +-75 ms (`opts._shiftMax`). Unusual 70 views: release
  mean 0.57 -> 0.37 frames, 2+ frames off 5 -> 1 (2655 side_open -2 -> -3), behind 14 -> 5 ms, behind_3b 11 -> 2 ms;
  slot 9.5 -> 7.9 deg (r 0.74 -> 0.83); as-seen layback at arm cocked 9.7 -> 6.2, at release 40 -> 36. Benchmark: release
  0.33 -> 0.28 frames (none 2+ off, was 1), as-seen +0.1 deg overall (behind +0.4: arm cocked moves with release),
  slot 5.39 -> 5.53, extension 0.259 -> 0.273 m (under-read gets a bit bigger: it's the skeleton's bias, not timing).
  perview: skeleton angles neutral on average but some single views swing both ways (elbow at arm cocked 3044 behind
  +19, layback at release 3036 behind +30, about as many better): the arm template follows release timing.
  Slow motion 240/240, regression ok, comparecheck slot limit 8 still fits. `measures.mjs` now takes BENCHDIR.
- 10:40 FINDING (slot side_back, item 3): benchmark side_back slot reads +10.9 high on all 12 pitchers, but the unusual
  set's side_back (same cameras, same tracker noise borrowed from those views) has bias only +2.3 with a +-13-24 spread.
  So it's not a fixed camera bias: a correction would make the unusual set worse. Not shipped; needs a real look at the
  depth of the throwing hand from that side (the arm is on the far side of the body there).
- 10:40 FINDING (b) Max profile, 24 frames, headless 2 cores, worker path, 856 s total: setup 9 s, pass 1 (MediaPipe finder
  + heavy model, full picture) 245 s = 10 s/frame, pass 2 (2 zoomed MediaPipe + 2 RTMPose looks) 280 s = 11.7 s/frame,
  pass 3 (2 backwards MediaPipe) 245 s = 10 s/frame, arm close-up 55 s, combining + learned 3D 75 s. So each MediaPipe
  heavy look is ~5 s and each RTMPose look ~1 s here: MediaPipe's GPU path runs on SOFTWARE GL headless, so this
  profile does not show a real computer's split. Idea (needs a real clip to measure accuracy, NOT done): when RTMPose
  loaded (weight 3 vs 1 in fuseSoft), skip pass 3 (backwards) to save ~30% of Max; test by saving `window.__lastLooks`
  from one full Max run on a real clip and re-fusing with and without the "back"/"backMirror" looks.
- **Next session (after 9:40):** (1) DONE 10:40 (see above) release 2-4 frames late from behind on unusual deliveries (see finding above;
  lab data + `unusual_make.py` take ~1 min to set up); (2) (b) Max profile: start `maxworker_check.py --only worker` in the
  background FIRST, then time passes 2/3/arm zoom; (3) slot: side_back reads 10.9 deg high on all 12 benchmark pitchers; full-weight geometric slot if behind_3b can be fixed;
  (4) side tilt/pelvis flattening with the fit (needs an idea).
- 9:40 session: deploy checked: run 207 (70141cc, carries the tick box and results line) succeeded; 205/206 were cancelled by newer pushes. Done.
- (old) FIRST next session: website deploy run 205 (for 7f0b899, carries the tick box e951330 and results line 4cde360) was stuck in "Deploy to GitHub Pages" 9+ min at 9:10 ET (tests for every code commit passed). If it failed/cancelled, re-run it (actions rerun) once nothing is in progress, then confirm the tick box is live.
- Next session: (1) (a) analysis memory/GC (typed arrays in `lift`/`oePass`, samecheck-identical); (2) (b) Max profile on the
  synthetic clip; (3) side tilt/pelvis flattening with the fit (depth: needs an idea); (4) Monday/Saturday item: the app's
  arm readings keep only about half of a pitcher's difference in shoulder abduction (51-55%) and layback (60-63%) late,
  arm slot 80% (sidearm reads 13-14 deg high): measure with `unusual.mjs` (app columns) and look at the lab-throw match's
  pull toward the library average. (e) delete `wip-max-worker` only if Jackson agrees (everything is on main).
- 7:40 session (ran 7:41-8:25, before the plan): shipped pitch-only Recent video ON by default + hand-moved-event fix, and
  the parallel re-read pool (details in the session log). Tests and deploy passed for 6d67bd9; 1153829's run was still going at wrap-up:
  check it. Big project step 1 not started.

## Session log 2026-11-09 to 11-10 (what shipped and what was tried: read before retrying anything)
- Code chat 8:05-8:40 shipped (phone check): opened the app as an iPhone 13 and a Pixel 7 (Chromium emulation, `tools/test/phone_check.py`): home, Recent, results: no page errors, no sideways scrolling, nothing wider than the screen. Only problem: 25 buttons on the results screen were 23-28 px tall (camera views, speeds, frame step, phase buttons, full screen), small for a thumb. Fixed: on touch screens every button is at least 40 px (`@media (pointer: coarse)` at the end of the CSS; desktop unchanged, checked). Now 0 small buttons. regress ok, export_check ok. Still worth a look on a REAL iPhone (Safari isn't tested here) and a real upload + Fast run on a phone.
- **7:40 session: Recent's pitch-only video is ON by default (6d67bd9).** The 6:40 "noisy clip stalled" was not the keeper:
  the same 31 MB noisy synthetic clip (5.6 s, ffmpeg noise=alls=12, 25 Mb/s) runs Fast to results in 226 s without the keeper
  (`FLAGS=keepclip=0 keepclip_run.py`) and 229 s with it; saved video 31 MB -> 1.1 MB, re-opened pictures match (diff 0.15-0.35/255).
  The 6:40 stall was most likely CPU contention (2 cores, other browser runs). FIXED a real bug found while checking: on a re-opened
  pitch-only video, moving an event by hand rebuilt the skeleton in the upload's time (start 1.31 s instead of 0), sliding it off the
  video; keepclip_run.py now checks that (start 0 -> 0). Writer now waits up to 2 s if it falls behind and gives up (whole upload
  saved) if still >24 frames behind. `keepclip_check.py` on GitHub (testsrc2 clip). `?keepclip=0` = old behaviour.
  Still worth a real-phone look (iPhone Safari VideoEncoder H.264): if it can't write video it silently saves the whole upload.
- 7:40 shipped (1153829): parallel re-read pool from `wip-max-worker` (c) moved to main: up to 3 analysis workers (cores-1),
  Compare reads its two pitches at once, Over time reads in date order with several workers. `trend_time.py` (10 Maher pitches,
  quiet 2-core sandbox, alternating runs): main 3.4/3.4 s -> pool 2.9/2.9 s (cores=3), longest freeze <0.1 s both; old page-only
  path (`?analysisworker=0`) 2.7 s but freezes 0.5-0.7 s. history_check, anaworker_check, export_check pass. Phones with more cores
  should gain more (not measured). The rest of `wip-max-worker` is on main already; the branch can be deleted.
Sessions: 8:15 ET plan, then every hour at :40 round the clock (summary at 21:40); each picks up here and leaves this section up to date.
- **Big project: the throwing elbow reads ~7° too straight from late stride through max layback** (signed error -7.4° at foot
  strike, -6.0° at max layback, -2.6° at release; 2D matches the truth within 1°, so it happens in the 3D arm lock `lockArms`). Steps:
  1. Add a debug hook recording upper-arm/forearm vectors per lockArms stage; rebuild the elbow per stage on the 60 views.
  2. Find the step that straightens it; fix it. Measure with `node tools/test/bench.mjs` (elbow, layback, shoulder abduction, arm cm).
  3. Ship only if better or equal elsewhere; regress + slowmo pass; update scorecard baseline.
- Follow-on (in order): (a) worst single views of the elbow at foot strike (3228 behind_3b, side_back/side_open: 50° wobble);
  (b) layback over 180° at foot strike on Maher (219°): forearm direction around 1.58 s, fixture only; (c) Fast mode's 5-frame whole-body
  flip just after release on Maher (1.78-1.85 s); (d) trunk rotation (10-11° off, worst reading left); (e) throwing arm at release.
- 9:40 session: elbow bias re-measured with the two shipped fixes: FS -6.8° (MER -2.6, BR +1.0), so what's left is foot strike only. Cause on the worst views: one arm bone (upper arm on 3228 behind_3b, forearm on 3228 side_open) on the wrong side of the picture for the ~10 frames before foot strike. Tried: scoring the 4 toward/away combinations by the matched lab arm's elbow bend: no gain (FS 8.6 -> 8.7, MER/BR unchanged), dropped: the lab arm's bend is itself 25-35° off there (the lab arm bends about 5 frames later than 3228's). Don't retry without a new clue.
- 9:40 session: Maher layback "219° at foot strike" no longer reproduces (now -43° max / -11° fast): item closed, but -43° at foot strike still looks odd, worth a look with the video.
- Shipped 9:40: side-by-side compare of two saved pitches (compare.js, Recent section); PDF angle table now has Layback.
- Shipped 9:40: arm 2D smoothing lighter (`_armSig` 0.6 -> 0.3): elbow at foot strike 8.6 -> 7.8° off, wobble 6.4 -> 6.7 (truth 5.8). Sweeps with no gain, don't repeat: `_fcCore` 16/20 (separation worse), `_shSig` 0.5 (separation worse), `_hipSig` 1, `_fcLimb` 16, `_lPre` 0.5/0.9.
- Finding: layback at foot strike is -43° on Maher (max) and 110° on Staumont; the 12 lab pitchers are -11 to 64°. The benchmark says 5.6° off, so these real clips behave differently from the lab views: needs the videos to judge (Maher's video is on the wait list).
- PDF/CSV check now runs on GitHub Actions on every push (`exports` job).
- (Reverted, see below) 10:40: foot strike timing 34 -> 30 ms (and the whole-body travel down the mound: on side-on fixed-camera clips, stride was 17-19 -> 6 cm short (the 10:40 commit message says 3 cm: that was a no-pan test run, the shipped number is 6)): back foot dragging forward was being read as camera pan (pipeline.js, pan threshold 0.06 -> 0.2 body heights). Behind/behind_3b still 15-20 cm short (depth travel, separate cause: lifter depth of hips over the planted back foot).
- Shipped 10:40: Delivery numbers strip above the viewer, in PDF and in Compare: stride % of height, arm slot, hand height (only with height entered), peak hip-shoulder separation. Checked vs truth with `tools/test/measures.mjs` (stride 9% of height short, r 0.85; slot 6.4° off, r 0.85 (averaged over the 2/60 s before release); hand height 7.5 cm off, r 0.68; peak separation 6.6° off). Extension and time of peak separation not shown (r 0.23 / 0.41).
- Tried 10:40, no gain: shoulder width at release (`_shRel`, `_shFull` lower): trunk at release worse (11.4 -> 11.8-12.9). Trunk bias at release is -15 to -18° from behind (pelvis -11), a depth thing, not width.
- Tried 10:40, dropped: depth travel gain (`vdepth`×1.25): stride from behind 20 -> 5 cm short, but front knee at foot strike 8.1 -> 12.7° (hips moved, front foot pinned). Holding the last speed when the feet aren't planted: no change. Don't retry the plain gain.
- 10:40 finding: kinematic sequence order can't be read from one camera yet. Heavier smoothing (50 ms) gets 'order right' 49 -> 55 of 60, but it just says pelvis-first every time: truth is pelvis-first on 55 of 60 and it catches 0 of the 5 out-of-order (unsmoothed: 2 of 5, with 8 false alarms). Don't show an in/out-of-sequence verdict; don't count the 55.
- 10:40: (c) Fast flip after release on Maher: no flip left in the finished skeleton (shoulder depth steady 1.78-1.95 s). Closed.
- Shipped 10:40: warning banner when the clip doesn't look like a pitch (no full stride at foot strike, or no arm speed): `pitchCheck` in pipeline.js. False alarms: 0 of 60 full clips, 1 of 60 started 1/3 s late, 5 of 60 started 1/2 s late (those events are unreliable anyway); caught standing still, cut before the stride, follow-through only. Delivery numbers hidden then.
- REVERTED 10:40 pan threshold 0.2 -> 0.06: shipped for ~20 min, then found front knee at foot strike 8.1 -> 8.9° off overall and up to 16° worse on single views (1612 side_back, 2919 side_open/front_3b, 3035 side_open: knee reads too straight), 32 of 60 views moved >2°. Thresholds 0.08-0.14: same trade, smaller. Stride (side-on 17-19 -> 6 cm short) and foot strike 34 -> 30 ms went back too. Next idea: the pan estimate is right to go, but then a planted lead foot needs pinning before the knee is solved (the hips travel further, the foot anchor doesn't). Check per-view front knee, not just the table, before re-trying.
- Next session: (1) the stride/foot-strike gain from not reading a dragging back foot as camera pan, done properly: pin the planted front foot so the knee doesn't straighten (see REVERTED note; judge on per-view front knee at foot strike); (2) (d) trunk rotation, (e) throwing arm at release. Kinematic sequence verdict stays off the screen. Bench only prints averages: for any change to the skeleton, also run `node tools/test/perview.mjs <copy of the previous version>` (reading by reading, how many of the 60 views got more than 5° worse or better).

- **11:40 session (rebuild blocked):** step 1 needs the OpenBiomechanics data; these sessions may only read jacksoncharney22-Pitching/Pitching (GitHub says add_repo, and that tool isn't available here). Jackson notified; don't try to fetch it another way. Until he adds the repo or uploads `baseball_pitching/data/full_sig/landmarks`: only the rebuild steps that need no library, or normal accuracy work.
- Built 11:40: `tools/test/glitch.mjs`: limb jumps, flips, impossible joints on the 60 views + saved clips. Result: 0 flips on all of them, shake 0.92 vs truth 0.86, 1.6 jumps per view (mostly 3D arm). So the glitches Jackson wants gone don't show on the clips we hold: we need his glitchy clips to measure them.
- Shipped 11:40: stride 9.1 -> 5.0% of height short (rule: before foot strike the back foot is dragging, so pan under 0.2 body heights is ignored there and depth travel x1.25; after foot strike unchanged, front knee untouched: that's what the REVERTED try got wrong).
- Shipped 11:40: trunk at foot strike 10.6 -> 8.3° off, separation 9.0 -> 6.8°, elbow 7.8 -> 6.9°: shoulders that read turned with the hips (sep near 0, truth +40-70, side-on views) now use the mirrored reading (`_sepNear` 0 -> 15, `_shPost` 0.1 -> 0.12 s after foot strike).
- Tried, no gain: pinning the front foot earlier (front knee at release 7 -> 14-22°, keep the median anchor); `_sepMin`, `_sepGain`.
- Worth a look: Hackimer (speed-ramped) still reads separation -32° at foot strike (shoulders open by 32° before the hips): the mirrored reading doesn't pass there; may be foot strike timing in the ramp. Needs the video.
- Trunk/pelvis finding: from behind/behind_3b late rotation is 10-18° under the truth (signed -10 to -18 at arm cocked/release; spread 7-11), the side views under 6. Next idea for the next session: this is depth-driven, so measure whether scaling the shoulder/hip depth from behind helps (not tried).

- 12:40 shipped: failure messages for dropped downloads and out-of-memory now say what to do (trim the clip, Fast accuracy, check connection). Other errors were already written in plain words.
- 12:40 tried, no gain: global learned-depth gain (0.85/1.15).
- **FIRST THING next session: is the website deploying?** Since push 9850104 (18:11 UTC) every "pages build and deployment" run fails with no jobs and no log (runs 70-72, one retry too), and the test runs are marked failed with jobs missing (run 51: slow-motion and accuracy passed, regression and exports never listed; both pass locally). Nothing in those commits explains it (no site files added, 244 MB, no symlinks), so it looks like GitHub's side, but that isn't proven; the cloud sessions can't load the live site to check. Live site is probably still b0f3dc7 (trunk tilts). Not live yet: PDF rotation speeds, plainer failure messages. Check the latest pages run; if it's still failing, tell Jackson to look at Settings > Pages / Actions.
- Next session (after 12:40): rebuild still blocked unless the data has arrived. Otherwise (1) front knee from behind reads too straight (FS -10.7°, MER -9.2°; side_open too bent +7): it's hip-to-ankle distance, so hip depth or the planted foot depth, not the knee; (2) pelvis late rotation from behind (-13/-11°); (3) layback at release 21°.
- (older) Next session: rebuild still blocked unless the data has arrived (check the project docs). Otherwise: (1) trunk/pelvis 10-18° under the truth late in the delivery from behind (depth); (2) `_sepMax` 100 vs 85 is a wash (elbow at release 6.5 -> 6.3, trunk FS 8.3 -> 8.5), left alone; (3) (e) throwing arm at release.

- 12:40 session shipped: (1) shoulder width read from this pitcher's own widest point foot strike -> release (clamped 0.86-1.04 of the fixed width, was fixed 0.94): trunk at release 11.4 -> 10.8° off, max layback 7.9 -> 7.5°, separation 6.8/4.9/6.4 -> 6.6/4.8/6.1°. (2) Spine lean toward/away from the camera scaled back 8% (`_spineG` 0.92): side tilt 4.9/7.7/7.6 -> 4.8/7.2/7.1, forward tilt 4.4/6.3/5.7 -> 4.3/5.8/5.6, abduction 4.2/4.4/5.4 -> 4.1/3.8/4.9, arm cm 11.5 -> 11.2. Bigger scale-back (0.7-0.75) is much better on side tilt (side_back 13.5 -> 6°) and tilts, but the arm position from behind_3b gets 1.4 cm worse (guard fails), so held at 0.92; the deadzone version didn't fix that. Don't retry either variant without a new clue.
- 12:40 shipped: PDF angle table has pelvis/trunk rotation speeds; `perview.mjs --check` on GitHub (fails if a reading is on average >0.3° worse and 6+ views >5° worse).
- 12:40 tried, dropped: front knee solved from the picture with hip and foot fixed: no change (knee angle is set by hip-to-ankle distance, knee position doesn't move it).
- 12:40 tried, dropped: locking the hip line to the video (`lockHips`, incl. self-calibrated hip width): pelvis at release 8.5 -> 7.7° but separation mer/br 4.8/6.0 -> 6.0/6.9. Pelvis late rotation still -13/-11° from behind.
- 12:40 finding: trunk tilt errors are consistent per view (side_back side tilt +13, front_3b forward +14): spine depth overstated. If the behind_3b arm position issue can be solved the 0.7 setting is worth 1.5° of side tilt.

- **13:40 finding: camera height.** The app always assumes a level camera. The benchmark's cameras all look down about 8° (`node tools/test/camtilt.mjs`, spread <1° over 60 views). Told the true tilt (`OPTS='{"_camTilt":-8}' node tools/test/bench.mjs`): joints 9.9 -> 8.1 cm, throwing arm 11.2 -> 9.3 cm, foot strike timing 34 -> 23 ms, side tilt MER/BR 7.2/7.1 -> 4.5/4.5°, forward tilt BR 5.6 -> 4.0°; but elbow FS 6.9 -> 8.0, layback FS 5.4 -> 7.4, layback BR 21.5 -> 23.1. **Do NOT ship a fixed -8 correction**: it's this benchmark's camera, real clips differ, and it would just flatter the score. Option stays off by default.
- 13:40 also explains the front-knee-by-view pattern and the "spine depth overstated" tilt errors: ankles read 8-17 cm off along the camera line and shoulders the opposite way, because the whole body is tipped by the camera angle. Moving just the ankles along the camera line: knee much worse (front_3b 27°), dropped.
- 13:40 tried, no use as a tilt reader: leaning at setup (spread 3-6°, side_back reads +16); hip/shoulder line slope against depth (-18 on behind/behind_3b/side_back, +3 on front_3b/side_open; opposite views average -7.5, so the tilt is in there but mixed with a view-dependent ±10° from pelvis tilt during rotation; per-clip spread 3-4° after removing it, and Maher reads +11 to +14). The benchmark can't validate a reader anyway since every view is 8°: needs clips at other camera heights (re-render the lab pitches at 0/+/-15°, which needs the OpenBiomechanics data, or a real clip with a known camera height).

- 13:40 shipped: the website is deploying again (runs 73+ succeeded, so the deploy failures from 18:11 UTC are over). Saved-pitch "numbers changed" note (guarded in export_check). CSV ends with the delivery numbers. Video downloads verified (`video_check.py`, on GitHub). Camera tilt finding above.
- 13:40 clue for pelvis/trunk: changing the assumed stride offset (`strideOff`, 7.4° measured from 404 lab fastballs) to 3 gives pelvis MER/BR 9.1/8.5 -> 6.7/6.5 and trunk 7.5/10.8 -> 6.1/8.7 but foot strike worse (pelvis 6.7 -> 8.4, trunk 8.2 -> 11.2). A trade, not shipped, and 7.4 is the measured value. It suggests rotation is too small from foot strike to release (range compressed), so look at a gain on rotation range rather than an offset.
- 13:40 measured the clue: from foot strike to release the pelvis turns 73-80° in the app vs 85° in the lab, trunk 130-145° vs 148° (worst from behind/behind_3b/front_3b: pelvis -10 to -13 late, trunk -15). Shipped 13:40: hips turn 6% and shoulders 4% further after foot strike, arms carried along (`_hipGain` 1.06, `_shGain` 1.04, from the contact frame): pelvis MER/BR 9.1/8.5 -> 6.9/6.4, trunk 7.5/10.8 -> 6.3/8.8, separation same, elbow unchanged, arm cm front_3b +0.4. Per view: trunk at release 26 better, 12 worse by >5°. Starting at contactF gives up some pelvis gain (from fs_ it was 6.3/6.0, but FS got 0.3 worse). 1.10/1.08 was too much (trunk BR 9.4). Tuned on the 8° benchmark only, gains deliberately small.
- Repo note for cloud sessions: the local `main` here can be an old copy with unrelated history; `git checkout -b work origin/main` and `git push origin HEAD:main`, don't touch local main.
- (13:40 wrapped; the hip/shoulder turn fix is live, tests and deploy passed.) Possible follow-up: trunk at release got >5° worse on 12 of 60 views, mostly side_back/side_open (they under-turn less), so try a smaller shoulder gain on side-on cameras.
- Next session: rebuild still blocked unless the data has arrived. Otherwise: (1) the camera tilt: a reader needs clips at other camera heights to validate (see 13:40 notes), so ask for or wait on those rather than tuning on the 8° benchmark; never hard-code -8. With the true tilt `_spineG` 0.8 does better still (side tilt 3.7/4.2, forward 4.5/3.6), and elbow FS 6.9 -> 8.0 and layback FS 5.4 -> 7.4 got worse: worth knowing why before any tilt ships. (2) Pelvis late rotation from behind (-13/-11°, unaffected by tilt). (3) Layback at release 21°. Front knee by view is now explained by the tilt, so don't chase it on its own.

- 14:40 shipped: extra hip/shoulder turn for cameras behind the pitcher (`_hipGain` 1.05 + 0.08 x behindness, `_shGain` 1.03 + 0.08 x behindness from arm cocked to release; `camDir[0]` < 0 is behind): trunk BR 8.8 -> 7.9, pelvis MER/BR 6.9/6.4 -> 6.1/5.8, behind_3b trunk BR 13 -> 10; separation MER 4.8 -> 4.5. Side-on cameras want ~1.0, behind ~1.08-1.10. Still tuned on the 8° benchmark.
- 14:40 shipped: tempo card "Leg lift to foot strike" (60 views: 34 ms off, truth spread 74 ms, r 0.80; hidden if the clip starts within 0.1 s of the leg lift). Foot strike to release NOT shown (34 ms off a 21 ms spread, r 0.33).
- 14:40 shipped (speed reading, late-started clips): when there's no leg lift to go on, the throwing hand's peak speed helps (14 body heights/s, blended 40%): clips starting 1/2 s before foot strike 20 -> 11 views wrong of 60 (33 -> 17 of 240 readings), 1/3 s 22 -> 16 views (42 -> 36). Full clips unaffected.
- 14:40 tried, dropped: foot strike from the 2D ankle stopping (33.9 ms now, 39-110 ms with it; a planted foot still moves in the picture on the heel). 2919 FS -83/MER -83 ms on all 5 views: that pitch itself, not a view problem (don't chase).
- 14:40 finding: with the true tilt the throwing shoulder's position error shrinks a lot (front_3b FS-MER 14 -> 9 cm, side_back MER-BR 13 -> 7 cm), i.e. the 14.8 cm front_3b arm is the tilt, not the arm.

- 14:40 finding: front-foot direction at foot strike reads 10.5° off where it can be checked, but the benchmark truth has no heel-to-toe line (all zero), so it can't be validated: don't show it until there's a truth for it. Stride direction open/closed also can't be read from one view (the app assumes the stride's 7.4° offset).
- Next session: rebuild still blocked unless the data has arrived. Otherwise: (1) elbow FS/layback FS get worse with the true tilt: why (needs an idea, the arm lock already uses the tilted camera); (2) separation at release from behind (8-10° off, worst reading left there); (3) Tuesday-tomorrow: profile Max accuracy; check phones. Late-started clips (see Thursday list) still 11-16 views of 60 wrong.

- 15:40 shipped: Compare bolds a row by that reading's own measured size (`tools/test/comparecheck.mjs`, every pair of lab pitches from the same camera: 80th percentile of the error in A minus B), not a flat 10°. Most readings 8-20°, layback at release 51°, elbow at release and forward tilt at leg lift never (18% and 58% right when bold). Held-out on half the pitches: bold 50% -> 44% of rows, right 86 -> 89%. Pairs are different pitchers, same camera; same pitcher on different days is untested (no such data). Re-run `--json` after big skeleton changes.
- 15:40 shipped: Recent keeps 30 pitches (was 6): newest 6 with video, older ones skeleton and numbers only ("no video" in the list, overlay download hidden). `tools/test/history_check.py`, on GitHub.
- 15:40 shipped: "Track a reading over time" (Recent section): any angle at any event, or stride/arm slot/separation/tempo, one line across saved pitches, tick boxes to leave pitches out, note says how small a change may be the camera.
- 15:40 finding: remaining rotation/elbow error is scatter not offset (signed averages mostly under 6° by camera, spread 7-14° per view). More overall gains tuned on this benchmark would be fitting its 8° camera; go after the wobble (worst views) or wait for the rebuild data.
- 15:40 shipped: rename a saved pitch (pencil in Recent); name carries to Compare, Over time, PDF.
- 15:40 finding: worst single readings: trunk at release, 3035 side-on +30 (app 155, truth 128), 2653/3222 from behind -25; several of these are the same pitch on different views, so the camera is deciding the reading there.
- 15:40 finding: how well each camera follows real pitcher-to-pitcher differences (correlation with truth; 1 = perfect): front_3b is best for rotation (0.91-0.97 at FS/BR), behind_3b worst (0.47-0.84). Side-on cameras exaggerate trunk differences late (slope 1.27-1.52 at MER/BR: a 10° real difference reads 13-15°); behind/behind_3b pelvis at release shrinks them (0.70-0.74). 12 pitches only.
- GitHub now fails if compare.js thresholds go stale (`comparecheck.mjs --check`): after a skeleton change, re-run `--json` and paste into `SIG` in compare.js.
- 15:40 shipped: "What to trust" on the results page now gives measured numbers and no longer says sequencing is solid (it read 0 of 5 out-of-order pitches).
- 15:40 shipped: Compare and Over time warn when pitches were filmed from different camera spots (estimated camera direction 25°+ apart: on the benchmark 0% false alarms on same-camera pairs, 99% of different-camera pairs caught; Compare then stops bolding) and when read at different accuracy settings (Maher fast vs max, the same pitch, has 15 rows over the bold limits).
- 15:40 tried, no gain: lower side-on shoulder gain (`_shGain` 1.015/1.0 with `_shGainB` raised to keep behind the same): trunk MER/BR 6.3/7.9 -> 6.5/8.1 and 6.9/8.4.
- 15:40 shipped: Compare bolds and Over time notes for the delivery numbers too: stride 6% of height, arm slot 9°, peak separation 13°, leg lift to foot strike 0.08 s (same `comparecheck` method).
- 15:33: website deploy confirmed for everything above (run for 2bcc717 succeeded; one run had hung 10 min and was replaced by the next push).

- 16:21: everything from the 15:40 session confirmed live (tests and website deploy passed on b2724c5). Note: the bold limits apply to different pitchers from the same camera; same pitcher on different days is untested (needs repeat clips of one pitcher).
- Next session (after 15:40): rebuild still blocked unless the data has arrived. (1) The camera-spot check works well; try using it elsewhere (e.g. tell a coach at upload that a new clip is from a different spot than the pitcher's earlier ones). (2) Over time filters by exact pitch name (rename in Recent); a real pitcher field at upload would be better. (3) Rotation readings: scatter, not offset, is what's left (see 15:40 findings), so more gain tuning is a waste. Tomorrow's theme: speed and reliability (profile Max accuracy; phones).

- 16:40 shipped: Pitcher box on the trim screen (`data.pitcher`, remembered, suggestions from saved pitches; also set via the pencil in Recent); Over time filters by pitcher; Compare/results/PDF show it. New clip 25°+ from that pitcher's last saved pitch gets a note on the results page (`history_check.py` covers both).
- 16:40 shipped: foot strike 34 -> 24 ms off motion capture (behind_3b 49 -> 26; worst single view 150 -> 83 ms): foot that still read as dropping could land after the arm was cocked (capped at 0.08 s before arm cocked); foot just over 0.3 m/s kept the early reach frame (now first frame under 0.5). Tempo r 0.80 -> 0.92 (24 ms off), Compare tempo limit 0.08 -> 0.05 s. Maher max foot strike 1.57 -> 1.60, others unchanged. Foot strike to release still not shown (r 0.43).
- 16:40 shipped: arm cocked 27 -> 11 ms off: read off the layback peak, nudged by at most 1/30 s. A wider search gives 5 ms on the lab views, but only WITH the lab arm (no lab arm: 22 ms) and moves Maher +0.05-0.07 s, so it needs the video. FINDING: true max layback to release is 17-50 ms on all 12 lab pitches (nearly always 33), so Maher's old 1.68/1.77 (90 ms) was probably too early and the CLAUDE.md "known good" 1.68 is suspect; ask Jackson to eyeball Maher when his clip arrives, then widen to 0.1/0.083 s.

- 16:40 FINDING (important): the scorecard reads every angle at the TRUE event frame, but a coach sees the angle at the frame the APP marked; a miss of 1-2 frames costs many degrees where the arm is moving fast. `bench.mjs` now prints that table too ("as the coach sees it"). Timing fixes today moved it: layback at arm cocked 33.9 -> 11.1°, elbow at arm cocked 29 -> 13.6°, trunk at arm cocked 27.6 -> 15.2°, separation at arm cocked 18.9 -> 11°, pelvis at foot strike 16.9 -> 12.8°. So event timing is now the most valuable accuracy lever: judge event changes with that table, not the truth-frame one. "What to trust" corrected to 6-13° (it said 4-8°).
- 16:40: after arm cocked moves later, a still-sliding front foot gets another look: foot strike 24 -> 23 ms, 3037 front_3b -83 -> -33 ms.

- 16:40 tried, no gain (coach-seen error, don't repeat): `_slideV` 0.2/0.4, `_slideV2` 0.4/0.7, `_slideMax` 0.14; `_slideCock` 0.06 is -0.1° (0.08 kept: arm cocked to foot strike is 0.09+ s on 90% of lab pitches).
- Next session (after 16:40): rebuild still blocked unless the data has arrived. (1) Arm cocked: only the wider nudge is left (5 ms vs 11; trunk at arm cocked still 15°, as seen) and it needs Maher's video: on the wait list. (2) Foot strike worst views: 3036 behind/behind_3b -50/-67, 3037 side_open -67 (foot reads stopped early). (3) Judge event changes with the "as the coach sees it" table in bench.mjs; `as seen` is now guarded in the baseline. Tomorrow's theme: speed and reliability (profile Max; phones).

- 16:40 finding: the remaining early foot strikes (3036 from behind -50/-67, 1826 side_back) are the anchored foot's speed collapsing 3 frames before the lab's contact: the skeleton's foot is pinned before the real foot is. The 2D ankle trick already failed (14:40). Leave unless a new clue. CSV now includes the pitcher.

- 17:40 shipped: arm cocked can't be more than 50 ms before release (true on all 12 lab pitches, 17-50 ms): arm cocked 11 -> 6 ms off; as the coach sees it layback at arm cocked 11.1 -> 7.1°, trunk 15.2 -> 10.2°, separation 11.0 -> 8.0°, pelvis 7.7 -> 5.9°. Maher/Staumont unchanged. Hackimer (speed-ramped) arm cocked 0.494 -> 0.585 s and, via the second foot-strike look, foot strike 0.392 -> 0.467 s; baseline re-recorded: new foot strike is where the foot actually stops (1.5 -> 0.3 m/s), front knee at foot strike 6° -> 70° bent, separation -33 -> -8°. No video to eyeball it; check Hackimer when a clip arrives (layback at foot strike there now 168°).

- 17:40 shipped: foot strike kept 0.10-0.183 s before arm cocked (lab range, now that arm cocked is accurate; `_fsGapMin/_fsGapMax`, off while the slow-motion reader runs, `_noGaps`, because seconds aren't real there): foot strike 23 -> 19 ms off; as the coach sees it pelvis at foot strike 12.3 -> 11.0°, trunk 10.8 -> 10.1°, layback 24.8 -> 21.8°, elbow 9.6 -> 9.8 (slightly worse). Tried `_fsGapMin` 0.117 (17 ms, trunk 10.5, pelvis 11.1, layback 19.0, marks foot strike 11 ms early on average): held at 0.1 as the measured lab minimum.

- 17:40 shipped: foot strike met halfway by the typical lab gap to arm cocked (0.125 s; `_fsPull` 0.5, after the 0.10-0.183 s clamp): foot strike 19 -> 14 ms off; as the coach sees it layback at foot strike 21.8 -> 14.8°, elbow 9.8 -> 8.3°, pelvis 11.0 -> 10.2°, separation 7.5 -> 6.9°, trunk 10.1 -> 10.7 (a bit worse). Tempo leg lift to foot strike 24 -> 15 ms off, r 0.92 -> 0.97 (`tempo.mjs`); foot strike to release still r 0.43, stays hidden. Pull 0.7: 13 ms, about the same; 1.0 (gap only): 17 ms and pelvis/trunk 13°. Compare limits re-measured (tempo 0.05 -> 0.033 s). Staumont foot strike 1.30 -> 1.267 s, Maher, Hackimer within a frame or two.
- 17:40 tried, no gain: release offset `_relOff` 0 / 0.03 (0.012 kept).
- 17:40 finding: the elbow at arm cocked (13° as seen) and layback at foot strike are now limited by one-frame timing: the elbow straightens 30-40° per 1/60 s at max layback and layback changes ~20° per frame at foot strike, so a single-frame miss is the whole error. The worst foot-strike views are whole pitches (2919, 2935, 1826 early by 2 frames on every camera), so it's the pitch, not the view.

- 17:40 tried, dropped: pulling arm cocked toward 33 ms before release (`_merPull` 0.5/1): elbow at arm cocked 13.1 -> 14.8/15.4° as seen.
- 17:40 checked: late-started clips unchanged by the timing work (`slowmo.mjs --late 20`: 205 of 240 right, was 204; `--late 30`: 223, same); full clips 240 of 240.
- **Next session (after 17:40):** rebuild still blocked unless the data has arrived. Event timing now: foot strike 14 ms, arm cocked 6, release 6. What's left as seen is one-frame noise (see finding), so more timing tuning is near its floor on 60 fps lab views. Options: (1) separation/trunk at foot strike as seen (10-11°) is the biggest remaining body reading; (2) late-started clips (Thursday list): the new foot-strike-to-arm-cocked gap (0.10-0.18 s) could be a third clue for the slow-motion reader; foot strike to release alone was too short; (3) Tuesday theme starts at the 8:15 plan: profile Max, phones. Hackimer's new events need his video to confirm.

- 18:40 tried, dropped (late-started clips' slow-motion reading): hips' and shoulders' peak turning speeds as a clue. At real speed they are by far the best clue (`tools/test/slowclues.mjs`, new: views wrong at 1x 13+6 -> 4+0 of 60 for 1/3 s and 1/2 s late), but on slowed clips the skeleton is smoothed over fewer real frames and turns ~1.5x too fast (2x reads 1.35, 4x 2.7), so `slowmo.mjs --late 20` fell 205 -> 91 of 240. Re-reading the clip at the first-guess speed overshoots (below 50 fps the analysis behaves differently). Would need turning speed from the raw tracker points, unsmoothed; don't retry on the skeleton's metrics.
- 18:40 also tried, dropped: the wrist's raw 2D speed (tracker points, unsmoothed) as the clue. At real speed it's good (`slowclues.mjs`: raw 0.7 + foot-strike-to-release 0.3 gives 7+3 wrong of 60 vs 13+6 now), but `slowmo.mjs --late 20/30` fell 205/223 -> 144-150/167-173 of 240: slowed clips read ~0.65x as fast. Likely the measuring window (h = (R-FS)/8 frames, rounded) covers a different real time span at each speed, plus foot strike/release landing differently. Next try, if anyone retries: measure over a span fixed as a fraction of foot strike to release, interpolated rather than rounded, and check at 2x first (`SPEEDS=2 node tools/test/slowmo.mjs 1612 --late 30`).
- **Next session (after 18:40):** late-started slow-motion still 205/223 of 240 (unchanged; two clue tries dropped, see above). Options: (1) the window-rounding idea above (cheap to test at 2x); (2) separation/trunk at foot strike as seen (10-11°); (3) Tuesday theme from the 8:15 plan: profile Max, phones. NOTE: this sandbox's clock and container restarted mid-session (uptime reset), so `date` can understate elapsed time; track time by your own runs.

- **19:40 session: rebuild step 1 started (the lab data downloads fine, checksum OK).** Built `tools/bodylib_build.py`
  -> `bodylib.json` (281 KB, not loaded by the app yet) and `tools/test/bench/bodylib_holdout.json` (benchmark athletes
  left out): 366 of 411 lab deliveries (74 lefties mirrored), right-handed, divided by height, stride turned to +x, time-warped
  to leg lift / foot strike / max layback / release (66 samples, 17 joints), PCA. How well K shapes rebuild the held-out
  benchmark pitches from their TRUE 3D (`--eval`): K 10: 8.8 cm, K 30: 6.0 cm (throwing hand 8.4), K 60: 4.3, K 80: 3.7.
  The app's skeleton today is 9.7 cm on the same frames.
- 19:40 finding (`node tools/test/bodyproj.mjs`, report only): pulling the app's OWN 3D skeleton onto the library makes it
  worse, at every K and prior strength: joints 9.7 -> 10.7 (K 30) / 10.0 (K 60) / 9.8 (K 80) cm, throwing arm 11.1 -> 12.1
  / 11.6 / 11.3 cm (only front_3b's arm improves, 14.6 -> 13.4). So the app's 3D errors are themselves believable
  deliveries (mostly depth), and a 3D-only "snap to real motion" can't remove them. Step 2 must fit the library to the
  tracker's 2D points with the camera inside the fit (where the depth ambiguity is actually decided), and needs K 60+
  (or per-phase shapes): 30 shapes are too coarse to be a hard constraint. Don't retry the 3D projection.

- **19:40 BREAKTHROUGH (rebuild step 2, test tool only, app unchanged): fitting the library to the tracker's 2D points
  works.** `node tools/test/bodyproj.mjs --2d` (library K 80 = `bodylib.json` now 720 KB, held-out copy for the bench;
  scaled-orthographic camera fitted with the delivery by alternating least squares, Huber on bad points, per-sample
  whole-body left/right relabelling, prior `--lam2d 0.3`; timing from the app's own events): joints 8.72 -> 6.22 cm,
  throwing arm foot strike to release 10.29 -> 7.61 cm, better on EVERY camera (behind 7.7 -> 6.7, behind_3b 8.3 -> 6.3,
  front_3b 10.6 -> 6.5 (arm 14.2 -> 7.0), side_back 8.5 -> 5.9, side_open 8.5 -> 5.8). Prior sweep: lam 0.1 6.38,
  0.3 6.22, 1 6.45, 3 7.05, 10 7.94; K 30 only 8.3 (too coarse), K 50 7.3. Comparison is fair but not yet the bench's:
  both skeletons turned about the vertical onto the truth (the fit has no world frame yet), only over leg lift -0.25 s
  to release +0.09 s, joints only (no angles yet). 3036 (the lefty-stored-as-righty) is the worst pitch.
- 19:40 angles measured (`bodyproj.mjs --2d --angles --keeparm`, at the true event frames, same angle code for app and fit):
  the fitted body WINS on front knee FS/MER/BR 8.1/7.3/7.2 -> 5.4/5.2/6.6, trunk rotation 8.2/6.3/7.7 -> 6.2/6.2/6.5,
  separation 6.5/4.6/6.1 -> 5.9/4.6/5.8, forward tilt 4.3/5.8/5.6 -> 3.0/4.3/3.9, side tilt 4.8/7.2/7.1 -> 3.2/3.2/3.5;
  LOSES on pelvis rotation 6.7/6.0/5.6 -> 6.8/7.2/6.6 (the app's hip gains were tuned on this bench). The fitted ARM
  alone is worse (elbow 6.9/8.0/6.5 -> 9.4/12.3/9.6, layback FS 5.4 -> 12.3): the lab-throw arm match is better, so
  `--keeparm` keeps the app's arm in the trunk's own axes, hung on the fitted shoulders (arm angles then unchanged).
  Prior: lam 1 gives pelvis 6.7/6.8/6.3 and slightly worse tilts/separation FS; lam 0.3 kept.
- 19:40 pelvis finding (`--signed`): the fitted pelvis turns TOO FAR from side/front cameras late (signed at MER/BR:
  front_3b +4.2/+3.9, side_back +4.0/+5.2, side_open +2.4/+2.1) and too little from behind (-2 to -4), so separation at
  release reads +3 to +6 high on most cameras. A view-dependent bias = depth, which points at the orthographic camera.
  Tried `--apppelvis` (app's hip line on the fitted hips): pelvis back to the app's 6.7/6.0/5.6 but separation MER
  4.6 -> 5.9 (trunk and hips from different sources disagree): not the answer.
- 19:40 tried perspective (`--dist d --r3 ±1`, POSIT-style, report only): pelvis NOT fixed (6.8/7.1/6.6 at d 10). d 10 r3 +1:
  joints 6.22 -> 5.99 cm, arm 7.61 -> 7.37, front knee 5.4/5.2/6.6 -> 5.1/4.7/6.0, trunk BR 6.5 -> 7.0; d 4 similar;
  r3 -1 much worse (8.2 cm), so the sign must be picked by fit residual. The bench camera distance is unknown, so don't
  tune d on it: if perspective goes in, fit d from the picture. So the pelvis over-turn is not the camera model; next
  idea: the lab hip joint centres vs the tracker's hip points (MediaPipe hips sit wider/higher); compare the library's
  hip width with the benchmark truth's, and try weighting the hips down in the 2D fit (`map` weights).
- 19:40 hips weighted up in the 2D fit (`--hipw`, now default 4; report only): pelvis FS/MER/BR 6.8/7.2/6.6 -> 6.3/6.8/6.2
  (app 6.7/6.0/5.6), joints 6.22 -> 6.07 cm, arm 7.61 -> 7.28, forward tilt 3.0/4.3/3.9 -> 2.7/3.9/3.5, separation
  5.9/4.6/5.8 -> 5.5/4.5/5.7, trunk FS 6.2 -> 6.6 (still beats the app's 8.2). hipw 0.3 worse everywhere; 2: between;
  8: pelvis 6.1/6.6/6.0, trunk FS 6.8. Pelvis late still ~0.6-0.8° behind the app's (tuned) reading.
- 19:40 per view (defaults K 80, hipw 4, lam 0.3): the fit's joint error is lower on 58 of 60 views; worse only on 1826 side_back (7.3 -> 7.8 cm) and 3036 behind (7.0 -> 7.6). Worst fitted view: 3035 behind 8.3 cm.
- 19:40 "as the coach sees it" (`--seen`: angles at the app's event frames) for the hybrid: pelvis FS 10.2 -> 8.6, trunk FS/MER/BR 10.7/10.2/8.6 -> 9.2/7.8/6.5, separation FS/MER 6.9/8.0 -> 5.4/7.4 (BR 6.8 -> 7.3 worse), front knee 8.6/7.5/7.8 -> 5.6/5.1/6.9, forward tilt 4.8/6.6/5.9 -> 3.6/4.8/4.3, side tilt 5.5/7.4/7.2 -> 3.4/3.3/3.8; pelvis BR 5.4 -> 6.3 worse; arm unchanged.
- 19:40 prior re-swept with hipw 4 (as seen): lam 0.15 joints 6.20, 0.3 6.07, 0.6 6.04 (pelvis 8.6/5.6/6.1, trunk 9.6/7.5/6.4, sep 5.6/7.3/6.9), 1 6.12 (pelvis BR 6.0, trunk FS 9.9). Default now 0.6. Pelvis at release still 0.7 worse than the app; everything else as good or better.
- 19:40 K 60 vs 80 (new defaults, as seen): joints 6.25 vs 6.04, arm 7.78 vs 7.38, trunk FS 10.2 vs 9.6: keep 80 (bodylib.json 720 KB; more shapes may help further, the library has 366 deliveries).
- **20:40 session: the body fit is in the app as a trial (`?bodyfit=1`), off for everyone else.** `bodyfit.js` (same maths
  as bodyproj fit2D: K 80, hipw 4, lam 0.6), called from `analyse()` when `opts.bodyLib && opts.bodyFit`; app.js loads
  `bodylib.json` only with `?bodyfit=1`. Pelvis direction mixed 40% back to the app's hip line (`pelvisMix` 0.4: fit alone
  had pelvis MER 6.6, the mix 5.5; the fit over-turns from side cams, the app was tuned for that). Glove arm moves only with
  its shoulder; outside the fitted stretch the offset fades over 0.25 s. 60 lab views (`BODYFIT=1 node tools/test/bench.mjs`):
  joints 9.9 -> 7.9 cm, arm 11.1 -> 9.0 cm, front knee 8.1/7.3/7.2 -> 5.2/5.1/6.7, pelvis 6.7/6.0/5.6 -> 5.9/5.5/5.1,
  trunk 8.2/6.3/7.7 -> 6.6/6.1/6.3, separation 6.5/4.6/6.1 -> 5.0/4.1/5.1, forward tilt 4.3/5.8/5.6 -> 2.6/3.6/3.2, side tilt
  4.8/7.2/7.1 -> 3.1/3.4/3.8; arm angles identical; `BODYFIT=1 perview.mjs . --check` passes. WORSE: stride 4.9 -> 6.9% of
  height off (r 0.84 -> 0.64, behind cams -0.19 m), arm slot 6.2 -> 7.2°, jumps per view 1.6 -> 2.6 (glove wrist near release+).
  Real clips: Maher front knee at arm cocked 88 -> 44°, separation at foot strike 20 -> 53° (fit's numbers sit inside the
  12 lab pitchers' ranges, the app's didn't), Hackimer (slow-mo) not fitted (frames don't line up). Needs Jackson's eye on
  Maher/Staumont videos before it becomes the default.
- 20:40 later: stride keeps the app's own front-foot reading (`strideFoot`): with the fit 6.9 -> 4.0% of height off (app
  alone 4.9). Fit offset smoothed over time (`smooth` 3): jumps per view 2.6 -> 1.7 (app 1.6), shake 0.92 (app 0.92),
  separation 4.7/3.6/4.7, trunk BR 6.0. Tried, off: `armWorld` (throwing arm keeps its world direction): arm 9.0 -> 8.1 cm
  and arm slot back to 6.2°, but abduction 4.1/3.8/4.9 -> 5.5/7.5/6.6, layback worse. Arm slot with the fit 7.6° (app 6.2).
  Jackson notified (trial link = site address + `?bodyfit=1`). export_check passes with and without `?bodyfit=1`
  (cloud: `npm pack three@0.128.0`, THREE_JS=package/build/three.min.js, ORBIT_JS=tools/test/orbit_stub.js).
- 21:27: tests pass on 5759ccb; its website deploy failed once (no log, like the 18:11 UTC ones) and was re-run, still running at wrap-up. NEXT SESSION FIRST: check the latest "pages build and deployment" run succeeded; if not, re-run it (actions rerun) and tell Jackson if it keeps failing.
- 21:40 shipped (trial, `?bodyfit=1`): the body fit now runs on clips that start AT the leg lift (leg lift then placed 0.53 s
  before foot strike, `LLGAP`; library samples before frame 0 have no picture) and on slow motion with empty frames
  between tracked ones (Hackimer: 1 frame in 3 empty; bridged up to 3 frames). New `tools/test/latefit.mjs [--late n]`
  (60 lab views cut at the app's leg lift + n frames, app vs fit). Cut at leg lift: joints 10.2 -> 8.0 cm, front knee
  8.1/7.5/7.3 -> 5.1/4.9/6.0, trunk 8.3/6.4/7.5 -> 6.3/5.4/5.8, separation 6.5/4.5/6.0 -> 4.4/3.7/4.7 (before: not fitted).
  Full lab clips identical. Hackimer with the fit: separation at foot strike -17 -> 88° (lab 38-73), front knee at arm
  cocked 74 -> 23°: needs his video before anyone trusts it. Not fitted when foot strike is < 0.45 s into the clip (`MINLEAD`).
- 21:40 shipped (everyone): THROWING HAND on clips started just after the leg lift. The leg that lifts highest decided
  the hand, but on a late-started clip the highest knee is the throwing-side leg in the finish: 8 of 60 lab views cut
  1/10-1/6 s after leg lift read the wrong hand, and foot strike/release landed in the follow-through (~0.3 s late).
  Now the knee rule counts only if that knee peaks in the first 70% of the clip, else the hand-speed rule decides.
  Late by 1/10 s: event timing 33/25/24 -> 14/6/6 ms; by 1/6 s: 44/38/38 -> 14/5/5 ms, joints 18.8 -> 10.4 cm, pelvis
  17.6/22.3/19.8 -> 6.4/6.4/5.5 deg (= full-clip accuracy). Slow-motion reading of late-started clips (`slowmo.mjs --late`):
  1/3 s before foot strike 205 -> 227 of 240 right, 1/2 s 223 -> 229. Full clips, bench and regress unchanged.
- 21:40 shipped (trial): arm slot with the fit read from the app's own shoulder-to-wrist direction (`slotArm`): 7.5 -> 6.2°
  off (r 0.74 -> 0.85), same as the app alone. Item (2) below done.
- 21:40 finding: on clips started 1/6 s after leg lift the fit is now a small win (joints 10.4 -> 9.2 cm, trunk/separation/tilts
  better) except front knee at release 7.2 -> 8.5°. The `MINLEAD` 0.45 s gate barely separates cases (app's own foot strike
  decides it); kept so Hackimer (0.456 s) is fitted.
- 22:40 (body fit item 3, closed, no gain): `pelvisMix` by camera. New `tools/test/pelvismix.mjs` (runs the 60 views at
  mix 0 and 1 and saves signed pelvis/trunk/separation errors + camera direction; any mix in between is a straight line,
  checked: interpolated 0.4 = bench 0.4 exactly). Best mix per camera is 0.4-0.6 everywhere (behind 0.4-0.6, behind_3b 0.4,
  front_3b 0.4-0.6, side_back 0.4-0.6, side_open 0.4 at FS, 0.8 late but separation worse); per-camera or per-event mixes
  gain at most 0.1-0.3 deg. The 40/60 average beats either reading because their errors differ, not because of a camera
  bias. Kept 0.4 for all. Don't retry.
- 22:40 tried, dropped (late-started slow motion): on slowed clips from behind the skeleton's peak hand speed reads
  1.5-2x too fast in real time (2653 behind: 13.5 at 1x, 25 at 2x, 27 at 4x body heights/s; front_3b/side views
  steady 13-16), AND foot strike to release shrinks a frame or two (9 -> 7 real frames); 2653's own foot strike to release
  is only 0.15 s (constant assumes 0.2). Extra smoothing of the wrist path scaled to foot strike->release (sigma (R-FS)/6):
  evens 2653 (8 vs 11.6) but makes 3035 go the other way (8.2 -> 6.0). So no single fix of the clue; the 22 misreads
  of 480 stay (report only). Next idea if anyone retries: don't use hand speed when the camera is behind (cameraDir x <
  -0.5) on the FIRST pass, measure 1x losses with `slowmo.mjs --late 20/30` (14:40 numbers) before shipping.
- 22:40 tried, no gain (body fit): smoothing the fit's offset 6 passes instead of 3 (`glitch.mjs` now takes FITOPTS):
  jumps 1.7 same, shake 0.92 -> 0.91, separation BR 4.7 -> 4.4, trunk 6.6/6.0 -> 6.5/5.9, but front knee FS 5.3 -> 5.5,
  pelvis 5.9/5.6 -> 6.0/5.7. A wash, kept 3.
- 22:40 shipped (speed, Tuesday theme started early): the analysis after tracking (speed reading + skeleton) is faster with
  bit-identical results (pose, events, angles checked on 4 saved clips + 24 benchmark views; regress passes): Hackimer
  (480 fps slow motion) 4.2 -> 2.4 s, Maher 0.88 -> 0.58 s, Staumont 0.35 -> 0.25 s (Node, this sandbox; phones ~3-5x
  slower). Medians picked by quickselect instead of copy+sort (the glitch filter took thousands per joint), glitch filter
  without throwaway arrays, arm matching samples into reused arrays. What's left (`node --cpu-prof`): the lab-throw arm
  match scoring loop (~50% of a normal clip's analysis: every lab throw x 5 speeds x 25 shifts x 30 frames, run twice);
  an exact speed-up would need a lower bound to skip hopeless throws early.
- 22:40 tried, no gain: hand-speed clue weight from behind on late-started slow motion (`slowmo --late 20`): 0 -> 223,
  0.2 -> 227, 0.4 (now) 227, 0.6 -> 226 of 240.
- 22:40 next speed idea (not started): `detectSlowFactor` re-runs the WHOLE analysis for each release window it tries
  (0.5, 1, 2, 4, 60 s) and then the app analyses once more; on slow motion that's most of the 2.4 s. Only the release
  search differs between the tries, so caching everything before it (despike, swaps, lift) would cut it a lot. Must stay
  bit-identical: check with a pose/events/metrics equality script against the previous commit (as done 22:40) + regress
  + `slowmo.mjs`. Where: in analyseOnce, `relWindow` is first used at the release search (~pipeline.js:835); fixSwaps,
  learned depth, despike and `lift()` all come before it. Check that later code doesn't change `frames`/`Pc`/`imgSmooth` in
  place before caching them (or hand out copies).
  Measured first: Hackimer speed reading 1.0 s + skeleton 1.3 s, Maher 0.2 + 0.5 s, so the cache saves at most ~0.6 s on
  slow motion; the arm-match scoring (half of the skeleton time) is the bigger target.
- 23:40 shipped (speed): lab-throw arm matching skips timings that can no longer win (exact bound: running misfit already
  above the best so far x window weight, plus a quick-look limit from each throw's few easy timings and the 30th-best throw):
  analysis on 4 saved clips + 20 benchmark views 9.3-9.9 -> 7.3-7.7 s (~23% faster), results bit-for-bit identical
  (pose, events, all metrics). Only ~half the frames per timing get skipped because the misfit is an average; a bigger cut
  needs an approximate search (coarse grid then refine), which would change results: bench it if anyone tries.
- 23:40 shipped (speed): the slow-motion reader works out the part of the analysis that doesn't depend on its release
  window once (`prepOnce`, opts._prep, each try gets a deep copy) instead of up to 5 times: Hackimer speed reading 1.1 ->
  0.65 s; with the arm-match change the whole analysis on the 24-clip check is 10.4 -> 7.7 s. Bit-identical (pose,
  events, metrics, speed estimate), regress passes, `slowmo.mjs` 240 of 240.
- 23:40 shipped (speed): saved pitches re-read for Compare, Over time and Recent are kept in memory for the visit
  (`reanalyse` in app.js, keyed by pitch id + options + which libraries loaded, copies handed out, 30 kept): Over time with
  10 saved Maher pitches, headless: first open 4.4 -> 4.0 s, second open 3.9 -> 0.2 s. history_check and export_check pass.
- 23:40 shipped (speed): the foot-repair pass's first look (analyseCore) stops once foot strike and the throwing hand are
  settled (`_early`) instead of running the whole skeleton incl. both arm matches it never used: Maher fast 0.73 -> 0.47 s,
  Maher max 0.58 -> 0.46, Staumont 0.23 -> 0.19 (medians of 6, Node). Bit-identical on the 24-clip check, regress passes.
- 23:40 finding (Tuesday, long/large clips): a 60 s 4K clip (synthetic test pattern) loads, the pitch finder shows steady
  progress and the page's memory stays flat (~58 MB JS heap) through it; no errors. The page does freeze ~5 s right after
  upload and ~1 s at each pitch-finder step in headless Chromium, but the same happens on a 4 s 720p clip: it's MediaPipe's
  GPU readback (`glReadPixels`, software GL here), not clip size. Real-device check (phone) still needed; moving the pitch
  finder's pose model to a worker would remove the freezes (big job).
- 23:40 shipped (look, long clips): the pitch finder now says roughly how long it has left ("13% · about 8 min left",
  timed from its first progress step so model start-up doesn't skew it) and, when that's over 30 s, that you needn't wait:
  drag the trim and press Build skeleton (which already skipped waiting once you trim yourself). Checked on a 60 s 4K clip
  at 1280 and 390 wide, no page errors. Also checked: a junk/unplayable file gets the plain "can't play" message; this
  sandbox's headless Chromium DOES play H.264 now (CLAUDE.md said it didn't).
- 23:40 built `tools/test/samecheck.mjs` (save full results on old code, check bit-identical on new; prints time). This
  session's speed work in total, same 24 clips: 9.5 -> 5.5 s (42% faster), all results identical.
- 23:40 tried, no gain (samecheck, identical results, timing within noise or worse): despike on flat Float64Arrays (median
  over typed subarrays is slower: 5.2 -> 5.9 s); caching fixSwaps' per-frame labellings (5.3-5.4 vs 5.4-5.8, noise). Timing
  noise on this sandbox is ~±10%: repeat runs alternately (git stash) before believing a small gain.
- 23:40 shipped: if you press Build skeleton while the pitch finder is still going, the first step now shows its live progress and time left (was a still "Finding the pitch in this clip"). Checked at phone width, history_check passes.
- 0:40 session (Tue): pitch finder's pose model moved into a background worker (`finderworker.js`, falls back to the page,
  `?finderworker=0` forces the page). Headless, 12 s clip: page froze 98 times over 0.25 s (longest 4.7 s, ~0.8 s every
  look) -> 3 times (longest 0.43 s); same total time (74 s). Synthetic figure clip (`tools/test/finder_check.py`, draws a
  filled-in body on a fixture's 2D points; not real footage): 136 freezes (longest 5.6 s) -> 1 (0.28 s); 98 vs 104 s.
- 0:40 shipped (live, tests + deploy passed, Jackson notified): the finder change above. Then the Fast/High tracker's
  MediaPipe models moved into the same worker (renamed `poseworker.js`, several models per worker by key; `?poseworker=0`
  forces the page, `?finderworker=0` still works): tracker output on the synthetic clip byte-identical to the page path
  (`raw_fast.json` cmp), same time (302 s both). Page freezes during a Fast build: 223 over 0.3 s -> 2 (the one long freeze
  left, ~20 s headless, is the skeleton analysis itself after tracking, on the page in both). HIGH stays on the page
  (`{ page: high }` in trackSimple) until someone runs a High clip both ways and gets identical raw output. Note: `finder_check.py --compare` can differ by one look between runs on
  EITHER path (WebM seek timing), so re-run once before believing a mismatch. Not moved: Max accuracy's MediaPipe
  (`trackMax`, finder.detect/full.detectForVideo) and RTMPose (already async onnxruntime).
- 1:40 session (Tue): WEBSITE DEPLOY CAUSE FOUND: the "pages build and deployment" failures (runs 164/165) were "in progress
  deployment, cancel b59b363 first": a cancelled deploy run left a deployment stuck "in progress" that blocked the next
  ones. Re-running the failed run later succeeded (run 165 attempt 3, 06:42 UTC); everything up to 937ec19 is live. If it
  happens again: read the deploy job's log (actions jobs -> deploy -> log) and re-run once the stuck one has timed out (~10 min).
- 1:40 shipped: the skeleton build after tracking runs in a background worker (`analysisworker.js`; falls back to the page,
  `?analysisworker=0` forces it). Identical results on all 4 saved clips (`tools/test/anaworker_check.py`, now on GitHub).
  Page freeze during the build: Hackimer 2.1 s -> 0, Maher 0.7 -> 0.1, Staumont 0.4 -> 0. Full Fast run in the app (synthetic
  clip): built in the worker, no page errors. Moving an event by hand also re-builds off the page (button greyed while it works).
- 1:40 shipped: Recent/Compare/Over time re-reads go through the worker too (`reanalyse` is async): Over time with 10 saved
  Maher pitches, longest freeze 0.9 -> 0.1 s, but total 4 -> 5 s on this 2-core sandbox with another browser test running
  (worth re-timing on a quiet machine; if it's really slower, run the re-reads for Over time on the page in one go and only
  the single re-opens in the worker).
- 1:40 checked: HIGH in the pose worker: tracker output byte-identical to the page (synthetic Staumont figure clip trimmed
  1.0-2.3 s, 77 frames x 2 passes, `raw_high.json` cmp identical), same time (591 s both, headless), no fallback warning.
  Shipped: High now runs in the worker by default (the `?highworker=1` gate is gone; `?poseworker=0` still forces the page).
  Freeze reduction for High not measured separately (Fast's was 223 -> 2 freezes over 0.3 s). `window.__poseFellBack` is set
  if the worker fails mid-run (for tests). Tip: a full untrimmed High run takes 25+ min here; trim to ~1.3 s around the pitch.
- 1:40 shipped: the "Rebuilding the 3D skeleton" step counts seconds while it works (now that the page can update during it).
- 2:40 session: Max accuracy in the background, NOT LIVE, on branch `wip-max-worker` (e26ff4f). Three changes there:
  (a) Max's MediaPipe models (pass 1 VIDEO tracker + 3-person IMAGE finder, zoomed/backward VIDEO passes, still looks)
  go through `poseModels` (worker gets `mode`/`poses` at init; a fresh worker per pass); (b) onnxruntime's wasm `proxy`
  (RTMPose and the lifter run in ort's own worker) when there's no WebGPU adapter, `?ortproxy=0` turns it off;
  (c) analysis worker pool (up to 3, cores-1) so Over time/Compare re-read pitches side by side (not timed yet:
  `tools/test/trend_time.py <fixture> 10 [-|?analysisworker=0] [cores]`, new).
  New `tools/test/maxworker_check.py` (synthetic figure, 30 frames + 12 pad, Max both ways, `--only worker|page|compare`
  for two parallel shells, ~17 min in parallel). Result with (a)+(b) vs old way (`?poseworker=0&ortproxy=0`): page
  freezes over 0.3 s 119 -> 1, longest 32.6 s -> 0.28 s (that's the win). BUT tracker output not identical: pass 1
  ('full') identical, pass 2 'zoom' differs from frame 0 (up to 0.12-0.37 of the picture), so the crop boxes differ,
  i.e. the IMAGE finder (`first[]`) or `dup[]` differed. An earlier run with (a) only, no pad, sequential: pass 1 AND
  2 identical, pass 3 differed only because the clip's LAST frame read as a repeat in one run (seek at the very end;
  fixed by the pad). So suspect: (b) the proxy, or contention from running both at once. The branch now saves `dup` and
  `first` in `window.__lastLooks` (maxworker_check writes them to looks_max_*.json). NEXT: run worker vs page ONE AT A
  TIME on the branch, compare `first`/`dup`; if identical, the parallel run was the cause; then run with `?ortproxy=0`
  on the worker side to split (a) from (b). Ship (a) and (b) separately only when identical. Then time (c).
- 5:40 shipped (reliability, live, tests + deploy passed, Jackson notified): saving a pitch when the browser's storage is
  full or never answers. Before: full storage lost the pitch without a word; storage that never opens (seen on some iPhones)
  left the page on "Building" for good (the save was awaited before the results open). Now: the oldest saved videos make
  room for the newest (unless even that can't fit it), else it's saved without its video; storage that doesn't answer gives
  up after 6 s (open) / 45 s (whole save); a note above the results says which. `tools/test/storage_check.py` (on GitHub).
  Worth knowing: Recent stores the WHOLE uploaded file for the newest 6 pitches (a 4K phone clip can be 300 MB+); storing
  only the trimmed pitch (re-encode the trim window) would fix the storage pressure itself: new Tuesday item.
- 5:40 Max worker identity check DONE: same synthetic 30-frame clip, run one at a time: old main (no worker) raw hash
  189d65882e42; wip-max-worker page side (`?poseworker=0&ortproxy=0`) 189d65882e42 (looks 3de9d1b584ac); worker side
  (4:40 run, with the proxy) 189d65882e42 (looks 3de9d1b584ac). All identical: the earlier "pass 2 zoom differs" came from
  running both sides at once (and the fuse crash). Page freezes: old way longest 24.5-32 s (117-119 over 0.3 s); worker+proxy
  0.63 s. Shipping 5:40 (branch `shipmax`, rebased on main): (a) Max's MediaPipe in the pose worker ON; (b) onnxruntime proxy
  for RTMPose/lifter only as a trial (`?ortproxy=1`) because if its worker fails to start on a phone the stronger tracker
  and learned 3D would quietly drop out: needs a real iPhone/Android check before default; (c) parallel re-read pool NOT
  shipped (stays on `wip-max-worker`, untimed: `tools/test/trend_time.py`).
  SHIPPED 5:40 (fc5f299): (a) live; worker run on the shipped code: raw 189d65882e42 / looks 3de9d1b584ac (identical), longest
  freeze 24.5-32 -> 17.2 s, freezes over 0.3 s 117-119 -> 53. The 17 s left is RTMPose on the page: (b) removes it (0.6 s).
- **6:40 session:** SHIPPED f03c69b (tests + deploy passed): onnxruntime background worker ON by default for the stronger
  tracker (Max), with a safe fallback: `ortboot.js` tries the worker with a 62-byte test model (30 s limit); if it's refused
  or silent, onnxruntime is loaded again on the page. `tools/test/ortproxy_check.py [--rtm]` (on GitHub): learned 3D and a
  tracker look byte-identical worker / ?ortproxy=0 / worker refused / worker silent; tracker start-up page freeze 15.7 ->
  0.07 s. Fast/High keep onnxruntime on the page (the learned 3D alone freezes 0.1 s; worker adds ~0.5-1.4 s start-up).
  Max end to end with the worker on (maxworker_check --only worker, 30 synthetic frames): raw 189d65882e42 / looks
  3de9d1b584ac, identical to before; longest page freeze 17.2 -> 0.37 s; 692 -> 653 s.
  Still worth a real iPhone/Android look (`window.__ortProxy` in the console says what happened).
  IN PROGRESS (trial, flag `?keepclip=1`, off by default): Recent keeps only the analysed pitch as a small MP4
  (`keepclip.js`: each frame pass 1 of the tracker visits is also encoded, ≤1280 px, frame i at i/fps; saved only if <80%
  of the upload; rec.clipStart = window start, re-open shifts data.start by it). `tools/test/keepclip_check.py <video>`:
  60 frames of a 1080p test pattern, 2.6 MB -> 0.34 MB, every frame lines up (0 off by one). history_check has a re-open
  check for clipStart. 7:10: full Fast run with the flag (`tools/test/keepclip_run.py <clip> <outdir>`) on the 112 KB
  synthetic mannequin clip: no errors, re-open identical, but the pitch-only MP4 wasn't smaller so the upload was kept
  (correct). On a noisier 3.6 MB copy (ffmpeg noise=alls=12, 25 Mb/s) the Fast run had NOT reached results after 10 min
  (killed at 7:25): FIRST find out whether that's the keeper (VP9 software encoding / encodeQueue wait in headless) or
  the noise breaking the finder/tracker: run the same clip without `?keepclip=1` (edit the URL in keepclip_run.py).
  If it's the keeper, add a time budget (skip keeping if encoding falls behind). NEXT after that: (1) full Fast run with `?keepclip=1` on a synthetic clip (`finder_check.py` makes one) via
  clip_run, re-open from Recent, check the overlay video and screenshots match the first open; (2) multi-angle and
  Ultra keep the whole upload (only K===1 Fast/High/Max); (3) then default ON and add keepclip_check to GitHub
  (needs a generated test video: ffmpeg testsrc2 in the workflow). history_check flaked here under CPU load (a Max run
  in the background): re-run it on a quiet sandbox.
- **NEXT SESSION (after 5:40), Tuesday speed and reliability:** (0) check tests/deploy for fc5f299 and later; (1) make the
  onnxruntime proxy safe to turn on by default: if the proxy's worker fails to start, fall back (DONE 6:40, f03c69b) (e.g. load a second
  copy of ort without proxy, or detect support up front) and say so in `window.__ortProxy`; test by blocking the proxy
  worker's script in Playwright; then default ON (freeze 17 -> 0.6 s); (2) time the parallel re-read pool (c) with
  `tools/test/trend_time.py` on a quiet sandbox (nothing else running), ship if faster; (3) keep only the trimmed pitch
  video in Recent (new Tuesday item).
- **4:40 session: the "hang" was Max failing, now fixed on main (7d6c0eb).** The worker run never hung: Max returned to the upload
  screen with "Cannot read properties of undefined (reading '0')" (maxworker_check only watched for the results page, so it
  looked like a hang). Cause: `fuseSoft` (fuse.js) crashed on a frame with exactly one built-in look + one stronger-tracker look
  (frame 27 of the synthetic clip had only 'full' and 'rtm'): the single built-in look has no `spread`. Live bug for any Max run
  where most passes miss a frame. Fixed (how sure = distance between the two looks), `tools/test/fuse_check.mjs` (27 mixes, on
  GitHub; old code fails 3). Normal frames unchanged (regress all ok; tests run 156 passed). CHECKED 5:31: with the fix the worker side
  alone REACHES RESULTS (692 s for 30 frames, longest freeze 0.63 s, no errors; raw hash 189d65882e42, lookHash 3de9d1b584ac).
  Website deploy for 881da23 failed with no log (the old flaky kind); this wrap-up push retries it: CHECK it. wip-max-worker has the fix too, and its check now prints
  "STOPPED with: <error>" instead of HUNG. A worker-side re-run with the fix was started 5:20 (results in scratch, may not finish).
  NEXT: (1) worker side alone on wip-max-worker should now reach results; then page side alone (`--only page`), then `--only compare`
  (first/dup/raw identical?). Why the worker run had only 2 looks on frame 27 while the page run had more is the same open
  question as "pass 2 zoom differs" (worker vs page tracker output); 2 cores: one side at a time, ~11-15 min each.
- 3:40 session (Max worker identity check, NOT finished): ran the worker side ALONE on the branch (`--only worker`, maher_max
  fixture, 30 frames): it HUNG. The browser's graphics process worked ~21 min, then sat idle from ~4:03 ET; the page never
  reached the results and showed no page error (killed at 4:20). The earlier parallel run finished both sides in 17 min,
  so this is new: suspects are a promise with no time limit, most likely onnxruntime's proxy (`session.run` for RTMPose/
  lifter inside ort's own worker has no timeout; the pose worker's own calls do time out at 20 s and fall back).
  Pushed to the branch (5449e61): maxworker_check.py now prints each progress step and reports "HUNG ... at <step>" after 5 min
  without progress. NEXT: (1) re-run `--only worker` alone (start it first thing; ~25 min; THREE_JS = three.min.js from
  `npm pack three@0.128.0`, the CDN is blocked here) and read where it hangs; (2) if it's in the stronger tracker / 3D depth
  step, re-run with `?ortproxy=0` on the worker side: if that finishes, (b) the proxy is the hang AND the likely cause of the
  differing output, so ship (a) alone (MediaPipe in the worker) after an identical-output run, and drop or time-limit (b);
  (3) then the page side alone and compare `first`/`dup`. 2 cores here: never run both sides at once.
  Re-run started 4:21 to test the reporter: works (prints a line per frame); alone, pass 1 took 3.5 min (30 frames), pass 2 (stronger tracker) ~9 s/frame. Session ended before it reached the old hang point.
- **NEXT SESSION (after 1:40), Tuesday speed and reliability:** (0) confirm test run 148 (0ed4df1, High in the worker) passed; its website deploy already succeeded. (1) Max accuracy's MediaPipe calls into the pose worker
  (`trackMax`: finder IMAGE mode + full VIDEO mode; the worker only does VIDEO: add a mode to init) and check byte-identical
  raw on a trimmed synthetic clip (Max is slow: trim hard); (2) re-time Over time (10 pitches) worker vs `?analysisworker=0`
  on a quiet sandbox (1:40 measured 4 -> 5 s total under load); (3) analysis memory/GC (typed arrays, samecheck.mjs).
- **NEXT SESSION (after 0:40):** (1) check run for b59b363 (and later) passed and the site deployed; (2) High in the
  worker: a 0:40 test was left running (`?highworker=1`, synthetic 2.2 s clip; results not read): redo it, see Tuesday
  list; (3) then the skeleton analysis in a worker (biggest freeze left, ~20 s headless), then Max's MediaPipe.
  0:40 wrap: website deploy for 38ce1e9 failed twice with no log (b59b363's was cancelled by it), so this push is a fresh
  try: CHECK the newest "pages build and deployment" run; if failed, rerun it and tell Jackson if it keeps failing.
  The High test pair (2.2 s clip) hadn't finished after ~8 min of headless High; give it 15+ min, one at a time.
  Synthetic test clip: `tools/test/finder_check.py` writes `finder_mannequin.webm` into its outdir (no real clips in the cloud).
- **NEXT SESSION (after 23:40), Tuesday speed and reliability:** analysis after tracking is now 42% faster with identical
  results (see 23:40 lines); what's left in Node per clip is GC/small-array churn and the arm-match scoring (an exact bound
  can't cut it further; an approximate coarse-to-fine search would need the bench). Bigger wins now are in the browser:
  (1) the pitch finder and tracker run MediaPipe on the page's main thread, freezing it ~1 s per step in headless (GPU
  readback): try a Web Worker / OffscreenCanvas for the finder, check on a real phone; (2) profile Max accuracy on a real
  clip (needs a pitching video: none in the cloud); (3) phones: emulate iPhone/Android widths through a full Fast run once
  a real clip is available. Use `tools/test/samecheck.mjs` for any speed-only change.
- **NEXT SESSION (after 22:40):** body fit items (3) and smoothing are closed; what's left needs Jackson's eye: (4) a visible
  trial switch and (5) default ON after he has looked at Maher/Staumont with `?bodyfit=1` (Jackson notified at 20:40,
  no answer yet). Without that: Tuesday theme starts at 8:15: profile Max accuracy (headless, `clip_run.py max`), phones,
  long/large clips. Night sessions can start on Tuesday items now (Monday accuracy items are blocked on clips or at
  their measured floor). Website: deploy run 143 (TODO-only push) failed with no log again; code commits since 3059814
  deployed fine; check the run for the 22:40 pushes.
- **NEXT SESSION (after 21:40):** body fit items (3) `pelvisMix` by camera, (4) visible trial switch; Hackimer with the fit
  needs his video (separation at foot strike 88°, a bit above the lab's 38-73). Tuesday theme from 8:15: profile Max, phones.
  Late-started slow motion still 13/11 of 240 wrong (`slowmo.mjs --late 20/30`): 12 of the 22 are behind/behind_3b cameras,
  all on the 'foot strike to release' clue, estimates near the halfway point between speeds (2x read 1.14-1.38, 4x read
  2.44-2.77, 8x read 4.7-5.5: all ~0.6x too short), 2653 behind wrong at every speed. Next idea: foot strike reads late
  (or release early) from behind on slowed clips; check the clue's foot strike vs truth on those views at 4x.
  Checked: the same views at 1x read 0.72-0.85 (fine), at 2x 2653 behind reads 1.14: so the slowed clip itself reads ~0.6x
  short (same as the 18:40 wrist-speed finding), not the pitch. Try the 18:40 window idea (fixed fraction, interpolated).
- **NEXT SESSION (after 20:40), body fit, in order:** (1) (done 21:40) Hackimer isn't fitted because his clip starts at the leg lift
  (leg lift read at frame 0; the fit needs 0.25 s before it). Idea: let the fit start at the first frame when the clip
  starts late (drop the samples before it from the 2D fit; the library still spans them) and check on the lab views cut
  to start at leg lift (`slowmo.mjs --late` has the cutting code); (2) (done 21:40) arm slot with the fit 7.6 vs 6.2°: read
  arm slot from the app's arm direction only, or find why the trunk-axes arm tilts the slot; (3) `pelvisMix` by camera
  (fit over-turns side-on, under-turns behind); (4) a visible "Lab-matched body (trial)" switch instead of the URL flag, if
  Jackson likes it; (5) default ON only after Jackson has looked at Maher/Staumont with `?bodyfit=1`. Speed: the fit adds
  ~0.4-0.7 s per analysis in Node.
- **NEXT SESSION (after 19:40), in order:** (done 20:40 as a trial, see above) (1) put the hybrid into pipeline.js behind `_bodyFit` (fit2D from
  tools/test/bodyproj.mjs: library K 80 + hipw 4 + lam 0.6, app's arm kept in trunk axes, app pose outside the window
  with a short blend), load `bodylib.json` in app.js like armlib (bench must use the holdout copy), then run bench (incl.
  "as the coach sees it"), perview, regress, glitch; (2) if pelvis late is the only loss, try the app's `_hipGain`
  logic on the fitted hips; (3) Maher/Hackimer/Staumont strips before making it default. Perspective (`--dist`) is a
  small extra (-0.2 cm) once d can be read from the picture.
- (superseded) NEXT SESSION: (0) pelvis over-turn (see the line above: hip point definition
  / hip weights in the fit), then (0b) perspective with d fitted from the picture; (0c) old step: perspective camera in `fit2D` (camera distance as a
  parameter, e.g. Gauss-Newton on distance with the linear steps inside) and re-check the signed pelvis; (1) pelvis: find why it's 1° worse late (signed bias by camera;
  try perspective camera, or keep the app's hip turn and only take legs/trunk from the fit); (2) the "as the coach sees
  it" table (angles at the app's event frames); (3) put the hybrid (fitted body + app arm) into pipeline.js behind
  `_bodyFit`, blend to the app's pose outside the window, then bench/perview/regress/glitch, and Maher/Hackimer/Staumont
  strips; ship if it wins.
- (older) NEXT SESSION, in order: (1) angles: turn the fitted delivery into a full 33-point pose over the window (head/feet
  from the app's own pose, offsets kept) and score the bench angle table (elbow, layback, rotations, tilts at FS/MER/BR,
  "as the coach sees it") vs the app; (2) refine timing inside the fit (event frames ±2 as parameters, pick best 2D
  fit) and add perspective (camera distance) instead of orthographic; (3) frames outside the window: blend back to the
  app's pose; (4) put it in pipeline.js behind an option (`_bodyFit`), bench + perview + regress + glitch, then make it
  the default if it wins (step 5 of the rebuild plan). Lab data: re-download each session (steps in the rebuild section),
  `python3 tools/bodylib_build.py <landmarks.csv> <metadata.csv> --eval` rebuilds both library files.

### Notes carried over from 2026-11-06 (elbow and trunk)
- Elbow, measured: both the video-only arm (`_tmplAll:0`, -7.7°) and the lab-only arm (`_tmplAll:1`, -7.6°) share the bias. Not the 2D,
  not bone lengths (+-5%: <1°), not smoothing of the 2D, not a skewed camera axis. Less lab arm on the upper arm (`_tmplAll` 0.5 -> 0.3):
  elbow FS 9.5 -> 8.7° but layback FS 5.7 -> 6.0°: a trade, not shipped.
- Trunk: after release from behind_3b the shoulder line's depth sign can't flip (tracker reads shoulders ~11% narrow there); a
  second-order track and a faster Viterbi step did not help.
- Layback at release is mostly unfixable from one camera (elbow nearly straight, forearm spin ambiguous).

## TOP PRIORITY: the pitching-aware rebuild (Jackson's decision, 2026-11-09)

**UNBLOCKED (2026-11-10): the lab data CAN be downloaded from a cloud session.** It's a GitHub Release asset, not in
the git tree (that's why `full_sig/landmarks` was never found). This worked (33 MB, checksum matches the lab repo's
`scripts/release_checksums.sha256`):
`curl -sSL -o pitching_landmarks.zip https://github.com/drivelineresearch/openbiomechanics/releases/download/dataset-v1/pitching_landmarks.zip`
then `sha256sum` must be `efcc078d5d8e77ed1fbf0b9f6a78f750c57a624165f71f30e34142b74db7ec22`. It holds one file,
`landmarks.csv` (110 MB, joint centres for every pitch, with event times joined in). Keep it OUTSIDE the repo (never
commit it: the repo is the public website). Metadata (`baseball_pitching/data/metadata.csv`) is in the git tree:
`git clone --depth 1 https://github.com/drivelineresearch/openbiomechanics`. Note: in auto mode, unzipping the
downloaded archive was refused once as "code from external"; if that happens, tell Jackson he needs to allow it.

Jackson wants the glitches gone for good: limbs jumping/shaking, body flips/twists, the throwing arm not following
the real motion, wrong timing/numbers. Decision: **fit the whole delivery to real motion-capture pitches** instead of
building the body frame by frame and patching it. The output is always a believable pitching motion; the video
decides how this pitcher differs. Runs in the browser (free, private, no accounts). Feole is free/personal, so the
non-commercial OpenBiomechanics data is fine. (Ultra is back on the list as a separate, optional cloud mode: see "Ultra" below; the rebuild stays the default path.)

The arm already works this way (`armlib.json`, "lab throws"), which is why layback improved most. Extend it to the
whole body. Every session works on this before anything else, in order:

1. **Build the pitching motion library** from all OpenBiomechanics pitches (github.com/drivelineresearch/openbiomechanics,
   `baseball_pitching/data/full_sig/landmarks`): whole-body 3D joints, normalised for height, handedness (mirror to
   cover lefties), direction, and time-warped to common events (leg lift, foot strike, max layback, release). Learn a
   compact model of it (e.g. PCA over time-warped whole deliveries plus per-phase variation) small enough to ship
   (a few MB). Hold out the benchmark pitchers from the library when scoring.
2. **Fit it to the video**: find the delivery shape, timing (event times / time-warp), body size and camera
   (direction, distance, tilt, pan) that best line up with the tracker's 2D points over the whole clip, robust to bad
   frames (blur, net, occlusion) and with the tracker's left/right uncertainty handled inside the fit, not patched.
   Allow the pitcher to differ from the library (arm slot, stride, trunk tilt, timing) but only smoothly.
3. **Score it** with `tools/test/bench.mjs` (12 pitches x 5 views vs motion capture), `reportcheck.mjs`,
   `regress.mjs` and new glitch measures: frame-to-frame joint jumps, left/right flips, impossible joint angles.
   Must beat the current skeleton on the benchmark averages and per view (`tools/test` compare tool).
4. **Check unusual deliveries**: sidearm, submarine, very long or short strides, slide-step, lefties; make sure the fit
   lets the video win where it's clear (report how far the pitcher sits from the library average).
5. **Make it the default** once it wins, show Jackson frame strips old vs new on the real clips, then **retire the
   patches** it replaces (flip fixes, per-frame smoothing tricks, separate arm matching) so there's less to go wrong.

## Ultra (optional cloud mode, back on the list 2026-11-10)
Jackson wants Ultra. It sends the clip to a GPU on Modal running GVHMR (SMPL-X body) and returns the skeleton; everything else stays
free and on the device. Built so far: `ultra.js` (58 lines, URL via `?ultra=` / `ULTRA_DEFAULT_URL` empty) and `ultra/app.py` (Modal app).
Doable now, without the account (any session, Tuesday/Thursday themes fit):
1. Read `ultra.js`/`ultra/app.py` end to end; write down exactly what is missing to run one clip (weights, secrets, deploy step, URL).
2. Make the Ultra button honest: if no service URL is set, say "Ultra isn't switched on yet" instead of failing; show that the clip
   leaves the device and roughly how long it takes, before upload.
3. A dry-run test (`tools/test/ultra_check.py`): fake Ultra service in Playwright returning a saved skeleton; app shows results, saves to
   Recent, PDF/CSV match (like export_check).
4. Plan to score it: run Ultra output through `bench.mjs` on the lab views once it works, next to Fast/Max and the lab-matched body.
Blocked on Jackson (see Waiting on Jackson): the SMPL-X account and the cost OK. Then: deploy the Modal app, measure seconds and cost per
clip, score on the benchmark, and only show Ultra if it beats Max on the lab views.

## Waiting on Jackson
- Ultra mode (GVHMR cloud): BACK ON by Jackson (2026-11-10). Needs from him: (1) a free SMPL-X account (smpl-x.is.tue.mpg.de, he must accept the licence himself) and its login saved as the Modal secret `smplx` / GitHub repo secrets (never print or ask for the values; he enters them); (2) OK on the per-clip GPU cost once measured.
- Reference clips: Jackson to send his own pitchers' clips (any angle) so they can be added to the regression tests.
- Clips needed for the items marked "(Needs clip…)": the Cooper Maher video, a few net / batting-cage / chain-link
  clips, one crowd-background clip (Sale, Ohtani, Flaherty, McKenzie or Joyce) and, ideally, a real left-hander. The
  cloud sessions have no videos and can't download them: drop them in the chat or the project.

## Monday: accuracy of the skeleton
- Use the scorecard to find the worst camera angle and the worst angle reading, and improve it.
- Throwing arm at release: the fastest part of the delivery and the most often blurred. Improve layback and
  elbow readings around max layback and release (arm-zoom, smoothing that keeps the peak).
- Maher clip: follow-through gets less steady after the camera zooms in after release. Re-find the pitcher's box
  when the picture scale jumps. (Needs the clip from Jackson.) 2026-11-05 finding: the saved tracker data shows no
  picture-scale jump (body ~580 px tall at the start and at the finish), so the zoom can't be seen without the video.
  The data does show Fast mode flipping the whole body left/right for 5 frames just after release (1.78-1.85 s); it's
  corrected, but that's where the finish wobbles.
- Layback reads over 180° at foot strike on Maher (219° in fast and max). On the benchmark (lab arm match on, as in
  the app) layback at foot strike is only 5.6° off, so look at Maher's own arm around 1.58 s: probably the forearm
  pointing the wrong way toward/away from the camera there.
- Trunk rotation at foot strike and release (see Today): the worst angle reading left, 11-18° off.

- Throwing elbow at foot strike is unreliable from one camera (typical error 17°, some views 70°+, wobbling 50-100° in
  1/30 s): improve the arm while it is behind the body at landing.

## Tuesday: speed and reliability
- Max accuracy's MediaPipe calls (`trackMax`: finder.detect IMAGE mode + full.detectForVideo) into the pose worker
  (the worker only does VIDEO mode today: add a mode to init).
- Analysis memory/GC: the skeleton maths makes millions of tiny arrays (GC is the top item in a Node profile); typed arrays in the hottest loops (despike, lift, oePass) would cut it. Check with samecheck.mjs.
- Max accuracy takes several minutes: profile where the time goes (tracker, arm-zoom, net cleaning, learned 3D)
  and speed up the biggest part without changing the scorecard or regression results.
- Long and large videos (phone 4K, 60 s clips): make sure they don't run out of memory or freeze the tab; show
  honest progress.
- Phones and tablets: check the app runs on mobile Safari/Chrome (or fails with a clear message), and that
  Fast mode is usable there.

## Wednesday: pitching measurements
- Measured 2026-11-09 (`node tools/test/sequence.mjs`, 60 views): pelvis peak speed timing 23 ms off, trunk 28 ms; peak speeds 91 / 129 °/s off; pelvis-before-trunk order right on 49 of 60; the pelvis-to-trunk gap averages right (41 ms vs 39) but is 34 ms off per pitch, about the size of the gap itself. So: show peak speeds and order as a rough guide only, don't show the gap in ms per pitch until it's better.
- Kinematic sequence: pelvis, trunk, arm peak rotation speeds and their timing order (pelvis → trunk → arm),
  checked against the benchmark truth.
- Stride: stride length (% of height), stride direction (open/closed), front-foot angle at foot strike.
- Arm slot at release (degrees) and release height/extension, checked against the benchmark truth.
- Hip-shoulder separation: peak value and when it happens relative to foot strike.

## Thursday: testing and validation
- Net cleaning: test on more net/fence clips (chain-link, batting cage, diagonal nets) and confirm crowd/fence
  clips keep the net check off (Sale, Ohtani, Flaherty, McKenzie, Joyce). (Needs clips.)
- Regression tests: add a fixture for a crowd-background clip so the net check is guarded too (left-handed part done
  2026-11-05). (Needs a clip.)
- Slow-motion reading on clips that start AFTER peak leg lift (phone video started late): still wrong on about 1 in 3
  benchmark views (`node tools/test/slowmo.mjs --late 20` and `--late 30`: 18 of 60 views have at least one wrong
  speed). Without the leg lift the only timing left is foot strike to release, which is too short to read reliably
  (0.12-0.30 s across views). Needs a second clue that doesn't depend on the leg lift (e.g. how long the stride or the
  arm path takes). Full clips are all right (240 of 240).
  2026-11-09: added peak hand speed as a second clue: 1/2 s late 20 -> 11 views wrong, 1/3 s 22 -> 16 (of 60). Still not solved.

## Friday: coaching report and finish

## Ideas (free rein from Jackson, 2026-11-09: take these on when the day's project is done or blocked)
- Graded coaching report: Jackson said on 2026-11-06 he does NOT want it back. report.js and tools/test/reportcheck.mjs
  stay in the repo unused; don't spend time on them.
- Any change to how the app looks.

## Done
- 2026-11-10 (8:15): Lab-matched body (trial) tested on 14 unusual lab pitchers (new `unusual_make.py`/`unusual.mjs`): no longer flattens the front knee (8.4 -> 6.1 deg off) or separation toward the average; 2.8x faster; refused when it doesn't line up with the video (`fitguard.mjs`); tick box on the trim screen.
- 2026-11-10: Recent keeps only the analysed pitch as a small video (default ON; 31 MB test upload -> 1.1 MB), hand-moved events stay lined up on re-opened pitches.
- 2026-11-10 (1:40): Skeleton build and saved-pitch re-reads run in a background worker (`analysisworker.js`, identical results; build freeze 2.1 s -> 0 on Hackimer); High accuracy's tracker in the pose worker (byte-identical output); website deploy blockage (stuck deployment) found and cleared.
- 2026-11-10: Pitch finder and Fast tracker run their pose model in a background worker (`poseworker.js`): page freezes while scanning 98 -> 3, while tracking 223 -> 2; identical readings.
- 2026-11-10 (23:40 Mon session): analysis after tracking 42% faster with identical results (24 test clips 9.5 -> 5.5 s); Over time/Compare instant on second open; pitch finder shows time left on long clips; `samecheck.mjs`.
- 2026-11-09 (17:40): Event timing from the lab's own gaps: arm cocked 11 -> 6 ms off motion capture, foot strike 23 -> 14 ms; as the coach sees it layback at foot strike 25 -> 15°, at arm cocked 11 -> 7°, trunk at arm cocked 15 -> 10°; tempo 24 -> 15 ms.
- 2026-11-09: Foot strike 34 -> 23 ms off motion capture; arm cocked 27 -> 11 ms; as the coach sees it, layback at arm cocked 33.9 -> 11.1° off. Pitcher box and different-spot note.
- 2026-11-09: Recent keeps 30 pitches (newest 6 with video), renaming, "Track a reading over time", Compare bolds by each reading's own measured limit, warnings for different camera spots and accuracy settings; "What to trust" gives measured numbers.
- 2026-11-09: Late-started clips read their slow motion better using the hand's speed (1/2 s late: 20 -> 11 of 60 views wrong).
- 2026-11-09: Tempo card, leg lift to foot strike, on the results page, PDF and spreadsheet.
- 2026-11-09: Cameras behind the pitcher: trunk at release 8.8 -> 7.9° off overall, pelvis at arm cocked 6.9 -> 6.5°.
- 2026-11-09: Hips and shoulders turn further after foot strike: pelvis at arm cocked 9.1 -> 6.9° off, release 8.5 -> 6.4°; trunk 7.5 -> 6.3°, 10.8 -> 8.8°.
- 2026-11-09: CSV export ends with the delivery numbers (stride, arm slot, peak separation), checked against the screen.
- 2026-11-09: Re-opening a saved pitch says so when its numbers have changed by 3° or more since last opened, with the biggest change (once only).
- 2026-11-09: Video downloads checked (`tools/test/video_check.py`, also on GitHub): right length, and every picture of the overlay video is the exact source frame its skeleton was computed for (Maher, Staumont, Hackimer's slow motion: 0 wrong frames). No bug found.
- 2026-11-09: Shoulder width from the pitcher's own delivery (trunk at release 11.4 -> 10.8° off); spine lean scaled back (side tilt 7.7 -> 7.2° at max layback); PDF rotation speeds; per-view check on GitHub; plainer failure messages.
- 2026-11-09: Delivery numbers (stride, arm slot, hand height with height entered, peak separation) on the results page, PDF and Compare; arm slot 7.4 -> 6.4° off; warning when a clip doesn't look like a pitch; Compare fits on a phone.
- 2026-11-09: Compare two saved pitches side by side (Recent pitches); PDF angle table has Layback; PDF/CSV check on GitHub Actions; elbow at foot strike 8.6 -> 7.8° off.
- 2026-11-06: Throwing arm follows the best-fitting lab throws frame by frame: layback at release 39.8 -> 24.7° off,
  elbow at max layback 12.7 -> 9.7°, shoulder abduction at max layback 7.1 -> 5.1°.
- 2026-11-06: PDF * for blurred throwing-arm values; PDF/CSV checked against the screen (`tools/test/export_check.py`);
  saved pitches keep hand-moved events and re-open the same on a slow connection.
- 2026-11-06: Every module the app loads (pipeline.js included) now carries the version stamp (import map in
  index.html), so analysis updates reach returning visitors on the first refresh instead of after the cache expires.
- 2026-11-06: Shoulder line depth read against a width that narrows toward foot strike: trunk turn at foot strike
  11.5 -> 10.6° off, hip-shoulder separation at foot strike 11.5 -> 9.0°, from behind toward third base 17.9 -> 13.4°.
- 2026-11-06: Layback graph renamed "Layback" (was "Layback (modelled)") with an up-to-date note; Jackson approved.
- 2026-11-06: Accuracy scorecard measures the app as it runs (lab arm match on, benchmark pitcher left out): layback
  error 57/26/56° -> 5.6/9.7/40° (it was the measurement), throwing arm 14.9 -> 12.7 cm.
- 2026-11-06: Foot strike marked where the front foot stops sliding: 54 -> 34 ms from motion capture's foot contact.
- 2026-11-06: Shoulders smoothed less: trunk turn at release 14.8 -> 11.4° off, separation at release 9.0 -> 6.9°.
- 2026-11-06: Accuracy scorecard `tools/test/bench.mjs` (12 pitches x 5 angles vs motion capture: joints, arm, angles at
  foot strike / max layback / release, event timing) with a saved baseline; runs on GitHub on every push.
- 2026-11-06: Coaching report checked against motion capture (`tools/test/reportcheck.mjs`, 12 pitches x 5 angles):
  front knee and arm at landing now read when the front foot is planted (false "knee collapse" warnings 20 -> 9 of 60;
  front-knee description right 30 -> 37 of 60); "arm ready at landing" is only graded when the arm reading is steady
  (wrong arm-health advice 35 -> 16 of 60, shown as a rough guide on the other 19). 174 -> 139 wrong statements.
- 2026-11-06: PDF angle table rounds the same way as the screen (64 of 3072 numbers, all negative half-degrees such as
  Maher's trunk tilt at foot strike, were 1° off).
- 2026-11-05: Accuracy benchmark data added (tools/test/bench).
- 2026-11-05: Slow-motion check: all 60 benchmark views read right at 1×, 2×, 4× and 8× (`tools/test/slowmo.mjs`).
  Clips that start after peak leg lift no longer pass a "leg lift" from the way down: wrong readings at 1/3 s before
  foot strike dropped from 29 to 18 views, and a speed Jackson picks by hand is kept for those clips.
- 2026-11-05: GitHub Actions run the regression (with lefty copies) and the slow-motion check on every push
  (`.github/workflows/tests.yml`).
- 2026-11-05: Learned 3D depth now follows the tracker's left/right fixes correctly (it was trading a shoulder's depth
  with an elbow's on those frames). Changes the arm on Staumont (incl. his release frame) and Hackimer; Maher unchanged.
- 2026-11-05: Left-handed guard: every test clip is also run as a mirror-image lefty and must read left-handed with the
  same event times and the same joint angles (within 3°).
- 2026-11-05: CLAUDE.md project guide and tools/test (regression + headless clip runs).
- 2026-10-30: Net cleaning for clips filmed through a net; Maher no longer misread as 2x slow motion.
