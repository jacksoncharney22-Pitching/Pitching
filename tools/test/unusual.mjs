// Rebuild step 4: does the app (and the lab-matched body fit) follow UNUSUAL deliveries? Views made by
// tools/test/unusual_make.py (unusual lab pitchers, benchmark cameras, real tracker noise from a donor view).
// For every pitcher, the reading that makes him unusual (arm slot, stride, side tilt, timing) is compared with the
// truth, signed, for the app alone and with the body fit, so "pulled toward average" shows as a bias against his
// own unusualness. Also joint/arm error and the usual angle table averages.
//   node tools/test/unusual.mjs <dir> <library.json> [--views]
//   <library.json>: a body library WITHOUT these pitchers (tools/bodylib_build.py --exclude <dir>/exclude_users.txt)
import { readFileSync, readdirSync, existsSync } from "fs";
import { gunzipSync } from "zlib";
import { join } from "path";
import { analyse, deliveryMeasures } from "../../pipeline.js";
import { truthD, armLibFor } from "./truth.mjs";

const [dir, libPath] = process.argv.slice(2).filter((a, i, A) => !a.startsWith("--") && A[i - 1] !== "--json"), perView = process.argv.includes("--views");
if (!dir || !libPath) { console.log("usage: node tools/test/unusual.mjs <dir> <library.json> [--views]"); process.exit(1) }
const LIB = JSON.parse(readFileSync(libPath, "utf8"));
const load = f => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8"));
const picks = existsSync(join(dir, "picks.json")) ? JSON.parse(readFileSync(join(dir, "picks.json"), "utf8")).picks : [];
const why = Object.fromEntries(picks.map(p => [p.sp, p.why]));
const mean = a => { const b = a.filter(Number.isFinite); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : NaN };
const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const ANG = ["throwElbow", "throwAbd", "throwER", "leadKnee", "pelvisRot", "trunkRot", "separation", "trunkFwd", "trunkLat"];
const ROT = new Set(["pelvisRot", "trunkRot", "separation", "throwER"]);

function score(D, tr, TD) {
  const T = Math.min(D.pose.length, tr.P.length), hip = F => [0, 1, 2].map(k => (F[23][k] + F[24][k]) / 2);
  let se = 0, n = 0, ae = 0, an = 0; const { fs, br } = tr.events, arm = D.throwHand === "L" ? [11, 13, 15] : [12, 14, 16];
  for (let t = 0; t < T; t++) { const A = D.pose[t], B = tr.P[t], ha = hip(A), hb = hip(B);
    for (const j of JOINTS) { const e = Math.hypot(...[0, 1, 2].map(k => (A[j][k] - ha[k]) - (B[j][k] - hb[k]))); se += e; n++; if (t >= fs && t <= br && arm.includes(j)) { ae += e; an++ } } }
  const ang = {}, sgn = {}, tv = {};
  for (const e of ["fs", "mer", "br"]) for (const k of ANG) { const a = D.metrics[k][tr.events[e]], b = TD.metrics[k][tr.events[e]]; if (a == null || b == null) continue; const d = ROT.has(k) ? wrap(a - b) : a - b; ang[k + "|" + e] = Math.abs(d); sgn[k + "|" + e] = d; tv[k + "|" + e] = b }
  const m = deliveryMeasures(D, tr.height), mt = deliveryMeasures(TD, tr.height, 0);
  return { tv, joint: 100 * se / n, arm: 100 * ae / an, ang: mean(Object.values(ang)), sgn, slot: m.armSlot - mt.armSlot, stride: 100 * (m.strideLen - mt.strideLen), hand: D.throwHand,
    slotT: mt.armSlot, strideT: 100 * mt.strideLen, tiltT: TD.metrics.trunkLat[tr.events.br], tilt: sgn["trunkLat|br"], knee: mean(["fs", "mer", "br"].map(e => sgn["leadKnee|" + e])),
    kneeT: Object.fromEntries(["fs", "mer", "br"].map(e => [e, TD.metrics.leadKnee[tr.events[e]]])), kneeS: Object.fromEntries(["fs", "mer", "br"].map(e => [e, sgn["leadKnee|" + e]])), fit: D.bodyFit || null };
}

const views = readdirSync(dir).filter(f => f.endsWith(".raw.json.gz")).map(f => f.replace(".raw.json.gz", "")).sort();
const rows = [];
for (const v of views) {
  const raw = load(v + ".raw.json.gz"), tr = load(v + ".truth.json.gz"), TD = truthD(tr), base = { ...raw, heightIn: tr.height / 0.0254 };
  const AO = process.env.APPOPTS ? JSON.parse(process.env.APPOPTS) : {}, A = analyse(base, { armLib: armLibFor(tr.sp), ...AO }), B = analyse(base, { armLib: armLibFor(tr.sp), ...AO, bodyLib: LIB, bodyFit: true, bodyFitOpts: process.env.FITOPTS ? JSON.parse(process.env.FITOPTS) : {} });
  const r = { v, sp: tr.sp, cam: v.slice(tr.sp.length + 1), hand: tr.hand, app: score(A, tr, TD), fit: score(B, tr, TD) };
  rows.push(r);
  if (perView) console.log(`${v.padEnd(20)} ${r.hand} hand read ${r.app.hand}/${r.fit.hand}  joints ${r.app.joint.toFixed(1)} -> ${r.fit.joint.toFixed(1)} cm  arm ${r.app.arm.toFixed(1)} -> ${r.fit.arm.toFixed(1)}  slot ${r.app.slot.toFixed(1)} -> ${r.fit.slot.toFixed(1)}  stride ${r.app.stride.toFixed(1)} -> ${r.fit.stride.toFixed(1)}  tilt BR ${r.app.tilt?.toFixed(1)} -> ${r.fit.tilt?.toFixed(1)}`);
}
{ const i = process.argv.indexOf("--json"); if (i > 0) (await import("fs")).writeFileSync(process.argv[i + 1], JSON.stringify(rows)) }
const f1 = x => Number.isFinite(x) ? (x >= 0 ? " " : "") + x.toFixed(1) : "  —";
console.log(`\nUnusual deliveries: ${rows.length} views, ${new Set(rows.map(r => r.sp)).size} pitchers. App alone -> with the body fit.`);
console.log("signed errors: + = app reads more than the truth (slot: higher arm; stride: longer, % of height; tilt: glove shoulder higher)\n");
console.log("pitcher  why                                truth slot/stride/tilt   joints cm      arm cm        slot err       stride err     tilt@BR err    angles avg     front knee err");
for (const sp of [...new Set(rows.map(r => r.sp))]) {
  const R = rows.filter(r => r.sp === sp), g = (w, k) => mean(R.map(r => r[w][k])), t = R[0].app;
  const cell = k => `${f1(g("app", k)).padStart(5)} ->${f1(g("fit", k)).padStart(5)}  `;
  console.log(`${sp.padEnd(8)} ${(why[sp] || "").padEnd(34)} ${t.slotT.toFixed(0).padStart(4)}/${t.strideT.toFixed(0).padStart(3)}/${t.tiltT.toFixed(0).padStart(4)}           ${cell("joint")} ${cell("arm")} ${cell("slot")} ${cell("stride")} ${cell("tilt")} ${cell("ang")} ${cell("knee")}`);
}
const all = (w, k, abs) => mean(rows.map(r => abs ? Math.abs(r[w][k]) : r[w][k]));
console.log(`\nall      joints ${all("app", "joint").toFixed(2)} -> ${all("fit", "joint").toFixed(2)} cm, arm ${all("app", "arm").toFixed(2)} -> ${all("fit", "arm").toFixed(2)} cm, angles ${all("app", "ang").toFixed(2)} -> ${all("fit", "ang").toFixed(2)}°`);
console.log(`         |slot| ${all("app", "slot", 1).toFixed(1)} -> ${all("fit", "slot", 1).toFixed(1)}°, |stride| ${all("app", "stride", 1).toFixed(1)} -> ${all("fit", "stride", 1).toFixed(1)}% of height, |tilt at release| ${all("app", "tilt", 1).toFixed(1)} -> ${all("fit", "tilt", 1).toFixed(1)}°`);
console.log(`         hand read wrong: app ${rows.filter(r => r.app.hand !== r.hand).length}, fit ${rows.filter(r => r.fit.hand !== r.hand).length} of ${rows.length}`);
// how much of each pitcher's own difference from the group average a reading keeps (100% = all of it; the fit pulling
// unusual pitchers toward the lab average shows as a low number). Slope of the reading against the truth, over views.
{ const slope = (w, key) => { const R = rows.filter(r => r[w].sgn[key] != null && r.app.tv[key] != null), x = R.map(r => r.app.tv[key]), yv = R.map(r => r.app.tv[key] + r[w].sgn[key]);
    const mx = mean(x), my = mean(yv); let sxy = 0, sxx = 0; x.forEach((v, i) => { sxy += (v - mx) * (yv[i] - my); sxx += (v - mx) ** 2 }); return 100 * sxy / sxx };
  console.log("\nkeeps % of the pitcher's own difference   app FS/MER/BR      fit FS/MER/BR");
  for (const k of ANG) console.log(`${k.padEnd(14)} ${["fs", "mer", "br"].map(e => slope("app", k + "|" + e).toFixed(0).padStart(5)).join(" ")}    ${["fs", "mer", "br"].map(e => slope("fit", k + "|" + e).toFixed(0).padStart(5)).join(" ")}`) 
  const sl = (w, key, tkey) => { const x = rows.map(r => r.app[tkey]), yv = rows.map(r => r.app[tkey] + r[w][key]), mx = mean(x), my = mean(yv); let sxy = 0, sxx = 0; x.forEach((v, i) => { sxy += (v - mx) * (yv[i] - my); sxx += (v - mx) ** 2 }); return (100 * sxy / sxx).toFixed(0) };
  console.log(`arm slot       ${sl("app", "slot", "slotT").padStart(5)}                ${sl("fit", "slot", "slotT").padStart(5)}`);
  console.log(`stride         ${sl("app", "stride", "strideT").padStart(5)}                ${sl("fit", "stride", "strideT").padStart(5)}`) }
// the angle table (absolute, averaged over views) for the readings that matter most
console.log("\nangle error (°)          app FS/MER/BR          fit FS/MER/BR");
for (const k of ANG) console.log(`${k.padEnd(14)} ${["fs", "mer", "br"].map(e => mean(rows.map(r => Math.abs(r.app.sgn[k + "|" + e])))).map(x => x.toFixed(1).padStart(5)).join(" ")}      ${["fs", "mer", "br"].map(e => mean(rows.map(r => Math.abs(r.fit.sgn[k + "|" + e])))).map(x => x.toFixed(1).padStart(5)).join(" ")}`);
