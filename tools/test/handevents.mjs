// Hand-moved events check (no browser). When a coach moves one event in the viewer, the app re-builds the pitch with ALL
// four events as they now stand, so:
//  1. re-building with the app's own events, unchanged, must give the same delivery numbers as the automatic run
//     (until 2026-11-10 it didn't: Maher's separation 21 -> 16, Hackimer's slot -6 -> -11);
//  2. moving foot strike a frame at a time (-4..+3 frames) must change peak separation smoothly, not jump.
//   node tools/test/handevents.mjs        (exit 1 on a failure)
import { readFileSync } from "fs"; import { gunzipSync } from "zlib";
import { dirname, join } from "path"; import { fileURLToPath } from "url";
import { analyse, deliveryMeasures } from "../../pipeline.js";
const here = dirname(fileURLToPath(import.meta.url));
const LIB = JSON.parse(readFileSync(join(here, "../../armlib.json"), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o)), X = process.env.OPTS ? JSON.parse(process.env.OPTS) : {};   // OPTS='{"_fsKeep":false}': the old behaviour (should fail)
const SAME = { armSlot: 1, peakSep: 1, strideM: 0.02, relHeight: 0.02 }, JUMP = 2.5;   // deg / m; JUMP: peak separation per frame of foot strike
let bad = 0;
for (const f of ["maher_fast", "maher_max", "staumont_fast", "hackimer_fast"]) {
  const base = JSON.parse(gunzipSync(readFileSync(join(here, "fixtures", f + ".json.gz"))).toString("utf8"));
  const D0 = analyse(clone(base), { hand: "auto", armLib: LIB, ...X }), P = D0.phases.map(p => p.frame), m0 = deliveryMeasures(D0, null);
  const ev = { legLift: P[1], footStrike: P[2], armCocked: P[3], release: P[4] };
  const run = ph => deliveryMeasures(analyse(clone(base), { hand: D0.throwHand, armLib: LIB, ...X, phases: ph }), null);
  const m1 = run(ev), diffs = Object.keys(SAME).map(k => [k, m1[k] - m0[k]]), off = diffs.filter(([k, d]) => Math.abs(d) > SAME[k]);
  const step = Math.max(1, Math.round(base.fps / 60)), seps = [];
  for (let d = -4; d <= 3; d++) seps.push(run({ ...ev, footStrike: P[2] + d * step, armCocked: Math.max(P[3], P[2] + d * step) }).peakSep);
  const jump = Math.max(...seps.slice(1).map((s, i) => Math.abs(s - seps[i])));
  const ok = !off.length && jump <= JUMP; if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${f.padEnd(14)} same events by hand: ${diffs.map(([k, d]) => `${k} ${d >= 0 ? "+" : ""}${d.toFixed(k.endsWith("M") || k === "relHeight" ? 3 : 1)}`).join(", ")}` +
    ` | foot strike -4..+3 frames: separation ${seps.map(s => s.toFixed(1)).join(" ")} (largest step ${jump.toFixed(1)})`);
}
console.log(bad ? `${bad} clip(s) failed` : "all clips: hand-set events give the same numbers, foot strike moves smoothly");
process.exit(bad ? 1 : 0);
