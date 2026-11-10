// Speed work must not change any result. This runs the analysis (speed reading + skeleton, as the app does) on every saved
// fixture and every 3rd benchmark view (24 clips) and either saves the full output or checks it is bit-for-bit the same.
//   node tools/test/samecheck.mjs --save /tmp/before.json     (on the old code, e.g. a `git worktree` of the last commit)
//   node tools/test/samecheck.mjs /tmp/before.json            (on the new code: lists any clip whose pose, events,
//                                                              metrics or speed reading changed, and the time taken)
// Exits 1 on any difference. Prints the total analysis time, so it doubles as the speed measurement.
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { gunzipSync } from "zlib";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { analyse, detectSlowFactor } from "../../pipeline.js";
const here = dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2), save = args.includes("--save"), file = args.find(a => !a.startsWith("--"));
if (!file) { console.log("usage: samecheck.mjs [--save] <results.json>"); process.exit(2) }
const LIB = JSON.parse(readFileSync(join(here, "../../armlib.json"), "utf8"));
const ld = f => JSON.parse(gunzipSync(readFileSync(f)).toString());
const clips = [...readdirSync(join(here, "fixtures")).filter(f => f.endsWith(".json.gz")).map(f => join(here, "fixtures", f)),
  ...readdirSync(join(here, "bench")).filter(f => f.endsWith(".raw.json.gz")).filter((_, i) => i % 3 === 0).map(f => join(here, "bench", f))];
const out = {}; let total = 0;
for (const f of clips) {
  const raw = ld(f), t0 = performance.now(), vf = raw.videoFps || raw.fps, slow = detectSlowFactor({ ...raw, fps: vf, videoFps: vf });
  raw.fps = vf * slow.factor;
  const d = analyse(raw, { hand: "auto", armLib: { ...LIB, _dec: undefined } }); total += performance.now() - t0;
  out[f.split("/").pop()] = JSON.stringify({ slow, phases: d.phases, pose: d.pose, metrics: d.metrics, hand: d.throwHand });
}
console.log(`${clips.length} clips analysed in ${(total / 1000).toFixed(2)} s`);
if (save) { writeFileSync(file, JSON.stringify(out)); console.log("saved", file); process.exit(0) }
const before = JSON.parse(readFileSync(file, "utf8")); let bad = 0;
for (const k in out) if (before[k] !== out[k]) { bad++; console.log("CHANGED", k) }
console.log(bad ? `${bad} clips changed` : "all results identical"); process.exit(bad ? 1 : 0);
