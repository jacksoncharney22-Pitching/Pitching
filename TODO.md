# Feole Pitching to-do list

The daily work session picks its work from here. Jackson adds items any time ("add X to the list").
Each weekday has a theme. Pick **one big project** from today's theme (a few hours of real work: measure, build,
test, ship), then quick items if time is left. Top of each list = most important. Move finished items to Done
with the date. When a theme has fewer than 3 items left, add new ones that fit it (and say so in the summary).

Measure before and after every change. The accuracy benchmark (`tools/test/bench`, 10 real pitches with
motion-capture truth, 5 camera angles each) is the scorecard for anything that claims to be "more accurate".

## Today (2026-11-06, Friday)
Sessions run at 8:15, 9:40, 11:40, 13:40 and 15:40 ET on weekdays; each one picks up here and leaves this section
up to date for the next.
- Done: coaching report checked against motion capture (174 -> 139 wrong statements); PDF rounds like the screen.
- Big project for the rest of today: the accuracy scorecard (Monday's top item, the base for every later
  "more accurate" claim). Steps:
  1. `tools/test/bench.mjs`: for every benchmark view run `analyse()`, report per camera angle the joint position
     error (cm, hip-centred, 12 main joints), angle errors at foot strike / max layback / release (elbow, shoulder
     abduction, layback, pelvis and trunk rotation, hip-shoulder separation, front knee, forward and side trunk
     tilt) and event timing error (ms). Reuse the truth handling from `tools/test/reportcheck.mjs` (throwing hand from
     the stride foot; the one lefty is stored mirrored as a righty).
  2. Save the numbers as `tools/test/bench_baseline.json` with a `--update` flag, and print a before/after diff.
  3. Add it to `.github/workflows/tests.yml` as a report (fail only if something gets clearly worse).
- Follow-on: saved history (re-open an old analysis after an app update gives the same results); the PDF `*` for
  blurred throwing-arm values like the screen.
- Scorecard steps 1-3 DONE (`node tools/test/bench.mjs`; baseline saved; runs on GitHub on every push).
- 9:40 session: the scorecard was NOT measuring the app as it runs: it skipped the lab-throw arm match (armlib.json,
  which app.js always loads). Fixed (each benchmark pitcher's own throws left out of the library; `--nolib` for the
  old way); regress.mjs and reportcheck.mjs use it too. Real numbers: layback 5.6° off at foot strike, 9.7° at max
  layback, 40° at release; throwing elbow 10/13/9°; throwing arm 12.7 cm; release timing 6 ms. So the "57° layback"
  was a measuring mistake, not an app bug.
  Then shipped: (1) foot strike where the front ankle stops sliding (< 0.3 m/s, never later than 0.1 s before arm
  cocked): benchmark foot-strike timing 54 -> 34 ms (avg -35 -> -10 ms); Maher max 1.567 -> 1.583 s; Staumont
  1.20 -> 1.30 s (re-recorded: ankle still 1.6 cm up and sliding ~1 m/s at 1.20, and 1.20 gave a 0.2 s foot strike to
  arm cocked, longer than 95% of lab throws; check on his video when there's a chance; his release also moved 1.433 ->
  1.40 s, the same frame as arm cocked at 30 fps). (2) shoulders smoothed less:
  trunk turn error 12.7/9.9/14.8° -> 11.5/8.2/11.4° (foot strike / max layback / release), separation 12.1/5.4/9.0 ->
  11.5/5.4/6.9.
  Layback at release (40°) is mostly unfixable from one camera: the elbow is nearly straight there (~25°), so the
  forearm's turn about the upper arm swings 50°+ with a 1-2° wobble; 1 frame before/after release it's 14°/22° off.
  Bridging it from the frames either side only got 40 -> 35° and made the next frame worse: dropped.
- 11:40 session: trunk rotation. Found the cause: the clamp almost never hits (0-15% of frames); the real problem is
  that the shoulder joints are NOT a fixed distance apart. In the lab the joint-to-joint width drops from ~9% of
  height to ~7.7% at foot strike (shoulder blades pinching back) and comes back by max layback, so a square-on
  shoulder line read against the full width looked turned 25-35° toward/away from the camera. Shipped: the depth of
  the shoulder line is read against a width that narrows toward foot strike (lockArms `shW`; `shoulderPinch:false`
  turns it off). Trunk turn 11.5/8.2/11.4 -> 10.6/7.9/11.4° off (foot strike / max layback / release), separation
  11.5/5.4/6.9 -> 9.0/4.8/6.3°, behind_3b trunk 17.9 -> 13.4°; throwing arm +0.3 cm on behind and side_back
  (-0.5 on behind_3b, overall 12.6 unchanged). Report check 151 -> 149 wrong ("shoulders closed at landing" typical
  error 12.9 -> 8.5°). Maher/Staumont trunk and separation move <= 2°. Slow motion 240/240, regress all ok.
  Tried and dropped: reading the width from the clip itself (98th percentile of on-screen width: worse everywhere);
  a narrower shoulder bone overall (_shR 0.08: helped trunk a little but moved the arm more).
- Next session: what's left on trunk rotation is the follow-through side of release from behind_3b: just after
  release the true shoulder line passes through square-on to the camera (depth sign flips) but the app's stays on
  one side (3228_1_behind_3b frames 69-73: truth depth angle 4, -6, -17°, app 26, 17, 14° -> trunk 24-34° behind).
  Idea: a second-order (angular velocity) track of the shoulder line's angle out of the picture so it can pass through
  0 instead of bouncing. Scratch tools to measure it: per-frame trunk error + depth angle per stage (`_snap`).
  Tried (11:40 session, not shipped): a second-order track of that angle (dynamic programming over angle x previous
  angle): foot strike better on 3228 behind_3b but release unchanged, and side_open got much worse (all trunk
  12.2/10.5/12.4°). The measurement itself is the limit there: right after release the tracker's shoulders read ~11%
  narrower than they are, so the line looks 25-30° out of the picture on either side. A faster Viterbi step for the
  shoulders (5-8 m/s) changed nothing.
- Also 11:40: shipped an import map so pipeline.js and every module load with the version stamp (bump all stamps
  with one sed, see CLAUDE.md). Looked at the throwing elbow: it reads 7° too straight at foot strike and 9° at max
  layback on average. Not the bone lengths (upper arm/forearm +-7%: no change). It comes from the lab-throw match:
  the matched lab arm itself is 7.5° straighter than truth at foot strike, because the 12 benchmark pitchers bend the
  elbow ~4° more at landing than the 403-throw library average (library 99.5°, benchmark 103.5°) and the match pulls
  toward typical. Leaning less on the lab arm where the video shows the arm (`_tmplAll` 0.5 -> 0.3) helps the elbow
  at foot strike 9.7 -> 9.1° but costs layback at foot strike 5.7 -> 6.3°: not shipped.
- 13:40 session, shipped: (1) PDF marks blurred throwing-arm values at release with * like the screen. New check
  `tools/test/export_check.py` (opens a fixture through Recent, no tracking): PDF and CSV now match the screen on all
  4 test clips. It found two saved-history bugs, both fixed: re-opening lost events moved by hand, and re-opening
  straight away on a slow connection rebuilt the arm without the lab-throw match (Maher elbow at foot strike 114°
  instead of 96°). Also no more "-0°". (2) Throwing arm follows, frame by frame, the lab throws that fit the video at
  that moment (best 30, weighted per frame; `armLocal:false` = old average of 6): elbow at max layback 12.7 -> 9.7°,
  release 8.8 -> 7.9°; layback at max layback 9.7 -> 7.6°, at release 39.8 -> 24.7°; shoulder abduction 7.1/6.8 ->
  5.1/5.5°; throwing arm 12.6 -> 11.9 cm; no extra wobble. Elbow at foot strike unchanged (9.7 -> 9.8).
  Hackimer (16x slow, no truth) changed most: elbow ~115° at foot strike and ~100° at arm cocked (was 82° -> 29°
  between them, which looked wrong), 57° on the release frame (was 19°; 15° one frame later). Check on his video.
- Also 13:40: the long arm match now starts 0.7 s before release (was 0.55): elbow at foot strike 9.8 -> 9.5°, layback
  at release 24.7 -> 23.5° (only "behind" views change). Tried, no gain: per-frame weight sharpness 0.01/0.04 (kept
  0.02), smoothing 0.01-0.08 s (kept 0.02), `_lPre` 0.85/1.0, `_lPost` 0.3, `_tmplAll` 0.3 (elbow FS 9.1 but layback FS
  worse).
- Next session (15:40): elbow at foot strike is still 9.5° off (worst behind_3b 11.8): look per view at where the
  matched arm and the video disagree at foot strike (the arm is often hidden behind the body there: `unseen`
  frames get weight 0.05 in the match). Then the end-of-day summary for Jackson (live today: foot strike timing,
  trunk turn, arm match per frame, PDF *, saved history fixes; numbers in Done).
- 15:40 session (measuring only, nothing shipped): the throwing elbow reads ~7° too STRAIGHT on average from
  late stride through max layback (signed error -7.4° at foot strike, -7.8° mid-way, -6.0° at max layback, -2.6° at
  release; it builds up from 0 about 7 frames before foot strike). Both halves share it: the video-only arm
  (`_tmplAll:0`) is -7.7°, the lab-arm-only (`_tmplAll:1`) -7.6°. Not the 2D: the benchmark's 2D elbow angle matches
  the truth within ~1° (side views 0.0-0.4°), smoothing of the 2D moves joints <0.1 px; not the bone lengths
  (+-5%: <1° change); not a skewed camera axis. So it happens inside the 3D arm lock (lockArms) and is still
  unexplained. Leaning less on the lab arm for the UPPER arm only (`_tmplAll` 0.5 -> 0.3 on the upper arm, forearm
  kept) gives elbow at foot strike 9.5 -> 8.7° but layback at foot strike 5.7 -> 6.0° (arm 11.9 -> 11.8 cm): a trade,
  not shipped. Worst single views: 3228 behind_3b (-44°), side_back/side_open (-21/-25°, 50° wobble within +-2 frames).
- Next session (Monday, accuracy): find where lockArms loses the elbow bend. Plan: add a debug hook that records the
  final upper-arm and forearm vectors per frame (after the lab blend and smoothing), then rebuild the elbow from
  each stage (in-picture + depth only; + lab blend; + smoothing) on the 60 views at foot strike to see which step
  straightens it. Scratch tools from this session (signed elbow error per frame around foot strike, per-stage error
  via `_snap`) are quick to rewrite: `OPTS='{...}' node tools/test/bench.mjs` covers the scoring.
- (old plan) Next session (13:40): Friday theme. Do the PDF "*" for blurred throwing-arm values (like the screen; pdf.js), then
  open a real PDF and CSV in headless Chromium and compare with the screen numbers. For the elbow: try weighting the
  lab matches by how well each one's elbow bend fits the video at foot strike (instead of the plain average of 6).


## Waiting on Jackson
- Ultra mode (GVHMR cloud 3D body model): needs Jackson's SMPL-X account (smpl-x.is.tue.mpg.de) before it can be finished.
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
- Max accuracy takes several minutes: profile where the time goes (tracker, arm-zoom, net cleaning, learned 3D)
  and speed up the biggest part without changing the scorecard or regression results.
- Long and large videos (phone 4K, 60 s clips): make sure they don't run out of memory or freeze the tab; show
  honest progress.
- Phones and tablets: check the app runs on mobile Safari/Chrome (or fails with a clear message), and that
  Fast mode is usable there.
- Failure messages: every way an analysis can fail (no pitcher found, video won't play, tracker can't load)
  should tell the user what to do next in plain words.

## Wednesday: pitching measurements
- Kinematic sequence: pelvis, trunk, arm peak rotation speeds and their timing order (pelvis → trunk → arm),
  checked against the benchmark truth.
- Stride: stride length (% of height), stride direction (open/closed), front-foot angle at foot strike.
- Arm slot at release (degrees) and release height/extension, checked against the benchmark truth.
- Hip-shoulder separation: peak value and when it happens relative to foot strike.
- Add the new measurements to the report and CSV export (wording reviewed by Jackson before it goes live if it
  changes the look of the report).

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

## Friday: coaching report and finish
- Saved history across app updates: a pitch saved before an update re-opens with the new skeleton maths (by design);
  show a small note when its numbers changed since it was saved? (Look change: screenshots to Jackson first.)
- Run `tools/test/export_check.py` on GitHub Actions too (needs Playwright + a local three.js there).
- PDF: the angle table has no layback row and no speeds; the screen does. Offer Jackson a screenshot of a PDF with them.
- Video export: check the skeleton/overlay MP4 frames line up with the screen (frame count, events) with a test tool.
- Look-and-feel changes go to Jackson as screenshots for approval first; push only after he says yes.

## Ideas (ask Jackson before starting)
- Graded coaching report: Jackson said on 2026-11-06 he does NOT want it back. report.js and tools/test/reportcheck.mjs
  stay in the repo unused; don't spend time on them.
- Side-by-side comparison of two pitches (same pitcher, different days).
- Any change to how the app looks.

## Done
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
