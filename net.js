// Netting between the camera and the mound (backstop or protective nets) breaks the body tracker: the dark
// strands cut every limb into pieces, and a fast arm behind a strand gets lost. When a clip is filmed through
// a net, every frame is cleaned before it is tracked: thin dark lines are filled in from the colours on either
// side of them (a morphological closing), and only where the picture is darker than that fill, so everything
// else in the picture is left as it was. The video you see is never changed; only what the tracker reads.

// running max / min over a window of k along lines of a plane (van Herk / Gil-Werman: 3 comparisons a pixel)
function filt1(src, dst, w, h, k, horiz, isMax, buf, g, hh) {
  const r = k >> 1, n = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 1 : w, lstep = horiz ? w : 1, m = n + 2 * r;
  const pick = isMax ? (a, b) => (a > b ? a : b) : (a, b) => (a < b ? a : b);
  for (let l = 0; l < lines; l++) {
    const o = l * lstep;
    const first = src[o], last = src[o + (n - 1) * step];
    for (let i = 0; i < r; i++) { buf[i] = first; buf[r + n + i] = last }
    for (let i = 0; i < n; i++) buf[r + i] = src[o + i * step];
    for (let i = 0; i < m; i++) g[i] = i % k === 0 ? buf[i] : pick(g[i - 1], buf[i]);
    for (let i = m - 1; i >= 0; i--) hh[i] = (i % k === k - 1 || i === m - 1) ? buf[i] : pick(hh[i + 1], buf[i]);
    for (let i = 0; i < n; i++) dst[o + i * step] = pick(hh[i], g[i + k - 1]);
  }
}
function closePlane(p, w, h, kx, ky, t, bufs) {        // dilate then erode = closing (fills thin dark gaps)
  const [buf, g, hh] = bufs;
  filt1(p, t, w, h, kx, true, true, buf, g, hh); filt1(t, p, w, h, ky, false, true, buf, g, hh);
  filt1(p, t, w, h, kx, true, false, buf, g, hh); filt1(t, p, w, h, ky, false, false, buf, g, hh);
}
const lumOf = d => { const n = d.length >> 2, L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; return L };

// does this picture have a net in front of it? Long, continuous, thin dark lines running both across and down.
// Crowds and busy backgrounds have lots of small dark detail but not long unbroken strands, so they don't count.
function netScore(L, w, h) {
  const K = Math.max(5, Math.round(h * 0.02) | 1), T = 22, tol = Math.max(1, Math.round(h * 0.003)), Lmin = Math.round(h * 0.12);
  const n = w * h, bufs = [new Float32Array(Math.max(w, h) + 2 * K), new Float32Array(Math.max(w, h) + 2 * K), new Float32Array(Math.max(w, h) + 2 * K)];
  const run = (horiz) => {
    // thin dark lines across the other direction: closing along one axis only
    const c = Float32Array.from(L), t = new Float32Array(n), [buf, g, hh] = bufs;
    filt1(c, t, w, h, K, horiz, true, buf, g, hh); filt1(t, c, w, h, K, horiz, false, buf, g, hh);
    const m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = c[i] - L[i] > T ? 1 : 0;
    // allow for a slanted strand: widen each line by tol pixels
    const m2 = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) for (let d = -tol; d <= tol; d++) {
      const xx = horiz ? x + d : x, yy = horiz ? y : y + d;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) m2[yy * w + xx] = 1;
    }
    // total length of unbroken runs at least Lmin long, along the strand direction
    let tot = 0;
    if (horiz) { for (let x = 0; x < w; x++) { let r = 0; for (let y = 0; y <= h; y++) { if (y < h && m2[y * w + x]) r++; else { if (r >= Lmin) tot += r; r = 0 } } } return tot / (h * (2 * tol + 1)) }
    for (let y = 0; y < h; y++) { let r = 0; for (let x = 0; x <= w; x++) { if (x < w && m2[y * w + x]) r++; else { if (r >= Lmin) tot += r; r = 0 } } } return tot / (w * (2 * tol + 1));
  };
  const vert = run(true), across = run(false);
  // strand thickness: lengths of the dark runs across vertical strands
  const c = Float32Array.from(L), t = new Float32Array(n), [buf, g, hh] = bufs, runs = [];
  filt1(c, t, w, h, K, true, true, buf, g, hh); filt1(t, c, w, h, K, true, false, buf, g, hh);
  for (let y = 0; y < h; y += 5) { let r = 0; for (let x = 0; x <= w; x++) { if (x < w && c[y * w + x] - L[y * w + x] > T) r++; else { if (r >= 2 && r < K) runs.push(r); r = 0 } } }
  runs.sort((a, b) => a - b);
  return { vert, across, width: runs.length ? runs[runs.length >> 1] : 0 };
}

export class NetCleaner {
  constructor(W, H) {
    this.W = W; this.H = H; this.on = false; this.k = 0;
    this.cv = document.createElement("canvas"); this.cv.width = W; this.cv.height = H;
    this.g = this.cv.getContext("2d", { willReadFrequently: true });
  }
  // look at a few frames: net if most of them show long strands both ways
  async check(v, times, seek) {
    const S = Math.min(1, 540 / this.H), w = Math.max(16, Math.round(this.W * S)), h = Math.max(16, Math.round(this.H * S));
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d", { willReadFrequently: true });
    let hits = 0, widths = []; const scores = [];
    for (const t of times) {
      await seek(t); g.drawImage(v, 0, 0, w, h);
      const s = netScore(lumOf(g.getImageData(0, 0, w, h).data), w, h); scores.push(s);
      if (Math.min(s.vert, s.across) >= 1.6) { hits++; widths.push(s.width / S) }
    }
    this.on = hits * 2 > times.length;
    if (this.on) {
      widths.sort((a, b) => a - b); const wd = widths[widths.length >> 1];
      // window a bit wider than a strand, but never so wide it would wipe out a thin arm
      this.k = Math.max(5, Math.min(Math.round(this.H * 0.018), Math.round(2 * wd + 3))) | 1;
    }
    this.scores = scores;
    return this.on;
  }
  // the frame to track: the video itself, or a cleaned copy (cleaned inside box [cx, cy, side], or everywhere)
  frame(v, box) {
    if (!this.on) return v;
    const { W, H, g } = this;
    g.drawImage(v, 0, 0, W, H);
    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    if (box) { const s = box[2]; x0 = Math.max(0, Math.floor(box[0] - s)); x1 = Math.min(W, Math.ceil(box[0] + s)); y0 = Math.max(0, Math.floor(box[1] - s)); y1 = Math.min(H, Math.ceil(box[1] + s)) }
    const w = x1 - x0, h = y1 - y0; if (w < 8 || h < 8) return this.cv;
    const im = g.getImageData(x0, y0, w, h), d = im.data, n = w * h, k = this.k;
    const L = lumOf(d), P = [0, 1, 2].map(c => { const p = new Float32Array(n); for (let i = 0; i < n; i++) p[i] = d[4 * i + c]; return p });
    const t = new Float32Array(n), M = Math.max(w, h) + 2 * k, bufs = [new Float32Array(M), new Float32Array(M), new Float32Array(M)];
    P.forEach(p => closePlane(p, w, h, k, k, t, bufs));
    for (let i = 0; i < n; i++) {
      const Lc = 0.299 * P[0][i] + 0.587 * P[1][i] + 0.114 * P[2][i], a = Math.min(1, Math.max(0, (Lc - L[i] - 6) / 18));
      if (a > 0) for (let c = 0; c < 3; c++) d[4 * i + c] = d[4 * i + c] + a * (P[c][i] - d[4 * i + c]);
    }
    g.putImageData(im, x0, y0);
    return this.cv;
  }
}
