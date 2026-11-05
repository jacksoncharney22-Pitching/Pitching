# Accuracy benchmark (measured truth)

10 real pitches from the Driveline OpenBiomechanics Project motion-capture data (pitch ids 1612_1 … 3044_1),
each seen from 5 virtual camera angles (`behind`, `behind_3b`, `front_3b`, `side_back`, `side_open`).

- `<pitch>_<view>.raw.json.gz`: what the app's tracker produced from that view (same format as `window.__lastRaw`:
  `{fps, videoFps, width, height, start, frames, l3}`), ready for `analyse()` from `pipeline.js`.
- `<pitch>_<view>.truth.json.gz`: the motion-capture truth for the same frames:
  `P[frame][33][xyz]` in metres (MediaPipe landmark order), `events` (`fs` foot strike, `mer` max external rotation,
  `br` ball release, as frame numbers), `height` (m), `hand`, `speed` (mph), `view`, `sp` (pitch id).

Use it to measure accuracy against real measured motion (joint position error, angle error at foot strike /
max layback / release, event timing error) rather than by eye.

Source: OpenBiomechanics Project (Driveline Baseball), https://www.openbiomechanics.org, licensed CC BY-NC-SA 4.0
(non-commercial, attribution, share-alike). Used here for testing only.
