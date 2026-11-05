# Feole Pitching to-do list

The daily work session picks its work from here. Jackson adds items any time ("add X to the list").
Each weekday has a theme. Pick **one big project** from today's theme (a few hours of real work: measure, build,
test, ship), then quick items if time is left. Top of each list = most important. Move finished items to Done
with the date. When a theme has fewer than 3 items left, add new ones that fit it (and say so in the summary).

Measure before and after every change. The accuracy benchmark (`tools/test/bench`, 10 real pitches with
motion-capture truth, 5 camera angles each) is the scorecard for anything that claims to be "more accurate".

## Waiting on Jackson
- Ultra mode (GVHMR cloud 3D body model): needs Jackson's SMPL-X account (smpl-x.is.tue.mpg.de) before it can be finished.
- Reference clips: Jackson to send his own pitchers' clips (any angle) so they can be added to the regression tests.
- Clips needed for the items marked "(Needs clip…)": the Cooper Maher video, a few net / batting-cage / chain-link
  clips, one crowd-background clip (Sale, Ohtani, Flaherty, McKenzie or Joyce) and, ideally, a real left-hander. The
  cloud sessions have no videos and can't download them: drop them in the chat or the project.

## Monday: accuracy of the skeleton
- Accuracy scorecard: build `tools/test/bench.mjs` that runs `analyse()` on every benchmark view and reports, per
  camera angle: joint position error (cm), angle error at foot strike / max layback / release (elbow, shoulder
  abduction, layback, pelvis and trunk rotation, hip-shoulder separation, front knee), and event timing error (ms).
  Save the current numbers as the baseline so every later change can show a before/after. Do this first.
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
- Slow-motion reading: test the speed detector on every benchmark pitch at 1×, 2×, 4×, 8× (by resampling) and fix
  any misreads.
- Run the scorecard and regression in GitHub Actions on every push so a bad change is caught before Jackson sees it.

## Friday: coaching report and finish
- Report quality: check every statement the coaching report makes against the measurements it's based on;
  remove or fix anything that can be wrong for some pitchers.
- PDF and CSV exports: open them, check every number matches the screen.
- Saved history: re-opening an old analysis should give the same results after app updates.
- Look-and-feel changes go to Jackson as screenshots for approval first; push only after he says yes.

## Ideas (ask Jackson before starting)
- Side-by-side comparison of two pitches (same pitcher, different days).
- Any change to how the app looks.

## Done
- 2026-11-05: Accuracy benchmark data added (tools/test/bench).
- 2026-11-05: Learned 3D depth now follows the tracker's left/right fixes correctly (it was trading a shoulder's depth
  with an elbow's on those frames). Changes the arm on Staumont (incl. his release frame) and Hackimer; Maher unchanged.
- 2026-11-05: Left-handed guard: every test clip is also run as a mirror-image lefty and must read left-handed with the
  same event times and the same joint angles (within 3°).
- 2026-11-05: CLAUDE.md project guide and tools/test (regression + headless clip runs).
- 2026-10-30: Net cleaning for clips filmed through a net; Maher no longer misread as 2x slow motion.
