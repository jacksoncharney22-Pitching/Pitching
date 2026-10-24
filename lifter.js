// Feole Pitching: learned 3D motion model. MotionAGFormer (WACV 2024), trained on motion-capture recordings, turns the
// whole clip of tracked 2D joints into 3D at once. Because it has learned how real bodies move, its depth (how far each
// joint is toward or away from the camera) is far steadier than a guess made one frame at a time.
// Runs in the browser with onnxruntime-web (bundled next to the page). If it can't load, the app carries on without it.

const N = 243, FPS_MODEL = 50;
// MediaPipe 33 -> COCO 17
const MP2COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const L36 = [4, 5, 6, 11, 12, 13], R36 = [1, 2, 3, 14, 15, 16];
let session = null, loading = null;

function loadScript(src, name) {
  return new Promise((res, rej) => { if (window[name]) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("couldn't load " + src)); document.head.append(s) });
}
export async function loadLifter() {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    const base = new URL(".", document.baseURI).href;
    if (!window.ort) await loadScript(base + "ort/ort.all.min.js", "ort");
    window.ort.env.wasm.wasmPaths = base + "ort/";
    window.ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    let buf = null;
    try { const c = await caches.open("feole-models-v1"); const hit = await c.match(base + "lifter/mag243.onnx"); if (hit) buf = await hit.arrayBuffer() } catch (e) {}
    if (!buf) {
      const r = await fetch(base + "lifter/mag243.onnx"); if (!r.ok) throw new Error("3D model missing");
      buf = await r.arrayBuffer();
      try { const c = await caches.open("feole-models-v1"); await c.put(base + "lifter/mag243.onnx", new Response(buf.slice(0))) } catch (e) {}
    }
    session = await window.ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    return session;
  })();
  try { return await loading } catch (e) { loading = null; throw e }
}

// COCO 17 (x, y, conf in pixels) -> Human3.6M 17, the same conversion the model's authors use for video
function cocoToH36(k) {
  const h = Array.from({ length: 17 }, () => [0, 0, 0]), avg = (ids, d) => ids.reduce((a, i) => a + k[i][d], 0) / ids.length;
  const head = [avg([1, 2, 3, 4], 0), k[1][1] + k[2][1] - k[0][1], avg([1, 2, 3, 4], 2)];
  const thorax = [0, 1, 2].map(d => { const m = avg([5, 6], d); return m + (k[0][d] - m) / 3 });
  const pelvis = [0, 1, 2].map(d => avg([11, 12], d)), spine = [0, 1, 2].map(d => avg([5, 6, 11, 12], d));
  h[10] = head; h[8] = thorax; h[0] = pelvis; h[7] = spine;
  [[9, 0], [11, 5], [14, 6], [12, 7], [15, 8], [13, 9], [16, 10], [4, 11], [1, 12], [5, 13], [2, 14], [6, 15], [3, 16]].forEach(([a, b]) => h[a] = k[b].slice());
  for (let d = 0; d < 2; d++) h[9][d] -= (h[9][d] - avg([5, 6], d)) / 4;
  h[7][0] += 2 * (h[7][0] - (h[0][0] + h[8][0]) / 2);
  h[8][1] -= (avg([1, 2], 1) - k[0][1]) * 2 / 3;
  return h;
}

// raw: { fps (real-time rate), width, height, frames: [{ img: 33 x [x, y, vis] (0..1) } | null] }
// returns per frame the 17 joints in 3D (camera axes: x right, y down, z away; screen units, pelvis at 0), or null
export async function learnDepth(raw, onStatus) {
  const s = await loadLifter();
  const W = raw.width, H = raw.height, F = raw.frames, T = F.length;
  const known = []; F.forEach((f, t) => { if (f && f.img) known.push(t) });
  if (known.length < 8) return null;
  const at = t => { let best = known[0]; for (const k of known) if (Math.abs(k - t) < Math.abs(best - t)) best = k; return F[best] };
  // 2D in the model's units, one entry per frame of the clip
  const X = [];
  for (let t = 0; t < T; t++) {
    const f = F[t] || at(t), k = MP2COCO.map(j => [f.img[j][0] * W, f.img[j][1] * H, f.img[j][2] ?? 1]);
    X.push(cocoToH36(k).map(p => [p[0] / W * 2 - 1, p[1] / W * 2 - H / W, Math.max(0, Math.min(1, p[2]))]));
  }
  // the model was trained on 50 frames per real second: resample to that rate (slow motion clips have many more)
  const step = Math.max(0.25, (raw.fps || 50) / FPS_MODEL), M = Math.max(1, Math.floor((T - 1) / step) + 1);
  const lerp = (A, u) => { const a = Math.floor(u), b = Math.min(T - 1, a + 1), w = u - a; return A[a].map((p, j) => p.map((v, d) => v * (1 - w) + A[b][j][d] * w)) };
  const Xs = []; for (let i = 0; i < M; i++) Xs.push(lerp(X, Math.min(T - 1, i * step)));
  const out = Array.from({ length: M }, () => Array.from({ length: 17 }, () => [0, 0, 0])), cnt = new Array(M).fill(0);
  const starts = []; if (M <= N) starts.push(0); else { for (let a = 0; a + N <= M; a += 81) starts.push(a); if (starts[starts.length - 1] !== M - N) starts.push(M - N) }
  const runOne = async seg => { const data = new Float32Array(N * 17 * 3); seg.forEach((fr, i) => fr.forEach((p, j) => { data.set(p, (i * 17 + j) * 3) }));
    const r = await s.run({ input: new window.ort.Tensor("float32", data, [1, N, 17, 3]) }); return r[Object.keys(r)[0]].data };
  for (let w = 0; w < starts.length; w++) {
    if (onStatus) onStatus(w / starts.length);
    const a = starts[w], seg = Xs.slice(a, a + N), n = seg.length; while (seg.length < N) seg.push(seg[seg.length - 1]);
    const flip = seg.map(fr => { const g = fr.map(p => [-p[0], p[1], p[2]]); L36.forEach((l, i) => { const r = R36[i]; const x = g[l]; g[l] = g[r]; g[r] = x }); return g });
    const o1 = await runOne(seg), o2 = await runOne(flip);
    for (let i = 0; i < n; i++) {
      const g = (o, j, d) => o[(i * 17 + j) * 3 + d];
      const fr = [];
      for (let j = 0; j < 17; j++) { const jf = L36.includes(j) ? R36[L36.indexOf(j)] : R36.includes(j) ? L36[R36.indexOf(j)] : j;
        fr.push([0, 1, 2].map(d => (g(o1, j, d) + (d === 0 ? -1 : 1) * g(o2, jf, d)) / 2)) }
      const r0 = fr[0].slice(); fr.forEach(p => { for (let d = 0; d < 3; d++) p[d] -= r0[d] });
      fr.forEach((p, j) => { for (let d = 0; d < 3; d++) out[a + i][j][d] += p[d] }); cnt[a + i]++;
    }
  }
  const O = out.map((fr, i) => fr.map(p => p.map(v => v / (cnt[i] || 1))));
  // back to the clip's own frames
  const res = [];
  for (let t = 0; t < T; t++) { const u = Math.min(M - 1, t / step), a = Math.floor(u), b = Math.min(M - 1, a + 1), w = u - a;
    res.push(O[a].map((p, j) => p.map((v, d) => +(v * (1 - w) + O[b][j][d] * w).toFixed(4)))) }
  if (onStatus) onStatus(1);
  return res;
}
