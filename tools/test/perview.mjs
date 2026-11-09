// Compares this checkout with another copy of the repo, angle by angle and view by view, on the 60 benchmark views at
// foot strike, max layback and release. The scorecard only prints averages, and a small change in an average can hide a
// reading getting 15° worse on a few views (it happened: front knee at foot strike, 2026-11-09).
//   git worktree add /tmp/before HEAD~1 && node tools/test/perview.mjs /tmp/before [--check]
import { readFileSync, readdirSync } from "fs"; import { gunzipSync } from "zlib";
import { dirname, resolve } from "path"; import { fileURLToPath } from "url";
const R = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), O = resolve(process.argv[2]);
const dir = R + "/tools/test/bench/", L = f => JSON.parse(gunzipSync(readFileSync(dir + f)));
const KEYS = ["throwElbow", "throwAbd", "throwER", "leadKnee", "pelvisRot", "trunkRot", "separation", "trunkFwd", "trunkLat"];
const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
async function run(root) {
  const { analyse } = await import(root + "/pipeline.js"), { truthD, armLibFor } = await import(root + "/tools/test/truth.mjs"), out = {};
  for (const f of readdirSync(dir).filter(f => f.endsWith(".raw.json.gz"))) {
    const v = f.replace(".raw.json.gz", ""), raw = L(f), tr = L(v + ".truth.json.gz"), T = truthD(tr);
    const D = analyse({ ...raw, heightIn: tr.height / 0.0254 }, { armLib: armLibFor(tr.sp) });
    for (const k of KEYS) for (const e of ["fs", "mer", "br"]) { const t = tr.events[e], a = D.metrics[k]?.[t], b = T.metrics[k]?.[t]; if (a != null && b != null) out[`${v}|${k}|${e}`] = Math.abs(wrap(a - b)) }
  }
  return out;
}
const now = await run(R), was = await run(O), G = {};
for (const key in now) { if (was[key] == null) continue; const [v, k, e] = key.split("|"), g = G[k + " at " + e] ??= []; g.push([now[key] - was[key], v, now[key]]) }
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
console.log("reading                  avg change   views >5° worse   >5° better   worst single view");
for (const k in G) { const a = G[k].sort((x, y) => y[0] - x[0]); console.log(k.padEnd(24), mean(a.map(x => x[0])).toFixed(2).padStart(8), String(a.filter(x => x[0] > 5).length).padStart(14), String(a.filter(x => x[0] < -5).length).padStart(13), `   ${a[0][1]} ${a[0][0] > 0 ? "+" : ""}${a[0][0].toFixed(1)}°`) }
// --check: exit 1 if a reading got clearly worse across many views (avg more than 0.3° worse and 6+ views more than 5° worse).
if (process.argv.includes("--check")) {
  const bad = Object.keys(G).filter(k => mean(G[k].map(x => x[0])) > 0.3 && G[k].filter(x => x[0] > 5).length >= 6);
  if (bad.length) { console.log("\nCLEARLY WORSE on many views: " + bad.join(", ")); process.exit(1) }
  console.log("\nno reading clearly worse across the views");
}
