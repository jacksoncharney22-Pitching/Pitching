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
- Pitch finder off the main thread (Web Worker): the page freezes briefly at each finder step on slow GPUs (found 2026-11-10).
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
