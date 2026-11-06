// Fast regression check for the analysis pipeline (no browser, no video): re-analyses saved tracker output
// (window.__lastRaw, saved by clip_run.py as raw_<quality>.json) and compares the event times, speed reading and
// throwing hand with baseline.json. Times are in real seconds (after any slow-motion correction).
//   node tools/test/regress.mjs                            compare every file in tools/test/fixtures (.json or .json.gz)
//   node tools/test/regress.mjs <raw.json> [...]           compare these files against the baseline
//   node tools/test/regress.mjs --update <raw.json> [...]  record the current results as the new baseline
// Every clip is also run mirrored (as a left-hander filmed from the other side): it must read as the other hand with
// the same event times and speed. This guards left-handed pitchers without needing lefty fixtures. --no-mirror skips it.
// Baselines are keyed by file name, so give each saved raw file a unique name (e.g. maher_max.json).
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { gunzipSync } from "zlib";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { analyse, detectSlowFactor } from "../../pipeline.js";
const here = dirname(fileURLToPath(import.meta.url)), BASE = join(here, "baseline.json");
const args = process.argv.slice(2), update = args.includes("--update"), mirror = !args.includes("--no-mirror");
let files = args.filter(a => !a.startsWith("--"));
if (!files.length) files = readdirSync(join(here, "fixtures")).filter(f => /\.json(\.gz)?$/.test(f)).map(f => join(here, "fixtures", f));   // default: every saved fixture
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : {};
const TOL = 0.05;   // seconds an event may move before it counts as changed
let fails = 0;
// mirror image of the tracker output: screen x flipped and every left/right label traded, in the 33-joint tracker
// numbering and in the learned 3D model's 17-joint numbering (raw.l3)
const PAIRS33 = [[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],[23,24],[25,26],[27,28],[29,30],[31,32]];
const PAIRS17 = [[1,4],[2,5],[3,6],[11,14],[12,15],[13,16]];
const swapIn = (A, pairs) => { if (!A) return A; A = A.slice(); for (const [a, b] of pairs) { const x = A[a]; A[a] = A[b]; A[b] = x } return A };
function mirrorRaw(raw) {
  return { ...raw,
    frames: raw.frames.map(f => f && { ...f,
      img: swapIn(f.img.map(p => [1 - p[0], ...p.slice(1)]), PAIRS33),
      world: swapIn(f.world.map(p => [-p[0], ...p.slice(1)]), PAIRS33),
      spread: f.spread ? swapIn(f.spread, PAIRS33) : f.spread }),
    l3: raw.l3 && raw.l3.map(L => L && swapIn(L.map(p => [-p[0], ...p.slice(1)]), PAIRS17)) };
}
// the app matches the throwing arm to lab throws (armlib.json): run the saved clips the same way
const LIB = process.argv.includes("--nolib") ? null : JSON.parse(readFileSync(new URL("../../armlib.json", import.meta.url), "utf8"));
const jobs = [];
for (const f of files) {
  const key = basename(f).replace(/\.gz$/, ""), buf = readFileSync(f), raw = JSON.parse((f.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8"));
  jobs.push({ key, raw, base: key });
  if (mirror && !update) jobs.push({ key: key + " (mirrored, as a lefty)", raw: mirrorRaw(raw), base: key, flip: true });
}
const ANGLES = ["throwElbow", "throwAbd", "throwER", "leadKnee", "separation", "trunkFwd", "trunkLat"], seen = {};
for (const { key, raw, base: bkey, flip } of jobs) {
  let res, angles;
  try {
    // same as the app on "auto" speed: the saved fps already includes the old speed reading, so start from the video's own fps
    const vf = raw.videoFps || raw.fps, slow = detectSlowFactor({ ...raw, fps: vf, videoFps: vf });
    raw.fps = vf * slow.factor;
    const d = analyse(raw, { hand: "auto", ...(LIB ? { armLib: { ...LIB, _dec: undefined } } : {}) }), fps = raw.fps;
    res = { slow: slow.factor, hand: d.throwHand, frames: raw.frames.length, events: Object.fromEntries(d.phases.map(p => [p.name, +(p.frame / fps).toFixed(3)])) };
    // joint angles at each event, kept in memory only: the mirrored run must match them (a lefty is measured like a righty)
    angles = Object.fromEntries(d.phases.map(p => [p.name, Object.fromEntries(ANGLES.map(k => [k, d.metrics[k][p.frame]]))]));
  } catch (e) { console.log(`FAIL ${key}: crashed: ${e.message}`); fails++; continue }
  if (update) { base[key] = res; console.log(`saved ${key}`, JSON.stringify(res)); continue }
  let b = base[bkey];
  if (b && flip) b = { ...b, hand: b.hand === "R" ? "L" : "R" };   // a mirrored right-hander is a left-hander
  if (!b) { console.log(`NEW  ${key} (no baseline yet; run with --update to record)`, JSON.stringify(res)); continue }
  const diffs = [];
  if (!flip) seen[bkey] = angles;
  else if (seen[bkey]) for (const [ev, A] of Object.entries(seen[bkey])) for (const k of ANGLES) {
    const a = A[k], m = angles[ev] && angles[ev][k]; if (!Number.isFinite(a)) continue;
    if (!Number.isFinite(m) || Math.abs(m - a) > 3) diffs.push(`${k} at ${ev} ${a.toFixed(0)}° vs lefty ${!Number.isFinite(m) ? "missing" : m.toFixed(0) + "°"}`);
  }
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
