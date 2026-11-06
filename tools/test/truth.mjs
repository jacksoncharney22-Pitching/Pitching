// Motion-capture truth for the accuracy benchmark (tools/test/bench), turned into the same shape analyse() returns,
// so the app's skeleton and the truth go through the same angle code. Shared by bench.mjs and reportcheck.mjs.
import { computeMetrics } from "../../pipeline.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// The app matches the throwing arm to a library of lab throws (armlib.json, loaded by app.js). The benchmark pitches
// come from the same lab, so each one is tested with that pitcher's own throws taken out of the library: the app is
// measured as it runs, without it ever seeing the answer.
let LIB = null;
export function armLibFor(sp) {
  LIB ??= JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../armlib.json"), "utf8"));
  const user = (LIB.pitches.find(p => p.sp === sp) || {}).user;
  return { ...LIB, _dec: undefined, _exclude: new Set(user == null ? [] : [user]) };
}
const MIRROR = {}; [[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],[23,24],[25,26],[27,28],[29,30],[31,32]].forEach(([a, b]) => { MIRROR[a] = b; MIRROR[b] = a });
const mir = j => (j in MIRROR ? MIRROR[j] : j);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null };

// the truth skeleton turned into what buildReport reads, with the same angle code and the same post-processing as
// analyse() (angles on a right-handed copy; layback unwrapped from foot strike to just after release)
export function truthD(tr) {
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

