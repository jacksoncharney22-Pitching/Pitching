// Trim-spread check (no browser): two coaches trimming the same pitch a little differently should see the same delivery
// numbers. Each saved clip is cut at several ordinary trims (whole clip; starting 0.5 / 0.3 s before peak leg lift;
// ending 0.6 / 0.4 s after release; and the combinations), re-analysed, and the spread (largest minus smallest) of each
// coach-facing number is printed, with the event times (in the whole clip's time).
//   node tools/test/trimspread.mjs [--max <deg>]     (--max: exit 1 if any slot / separation spread is larger)
// 2026-11-10 (after the slot fix): Maher max slot spread 3.0 deg, peak separation 7.9 deg: see TODO.md lead.
import { readFileSync } from "fs"; import { gunzipSync } from "zlib";
import { dirname, join } from "path"; import { fileURLToPath } from "url";
import { analyse, deliveryMeasures } from "../../pipeline.js";
const here = dirname(fileURLToPath(import.meta.url));
const LIB = JSON.parse(readFileSync(join(here, "../../armlib.json"), "utf8"));
const lim = process.argv.includes("--max") ? +process.argv[process.argv.indexOf("--max") + 1] : null;
const clone = o => JSON.parse(JSON.stringify(o));
const KEYS = { armSlot: "slot", peakSep: "peak sep", strideM: "stride m", relHeight: "hand ht m" };
let bad = 0;
for (const f of ["maher_fast", "maher_max", "staumont_fast", "hackimer_fast"]) {
  const base = JSON.parse(gunzipSync(readFileSync(join(here, "fixtures", f + ".json.gz"))).toString("utf8"));
  const fs = base.fps, n = base.frames.length;
  const D0 = analyse(clone(base), { hand: "auto", armLib: LIB }), ph = Object.fromEntries(D0.phases.map(p => [p.name, p.frame]));
  const L = ph["Peak leg lift"], R = ph["Release"];
  const starts = [0, L - Math.round(0.5 * fs), L - Math.round(0.3 * fs)].filter(a => a >= 0), ends = [n, R + Math.round(0.6 * fs), R + Math.round(0.4 * fs)].filter(b => b <= n);
  const rows = [];
  for (const a of [...new Set(starts)]) for (const b of [...new Set(ends)]) {
    const r = { ...clone(base), frames: base.frames.slice(a, b), start: (base.start || 0) + a / fs };
    if (Array.isArray(base.l3)) r.l3 = base.l3.slice(a, b);
    const D = analyse(r, { hand: "auto", armLib: LIB }), m = deliveryMeasures(D, null) || {}, off = a + ((D.cropped && D.cropped.from) || 0);
    const ev = Object.fromEntries(D.phases.map(p => [p.name, (p.frame + off) / fs]));
    rows.push({ a, b, m, ev });
  }
  const out = [];
  for (const [k, nm] of Object.entries(KEYS)) {
    const v = rows.map(r => r.m[k]).filter(x => typeof x === "number");
    if (!v.length) continue;
    const sp = Math.max(...v) - Math.min(...v); out.push(`${nm} ${Math.min(...v).toFixed(k.endsWith("M") || k === "relHeight" ? 2 : 1)}..${Math.max(...v).toFixed(k.endsWith("M") || k === "relHeight" ? 2 : 1)}`);
    if (lim != null && (k === "armSlot" || k === "peakSep") && sp > lim) bad++;
  }
  const evs = ["Foot strike", "Arm cocked", "Release"].map(e => { const v = rows.map(r => r.ev[e]); return `${e.toLowerCase()} spread ${((Math.max(...v) - Math.min(...v)) * 1000).toFixed(0)} ms` });
  console.log(`${f} (${rows.length} trims): ${out.join(", ")}\n     ${evs.join(", ")}`);
}
if (lim != null) { console.log(bad ? `${bad} reading(s) spread more than ${lim} deg` : `all spreads within ${lim} deg`); process.exit(bad ? 1 : 0) }
