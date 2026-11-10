// Whole-body fit to real lab deliveries (the "pitching-aware rebuild", step 2). No DOM; runs in Node too.
// The library (bodylib.json, built by tools/bodylib_build.py from 366 lab deliveries) describes a delivery as an average
// plus 80 typical ways deliveries differ. Here that delivery, together with the camera, is fitted to the tracker's own 2D
// points from leg lift (minus 0.25 s) to just after release, timed by the app's own events. Where the camera can't tell
// how far a joint is from it, the fit picks what real pitchers do. On the 60 lab views (tools/test/bodyproj.mjs) this put
// the joints 8.7 -> 6.0 cm from motion capture and every body angle closer except the pelvis late in the delivery.
// The throwing and glove arms are NOT taken from the fit (the app's lab-throw arm match is better): they keep their
// place in the trunk's own axes and hang on the fitted shoulders, so elbow, layback and abduction read as before.
// Same maths as tools/test/bodyproj.mjs fit2D (alternating least squares, scaled-orthographic camera, per-sample
// whole-body left/right relabelling, Huber on bad points, hips count 4x, prior 0.6).

const MP_R = { rear_ankle_jc: 28, rear_knee_jc: 26, rear_hip: 24, lead_ankle_jc: 27, lead_knee_jc: 25, lead_hip: 23,
  shoulder_jc: 12, elbow_jc: 14, wrist_jc: 16, glove_shoulder_jc: 11, glove_elbow_jc: 13, glove_wrist_jc: 15 };
const swap = j => j % 2 ? j + 1 : j - 1;   // 11<->12 etc. (all used landmarks are 11..28)
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

function b64(s, T) {
  let bytes;
  if (typeof Buffer !== "undefined") { const b = Buffer.from(s, "base64"); bytes = new Uint8Array(b.buffer, b.byteOffset, b.length).slice() }
  else { const bin = atob(s); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) }
  return new T(bytes.buffer);
}
// decoded once per library object
function prep(L, Kuse) {
  if (L._prep && L._prep.Kuse === Kuse) return L._prep;
  const MU = Float64Array.from(b64(L.mean, Float32Array)), CI = b64(L.comps, Int16Array), NS = L.ns, NJ = L.joints.length, D = NS * NJ * 3;
  const K = Math.min(Kuse, L.k), COMP = [];
  for (let k = 0; k < K; k++) { const v = new Float64Array(D), s = L.sd[k] / 32767; for (let i = 0; i < D; i++) v[i] = CI[k * D + i] * s; COMP.push(v) }
  const USED = L.joints.map((n, j) => [j, MP_R[n]]).filter(([, m]) => m != null);
  Object.defineProperty(L, "_prep", { value: { Kuse, MU, COMP, NS, NJ, D, K, USED }, enumerable: false, configurable: true, writable: true });
  return L._prep;
}

const det3 = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
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
function svd3(A) {
  const AtA = [0, 1, 2].map(i => [0, 1, 2].map(j => A[0][i] * A[0][j] + A[1][i] * A[1][j] + A[2][i] * A[2][j]));
  const { vals, vecs } = jacobi(AtA), ord = [0, 1, 2].sort((a, b) => vals[b] - vals[a]);
  const V = [0, 1, 2].map(r => ord.map(c => vecs[r][c])), S = ord.map(c => Math.sqrt(Math.max(0, vals[c])));
  const U = [0, 1, 2].map(r => [0, 1, 2].map(c => S[c] > 1e-12 ? (A[r][0] * V[0][c] + A[r][1] * V[1][c] + A[r][2] * V[2][c]) / S[c] : 0));
  if (S[2] <= 1e-12) { const u0 = [U[0][0], U[1][0], U[2][0]], u1 = [U[0][1], U[1][1], U[2][1]], c = [u0[1] * u1[2] - u0[2] * u1[1], u0[2] * u1[0] - u0[0] * u1[2], u0[0] * u1[1] - u0[1] * u1[0]]; for (let r = 0; r < 3; r++) U[r][2] = c[r] }
  return { U, S, V };
}
// s,R,t minimising |s R x + t - y|^2; reflect: the transform must mirror (left-handers)
function similarity(X, Y, reflect) {
  const n = X.length, mx = [0, 0, 0], my = [0, 0, 0];
  X.forEach(p => p.forEach((v, k) => mx[k] += v / n)); Y.forEach(p => p.forEach((v, k) => my[k] += v / n));
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let vx = 0;
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { vx += (X[i][a] - mx[a]) ** 2 / n; for (let b = 0; b < 3; b++) C[a][b] += (Y[i][a] - my[a]) * (X[i][b] - mx[b]) / n }
  const { U, S, V } = svd3(C), dU = det3(U) * det3(V) < 0 ? -1 : 1, d = reflect ? -dU : dU;
  const Dg = [1, 1, d], R = [0, 1, 2].map(a => [0, 1, 2].map(b => U[a][0] * Dg[0] * V[b][0] + U[a][1] * Dg[1] * V[b][1] + U[a][2] * Dg[2] * V[b][2]));
  const s = (S[0] + S[1] + d * S[2]) / vx, t = [0, 1, 2].map(a => my[a] - s * (R[a][0] * mx[0] + R[a][1] * mx[1] + R[a][2] * mx[2]));
  return { s, R, t };
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) M[c][c] = 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] } }
  const x = Array(n).fill(0); for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r] } return x;
}
const unit = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n) }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hipOf = F => [0, 1, 2].map(k => (F[23][k] + F[24][k]) / 2);
function trunkAxes(F) { const ms = [0, 1, 2].map(k => (F[11][k] + F[12][k]) / 2), mh = hipOf(F);
  const up = unit(ms.map((v, k) => v - mh[k])), r0 = F[12].map((v, k) => v - F[11][k]), fw = unit(cross(up, r0)), r = cross(fw, up); return [r, up, fw] }
// best turn about the vertical taking hip-centred points A onto B
function yawAlign(A, B) { let sxx = 0, sxz = 0; for (let i = 0; i < A.length; i++) { const a = A[i], b = B[i]; sxx += a[0] * b[0] + a[2] * b[2]; sxz += a[0] * b[2] - a[2] * b[0] } const th = Math.atan2(sxz, sxx), c = Math.cos(th), s = Math.sin(th); return p => [c * p[0] - s * p[2], p[1], s * p[0] + c * p[2]] }

// D: analyse() output (pose in display handedness); raw: the tracker output it was analysed from.
// Returns a new pose (same length) or null when the clip can't be fitted (no leg lift in the clip, frames don't line up).
const LLGAP = 0.53, MINLEAD = 0.45;   // s, typical peak leg lift to foot strike (lab and benchmark median)
export function bodyFit(raw, D, L, opts = {}) {
  const ph = n => (D.phases.find(p => p.name === n) || {}).frame;
  const ev = { ll: ph("Peak leg lift"), fs: ph("Foot strike"), mer: ph("Arm cocked"), br: ph("Release") };
  const fps = D.fps, A = D.pose, T = A.length;
  // A clip started at or after peak leg lift reads leg lift at frame 0. The leg lift is then placed a typical lab
  // leg-lift-to-foot-strike time before foot strike (or at frame 0 if that's later), and library samples that fall
  // before the first frame simply have no picture to fit: the rest of the delivery decides their shape.
  // Started well after the leg lift (foot strike under MINLEAD s into the clip), the fit made the front knee and
  // separation worse on the lab views (cut 1/6 s after leg lift: front knee 7.5/7.5/8.1 -> 8.5/10.5/13.5 deg), so not then.
  if (L && !(ev.ll > 0) && ev.fs > 0) { if (ev.fs < (opts.minLead ?? MINLEAD) * D.fps) return null; ev.ll = Math.min(0, ev.fs - (opts.llGap ?? LLGAP) * D.fps) }
  if (!L || !(ev.ll <= ev.fs) || ev.fs == null || ev.mer == null || ev.br == null || !(ev.ll < ev.fs && ev.fs < ev.mer && ev.mer < ev.br)) return null;
  if (!raw || !raw.frames || raw.frames.length !== T || !raw.width || !raw.height) return null;
  const { MU, COMP, NS, NJ, K, USED } = prep(L, opts.k ?? 80), idx = (s, j) => (s * NJ + j) * 3;
  const knots = [ev.ll - L.pre * fps, ev.ll, ev.fs, ev.mer, ev.br, ev.br + L.post * fps], sf = [];
  L.phases.forEach(([, n], p) => { for (let i = 0; i < n; i++) sf.push(knots[p] + (knots[p + 1] - knots[p]) * i / n) });
  const lefty = D.throwHand === "L", map = USED.map(([j, m]) => [j, lefty ? swap(m) : m]);
  const recon = c => { const y = Float64Array.from(MU); for (let k = 0; k < K; k++) { const ck = c[k], v = COMP[k]; if (ck) for (let i = 0; i < y.length; i++) y[i] += ck * v[i] } return y };
  const lerpPose = (f, j) => { if (f < 0) return null; const a = Math.max(0, Math.min(T - 1, Math.floor(f))), b = Math.min(T - 1, a + 1), w = Math.max(0, Math.min(1, f - a)); return [0, 1, 2].map(k => A[a][j][k] * (1 - w) + A[b][j][k] * w) };

  // 1. starting point: the library delivery closest to the app's own 3D skeleton
  let c = new Array(K).fill(0);
  { const obs = sf.map(f => map.map(([, m]) => lerpPose(f, m))), lam = 0.05 * 0.05;
    for (let it = 0; it < 8; it++) {
      const y = recon(c), X = [], Y = [];
      sf.forEach((_, s) => map.forEach(([j], u) => { if (!obs[s][u]) return; X.push([y[idx(s, j)], y[idx(s, j) + 1], y[idx(s, j) + 2]]); Y.push(obs[s][u]) }));
      const Tr = similarity(X, Y, lefty);
      const Am = Array.from({ length: K }, () => new Array(K).fill(0)), b = new Array(K).fill(0);
      sf.forEach((_, s) => map.forEach(([j], u) => { if (!obs[s][u]) return; const p = obs[s][u].map((v, k) => v - Tr.t[k]);
        for (let a = 0; a < 3; a++) { const i = idx(s, j) + a, r = (Tr.R[0][a] * p[0] + Tr.R[1][a] * p[1] + Tr.R[2][a] * p[2]) / Tr.s - MU[i];
          for (let q = 0; q < K; q++) { const vq = COMP[q][i]; b[q] += vq * r; for (let q2 = q; q2 < K; q2++) Am[q][q2] += vq * COMP[q2][i] } } }));
      for (let a = 0; a < K; a++) { Am[a][a] += lam; for (let q = 0; q < a; q++) Am[a][q] = Am[q][a] }
      c = solve(Am, b);
    }
  }

  // 2. the delivery and a scaled-orthographic camera fitted to the tracker's 2D points
  const W = raw.width, H = raw.height, fr = raw.frames;
  const ok = f => f && f.img && f.img.length === 33 && f.img.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  // the tracker's point at a fractional frame, interpolated between the nearest tracked frames on either side (up to 3
  // frames away): slow-motion clips can have empty frames between tracked ones (Hackimer: 1 in 3)
  const near = (f, d) => { for (let a = d < 0 ? Math.floor(f) : Math.ceil(f), n = 0; n <= 3 && a >= 0 && a < T; a += d, n++) if (ok(fr[a])) return a; return -1 };
  const img = (f, m) => { if (f < 0) return null; f = Math.min(f, T - 1); const a0 = near(f, -1), b0 = near(f, 1); if (a0 < 0 && b0 < 0) return null;
    const a = a0 < 0 ? b0 : a0, b = b0 < 0 ? a : b0, w = b > a ? (f - a) / (b - a) : 0, P = fr[a], Q = fr[b];
    return [(P.img[m][0] * (1 - w) + Q.img[m][0] * w) * W, (P.img[m][1] * (1 - w) + Q.img[m][1] * w) * H, Math.min(P.img[m][2] ?? 1, Q.img[m][2] ?? 1)] };
  const obsA = sf.map(f => map.map(([, m]) => img(f, m))), obsB = sf.map(f => map.map(([, m]) => img(f, swap(m))));
  if (obsA.filter(r => r.some(Boolean)).length < NS * 0.7) return null;
  const HIPW = opts.hipw ?? 4, JW = map.map(([j]) => /hip/.test(L.joints[j]) ? HIPW : 1), LAM = opts.lam ?? 0.6;
  const lib = y => sf.map((_, s) => map.map(([j]) => [y[idx(s, j)], y[idx(s, j) + 1], y[idx(s, j) + 2]]));
  let use = sf.map(() => 0);
  for (let it = 0; it < 15; it++) {
    const X = lib(recon(c));
    const N = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], bu = [0, 0, 0, 0], bv = [0, 0, 0, 0];
    sf.forEach((_, s) => map.forEach((__, u) => { const o = (use[s] ? obsB : obsA)[s][u]; if (!o) return; const x = [...X[s][u], 1], w = o[2] * JW[u];
      for (let a = 0; a < 4; a++) { bu[a] += w * x[a] * o[0]; bv[a] += w * x[a] * o[1]; for (let b = 0; b < 4; b++) N[a][b] += w * x[a] * x[b] } }));
    const p1 = solve(N, bu), p2 = solve(N, bv);
    let r1 = p1.slice(0, 3), r2 = p2.slice(0, 3);
    const n1 = Math.hypot(...r1), n2 = Math.hypot(...r2), sc = (n1 + n2) / 2;
    const a1 = r1.map(v => v / n1), a2 = r2.map(v => v / n2), d = a1.reduce((s, v, k) => s + v * a2[k], 0);
    const b1 = a1.map((v, k) => v - d / 2 * a2[k]), b2 = a2.map((v, k) => v - d / 2 * a1[k]), m1 = Math.hypot(...b1), m2 = Math.hypot(...b2);
    r1 = b1.map(v => v / m1 * sc); r2 = b2.map(v => v / m2 * sc);
    const o = [p1[3], p2[3]];
    const proj = x => [r1[0] * x[0] + r1[1] * x[1] + r1[2] * x[2] + o[0], r2[0] * x[0] + r2[1] * x[1] + r2[2] * x[2] + o[1]];
    use = sf.map((_, s) => { const e = O => map.reduce((t, __, u) => { const q = O[s][u]; if (!q) return t; const p = proj(X[s][u]); return t + q[2] * Math.min((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2, (0.08 * H) ** 2) }, 0); return e(obsB) < 0.7 * e(obsA) ? 1 : 0 });
    const Am = Array.from({ length: K }, () => new Array(K).fill(0)), b = new Array(K).fill(0), ak = new Float64Array(K), hub = 0.04 * H;
    sf.forEach((_, s) => map.forEach(([j], u) => { const q = (use[s] ? obsB : obsA)[s][u]; if (!q) return; const i = idx(s, j);
      for (const [r, off, ob] of [[r1, o[0], q[0]], [r2, o[1], q[1]]]) {
        const pm = r[0] * MU[i] + r[1] * MU[i + 1] + r[2] * MU[i + 2] + off; let cur = 0;
        for (let k = 0; k < K; k++) { const v = COMP[k]; ak[k] = r[0] * v[i] + r[1] * v[i + 1] + r[2] * v[i + 2]; cur += ak[k] * c[k] }
        const res = ob - pm, e = res - cur, w = q[2] * JW[u] * (Math.abs(e) < hub ? 1 : hub / Math.abs(e));
        for (let a = 0; a < K; a++) { const wa = w * ak[a]; if (!wa) continue; b[a] += wa * res; for (let q2 = a; q2 < K; q2++) Am[a][q2] += wa * ak[q2] } } }));
    for (let a = 0; a < K; a++) { Am[a][a] += LAM * sc * sc * 0.0025; for (let q = 0; q < a; q++) Am[a][q] = Am[q][a] }
    c = solve(Am, b);
    if (c.some(v => !Number.isFinite(v))) return null;
  }

  // 3. into the app's world: metres (library is in body heights, x plate, y side, z up), turned about the vertical onto
  // the app's own skeleton (no truth involved), centred on the app's hips frame by frame
  const height = D.bodyH || 1.85, y = recon(c);
  const fitted = sf.map((_, s) => { const o = {}; map.forEach(([j, m]) => { const p = [y[idx(s, j)], y[idx(s, j) + 1], y[idx(s, j) + 2]]; o[m] = [p[0] * height, p[2] * height, (lefty ? 1 : -1) * p[1] * height] }); return o });
  const t0 = Math.max(0, Math.ceil(sf[0])), t1 = Math.min(T - 1, Math.floor(sf[NS - 1]));
  if (t1 - t0 < 10) return null;
  const FR = [], AR = [], FT = [];
  for (let t = t0; t <= t1; t++) {
    let s = 0; while (s < NS - 2 && sf[s + 1] <= t) s++;
    const w = Math.max(0, Math.min(1, (t - sf[s]) / (sf[s + 1] - sf[s])));
    const fp = {}; for (const j of JOINTS) fp[j] = [0, 1, 2].map(k => fitted[s][j][k] * (1 - w) + fitted[s + 1][j][k] * w);
    const hf = hipOf(fp), ha = hipOf(A[t]);
    FR.push(...JOINTS.map(j => fp[j].map((v, k) => v - hf[k]))); AR.push(...JOINTS.map(j => A[t][j].map((v, k) => v - ha[k]))); FT.push(t);
  }
  const rot = yawAlign(FR, AR), P = A.map(F => F.map(p => p.slice()));
  // Outside the window the fit's last offset from the app's skeleton is carried on and faded out over 0.25 s (a fade
  // inside the window made the glove hand and front foot jump at its edges: 1.6 -> 6.2 jumps per lab view)
  const target0 = (q, u, t) => rot(FR[q * JOINTS.length + u]).map((v, k) => v + hipOf(A[t])[k]);
  // the fit's offset from the app's skeleton, lightly smoothed over time (opts.smooth passes of 1-2-1): the time-warped
  // samples meet at the events with small kinks in speed
  const DL = FT.map((t, q) => JOINTS.map((j, u) => target0(q, u, t).map((v, k) => v - A[t][j][k])));
  for (let pass = 0; pass < (opts.smooth ?? 3); pass++) { const C = DL.map(r => r.map(p => p.slice()));
    for (let q = 1; q < DL.length - 1; q++) for (let u = 0; u < JOINTS.length; u++) for (let k = 0; k < 3; k++) DL[q][u][k] = (C[q - 1][u][k] + 2 * C[q][u][k] + C[q + 1][u][k]) / 4 }
  const target = (q, u, t) => A[t][JOINTS[u]].map((v, k) => v + DL[q][u][k]);
  const edge = q => JOINTS.map((j, u) => target(q, u, FT[q]).map((v, k) => v - A[FT[q]][j][k]));
  const d0 = edge(0), d1 = edge(FT.length - 1), out = Math.max(2, Math.round((opts.fadeOut ?? 0.25) * fps)), FOLLOW = { 27: [29, 31], 28: [30, 32] };
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) };
  for (let t = Math.max(0, t0 - out); t <= Math.min(T - 1, t1 + out); t++) {
    const q = t - t0, inside = t >= t0 && t <= t1, w = inside ? 1 : t < t0 ? sm(1 - (t0 - t) / out) : sm(1 - (t - t1) / out);
    if (w <= 0) continue;
    for (const [u, j] of JOINTS.entries()) { if (j === 13 || j === 14 || j === 15 || j === 16) continue;
      const f = inside ? target(q, u, t) : A[t][j].map((v, k) => v + (t < t0 ? d0 : d1)[u][k]), p = A[t][j].map((v, k) => v * (1 - w) + f[k] * w), d = p.map((v, k) => v - A[t][j][k]);
      P[t][j] = p; for (const g of FOLLOW[j] || []) P[t][g] = A[t][g].map((v, k) => v + d[k]) }
    // pelvis direction: part-way back to the app's own hip line (opts.pelvisMix; the fit's pelvis over-turns from side-on
    // cameras late, the app's hip turn was tuned for that). Only the hip points turn, about their midpoint.
    const pm = (opts.pelvisMix ?? 0.4) * w * (t >= ev.fs ? 1 : (opts.pelvisMixPre ?? 1));
    if (pm) { const yaw = F => Math.atan2(F[24][2] - F[23][2], F[24][0] - F[23][0]);
      let d = yaw(A[t]) - yaw(P[t]); d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; const th = d * pm, cs = Math.cos(th), sn = Math.sin(th), m = hipOf(P[t]);
      for (const j of [23, 24]) { const dx = P[t][j][0] - m[0], dz = P[t][j][2] - m[2]; P[t][j] = [m[0] + cs * dx - sn * dz, P[t][j][1], m[2] + sn * dx + cs * dz] } }
    // the arms keep their place in the trunk's own axes (the app's arm reading), hung on the fitted shoulders
    const Fa = trunkAxes(A[t]), Ff = trunkAxes(P[t]);
    const tr = v => { const cc = Fa.map(ax => ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2]); return [0, 1, 2].map(k => Ff[0][k] * cc[0] + Ff[1][k] * cc[1] + Ff[2][k] * cc[2]) };
    // the glove arm (opts.gloveAxes off) only moves with its shoulder: turned with the trunk its long lever made the glove hand jump
    const th = D.throwHand === "L" ? 11 : 12, gl = th === 11 ? 12 : 11, GA = { 11: [13, 15, 17, 19, 21], 12: [14, 16, 18, 20, 22] };
    if (!opts.gloveAxes) for (const j of GA[gl]) P[t][j] = A[t][j].map((v, k) => v + P[t][gl][k] - A[t][gl][k]);
    if (opts.armWorld) for (const j of GA[th]) P[t][j] = A[t][j].map((v, k) => v + P[t][th][k] - A[t][th][k]);
    for (const [sh, ...rest] of [[11, ...GA[11]], [12, ...GA[12]]]) if ((sh === th && !opts.armWorld) || (sh === gl && opts.gloveAxes)) for (const j of rest) { const dd = tr(A[t][j].map((v, k) => v - A[t][sh][k])); P[t][j] = P[t][sh].map((v, k) => v + dd[k]) }
    // the head goes with the shoulders
    const ms = [0, 1, 2].map(k => (P[t][11][k] + P[t][12][k] - A[t][11][k] - A[t][12][k]) / 2);
    for (let j = 0; j <= 10; j++) P[t][j] = A[t][j].map((v, k) => v + ms[k]);
  }
  if (P.some(F => F.some(p => p.some(v => !Number.isFinite(v))))) return null;
  return { pose: P, window: [t0, t1], coef: c };
}
