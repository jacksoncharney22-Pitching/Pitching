// Coaching report check (no browser, no video): does the report tell each pitcher the same thing the motion-capture
// truth would? Every benchmark pitch (tools/test/bench: real pitches, 5 camera angles each) is analysed the way the
// app does it, and the report is built twice: once from the app's skeleton, once from the measured truth (same angle
// code, same events taken from the truth). Note: the graded report (report.js) is not shown in the app since
// 2026-10-28; this keeps it honest for when it comes back. Each statement is then compared:
//   - graded checks (Good / Check / Work on): agree, "softened" (the app capped it because one camera can't measure
//     it well: honest), "false alarm" (app flags something the truth says is fine) or "missed" (app says fine,
//     truth says it isn't);
//   - the advice wording (e.g. "stride is short" vs "very long", "elbow low" vs "high") when both flag it;
//   - style descriptions (front knee straighter/typical/more bent, leg lift high/medium/low, shoulders closed/open,
//     hips or trunk first).
//   node tools/test/reportcheck.mjs              all pitches, college level (the benchmark pitchers' level)
//   node tools/test/reportcheck.mjs --level pro  compare against another level (ms, hs, col, pro, or all)
//   node tools/test/reportcheck.mjs --items      per-view table for each statement, with the app and truth values
//   node tools/test/reportcheck.mjs --json out.json   save the summary (for before/after comparisons)
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { gunzipSync } from "zlib";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { analyse, computeMetrics } from "../../pipeline.js";
// REPORT=<file> checks another copy of report.js (e.g. the previous version, for a before/after)
const { buildReport } = await import(process.env.REPORT ? new URL("file://" + process.env.REPORT).href : "../../report.js");
const dir = join(dirname(fileURLToPath(import.meta.url)), "bench");
const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null };
const levels = (opt("--level") || "col") === "all" ? ["ms", "hs", "col", "pro"] : [opt("--level") || "col"];
const showItems = argv.includes("--items"), jsonOut = opt("--json");
const only = argv.filter((a, i) => !a.startsWith("--") && !["--level", "--json"].includes(argv[i - 1]))[0] || "";
const load = f => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8"));

const MIRROR = {}; [[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],[23,24],[25,26],[27,28],[29,30],[31,32]].forEach(([a, b]) => { MIRROR[a] = b; MIRROR[b] = a });
const mir = j => (j in MIRROR ? MIRROR[j] : j);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null };

// the truth skeleton turned into what buildReport reads, with the same angle code and the same post-processing as
// analyse() (angles on a right-handed copy; layback unwrapped from foot strike to just after release)
function truthD(tr) {
  // the throwing hand from the motion itself (a right-hander strides with the left foot, landmark 27): the benchmark's
  // one left-hander (3036) is stored as a right-handed mirror image, and the app reads it that way too
  const P = tr.P, T = P.length, { fs, mer, br } = tr.events;
  const LH = Math.abs(P[fs][28][0] - P[0][28][0]) > Math.abs(P[fs][27][0] - P[0][27][0]), hand = LH ? "L" : "R";
  const R = LH ? P.map(F => F.map((_, j) => { const p = F[mir(j)]; return [p[0], p[1], -p[2]] })) : P;
  const M = computeMetrics(R);
  M.throwHorz = M.throwHorz.map((v, t) => M.throwAbd[t] > 50 ? v : null);
  { const lo = Math.max(0, fs - 2), hi = Math.min(T - 1, br + 3), w = [];
    for (let t = lo; t <= hi; t++) { let v = ((M.throwER[t] % 360) + 540) % 360 - 180; if (w.length) v = w[w.length - 1] + (((v - w[w.length - 1]) % 360) + 540) % 360 - 180; w.push(v) }
    const md = median(w), sh = md < -90 ? 360 : md > 270 ? -360 : 0;
    M.throwER = M.throwER.map((_, t) => t >= lo && t <= hi ? w[t - lo] + sh : null) }
  // peak leg lift: lead knee highest before foot strike
  let ll = 0; for (let t = 0; t < fs; t++) if (R[t][25][1] > R[ll][25][1]) ll = t;
  const bones = {}; for (const [a, b] of [[23, 25], [25, 27]]) { const ma = LH ? mir(a) : a, mb = LH ? mir(b) : b; bones[a + "," + b] = median(P.map(F => dist(F[ma], F[mb]))) }
  // rubber: the back (pivot) foot before the leg lift
  const bk = LH ? 27 : 28, rub = [median(P.slice(0, Math.max(1, ll)).map(F => F[bk][0])), 0];
  return { metrics: M, frames: T, fps: tr.fps || 60, pose: P, plantFrame: fs, gradeAll: true, throwHand: hand, bones, cameraDir: [0, 0, 1], rubber: rub,
    phases: [{ name: "Start", frame: 0 }, { name: "Peak leg lift", frame: ll }, { name: "Foot strike", frame: fs }, { name: "Arm cocked", frame: mer }, { name: "Release", frame: br }, { name: "Finish", frame: T - 1 }] };
}

// the style sentence an item picks, reduced to its meaning
const styleWord = i => {
  if (i.num == null || !Number.isFinite(i.num)) return null;
  if (i.id === "kneeFC") return /straighter/.test(i.why) ? "straighter" : /more bent/.test(i.why) ? "more bent" : "typical";
  if (i.id === "lift") return /high/.test(i.why) ? "high" : /medium/.test(i.why) ? "medium" : "low";
  if (i.id === "closed") return i.num <= 0 ? "closed" : "open";
  if (i.id === "speed") return i.num >= 0 ? "hips first" : "trunk first";
  return null;
};
const CAP = { solid: 2, est: 1, rough: 0 };

const views = readdirSync(dir).filter(f => f.endsWith(".raw.json.gz") && f.startsWith(only)).map(f => f.replace(".raw.json.gz", "")).sort();
const tally = {}, rows = [];
const T = (id, k) => { tally[id] ??= { agree: 0, ungraded: 0, softened: 0, falseAlarm: 0, missed: 0, adviceWrong: 0, adviceN: 0, styleAgree: 0, styleN: 0, err: [] }; return tally[id] };
for (const v of views) {
  const raw = load(v + ".raw.json.gz"), tr = load(v + ".truth.json.gz");
  const D = analyse(raw), TD = truthD(tr);
  for (const X of [D, TD]) { X.heightIn = tr.height / 0.0254; X.velo = null }
  if (process.env.ELB) D._elbowSteady = +process.env.ELB;     // try another steadiness limit for the arm at landing
  for (const lv of levels) {
    const A = buildReport(D, lv), B = buildReport(TD, lv), byB = Object.fromEntries(B.items.map(i => [i.id, i]));
    for (const a of A.items) {
      const b = byB[a.id]; if (!b) continue;
      const t = T(a.id), row = { view: v, level: lv, id: a.id, app: a.num, truth: b.num };
      if (Number.isFinite(a.num) && Number.isFinite(b.num)) t.err.push(a.num - b.num);
      if (a.group !== "style") {
        const tg = b.level;                                      // what the truth says (graded as if fully measurable)
        if (a.level == null || tg == null) { t.ungraded++; row.res = "not graded" }
        else if (a.level === tg) { t.agree++; row.res = "agree" }
        else if (a.level === CAP[a.conf] && tg > a.level) { t.softened++; row.res = "softened" }
        else if (a.level > tg) { t.falseAlarm++; row.res = "FALSE ALARM" }
        else { t.missed++; row.res = "MISSED" }
        row.appG = a.level; row.truthG = tg;
        if (a.level >= 1 && tg >= 1) { t.adviceN++; if (a.fix !== b.fix) { t.adviceWrong++; row.res += " (advice differs)" } }
      } else {
        const wa = styleWord(a), wb = styleWord(b);
        if (wa && wb) { t.styleN++; if (wa === wb) t.styleAgree++; row.res = wa === wb ? "agree" : `WRONG: says ${wa}, truth ${wb}` }
        else row.res = "n/a";
      }
      rows.push(row);
    }
  }
}

const f1 = x => x == null || !Number.isFinite(x) ? "—" : (Math.round(x * 10) / 10).toString();
if (showItems) for (const id of Object.keys(tally)) {
  console.log(`\n== ${id}`);
  for (const r of rows.filter(r => r.id === id)) console.log(`  ${r.view.padEnd(18)} ${r.level}  app ${f1(r.app).padStart(6)}  truth ${f1(r.truth).padStart(6)}  ${r.appG ?? ""}${r.truthG != null ? "/" + r.truthG : ""} ${r.res}`);
}
console.log(`\nCoaching report vs motion-capture truth: ${views.length} views, level ${levels.join("+")}`);
console.log("statement                 agree  softened  false-alarm  missed  advice-wrong  not-graded | mean error (app - truth), typical |error|");
let tot = { ok: 0, wrong: 0, n: 0 };
for (const [id, t] of Object.entries(tally)) {
  const e = t.err, me = e.length ? e.reduce((a, b) => a + b, 0) / e.length : null, mae = median(e.map(Math.abs));
  if (t.styleN) {
    console.log(`${id.padEnd(24)} style: ${t.styleAgree}/${t.styleN} right`.padEnd(99) + `| ${f1(me)}, ${f1(mae)}`);
    tot.ok += t.styleAgree; tot.wrong += t.styleN - t.styleAgree;
  } else {
    console.log(`${id.padEnd(24)} ${String(t.agree).padStart(5)}  ${String(t.softened).padStart(8)}  ${String(t.falseAlarm).padStart(11)}  ${String(t.missed).padStart(6)}  ${String(t.adviceWrong + "/" + t.adviceN).padStart(12)}  ${String(t.ungraded).padStart(10)} | ${f1(me)}, ${f1(mae)}`);
    tot.ok += t.agree + t.softened; tot.wrong += t.falseAlarm + t.missed + t.adviceWrong; tot.ungraded = (tot.ungraded || 0) + t.ungraded;
  }
}
console.log(`\nRight or honestly softened: ${tot.ok}; wrong (false alarm, missed, wrong advice or wrong style word): ${tot.wrong}; graded checks left ungraded (reading not trusted): ${tot.ungraded || 0}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ levels, views: views.length, tally: Object.fromEntries(Object.entries(tally).map(([k, t]) => [k, { ...t, err: undefined, meanErr: t.err.length ? t.err.reduce((a, b) => a + b, 0) / t.err.length : null }])), tot, rows }, null, 1));
