// Glitch scorecard: the things a coach sees as "the skeleton glitched", which the accuracy averages can hide.
// For each of the 60 benchmark views (and, for reference, the motion-capture truth of the same pitch):
//   shake  : average frame-to-frame change of joint speed (cm per frame^2, measured from the middle of the hips);
//   jumps  : joints-frames where a joint changes speed more than the truth's own hardest moment for that joint, x1.5;
//   flips  : frames where the shoulder line or hip line turns more than 40 degrees in one frame (body flip / twist);
//   bad    : % of frames with an impossible joint (knee or elbow past straight by 15 deg, or folded past 165 deg (flexion: 0 = straight)).
//   node tools/test/glitch.mjs            print the table
//   node tools/test/glitch.mjs --views    also the worst 10 views
import { readFileSync, readdirSync } from "fs"; import { gunzipSync } from "zlib";
import { dirname, join } from "path"; import { fileURLToPath } from "url";
import { analyse } from "../../pipeline.js"; import { truthD, armLibFor } from "./truth.mjs";
const dir = join(dirname(fileURLToPath(import.meta.url)), "bench"), L = f => JSON.parse(gunzipSync(readFileSync(join(dir, f))));
const J = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28], mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const rel = (F, j) => [0, 1, 2].map(k => F[j][k] - (F[23][k] + F[24][k]) / 2);
const acc = (P, t, j) => { const a = rel(P[t - 1], j), b = rel(P[t], j), c = rel(P[t + 1], j); return 100 * Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]) };
const ang = (F, a, b) => Math.atan2(F[a][2] - F[b][2], F[a][0] - F[b][0]), wrap = d => Math.abs(((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
const lim = { };
function score(P, M, caps) {
  let sh = 0, n = 0, jumps = 0, flips = 0, bad = 0, nb = 0;
  for (let t = 1; t < P.length - 1; t++) for (const j of J) { const a = acc(P, t, j); sh += a; n++; if (caps && a > caps[j]) jumps++ }
  for (let t = 1; t < P.length; t++) for (const [a, b] of [[11, 12], [23, 24]]) if (wrap(ang(P[t], a, b) - ang(P[t - 1], a, b)) > 40 * Math.PI / 180) flips++;
  for (const k of ["throwElbow", "leadKnee"]) for (const v of M[k]) if (v != null) { nb++; if (v < -15 || v > 165) bad++ }
  return { shake: sh / n, jumps, flips, bad: 100 * bad / nb };
}
const rows = [];
for (const f of readdirSync(dir).filter(f => f.endsWith(".raw.json.gz")).sort()) {
  const v = f.replace(".raw.json.gz", ""), raw = L(f), tr = L(v + ".truth.json.gz"), T = truthD(tr);
  const D = analyse({ ...raw, heightIn: tr.height / 0.0254 }, { armLib: armLibFor(tr.sp) });
  const caps = {}; for (const j of J) { let m = 0; for (let t = 1; t < tr.P.length - 1; t++) m = Math.max(m, acc(tr.P, t, j)); caps[j] = 1.5 * m }
  rows.push({ v, caps, a: score(D.pose, D.metrics, caps), t: score(tr.P, T.metrics) });
}
// the saved real clips have no truth: judged with the hardest speed change seen in any lab pitch
const FX = join(dirname(fileURLToPath(import.meta.url)), "fixtures"), arm = JSON.parse(readFileSync(new URL("../../armlib.json", import.meta.url)));
const labCap = {}; for (const j of J) labCap[j] = Math.max(...rows.map(r => r.caps[j]));
const clips = readdirSync(FX).filter(f => f.endsWith(".json.gz")).sort().map(f => { const raw = JSON.parse(gunzipSync(readFileSync(join(FX, f)))), D = analyse(raw, { armLib: arm }), k = 240 / D.fps, c = {}; for (const j of J) c[j] = labCap[j] * k * k; return { f, s: score(D.pose, D.metrics, c), fps: D.fps } });
const col = (s, k) => mean(rows.map(r => r[s][k]).filter(Number.isFinite)).toFixed(k === "shake" ? 2 : 1);
console.log(`views ${rows.length}`);
console.log("            shake(cm/f²)   jumps/view   flips/view   impossible%");
console.log("app skeleton".padEnd(13), col("a", "shake").padStart(10), col("a", "jumps").padStart(12), col("a", "flips").padStart(12), col("a", "bad").padStart(12));
console.log("truth".padEnd(13), col("t", "shake").padStart(10), "-".padStart(12), col("t", "flips").padStart(12), col("t", "bad").padStart(12));
if (process.argv.includes("--views")) for (const r of rows.slice().sort((x, y) => y.a.jumps + 5 * y.a.flips - x.a.jumps - 5 * x.a.flips).slice(0, 10)) console.log(r.v.padEnd(24), "jumps", r.a.jumps, "flips", r.a.flips, "shake", r.a.shake.toFixed(2), "bad", r.a.bad.toFixed(1));
console.log("\nreal clips (no truth)");for (const c of clips) console.log(c.f.padEnd(28), "fps", String(Math.round(c.fps)).padStart(4), "shake", c.s.shake.toFixed(2).padStart(6), "jumps", String(c.s.jumps).padStart(4), "flips", String(c.s.flips).padStart(3), "impossible%", c.s.bad.toFixed(1));
