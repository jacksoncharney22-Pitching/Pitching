// Fast regression check for the analysis pipeline (no browser, no video): re-analyses saved tracker output
// (window.__lastRaw, saved by clip_run.py as raw_<quality>.json) and compares the event times, speed reading and
// throwing hand with baseline.json. Times are in real seconds (after any slow-motion correction).
//   node tools/test/regress.mjs                            compare every file in tools/test/fixtures (.json or .json.gz)
//   node tools/test/regress.mjs <raw.json> [...]           compare these files against the baseline
//   node tools/test/regress.mjs --update <raw.json> [...]  record the current results as the new baseline
// Baselines are keyed by file name, so give each saved raw file a unique name (e.g. maher_max.json).
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { gunzipSync } from "zlib";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { analyse, detectSlowFactor } from "../../pipeline.js";
const here = dirname(fileURLToPath(import.meta.url)), BASE = join(here, "baseline.json");
const args = process.argv.slice(2), update = args.includes("--update");
let files = args.filter(a => a !== "--update");
if (!files.length) files = readdirSync(join(here, "fixtures")).filter(f => /\.json(\.gz)?$/.test(f)).map(f => join(here, "fixtures", f));   // default: every saved fixture
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : {};
const TOL = 0.05;   // seconds an event may move before it counts as changed
let fails = 0;
for (const f of files) {
  const key = basename(f).replace(/\.gz$/, ""), buf = readFileSync(f), raw = JSON.parse((f.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8"));
  let res;
  try {
    // same as the app on "auto" speed: the saved fps already includes the old speed reading, so start from the video's own fps
    const vf = raw.videoFps || raw.fps, slow = detectSlowFactor({ ...raw, fps: vf, videoFps: vf });
    raw.fps = vf * slow.factor;
    const d = analyse(raw, { hand: "auto" }), fps = raw.fps;
    res = { slow: slow.factor, hand: d.throwHand, frames: raw.frames.length, events: Object.fromEntries(d.phases.map(p => [p.name, +(p.frame / fps).toFixed(3)])) };
  } catch (e) { console.log(`FAIL ${key}: crashed: ${e.message}`); fails++; continue }
  if (update) { base[key] = res; console.log(`saved ${key}`, JSON.stringify(res)); continue }
  const b = base[key];
  if (!b) { console.log(`NEW  ${key} (no baseline yet; run with --update to record)`, JSON.stringify(res)); continue }
  const diffs = [];
  if (b.slow !== res.slow) diffs.push(`speed ${b.slow}x -> ${res.slow}x`);
  if (b.hand !== res.hand) diffs.push(`hand ${b.hand} -> ${res.hand}`);
  for (const [n, t] of Object.entries(b.events)) {
    const now = res.events[n];
    if (now == null) diffs.push(`${n} missing`); else if (Math.abs(now - t) > TOL) diffs.push(`${n} ${t}s -> ${now}s`);
  }
  if (diffs.length) { fails++; console.log(`FAIL ${key}: ${diffs.join("; ")}`) } else console.log(`ok   ${key}`);
}
if (update) writeFileSync(BASE, JSON.stringify(base, null, 1) + "\n");
process.exit(fails ? 1 : 0);
