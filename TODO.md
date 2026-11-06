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
- Scorecard steps 1-3 DONE (`node tools/test/bench.mjs`; baseline saved; runs on GitHub on every push). Starting
  numbers: joints 10.5 cm from motion capture, throwing arm 14.9 cm, angles 14.4° average; foot strike 34 ms early on
  average; worst readings: layback (57° off at foot strike and release), throwing elbow (35° off at release), trunk
  rotation from behind-3B (22°).
- Next session: use the scorecard on the worst reading. Layback first (the 9:40 session, unless already started):
  find why it is ~57° off at foot strike and release (wrap-round past 180°? the "modelled" layback shape?), fix, show
  the scorecard before/after, and check Maher's 219° at foot strike drops below 180.

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
- Layback reads over 180° at foot strike on Maher (219° in fast and max). Real layback there is well under 180°, so
  the angle is probably wrapping round; check against the benchmark truth and fix the reading.

- Foot strike is marked about 3 frames (50 ms) before motion capture's foot contact on the benchmark (median -3 frames
  at 60 fps; the foot is still sliding). The knee angle shown at foot strike is ~10° straighter than at real contact.
  The point where the lead heel stops sliding (under 0.3 m/s) lands within 1 frame of contact on 34 of 60 views
  (median 0): consider marking foot strike there, or showing both. Changes event times on every clip (Maher's foot
  strike, regression baseline), so check the video strip first.
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
- PDF and CSV exports, rest: the PDF doesn't mark blurred throwing-arm values with * like the screen does; open a real
  PDF and CSV in the browser and compare with the screen.
- Saved history: re-opening an old analysis should give the same results after app updates.
- Look-and-feel changes go to Jackson as screenshots for approval first; push only after he says yes.

## Ideas (ask Jackson before starting)
- Graded coaching report: Jackson said on 2026-11-06 he does NOT want it back. report.js and tools/test/reportcheck.mjs
  stay in the repo unused; don't spend time on them.
- Side-by-side comparison of two pitches (same pitcher, different days).
- Any change to how the app looks.

## Done
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
