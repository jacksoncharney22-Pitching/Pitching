// JP Pitching: combining several camera angles of the same pitch into one measured 3D skeleton (no DOM; testable in node).
//
// Each view comes from the normal tracking: per frame, 2D joints on that video (img, 0..1) and the tracker's own
// rough 3D guess (world, metres, hip-centred, in that camera's axes: x right, y down, z away from the camera).
//
//  1. sync      line the videos up in time from the pitch itself: the body's 3D joint speed is the same whichever
//               way a camera faces, so the speed curves are cross-correlated (sub-frame) and each view resampled
//               onto the main view's frame times.
//  2. cameras   where each camera stood relative to the main one: a first guess from aligning the tracker's 3D
//               guesses (Kabsch over every joint and frame), then refined against the 2D joints themselves.
//  3. measure   every joint is placed where the camera views agree (least squares on each view's screen
//               position, weak-perspective cameras), so depth is measured, not guessed. Hip travel likewise.
//
// Output: a "raw" object the normal pipeline accepts, in the main camera's axes, flagged measured: true.

const J_BODY = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 };
const mmul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
const mvec = (A, v) => A.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const tr = A => A[0].map((_, j) => A.map(r => r[j]));
const hipOf = F => [0, 1, 2].map(k => (F[23][k] + F[24][k]) / 2);

// ---- 3x3 SVD-free Kabsch: rotation R minimising sum w |R a - b|^2 (Horn's quaternion method)
function kabsch(pairs) {
  let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [a, b, w] of pairs) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += w * a[i] * b[j];
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S;
  const N = [[Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx], [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
             [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy], [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]];
  // largest eigenvector of the symmetric 4x4 by shifted power iteration
  const shift = Math.abs(N.flat().reduce((a, b) => Math.max(a, Math.abs(b)), 0)) * 4 + 1e-9;
  let q = [1, 0.01, 0.01, 0.01];
  for (let it = 0; it < 200; it++) {
    const n = N.map((r, i) => r.reduce((s, v, j) => s + v * q[j], 0) + shift * q[i]);
    const l = Math.hypot(...n); q = n.map(v => v / l);
  }
  const [w, x, y, z] = q;
  return [[w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
          [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
          [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z]];
}

// ---- 1. sync: body speed curve per view (camera-independent), cross-correlated with the main view
function speedCurve(v) {
  // on-screen joint speed in body-heights per second: clean (no depth guessing), and its peaks (leg lift, stride,
  // the arm whip) happen at the same moments from any angle, even though the sizes differ
  const T = v.frames.length, s = new Array(T).fill(NaN), W = v.width, H = v.height;
  const size = med(v.frames.filter(Boolean).map(f => { const ys = J_BODY.map(j => f.img[j][1] * H); return Math.max(...ys) - Math.min(...ys) })) || H / 2;
  for (let t = 1; t < T; t++) {
    const a = v.frames[t], b = v.frames[t - 1]; if (!a || !b) continue;
    let sum = 0; for (const j of J_BODY) sum += Math.hypot((a.img[j][0] - b.img[j][0]) * W, (a.img[j][1] - b.img[j][1]) * H);
    s[t] = sum / size * v.fps;
  }
  const r = Math.max(1, Math.round(v.fps / 30));
  return s.map((_, t) => { let a = 0, n = 0; for (let k = -r; k <= r; k++) { const x = s[t + k]; if (Number.isFinite(x)) { a += x; n++ } } return n ? Math.log1p(a / n) : NaN });
}
function sampleCurve(c, fps, time) { const x = time * fps, i = Math.floor(x), u = x - i; if (i < 0 || i + 1 >= c.length) return NaN; const a = c[i], b = c[i + 1]; return Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * u : NaN }
export function findOffset(main, other, { center = null, range = null } = {}) {
  // other's time = main's time + offset (seconds). Search on a 1/240 s grid (optionally only near a known guess),
  // then a parabola through the best.
  const cm = speedCurve(main), co = speedCurve(other), dur = main.frames.length / main.fps, durO = other.frames.length / other.fps;
  const step = 1 / 240, score = off => {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let t = 0; t < dur; t += 1 / main.fps) {
      const a = sampleCurve(cm, main.fps, t), b = sampleCurve(co, other.fps, t + off);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++;
    }
    if (n < 0.4 * main.frames.length) return -1;
    const cov = sab / n - sa * sb / n / n, va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
    return cov / Math.sqrt(Math.max(va * vb, 1e-12));
  };
  let best = -2, bo = 0;
  const lo = center != null ? center - range : -dur * 0.8, hi = center != null ? center + range : durO;
  for (let off = lo; off <= hi; off += step) { const s = score(off); if (s > best) { best = s; bo = off } }
  const s0 = score(bo - step), s2 = score(bo + step), den = s0 - 2 * best + s2;
  const refine = den < 0 ? 0.5 * (s0 - s2) / den * step : 0;
  return { offset: bo + refine, confidence: best };
}
// Same pitch? Every camera sees the same up-and-down positions at the same moment (when the knee is highest it is
// highest in every video), whichever way the camera faces. Two different pitches can't line up like that.
// Returns the median gap in each joint's height above the hips, as a share of body height (same pitch: about 1-4%).
export function verticalMismatch(main, other, offset) {
  const J = [0, 13, 14, 15, 16, 25, 26, 27, 28], diffs = [];
  const size = v => med(v.frames.filter(Boolean).map(f => { const ys = f.img.map(p => p[1] * v.height); return Math.max(...ys) - Math.min(...ys) }));
  const sm = size(main), so = size(other), hy = F => (F.img[23][1] + F.img[24][1]) / 2;
  for (let i = 0; i < main.frames.length; i++) {
    const f = main.frames[i], g = other.frames[Math.round((i / main.fps + offset) * other.fps)]; if (!f || !g) continue;
    for (const j of J) diffs.push(Math.abs((f.img[j][1] - hy(f)) * main.height / sm - (g.img[j][1] - hy(g)) * other.height / so));
  }
  return diffs.length > 20 ? med(diffs) : 1;
}
export const SAME_PITCH_LIMIT = 0.07;
function resampleView(v, mainFps, T, offset) {
  const out = [];
  for (let i = 0; i < T; i++) {
    const x = (i / mainFps + offset) * v.fps, a = Math.floor(x), u = x - a, A = v.frames[a], B = v.frames[a + 1];
    if (!A || !B) { out.push(u < 0.5 ? A || null : B || null); continue }
    const lerp = (p, q) => p.map((_, k) => p[k] + (q[k] - p[k]) * u);
    out.push({ img: A.img.map((p, j) => lerp(p, B.img[j])), world: A.world.map((p, j) => lerp(p, B.world[j])), spread: A.spread && B.spread ? A.spread.map((s, j) => Math.max(s, B.spread[j])) : null });
  }
  return out;
}

// ---- weak-perspective view of a frame: screen offsets from the hips, in metres (x right, y down)
function screenScale(f, W, H) {
  // metres per pixel from the tracker's 3D: fits screen spread to 3D spread in the image plane
  const hp = [(f.img[23][0] + f.img[24][0]) / 2 * W, (f.img[23][1] + f.img[24][1]) / 2 * H], hw = hipOf(f.world);
  let num = 0, den = 0;
  for (const j of J_BODY) { const a = [f.img[j][0] * W - hp[0], f.img[j][1] * H - hp[1]], b = [f.world[j][0] - hw[0], f.world[j][1] - hw[1]]; num += a[0] * b[0] + a[1] * b[1]; den += a[0] * a[0] + a[1] * a[1] }
  return num / (den || 1);
}

// ---- 2 + 3. cameras and measurement
export function combineViews(views, opts = {}) {
  if (!views || views.length < 2) throw new Error("JP Pitching needs at least two camera angles of the same pitch.");
  const main = views[0], T = main.frames.length, fps = main.fps;
  const sync = [{ offset: 0, confidence: 1 }];
  const VF = [main.frames];
  for (let k = 1; k < views.length; k++) {
    const s = opts.offsets && opts.offsets[k] != null ? { offset: opts.offsets[k], confidence: 1 }
      : findOffset(main, views[k], opts.hints && opts.hints[k] != null ? { center: opts.hints[k], range: opts.hintRange ?? 0.12 } : {});
    const mis = verticalMismatch(main, views[k], s.offset);
    if (!opts.skipSameCheck && mis > SAME_PITCH_LIMIT) throw new Error(`The ${(views[k].label || "second").toLowerCase()} video doesn't show the same pitch as the main angle (the body positions don't line up). Every angle has to be the same pitch, filmed at the same time.`);
    s.mismatch = mis;
    sync.push(s); VF.push(resampleView(views[k], fps, T, s.offset));
  }
  const K = views.length;
  // per view, per frame: screen offsets from the hips in metres (smoothed scale), and the tracker's 3D (hip-centred)
  const scale = VF.map((F, k) => { const raw = F.map(f => f ? screenScale(f, views[k].width, views[k].height) : NaN); const m = med(raw); return raw.map((_, t) => { const w = []; for (let d = -8; d <= 8; d++) { const x = raw[t + d]; if (Number.isFinite(x)) w.push(x) } return w.length ? med(w) : m }) });
  const Y = VF.map((F, k) => F.map((f, t) => {
    if (!f) return null; const W = views[k].width, H = views[k].height, hp = [(f.img[23][0] + f.img[24][0]) / 2 * W, (f.img[23][1] + f.img[24][1]) / 2 * H];
    return f.img.map(p => [(p[0] * W - hp[0]) * scale[k][t], (p[1] * H - hp[1]) * scale[k][t], p[2] ?? 1]);
  }));
  const G = VF.map(F => F.map(f => { if (!f) return null; const h = hipOf(f.world); return f.world.map(p => [p[0] - h[0], p[1] - h[1], p[2] - h[2]]) }));
  // first guess: rotation from main-camera axes to each view's axes, aligning the tracker's 3D guesses
  const R = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]]];
  for (let k = 1; k < K; k++) {
    const pairs = [];
    for (let t = 0; t < T; t++) if (G[0][t] && G[k][t]) for (const j of J_BODY) pairs.push([G[0][t][j], G[k][t][j], Math.min(VF[0][t].img[j][2] ?? 1, VF[k][t].img[j][2] ?? 1)]);
    if (pairs.length < 50) throw new Error("The camera angles don't overlap in time. Make sure every camera filmed the same pitch.");
    R.push(kabsch(pairs));
  }
  // measure: least squares over views. Each view k sees the first two rows of R_k X (x right, y down), scaled.
  const weight = (k, t, j) => { const f = VF[k][t]; if (!f) return 0; const v = Math.max(0.05, f.img[j][2] ?? 1), sp = f.spread ? f.spread[j] ?? 0 : 0; return v / (1 + (sp / 0.04) ** 2) };
  const solve = () => {
    const X = [];
    for (let t = 0; t < T; t++) {
      if (!VF.some(F => F[t])) { X.push(null); continue }
      const F = new Array(33);
      for (let j = 0; j < 33; j++) {
        const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
        for (let k = 0; k < K; k++) {
          if (!Y[k][t]) continue; const w = weight(k, t, j);
          for (const row of [0, 1]) { const r = R[k][row], y = Y[k][t][j][row]; for (let i = 0; i < 3; i++) { b[i] += w * r[i] * y; for (let q = 0; q < 3; q++) A[i][q] += w * r[i] * r[q] } }
        }
        // a faint pull toward the trackers' own 3D, only to steady a joint that just one camera can see
        const prior = [0, 0, 0]; let pw = 0;
        for (let k = 0; k < K; k++) if (G[k][t]) { const g = mvec(tr(R[k]), G[k][t][j]); for (let i = 0; i < 3; i++) prior[i] += g[i]; pw++ }
        const lam = 0.02;
        if (pw) for (let i = 0; i < 3; i++) { A[i][i] += lam; b[i] += lam * prior[i] / pw }
        F[j] = solve3(A, b);
      }
      X.push(F);
    }
    return X;
  };
  let X = solve();
  // refine each camera against the 2D joints (orthographic Procrustes, completing depth from the current guess)
  for (let it = 0; it < (opts.refine ?? 6); it++) {
    for (let k = 1; k < K; k++) {
      const pairs = [];
      for (let t = 0; t < T; t++) if (X[t] && Y[k][t]) for (const j of J_BODY) { const x = X[t][j], z = mvec(R[k], x)[2]; pairs.push([x, [Y[k][t][j][0], Y[k][t][j][1], z], weight(k, t, j)]) }
      R[k] = kabsch(pairs);
    }
    X = solve();
  }
  // how well the views agree, per joint (share of body height): becomes the "spread" the pipeline already understands
  const height = med(X.filter(Boolean).map(F => Math.max(...F.map(p => p[1])) - Math.min(...F.map(p => p[1])))) || 1.7;
  const agree = X.map((F, t) => F && F.map((x, j) => {
    let e = 0, n = 0;
    for (let k = 0; k < K; k++) { if (!Y[k][t]) continue; const p = mvec(R[k], x); e += Math.hypot(p[0] - Y[k][t][j][0], p[1] - Y[k][t][j][1]); n++ }
    return n ? e / n / height : 1;
  }));
  // hip travel, measured: each view sees the hips move on screen; combine into one 3D path (main-camera axes)
  const hipPx = VF.map((F, k) => F.map(f => f ? [(f.img[23][0] + f.img[24][0]) / 2 * views[k].width, (f.img[23][1] + f.img[24][1]) / 2 * views[k].height] : null));
  const travel = []; let acc = [0, 0, 0];
  for (let t = 0; t < T; t++) {
    if (t > 0) {
      const A = [[1e-6, 0, 0], [0, 1e-6, 0], [0, 0, 1e-6]], b = [0, 0, 0];
      for (let k = 0; k < K; k++) {
        const p = hipPx[k][t], q = hipPx[k][t - 1]; if (!p || !q) continue;
        const d = [(p[0] - q[0]) * scale[k][t], (p[1] - q[1]) * scale[k][t]];
        for (const row of [0, 1]) { const r = R[k][row]; for (let i = 0; i < 3; i++) { b[i] += r[i] * d[row]; for (let q2 = 0; q2 < 3; q2++) A[i][q2] += r[i] * r[q2] } }
      }
      const dT = solve3(A, b); acc = acc.map((v, i) => v + dT[i]);
    }
    travel.push(acc.slice());
  }
  // camera geometry summary: angle between each camera and the main one (degrees, about vertical)
  const angles = R.map(Rk => { const z = mvec(tr(Rk), [0, 0, 1]); return Math.round(Math.atan2(z[0], z[2]) * 180 / Math.PI) });
  const frames = X.map((F, t) => F && { img: VF[0][t] ? VF[0][t].img : F.map(() => [0.5, 0.5, 0]), world: F, spread: agree[t] });
  return {
    fps, videoFps: main.videoFps || fps, width: main.width, height: main.height, start: main.start || 0, frames, travel, measured: true,
    cameras: views.map((v, k) => ({ label: v.label || `Camera ${k + 1}`, offset: Math.round(sync[k].offset * 1000) / 1000, syncConfidence: Math.round(sync[k].confidence * 100) / 100, angle: angles[k] })),
    agreeCm: Math.round(med(agree.filter(Boolean).flatMap(F => J_BODY.map(j => F[j]))) * height * 1000) / 10,
  };
}
function solve3(A, b) {
  const [[a, b1, c], [d, e, f], [g, h, i]] = A, det = a * (e * i - f * h) - b1 * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return [0, 0, 0];
  const inv = [[e * i - f * h, c * h - b1 * i, b1 * f - c * e], [f * g - d * i, a * i - c * g, c * d - a * f], [d * h - e * g, b1 * g - a * h, a * e - b1 * d]];
  return inv.map(r => (r[0] * b[0] + r[1] * b[1] + r[2] * b[2]) / det);
}
export const _test = { kabsch, speedCurve, mmul };
