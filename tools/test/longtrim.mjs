// Long-trim check (no browser): a coach who drags the trim over a whole 20-25 s phone clip (pitcher standing on the
// mound before and after, or two pitches in one trim) gets up to 1500 tracked frames, 5-7x a normal trim. The skeleton
// build must still finish in reasonable time and memory, and find the SAME delivery (events within 0.05 s of the
// normal trim's, shifted by the padding), with the same delivery numbers.
//   node tools/test/longtrim.mjs            (exit 1 on any failure; prints time and memory per case)
import { readFileSync } from "fs"; import { gunzipSync } from "zlib";
import { dirname, join } from "path"; import { fileURLToPath } from "url";
import { analyse, deliveryMeasures } from "../../pipeline.js";
const here = dirname(fileURLToPath(import.meta.url));
const LIB = JSON.parse(readFileSync(join(here, "../../armlib.json"), "utf8"));
const load = f => JSON.parse(gunzipSync(readFileSync(join(here, "fixtures", f))).toString("utf8"));
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const clone = o => JSON.parse(JSON.stringify(o));
// a frame held still with a little tracker jitter (pitcher standing, or walking slowly)
const jitter = (f, s = 0.002) => { const g = clone(f); for (const p of g.img) { p[0] += (rnd() - 0.5) * s; p[1] += (rnd() - 0.5) * s } return g };
function pad(raw, secBefore, secAfter) {
  const r = clone(raw), n = r.frames.length, fps = r.fps, a = Math.round(secBefore * fps), b = Math.round(secAfter * fps);
  const f0 = r.frames.find(Boolean), f1 = [...r.frames].reverse().find(Boolean);
  r.frames = [...Array.from({ length: a }, () => jitter(f0)), ...r.frames, ...Array.from({ length: b }, () => jitter(f1))];
  if (Array.isArray(r.l3)) { const l0 = r.l3.find(Boolean), l1 = [...r.l3].reverse().find(Boolean); r.l3 = [...Array(a).fill(l0), ...r.l3, ...Array(b).fill(l1)] }
  return { r, shift: a / fps, n: n + a + b };
}
const evs = D => Object.fromEntries((D.phases || []).map(p => [p.name, p.frame + ((D.cropped && D.cropped.from) || 0)]));   // in the whole trim's frames
const meas = D => { try { return deliveryMeasures(D, null) } catch (e) { return null } };
const CASES = [
  ["maher_fast.json.gz", 8, 8], ["maher_fast.json.gz", 18, 3], ["maher_fast.json.gz", 3, 18],
  ["staumont_fast.json.gz", 9, 9], ["hackimer_fast.json.gz", 0.5, 0.5],   // Hackimer is 480 fps after slow-motion reading: 1 s = 480 frames
];
let bad = 0;
for (const [file, sb, sa] of CASES) {
  const base = load(file);
  let t0 = performance.now(); const D0 = analyse(clone(base), { hand: "auto", armLib: LIB }); const t1 = performance.now() - t0;
  const { r, shift, n } = pad(base, sb, sa);
  global.gc && global.gc(); const h0 = process.memoryUsage().heapUsed; let peak = h0;
  const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed) }, 5);
  t0 = performance.now(); let D, err = "";
  try { D = analyse(r, { hand: "auto", armLib: LIB }) } catch (e) { err = String(e && e.message || e) }
  const t2 = performance.now() - t0; clearInterval(iv); peak = Math.max(peak, process.memoryUsage().heapUsed);
  const fps = base.fps, e0 = evs(D0), e1 = D ? evs(D) : {}, diffs = [];
  let ok = !err;
  for (const k of Object.keys(e0)) {
    if (e0[k] == null || k === "Start" || k === "Finish") continue;   // the clip's own ends move with the padding
    if (e0[k] <= 2) continue;                                                // trim began at this event (Hackimer: at the top of leg lift): a held pose before it has no single peak
    const d = e1[k] == null ? Infinity : (e1[k] / fps - shift) - e0[k] / fps; diffs.push(`${k} ${Number.isFinite(d) ? (d >= 0 ? "+" : "") + (d * 1000).toFixed(0) + "ms" : "missing"}`);
    if (!(Math.abs(d) <= 0.05)) ok = false;
  }
  if (t2 > 60000) ok = false;
  const m0 = meas(D0), m1 = D && meas(D);
  let mtxt = "";
  if (m0 && m1) for (const k of Object.keys(m0)) if (typeof m0[k] === "number" && typeof m1[k] === "number") { const d = m1[k] - m0[k]; if (Math.abs(d) > 1e-6) mtxt += ` ${k} ${d > 0 ? "+" : ""}${d.toFixed(2)}` }
  // the numbers on the coach's screen must not depend on how much standing around the trim holds (before the fix: slot
  // moved -4 / +8 deg on Maher); extension isn't shown (too rough) and Hackimer's 480-frame-a-second padding stays uncut
  const LIM = { armSlot: 2, strideM: 0.08, peakSep: 3, relHeight: 0.05 };
  if (m0 && m1) for (const [k, lim] of Object.entries(LIM)) if (typeof m0[k] === "number" && !(Math.abs((m1[k] ?? NaN) - m0[k]) <= lim)) { ok = false; mtxt += ` [${k} over ${lim}]` }
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${file} +${sb}s before/+${sa}s after: ${n} frames (normal ${base.frames.length}), ${(t2 / 1000).toFixed(1)} s (normal ${(t1 / 1000).toFixed(1)} s), memory +${((peak - h0) / 1e6).toFixed(0)} MB${err ? " ERROR " + err : ""}`);
  console.log(`     events vs normal trim: ${diffs.join(", ")}${mtxt ? "\n     numbers changed:" + mtxt : ""}`);
}
console.log(bad ? `${bad} case(s) FAILED` : "all long trims find the same delivery");
process.exit(bad ? 1 : 0);
