// Rebuild step 2 feasibility (report only, the app is unchanged): does pulling the app's 3D skeleton onto the space of
// real lab deliveries (bodylib, built by tools/bodylib_build.py) bring it closer to motion capture?
// For every benchmark view: run analyse() as the app does, sample its skeleton at the library's time-warped samples
// (from the app's OWN event frames), find the body's place/turn/size (similarity transform, mirror for lefties) and
// the delivery shape coefficients (with a prior: unusual shapes cost more), alternating, then compare joint error with
// the truth for the app as-is and for the fitted delivery, over the frames the library covers.
//   node tools/test/bodyproj.mjs [pitch] [--2d] [--k 80] [--lam2d 0.3] [--sigma 0.05]
//   --2d: fit the library to the tracker's 2D points with the camera inside the fit (the real step 2 test).
// Uses tools/test/bench/bodylib_holdout.json (the benchmark athletes are not in it).
import { readFileSync, readdirSync } from "fs";
import { gunzipSync } from "zlib";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { analyse } from "../../pipeline.js";
import { armLibFor } from "./truth.mjs";
const here = dirname(fileURLToPath(import.meta.url)), dir = join(here, "bench");
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? +argv[i + 1] : d };
const only = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))) || "";
const SIGMA = arg("--sigma", 0.05), KUSE = arg("--k", 80);
const load = f => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8"));

// ---- the library
const L = JSON.parse(readFileSync(join(dir, "bodylib_holdout.json"), "utf8"));
const b64 = (s, T) => { const b = Buffer.from(s, "base64"); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) };
const MU = Float64Array.from(b64(L.mean, Float32Array)), CI = b64(L.comps, Int16Array), NS = L.ns, NJ = L.joints.length, D = NS * NJ * 3;
const K = Math.min(KUSE, L.k), COMP = []; for (let k = 0; k < K; k++) COMP.push(Float64Array.from({ length: D }, (_, i) => CI[k * D + i] / 32767 * L.sd[k]));
// library joint -> MediaPipe landmark for a right-hander (throwing = right side)
const MP_R = { rear_ankle_jc: 28, rear_knee_jc: 26, rear_hip: 24, lead_ankle_jc: 27, lead_knee_jc: 25, lead_hip: 23,
  shoulder_jc: 12, elbow_jc: 14, wrist_jc: 16, glove_shoulder_jc: 11, glove_elbow_jc: 13, glove_wrist_jc: 15 };
const swap = j => j % 2 ? j + 1 : j - 1;   // 11<->12 etc. (all used landmarks are 11..28)
const USED = L.joints.map((n, j) => [j, MP_R[n]]).filter(([, m]) => m != null);

// canonical sample s -> video frame (piecewise linear between the app's events)
function sampleFrames(ev, fps) {
  const knots = [ev.ll - L.pre * fps, ev.ll, ev.fs, ev.mer, ev.br, ev.br + L.post * fps], out = [];
  L.phases.forEach(([, n], p) => { for (let i = 0; i < n; i++) out.push(knots[p] + (knots[p + 1] - knots[p]) * i / n) });
  return out;
}
const lerpPose = (P, f, j) => { const a = Math.max(0, Math.min(P.length - 1, Math.floor(f))), b = Math.min(P.length - 1, a + 1), w = Math.max(0, Math.min(1, f - a)); return [0, 1, 2].map(k => P[a][j][k] * (1 - w) + P[b][j][k] * w) };

// Umeyama: s,R,t minimising |s R x + t - y|^2 (rows of X,Y are points); reflect: allow a mirror (left-handers)
function similarity(X, Y, reflect) {
  const n = X.length, mx = [0, 0, 0], my = [0, 0, 0];
  X.forEach(p => p.forEach((v, k) => mx[k] += v / n)); Y.forEach(p => p.forEach((v, k) => my[k] += v / n));
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let vx = 0;
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { vx += (X[i][a] - mx[a]) ** 2 / n; for (let b = 0; b < 3; b++) C[a][b] += (Y[i][a] - my[a]) * (X[i][b] - mx[b]) / n }
  const { U, S, V } = svd3(C), dU = det3(U) * det3(V) < 0 ? -1 : 1, d = reflect ? -dU : dU;
  // with reflect the transform must have det -1
  const Dg = [1, 1, d]; const R = [0, 1, 2].map(a => [0, 1, 2].map(b => U[a][0] * Dg[0] * V[b][0] + U[a][1] * Dg[1] * V[b][1] + U[a][2] * Dg[2] * V[b][2]));
  const s = (S[0] + S[1] + d * S[2]) / vx, t = [0, 1, 2].map(a => my[a] - s * (R[a][0] * mx[0] + R[a][1] * mx[1] + R[a][2] * mx[2]));
  return { s, R, t };
}
const det3 = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
function svd3(A) {   // via Jacobi on A^T A
  const AtA = [0, 1, 2].map(i => [0, 1, 2].map(j => A[0][i] * A[0][j] + A[1][i] * A[1][j] + A[2][i] * A[2][j]));
  const { vals, vecs } = jacobi(AtA), ord = [0, 1, 2].sort((a, b) => vals[b] - vals[a]);
  const V = [0, 1, 2].map(r => ord.map(c => vecs[r][c])), S = ord.map(c => Math.sqrt(Math.max(0, vals[c])));
  const U = [0, 1, 2].map(r => [0, 1, 2].map(c => S[c] > 1e-12 ? (A[r][0] * V[0][c] + A[r][1] * V[1][c] + A[r][2] * V[2][c]) / S[c] : 0));
  if (S[2] <= 1e-12) { const u0 = [U[0][0], U[1][0], U[2][0]], u1 = [U[0][1], U[1][1], U[2][1]], c = [u0[1] * u1[2] - u0[2] * u1[1], u0[2] * u1[0] - u0[0] * u1[2], u0[0] * u1[1] - u0[1] * u1[0]]; for (let r = 0; r < 3; r++) U[r][2] = c[r] }
  return { U, S, V };
}
function jacobi(M) {
  const a = M.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[p][q]) < 1e-15) continue;
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk }
    for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq }
  }
  return { vals: [a[0][0], a[1][1], a[2][2]], vecs: v };
}
function solve(A, b) {   // Gaussian elimination, small dense
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] } }
  const x = Array(n).fill(0); for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r] } return x;
}
const recon = c => { const y = Float64Array.from(MU); for (let k = 0; k < K; k++) { const ck = c[k], v = COMP[k]; for (let i = 0; i < D; i++) y[i] += ck * v[i] } return y };
const idx = (s, j) => (s * NJ + j) * 3;

function fitView(Dp, ev, fps, lefty) {
  const sf = sampleFrames(ev, fps);
  const map = USED.map(([j, m]) => [j, lefty ? swap(m) : m]);
  const obs = sf.map(f => map.map(([, m]) => lerpPose(Dp, f, m)));   // NS x nUsed x 3 (app frame, metres)
  let c = new Array(K).fill(0), T;
  for (let it = 0; it < 8; it++) {
    const y = recon(c), X = [], Y = [];
    sf.forEach((_, s) => map.forEach(([j], u) => { X.push([y[idx(s, j)], y[idx(s, j) + 1], y[idx(s, j) + 2]]); Y.push(obs[s][u]) }));
    T = similarity(X, Y, lefty);
    // app points into library frame: x = R^T (y - t) / s
    const z = [];
    sf.forEach((_, s) => map.forEach(([j], u) => { const p = obs[s][u].map((v, k) => v - T.t[k]); for (let a = 0; a < 3; a++) z.push([idx(s, j) + a, (T.R[0][a] * p[0] + T.R[1][a] * p[1] + T.R[2][a] * p[2]) / T.s]) }));
    const A = Array.from({ length: K }, () => new Array(K).fill(0)), b = new Array(K).fill(0), lam = SIGMA * SIGMA;
    for (const [i, v] of z) { const r = v - MU[i]; for (let a = 0; a < K; a++) { const va = COMP[a][i]; b[a] += va * r; for (let q = a; q < K; q++) A[a][q] += va * COMP[q][i] } }
    for (let a = 0; a < K; a++) { A[a][a] += lam; for (let q = 0; q < a; q++) A[a][q] = A[q][a] }
    c = solve(A, b);
  }
  const y = recon(c);
  const fitted = sf.map((_, s) => { const o = {}; map.forEach(([j, m]) => { const p = [y[idx(s, j)], y[idx(s, j) + 1], y[idx(s, j) + 2]]; o[m] = [0, 1, 2].map(a => T.s * (T.R[a][0] * p[0] + T.R[a][1] * p[1] + T.R[a][2] * p[2]) + T.t[a]) }); return o });
  return { sf, fitted, c, scale: T.s };
}

// ---- 2D fit: the library delivery + a scaled-orthographic camera, fitted to the tracker's 2D points directly.
// Alternating linear least squares: for a fixed delivery the camera (2x3 + offset) is linear; for a fixed camera the
// shape coefficients are linear. The camera is kept rigid (rows orthogonal, equal length) after each step. The tracker's
// whole-body left/right swaps are handled per sample by taking whichever labelling fits better. Starts from the 3D fit.
function fit2D(raw, A, ev, height) {
  const lefty = A.throwHand === "L", init = fitView(A.pose, ev, A.fps, lefty), sf = init.sf;
  const map = USED.map(([j, m]) => [j, lefty ? swap(m) : m]), W = raw.width, H = raw.height;
  const img = (f, m) => { const a = Math.max(0, Math.min(raw.frames.length - 1, Math.floor(f))), b = Math.min(raw.frames.length - 1, a + 1), w = f - a;
    const P = raw.frames[a], Q = raw.frames[b] || P; if (!P) return null; return [(P.img[m][0] * (1 - w) + Q.img[m][0] * w) * W, (P.img[m][1] * (1 - w) + Q.img[m][1] * w) * H, Math.min(P.img[m][2] ?? 1, Q.img[m][2] ?? 1)] };
  const obsA = sf.map(f => map.map(([, m]) => img(f, m))), obsB = sf.map(f => map.map(([, m]) => img(f, swap(m))));
  let c = init.c.slice(), cam = null, use = sf.map(() => 0);
  const lib = y => sf.map((_, s) => map.map(([j]) => [y[idx(s, j)], y[idx(s, j) + 1], y[idx(s, j) + 2]]));
  const LAM = arg("--lam2d", 0.3);   // prior weight against pixel residuals (pixels^2 per unit coefficient^2)
  for (let it = 0; it < 15; it++) {
    const X = lib(recon(c));
    // camera: rows r1,r2 (3) + offsets: solve u = r1.x + o1, v = r2.x + o2 by least squares, then make rigid
    const N = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], bu = [0,0,0,0], bv = [0,0,0,0];
    sf.forEach((_, s) => map.forEach((__, u) => { const o = (use[s] ? obsB : obsA)[s][u]; if (!o) return; const x = [...X[s][u], 1], w = o[2];
      for (let a = 0; a < 4; a++) { bu[a] += w * x[a] * o[0]; bv[a] += w * x[a] * o[1]; for (let b = 0; b < 4; b++) N[a][b] += w * x[a] * x[b] } }));
    const p1 = solve(N, bu), p2 = solve(N, bv);
    let r1 = p1.slice(0, 3), r2 = p2.slice(0, 3);
    // nearest scaled rotation rows (SVD of the 2x3), y axis on screen points down
    const n1 = Math.hypot(...r1), n2 = Math.hypot(...r2), sc = (n1 + n2) / 2;
    let a1 = r1.map(v => v / n1), a2 = r2.map(v => v / n2); const d = a1.reduce((s, v, k) => s + v * a2[k], 0);
    const b1 = a1.map((v, k) => v - d / 2 * a2[k]), b2 = a2.map((v, k) => v - d / 2 * a1[k]), m1 = Math.hypot(...b1), m2 = Math.hypot(...b2);
    r1 = b1.map(v => v / m1 * sc); r2 = b2.map(v => v / m2 * sc);
    cam = { r1, r2, o: [p1[3], p2[3]] };
    // left/right labelling per sample
    const proj = x => [r1[0] * x[0] + r1[1] * x[1] + r1[2] * x[2] + cam.o[0], r2[0] * x[0] + r2[1] * x[1] + r2[2] * x[2] + cam.o[1]];
    use = sf.map((_, s) => { const e = O => map.reduce((t, __, u) => { const o = O[s][u]; if (!o) return t; const p = proj(X[s][u]); return t + o[2] * Math.min(((p[0] - o[0]) ** 2 + (p[1] - o[1]) ** 2), (0.08 * H) ** 2) }, 0); return e(obsB) < 0.7 * e(obsA) ? 1 : 0 });
    // shape: residual o - proj(mu) = sum_k c_k * P(comp_k)  (linear), prior LAM * |c|^2
    const Am = Array.from({ length: K }, () => new Array(K).fill(0)), b = new Array(K).fill(0);
    const rows = [];
    sf.forEach((_, s) => map.forEach(([j], u) => { const o = (use[s] ? obsB : obsA)[s][u]; if (!o) return; const i = idx(s, j);
      for (const [r, off, ob] of [[r1, cam.o[0], o[0]], [r2, cam.o[1], o[1]]]) {
        const pm = r[0] * MU[i] + r[1] * MU[i + 1] + r[2] * MU[i + 2] + off, ak = COMP.map(v => r[0] * v[i] + r[1] * v[i + 1] + r[2] * v[i + 2]);
        let res = ob - pm; const cur = ak.reduce((t, v, k) => t + v * c[k], 0), e = res - cur, hub = 0.04 * H, w = o[2] * (Math.abs(e) < hub ? 1 : hub / Math.abs(e));   // Huber: bad frames count less
        for (let a = 0; a < K; a++) { b[a] += w * ak[a] * res; for (let q = a; q < K; q++) Am[a][q] += w * ak[a] * ak[q] } } }));
    const pxPerBody = sc;   // pixels per body height: the prior is in body-height units so it scales with the picture
    for (let a = 0; a < K; a++) { Am[a][a] += LAM * pxPerBody * pxPerBody * 0.0025; for (let q = 0; q < a; q++) Am[a][q] = Am[q][a] }
    c = solve(Am, b);
  }
  // back to metres in a frame with y up: rotate library (x plate, y side, z up) so up = y; the evaluation aligns the
  // rotation about the vertical separately, so only height scaling matters here
  const y = recon(c);
  const fitted = sf.map((_, s) => { const o = {}; map.forEach(([j, m]) => { const p = [y[idx(s, j)], y[idx(s, j) + 1], y[idx(s, j) + 2]]; o[m] = [p[0] * height, p[2] * height, (lefty ? 1 : -1) * p[1] * height] }); return o });
  return { sf, fitted, c, scale: 1, rotAlign: true };
}

// best rotation about the vertical (y) taking hip-centred points A onto B (lists of [x,y,z])
function yawAlign(Apts, Bpts) { let sxx = 0, sxz = 0; for (let i = 0; i < Apts.length; i++) { const a = Apts[i], b = Bpts[i]; sxx += a[0] * b[0] + a[2] * b[2]; sxz += a[0] * b[2] - a[2] * b[0] } const th = Math.atan2(sxz, sxx), c = Math.cos(th), s = Math.sin(th); return p => [c * p[0] - s * p[2], p[1], s * p[0] + c * p[2]] }

const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const views = readdirSync(dir).filter(f => f.endsWith(".raw.json.gz") && f.startsWith(only)).map(f => f.replace(".raw.json.gz", "")).sort();
const res = [];
for (const v of views) {
  const raw = load(v + ".raw.json.gz"), tr = load(v + ".truth.json.gz");
  const A = analyse({ ...raw, heightIn: tr.height / 0.0254 }, { armLib: armLibFor(tr.sp) });
  const ph = n => (A.phases.find(p => p.name === n) || {}).frame;
  const ev = { ll: ph("Peak leg lift"), fs: ph("Foot strike"), mer: ph("Arm cocked"), br: ph("Release") };
  if (ev.ll == null || ev.ll <= 0) { res.push({ v, skip: "no leg lift" }); continue }
  const F = argv.includes("--2d") ? fit2D(raw, A, ev, tr.height) : fitView(A.pose, ev, A.fps, A.throwHand === "L");
  // compare at whole video frames inside the window: fitted pose interpolated between samples
  const hip = F2 => [0, 1, 2].map(k => (F2[23][k] + F2[24][k]) / 2);
  let ea = 0, ef = 0, n = 0, aa = 0, af = 0, an = 0; const FR = [], AR = [], TR = [], FT = [];
  const arm = A.throwHand === "L" ? [11, 13, 15] : [12, 14, 16];
  const T = Math.min(A.pose.length, tr.P.length);
  for (let t = Math.ceil(F.sf[0]); t <= Math.floor(F.sf[NS - 1]) && t < T; t++) {
    if (t < 0) continue;
    let s = 0; while (s < NS - 2 && F.sf[s + 1] <= t) s++;
    const w = Math.max(0, Math.min(1, (t - F.sf[s]) / (F.sf[s + 1] - F.sf[s])));
    const fp = {}; for (const j of JOINTS) fp[j] = [0, 1, 2].map(k => F.fitted[s][j][k] * (1 - w) + F.fitted[s + 1][j][k] * w);
    if (F.rotAlign) { FR.push(...JOINTS.map(j => fp[j].map((v, k) => v - hip(fp)[k]))); AR.push(...JOINTS.map(j => A.pose[t][j].map((v, k) => v - hip(A.pose[t])[k]))); TR.push(...JOINTS.map(j => tr.P[t][j].map((v, k) => v - hip(tr.P[t])[k]))); FT.push([t, fp]) }
    const B = tr.P[t], hb = hip(B), ha = hip(A.pose[t]), hf = hip(fp);
    for (const j of JOINTS) {
      const e1 = Math.hypot(...[0, 1, 2].map(k => (A.pose[t][j][k] - ha[k]) - (B[j][k] - hb[k])));
      const e2 = Math.hypot(...[0, 1, 2].map(k => (fp[j][k] - hf[k]) - (B[j][k] - hb[k])));
      ea += e1; ef += e2; n++;
      if (t >= tr.events.fs && t <= tr.events.br && arm.includes(j)) { aa += e1; af += e2; an++ }
    }
  }
  if (F.rotAlign) {   // the 2D fit has no world frame of its own: compare both after the best turn about the vertical
    const rf = yawAlign(FR, TR), ra = yawAlign(AR, TR); ea = ef = aa = af = 0;
    for (let i = 0; i < FR.length; i++) { const f = rf(FR[i]), a = ra(AR[i]), b = TR[i]; ef += Math.hypot(f[0] - b[0], f[1] - b[1], f[2] - b[2]); ea += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const t = FT[Math.floor(i / JOINTS.length)][0], j = JOINTS[i % JOINTS.length]; if (t >= tr.events.fs && t <= tr.events.br && arm.includes(j)) { af += Math.hypot(f[0] - b[0], f[1] - b[1], f[2] - b[2]); aa += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) } }
  }
  const cn = Math.hypot(...F.c);
  res.push({ v, app: 100 * ea / n, fit: 100 * ef / n, appArm: 100 * aa / an, fitArm: 100 * af / an, cn });
  console.log(`${v.padEnd(22)} joints ${(100 * ea / n).toFixed(1)} -> ${(100 * ef / n).toFixed(1)} cm   throwing arm FS-BR ${(100 * aa / an).toFixed(1)} -> ${(100 * af / an).toFixed(1)} cm   shape size ${cn.toFixed(1)}`);
}
const ok = res.filter(r => !r.skip), m = k => ok.reduce((s, r) => s + r[k], 0) / ok.length;
console.log(`\n${ok.length} views (${res.length - ok.length} skipped)   joints ${m("app").toFixed(2)} -> ${m("fit").toFixed(2)} cm   throwing arm ${m("appArm").toFixed(2)} -> ${m("fitArm").toFixed(2)} cm   (K ${K}, sigma ${SIGMA})`);
const byAngle = {}; ok.forEach(r => { const a = r.v.replace(/^\d+_\d+_/, ""); (byAngle[a] ??= []).push(r) });
for (const [a, R] of Object.entries(byAngle)) console.log(`  ${a.padEnd(10)} joints ${(R.reduce((s, r) => s + r.app, 0) / R.length).toFixed(1)} -> ${(R.reduce((s, r) => s + r.fit, 0) / R.length).toFixed(1)}   arm ${(R.reduce((s, r) => s + r.appArm, 0) / R.length).toFixed(1)} -> ${(R.reduce((s, r) => s + r.fitArm, 0) / R.length).toFixed(1)}`);
