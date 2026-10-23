// JP Pitching: the stronger body tracker (RTMPose-x, Halpe-26: body, heels and toes), run in the browser.
// Uses onnxruntime-web (loaded from the CDN as the global `ort`) on the graphics chip (WebGPU), or the processor
// (WASM) if WebGPU isn't available. The model is downloaded once from Hugging Face and kept in the browser's cache.
// If anything here can't load (an older browser, or the page is shown somewhere that blocks downloads), JP Pitching
// carries on with its built-in tracker.

const ORT_VER = "1.20.1";
export const RTM_URL = "https://huggingface.co/Tau-J/RTMPose/resolve/main/rtmposev1/onnx_sdk/rtmpose-x_simcc-body7_pt-body7-halpe26_700e-384x288-7fb6e239_20230606.zip";
const IN_W = 288, IN_H = 384, SPLIT = 2.0;
const MEAN = [123.675, 116.28, 103.53], STD = [58.395, 57.12, 57.375];
// Halpe-26 left/right pairs (for the mirrored look)
const HFLIP = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [20, 21], [22, 23], [24, 25]];
const HMIR = Array.from({ length: 26 }, (_, i) => i); HFLIP.forEach(([a, b]) => { HMIR[a] = b; HMIR[b] = a });
// Halpe-26 -> MediaPipe 33 (the skeleton everything else in JP Pitching uses)
const H2M = [[0, 0], [1, 2], [2, 5], [1, 1], [1, 3], [2, 4], [2, 6], [3, 7], [4, 8], [5, 11], [6, 12], [7, 13], [8, 14], [9, 15], [10, 16],
             [11, 23], [12, 24], [13, 25], [14, 26], [15, 27], [16, 28], [24, 29], [25, 30], [20, 31], [21, 32]];

let session = null, loading = null, backend = null;

function loadScript(src, globalName) {
  return new Promise((res, rej) => { if (window[globalName]) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("couldn't load " + src)); document.head.append(s) });
}
async function fetchCached(url, onProgress) {
  let cache = null;
  try { cache = await caches.open("jp-pitching-models-v1"); const hit = await cache.match(url); if (hit) return await hit.arrayBuffer() } catch (e) { cache = null }
  const r = await fetch(url, { mode: "cors" });
  if (!r.ok) throw new Error("model download failed: " + r.status);
  const total = +r.headers.get("content-length") || 0, reader = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (onProgress) onProgress(total ? got / total : 0, got) }
  const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length }
  try { if (cache) await cache.put(url, new Response(buf.slice().buffer, { headers: { "content-type": "application/zip" } })) } catch (e) {}
  return buf.buffer;
}
// a copy of the tracker bundled next to the page (the Claude version, which can't download from other sites)
async function loadBundled(onProgress) {
  const base = new URL(".", document.baseURI).href;
  let man;
  try { const r = await fetch(base + "rtm/manifest.json"); if (!r.ok) return null; man = await r.json() } catch (e) { return null }
  const all = man.runtime === "all";                                     // the website copy can also use the graphics chip
  await loadScript(base + (all ? "ort/ort.all.min.js" : "ort/ort.wasm.min.js"), "ort");
  window.ort.env.wasm.wasmPaths = base + "ort/";
  window.ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  const buf = new Uint8Array(man.bytes); let got = 0;
  await Promise.all(man.parts.map(async (n, i) => {
    const r = await fetch(base + "rtm/" + n); if (!r.ok) throw new Error("tracker part missing: " + n);
    const a = new Uint8Array(await r.arrayBuffer()); buf.set(a, i * 14000000); got += a.length; if (onProgress) onProgress(got / man.bytes, got);
  }));
  return { model: buf, eps: all && navigator.gpu ? ["webgpu", "wasm"] : ["wasm"] };
}
async function loadRemote(onProgress) {
  await loadScript(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.all.min.js`, "ort");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "JSZip");
  window.ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
  window.ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
  const zipBuf = await fetchCached(RTM_URL, onProgress);
  const zip = await window.JSZip.loadAsync(zipBuf);
  const entry = Object.values(zip.files).find(f => /end2end\.onnx$/.test(f.name));
  if (!entry) throw new Error("model file missing in download");
  const eps = []; if (navigator.gpu) eps.push("webgpu"); eps.push("wasm");
  return { model: new Uint8Array(await entry.async("arraybuffer")), eps };
}
export async function loadRTM(onProgress) {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    const got = (await loadBundled(onProgress)) || (await loadRemote(onProgress));
    let lastErr = null;
    for (const ep of got.eps) {
      try { session = await window.ort.InferenceSession.create(got.model, { executionProviders: [ep], graphOptimizationLevel: "all" }); backend = ep; break }
      catch (e) { lastErr = e; session = null }
    }
    if (!session) throw lastErr || new Error("no backend");
    return session;
  })();
  try { return await loading } catch (e) { loading = null; throw e }
}
export const rtmBackend = () => backend;

const cv = typeof document !== "undefined" ? document.createElement("canvas") : null;
if (cv) { cv.width = IN_W; cv.height = IN_H }
const g = cv ? cv.getContext("2d", { willReadFrequently: true }) : null;
// one look at the person in box [x1, y1, x2, y2] (video pixels). Returns Halpe-26 [x, y, score] in video pixels.
export async function rtmLook(src, W, H, box, mirror = false) {
  // the box -> centre and size with 25% padding, widened or heightened to the model's 3:4 shape
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  let sw = (box[2] - box[0]) * 1.25, sh = (box[3] - box[1]) * 1.25;
  if (sw > sh * IN_W / IN_H) sh = sw * IN_H / IN_W; else sw = sh * IN_W / IN_H;
  const kx = IN_W / sw, ky = IN_H / sh;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#000"; g.fillRect(0, 0, IN_W, IN_H);
  // model pixel u = (x - cx) * kx + IN_W / 2 (mirrored: u = IN_W / 2 - (x - cx) * kx)
  if (mirror) g.setTransform(-kx, 0, 0, ky, IN_W / 2 + cx * kx, IN_H / 2 - cy * ky);
  else g.setTransform(kx, 0, 0, ky, IN_W / 2 - cx * kx, IN_H / 2 - cy * ky);
  g.drawImage(src, 0, 0, W, H);
  const px = g.getImageData(0, 0, IN_W, IN_H).data, n = IN_W * IN_H, data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) data[c * n + i] = (px[i * 4 + c] - MEAN[c]) / STD[c] }
  const out = await session.run({ input: new window.ort.Tensor("float32", data, [1, 3, IN_H, IN_W]) });
  const sx = out.simcc_x.data, sy = out.simcc_y.data, K = out.simcc_x.dims[1], LX = out.simcc_x.dims[2], LY = out.simcc_y.dims[2];
  const res = new Array(K);
  for (let k = 0; k < K; k++) {
    let bx = 0, vx = -Infinity, by = 0, vy = -Infinity;
    for (let i = 0; i < LX; i++) { const v = sx[k * LX + i]; if (v > vx) { vx = v; bx = i } }
    for (let i = 0; i < LY; i++) { const v = sy[k * LY + i]; if (v > vy) { vy = v; by = i } }
    const u = bx / SPLIT, w = by / SPLIT, score = (vx + vy) / 2;
    const x = mirror ? cx - (u - IN_W / 2) / kx : cx + (u - IN_W / 2) / kx, y = cy + (w - IN_H / 2) / ky;
    res[k] = [x, y, score];
  }
  return mirror ? res.map((_, k) => res[HMIR[k]]) : res;
}
// Halpe-26 (video pixels) -> a MediaPipe-style 33-point look the rest of JP Pitching understands (no 3D of its own)
export function toLook(h, W, H, src) {
  const img = Array.from({ length: 33 }, () => [0.5, 0.5, 0]);
  const vis = s => Math.max(0, Math.min(1, s / 8));
  for (const [a, m] of H2M) img[m] = [h[a][0] / W, h[a][1] / H, vis(h[a][2])];
  for (const [wr, el, js] of [[15, 13, [17, 19, 21]], [16, 14, [18, 20, 22]]]) {            // hand points: just past the wrist
    const d = [img[wr][0] - img[el][0], img[wr][1] - img[el][1]];
    for (const j of js) img[j] = [img[wr][0] + 0.25 * d[0], img[wr][1] + 0.25 * d[1], img[wr][2]];
  }
  img[9] = img[10] = [img[0][0], img[0][1], img[0][2]];
  return { img, world: null, src };
}
