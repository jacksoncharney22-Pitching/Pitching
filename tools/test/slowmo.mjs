// Slow-motion reading check (no browser, no video): every benchmark pitch (tools/test/bench, real-speed 60 fps
// tracker output) is stretched to 2x, 4x and 8x slow motion by inserting in-between frames, the way a slow-motion
// video plays the same delivery over more frames. The speed detector must read the right factor every time,
// otherwise every event time and speed on that clip would be stretched or squeezed.
//   node tools/test/slowmo.mjs              all pitches and views at 1x, 2x, 4x, 8x
//   node tools/test/slowmo.mjs 1612_1       only views of that pitch
//   node tools/test/slowmo.mjs --late 20    clips cut to start 20 real frames (1/3 s) before foot strike, i.e. after
//                                           peak leg lift, like a phone video started late. Known weak spot: reported,
//                                           never counted as a failure (see TODO.md)
import { readFileSync, readdirSync } from "fs";
import { gunzipSync } from "zlib";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { detectSlowFactor } from "../../pipeline.js";
const dir = join(dirname(fileURLToPath(import.meta.url)), "bench");
const argv = process.argv.slice(2), lateAt = argv.indexOf("--late"), late = lateAt >= 0 ? +argv[lateAt + 1] || 20 : 0;
const only = argv.filter((a, i) => !a.startsWith("--") && !(lateAt >= 0 && i === lateAt + 1))[0] || "", SPEEDS = (process.env.SPEEDS || "1,2,4,8").split(",").map(Number);
const load = f => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8"));
const lerpPts = (A, B, u) => A.map((p, j) => p.map((v, k) => v + (B[j][k] - v) * u));
// s video frames per real frame: frame t*s + i is the real motion i/s of the way from frame t to frame t+1
function stretch(raw, s) {
  if (s === 1) return raw;
  const F = raw.frames, L = raw.l3, frames = [], l3 = L ? [] : null;
  for (let t = 0; t < F.length; t++) for (let i = 0; i < s; i++) {
    const a = F[t], b = F[Math.min(t + 1, F.length - 1)], u = i / s;
    frames.push(!a ? null : !b || t === F.length - 1 ? a : { img: lerpPts(a.img, b.img, u), world: lerpPts(a.world, b.world, u), spread: a.spread || null });
    if (L) { const la = L[t], lb = L[Math.min(t + 1, L.length - 1)]; l3.push(!la ? null : !lb ? la : lerpPts(la, lb, u)) }
    if (t === F.length - 1) break;
  }
  return { ...raw, frames, l3, fps: raw.videoFps || raw.fps, videoFps: raw.videoFps || raw.fps };
}
const views = readdirSync(dir).filter(f => f.endsWith(".raw.json.gz") && f.startsWith(only)).map(f => f.replace(".raw.json.gz", ""));
let fails = 0, n = 0;
const rows = [];
for (const v of views) {
  let raw = load(v + ".raw.json.gz"); const got = [];
  if (late) { const a = Math.max(0, load(v + ".truth.json.gz").events.fs - late); raw = { ...raw, frames: raw.frames.slice(a), l3: raw.l3 && raw.l3.slice(a) } }
  for (const s of SPEEDS) {
    const r = stretch(raw, s), vf = r.videoFps || r.fps;
    let res; try { res = detectSlowFactor({ ...r, fps: vf, videoFps: vf }) } catch (e) { res = { factor: "crash: " + e.message } }
    n++; const ok = res.factor === s; if (!ok) fails++;
    got.push(ok ? `${s}x ok` : `${s}x READ AS ${res.factor}x (est ${res.estimate?.toFixed?.(2)}, ${res.basis})`);
  }
  rows.push(`${got.every(g => g.endsWith("ok")) ? "ok  " : "FAIL"} ${v.padEnd(20)} ${got.join("  ")}`);
}
console.log(rows.join("\n"));
console.log(`${n - fails} of ${n} speed readings right${late ? ` (clips starting ${late} frames before foot strike; report only)` : ""}`);
process.exit(fails && !late ? 1 : 0);
