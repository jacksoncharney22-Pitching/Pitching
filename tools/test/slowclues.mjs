// Slow-motion clue study (report only): on every benchmark view at real speed, cut to start N frames before foot
// strike, how far each timing clue reads from 1x (log2 units; 1.0 = a whole factor of two wrong). A good clue has a
// small spread. Used to pick clues for detectSlowFactor on clips that start after the leg lift.
//   node tools/test/slowclues.mjs [lateFrames=20]
import { readFileSync, readdirSync } from "fs";
import { gunzipSync } from "zlib";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { analyse } from "../../pipeline.js";
const dir = join(dirname(fileURLToPath(import.meta.url)), "bench");
const late = +process.argv[2] || 20;
const load = f => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8"));
const views = readdirSync(dir).filter(f => f.endsWith(".raw.json.gz")).map(f => f.replace(".raw.json.gz", ""));
const cols = {}, rows = []; let row;
const push = (k, v) => { if (isFinite(v) && v > 0) { (cols[k] = cols[k] || []).push(Math.log2(v)); row[k] = Math.log2(v) } };
for (const v of views) {
  row = { v }; rows.push(row);
  let raw = load(v + ".raw.json.gz");
  const a = Math.max(0, load(v + ".truth.json.gz").events.fs - late); raw = { ...raw, frames: raw.frames.slice(a), l3: raw.l3 && raw.l3.slice(a) };
  const vf = raw.videoFps || raw.fps;
  const d = analyse({ ...raw, fps: vf, videoFps: vf }, { _inner: true, relWindow: 0.5, armBridge: false, depop: false, _noGaps: true });
  const ph = Object.fromEntries(d.phases.map(p => [p.name, p.frame])), FS = ph["Foot strike"], R = ph["Release"], MER = ph["Arm cocked"] ?? ph["Max layback"];
  const P = d.pose, T = P.length, Wr = d.throwHand === "L" ? 15 : 16;
  const Y = P[FS].map(p => p[1]), H = Math.max(1e-6, Math.max(...Y) - Math.min(...Y));
  const h = Math.max(1, Math.round((R - FS) / 8));
  let pk = 0; for (let t = FS; t < Math.min(T - h, R + h); t++) { const p = P[t][Wr], q = P[t + h][Wr]; pk = Math.max(pk, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / H * vf / h) }
  push("fs-rel", (R - FS) / vf / 0.2); push("hand", 14 / pk);
  if (MER != null) push("fs-mer", (MER - FS) / vf / 0.125);
  const m = d.metrics, rate = (arr, a, b, s) => { let best = 0; for (let t = a; t < b; t++) { const g = Math.abs(arr[t + s] - arr[t]) * vf / s; if (g > best) best = g } return best };
  if (m && m.trunkRot) { push("trunkVel", 1000 / rate(m.trunkRot, Math.max(0, FS - 6), Math.min(T - 3, R + 4), 2)); push("pelvVel", 650 / rate(m.pelvisRot, Math.max(0, FS - 10), Math.min(T - 3, R + 4), 2)) }
  // whole-body: front knee / hip speed during the stride
  const Hp = d.throwHand === "L" ? 24 : 23; let hv = 0; for (let t = Math.max(0, FS - 10); t < FS; t++) { const p = P[t][Hp], q = P[t + 1][Hp]; hv = Math.max(hv, Math.hypot(p[0] - q[0], p[2] - q[2]) / H * vf) } push("hipStride", 1.6 / hv);
  // time from release to trunk flexion peak / finish
}
const st = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return { n: a.length, mean: m, sd: Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length), bad: a.filter(x => Math.abs(x) > 0.5).length } };
for (const [k, a] of Object.entries(cols)) { const s = st(a); console.log(k.padEnd(10), `n ${s.n} mean ${s.mean.toFixed(2)} sd ${s.sd.toFixed(2)} wrong-alone ${s.bad}`) }

if (process.env.DUMP) (await import("fs")).writeFileSync(process.env.DUMP, JSON.stringify(rows));
