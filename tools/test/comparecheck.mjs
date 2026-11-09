// How big must a difference between two pitches be before it is the pitcher and not the camera? Takes every pair of
// benchmark pitches filmed from the same camera angle and compares "A minus B" as the app reads it with "A minus B" in
// motion capture. Compare (compare.js) bolds a row by these numbers.
//   node tools/test/comparecheck.mjs            per-reading table
//   node tools/test/comparecheck.mjs --json     the numbers to paste into compare.js
import { readFileSync, readdirSync } from "fs"; import { gunzipSync } from "zlib";
import { dirname, resolve } from "path"; import { fileURLToPath } from "url";
import { analyse } from "../../pipeline.js"; import { truthD, armLibFor } from "./truth.mjs";
const R = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), dir = R + "/tools/test/bench/", L = f => JSON.parse(gunzipSync(readFileSync(dir + f)));
const KEYS = ["throwElbow", "throwAbd", "throwER", "leadKnee", "leadHip", "backKnee", "pelvisRot", "trunkRot", "separation", "trunkFwd", "trunkLat"], EV = ["ll", "fs", "mer", "br"];
const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
const byView = {};
for (const f of readdirSync(dir).filter(f => f.endsWith(".raw.json.gz"))) {
  const v = f.replace(".raw.json.gz", ""), raw = L(f), tr = L(v + ".truth.json.gz"), T = truthD(tr), m = v.lastIndexOf("_") , D = analyse({ ...raw, heightIn: tr.height / 0.0254 }, { armLib: armLibFor(tr.sp) });
  const cam = ["behind_3b", "front_3b", "side_back", "side_open", "behind"].find(c => v.endsWith(c)), pitch = v.slice(0, v.length - cam.length - 1), row = {};
  for (const k of KEYS) for (const e of EV) { const t = e === "ll" ? T.phases[1].frame : tr.events[e], a = D.metrics[k]?.[t], b = T.metrics[k]?.[t]; if (a != null && b != null) row[k + "|" + e] = [a, b] }
  (byView[cam] ??= {})[pitch] = row;
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] };
const out = {}, pool = {};
for (const cam in byView) { const P = Object.keys(byView[cam]);
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) for (const key in byView[cam][P[i]]) { const x = byView[cam][P[i]][key], y = byView[cam][P[j]][key]; if (!y) continue; (pool[key] ??= []).push([wrap(x[0] - y[0]), wrap(x[1] - y[1])]) } }
// precision of a threshold: of the flagged pairs, how many have the truth pointing the same way by at least 3°
const score = (a, th) => { const f = a.filter(p => Math.abs(p[0]) >= th), ok = f.filter(p => Math.sign(p[0]) === Math.sign(p[1]) && Math.abs(p[1]) >= 3); return [f.length / a.length, f.length ? ok.length / f.length : null] };
console.log("reading              pairs  error of A-B: 50% / 80% / 90%   flag@10: share right   flag@80%: share right");
for (const key in pool) { const a = pool[key], e = a.map(p => Math.abs(p[0] - p[1])), th = Math.max(5, Math.round(pct(e, 0.8))), s10 = score(a, 10), sp = score(a, th); out[key] = (sp[1] ?? 0) >= 0.65 ? th : null;   // when a big reading is usually not a real difference, never bold it
  if (!process.argv.includes("--json")) console.log(key.padEnd(20), String(a.length).padStart(5), pct(e, .5).toFixed(1).padStart(10), pct(e, .8).toFixed(1).padStart(6), pct(e, .9).toFixed(1).padStart(6), `   ${(s10[0] * 100).toFixed(0)}% ${(s10[1] * 100).toFixed(0)}%`.padStart(16), `   >=${th}: ${(sp[0] * 100).toFixed(0)}% ${sp[1] == null ? "-" : (sp[1] * 100).toFixed(0) + "%"}`.padStart(22)) }
// Held-out check: thresholds from the pairs among one half of the pitches, scored on the pairs among the other half.
{ const all = c => Object.keys(byView[c]).sort(), half = (i, c) => all(c).filter((_, n) => n % 2 === i), pairs = (i, key) => { const r = []; for (const c in byView) { const P = half(i, c); for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) { const x = byView[c][P[a]][key], y = byView[c][P[b]][key]; if (x && y) r.push([wrap(x[0] - y[0]), wrap(x[1] - y[1])]) } } return r };
  let n = 0, f10 = 0, r10 = 0, fp = 0, rp = 0;
  for (const key in pool) for (const [tr, te] of [[0, 1], [1, 0]]) { const A = pairs(tr, key), B = pairs(te, key); if (!A.length || !B.length) continue; const th = Math.max(5, Math.round(pct(A.map(p => Math.abs(p[0] - p[1])), 0.8)));
    for (const p of B) { n++; const ok = Math.sign(p[0]) === Math.sign(p[1]) && Math.abs(p[1]) >= 3; if (Math.abs(p[0]) >= 10) { f10++; r10 += ok } if (Math.abs(p[0]) >= th) { fp++; rp += ok } } }
  console.log(`\nheld-out, all readings: flag at 10°: ${(100 * f10 / n).toFixed(0)}% of rows, ${(100 * r10 / f10).toFixed(0)}% right; flag at the reading's own size: ${(100 * fp / n).toFixed(0)}% of rows, ${(100 * rp / fp).toFixed(0)}% right`) }
if (process.argv.includes("--json")) console.log(JSON.stringify(out));
