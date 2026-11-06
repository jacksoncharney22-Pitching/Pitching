// Accuracy scorecard (no browser, no video): how close the app's skeleton is to motion capture.
// Every benchmark view (tools/test/bench: 12 real pitches x 5 camera angles, tracker output + measured truth) is run
// through analyse() with the pitcher's height entered, and compared with the truth:
//   - joint position error (cm): the 12 main joints (shoulders, elbows, wrists, hips, knees, ankles), measured from
//     the middle of the hips, every frame, and the throwing arm alone from foot strike to release;
//   - angle error (degrees) at foot strike, max layback and release, read on the SAME frames (the truth's), so it is
//     the skeleton's accuracy alone, not the event timing;
//   - event timing error (ms): foot strike, arm cocked (max layback) and release.
// Results are per camera angle, and compared with tools/test/bench_baseline.json.
//   node tools/test/bench.mjs              scorecard + comparison with the saved baseline (exit 1 if clearly worse)
//   node tools/test/bench.mjs --update     save the current numbers as the new baseline
//   node tools/test/bench.mjs --views      also one line per view
//   node tools/test/bench.mjs 1612_1       only that pitch (no baseline comparison)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { gunzipSync } from "zlib";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { analyse } from "../../pipeline.js";
import { truthD } from "./truth.mjs";
const here = dirname(fileURLToPath(import.meta.url)), dir = join(here, "bench"), BASE = join(here, "bench_baseline.json");
const argv = process.argv.slice(2), update = argv.includes("--update"), perView = argv.includes("--views");
const only = argv.find(a => !a.startsWith("--")) || "";
const load = f => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8"));
const mean = a => { const b = a.filter(Number.isFinite); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : null };
const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;

const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const ANGLES = { throwElbow: "throwing elbow", throwAbd: "shoulder abduction", throwER: "layback", leadKnee: "front knee",
  pelvisRot: "pelvis rotation", trunkRot: "trunk rotation", separation: "hip-shoulder sep.", trunkFwd: "forward tilt", trunkLat: "side tilt" };
const ROT = new Set(["pelvisRot", "trunkRot", "separation", "throwER"]);
const EVENTS = { fs: "Foot strike", mer: "Arm cocked", br: "Release" };

const views = readdirSync(dir).filter(f => f.endsWith(".raw.json.gz") && f.startsWith(only)).map(f => f.replace(".raw.json.gz", "")).sort();
const rows = [];
for (const v of views) {
  const raw = load(v + ".raw.json.gz"), tr = load(v + ".truth.json.gz"), TD = truthD(tr);
  const D = analyse({ ...raw, heightIn: tr.height / 0.0254 });
  const T = Math.min(D.pose.length, tr.P.length), fps = D.fps;
  // the app's left-hander output is mirrored back for display; the truth is compared in the same orientation
  const hip = F => [0, 1, 2].map(k => (F[23][k] + F[24][k]) / 2);
  let se = 0, n = 0, ae = 0, an = 0;
  const { fs, br } = tr.events, arm = D.throwHand === "L" ? [11, 13, 15] : [12, 14, 16];
  for (let t = 0; t < T; t++) {
    const A = D.pose[t], B = tr.P[t], ha = hip(A), hb = hip(B);
    for (const j of JOINTS) {
      const e = Math.hypot(...[0, 1, 2].map(k => (A[j][k] - ha[k]) - (B[j][k] - hb[k])));
      se += e; n++;
      if (t >= fs && t <= br && arm.includes(j)) { ae += e; an++ }
    }
  }
  const row = { view: v, angle: v.replace(/^\d+_\d+_/, ""), joint: 100 * se / n, arm: 100 * ae / an, ang: {}, ev: {} };
  for (const [e, name] of Object.entries(EVENTS)) {
    const af = (D.phases.find(p => p.name === name) || {}).frame;
    row.ev[e] = af == null ? null : (af - tr.events[e]) / fps * 1000;
    for (const k of Object.keys(ANGLES)) {
      const a = D.metrics[k][tr.events[e]], b = TD.metrics[k][tr.events[e]];
      if (a == null || b == null) continue;
      (row.ang[k] ??= {})[e] = ROT.has(k) ? wrap(a - b) : a - b;
    }
  }
  rows.push(row);
}

// ---- summarise: per camera angle and overall
const groups = [...new Set(rows.map(r => r.angle)), "all"];
const summary = {};
for (const g of groups) {
  const R = rows.filter(r => g === "all" || r.angle === g), s = { views: R.length, joint: mean(R.map(r => r.joint)), arm: mean(R.map(r => r.arm)), ang: {}, ev: {} };
  for (const k of Object.keys(ANGLES)) for (const e of Object.keys(EVENTS)) { const m = mean(R.map(r => r.ang[k]?.[e]).filter(v => v != null).map(Math.abs)); if (m != null) (s.ang[k] ??= {})[e] = m }
  for (const e of Object.keys(EVENTS)) s.ev[e] = mean(R.map(r => r.ev[e]).filter(v => v != null).map(Math.abs));
  s.angAll = mean(Object.values(s.ang).flatMap(o => Object.values(o)));
  summary[g] = s;
}

const f1 = x => x == null ? "  —" : x.toFixed(1), f0 = x => x == null ? "—" : Math.round(x).toString();
console.log(`Accuracy scorecard: ${rows.length} views (${new Set(rows.map(r => r.view.slice(0, 6))).size} pitches), skeleton vs motion capture, height entered\n`);
console.log("camera angle   joints cm  arm cm  angles °  | foot strike / arm cocked / release timing (ms)");
for (const g of groups) { const s = summary[g]; console.log(`${g.padEnd(13)} ${f1(s.joint).padStart(9)} ${f1(s.arm).padStart(7)} ${f1(s.angAll).padStart(9)}  | ${f0(s.ev.fs)} / ${f0(s.ev.mer)} / ${f0(s.ev.br)}`) }
console.log("\nangle error (°, all views)   at foot strike  max layback  release   | worst camera angle");
for (const [k, name] of Object.entries(ANGLES)) {
  const s = summary.all.ang[k] || {}, per = groups.filter(g => g !== "all").map(g => [g, mean(Object.values(summary[g].ang[k] || {}))]).sort((a, b) => b[1] - a[1])[0];
  console.log(`${name.padEnd(28)} ${f1(s.fs).padStart(14)} ${f1(s.mer).padStart(12)} ${f1(s.br).padStart(8)}   | ${per[0]} (${f1(per[1])})`);
}
// signed timing: does the app mark events early or late?
console.log(`\nevents, average signed (ms, + = app late): foot strike ${f0(mean(rows.map(r => r.ev.fs)))}, arm cocked ${f0(mean(rows.map(r => r.ev.mer)))}, release ${f0(mean(rows.map(r => r.ev.br)))}`);
if (perView) { console.log(""); for (const r of rows) console.log(`${r.view.padEnd(18)} joints ${f1(r.joint)} cm  arm ${f1(r.arm)} cm  events ${f0(r.ev.fs)}/${f0(r.ev.mer)}/${f0(r.ev.br)} ms`) }

// ---- baseline
if (only) process.exit(0);
const round = o => JSON.parse(JSON.stringify(o, (k, v) => typeof v === "number" ? Math.round(v * 100) / 100 : v));
if (update) { writeFileSync(BASE, JSON.stringify(round(summary), null, 1) + "\n"); console.log(`\nsaved as the baseline: ${BASE}`); process.exit(0) }
if (!existsSync(BASE)) { console.log("\nno baseline yet: run with --update to save one"); process.exit(0) }
const base = JSON.parse(readFileSync(BASE, "utf8"));
// "clearly worse": more than 0.3 cm on joints, 1° on an angle average, 5 ms on an event, for any camera angle
let worse = [];
const cmp = (label, now, was, tol, unit) => { if (now == null || was == null) return ""; const d = now - was; if (d > tol) worse.push(`${label} ${was.toFixed(1)} -> ${now.toFixed(1)} ${unit}`); return Math.abs(d) < 0.05 ? "" : `${d > 0 ? "+" : ""}${d.toFixed(1)}` };
console.log("\nchange since baseline (negative = better):");
for (const g of groups) {
  const s = summary[g], b = base[g]; if (!b) continue;
  const parts = [`joints ${cmp(g + " joints", s.joint, b.joint, 0.3, "cm") || "0"} cm`, `arm ${cmp(g + " arm", s.arm, b.arm, 0.3, "cm") || "0"} cm`, `angles ${cmp(g + " angles", s.angAll, b.angAll, 1, "°") || "0"}°`,
    ...Object.keys(EVENTS).map(e => `${e} ${cmp(g + " " + e, s.ev[e], b.ev[e], 5, "ms") || "0"} ms`)];
  console.log(`  ${g.padEnd(12)} ${parts.join(", ")}`);
}
if (worse.length) { console.log("\nCLEARLY WORSE:\n  " + worse.join("\n  ")); process.exit(1) }
console.log("\nno camera angle clearly worse than the baseline");
