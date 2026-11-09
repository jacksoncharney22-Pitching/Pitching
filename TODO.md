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

### Notes carried over from 2026-11-06 (elbow and trunk)
- Elbow, measured: both the video-only arm (`_tmplAll:0`, -7.7°) and the lab-only arm (`_tmplAll:1`, -7.6°) share the bias. Not the 2D,
  not bone lengths (+-5%: <1°), not smoothing of the 2D, not a skewed camera axis. Less lab arm on the upper arm (`_tmplAll` 0.5 -> 0.3):
  elbow FS 9.5 -> 8.7° but layback FS 5.7 -> 6.0°: a trade, not shipped.
- Trunk: after release from behind_3b the shoulder line's depth sign can't flip (tracker reads shoulders ~11% narrow there); a
  second-order track and a faster Viterbi step did not help.
- Layback at release is mostly unfixable from one camera (elbow nearly straight, forearm spin ambiguous).

## TOP PRIORITY: the pitching-aware rebuild (Jackson's decision, 2026-11-09)

Jackson wants the glitches gone for good: limbs jumping/shaking, body flips/twists, the throwing arm not following
the real motion, wrong timing/numbers. Decision: **fit the whole delivery to real motion-capture pitches** instead of
building the body frame by frame and patching it. The output is always a believable pitching motion; the video
decides how this pitcher differs. Runs in the browser (free, private, no accounts). Feole is free/personal, so the
non-commercial OpenBiomechanics data is fine. (The cloud/SMPL-X route was dropped; Ultra stays parked.)

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

## Waiting on Jackson
- Ultra mode (GVHMR cloud): parked by Jackson's choice (2026-11-09); no SMPL-X account needed.
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
- Measured 2026-11-09 (`node tools/test/sequence.mjs`, 60 views): pelvis peak speed timing 23 ms off, trunk 28 ms; peak speeds 91 / 129 °/s off; pelvis-before-trunk order right on 49 of 60; the pelvis-to-trunk gap averages right (41 ms vs 39) but is 34 ms off per pitch, about the size of the gap itself. So: show peak speeds and order as a rough guide only, don't show the gap in ms per pitch until it's better.
- Kinematic sequence: pelvis, trunk, arm peak rotation speeds and their timing order (pelvis → trunk → arm),
  checked against the benchmark truth.
- Stride: stride length (% of height), stride direction (open/closed), front-foot angle at foot strike.
- Arm slot at release (degrees) and release height/extension, checked against the benchmark truth.
- Hip-shoulder separation: peak value and when it happens relative to foot strike.
- Add the new measurements to the report and CSV export (wording reviewed by Jackson before it goes live if it
  changes the look of the report).

## Thursday: testing and validation
- Add `perview.mjs` to the GitHub checks (compare with the previous commit, fail on many views >5° worse).
- Video export check (see Friday).
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
- PDF: the angle table has no rotation speeds; the screen does.
- Video export: check the skeleton/overlay MP4 frames line up with the screen (frame count, events) with a test tool.
- Look-and-feel changes go to Jackson as screenshots for approval first; push only after he says yes.

## Ideas (free rein from Jackson, 2026-11-09: take these on when the day's project is done or blocked)
- Graded coaching report: Jackson said on 2026-11-06 he does NOT want it back. report.js and tools/test/reportcheck.mjs
  stay in the repo unused; don't spend time on them.
- Any change to how the app looks.

## Done
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
