// Body fit on clips that start late (at or just after peak leg lift, like a phone video started late).
// Each benchmark view is cut to start at the app's own leg lift frame + LATE (default 0), then analysed with and
// without the body fit (library without the benchmark athletes). Joint error (cm, from the middle of the hips) over
// the cut clip, and angles at the true foot strike / arm cocked / release.
//   node tools/test/latefit.mjs [view prefix] [--late frames]
import { readFileSync, readdirSync } from "fs";
import { gunzipSync } from "zlib";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { analyse } from "../../pipeline.js";
import { truthD, armLibFor } from "./truth.mjs";
const here = dirname(fileURLToPath(import.meta.url)), dir = join(here, "bench");
const argv = process.argv.slice(2), li = argv.indexOf("--late"), LATE = li >= 0 ? +argv[li + 1] : 0;
const only = argv.filter((a, i) => !a.startsWith("--") && !(li >= 0 && i === li + 1))[0] || "";
const load = f => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8"));
const BL = JSON.parse(readFileSync(join(dir, "bodylib_holdout.json"), "utf8"));
const mean = a => { const b = a.filter(Number.isFinite); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : NaN };
const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28], ANG = ["leadKnee", "pelvisRot", "trunkRot", "separation", "trunkFwd", "trunkLat"];
const hip = F => [0, 1, 2].map(k => (F[23][k] + F[24][k]) / 2);
const rows = [];
for (const v of readdirSync(dir).filter(f => f.endsWith(".raw.json.gz") && f.startsWith(only)).map(f => f.replace(".raw.json.gz", "")).sort()) {
  const raw0 = load(v + ".raw.json.gz"), tr = load(v + ".truth.json.gz"), base = { armLib: armLibFor(tr.sp) }, hIn = tr.height / 0.0254;
  const D0 = analyse({ ...raw0, heightIn: hIn }, base), ll = (D0.phases.find(p => p.name === "Peak leg lift") || {}).frame;
  if (!(ll >= 0)) continue;
  const a = Math.max(0, ll + LATE), raw = { ...raw0, frames: raw0.frames.slice(a), l3: raw0.l3 && raw0.l3.slice(a) };
  const P = tr.P.slice(a), TD = truthD(tr), row = { v, ok: false };
  for (const [key, o] of [["app", base], ["fit", { ...base, bodyLib: BL, bodyFit: true, bodyFitOpts: process.env.FITOPTS ? JSON.parse(process.env.FITOPTS) : {} }]]) {
    const D = analyse({ ...raw, heightIn: hIn }, o); if (key === "fit") row.ok = !!D.bodyFit;
    const T = Math.min(D.pose.length, P.length); let se = 0, n = 0;
    for (let t = 0; t < T; t++) { const A = D.pose[t], B = P[t], ha = hip(A), hb = hip(B); for (const j of JOINTS) { se += Math.hypot(...[0, 1, 2].map(k => (A[j][k] - ha[k]) - (B[j][k] - hb[k]))); n++ } }
    row[key] = { j: 100 * se / n, ang: {} };
    for (const k of ANG) row[key].ang[k] = ["fs", "mer", "br"].map(e => { const f = tr.events[e] - a; const x = D.metrics[k][f], y = TD.metrics[k][tr.events[e]]; return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(wrap(x - y)) : NaN });
  }
  rows.push(row);
  if (argv.includes("--views")) console.log(v, "cut", a, row.ok ? "fitted" : "NOT fitted", row.app.j.toFixed(1), "->", row.fit.j.toFixed(1));
}
const f1 = x => x.toFixed(1);
console.log(`${rows.length} views cut at leg lift ${LATE >= 0 ? "+" : ""}${LATE} frames; fitted ${rows.filter(r => r.ok).length}`);
console.log(`joints cm: app ${f1(mean(rows.map(r => r.app.j)))} -> with fit ${f1(mean(rows.map(r => r.fit.j)))}`);
for (const k of ANG) console.log(`${k.padEnd(11)} FS/MER/BR: app ${[0, 1, 2].map(i => f1(mean(rows.map(r => r.app.ang[k][i])))).join("/")} -> fit ${[0, 1, 2].map(i => f1(mean(rows.map(r => r.fit.ang[k][i])))).join("/")}`);
