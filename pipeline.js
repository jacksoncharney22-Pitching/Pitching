// Charney Pitching — analysis pipeline (runs in the browser, no DOM).
// Input: per-frame pose landmarks from MediaPipe Pose Landmarker (image + world).
// Output: the viewer's data object: a video-anchored 3D skeleton with constant bone lengths,
// planted feet, smooth natural motion, detected phases and every joint/pelvis/spine angle.
// Mirrors the Python research pipeline (lift.py + process3.py).

// ---------------------------------------------------------------- small math
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const n = norm(a) || 1e-12; return [a[0] / n, a[1] / n, a[2] / n] };
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const DEG = 180 / Math.PI;
const median = arr => { const s = [...arr].filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 };
const percentile = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[clamp(Math.round((p / 100) * (s.length - 1)), 0, s.length - 1)] };
const sstep = (t, t0, t1) => { const x = clamp((t - t0) / Math.max(t1 - t0, 1e-6), 0, 1); return x * x * (3 - 2 * x) };

// zero-phase 2nd-order Butterworth low-pass (filtfilt), the filter biomechanics labs run on motion-capture data
function lowpass(x, fc, fs) {
  fc = Math.min(fc, 0.42 * fs); if (x.length < 6) return x.slice();
  const w = Math.tan(Math.PI * fc / fs), k1 = Math.SQRT2 * w, k2 = w * w, a0 = 1 + k1 + k2;
  const c = { b0: k2 / a0, b1: 2 * k2 / a0, b2: k2 / a0, a1: 2 * (k2 - 1) / a0, a2: (1 - k1 + k2) / a0 };
  const run = v => { const y = new Array(v.length); let x1 = v[0], x2 = v[0], y1 = v[0], y2 = v[0];
    for (let i = 0; i < v.length; i++) { const o = c.b0 * v[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2; x2 = x1; x1 = v[i]; y2 = y1; y1 = o; y[i] = o } return y };
  const pad = Math.max(1, Math.min(x.length - 2, Math.round(fs / 3)));
  const head = x.slice(1, pad + 1).reverse().map(v => 2 * x[0] - v), tail = x.slice(x.length - pad - 1, x.length - 1).reverse().map(v => 2 * x[x.length - 1] - v);
  let y = run([...head, ...x, ...tail]); y = run(y.reverse()).reverse();
  return y.slice(pad, pad + x.length);
}
function hermite(p0, v0, p1, v1, n, i) {
  const u = i / n, h00 = 2*u**3 - 3*u**2 + 1, h10 = u**3 - 2*u**2 + u, h01 = -2*u**3 + 3*u**2, h11 = u**3 - u**2;
  return [0, 1, 2].map(k => h00 * p0[k] + h10 * n * v0[k] + h01 * p1[k] + h11 * n * v1[k]);
}
function slerp(a, b, u) {
  const om = Math.acos(clamp(dot(a, b), -1, 1));
  if (om < 1e-4) return a.slice();
  const s = Math.sin(om);
  return add(mul(a, Math.sin((1 - u) * om) / s), mul(b, Math.sin(u * om) / s));
}
function rodrigues(v, axis, ang) {
  const k = unit(axis), c = Math.cos(ang), s = Math.sin(ang);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}
const ang3 = (a, b, c) => Math.acos(clamp(dot(unit(sub(a, b)), unit(sub(c, b))), -1, 1)) * DEG;

// ---------------------------------------------------------------- time-series filters
// series helpers: S is Array(T) of arrays (vectors) or numbers
const isNum = x => typeof x === "number";
function gauss(S, sigma) {
  if (sigma <= 0) return S.map(v => isNum(v) ? v : v.slice());
  const T = S.length, r = Math.ceil(sigma * 4), w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-0.5 * (k / sigma) ** 2));
  const ws = w.reduce((a, b) => a + b, 0);
  return S.map((_, t) => {
    if (isNum(S[0])) { let a = 0; for (let k = -r; k <= r; k++) a += w[k + r] * S[clamp(t + k, 0, T - 1)]; return a / ws }
    const d = S[0].length, out = new Array(d).fill(0);
    for (let k = -r; k <= r; k++) { const v = S[clamp(t + k, 0, T - 1)]; for (let i = 0; i < d; i++) out[i] += w[k + r] * v[i] }
    return out.map(x => x / ws);
  });
}
// zero-phase adaptive One-Euro: strong smoothing when slow (jitter), light when fast (keeps the whip)
function oePass(S, fs, mincut, beta, dcut) {
  const a = c => 1 / (1 + fs / (2 * Math.PI * c));
  const vec = !isNum(S[0]), d = vec ? S[0].length : 1, get = t => vec ? S[t] : [S[t]];
  const y = [get(0).slice()]; let dprev = new Array(d).fill(0);
  for (let i = 1; i < S.length; i++) {
    const x = get(i), xp = get(i - 1), dh = new Array(d);
    let n = 0;
    for (let k = 0; k < d; k++) { const dx = (x[k] - xp[k]) * fs; dh[k] = dprev[k] + a(dcut) * (dx - dprev[k]); n += dh[k] * dh[k] }
    dprev = dh;
    const al = a(mincut + beta * Math.sqrt(n)), yp = y[i - 1];
    y.push(x.map((v, k) => yp[k] + al * (v - yp[k])));
  }
  return vec ? y : y.map(v => v[0]);
}
let OE_MIN = 0.7;   // Hz: smoothing strength when a joint is still (fast motion is barely smoothed)
export function setSmoothing(v) { OE_MIN = v }
function oe(S, fs, { mincut = OE_MIN, beta = 4, dcut = 6 } = {}) {
  const f = oePass(S, fs, mincut, beta, dcut), b = oePass([...S].reverse(), fs, mincut, beta, dcut).reverse();
  return f.map((v, i) => isNum(v) ? (v + b[i]) / 2 : v.map((x, k) => (x + b[i][k]) / 2));
}
function pava(y) {
  const out = [];
  for (const v of y) {
    out.push([v, 1]);
    while (out.length > 1 && out[out.length - 2][0] > out[out.length - 1][0]) {
      const a = out.pop(), b = out.pop(), n = a[1] + b[1];
      out.push([(a[0] * a[1] + b[0] * b[1]) / n, n]);
    }
  }
  return out.flatMap(([m, n]) => new Array(n).fill(m));
}
function naturalSpline(xs, ys) {
  const n = xs.length; if (n < 3) return x => ys[0] + (ys[n - 1] - ys[0]) * clamp((x - xs[0]) / ((xs[n - 1] - xs[0]) || 1), 0, 1);
  const h = [], al = [0], l = [1], mu = [0], z = [0], c = new Array(n).fill(0), b = [], d = [];
  for (let i = 0; i < n - 1; i++) h.push(xs[i + 1] - xs[i]);
  for (let i = 1; i < n - 1; i++) al.push(3 / h[i] * (ys[i + 1] - ys[i]) - 3 / h[i - 1] * (ys[i] - ys[i - 1]));
  for (let i = 1; i < n - 1; i++) { l.push(2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1]); mu.push(h[i] / l[i]); z.push((al[i] - h[i - 1] * z[i - 1]) / l[i]) }
  for (let j = n - 2; j >= 0; j--) { c[j] = (j < n - 2 ? z[j] : 0) - mu[j] * c[j + 1]; b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3; d[j] = (c[j + 1] - c[j]) / (3 * h[j]) }
  return x => { let i = 0; while (i < n - 2 && x > xs[i + 1]) i++; const dx = x - xs[i]; return ys[i] + b[i] * dx + c[i] * dx * dx + d[i] * dx ** 3 };
}

// ---------------------------------------------------------------- skeleton topology
const TREE = [[-2,23],[-2,24],[-2,-1],[-1,11],[-1,12],[11,13],[13,15],[15,17],[15,19],[15,21],[12,14],[14,16],[16,18],[16,20],[16,22],
              [23,25],[25,27],[27,29],[27,31],[24,26],[26,28],[28,30],[28,32]];
const MIRROR = {}; [[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],[23,24],[25,26],[27,28],[29,30],[31,32]].forEach(([a, b]) => { MIRROR[a] = b; MIRROR[b] = a });
const mir = j => (j in MIRROR ? MIRROR[j] : j);
const nodeOf = (F, k) => k === -2 ? mid(F[23], F[24]) : k === -1 ? mid(F[11], F[12]) : F[k];
const ARMS = new Set([13,14,15,16,17,18,19,20,21,22]);

// ---------------------------------------------------------------- input conditioning
// raw: {fps, width, height, frames:[{img:[[x,y,vis]x33] normalised, world:[[x,y,z]x33]} | null]}
function fillGaps(frames) {
  const T = frames.length, ok = frames.map(f => !!f);
  if (!ok.some(Boolean)) throw new Error("No body was found in this video. Try a clip where the whole pitcher is visible.");
  const out = frames.slice();
  for (let t = 0; t < T; t++) if (!ok[t]) {
    let a = t - 1; while (a >= 0 && !ok[a]) a--;
    let b = t + 1; while (b < T && !ok[b]) b++;
    const A = a >= 0 ? frames[a] : frames[b], B = b < T ? frames[b] : frames[a], u = a >= 0 && b < T ? (t - a) / (b - a) : 0;
    out[t] = { img: A.img.map((p, j) => p.map((v, k) => v + (B.img[j][k] - v) * u)), world: A.world.map((p, j) => p.map((v, k) => v + (B.world[j][k] - v) * u)) };
  }
  return out;
}
// remove single-frame tracking glitches: a joint that jumps away from its neighbours and back (Hampel filter),
// or that the tracker could barely see, is replaced by the median of the surrounding frames.
// Steady fast motion (the arm whip) moves consistently frame to frame, so it isn't touched.
function despike(frames, K) {
  const T = frames.length, k = Math.max(2, Math.round(3 * K));
  const fix = (get, set, floor, visOf) => {
    for (let j = 0; j < 33; j++) {
      const S = frames.map(f => get(f, j)), out = S.map(v => v.slice());
      for (let t = 0; t < T; t++) {
        const lo = Math.max(0, t - k), hi = Math.min(T - 1, t + k), win = [];
        for (let i = lo; i <= hi; i++) win.push(S[i]);
        const med = S[0].map((_, d) => median(win.map(v => v[d])));
        const dev = win.map(v => Math.hypot(...v.map((x, d) => x - med[d])));
        const mad = median(dev), thr = Math.max(floor, 3 * 1.4826 * mad);
        const mine = Math.hypot(...S[t].map((x, d) => x - med[d]));
        const vis = visOf ? visOf(frames[t], j) : 1;
        // where the tracking looks agree on this joint, a big jump is real motion (the arm at release), not a glitch
        const sure = frames[t].spread && frames[t].spread[j] != null && frames[t].spread[j] < 0.03;
        if (!sure && (mine > thr || vis < 0.2)) out[t] = med;
      }
      frames.forEach((f, t) => set(f, j, out[t]));
    }
  };
  fix((f, j) => f.img[j].slice(0, 2), (f, j, v) => { f.img[j][0] = v[0]; f.img[j][1] = v[1] }, 0.012, (f, j) => f.img[j][2] ?? 1);
  fix((f, j) => f.world[j].slice(0, 3), (f, j, v) => { f.world[j] = v }, 0.025, (f, j) => f.img[j][2] ?? 1);
  return frames;
}
// left/right swaps: from the side the tracker often trades the two legs (or arms) for a few frames,
// which makes the skeleton's legs scissor through each other. A two-state Viterbi pass per limb group keeps
// each label on the limb it was following, switching only when that is clearly more continuous.
// First the whole body: as a pitcher turns, the tracker can lose which way he faces and trade every left/right label at
// once (shoulders, hips, arms and legs together) for a stretch of frames; then each limb group on its own.
const WHOLE_BODY = [[11,12],[23,24],[13,14],[15,16],[25,26],[27,28],[29,30],[31,32],[17,18],[19,20],[21,22],[1,4],[2,5],[3,6],[7,8],[9,10]];
const SWAP_GROUPS = [WHOLE_BODY, [[25,26],[27,28],[29,30],[31,32]], [[13,14],[15,16],[17,18],[19,20],[21,22]]];
function fixSwaps(allFrames, W, H) {
  // only the frames the tracker actually saw (a frame skipped as a repeat would be a blend of its neighbours)
  const idx = allFrames.map((f, t) => f ? t : -1).filter(t => t >= 0), frames = idx.map(t => allFrames[t]);
  const T = frames.length; allFrames.swapLog = []; if (T < 3) return allFrames;
  const hgt = median(frames.map(f => { const ys = f.img.map(p => p[1] * H); return Math.max(...ys) - Math.min(...ys) })) || H / 2;
  let swapped = 0;
  for (const pairs of SWAP_GROUPS) {
    // screen position plus the tracker's 3D estimate (which tells the near leg from the far one when they overlap on screen)
    const M = hgt / 1.7;                                   // pixels per metre, roughly
    const pos = (t, s) => { const out = []; for (const [a, b] of pairs) for (const j of s ? [b, a] : [a, b]) { const p = frames[t].img[j], w = frames[t].world[j]; out.push([p[0] * W, p[1] * H, w[0] * M, w[1] * M, w[2] * M]) } return out };
    const cost = (t, s, u) => { const p = pos(t, s), q = pos(t - 1, u); let c = 0; for (let i = 0; i < p.length; i++) c += 0.6 * Math.hypot(p[i][0] - q[i][0], p[i][1] - q[i][1]) + 0.4 * Math.hypot(p[i][2] - q[i][2], p[i][3] - q[i][3], p[i][4] - q[i][4]); return c / hgt };
    const PEN = 0.1 * pairs.length, BIAS = 0.01 * pairs.length;
    let D = [0, PEN]; const back = [[0, 0]];
    for (let t = 1; t < T; t++) {
      const nd = [0, 0], bk = [0, 0];
      for (let s = 0; s < 2; s++) {
        let best = Infinity, arg = 0;
        for (let u = 0; u < 2; u++) { const v = D[u] + cost(t, s, u) + (s !== u ? PEN : 0); if (v < best) { best = v; arg = u } }
        nd[s] = best + (s ? BIAS : 0); bk[s] = arg;
      }
      D = nd; back.push(bk);
    }
    const st = new Array(T); st[T - 1] = D[1] < D[0] ? 1 : 0;
    for (let t = T - 1; t > 0; t--) st[t - 1] = back[t][st[t]];
    const flipAll = st.filter(Boolean).length > T / 2;      // keep the tracker's majority labelling
    for (let t = 0; t < T; t++) if (st[t] ^ flipAll) {
      swapped++; allFrames.swapLog.push([idx[t], pairs]);
      for (const [a, b] of pairs) for (const key of ["img", "world", "spread"]) { const A = frames[t][key]; if (!A) continue; const x = A[a]; A[a] = A[b]; A[b] = x }
    }
  }
  allFrames.swapped = swapped;
  return allFrames;
}
function detectThrowingHand(frames, W, H) {
  // 1. the leg that lifts highest at leg lift is the glove-side leg (true for every pitcher, seen from any angle)
  const ok = frames.filter(Boolean);
  const height = median(ok.map(F => { const ys = F.img.map(p => p[1] * H); return Math.max(...ys) - Math.min(...ys) })) || H / 2;
  const lift = k => { const v = ok.map(F => ((F.img[23][1] + F.img[24][1]) / 2 - F.img[k][1]) * H / height); v.sort((a, b) => a - b); return v[Math.floor(v.length * 0.97)] };
  const dL = lift(25) - lift(26);                       // left knee higher -> left is the glove side -> right-handed
  if (Math.abs(dL) > 0.08) return dL > 0 ? "R" : "L";
  // 2. otherwise the throwing hand moves faster than the glove hand (a high percentile, so one blurry frame can't decide it)
  const sp = w => {
    const v = [];
    for (let t = 1; t < frames.length; t++) {
      const f = frames[t], g = frames[t - 1]; if (!f || !g) continue;
      const rel = F => [F.img[w][0] * W - (F.img[23][0] + F.img[24][0]) * W / 2, F.img[w][1] * H - (F.img[23][1] + F.img[24][1]) * H / 2];
      const a = rel(f), b = rel(g); v.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    v.sort((a, b) => a - b); return v[Math.floor(v.length * 0.95)] || 0;
  };
  return sp(16) >= sp(15) ? "R" : "L";
}
// left-handers are analysed as mirrored right-handers, then mirrored back for display
function mirrorFrames(frames) {
  return frames.map(f => ({
    img: f.img.map((_, j) => { const p = f.img[mir(j)]; return [1 - p[0], p[1], p[2]] }),
    world: f.world.map((_, j) => { const p = f.world[mir(j)]; return [-p[0], p[1], p[2]] }),
  }));
}

// ---------------------------------------------------------------- learned depth (3D motion model)
// raw.l3: per frame, the 17 joints of a learned 2D-to-3D motion model (MotionAGFormer, trained on motion capture),
// camera axes (x right, y down, z away), in screen units. Its depth replaces the per-frame tracker's depth guess:
// it has seen how real bodies move, so it doesn't send an arm the wrong way toward/away from the camera.
const H36 = { 0: 9, 11: 11, 12: 14, 13: 12, 14: 15, 15: 13, 16: 16, 23: 4, 24: 1, 25: 5, 26: 2, 27: 6, 28: 3 };
const H36_PARENT = j => j <= 10 ? 0 : j === 17 || j === 19 || j === 21 ? 15 : j === 18 || j === 20 || j === 22 ? 16 : j === 29 || j === 31 ? 27 : j === 30 || j === 32 ? 28 : j;
function injectLearnedDepth(frames, l3, only = null) {
  const T = frames.length, ks = [];
  for (let t = 0; t < T; t++) {
    const L = l3[t], f = frames[t]; if (!L || !f) continue;
    const mw = f.world, tl = Math.hypot(...[0, 1, 2].map(k => (mw[11][k] + mw[12][k] - mw[23][k] - mw[24][k]) / 2));
    const ll = Math.hypot(...[0, 1, 2].map(k => L[8][k] - L[0][k]));
    if (tl > 0 && ll > 0) ks.push(tl / ll);
  }
  if (ks.length < 3) return 0;
  const k = median(ks); let n = 0;
  for (let t = 0; t < T; t++) {
    const L = l3[t], f = frames[t]; if (!L || !f) continue;
    const old = f.world.map(p => p[2]), hz = (old[23] + old[24]) / 2;
    const z = j => k * L[H36[j]][2];                                  // pelvis is the lifter's origin = hip centre
    f.world = f.world.map((p, j) => {
      const par = j in H36 ? j : H36_PARENT(j);
      if (only && !only.has(par)) return p;
      if (j in H36) return [p[0], p[1], z(j) + hz];
      return [p[0], p[1], z(par) + hz + (old[j] - old[par])];
    });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- 1. video-anchored lifting
// screen-plane positions from the 2D tracker (metres via a per-frame scale), depth solved per bone
// so every bone keeps a constant symmetric length, toward/away sign from the 3D model
function lift(frames, W, H, fs, opts = {}) {
  const T = frames.length;
  let img = frames.map(f => f.img.map(p => [p[0] * W, p[1] * H]));
  let wd = frames.map(f => f.world.map(p => p.slice(0, 3)));
  for (let j = 0; j < 33; j++) {
    if (opts.measured && opts.measuredRaw !== false) continue;          // measured 3D is already clean
    const si = oe(img.map(F => F[j]), fs), sw = oe(wd.map(F => F[j]), fs);
    for (let t = 0; t < T; t++) { img[t][j] = si[t]; wd[t][j] = sw[t] }
  }
  const BODY = [11,12,13,14,15,16,23,24,25,26,27,28];
  let s = img.map((F, t) => {
    const ca = [0, 0], cb = [0, 0];
    BODY.forEach(j => { ca[0] += F[j][0]; ca[1] += F[j][1]; cb[0] += wd[t][j][0]; cb[1] += wd[t][j][1] });
    ca[0] /= BODY.length; ca[1] /= BODY.length; cb[0] /= BODY.length; cb[1] /= BODY.length;
    let num = 0, den = 0;
    BODY.forEach(j => { const a = [F[j][0] - ca[0], F[j][1] - ca[1]], b = [wd[t][j][0] - cb[0], wd[t][j][1] - cb[1]]; num += a[0] * b[0] + a[1] * b[1]; den += a[0] * a[0] + a[1] * a[1] });
    return num / (den || 1);
  });
  s = gauss(s, 3 * fs / 30);
  const XY = img.map((F, t) => { const h = [(F[23][0] + F[24][0]) / 2, (F[23][1] + F[24][1]) / 2]; return F.map(p => [(p[0] - h[0]) * s[t], (p[1] - h[1]) * s[t], 0]) });
  const Z = wd.map(F => { const hz = (F[23][2] + F[24][2]) / 2; return F.map(p => p[2] - hz) });
  const XYZ = XY.map((F, t) => F.map((p, j) => [p[0], p[1], Z[t][j]]));
  const LIFT_TREE = TREE.concat([[-1, 0]]);
  const L = {};
  LIFT_TREE.forEach(([a, b]) => {
    const inplane = [], full = [];
    for (let t = 0; t < T; t++) { inplane.push(norm(sub(nodeOf(XY[t], b), nodeOf(XY[t], a)))); full.push(norm(sub(nodeOf(XYZ[t], b), nodeOf(XYZ[t], a)))) }
    L[a + "," + b] = Math.max(percentile(inplane, 90), median(full));
  });
  LIFT_TREE.forEach(([a, b]) => { const k = mir(a) + "," + mir(b); if (k in L && k !== a + "," + b) { const m = (L[a + "," + b] + L[k]) / 2; L[a + "," + b] = L[k] = m } });
  // which way each bone points (toward or away from the camera) is chosen for the whole clip at once:
  // agree with the tracker's depth where it is clear, never flip faster than a body can move (two-state Viterbi per bone)
  const SIGN = {};
  if (opts.depthViterbi !== false && !opts.measured) LIFT_TREE.forEach(([a, b]) => {
    const Lb = L[a + "," + b], m = [], h = [];
    for (let t = 0; t < T; t++) { const d2 = sub(nodeOf(XY[t], b), nodeOf(XY[t], a)); m.push(Math.sqrt(Math.max(0, Lb * Lb - d2[0] ** 2 - d2[1] ** 2))); h.push(nodeOf(XYZ[t], b)[2] - nodeOf(XYZ[t], a)[2]) }
    const vmax = ARMS.has(b) ? (b >= 15 ? 12 : 8) : (b >= 25 ? 5 : 3);        // m/s a bone end can swing toward the camera
    const step = vmax / fs, su = 0.5 * Lb;
    const un = (t, s) => Math.min(9, ((s ? -m[t] : m[t]) - h[t]) ** 2 / (su * su));
    const tr = (t, s, u) => Math.min(25, ((s ? -m[t] : m[t]) - (u ? -m[t - 1] : m[t - 1])) ** 2 / (step * step));
    let D = [un(0, 0), un(0, 1)]; const bk = [[0, 0]];
    for (let t = 1; t < T; t++) {
      const nd = [0, 0], b2 = [0, 0];
      for (let s = 0; s < 2; s++) { const c0 = D[0] + tr(t, s, 0), c1 = D[1] + tr(t, s, 1); nd[s] = Math.min(c0, c1) + un(t, s); b2[s] = c1 < c0 ? 1 : 0 }
      D = nd; bk.push(b2);
    }
    const st = new Array(T); st[T - 1] = D[1] < D[0] ? 1 : 0;
    for (let t = T - 1; t > 0; t--) st[t - 1] = bk[t][st[t]];
    SIGN[a + "," + b] = st.map(x => x ? -1 : 1);
  });
  const out = [];
  for (let t = 0; t < T; t++) {
    const pos = { "-2": [0, 0, 0] }, F = new Array(33);
    LIFT_TREE.forEach(([a, b]) => {
      const d2 = sub(nodeOf(XY[t], b), nodeOf(XY[t], a)), hint = nodeOf(XYZ[t], b)[2] - nodeOf(XYZ[t], a)[2], Lb = L[a + "," + b];
      const r2 = Lb * Lb - (d2[0] ** 2 + d2[1] ** 2);
      let vec;
      if (opts.measured) vec = [d2[0], d2[1], hint];     // measured from several cameras: take it as it is
      else if (r2 > 0) {
        const sg = SIGN[a + "," + b] ? SIGN[a + "," + b][t] : Math.sign(hint || 1);
        let dz = sg * Math.sqrt(r2);
        if (Math.abs(hint) < 0.25 * Lb) dz = 0.5 * dz + 0.5 * clamp(hint, -Math.sqrt(r2), Math.sqrt(r2));
        vec = [d2[0], d2[1], dz];
      } else { const n2 = Math.hypot(d2[0], d2[1]) || 1; vec = [d2[0] * Lb / n2, d2[1] * Lb / n2, 0] }
      pos[b] = add(pos[a], vec);
    });
    for (const k in pos) if (+k >= 0) F[+k] = pos[k];
    for (let k = 1; k <= 10; k++) F[k] = add(F[0], [XY[t][k][0] - XY[t][0][0], XY[t][k][1] - XY[t][0][1], Z[t][k] - Z[t][0]]);
    const h = mid(F[23], F[24]);
    out.push(F.map(p => sub(p, h)));
  }
  if (!opts.measured) for (let j = 0; j < 33; j++) { const z = gauss(out.map(F => F[j][2]), fs / 30); for (let t = 0; t < T; t++) out[t][j][2] = z[t] }
  return { P: out, imgSmooth: img, scale: s };
}

// ---------------------------------------------------------------- throwing arm through release (when the camera loses it)
// Angles in the trunk's frame: abduction (0 = arm hanging, 90 = out at shoulder height), horizontal angle (0 = in line
// with the shoulders, + = behind them), elbow bend, and forearm turn about the upper arm (≈ external rotation, 180 =
// fully laid back). Keys: the clear frames either side (with their speeds), and the average path of 411 fastballs
// measured in a motion-capture lab (Driveline OpenBiomechanics, 328 righties and 83 lefties): max layback 32 ms before
// release, then release, then 17, 33 and 67 ms after it.
const ARM_PATH = [[-0.032, [100, -20, 94, 175]], [0, [99, -7, 29, 97]], [1 / 60, [109, -6, 46, 27]], [2 / 60, [116, -24, 50, 8]], [4 / 60, [97, -64, 34, 45]]];
function throwPath(A0, A, B1, B2, a, b, rel, fs) {
  const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
  const ang = q => [Math.acos(clamp(-q.u[1], -1, 1)) * DEG, Math.atan2(-q.u[0], q.u[2]) * DEG, q.fl, q.er];
  const a0 = ang(A0), a1 = ang(A), b1 = ang(B1), b2 = ang(B2);
  const dAbd = 0.5 * clamp(a1[0] - 100, -15, 15);          // a pitcher who throws from a higher or lower slot keeps it
  const keys = [[a, a1]];
  for (const [dt, v] of ARM_PATH) { const t = rel + Math.round(dt * fs); if (t > keys[keys.length - 1][0] && t < b) keys.push([t, [v[0] + dAbd, v[1], v[2], v[3]]]) }
  keys.push([b, b1]);
  // unwrap the angles that go round (horizontal angle, forearm turn) so each key is the nearest turn to the last
  for (let k = 1; k < keys.length; k++) for (const d of [1, 3]) keys[k][1][d] = keys[k - 1][1][d] + wrap(keys[k][1][d] - keys[k - 1][1][d]);
  const vA = a1.map((v, d) => d === 1 || d === 3 ? wrap(v - a0[d]) : v - a0[d]), vB = b2.map((v, d) => d === 1 || d === 3 ? wrap(v - b1[d]) : v - b1[d]);
  const K = keys.length, slope = [];
  for (let k = 0; k < K - 1; k++) slope.push(keys[k + 1][1].map((v, d) => (v - keys[k][1][d]) / (keys[k + 1][0] - keys[k][0])));
  const tan = keys.map((_, k) => [0, 1, 2, 3].map(d => {
    if (k === 0) return clamp(vA[d], -2 * Math.abs(slope[0][d]), 2 * Math.abs(slope[0][d]));
    if (k === K - 1) return clamp(vB[d], -2 * Math.abs(slope[K - 2][d]), 2 * Math.abs(slope[K - 2][d]));
    const s1 = slope[k - 1][d], s2 = slope[k][d];
    return s1 * s2 <= 0 ? 0 : 2 / (1 / s1 + 1 / s2);              // monotone between keys: no overshoot
  }));
  return t => {
    let k = 0; while (k < K - 2 && t > keys[k + 1][0]) k++;
    const n = keys[k + 1][0] - keys[k][0], i = t - keys[k][0], out = [];
    for (let d = 0; d < 4; d += 2) { const h = hermite([keys[k][1][d], keys[k][1][d + 1], 0], [tan[k][d], tan[k][d + 1], 0], [keys[k + 1][1][d], keys[k + 1][1][d + 1], 0], [tan[k + 1][d], tan[k + 1][d + 1], 0], n, i); out.push(h[0], h[1]) }
    return out;
  };
}


// ---------------------------------------------------------------- throwing arm matched to lab throws
// Around release the arm moves further between two video frames than anywhere else (at 30 fps the forearm turns about
// 90° between frames), and one camera can't tell whether it leans toward or away from the lens. So the arm seen in the
// clear frames is compared, frame by frame as the camera sees it, with 404 fastballs measured in a motion-capture lab
// (Driveline OpenBiomechanics; upper arm and forearm directions in the trunk's axes, 240 samples a second), allowing for
// a slightly earlier or later release and a slightly quicker or slower arm. The closest lab throws, averaged, give the
// arm's lean toward or away from the camera, and the arm itself in frames the camera lost to blur.
function decodeArmLib(lib) {
  if (lib._dec) return lib._dec;
  const dec = typeof atob === "function" ? s => atob(s) : s => Buffer.from(s, "base64").toString("binary");
  lib._dec = lib.pitches.filter(p => !(lib._exclude && lib._exclude.has(p.user))).map(p => {
    const b = dec(p.d), a = new Float32Array(b.length);
    for (let i = 0; i < b.length; i++) { const v = b.charCodeAt(i); a[i] = v === 128 ? NaN : (v > 127 ? v - 256 : v) / 127 }   // -128: not recorded
    return { user: p.user, a };
  });
  return lib._dec;
}
function armMatch(P, img, scale, rot, cam, BL, rel, fs, bad, lib, opts = {}) {
  const T = P.length, LIB = decodeArmLib(lib), N = lib.n, LF = lib.fps, LT0 = lib.t0;
  const ex = rot([1, 0, 0]), ey = [0, 1, 0], Lu = BL["12,14"], Lf = BL["14,16"];
  const lo = Math.max(1, rel - Math.round((opts._mPre ?? 0.26) * fs)), hi = Math.min(T - 2, rel + Math.round((opts._mPost ?? 0.10) * fs));
  const proj = v => [dot(v, ex), dot(v, ey)];
  const fr = [];
  for (let t = lo; t <= hi; t++) {
    const F = P[t], up = unit(sub(mid(F[11], F[12]), mid(F[23], F[24]))); let r = sub(F[12], F[11]); r = unit(sub(r, mul(up, dot(r, up))));
    const fw = cross(up, r), R = [r, up, fw];
    const o = (a, b) => [(img[t][b][0] - img[t][a][0]) * scale[t], -(img[t][b][1] - img[t][a][1]) * scale[t]];
    // rows of the projection: screen x and y of each trunk axis, so a trunk-frame direction projects with two dot products
    const px = R.map(ax => dot(ax, ex)), py = R.map(ax => dot(ax, ey));
    fr.push({ t, R, px, py, ou: o(12, 14), of: o(14, 16), w: bad && bad[t] ? 0.05 : 1 });
  }
  const sample = (a, tau, k) => { const x = (tau - LT0) * LF; if (x < 0 || x > N - 1) return null; const i = Math.min(N - 2, Math.floor(x)), u = x - i, j = i * 6 + k;
    if (a[j] !== a[j] || a[j + 6] !== a[j + 6]) return null;                                 // outside what the lab recorded
    return [a[j] + (a[j + 6] - a[j]) * u, a[j + 1] + (a[j + 7] - a[j + 1]) * u, a[j + 2] + (a[j + 8] - a[j + 2]) * u] };
  const shifts = []; for (let s = -0.05; s <= 0.0501; s += 1 / 240) shifts.push(s);
  const speeds = [0.88, 0.94, 1, 1.06, 1.13];
  const step = Math.max(1, Math.ceil(fr.length / 30)), frS = fr.filter((_, i) => i % step === 0);   // slow-motion: score every few frames
  const scored = LIB.map(L => {
    let best = Infinity, bs = 0, bk = 1;
    for (const k of speeds) for (const s of shifts) {
      let c = 0, ws = 0, miss = 0;
      for (const q of frS) {
        const tau = ((q.t - rel) / fs + s) * k, u = sample(L.a, tau, 0), f = sample(L.a, tau, 3);
        if (!u) { miss += q.w; continue }
        const ux = Lu * (q.px[0] * u[0] + q.px[1] * u[1] + q.px[2] * u[2]) - q.ou[0], uy = Lu * (q.py[0] * u[0] + q.py[1] * u[1] + q.py[2] * u[2]) - q.ou[1];
        const fx = Lf * (q.px[0] * f[0] + q.px[1] * f[1] + q.px[2] * f[2]) - q.of[0], fy = Lf * (q.py[0] * f[0] + q.py[1] * f[1] + q.py[2] * f[2]) - q.of[1];
        c += q.w * ((ux * ux + uy * uy) / (Lu * Lu) + (fx * fx + fy * fy) / (Lf * Lf)); ws += q.w;
      }
      if (ws < 2 * miss || !ws) continue;                   // must cover at least two thirds of the window
      c = c / ws + 0.15 * miss / (ws + miss); if (c < best) { best = c; bs = s; bk = k }
    }
    return { L, c: best, s: bs, k: bk };
  }).sort((a, b) => a.c - b.c);
  // The arm's shape comes from the best 30 lab throws, each weighted frame by frame by how well it fits the video
  // round that frame (a throw that fits the arm at foot strike needn't fit it at release). Before 2026-11-06 it was
  // the plain average of the best 6, which pulled every frame toward a typical arm. 60 benchmark views: throwing elbow
  // at max layback 12.7 -> 9.7° off, at release 8.8 -> 7.6°; layback at max layback 9.7 -> 7.4°, at release
  // 39.8 -> 23.5°; shoulder abduction 4.4/7.1/6.8 -> 4.1/5.0/5.4°. Timing still comes from the best 6 (below).
  // opts.armLocal === false: the old plain average (armMatchK sets how many).
  const local = opts.armLocal !== false, top = scored.slice(0, opts.armMatchK ?? (local ? 30 : 6)), top6 = scored.slice(0, 6);
  const lw = top.map(() => new Array(fr.length).fill(1));
  if (local) {
    const tau = opts._armLocalT ?? 0.02, sig = Math.max(1, (opts._armLocalS ?? 0.02) * fs), R3 = Math.ceil(3 * sig);
    // each match's misfit on screen at each frame (same measure as the overall score), then smoothed over ~20 ms
    const cl = top.map(m => fr.map(q => { const ta = ((q.t - rel) / fs + m.s) * m.k, u = sample(m.L.a, ta, 0), f = sample(m.L.a, ta, 3); if (!u) return NaN;
      const ux = Lu * (q.px[0] * u[0] + q.px[1] * u[1] + q.px[2] * u[2]) - q.ou[0], uy = Lu * (q.py[0] * u[0] + q.py[1] * u[1] + q.py[2] * u[2]) - q.ou[1];
      const fx = Lf * (q.px[0] * f[0] + q.px[1] * f[1] + q.px[2] * f[2]) - q.of[0], fy = Lf * (q.py[0] * f[0] + q.py[1] * f[1] + q.py[2] * f[2]) - q.of[1];
      return (ux * ux + uy * uy) / (Lu * Lu) + (fx * fx + fy * fy) / (Lf * Lf) }));
    const sm = cl.map(c => c.map((_, i) => { let a = 0, w = 0;
      for (let j = Math.max(0, i - R3); j <= Math.min(c.length - 1, i + R3); j++) { if (c[j] !== c[j]) continue; const g = Math.exp(-0.5 * ((j - i) / sig) ** 2) * fr[j].w; a += g * c[j]; w += g }
      return w ? a / w : NaN }));
    for (let i = 0; i < fr.length; i++) {
      let mn = Infinity; for (const c of sm) if (c[i] < mn) mn = c[i];
      if (mn === Infinity) continue;
      top.forEach((_, k) => { lw[k][i] = sm[k][i] === sm[k][i] ? Math.exp(-(sm[k][i] - mn) / tau) : 0 });
    }
  }
  const u = new Array(T).fill(null), f = new Array(T).fill(null), wt = new Array(T).fill(0);
  for (const [qi, q] of fr.entries()) {
    let su = [0, 0, 0], sf = [0, 0, 0], n = 0;
    for (const [mi, m] of top.entries()) { const tau = ((q.t - rel) / fs + m.s) * m.k, a = sample(m.L.a, tau, 0), b = sample(m.L.a, tau, 3); if (!a) continue; const g = lw[mi][qi]; su = add(su, mul(a, g)); sf = add(sf, mul(b, g)); n += g }
    if (!n) continue;
    const toW = v => add(add(mul(q.R[0], v[0]), mul(q.R[1], v[1])), mul(q.R[2], v[2]));
    u[q.t] = unit(toW(su)); f[q.t] = unit(toW(sf));
    const ez = Math.max(3, Math.round(0.05 * fs)); wt[q.t] = sstep(Math.min(q.t - lo + 1, hi - q.t + 1), 0, ez);   // eased in and out over 50 ms at the window's ends
  }
  if (opts._dbgMatch) opts._dbgMatch.push({ top: top.map(m => [m.L.user, +m.c.toFixed(4), m.s, m.k]), lo, hi, u, f, rel });
  let relShift = -top6.reduce((a, m) => a + m.s, 0) / Math.max(1, top6.length) * fs;   // where the lab throws put release, in frames
  // matches pinned at the edge of the allowed timing (a much slower or faster arm than any lab throw: usually a
  // slow-motion clip whose speed changes partway) aren't trusted for timing, and steer the arm only half as much
  const edge = top6.filter(m => Math.abs(m.s) > 0.045 && (m.k <= speeds[0] || m.k >= speeds[speeds.length - 1])).length / Math.max(1, top6.length);
  if (edge > 0.5) { relShift = 0; for (let t = 0; t < T; t++) wt[t] *= 0.5 }
  return { u, f, wt, relShift, edge };
}

// ---------------------------------------------------------------- arms locked to the video
// For each arm bone the tracked video gives its on-screen direction and length exactly; with the bone's true length
// that fixes how far it leans toward/away from the camera, leaving only which way (toward or away). That choice is
// taken from the reconstruction (P), held steady by a two-state Viterbi (no flipping faster than an arm can move).
function lockArms(P, img, scale, rot, cam, BL, unseen, K, fs, opts = {}, tmpl = null) {
  const T = P.length, ex = rot([1, 0, 0]), ey = [0, 1, 0], cz = unit(cam);
  // [parent, joint, joints carried along, hand points rotated with the forearm]; shoulders first, then each arm down
  const CH = [[-1, 12, [14, 16, 18, 20, 22]], [-1, 11, [13, 15, 17, 19, 21]],
              [12, 14, [16, 18, 20, 22]], [14, 16, [], [18, 20, 22]], [11, 13, [15, 17, 19, 21]], [13, 15, [], [17, 19, 21]]];
  // the hip line too (each hip about the hips' midpoint); the legs follow when the bone lengths are locked again
  if (opts.lockHips) CH.unshift([-2, 24, []], [-2, 23, []]);
  const scr = (t, j, k) => { const A = j === -1 ? [(img[t][11][0] + img[t][12][0]) / 2, (img[t][11][1] + img[t][12][1]) / 2] : j === -2 ? [(img[t][23][0] + img[t][24][0]) / 2, (img[t][23][1] + img[t][24][1]) / 2] : img[t][j];
    const dx = (img[t][k][0] - A[0]) * scale[t], dy = -(img[t][k][1] - A[1]) * scale[t]; return add(mul(ex, dx), mul(ey, dy)) };
  const Q = P.map(F => F.map(p => p.slice()));
  const BLk = (a, b) => a < 0 ? BL[a + "," + b] : BL[a + "," + b];
  const M0 = P.map(F => nodeOf(F, -1)), H0 = P.map(F => nodeOf(F, -2)), baseOf = (F, a, t) => a === -1 ? M0[t] : a === -2 ? H0[t] : F[a];
  // How wide the shoulders look when they're square to the camera. The shoulder joints aren't a fixed distance apart:
  // the shoulder blades pinch back as the arm loads, and in the lab (12 benchmark pitches) the joint-to-joint width
  // drops from ~9% of height to ~7.7% at foot strike, then comes back by max layback. The tracker sees that narrower
  // width, and reading it against the full width made a square-on shoulder line look turned 25-35° toward or away
  // from the camera (worst from behind toward third base). So the depth is read against a width 6% under
  // the full one from 0.4 s before foot strike to just after release (a nearly square-on line then isn't over-turned
  // by tracker wobble), 18% under right at foot strike, back to 6% by mid-way to release. 60 benchmark views: trunk
  // turn at foot strike 11.5 -> 10.6° off, hip-shoulder separation at foot strike 11.5 -> 9.0°, from behind toward
  // third base trunk turn 17.9 -> 13.4°.
  // Late in the delivery the chest swings through square to the camera, so the widest the shoulders look from foot strike to
  // just after release is this pitcher's true shoulder width as the tracker sees it (0.86 to 1.04 of the fixed width: it varies
  // pitcher by pitcher, nothing to do with where the camera stands). Read against that instead of a fixed 94%, a shoulder line
  // that really is flat to the camera isn't over-turned. 60 benchmark views vs motion capture: trunk turn at release 11.4 -> 10.8°
  // off, at max layback 7.9 -> 7.5°, foot strike 8.3 -> 8.1°; separation 6.8/4.9/6.4 -> 6.6/4.8/6.1°.
  let autoFull = null;
  if (opts._shAuto !== false && opts._fsF != null) {
    const f0 = Math.max(0, Math.round(opts._fsF)), r0 = Math.max(f0 + 1, opts._relF ?? f0 + 0.1 * fs), end = Math.min(T - 1, Math.round(r0 + 0.1 * fs)), w = [];
    for (let t = f0; t <= end; t++) w.push(norm(sub(scr(t, -1, 12), scr(t, -1, 11))) / 2);
    if (w.length) autoFull = Math.max(...gauss(w.map(v => [v, 0, 0]), Math.max(0.7, 0.5 * K)).map(v => v[0])) / BLk(-1, 12);
  }
  const shW = t => {
    if (opts.shoulderPinch === false || opts._fsF == null) return 1;
    const full = autoFull != null ? clamp(autoFull, 0.86, 1.04) : opts._shFull ?? 0.94, pinch = opts._shPinch ?? 0.82, out = opts._shOut ?? 1;
    const f0 = opts._fsF, r0 = Math.max(f0 + 1, opts._relF ?? f0 + 0.1 * fs), m0 = (f0 + r0) / 2, s = x => x * fs;
    const knots = [[f0 - s(opts._shPre ?? 0.4), out], [f0, pinch], [m0, full], [r0 + s(0.08), full], [r0 + s(0.15), out]];
    if (t <= knots[0][0]) return out;
    for (let i = 1; i < knots.length; i++) if (t <= knots[i][0]) { const [x0, y0] = knots[i - 1], [x1, y1] = knots[i]; return y0 + (y1 - y0) * (t - x0) / Math.max(1e-6, x1 - x0) }
    return out;
  };
  const trust = {};
  for (const sh of [11, 12]) { const u = unseen[sh]; trust[sh] = u ? gauss(u.map(v => v ? 0 : 1), Math.max(0.7, 0.7 * K)).map((w, t) => u[t] ? Math.min(w, 0.15) : w) : P.map(() => 1) }
  for (const [a, b, carry, hand] of CH) {
    const wt = a < 0 ? P.map(() => 1) : trust[[12, 14, 16].includes(b) ? 12 : 11];
    if (opts.lockThrowOnly && ![12, 14, 16].includes(b)) continue;
    if (a === -1 && opts.lockShoulders === false) continue;
    const L = BLk(a, b), ip = [], dz = [], cur = [];
    for (let t = 0; t < T; t++) {
      let v = scr(t, a, b); const n = norm(v), Lt = a === -1 ? L * shW(t) : L;
      if (n > 0.995 * Lt) v = mul(v, 0.995 * Lt / n);
      ip.push(v); dz.push(Math.sqrt(Math.max(0, Lt * Lt - dot(v, v)))); cur.push(dot(sub(Q[t][b], baseOf(Q[t], a, t)), cz));
    }
    // throwing arm: which way it leans comes from the matched lab throws where they're available
    const tv = tmpl && (b === 14 || b === 16) ? (b === 14 ? tmpl.u : tmpl.f) : null;
    if (tv) for (let t = 0; t < T; t++) if (tv[t]) { const w = tmpl.wt[t] * (opts._tmplSign ?? 1); cur[t] = (1 - w) * cur[t] + w * L * dot(tv[t], cz) }
    // toward/away: agree with the reconstruction, change only as fast as the bone end can travel
    const su = 0.35 * L, step = (b === 16 || b === 15 ? 14 : a < 0 ? 3 : 8) / fs;
    const un = (t, s) => Math.min(9, ((s ? -dz[t] : dz[t]) - cur[t]) ** 2 / (su * su));
    const tr = (t, s, u) => Math.min(400, ((s ? -dz[t] : dz[t]) - (u ? -dz[t - 1] : dz[t - 1])) ** 2 / (step * step));
    let D = [un(0, 0), un(0, 1)]; const bk = [];
    for (let t = 1; t < T; t++) {
      const nd = [0, 0], b2 = [0, 0];
      for (let s = 0; s < 2; s++) { const c0 = D[0] + tr(t, s, 0), c1 = D[1] + tr(t, s, 1); nd[s] = Math.min(c0, c1) + un(t, s); b2[s] = c1 < c0 ? 1 : 0 }
      D = nd; bk.push(b2);
    }
    const st = new Array(T); st[T - 1] = D[1] < D[0] ? 1 : 0;
    for (let t = T - 1; t > 0; t--) st[t - 1] = bk[t - 1][st[t]];
    if (opts._dbgLock) opts._dbgLock.push({ a, b, L, ip: ip.map(v => norm(v)), dz, cur, st, wt });
    // the tracker's own frame-to-frame wobble is evened out (shoulders more: they're often half hidden), lengths kept exact.
    // The shoulders only lightly (about 25 ms at 30 fps): the trunk turns some 150° between foot strike and release, and
    // more smoothing rounded that off (60 benchmark views: trunk turn at release 15° off -> 11°, hip-shoulder
    // separation at release 9° -> 7°)
    // The arms lightly too (0.3): the elbow bends quickly in the last moments before foot strike and more smoothing read it too
    // straight. 60 benchmark views vs motion capture: elbow at foot strike 8.6 -> 7.8° off, the rest unchanged; slightly more
    // frame-to-frame wobble in the elbow (6.4 -> 6.7, the real arm: 5.8)
    const sgm = (a < 0 ? (a === -2 ? opts._hipSig ?? 1.5 : opts._shSig ?? 0.8) : opts._armSig ?? 0.3) * K;
    const VS = gauss(ip.map((v, t) => add(v, mul(cz, st[t] ? -dz[t] : dz[t]))), sgm);
    // frames the camera lost to blur: the matched lab arm itself
    const tw = new Array(T).fill(0);
    if (tv) for (let t = 0; t < T; t++) if (tv[t]) {
      // The upper arm: how much the matched lab arm counts depends on how the bone lies to the camera. Lying flat in the
      // picture, the video shows it well; pointing at or away from the camera it's only a short stub on screen and its
      // direction in the picture is mostly tracker noise, so the lab arm counts more. 60 benchmark views vs motion
      // capture: elbow at foot strike 9.5 -> 8.6° off, layback and shoulder abduction unchanged. (A flat 50% lab arm
      // pulled every elbow toward the typical lab arm, which reads about 4° straighter than these pitchers at landing.)
      const gw = b === 14 && opts._tmplAll == null ? 0.8 * (1 - norm(ip[t]) / L) : (opts._tmplAll ?? 0.5);
      const lost = unseen[12] && unseen[12][t], w = tmpl.wt[t] * (lost ? (opts._tmplFill ?? 1) : gw);
      tw[t] = tmpl.wt[t] * (opts._tmplFill ?? 1);
      if (w > 0) VS[t] = add(mul(unit(VS[t]), L * (1 - w)), mul(tv[t], L * w));
    }
    for (let t = 0; t < T; t++) {
      const F = Q[t], base = baseOf(F, a, t);
      let vec = mul(unit(VS[t]), L);
      if (wt[t] < 0.999) {                 // arm lost in the blur: the matched lab arm if there is one, else the bridged arm
        const fb = tw[t] > 0 ? unit(add(mul(unit(sub(F[b], base)), 1 - tw[t]), mul(tv[t], tw[t]))) : unit(sub(F[b], base));
        vec = mul(unit(add(mul(vec, wt[t]), mul(fb, L * (1 - wt[t])))), L);
      }
      const oldEnd = F[b], dl = sub(add(base, vec), oldEnd);
      F[b] = add(base, vec); carry.forEach(k => F[k] = add(F[k], dl));
      if (hand) {
        const fOld = unit(sub(oldEnd, base)), fNew = unit(vec), axis = cross(fOld, fNew), an = Math.acos(clamp(dot(fOld, fNew), -1, 1));
        hand.forEach(k => { const off = sub(F[k], oldEnd); F[k] = add(F[b], norm(axis) > 1e-9 ? rodrigues(off, axis, an) : off) });
      }
    }
  }
  return Q;
}

// ---------------------------------------------------------------- 2. angles
const S_ = 12, E_ = 14, W_ = 16, H_ = 24, K_ = 26, A_ = 28;     // throwing side (right, after mirroring)
const Sg = 11, Eg = 13, Wg = 15, Hl = 23, Kl = 25, Al = 27;    // glove / lead side
export function computeMetrics(P) {
  const T = P.length, M = {};
  const keys = ["throwElbow","gloveElbow","throwAbd","gloveAbd","throwER","throwHorz","leadKnee","backKnee","leadHip","backHip","pelvisRot","trunkRot","separation","trunkFwd","trunkLat","pelvisTilt"];
  keys.forEach(k => M[k] = new Array(T));
  const headingOf = r => { const h = unit([r[0], 0, r[2]]), f = cross([0, 1, 0], h); return Math.atan2(f[0], f[2]) * DEG };
  for (let t = 0; t < T; t++) {
    const J = P[t], shm = mid(J[11], J[12]), hpm = mid(J[23], J[24]), up = unit(sub(shm, hpm)), down = mul(up, -1);
    const fwd = unit(cross(up, unit(sub(J[12], J[11]))));
    M.throwElbow[t] = 180 - ang3(J[S_], J[E_], J[W_]);
    M.gloveElbow[t] = 180 - ang3(J[Sg], J[Eg], J[Wg]);
    M.throwAbd[t] = ang3(J[E_], J[S_], add(J[S_], down));
    M.gloveAbd[t] = ang3(J[Eg], J[Sg], add(J[Sg], down));
    { // layback (shoulder external rotation)
      const u = unit(sub(J[E_], J[S_])), f = unit(sub(J[W_], J[E_]));
      const a = unit(sub(fwd, mul(u, dot(fwd, u)))); let b = sub(up, mul(u, dot(up, u))); b = unit(sub(b, mul(a, dot(b, a))));
      M.throwER[t] = Math.atan2(dot(f, b), dot(f, a)) * DEG;
    }
    { // horizontal abduction (elbow behind the chest line +)
      let v = sub(J[E_], J[S_]); v = unit(sub(v, mul(up, dot(v, up))));
      let r = sub(J[12], J[11]); r = unit(sub(r, mul(up, dot(r, up))));
      M.throwHorz[t] = Math.atan2(-dot(v, fwd), dot(v, r)) * DEG;
    }
    M.leadKnee[t] = 180 - ang3(J[Hl], J[Kl], J[Al]);
    M.backKnee[t] = 180 - ang3(J[H_], J[K_], J[A_]);
    M.leadHip[t] = ang3(J[Kl], J[Hl], add(J[Hl], down));
    M.backHip[t] = ang3(J[K_], J[H_], add(J[H_], down));
    M.pelvisRot[t] = headingOf(sub(J[24], J[23]));
    M.trunkRot[t] = headingOf(sub(J[12], J[11]));
    M.trunkFwd[t] = Math.asin(clamp(up[0], -1, 1)) * DEG;
    M.trunkLat[t] = Math.asin(clamp(-up[2], -1, 1)) * DEG;
    M.pelvisTilt[t] = Math.asin(clamp(unit(sub(J[23], J[24]))[1], -1, 1)) * DEG;
  }
  const unwrap = arr => { const o = [arr[0]]; for (let i = 1; i < arr.length; i++) { let d = arr[i] - arr[i - 1]; d = ((d + 180) % 360 + 360) % 360 - 180; o.push(o[i - 1] + d) } return o };
  M.pelvisRot = unwrap(M.pelvisRot); M.trunkRot = unwrap(M.trunkRot); M.throwER = unwrap(M.throwER);
  M.separation = M.pelvisRot.map((v, t) => v - M.trunkRot[t]);
  return M;
}

// ---------------------------------------------------------------- 3. main processing
// The lead foot, once it lands, stays on that spot. When the swinging back leg hides it or the tracker trades the
// two legs' labels, the tracked "lead foot" wanders off and comes back. A first pass finds foot strike; then each
// frame after it is checked against the landing spot: traded labels are traded back, and a lead foot that leaves
// the spot only to return to it is held on the spot. A move to a new spot that lasts to the end of the clip is kept.
// How much a clip is slowed down, read from the motion itself: a delivery takes about 0.8 s from peak leg lift to
// release, and about 0.2 s from foot strike to release (as this software marks them), whatever the pitcher.
// Returns the nearest common slow-motion factor (1, 2, 4, 8 or 16).
export function detectSlowFactor(raw) {
  const vf = raw.videoFps || raw.fps;
  // look for release just after foot strike first, then further out. Searching the whole rest of the clip at once
  // can land on the follow-through (the arm swinging back up as he fields his position, or a camera zoom) and make
  // a normal-speed clip look slowed down. A release found well inside a short window is the real one; if the
  // fastest hand is at the end of the window the arm is still speeding up (slow motion), so look further.
  let d, ph;
  for (const w of [0.5, 1, 2, 4, 60]) {
    try { d = analyseOnce({ ...raw, fps: vf, videoFps: vf }, { _inner: true, relWindow: w, armBridge: false, depop: false }) } catch (e) { return { factor: 1, basis: "none" } }
    ph = Object.fromEntries(d.phases.map(p => [p.name, p.frame]));
    if ((ph["Release"] - ph["Foot strike"]) / vf < 0.75 * w) break;
  }
  const LL = ph["Peak leg lift"], FS = ph["Foot strike"], R = ph["Release"], T = d.pose.length;
  // the leg lift only counts if the clip shows it: the lead knee rising clearly above where it starts and where it
  // lands. A clip that starts after the peak (a phone video started late) only shows the knee coming down, and the
  // "peak" found there is somewhere on the way down, which makes the delivery look too short (reads as normal speed)
  const P = d.pose, K = d.throwHand === "L" ? 26 : 25;
  const kneeUp = t => P[t][K][1] - Math.min(...[27, 28, 29, 30, 31, 32].map(j => P[t][j][1]));
  let low = Infinity; for (let t = 0; t <= LL; t++) low = Math.min(low, kneeUp(t));
  const shown = LL >= 3 && kneeUp(LL) - Math.max(low, kneeUp(FS)) > 0.15;
  let est, basis;
  if (shown && R > LL + 2) { est = (R - LL) / vf / 0.8; basis = "leg lift to release" }
  else if (R > FS) {
    // a clip started after the leg lift only has foot strike to release to go on, and that gap (0.12-0.30 s) is too short to read reliably, so the throwing
    // hand's peak speed helps: in real time it's about 14 body heights a second. Clips cut to start 1/2 s before foot strike: wrong speed readings 24 -> 12 of 180.
    const Wr = d.throwHand === "L" ? 15 : 16, h = Math.max(1, Math.round((R - FS) / 8)), Y = P[FS].map(p => p[1]), H = Math.max(1e-6, Math.max(...Y) - Math.min(...Y));
    let pk = 0; for (let t = FS; t < Math.min(T - h, R + h); t++) { const a = P[t][Wr], b = P[t + h][Wr], sp = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / H * vf / h; if (sp > pk) pk = sp }
    est = (R - FS) / vf / 0.2; if (pk > 0) est = est ** 0.6 * (14 / pk) ** 0.4; basis = "foot strike to release" }
  else return { factor: 1, basis: "none" };
  const opts = [1, 2, 4, 8, 16];
  const factor = opts.reduce((b, f) => Math.abs(Math.log2(f) - Math.log2(est)) < Math.abs(Math.log2(b) - Math.log2(est)) ? f : b, 1);
  return { factor, estimate: est, basis };
}

export function analyse(raw, opts = {}) {
  if (opts.faithful === false || opts.footRepair === false || opts._inner) return analyseOnce(raw, opts);
  const first = analyseOnce(raw, { ...opts, _inner: true });
  const fsF = first.fsReach ?? first.phases.find(p => p.name === "Foot strike").frame, W = raw.width, H = raw.height;
  const lead = first.throwHand === "L" ? [28, 30, 32] : [27, 29, 31], back = lead.map(j => j - (first.throwHand === "L" ? 1 : -1));
  const kneeL = first.throwHand === "L" ? 26 : 25, kneeB = first.throwHand === "L" ? 25 : 26;
  const frames = raw.frames.map(f => f && { img: f.img.map(p => p.slice()), world: f.world.map(p => p.slice()), spread: f.spread });
  const T = frames.length, ft = (f, js) => { let x = 0, y = 0; for (const j of js) { x += f.img[j][0] * W; y += f.img[j][1] * H } return [x / js.length, y / js.length] };
  const hgt = median(frames.filter(Boolean).map(f => { const ys = f.img.map(p => p[1] * H); return Math.max(...ys) - Math.min(...ys) })) || H / 2;
  const near0 = []; for (let t = fsF + 1; t < Math.min(T, fsF + 1 + Math.round(raw.fps * 0.12)); t++) if (frames[t]) near0.push(t);
  if (!near0.length) return first;
  const spotJ = lead.map(j => [median(near0.map(t => frames[t].img[j][0])), median(near0.map(t => frames[t].img[j][1]))]);
  const spot = [spotJ.reduce((a, p) => a + p[0] * W, 0) / 3, spotJ.reduce((a, p) => a + p[1] * H, 0) / 3];
  const off = (f, js) => { const q = ft(f, js); return Math.hypot(q[0] - spot[0], q[1] - spot[1]) / hgt };
  let traded = 0, held = 0, leave = T - 1;
  for (let t = fsF; t < T; t++) {
    const f = frames[t]; if (!f) continue;
    if (off(f, back) < 0.12 && off(f, back) < off(f, lead)) {
      traded++;
      for (const [a, b] of [[kneeL, kneeB], ...lead.map((j, i) => [j, back[i]])]) for (const k of ["img", "world"]) { const x = f[k][a]; f[k][a] = f[k][b]; f[k][b] = x }
    }
  }
  const isNear = t => frames[t] && off(frames[t], lead) < 0.08;
  for (let t = fsF; t < T; t++) {
    if (isNear(t)) continue;
    let e = t; while (e < T && !isNear(e)) e++;
    if (e >= T) leave = t - 1;                      // left for good (a real step at the finish)
    if (e < T) {                                    // it came back to the landing spot: it never really left
      const a = t - 1, wa = frames[a], wb = frames[e];
      for (let u = t; u < e; u++) {
        const f = frames[u]; if (!f) continue; held++;
        const r = (u - a) / (e - a);
        lead.forEach((j, i) => { f.img[j][0] = spotJ[i][0]; f.img[j][1] = spotJ[i][1]; f.img[j][2] = Math.max(f.img[j][2], 0.5);
          if (wa && wb) f.world[j] = [0, 1, 2].map(k => (wa.world[j][k] - (wa.world[23][k] + wa.world[24][k]) / 2) * (1 - r) + (wb.world[j][k] - (wb.world[23][k] + wb.world[24][k]) / 2) * r + (f.world[23][k] + f.world[24][k]) / 2) });
      }
    }
    t = e;
  }
  const out = analyseOnce({ ...raw, frames }, { ...opts, _inner: true, _leadPlanted: [fsF, leave] });
  out.footRepair = { traded, held };
  return out;
}
function analyseOnce(raw, opts = {}) {
  // a frame with any broken number is treated as not tracked (filled from its neighbours)
  raw = { ...raw, frames: raw.frames.map(f => f && f.img && f.world && f.img.length === 33 && f.img.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])) && f.world.every(p => p.every(Number.isFinite)) ? f : null) };
  const fs = raw.fps, W = raw.width, H = raw.height, K = fs / 30;   // K scales frame-count constants to the sampling rate
  // left/right labels first, on the frames the tracker actually saw, before anything blends neighbouring frames (a
  // traded limb blended with its twin can't be untangled afterwards). The learned 3D motion is relabelled to match.
  let tracked = raw.frames.map(f => f ? { img: f.img.map(p => p.slice()), world: f.world.map(p => p.slice()), spread: f.spread ? f.spread.slice() : null } : null);
  let swaps = 0, l3 = raw.l3;
  if (opts.swapFix !== false) {
    tracked = fixSwaps(tracked, raw.width, raw.height); swaps = tracked.swapped || 0;
    // the learned model numbers its 17 joints differently from the tracker's 33 (H36 below), so each traded pair is
    // translated first. Swapping by the tracker's numbers traded the wrong joints (a shoulder with its own elbow, a
    // wrist with the other shoulder), scrambling the arm's depth on exactly the frames where the body was turned.
    if (l3 && tracked.swapLog.length) { l3 = l3.map(L => L && L.map(p => p.slice())); for (const [t, pairs] of tracked.swapLog) if (l3[t]) for (const [a, b] of pairs) { if (!(a in H36) || !(b in H36)) continue; const A = H36[a], B = H36[b], x = l3[t][A]; l3[t][A] = l3[t][B]; l3[t][B] = x } }
  }
  raw = { ...raw, frames: tracked, l3 };
  let frames = fillGaps(raw.frames).map(f => ({ img: f.img.map(p => p.slice()), world: f.world.map(p => p.slice()), spread: f.spread || null }));
  const learned = raw.l3 && opts.learned !== false ? injectLearnedDepth(frames, raw.l3.map((L, t) => raw.frames[t] ? L : null), opts.learnedParts === "all" ? null : new Set(opts.learnedParts || [11, 12, 13, 14, 15, 16])) : 0;
  // slow-motion clip: s video frames per step of a real-speed clip. The tracker's frame-to-frame wobble is the same as
  // on any clip, but the body barely moves between neighbouring frames, so average the wobble over about one real step.
  const slowF = raw.videoFps ? raw.fps / raw.videoFps : 1;
  if (slowF > 1.4 && opts.slowSmooth !== false) {
    const sg = 0.45 * slowF;
    for (let j = 0; j < 33; j++) {
      const im = gauss(frames.map(f => [f.img[j][0], f.img[j][1]]), sg), wd = gauss(frames.map(f => f.world[j]), sg);
      frames.forEach((f, t) => { f.img[j][0] = im[t][0]; f.img[j][1] = im[t][1]; f.world[j] = wd[t] });
    }
  }
  const faithful = opts.faithful !== false;            // follow the video; no modelled motion
  const measured = !!raw.measured;                    // several camera angles: depth is measured, not guessed
  if (opts.despike !== false) frames = despike(frames, K);
  const T = frames.length;
  if (T < 6) throw new Error("This clip is too short to analyse: it needs at least a few frames of the pitcher throwing.");
  const hand = opts.hand && opts.hand !== "auto" ? opts.hand : detectThrowingHand(frames, W, H);
  if (hand === "L") frames = mirrorFrames(frames);
  const fk = n => Math.max(1, Math.round(n * K));

  // lift and convert to y-up (x right, y up, z toward camera)
  const { P: Pc, imgSmooth, scale: liftScale } = lift(frames, W, H, fs, { ...opts, measured });
  let P = Pc.map(F => F.map(p => [p[0], -p[1], -p[2]]));
  if (!measured) for (let j = 0; j < 33; j++) { const sm = oe(P.map(F => F[j]), fs); for (let t = 0; t < T; t++) P[t][j] = sm[t] }

  // rotate so the stride (back ankle -> lead ankle) points +x
  let fmax = 0, smax = -1;
  P.forEach((F, t) => { const d = sub(F[27], F[28]), l = Math.hypot(d[0], d[2]); if (l > smax) { smax = l; fmax = t } });
  // pitchers don't stride straight at the plate: in 404 lab fastballs the stride points 7.4° off the line to home on
  // average (spread 6.6°), so home is taken as the stride direction turned back by that much
  const sd = sub(P[fmax][27], P[fmax][28]), ang = Math.atan2(sd[2], sd[0]) - (opts.strideOff ?? 7.4) * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
  const rot0 = p => [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]], unrot0 = p => [c * p[0] - s * p[2], p[1], s * p[0] + c * p[2]];
  // camera looking down or up at the pitcher (degrees; off by default): the skeleton is otherwise built as if the camera were level
  const th0 = (opts._camTilt ?? 0) * Math.PI / 180, ax0 = unit((p => [p[2], 0, -p[0]])(rot0([0, 0, 1])));
  const tipBy = (p, th) => { if (!th) return p; const cs = Math.cos(th), sn = Math.sin(th), ax = ax0, x = [ax[1] * p[2] - ax[2] * p[1], ax[2] * p[0] - ax[0] * p[2], ax[0] * p[1] - ax[1] * p[0]], d = dot(ax, p); return p.map((v, i) => v * cs + x[i] * sn + ax[i] * d * (1 - cs)) };
  const rot = p => tipBy(rot0(p), th0), unrot = p => unrot0(tipBy(p, -th0));
  P = P.map(F => F.map(rot));
  const camDir = rot([0, 0, 1]);

  if (opts._snap) opts._snap("rot", P, { imgSmooth, liftScale, rot, camDir });
  // ---- phases (auto, or given)
  const lowFeet = F => Math.min(...[27, 28, 29, 30, 31, 32].map(j => F[j][1]));
  const floor0 = gauss(P.map(lowFeet), 2 * K);
  const kneeH = P.map((F, t) => F[Kl][1] - floor0[t]);
  let legLift = 0; for (let t = 0; t <= fmax; t++) if (kneeH[t] > kneeH[legLift]) legLift = t;
  // foot strike: the lead foot stops reaching forward relative to the hips (max forward reach after leg lift)
  const reach = P.map(F => F[Al][0] - mid(F[23], F[24])[0]);
  let fs_ = legLift; for (let t = legLift + 1; t < T; t++) if (reach[t] > reach[fs_]) fs_ = t;
  if (fs_ >= T - fk(4)) fs_ = Math.min(T - fk(6), Math.max(legLift + fk(6), fmax));
  fs_ = clamp(fs_, 1, Math.max(1, T - 3));             // short or slow-motion clips: keep every phase inside the clip
  // the foot stops reaching forward a few frames BEFORE it lands. Foot contact (as the research defines it) is the
  // first frame the lead foot is actually down: within 1.5 cm of the height it settles at once planted.
  // (the skeleton is still built round the reach frame; only the reported Foot strike moves to the contact frame)
  let contactF = fs_;     // set on the finished skeleton (feet anchored to the ground), below
  // release: fastest throwing hand on screen within 0.5 s after foot strike
  // wrist travel over three frames, so a repeated frame followed by a catch-up jump (screen recordings) can't look like release
  const k3 = Math.max(1, Math.round(1.5 * K)), wsp = imgSmooth.map((F, t) => { const a = imgSmooth[Math.max(0, t - k3)], b = imgSmooth[Math.min(T - 1, t + k3)]; return Math.hypot(b[W_][0] - a[W_][0], b[W_][1] - a[W_][1]) });
  let rel = fs_ + 1; for (let t = fs_ + 1; t < Math.min(T - 1, fs_ + Math.round((opts.relWindow || 0.5) * fs)); t++) if (wsp[t] > wsp[rel]) rel = t;
  // the ball can only leave the hand after the arm is cocked (hand at its highest above the shoulder). If the fastest
  // hand motion comes before that (a tracking glitch, or the arm swinging up in a speed-ramped slow-motion video),
  // release is the fastest motion after the cocked point instead
  let relFrom = fs_ + 1;                                   // release can't come before this (set below: the cocked point)
  if (opts.relTop !== false) {
    const wEnd = Math.min(T - 1, fs_ + Math.round((opts.relWindow || 0.5) * fs));
    let top = fs_ + 1; for (let t = fs_ + 1; t <= wEnd; t++) if (imgSmooth[t][W_][1] - imgSmooth[t][S_][1] < imgSmooth[top][W_][1] - imgSmooth[top][S_][1]) top = t;
    relFrom = Math.max(relFrom, top - Math.round(0.03 * fs));
    if (rel < top) { let r2 = top; for (let t = top; t < Math.min(T - 1, top + Math.round(0.35 * fs)); t++) if (wsp[t] > wsp[r2]) r2 = t; rel = r2 }
    if (opts._dbgRel) opts._dbgRel.push({ step: "top", top, rel, fs_, wEnd, K })
  }
  // with the learned 3D model: release is just after the hand's fastest moment in 3D (lab: 8 ms after, spread 6 ms).
  // Speed on screen alone peaks early or late depending on where the camera is (up to 3 frames off at 60 fps;
  // tested on 60 lab pitches seen from 5 camera angles: within 1 frame went from 19 to 31 of 60).
  if (raw.l3 && opts.rel3d !== false) {
    const wj = hand === "L" ? 13 : 16, L3 = raw.l3, ok = t => L3[t - 1] && L3[t + 1];
    const sp3 = t => ok(t) ? Math.hypot(...[0, 1, 2].map(d => L3[t + 1][wj][d] - L3[t - 1][wj][d])) : -1;
    let best = -1, at = rel; for (let t = relFrom; t < Math.min(T - 1, Math.max(relFrom + Math.round(0.35 * fs), fs_ + Math.round((opts.relWindow || 0.5) * fs))); t++) { const v = sp3(t); if (v > best) { best = v; at = t } }
    // the 3D model is better on average but can run late on a blurred real arm: take the midpoint of the two
    if (opts._dbgRel) opts._dbgRel.push({ step: "l3", at, rel });
    if (best > 0) rel = clamp(Math.round((at - 0.012 * fs + rel) / 2), fs_ + 1, T - 2);
  }
  // measured 3D (several cameras, OpenCap): release from the hand's real 3D speed (lab: 8 ms after its peak)
  if (measured && opts.rel3d !== false) {
    let best = -1, at = rel;
    for (let t = fs_ + 1; t < Math.min(T - 1, fs_ + Math.round((opts.relWindow || 0.5) * fs)); t++) { const v = norm(sub(frames[t + 1].world[W_], frames[t - 1].world[W_])); if (v > best) { best = v; at = t } }
    rel = clamp(at + Math.round(0.008 * fs), fs_ + 1, T - 2);
    if (opts._dbgRel) opts._dbgRel.push({ at, rel, fs_ })
  }
  let cock = fs_; for (let t = fs_; t < rel; t++) if (P[t][W_][1] - P[t][S_][1] > P[cock][W_][1] - P[cock][S_][1]) cock = t;
  const userFS = !!(opts.phases && opts.phases.footStrike != null);
  if (opts.phases) ({ legLift = legLift, footStrike: fs_ = fs_, armCocked: cock = cock, release: rel = rel } = opts.phases);
  fs_ = clamp(fs_, 1, T - 3); rel = clamp(rel, fs_ + 1, T - 2); cock = clamp(cock, fs_, rel); legLift = clamp(legLift, 0, fs_ - 1);

  // ---- throwing arm: which way it points toward/away from the camera, decided with how arms move.
  // When the forearm or upper arm passes edge-on to the camera, both depth directions look identical on screen and
  // the tracker often picks the wrong one: the forearm then rolls forward early instead of staying laid back.
  // For each frame the four mirror choices (upper arm, forearm) are scored on: agreeing with the tracker where the
  // bone clearly points toward or away from it, moving continuously, and the throwing pattern every overhand or
  // sidearm pitcher shares: from foot strike until just before release the forearm stays laid back (behind the
  // upper arm), and the elbow never sits far behind the back or across the chest. The screen positions never change.
  let armFlips = 0;
  if (faithful && opts.armDepth !== false && !measured) {
    const camZ = camDir, Sx = 12, Ex = 14, Wx = 16, FG = [18, 20, 22];
    const refl = v => sub(v, mul(camZ, 2 * dot(v, camZ)));
    const Lu = median(P.map(F => norm(sub(F[Ex], F[Sx])))), Lf = median(P.map(F => norm(sub(F[Wx], F[Ex]))));
    const lo = Math.max(1, fs_ - fk(6)), hi = Math.min(T - 1, rel + fk(6));
    const cand = [], cost = [];
    for (let t = lo; t <= hi; t++) {
      const F = P[t], u0 = unit(sub(F[Ex], F[Sx])), f0 = unit(sub(F[Wx], F[Ex]));
      const up = unit(sub(mid(F[11], F[12]), mid(F[23], F[24]))); let r = sub(F[12], F[11]); r = unit(sub(r, mul(up, dot(r, up)))); const fw = cross(up, r);
      const C = [], K = [];
      for (const [fu, ff] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        const u = fu ? refl(u0) : u0, f = ff ? refl(f0) : f0;
        const E = add(F[Sx], mul(u, Lu)), W = add(E, mul(f, Lf));
        const a = unit(sub(fw, mul(u, dot(fw, u)))); let b = sub(up, mul(u, dot(up, u))); b = unit(sub(b, mul(a, dot(b, a))));
        let er = Math.atan2(dot(f, b), dot(f, a)) * DEG; if (er < -120) er += 360;
        const hz = Math.atan2(-dot(u, fw), dot(u, r)) * DEG;
        let k = 0.6 * (fu ? dot(u0, camZ) ** 2 : 0) + 0.6 * (ff ? dot(f0, camZ) ** 2 : 0);          // tracker's depth, where it's clear
        if (t >= fs_ + fk(1) && t <= rel - fk(3)) k += (Math.max(0, 80 - er) / 35) ** 2;            // laid back until release
        k += (Math.max(0, hz - 60) / 25) ** 2 + (Math.max(0, -hz - 100) / 25) ** 2;                  // elbow not far behind / across
        C.push({ E, W, u, f }); K.push(k);
      }
      cand.push(C); cost.push(K);
    }
    const n = cand.length, step = 15 / fs;
    if (n > 2) {
      let D = cost[0].slice(); const bk = [];
      for (let i = 1; i < n; i++) {
        const nd = [], b2 = [];
        for (let s = 0; s < 4; s++) {
          let best = Infinity, arg = 0;
          for (let q = 0; q < 4; q++) { const j = (norm(sub(cand[i][s].E, cand[i - 1][q].E)) + norm(sub(cand[i][s].W, cand[i - 1][q].W))) / step; const v = D[q] + Math.min(16, j * j); if (v < best) { best = v; arg = q } }
          nd.push(best + cost[i][s]); b2.push(arg);
        }
        D = nd; bk.push(b2);
      }
      const st = new Array(n); st[n - 1] = D.indexOf(Math.min(...D));
      for (let i = n - 1; i > 0; i--) st[i - 1] = bk[i - 1][st[i]];
      for (let i = 0; i < n; i++) if (st[i]) {
        armFlips++;
        const F = P[lo + i], c = cand[i][st[i]], oldW = F[Wx], fOld = unit(sub(F[Wx], F[Ex]));
        F[Ex] = c.E; F[Wx] = c.W;
        const axis = cross(fOld, c.f), an = Math.acos(clamp(dot(fOld, c.f), -1, 1));
        FG.forEach(k => { const off = sub(F[k], oldW); F[k] = add(c.W, norm(axis) > 1e-9 ? rodrigues(off, axis, an) : off) });
      }
    }
  }

  if (opts._snap) opts._snap("armDepth", P, { imgSmooth, liftScale, rot, camDir });
  // ---- constant, symmetric bone lengths
  const BL = {};
  TREE.forEach(([a, b]) => { BL[a + "," + b] = median(P.map(F => norm(sub(nodeOf(F, b), nodeOf(F, a))))) });
  TREE.forEach(([a, b]) => { const k = mir(a) + "," + mir(b); if (k in BL && k !== a + "," + b) { const m = (BL[a + "," + b] + BL[k]) / 2; BL[a + "," + b] = BL[k] = m } });
  // real body size and proportions. Measured on 411 pitches in a motion-capture lab (Driveline OpenBiomechanics): each
  // segment is a steady share of standing height (upper arm 18.2%, forearm 14.3%, thigh 24.7%, shin 24.8%, hips to
  // shoulders 29.2%, between the shoulders 18.0%, between the hips 15.2%; spread 3-7%). The tracker's own lengths are
  // biased (its upper arm comes out ~15% short, its shoulders too wide), and the whole body comes out too small.
  // With the pitcher's height entered, the skeleton gets its true size; either way the proportions are pulled to the lab's.
  let sizeK = 1, heightM = null, bodyH = null;
  if (opts.proportions !== false) {
    const RATIO = { "-2,-1": 0.292, "-1,11": 0.0898, "-1,12": 0.0898, "11,13": 0.1818, "12,14": 0.1818, "13,15": 0.1429, "14,16": 0.1429,
                    "-2,23": 0.076, "-2,24": 0.076, "23,25": 0.2471, "24,26": 0.2471, "25,27": 0.2484, "26,28": 0.2484 };
    const W8 = k => k.startsWith("-2,2") ? 0.5 : 0.7;
    const est = median(["13,15", "23,25", "25,27", "-2,-1"].map(k => BL[k] / RATIO[k]));
    heightM = raw.heightIn > 40 && raw.heightIn < 96 ? raw.heightIn * 0.0254 : (opts.heightIn > 40 ? opts.heightIn * 0.0254 : null);
    const Hm = heightM || est; sizeK = Hm / est; bodyH = Hm;
    for (const k in BL) BL[k] = k in RATIO ? W8(k) * RATIO[k] * Hm + (1 - W8(k)) * sizeK * BL[k] : sizeK * BL[k];
    if (sizeK !== 1) { P = P.map(F => F.map(p => mul(p, sizeK))); for (let t = 0; t < liftScale.length; t++) liftScale[t] *= sizeK }
  }
  P = P.map(F => {
    const n = { "-2": nodeOf(F, -2) }, G = F.map(p => p.slice());
    TREE.forEach(([a, b]) => { n[b] = add(n[a], mul(unit(sub(nodeOf(F, b), nodeOf(F, a))), BL[a + "," + b])) });
    for (const k in n) if (+k >= 0) G[+k] = n[k];
    const off = sub(n[-1], nodeOf(F, -1));
    for (let k = 0; k <= 10; k++) G[k] = add(F[k], off);
    return G;
  });
  const boneLen = (a, b) => BL[a + "," + b];

  const FOOT_R = 0.028, RUB_TOP = 0.02;
  let DROP = 0.12, settle = Math.min(T - 1, fs_ + fk(2)), contact = null;
  if (opts._snap) opts._snap("bones", P, { imgSmooth, liftScale, rot, camDir });
  // ---- planted feet + legs (two-bone IK with constant lengths and a steady knee direction)
  const POLES = {};
  const legIK = (t, hip, knee, ank, extra, target, reachMax = 0.9999) => {
    const Hh = P[t][hip], l1 = boneLen(hip, knee), l2 = boneLen(knee, ank);
    let dv = sub(target, Hh); const d = Math.min(norm(dv), reachMax * (l1 + l2)); const u = unit(dv);
    const At = add(Hh, mul(u, d));
    let pole = POLES[knee] ? POLES[knee][t] : sub(P[t][knee], Hh);
    pole = unit(sub(pole, mul(u, dot(pole, u))));
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
    P[t][knee] = add(add(Hh, mul(u, a)), mul(pole, h));
    const delta = sub(At, P[t][ank]);
    [ank, ...extra].forEach(k => P[t][k] = add(P[t][k], delta));
  };
  const holdShape = (t, ank, pts, shape, w) => pts.forEach((k, i) => { const tgt = add(P[t][ank], shape[i]); P[t][k] = add(P[t][k], mul(sub(tgt, P[t][k]), w)) });
  const makePoles = (hip, knee, ank, thr) => {
    let last = null;
    const raw = P.map(F => { const u = unit(sub(F[ank], F[hip])); let p = sub(F[knee], F[hip]); p = sub(p, mul(u, dot(p, u))); const n = norm(p); if (n > thr || !last) last = mul(p, 1 / (n || 1)); return last.slice() });
    POLES[knee] = gauss(raw, faithful ? 3 * K : K).map(unit);     // a knee changes the way it bends slowly
  };
  if (!faithful) {
  // ---- travel down the mound: forward-only, from whichever foot is planted
  const bpin = [0], lpin = [0], zoff = [0];
  for (let t = 1; t < T; t++) {
    bpin.push(bpin[t - 1] - (P[t][A_][0] - P[t - 1][A_][0]));
    lpin.push(lpin[t - 1] - (P[t][Al][0] - P[t - 1][Al][0]));
    const a = t <= fs_ ? A_ : Al; zoff.push(zoff[t - 1] - (P[t][a][2] - P[t - 1][a][2]));
  }
  const sw = Math.min(T - 1, rel + 1);
  const inc = bpin.map((_, t) => {
    if (t === 0) return 0;
    const db = bpin[t] - bpin[t - 1], dl = lpin[t] - lpin[t - 1];
    return t <= fs_ + fk(4) ? db : t <= sw ? 0.6 * db + 0.4 * dl : dl;
  });
  let cum = 0; const offxRaw = inc.map(v => (cum += v));
  const offx = gauss(pava(offxRaw), 2.8 * K), offz = gauss(zoff, 5 * K);
  const lowB = P.map(F => Math.min(F[28][1], F[30][1], F[32][1])), lowL = P.map(F => Math.min(F[27][1], F[29][1], F[31][1]));
  const dd = []; for (let t = fs_ + 1; t <= rel; t++) dd.push(lowB[t] - lowL[t]);
  DROP = clamp(median(dd), 0.05, 0.22);
  const ramp = P.map((_, t) => sstep(t, fs_ - fk(4), fs_ + fk(4)));
  const offy = gauss(P.map((_, t) => DROP * (1 - ramp[t]) + FOOT_R - (lowB[t] * (1 - ramp[t]) + lowL[t] * ramp[t])), 2 * K);
  P = P.map((F, t) => F.map(p => [p[0] + offx[t], p[1] + offy[t], p[2] + offz[t]]));

  for (const j of [25, 26]) { const sm = oe(P.map(F => F[j]), fs); P.forEach((F, t) => F[j] = sm[t]) }
  makePoles(23, 25, 27, 0.03); makePoles(24, 26, 28, 0.03);
  const Dlead = P.map(F => F[Al].slice()), Dback = P.map(F => F[A_].slice());
  const backLock = P[0][A_].slice(), setLow = Math.min(P[0][30][1], P[0][32][1]);
  settle = Math.min(T - 1, fs_ + fk(2));
  const leadLock = P[settle][Al].slice();
  const footLen = median(P.map(F => norm(sub(F[32], F[30]))));
  const backShape = [[0, P[0][30][1] - P[0][A_][1], -0.3 * footLen], [0, P[0][32][1] - P[0][A_][1], 0.7 * footLen]];
  const leadShape = [sub(P[settle][29], P[settle][Al]), sub(P[settle][31], P[settle][Al])];
  leadLock[1] += FOOT_R - Math.min(leadLock[1] + leadShape[0][1], leadLock[1] + leadShape[1][1]);
  const dragEnd = Math.min(T - 1, rel + 1);
  const l0 = Math.max(fs_ - fk(5), 1), l1_ = Math.min(T - 1, fs_);
  const vin = sub(Dlead[l0], Dlead[l0 - 1]);
  const leadTgt = Dlead.map((p, t) => t < l0 ? p : t >= l1_ ? leadLock : hermite(Dlead[l0], vin, leadLock, [0, 0, 0], l1_ - l0, t - l0));
  const r1 = Math.min(T - 1, dragEnd + fk(6)), achieved = [];
  for (let t = 0; t < T; t++) {
    let tgt;
    if (t <= dragEnd) { tgt = backLock.slice(); if (t > fs_) tgt[1] = setLow + (P[t][A_][1] - Math.min(P[t][30][1], P[t][32][1])) }
    else if (t < r1) { const p0 = achieved[dragEnd], v0 = sub(achieved[dragEnd], achieved[dragEnd - 1]); tgt = hermite(p0, v0, Dback[r1], sub(Dback[r1], Dback[r1 - 1]), r1 - dragEnd, t - dragEnd) }
    else tgt = Dback[t];
    legIK(t, 24, 26, 28, [30, 32], tgt, t <= dragEnd ? 0.988 : 0.9999);
    achieved[t] = P[t][A_].slice();
    const wsh = 1 - sstep(t, fs_, fs_ + fk(6));
    if (wsh > 0) holdShape(t, 28, [30, 32], backShape, wsh);
    legIK(t, 23, 25, 27, [29, 31], leadTgt[t]);
    const wl = sstep(t, l0, l1_ + 1);
    if (wl > 0) holdShape(t, 27, [29, 31], leadShape, wl);
  }
  for (const j of [23, 24, 27, 28, 29, 30, 31, 32]) { const sm = oe(P.map(F => F[j]), fs); P.forEach((F, t) => F[j] = sm[t]) }
  for (let t = 0; t < T; t++) { legIK(t, 23, 25, 27, [29, 31], P[t][27].slice()); legIK(t, 24, 26, 28, [30, 32], P[t][28].slice(), 0.99) }

  } else {
  // ---- travel straight from the video: the hips move exactly as far as they do on screen
  // (any camera pan is taken out using whichever foot is planted); depth travel from the planted foot
  const FEET = [[27, 29, 31], [28, 30, 32]];                       // lead, back (after mirroring)
  const hipPx = imgSmooth.map(F => [(F[23][0] + F[24][0]) / 2, (F[23][1] + F[24][1]) / 2]);
  const hPx = median(imgSmooth.map(F => { let lo = Infinity, hi = -Infinity; for (const p of F) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]) } return hi - lo })) || H / 2;
  const fp = FEET.map(js => imgSmooth.map(F => [(F[js[0]][0] + F[js[1]][0] + F[js[2]][0]) / 3, Math.max(F[js[0]][1], F[js[1]][1], F[js[2]][1])]));
  const dif = (arr, t, f) => { const a = Math.max(0, t - 1), b = Math.min(T - 1, t + 1); return f(arr[b], arr[a]) / ((b - a) || 1) };
  const fv = fp.map(arr => arr.map((_, t) => [dif(arr, t, (b, a) => b[0] - a[0]), dif(arr, t, (b, a) => b[1] - a[1])]));
  contact = FEET.map((_, f) => gauss(fp[f].map((p, t) => {
    const speed = Math.hypot(fv[f][t][0], fv[f][t][1]) * fs / hPx;          // body heights per second
    const lowest = Math.max(fp[0][t][1], fp[1][t][1]), up = (lowest - p[1]) / hPx;
    return (1 - sstep(speed, 0.25, 0.7)) * (1 - sstep(up, 0.07, 0.15));
  }), K));
  if (opts._leadPlanted) { const [a, b] = opts._leadPlanted; contact[0] = contact[0].map((w, t) => Math.max(w, sstep(t, a - fk(2), a + fk(2)) * (1 - sstep(t, b - fk(3), b + fk(3))))) }
  const wsum = P.map((_, t) => contact[0][t] + contact[1][t]);
  const sg = 0.2 * fs, den = gauss(wsum, sg);
  const pnum = gauss(P.map((_, t) => [contact[0][t] * fv[0][t][0] + contact[1][t] * fv[1][t][0], contact[0][t] * fv[0][t][1] + contact[1][t] * fv[1][t][1]]), sg);
  let pan = pnum.map((v, t) => den[t] > 0.05 ? [v[0] / den[t], v[1] / den[t]] : [0, 0]);
  { let ax = 0, ay = 0, mx = 0; pan.forEach(v => { ax += v[0]; ay += v[1]; mx = Math.max(mx, Math.hypot(ax, ay)) }); if (mx < 0.06 * hPx) pan = pan.map(() => [0, 0]) }
  // before foot strike only the back foot can be "planted", and it drags forward in a real stride: a small apparent
  // pan there is the drag, not the camera (reading it as pan took 9% of height off the stride). After foot strike the
  // lead foot is a reliable reference, so pan stays on there (removing it too made the front knee read too straight).
  { let ax = 0, ay = 0, mx = 0; for (let t = 0; t <= fs_ && t < T; t++) { ax += pan[t][0]; ay += pan[t][1]; mx = Math.max(mx, Math.hypot(ax, ay)) }
    if (mx < 0.2 * hPx) { const r = Math.max(1, Math.round(0.05 * fs)); pan = pan.map((v, t) => { const k = sstep(t, fs_, fs_ + r); return [v[0] * k, v[1] * k] }) } }
  const dv = FEET.map(js => P.map((_, t) => dif(P, t, (b, a) => dot(sub(b[js[0]], a[js[0]]), camDir))));
  const dnum = gauss(P.map((_, t) => -(contact[0][t] * dv[0][t] + contact[1][t] * dv[1][t])), sg);
  // before foot strike the only planted foot is the back one, and it's dragging toward the plate: depth travel read from
  // it comes out short (a stride filmed from behind read 20 cm short). Boosted there only (x1.25, measured on 60 lab
  // views), off after foot strike: the lead foot is a true anchor there, and boosting it too straightened the front knee.
  const vdepth = dnum.map((v, t) => (den[t] > 0.05 ? v / den[t] : 0) * (1 + 0.25 * (1 - sstep(t, fs_, fs_ + Math.max(1, Math.round(0.05 * fs))))));
  const root = []; { let cx = 0, cy = 0, rd = 0;
    for (let t = 0; t < T; t++) {
      if (t > 0) { const sc = liftScale[t]; cx += (hipPx[t][0] - hipPx[t - 1][0] - pan[t][0]) * sc; cy -= (hipPx[t][1] - hipPx[t - 1][1] - pan[t][1]) * sc; rd += vdepth[t] }
      root.push(add(rot([cx, cy, 0]), mul(camDir, rd)));
    } }
  if (measured && raw.travel) {                       // measured hip path from all the cameras (camera axes -> ours)
    const h0 = raw.travel[0];
    const sx = hand === "L" ? -1 : 1;                 // left-handers are analysed mirrored
    for (let t = 0; t < T; t++) { const d = raw.travel[t]; root[t] = rot([sx * (d[0] - h0[0]), -(d[1] - h0[1]), -(d[2] - h0[2])]) }
  }
  P = P.map((F, t) => F.map(p => add(p, root[t])));

  // ---- ground: measured from where each foot actually stands (the mound drop comes from the video)
  const lowOf = js => P.map(F => Math.min(F[js[0]][1], F[js[1]][1], F[js[2]][1]));
  const lowL = lowOf(FEET[0]), lowB = lowOf(FEET[1]);
  const wmed = (vals, ws, lo, hi) => { const a = []; for (let t = Math.max(0, lo); t < Math.min(T, hi); t++) if (ws[t] > 0.5) a.push(vals[t]); return a.length ? median(a) : null };
  let gL = wmed(lowL, contact[0], fs_, T), gB = wmed(lowB, contact[1], 0, fs_ + 1);
  if (gL == null) gL = Math.min(...lowL.slice(fs_)); if (gB == null) gB = Math.min(...lowB.slice(0, fs_ + 1));
  DROP = clamp(gB - gL, 0.03, 0.25);
  P = P.map(F => F.map(p => [p[0], p[1] - gL + FOOT_R, p[2]]));

  // ---- planted feet held steady (only while the video shows them still), legs by IK with constant lengths
  // a planted foot doesn't move: each stretch of contact is pinned to one point (its median), blended in by the contact weight
  for (let f = 0; f < 2; f++) {
    const js = FEET[f], A = P.map(F => F[js[0]].slice()), anchor = A.map(p => p.slice());
    for (let t = 0; t < T; t++) {
      if (contact[f][t] < 0.5) continue;
      let e = t; while (e < T && contact[f][e] >= 0.5) e++;
      const seg = A.slice(t, e), m = [0, 1, 2].map(k => median(seg.map(p => p[k])));
      for (let u = Math.max(0, t - fk(6)); u < Math.min(T, e + fk(6)); u++) anchor[u] = m;
      t = e;
    }
    for (let t = 0; t < T; t++) { const w = contact[f][t]; if (w <= 0.01) continue; const d = mul(sub(anchor[t], P[t][js[0]]), w); js.forEach(k => P[t][k] = add(P[t][k], d)) }
  }
  for (const j of [25, 26]) { const sm = oe(P.map(F => F[j]), fs); P.forEach((F, t) => F[j] = sm[t]) }
  makePoles(23, 25, 27, 0.03); makePoles(24, 26, 28, 0.03);
  for (const j of [23, 24, 27, 28, 29, 30, 31, 32]) { const sm = oe(P.map(F => F[j]), fs); P.forEach((F, t) => F[j] = sm[t]) }
  for (let t = 0; t < T; t++) { legIK(t, 23, 25, 27, [29, 31], P[t][27].slice()); legIK(t, 24, 26, 28, [30, 32], P[t][28].slice()) }
  }
  if (opts._snap) opts._snap("feet", P, { imgSmooth, liftScale, rot, camDir });
  // ---- upper body: trunk/head, hands as direction + reach (blur frames bridged), elbows by IK
  if (!measured) for (const j of [11, 12, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) { const sm = oe(P.map(F => F[j]), fs); P.forEach((F, t) => F[j] = sm[t]) }
  let BLUR = [rel - 1, rel, rel + 1].filter(t => t > 0 && t < T - 1);
  if (faithful && BLUR.filter(t => (frames[t].img[16][2] ?? 1) < 0.5).length < 2) BLUR = [];   // bridge only frames the tracker couldn't see
  const FING = { 15: [17, 19, 21], 16: [18, 20, 22] };
  for (const [sh, el, wr] of [[11, 13, 15], [12, 14, 16]]) {
    const arm = boneLen(sh, el) + boneLen(el, wr);
    let dir = P.map(F => unit(sub(F[wr], F[sh]))), rch = P.map(F => norm(sub(F[wr], F[sh])) / arm);
    if (wr === 16 && BLUR.length) {
      const t0 = BLUR[0] - 1, t1 = BLUR[BLUR.length - 1] + 1;
      if (t0 >= 0 && t1 < T) BLUR.forEach(t => { const u = (t - t0) / (t1 - t0); dir[t] = slerp(dir[t0], dir[t1], u); rch[t] = rch[t0] + (rch[t1] - rch[t0]) * u });
    }
    if (!measured) { dir = oe(dir, fs, { beta: 12 }).map(unit); rch = oe(rch, fs, { beta: 12 }) }
    rch = rch.map(v => clamp(v, 0.3, measured ? 0.999 : faithful ? 0.985 : 0.96));      // ~20° elbow at full reach
    for (let t = 0; t < T; t++) { const tgt = add(P[t][sh], mul(dir[t], rch[t] * arm)), dl = sub(tgt, P[t][wr]); [wr, ...FING[wr]].forEach(k => P[t][k] = add(P[t][k], dl)) }
    if (!measured) { const sm = oe(P.map(F => F[el]), fs); P.forEach((F, t) => F[el] = sm[t]) }
    let last = null;
    let poles = P.map(F => { const u = unit(sub(F[wr], F[sh])); let p = sub(F[el], F[sh]); p = sub(p, mul(u, dot(p, u))); const n = norm(p); if (n > 0.025 || !last) last = mul(p, 1 / (n || 1)); return last.slice() });
    if (el === 14 && BLUR.length) { const t0 = BLUR[0] - 1, t1 = BLUR[BLUR.length - 1] + 1; if (t0 >= 0 && t1 < T) BLUR.forEach(t => poles[t] = slerp(unit(poles[t0]), unit(poles[t1]), (t - t0) / (t1 - t0))) }
    POLES[el] = (measured ? poles : gauss(poles, K)).map(unit);
  }
  for (let t = 0; t < T; t++) { legIK(t, 11, 13, 15, FING[15], P[t][15].slice()); legIK(t, 12, 14, 16, FING[16], P[t][16].slice()) }

  if (opts._snap) opts._snap("upper", P, { imgSmooth, liftScale, rot, camDir });
  // ---- limbs the camera couldn't see (motion blur at release, a leg whipping through): a limb is treated as unseen
  // where the tracking looks disagree about its middle or end joint, where the frame wasn't tracked, or where a joint
  // would have to move faster than a body can (throwing hand 50 m/s and elbow 25, glove hand 18 and elbow 12, foot 20, knee 12). Unseen stretches are filled
  // the way a limb moves between the clear frames either side: full length, the upper bone swinging round the
  // shoulder/hip in the body's own frame (so it turns with the body), the elbow/knee bending smoothly, and the lower
  // bone rotating about the upper one in the direction it was already turning. Every curve joins the clear frames
  // with matching speed, so there is no snap where the tracking takes over again.
  let bridged = 0, armModelled = 0; const unseen = {};
  if (faithful && opts.armBridge !== false) {
    const TH = opts.armSpread ?? 0.06, maxGap = Math.round(0.3 * fs);
    // a frame that wasn't tracked because it repeats the one before it (or a short gap) takes the agreement of the real
    // frames either side; only a long untracked stretch counts as a limb the camera couldn't see
    const spOf = (f, j) => f.spread ? f.spread[hand === "L" ? mir(j) : j] ?? 0 : 0;
    const sp = (t, j) => { const f = raw.frames[t]; if (f) return spOf(f, j);
      let a = t - 1; while (a >= 0 && !raw.frames[a] && t - a <= 12) a--; let b = t + 1; while (b < T && !raw.frames[b] && b - t <= 12) b++;
      const A = a >= 0 && raw.frames[a] ? spOf(raw.frames[a], j) : null, B = b < T && raw.frames[b] ? spOf(raw.frames[b], j) : null;
      return A == null && B == null ? 1 : Math.max(A ?? 0, B ?? 0) };
    const trunkB = F => { const up = unit(sub(mid(F[11], F[12]), mid(F[23], F[24]))); let r = sub(F[12], F[11]); r = unit(sub(r, mul(up, dot(r, up)))); return { up, r, fw: cross(up, r) } };
    const pelvisB = F => { const up = unit(sub(mid(F[11], F[12]), mid(F[23], F[24]))); let r = sub(F[24], F[23]); r = unit(sub(r, mul(up, dot(r, up)))); return { up, r, fw: cross(up, r) } };
    const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
    // the lower bone's turn about the upper bone is measured from a reference the upper bone never lines up with:
    // the chest's forward direction for an arm, the hip line for a leg (a thigh hangs along "up", so up can't be used)
    const frameAbout = (u, B, leg) => { const ref = leg ? B.r : B.fw, a = unit(sub(ref, mul(u, dot(ref, u)))); return [a, cross(u, a)] };
    const params = (t, Sh, El, Wr, basis, leg) => {
      const F = P[t], B = basis(F), u = unit(sub(F[El], F[Sh])), f = unit(sub(F[Wr], F[El]));
      const [a, b] = frameAbout(u, B, leg);
      return { u: [dot(u, B.fw), dot(u, B.up), dot(u, B.r)], fl: Math.acos(clamp(dot(u, f), -1, 1)) * DEG, er: Math.atan2(dot(f, b), dot(f, a)) * DEG };
    };
    const LIMBS = [[12, 14, 16, [18, 20, 22], trunkB, 25, 50], [11, 13, 15, [17, 19, 21], trunkB, 12, 18],     // throwing arm, glove arm
                   [24, 26, 28, [30, 32], pelvisB, 12, 20], [23, 25, 27, [29, 31], pelvisB, 12, 20]];
    LIMBS.forEach(([Sh, El, Wr, Fg, basis, vMid, vEnd], li) => {
      const isLeg = li >= 2, ci = Wr === 27 ? 0 : 1;                       // contact index (lead = 27 after mirroring)
      const bad = P.map((_, t) => Math.max(sp(t, El), sp(t, Wr)) > TH);
      for (let t = 1; t < T; t++) {                                          // faster than a body can move: both sides suspect
        const vm = norm(sub(P[t][El], P[t - 1][El])) * fs, ve = norm(sub(P[t][Wr], P[t - 1][Wr])) * fs;
        if (vm > vMid || ve > vEnd) for (let k = -fk(2); k <= fk(2); k++) if (t + k >= 0 && t + k < T) bad[t + k] = true;
      }
      if (isLeg && contact) for (let t = 0; t < T; t++) if (contact[ci][t] > 0.5) bad[t] = false;   // planted feet are handled already
      // a throwing elbow still sharply bent right at release can't be real (the elbow is ~20-30° from straight there):
      // the tracker lost the forearm in the blur
      if (li === 0 && !measured && opts.relCheck !== false) for (let t = Math.max(1, rel - fk(2)); t <= Math.min(T - 2, rel + fk(1)); t++) {
        const F = P[t], fl = Math.acos(clamp(dot(unit(sub(F[El], F[Sh])), unit(sub(F[Wr], F[El]))), -1, 1)) * DEG;
        if (fl > 105) bad[t] = true;
      }
      const bd = bad.map((v, t) => v || !!bad[t - 1] || !!bad[t + 1]);
      if (!isLeg) unseen[Sh] = bd;
      const L1 = boneLen(Sh, El), L2 = boneLen(El, Wr);
      for (let t = 2; t < T - 2; t++) {
        if (!bd[t]) continue;
        let e = t; while (e < T && bd[e]) e++;
        const a = t - 1, b = e;
        if (b <= T - 2 && e - t <= maxGap) {
          const A0 = params(a - 1, Sh, El, Wr, basis, isLeg), A = params(a, Sh, El, Wr, basis, isLeg), B1 = params(b, Sh, El, Wr, basis, isLeg), B2 = params(b + 1, Sh, El, Wr, basis, isLeg), n = b - a;
          if (opts._dbgBridge) opts._dbgBridge.push({ limb: Wr, a, b, A, B1 });
          const vaU = sub(A.u, A0.u), vbU = sub(B2.u, B1.u), vaF = A.fl - A0.fl, vbF = B2.fl - B1.fl, vaE = wrap(A.er - A0.er), vbE = wrap(B2.er - B1.er);
          let dE = wrap(B1.er - A.er);
          if (!isLeg && Math.abs(dE) > 120 && vaE !== 0 && Math.sign(dE) !== Math.sign(vaE)) dE -= 360 * Math.sign(dE);   // a forearm keeps turning the same way; a shin can't spin round the thigh
          const lim = (v, span) => clamp(v, -Math.abs(span) / n * 2 - 1e-6, Math.abs(span) / n * 2 + 1e-6);      // no overshoot
          // the throwing arm unseen through release: it follows the path every overhand/sidearm throw shares
          // (upper arm held out at shoulder height and swinging forward, elbow extending and the forearm coming
          // forward out of layback), joined to the clear frames either side with matching speed
          const path = li === 0 && opts.throwModel !== false && a < rel && b > rel ? throwPath(A0, A, B1, B2, a, b, rel, fs) : null;
          if (path) armModelled += n - 1;
          for (let i = 1; i < n; i++) {
            const tt = a + i, F = P[tt], Bs = basis(F);
            let u, fl, er;
            if (path) {
              const [abd, hz, fl_, er_] = path(tt), h = sub(mul(Bs.r, Math.cos(hz / DEG)), mul(Bs.fw, Math.sin(hz / DEG)));
              u = unit(add(mul(Bs.up, -Math.cos(abd / DEG)), mul(h, Math.sin(abd / DEG)))); fl = clamp(fl_, 0, 160) / DEG; er = er_ / DEG;
            } else {
              const ul = hermite(A.u, vaU, B1.u, vbU, n, i);
              u = unit(add(add(mul(Bs.fw, ul[0]), mul(Bs.up, ul[1])), mul(Bs.r, ul[2])));
              fl = clamp(hermite([A.fl, 0, 0], [lim(vaF, B1.fl - A.fl), 0, 0], [B1.fl, 0, 0], [lim(vbF, B1.fl - A.fl), 0, 0], n, i)[0], 0, 160) / DEG;
              er = hermite([A.er, 0, 0], [lim(vaE, dE), 0, 0], [A.er + dE, 0, 0], [lim(vbE, dE), 0, 0], n, i)[0] / DEG;
            }
            const [av, bv] = frameAbout(u, Bs, isLeg);
            const fdir = add(mul(u, Math.cos(fl)), mul(add(mul(av, Math.cos(er)), mul(bv, Math.sin(er))), Math.sin(fl)));
            const oldW = F[Wr], fOld = unit(sub(F[Wr], F[El]));
            F[El] = add(F[Sh], mul(u, L1)); F[Wr] = add(F[El], mul(fdir, L2));
            const axis = cross(fOld, fdir), an = Math.acos(clamp(dot(fOld, fdir), -1, 1));
            Fg.forEach(k => { const off = sub(F[k], oldW); F[k] = add(F[Wr], norm(axis) > 1e-9 ? rodrigues(off, axis, an) : off) });
            if (isLeg) { const low = Math.min(F[Wr][1], ...Fg.map(k => F[k][1])); if (low < 0.005) { const d = 0.005 - low; [Wr, ...Fg].forEach(k => F[k][1] += d) } }
            bridged++;
          }
        }
        t = e;
      }
    });
  }

  if (opts._snap) opts._snap("bridge", P, { imgSmooth, liftScale, rot, camDir });
  // ---- de-pop: a single frame where a hand, knee or foot jumps further than a body can accelerate is the tracker
  // guessing (usually a hand hidden behind the body). Those frames are rebuilt from the clear frames either side, in
  // the body's own frame with constant bone lengths, and a rebuild is kept only if it is genuinely smoother.
  let depopped = 0;
  if (opts.depop !== false) {
    const upOf = F => unit(sub(mid(F[11], F[12]), mid(F[23], F[24])));
    const trunkB = F => { const up = upOf(F); let r = sub(F[12], F[11]); r = unit(sub(r, mul(up, dot(r, up)))); return { up, r, fw: cross(up, r) } };
    const pelvisB = F => { const up = upOf(F); let r = sub(F[24], F[23]); r = unit(sub(r, mul(up, dot(r, up)))); return { up, r, fw: cross(up, r) } };
    const accOf = (t, j) => norm(add(sub(P[t + 1][j], mul(P[t][j], 2)), P[t - 1][j])) * fs * fs;
    // m/s²: [mid joint, end joint]. A throwing hand really whips past 1000 m/s²; a glove hand, knee or swinging foot never comes close
    const LIM = [[12, 14, 16, [18, 20, 22], trunkB, 700, 1800], [11, 13, 15, [17, 19, 21], trunkB, 200, 280],
                 [24, 26, 28, [30, 32], pelvisB, 240, 360], [23, 25, 27, [29, 31], pelvisB, 240, 360]];
    const relWin = t => Math.abs(t - rel) <= fk(2);
    for (const [Sh, El, Wr, Fg, basis, aMid, aEnd] of LIM) {
      const ends = [El, Wr, ...Fg], L1 = boneLen(Sh, El), L2 = boneLen(El, Wr);
      const worst = (lo, hi) => { let m = 0; for (let t = Math.max(1, lo); t <= Math.min(T - 2, hi); t++) m = Math.max(m, accOf(t, El) / aMid, accOf(t, Wr) / aEnd, ...Fg.map(k => accOf(t, k) / (aEnd * 1.6))); return m };
      const local = (t) => { const F = P[t], B = basis(F); const g = j => { const v = sub(F[j], F[Sh]); return [dot(v, B.fw), dot(v, B.up), dot(v, B.r)] }; return ends.map(g) };
      const put = (t, Lc) => { const F = P[t], B = basis(F); ends.forEach((j, i) => { const v = Lc[i]; F[j] = add(F[Sh], add(add(mul(B.fw, v[0]), mul(B.up, v[1])), mul(B.r, v[2]))) }) };
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (let t = 1; t < T - 1; t++) {
          if (Wr === 16 && relWin(t)) continue;
          if (worst(t, t) <= 1) continue;
          // widen the window until rebuilding it is smoother (at most 2 frames either side)
          for (let w = 1; w <= 2; w++) {
            const a = t - w, b = t + w; if (a < 1 || b > T - 2) break;
            const before = worst(a - 1, b + 1), saved = [];
            for (let k = a + 1; k < b; k++) saved.push(P[k].map(p => p.slice()));
            const A0 = local(a - 1), A = local(a), B1 = local(b), B2 = local(b + 1), n = b - a;
            for (let k = a + 1; k < b; k++) {
              const i = k - a;
              const Lc = A.map((_, q) => hermite(A[q], sub(A[q], A0[q]), B1[q], sub(B2[q], B1[q]), n, i));
              put(k, Lc);
              // constant bone lengths: elbow/knee on the upper bone, wrist/ankle on the lower, hand/foot points follow
              const F = P[k], eOld = F[Wr];
              F[El] = add(F[Sh], mul(unit(sub(F[El], F[Sh])), L1));
              F[Wr] = add(F[El], mul(unit(sub(F[Wr], F[El])), L2));
              const dl = sub(F[Wr], eOld); Fg.forEach(q => F[q] = add(F[q], dl));
            }
            if (worst(a - 1, b + 1) < before * 0.8) { depopped += n - 1; changed = true; break }
            for (let k = a + 1; k < b; k++) P[k] = saved[k - a - 1];
          }
        }
        if (!changed) break;
      }
    }
  }

  // ---- throwing-arm layback (modelled: one camera can't see the forearm lay back)
  if (opts.layback === true || (!faithful && opts.layback !== false)) {
    const mer = Math.round((cock + rel) / 2);
    const keyset = new Map();
    [[fs_, 95, 60], [fs_ + fk(2), 95, 110], [cock, 92, 140], [mer - 1, 90, 165], [mer, 88, 175], [rel - 1, 60, 140], [rel, 25, 100], [rel + 1, 25, 60], [rel + 2, 35, 30]]
      .forEach(k => keyset.set(k[0], k));
    const keys = [...keyset.values()].sort((a, b) => a[0] - b[0]), kt = keys.map(k => k[0]);
    const flexS = naturalSpline(kt, keys.map(k => k[1])), erS = naturalSpline(kt, keys.map(k => k[2]));
    const wL = t => sstep(t, fs_ - fk(5), fs_) * (1 - sstep(t, rel + fk(2), rel + fk(6)));
    const wA = t => sstep(t, fs_, cock) * (1 - sstep(t, rel - 1, rel + fk(2))) * 0.7;
    const Lup = boneLen(12, 14), Lfa = boneLen(14, 16);
    for (let t = Math.max(0, fs_ - fk(5)); t < Math.min(T, rel + fk(6)); t++) {
      const w = wL(t), wa = wA(t); if (w <= 0) continue;
      const F = P[t], Sh = F[12], El = F[14], Wr = F[16];
      const upT = unit(sub(mid(F[11], F[12]), mid(F[23], F[24]))), fwdT = unit(cross(upT, unit(sub(F[12], F[11]))));
      let u = unit(sub(El, Sh));
      const abd = Math.acos(clamp(dot(u, mul(upT, -1)), -1, 1)) * DEG;
      if (wa > 0) { const ax = cross(mul(upT, -1), u); if (norm(ax) > 1e-6) u = rodrigues(u, ax, (95 - abd) * wa / DEG) }
      const ElN = add(Sh, mul(u, Lup)), fOld = unit(sub(Wr, El));
      const a = unit(sub(fwdT, mul(u, dot(fwdT, u)))); let b = sub(upT, mul(u, dot(upT, u))); b = unit(sub(b, mul(a, dot(b, a))));
      const flex0 = Math.acos(clamp(dot(u, fOld), -1, 1)) * DEG, er0 = Math.atan2(dot(fOld, b), dot(fOld, a)) * DEG;
      const tt = clamp(t, kt[0], kt[kt.length - 1]);
      const ft = flexS(tt), et = erS(tt), der = ((et - er0 + 180) % 360 + 360) % 360 - 180;
      const fl = (flex0 + w * (ft - flex0)) / DEG, er = (er0 + w * der) / DEG;
      const fNew = add(mul(u, Math.cos(fl)), mul(add(mul(a, Math.cos(er)), mul(b, Math.sin(er))), Math.sin(fl)));
      const WrN = add(ElN, mul(fNew, Lfa)), axis = cross(fOld, fNew), an = Math.acos(clamp(dot(fOld, fNew), -1, 1));
      [18, 20, 22].forEach(k => { const off = sub(F[k], Wr); F[k] = add(WrN, norm(axis) > 1e-9 ? rodrigues(off, axis, an) : off) });
      F[14] = ElN; F[16] = WrN;
    }
    const lo = Math.max(0, fs_ - fk(8)), hi = Math.min(T, rel + fk(9));
    for (const k of [14, 16, 18, 20, 22]) {
      const seg = P.slice(lo, hi).map(F => F[k]), sm = gauss(seg, K);
      seg.forEach((_, i) => { const t = lo + i, wv = sstep(t, lo, lo + 4) * (1 - sstep(t, hi - 5, hi - 1)); P[t][k] = add(seg[i], mul(sub(sm[i], seg[i]), wv)) });
    }
    for (let t = lo; t < hi; t++) {
      const F = P[t]; F[14] = add(F[12], mul(unit(sub(F[14], F[12])), Lup));
      const wOld = F[16]; F[16] = add(F[14], mul(unit(sub(F[16], F[14])), Lfa)); const dl = sub(F[16], wOld);
      [18, 20, 22].forEach(k => F[k] = add(F[k], dl));
    }
  }

  if (opts._snap) opts._snap("depop", P, { imgSmooth, liftScale, rot, camDir });
  // ---- head on a constant-length neck, tilting smoothly
  const torso = median(P.map(F => norm(sub(mid(F[11], F[12]), mid(F[23], F[24])))));
  const ndir = gauss(P.map(F => unit(sub(mid(F[7], F[8]), mid(F[11], F[12])))), 1.5 * K).map(unit);
  P.forEach((F, t) => { const shm = mid(F[11], F[12]), d = sub(add(shm, mul(ndir[t], 0.35 * torso)), mid(F[7], F[8])); for (let k = 0; k <= 10; k++) F[k] = add(F[k], d) });

  // ---- arms locked to the video. Seen from the camera, each arm bone points exactly where the tracked arm does
  // (upper arm from the shoulder, forearm from the elbow); only the part the camera can't see, how far each bone
  // leans toward or away from it, comes from the 3D reconstruction above. Bone lengths stay exact.
  // ---- shoulders the right way round. One camera can't tell whether the shoulder line leans toward or away from it,
  // and filmed from the back the tracker often picks the wrong one. Around foot strike every pitcher's hips are ahead
  // of his shoulders (404 lab fastballs: hip-shoulder separation never below about -5° from 0.2 s before foot strike to
  // foot strike, typically +20° to +50°). Where the shoulders read far more open than the hips there, and the shoulder
  // line leaned the other way fits, it's flipped (the arms move with their shoulders).
  if (opts.shoulderCheck !== false && !measured) {
    const cz = unit(camDir), lo = Math.max(0, fs_ - Math.round(0.3 * fs)), hi = Math.min(T - 1, fs_ + Math.round((opts._shPost ?? 0.12) * fs));
    const head = v => { const h = unit([v[0], 0, v[2]]), f = cross([0, 1, 0], h); return Math.atan2(f[0], f[2]) * DEG };
    const wrapD = d => ((d + 180) % 360 + 360) % 360 - 180;
    const mirr = F => { const M = mid(F[11], F[12]); return [11, 12].map(j => { const v = sub(F[j], M); return add(M, sub(v, mul(cz, 2 * dot(v, cz)))) }) };
    const flag = new Array(T).fill(false);
    for (let t = lo; t <= hi; t++) {
      const LIM = t >= fs_ - Math.round(0.12 * fs) ? (opts._sepNear ?? 15) : (opts._sepMin ?? -12);   // stricter in the last 0.1 s before foot strike: at foot strike the shoulders should still be clearly behind the hips (+15 fixes shoulders that read turned with the hips on side-on views: trunk at foot strike 10.6 -> 9.4° off)
      const F = P[t], pel = head(sub(F[24], F[23])), sep = wrapD(pel - head(sub(F[12], F[11])));
      if (sep >= LIM) continue;
      const [m11, m12] = mirr(F), sep2 = wrapD(pel - head(sub(m12, m11)));
      if (opts._dbgShF) opts._dbgShF.push([t, Math.round(pel), Math.round(sep), Math.round(sep2)]);
      if (sep2 <= (opts._sepMax ?? 85) && ((sep2 >= LIM && sep2 > sep) || sep2 - sep > (opts._sepGain ?? 30))) flag[t] = true;   // the flipped reading must itself be realistic
    }
    for (let t = 1; t < T - 1; t++) if (!flag[t] && flag[t - 1] && flag[t + 1]) flag[t] = true;      // no single-frame holes
    // eased in and out over ~40 ms: the shoulder line turns through square-on to the camera instead of snapping
    let flipped = flag.filter(Boolean).length;
    const wF = flipped ? gauss(flag.map(v => [v ? 1 : 0, 0, 0]), Math.max(0.8, 0.02 * fs)).map(v => Math.min(1, v[0] * 1.15)) : null;
    if (wF) for (let t = 0; t < T; t++) if (wF[t] > 0.02) {
      const F = P[t], M = mid(F[11], F[12]), [m11, m12] = mirr(F), w = wF[t];
      const blend = (o, m) => { const a = sub(o, M), b = sub(m, M), L = norm(a), c = add(mul(a, 1 - w), mul(b, w)), n = norm(c); return add(M, n > 1e-6 ? mul(c, L / n) : a) };
      const n11 = blend(F[11], m11), n12 = blend(F[12], m12), d11 = sub(n11, F[11]), d12 = sub(n12, F[12]);
      F[11] = n11; F[12] = n12; [13, 15, 17, 19, 21].forEach(j => F[j] = add(F[j], d11)); [14, 16, 18, 20, 22].forEach(j => F[j] = add(F[j], d12));
    }
    if (opts._dbgSh) opts._dbgSh.push(flipped);
  }
  if (opts.armLock !== false && !measured) {
    // two matches: a tight one round release (where timing matters most) and a long one for the stride and
    // follow-through; the tight one wins where they overlap
    let tmpl = null;
    if (opts.armLib && opts.armMatch !== false) {
      const S = armMatch(P, imgSmooth, liftScale, rot, camDir, BL, rel, fs, unseen[12], opts.armLib, opts);
      tmpl = S;
      if (opts.armMatchLong !== false) {
        // the long match starts 0.7 s before release (was 0.55 s; 2026-11-06: elbow at foot strike 9.8 -> 9.5° off, layback
        // at release 24.7 -> 23.5° on the 60 benchmark views): it then sees the arm through the whole of the stride
        const Lg = armMatch(P, imgSmooth, liftScale, rot, camDir, BL, rel, fs, unseen[12], opts.armLib, { ...opts, _mPre: opts._lPre ?? 0.7, _mPost: opts._lPost ?? 0.22, _dbgMatch: null });
        const u = [], f = [], wt = [];
        for (let t = 0; t < T; t++) {
          const ws = S.u[t] ? S.wt[t] : 0, wl = Lg.u[t] ? Lg.wt[t] : 0;
          if (!ws && !wl) { u.push(null); f.push(null); wt.push(0); continue }
          const mix = (a, b) => ws && wl ? unit(add(mul(a, ws), mul(b, 1 - ws))) : ws ? a : b;
          u.push(mix(S.u[t], Lg.u[t])); f.push(mix(S.f[t], Lg.f[t])); wt.push(Math.max(ws, wl));
        }
        tmpl = { u, f, wt, relShift: S.relShift };
      }
    }
    P = lockArms(P, imgSmooth, liftScale, rot, camDir, BL, unseen, K, fs, { ...opts, _fsF: fs_, _relF: tmpl && opts.matchRel !== false && !(opts.phases && opts.phases.release != null) ? clamp(rel + Math.round(tmpl.relShift), fs_ + 1, T - 2) : rel }, tmpl);
    // release: where the matched lab throws release the ball (unless it was set by hand)
    if (tmpl && opts.matchRel !== false && !(opts.phases && opts.phases.release != null)) rel = clamp(rel + Math.round(tmpl.relShift), fs_ + 1, T - 2);
  }
  // How far the spine leans toward or away from the camera is the one thing the picture can't show, and the learned depth
  // overstates it. Scaling that lean back by 8% (the whole upper body moved together, so the arm's own angles aren't touched)
  // brings the trunk tilts closer to motion capture: 60 benchmark views, side tilt 4.9/7.7/7.6 -> 4.8/7.2/7.1° off at foot
  // strike/max layback/release, forward tilt 4.4/6.3/5.7 -> 4.3/5.8/5.6°, shoulder abduction 4.2/4.4/5.4 -> 4.1/3.8/4.9°, throwing
  // arm position 11.5 -> 11.2 cm. A bigger scale-back (25%) fixes side tilt more (side_back 13.5 -> 6°) but makes the arm position
  // from behind toward third base 1.4 cm worse: not shipped.
  if (opts.spineDepth !== false && !measured) {
    const cz = unit(camDir), g = opts._spineG ?? 0.92;
    for (let t = 0; t < T; t++) {
      const F = P[t], d = mul(cz, (g - 1) * dot(sub(mid(F[11], F[12]), mid(F[23], F[24])), cz));
      for (let j = 0; j <= 22; j++) F[j] = add(F[j], d);
    }
  }

  // ---- final glitch guard, on every skeleton whatever the video: the zero-phase low-pass filter biomechanics labs run
  // on motion-capture data (about 12 Hz for the body, 20 Hz for the throwing arm, which really does move that fast).
  // Nothing a body does is faster than that, so whatever is left of a tracking glitch (a one- or two-frame jump) is
  // removed, while real motion, release included, is kept. Bone lengths are then locked again.
  let guarded = false;
  if (opts.guard !== false && T >= 8) {
    const bw = fc => { const w = Math.tan(Math.PI * fc / fs), k1 = Math.SQRT2 * w, k2 = w * w, a0 = 1 + k1 + k2;
      return { b0: k2 / a0, b1: 2 * k2 / a0, b2: k2 / a0, a1: 2 * (k2 - 1) / a0, a2: (1 - k1 + k2) / a0 } };
    const run = (x, c) => { const y = new Array(x.length); let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0];
      for (let i = 0; i < x.length; i++) { const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v } return y };
    const filtfilt = (x, c) => {
      const pad = Math.max(1, Math.min(x.length - 2, Math.round(fs / 3)));
      const head = x.slice(1, pad + 1).reverse().map(v => 2 * x[0] - v), tail = x.slice(x.length - pad - 1, x.length - 1).reverse().map(v => 2 * x[x.length - 1] - v);
      let y = run([...head, ...x, ...tail], c); y = run(y.reverse(), c).reverse();
      return y.slice(pad, pad + x.length);
    };
    const ARM_T = new Set([14, 16, 18, 20, 22]);                        // throwing arm below the shoulder (right after mirroring)
    const CORE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 23, 24]);   // head, shoulders, hips: the body's core
    const lim = f => Math.min(f, 0.42 * fs);
    // 20 Hz on the throwing arm (it was 14): the arm's whip through arm cocked and release is too quick for less, and 14 Hz was
    // rounding it off, reading the elbow straighter than it is. 60 benchmark views vs motion capture: elbow at max layback
    // 9.7 -> 8.0° off, at release 7.5 -> 6.4°; layback at max layback 7.5 -> 5.9°; frame-to-frame wobble of the elbow 4.7 -> 5.2,
    // the same as the real arm (4.8)
    const cB = bw(lim(opts._fcLimb ?? 12)), cA = bw(lim(opts._fcArm ?? 20)), cC = bw(lim(opts._fcCore ?? 12)), cG = bw(lim(opts._fcGlove ?? 9));
    const GLOVE = new Set([13, 15, 17, 19, 21]);
    // the arms move fast only from just before foot strike to the follow-through; outside that (the windup, the end of
    // the follow-through) they're held to a calmer limit, so tracker wobble on a slow arm can't show as a zig-zag
    const cSlow = bw(lim(opts._fcSlow ?? 6)), ramp = Math.max(1, Math.round(0.06 * fs));
    const fastW = P.map((_, t) => sstep(t, rel - Math.round(0.28 * fs) - ramp, rel - Math.round(0.28 * fs)) * (1 - sstep(t, rel + Math.round(0.22 * fs), rel + Math.round(0.22 * fs) + ramp)));
    for (let j = 0; j < 33; j++) {
      const c = ARM_T.has(j) ? cA : CORE.has(j) ? cC : GLOVE.has(j) ? cG : cB, arm = ARM_T.has(j) || GLOVE.has(j);
      for (let d = 0; d < 3; d++) {
        const x = P.map(F => F[j][d]), y = filtfilt(x, c), ys = arm && opts.slowArms !== false ? filtfilt(x, cSlow) : null;
        for (let t = 0; t < T; t++) P[t][j][d] = ys ? fastW[t] * y[t] + (1 - fastW[t]) * ys[t] : y[t];
      }
    }
    // bone lengths back to exact, down the tree; head follows the neck; nothing below the ground
    P = P.map(F => {
      const n = { "-2": nodeOf(F, -2) }, G = F.map(p => p.slice());
      TREE.forEach(([a, b]) => { n[b] = add(n[a], mul(unit(sub(nodeOf(F, b), nodeOf(F, a))), BL[a + "," + b])) });
      for (const k in n) if (+k >= 0) G[+k] = n[k];
      const off = sub(n[-1], nodeOf(F, -1));
      for (let k = 0; k <= 10; k++) G[k] = add(F[k], off);
      return G;
    });
    // nothing below the ground: the lift needed is smoothed over time, so the whole body never bobs frame to frame
    if (opts.groundLift !== false) {
      const need = P.map(F => Math.max(0, -Math.min(...[27, 28, 29, 30, 31, 32].map(k => F[k][1]))));
      const r = Math.max(1, Math.round(0.06 * fs)), env = need.map((_, t) => Math.max(...need.slice(Math.max(0, t - r), t + r + 1)));
      const lift = gauss(env, Math.max(1, 0.04 * fs));
      P.forEach((F, t) => { const l = Math.max(lift[t], need[t]); if (l > 0) F.forEach(p => { p[1] += l }) });
    }
    guarded = true;
  }

  if (opts._snap) opts._snap("guard", P, { imgSmooth, liftScale, rot, camDir });
  if (opts._snap) opts._snap("lock", P, { imgSmooth, liftScale, rot, camDir });
  // ---- how closely the skeleton matches the tracked video (camera view, hip-relative), in metres
  const MJ = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28], errs = [];
  for (let t = 0; t < T; t++) {
    const hp = mid(P[t][23], P[t][24]), I = imgSmooth[t], hi = [(I[23][0] + I[24][0]) / 2, (I[23][1] + I[24][1]) / 2], sc = liftScale[t];
    for (const j of MJ) { const q = unrot(sub(P[t][j], hp)); errs.push(Math.hypot(q[0] - (I[j][0] - hi[0]) * sc, q[1] + (I[j][1] - hi[1]) * sc)) }
  }
  const match = { medianCm: Math.round(median(errs) * 1000) / 10, p90Cm: Math.round(percentile(errs, 90) * 1000) / 10 };

  // ---- back foot just in front of the rubber
  const foot0 = mid(P[0][30], P[0][32]);
  P = P.map(F => F.map(p => [p[0] - foot0[0], p[1], p[2] - foot0[2]]));
  const rubber = [P[0][28][0] - 0.045 - 0.076, 0];

  // ---- foot contact for the report: first frame the lead foot is down (within 1.5 cm of where it settles)
  contactF = fs_;
  if (!userFS && opts.contactFix !== false) {
    const lf = P.map(F => Math.min(F[Al][1], F[Al + 2][1], F[Al + 4][1]));
    const settle = lf.slice(fs_, Math.min(T, fs_ + Math.max(3, Math.round(0.25 * fs)))).sort((a, b) => a - b);
    const ground = settle[Math.floor(settle.length * 0.3)];
    for (let t = fs_; t <= Math.min(T - 4, fs_ + Math.round(0.12 * fs)); t++) if (lf[t] <= ground + 0.015) { contactF = t; break }
    // a foot that reads as still dropping can't be landing after the arm is already cocked (2 views of 60 read 0.13-0.15 s late this way)
    contactF = Math.min(contactF, Math.max(fs_, cock - Math.round((opts._slideCock ?? 0.08) * fs)));
    // a front foot that is down can still be sliding forward on its heel; the research's foot contact is when it stops.
    // Marked where the lead ankle slows below 0.3 m/s along the ground (60 benchmark views against motion capture:
    // foot strike 3 frames early on a typical pitch, 54 ms off on average; with this and the two limits around it, 24 ms)
    if (opts.contactSlide !== false) {
      // speed over a fixed 1/30 s, whatever the frame rate (in slow motion, frame-to-frame jitter would swamp it)
      const h = Math.max(1, Math.round(fs / 60));
      const sp = t => Math.hypot(P[t + h][Al][0] - P[t - h][Al][0], P[t + h][Al][2] - P[t - h][Al][2]) * fs / (2 * h);
      // never later than 0.1 s before the arm is cocked: foot strike to max layback takes 0.12 s on a typical pitch
      // (0.09-0.17 s on 90% of 404 lab fastballs), and a filmed foot that looks planted is, near enough, planted
      const last = Math.min(T - 1 - h, contactF + Math.round((opts._slideMax ?? 0.1) * fs), cock - Math.round((opts._slideCock ?? 0.08) * fs));
      let found = false;
      for (let t = Math.max(legLift + 1 + h, contactF - Math.round(0.05 * fs)); t <= last; t++) if (sp(t) < (opts._slideV ?? 0.3)) { contactF = t; found = true; break }
      // a foot that never quite drops under that speed on the way down (it is still creeping on the heel) would otherwise keep the early reach frame
      if (!found) for (let t = Math.max(legLift + 1 + h, contactF - Math.round(0.05 * fs)); t <= last; t++) if (sp(t) < (opts._slideV2 ?? 0.5)) { contactF = t; break }
    }
  }

  // ---- angles on the final pose
  // from one camera the hips and shoulders read as turning too little between foot strike and release (60 lab views: pelvis 73-80° of a true 85°, trunk
  // 130-145° of 148°, probably because the depth of a line swinging toward the camera is under-read), so the turn after foot strike is scaled up, the arms carried along. Filmed from behind the under-read is bigger and, for the shoulders, grows late (arm cocked to release), so those views get a little more, measured on the same lab views.
  { const cxB = Math.max(0, -unit(camDir)[0]); const hG = (opts._hipGain ?? 1.05) + (opts._hipGainB ?? 0.08) * cxB, sG = opts._shGain ?? 1.03, sB = (opts._shGainB ?? 0.08) * cxB; const yawAt = (F, a, b) => Math.atan2(F[b][2] - F[a][2], F[b][0] - F[a][0]);
    const wr = d => ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const ARM = { 11: [13, 15, 17, 19, 21], 12: [14, 16, 18, 20, 22] };   // the arm moves with its shoulder, so the elbow angle stays as it was
    const turn = (a, b, g, late) => { if (!g) return; let prev = yawAt(P[contactF], a, b), acc = 0;
      for (let t = contactF + 1; t < T; t++) { const y = yawAt(P[t], a, b); acc += wr(y - prev); prev = y;
        const w = sstep(t, contactF, contactF + fk(4)) * (1 - sstep(t, rel + fk(4), rel + fk(16))), th = ((g - 1) * w + (late || 0) * w * sstep(t, cock - fk(1), rel)) * acc, c = Math.cos(th), s = Math.sin(th), m = mid(P[t][a], P[t][b]);
        for (const j of [a, b]) { const dx = P[t][j][0] - m[0], dz = P[t][j][2] - m[2], nx = m[0] + c * dx - s * dz, nz = m[2] + s * dx + c * dz, sx = nx - P[t][j][0], sz = nz - P[t][j][2]; P[t][j] = [nx, P[t][j][1], nz];
          (ARM[j] || []).forEach(k => { P[t][k] = [P[t][k][0] + sx, P[t][k][1], P[t][k][2] + sz] }) } } };
    turn(23, 24, hG); turn(11, 12, sG, sB) }
  const M = computeMetrics(P);
  M.throwHorz = M.throwHorz.map((v, t) => M.throwAbd[t] > 50 ? v : null);
  // layback is only measured from foot strike to just after release: unwrap within that window only (before it the
  // forearm can swing all the way round, which would otherwise add whole turns), then put it in the usual range
  { const lo = Math.max(0, fs_ - 2), hi = Math.min(T - 1, rel + 3), w = [];
    for (let t = lo; t <= hi; t++) { let v = ((M.throwER[t] % 360) + 540) % 360 - 180; if (w.length) v = w[w.length - 1] + (((v - w[w.length - 1]) % 360) + 540) % 360 - 180; w.push(v) }
    const md = median(w), sh = md < -90 ? 360 : md > 270 ? -360 : 0;
    M.throwER = M.throwER.map((_, t) => t >= lo && t <= hi ? w[t - lo] + sh : null) }
  // Arm cocked is the moment of most layback, so read it off the layback itself: the hand being highest over the shoulder is only
  // close to it (60 lab views against motion capture: 27 -> 11 ms off). Nudged by at most 1/30 s: a wider search reaches 5 ms on the lab views but moves Maher by 0.07 s, which needs his video to judge.
  if (opts._merSnap !== false && !(opts.phases && opts.phases.armCocked != null)) { const a = Math.round(0.034 * fs), b = a; let best = cock; for (let t = Math.max(contactF + 1, cock - a); t <= Math.min(rel - 1, cock + b); t++) if ((M.throwER[t] ?? -999) > (M.throwER[best] ?? -999)) best = t; cock = best }

  // ---- mirror left-handers back for display
  // the tracked points drawn over the video get the same treatment as the skeleton: each part held to how fast it can
  // really move (body core 8 Hz, legs and glove arm 10 Hz, throwing arm 14 Hz around the throw and 6 Hz outside it),
  // so the overlay follows the pitcher without the tracker's frame-to-frame shiver
  let imgOut = imgSmooth;
  if (opts.overlaySmooth !== false && T >= 8) {
    imgOut = imgSmooth.map(F => F.map(p => p.slice()));
    const ramp = Math.max(1, Math.round(0.06 * fs)), a0 = rel - Math.round(0.28 * fs), a1 = rel + Math.round(0.22 * fs);
    const fastW = imgSmooth.map((_, t) => sstep(t, a0 - ramp, a0) * (1 - sstep(t, a1, a1 + ramp)));
    const TA = new Set([14, 16, 18, 20, 22]), CO = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 23, 24]);
    for (let j = 0; j < 33; j++) for (let d = 0; d < 2; d++) {
      const x = imgSmooth.map(F => F[j][d]);
      if (TA.has(j)) { const f = lowpass(x, 14, fs), sl = lowpass(x, 6, fs); for (let t = 0; t < T; t++) imgOut[t][j][d] = fastW[t] * f[t] + (1 - fastW[t]) * sl[t] }
      else { const y = lowpass(x, CO.has(j) ? 8 : 10, fs); for (let t = 0; t < T; t++) imgOut[t][j][d] = y[t] }
    }
  }
  let pose = P, img = imgOut.map((F, t) => F.map((p, j) => [p[0] / W, p[1] / H, frames[t].img[j][2] ?? 1]));
  let cam = camDir, rub = rubber;
  if (hand === "L") {
    pose = P.map(F => F.map((_, j) => { const p = F[mir(j)]; return [p[0], p[1], -p[2]] }));
    img = img.map(F => F.map((_, j) => { const p = F[mir(j)]; return [1 - p[0], p[1], p[2]] }));
    cam = [camDir[0], camDir[1], -camDir[2]]; rub = [rubber[0], -rubber[1]];
  }
  const bones = {};
  TREE.forEach(([a, b]) => { const ma = hand === "L" ? (a < 0 ? a : mir(a)) : a, mb = hand === "L" ? mir(b) : b; bones[ma + "," + mb] = +BL[a + "," + b].toFixed(4) });
  const r4 = v => Math.round(v * 1e4) / 1e4, rd1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
  const metrics = {}; for (const k in M) metrics[k] = M[k].map(rd1);
  // last line of defence: never hand the viewer a broken frame
  for (let t = 0; t < pose.length; t++) if (pose[t].some(p => p.some(v => !Number.isFinite(v)))) {
    let a = t - 1; while (a >= 0 && pose[a].some(p => p.some(v => !Number.isFinite(v)))) a--;
    let b = t + 1; while (b < pose.length && pose[b].some(p => p.some(v => !Number.isFinite(v)))) b++;
    const src = a >= 0 ? pose[a] : pose[b]; if (src) pose[t] = src.map(p => p.slice());
  }
  const out = {
    fps: fs, videoFps: raw.videoFps || fs, frames: T, width: W, height: H, start: raw.start || 0, throwHand: hand,
    cameraDir: cam.map(r4), footR: FOOT_R, rubberTop: RUB_TOP, moundDrop: r4(DROP), landX: r4(pose[settle][hand === "L" ? 28 : 27][0]), rubber: rub.map(r4), bones,
    pose: pose.map(F => F.map(p => p.map(r4))),
    img: img.map(F => F.map(p => [r4(p[0]), r4(p[1]), Math.round((p[2] ?? 1) * 100) / 100])),
    phases: [{ name: "Start", frame: 0 }, { name: "Peak leg lift", frame: legLift }, { name: "Foot strike", frame: clamp(contactF, legLift + 1, rel - 1) }, { name: "Arm cocked", frame: cock }, { name: "Release", frame: rel }, { name: "Finish", frame: T - 1 }],
    fsReach: fs_, bodyH: r4(bodyH), metrics, match, swaps, depopped, armBridged: bridged, armModelled, armFlips, learned, heightUsed: heightM ? +heightM.toFixed(3) : null, mode: faithful ? "faithful" : "classic", ...(opts.debug ? { _contact: contact } : {}),
  };
  out.pitchCheck = opts.phases ? { ok: true } : pitchCheck(out);
  return out;
}

// Delivery measurements a coach reads off the skeleton. All from the finished 3D pose in the body's own frame:
// x = toward home, y = up, z = across. Lengths need the pitcher's height entered to be in real units.
//   strideLen   stride from the rubber to the front ankle at foot strike, as a share of height
//   armSlot     the throwing arm's angle above horizontal, shoulder to wrist as seen from home plate, at release
//               (averaged over the last 2/60 s up to release: 60 benchmark views 7.4 -> 6.4° off, r 0.68 -> 0.85; at the single
//               frame it depends too much on exactly which frame the arm was caught in)
//   relHeight   wrist height above the ground at release (m), extension: how far in front of the rubber it is (m)
//   peakSep     largest hip-shoulder separation from just before foot strike to release, and its time after foot strike
export function deliveryMeasures(D, heightM, back_ = Math.round(D.fps * 2 / 60)) {
  const ph = n => (D.phases.find(p => p.name === n) || {}).frame;
  const fs = ph("Foot strike"), br = ph("Release"), P = D.pose;
  if (fs == null || br == null || !P[fs] || !P[br]) return null;
  const R = D.throwHand !== "L", sh = R ? 12 : 11, wr = R ? 16 : 15, lead = R ? 27 : 28, back = R ? 28 : 27, fps = D.fps;
  const stance = (() => { const a = P.slice(0, Math.max(1, ph("Peak leg lift") ?? 1)).map(F => F[back]); const med = i => a.map(p => p[i]).sort((x, y) => x - y)[a.length >> 1]; return [med(0), med(1), med(2)] })();
  const dx = P[fs][lead][0] - stance[0], dz = P[fs][lead][2] - stance[2], strideM = Math.hypot(dx, dz);
  const ground = Math.min(P[fs][lead][1], stance[1]);
  const s = P[br][sh], w = P[br][wr], SL = t => Math.atan2(P[t][wr][1] - P[t][sh][1], Math.abs(P[t][wr][2] - P[t][sh][2])) * 180 / Math.PI, slot = (() => { let a = 0, c = 0; for (let t = Math.max(0, br - back_); t <= br; t++) { a += SL(t); c++ } return a / c })();
  let pk = fs, M = D.metrics.separation; for (let t = Math.max(0, fs - Math.round(.1 * fps)); t <= br; t++) if (M[t] != null && M[t] > (M[pk] ?? -1e9)) pk = t;
  return { strideM, strideLen: heightM ? strideM / heightM : null, armSlot: slot, relHeight: w[1] - ground, extension: w[0] - stance[0], peakSep: M[pk], peakSepMs: (pk - fs) / fps * 1e3 };
}

// The delivery numbers as shown to a coach (screen, PDF, compare). Only the ones that held up against motion capture on
// the 60 benchmark views; how far in front of the rubber the hand gets (extension) didn't, so it isn't shown.
export function deliveryCards(D) {
  if (D.pitchCheck && !D.pitchCheck.ok) return [];
  const h = D.bodyH || (D.heightUsed ?? null); let m; try { m = deliveryMeasures(D, h) } catch (e) { return [] }
  if (!m) return [];
  const ftIn = v => { const n = Math.round(v / 0.0254), f = Math.floor(n / 12); return `${f}'${n - f * 12}"` };
  const out = [];
  if (m.strideLen != null) out.push({ k: "stride", label: "Stride", value: Math.round(m.strideLen * 100) + "% of height", short: Math.round(m.strideLen * 100) + "%", n: m.strideLen * 100, unit: "%", def: "Rubber to front foot at foot strike. Reads about 5% of height short of motion capture; use it to compare pitches filmed from the same spot." });
  // at 30 fps the arm moves about a foot between frames at release, so the slot depends on which frame caught it
  const lowFps = D.fps < 50;   // the true rate: slow motion is plenty of frames even from a 30 fps file
  out.push({ k: "slot", label: "Arm slot", value: (lowFps ? "~" : "") + Math.round(m.armSlot) + "\u00B0", n: m.armSlot, unit: "\u00B0", def: "Shoulder-to-wrist angle above horizontal at release, as seen from home plate. Typical error about 6\u00B0" + (lowFps ? "; rougher on this clip (under 50 fps, the arm moves a lot between frames)." : ".") });
  // real units only with the pitcher's height entered: without it the size of the body is an estimate
  if (D.heightUsed) out.push({ k: "height", label: "Hand height at release", value: "~" + ftIn(m.relHeight), n: m.relHeight / 0.0254, unit: '"', def: "Wrist above the ground. Typical error about 3 inches; the ball leaves a little higher." });
  // tempo: the one timing that held up (60 lab views: 24 ms off, against a 74 ms spread between pitchers, r 0.92). Foot strike to release didn't
  // (34 ms off a 21 ms spread), so it isn't shown here. Left out when the clip starts about at leg lift: the true top of the lift may be missing.
  { const fr = n => (D.phases.find(p => p.name === n) || {}).frame, ll = fr("Peak leg lift"), fs = fr("Foot strike");
    if (ll != null && fs != null && ll >= 0.1 * D.fps && fs > ll) { const sec = (fs - ll) / D.fps; out.push({ k: "tempo", label: "Leg lift to foot strike", value: sec.toFixed(2) + " s", n: sec * 1000, unit: " ms", def: "Time from the top of the leg lift to the front foot landing. Typical error about 0.03 s; use it to compare a pitcher with himself or to spot a rushed or slow tempo." }) } }
  if (m.peakSep != null) out.push({ k: "sep", label: "Peak hip-shoulder separation", value: Math.round(m.peakSep) + "\u00B0", n: m.peakSep, unit: "\u00B0", def: "Largest gap between hips and shoulders from just before foot strike to release. Typical error about 7\u00B0." });
  return out;
}

// Does this clip actually show a pitch? On anything else (a pitcher standing, a clip cut before the stride or after it)
// the event finder still has to put foot strike somewhere, and the numbers would look real but mean nothing.
// Measured: 60 benchmark views and every saved clip have the ankles 0.59-0.88 of body height apart at foot strike and a
// peak wrist speed of 7.6-19.5 body heights per second; a standing pitcher, a clip cut before the stride and one that's
// only the follow-through had 0.09-0.40 apart (standing: wrist speed 3.8).
export function pitchCheck(D) {
  try {
    if (!D.bodyH) return { ok: true };
    const P = D.pose, R = D.throwHand !== "L", lead = R ? 27 : 28, back = R ? 28 : 27, wr = R ? 16 : 15;
    const fs = D.phases.find(p => p.name === "Foot strike").frame;
    const gap = Math.hypot(P[fs][lead][0] - P[fs][back][0], P[fs][lead][2] - P[fs][back][2]) / D.bodyH;
    let ws = 0; for (let t = 1; t < P.length; t++) ws = Math.max(ws, Math.hypot(P[t][wr][0] - P[t - 1][wr][0], P[t][wr][1] - P[t - 1][wr][1], P[t][wr][2] - P[t - 1][wr][2]) * D.fps / D.bodyH);
    return { ok: gap >= 0.5 && ws >= 5, gap: +gap.toFixed(2), wristSpeed: +ws.toFixed(1) };
  } catch (e) { return { ok: true } }
}
