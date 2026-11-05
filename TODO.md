# Feole Pitching to-do list

The daily work session picks today's plan from here. Jackson adds items any time ("add X to the list").
Top of each section = most important. Move items to Done with the date and commit when finished.

## Waiting on Jackson
- Ultra mode (GVHMR cloud 3D body model): needs Jackson's SMPL-X account (smpl-x.is.tue.mpg.de) before it can be finished.
- Reference clips: Jackson to send his own pitchers' clips (any angle) so they can be added to the regression tests.

## To do
- Maher clip: follow-through gets less steady after the camera zooms in after release. Make the tracker follow the zoom (re-find the pitcher's box when the picture scale jumps).
- Net cleaning: test on more net/fence clips (chain-link, batting cage, diagonal nets) and confirm crowd/fence clips keep the net check off (Sale, Ohtani, Flaherty, McKenzie, Joyce).
- Regression tests: add fixtures for a crowd-background clip and a left-handed pitcher so the net check and hand detection are guarded too.
- Speed: Max accuracy takes several minutes; look for safe speed-ups (skip net cleaning outside the pitcher's box, fewer arm-zoom passes on easy clips) without losing accuracy.

## Ideas (ask Jackson before starting)
- Side-by-side comparison of two pitches (same pitcher, different days).
- Any change to how the app looks.

## Done
- 2026-11-05: CLAUDE.md project guide and tools/test (regression + headless clip runs).
- 2026-10-30: Net cleaning for clips filmed through a net; Maher no longer misread as 2x slow motion.
