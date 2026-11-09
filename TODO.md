# Feole Pitching to-do list

The daily work session picks its work from here. Jackson adds items any time ("add X to the list").
Each day has a theme (Sat = accuracy, Sun = testing). Pick **one big project** from today's theme (a few hours of real work: measure, build,
test, ship), then quick items if time is left. Top of each list = most important. Move finished items to Done
with the date. When a theme has fewer than 3 items left, add new ones that fit it (and say so in the summary).

Measure before and after every change. The accuracy benchmark (`tools/test/bench`, 10 real pitches with
motion-capture truth, 5 camera angles each) is the scorecard for anything that claims to be "more accurate".

## Today (2026-11-09, Monday: accuracy)
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
- Next session: pick from follow-on (c)/(d)/(e) above, or another Idea.

### Notes carried over from 2026-11-06 (elbow and trunk)
- Elbow, measured: both the video-only arm (`_tmplAll:0`, -7.7°) and the lab-only arm (`_tmplAll:1`, -7.6°) share the bias. Not the 2D,
  not bone lengths (+-5%: <1°), not smoothing of the 2D, not a skewed camera axis. Less lab arm on the upper arm (`_tmplAll` 0.5 -> 0.3):
  elbow FS 9.5 -> 8.7° but layback FS 5.7 -> 6.0°: a trade, not shipped.
- Trunk: after release from behind_3b the shoulder line's depth sign can't flip (tracker reads shoulders ~11% narrow there); a
  second-order track and a faster Viterbi step did not help.
- Layback at release is mostly unfixable from one camera (elbow nearly straight, forearm spin ambiguous).

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

## Ideas (free rein from Jackson, 2026-11-09: take these on when the day's project is done or blocked)
- Graded coaching report: Jackson said on 2026-11-06 he does NOT want it back. report.js and tools/test/reportcheck.mjs
  stay in the repo unused; don't spend time on them.
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
