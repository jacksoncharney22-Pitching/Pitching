// Feole Pitching "Ultra": the video goes to a cloud graphics card running GVHMR (a 3D human-motion model trained on
// large motion-capture collections, fitting a whole SMPL-X body to every frame). It returns the body's 3D joints in
// the camera's axes; they're analysed here as a measured motion (depth comes from the body model, not a guess).

// the address of the cloud service (set once it's deployed; can be overridden for testing)
export const ULTRA_DEFAULT_URL = "";
export function ultraURL() {
  try { const q = new URLSearchParams(location.search).get("ultra"); if (q) { localStorage.setItem("fp-ultra-url", q); return q } } catch (e) {}
  try { return localStorage.getItem("fp-ultra-url") || ULTRA_DEFAULT_URL } catch (e) { return ULTRA_DEFAULT_URL }
}

// upload with progress, then wait for the result (a cold start loads the models first: up to a few minutes)
export function runUltra(file, { start = 0, end = 1e9, staticCam = true, onStatus = () => {} } = {}) {
  const base = ultraURL();
  if (!base) return Promise.reject(new Error("Ultra isn't switched on yet: the cloud 3D service hasn't been set up. Choose Max accuracy for now."));
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("video", file, file.name || "pitch.mp4"); fd.append("start", String(start)); fd.append("end", String(end)); fd.append("static", staticCam ? "true" : "false");
    const x = new XMLHttpRequest();
    x.open("POST", base.replace(/\/$/, "") + "/analyze");
    x.timeout = 20 * 60 * 1000;
    let t0 = 0, tick = null;
    x.upload.onprogress = e => { if (e.lengthComputable) onStatus(`Uploading the video ${Math.round(100 * e.loaded / e.total)}%`, 0.15 * e.loaded / e.total) };
    x.upload.onload = () => { t0 = Date.now(); tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); onStatus(`Fitting the 3D body on the cloud graphics card · ${s} s${s > 60 ? " (the first run of the day also loads the models)" : ""}`, Math.min(0.95, 0.15 + s / 400)) }, 1000) };
    const done = () => { if (tick) clearInterval(tick) };
    x.onload = () => { done();
      let r = null; try { r = JSON.parse(x.responseText) } catch (e) {}
      if (x.status !== 200 || !r) return reject(new Error(`The cloud 3D service answered ${x.status}. Try again in a minute.`));
      if (!r.ok) return reject(new Error("The cloud 3D service couldn't analyse this clip: " + (r.error || "unknown reason")));
      resolve(r) };
    x.onerror = () => { done(); reject(new Error("Couldn't reach the cloud 3D service. Check your connection and try again.")) };
    x.ontimeout = () => { done(); reject(new Error("The cloud 3D service took too long. Try a shorter window around the pitch.")) };
    x.send(fd);
  });
}

// SMPL-X joints (first 76: body, jaw/eyes, hands, then nose, eyes, ears, toes, heels, fingertips) -> MediaPipe 33
const SX = { 0: 55, 2: 57, 5: 56, 7: 59, 8: 58, 11: 16, 12: 17, 13: 18, 14: 19, 15: 20, 16: 21, 17: 70, 18: 75, 19: 67, 20: 72, 21: 66, 22: 71,
             23: 1, 24: 2, 25: 4, 26: 5, 27: 7, 28: 8, 29: 62, 30: 65, 31: 60, 32: 63 };
const FALLBACK = { 0: 15, 2: 15, 5: 15, 7: 15, 8: 15, 17: 20, 19: 20, 21: 20, 18: 21, 20: 21, 22: 21, 29: 7, 30: 8, 31: 10, 32: 11 };
export function ultraToRaw(r) {
  const n = r.joints_camera[0].length, W = r.width, H = r.height;
  const frames = r.joints_camera.map((J, t) => {
    const P = new Array(33);
    for (let k = 0; k < 33; k++) { const s = SX[k] != null && SX[k] < n ? SX[k] : FALLBACK[k]; P[k] = s != null && J[s] ? J[s].slice() : null }
    // eye corners and mouth (only drawn as the head)
    P[1] = P[3] = P[2]; P[4] = P[6] = P[5];
    P[9] = P[10] = P[0] ? [P[0][0], P[0][1] + 0.03, P[0][2]] : J[15];
    for (let k = 0; k < 33; k++) if (!P[k]) P[k] = J[15].slice();
    const K = r.K[Math.min(t, r.K.length - 1)], fx = K[0][0], fy = K[1][1], cx = K[0][2], cy = K[1][2];
    const img = P.map(p => [(fx * p[0] / p[2] + cx) / W, (fy * p[1] / p[2] + cy) / H, 1]);
    return { img, world: P, spread: P.map(() => 0.01) };
  });
  const hip = F => [(F.world[23][0] + F.world[24][0]) / 2, (F.world[23][1] + F.world[24][1]) / 2, (F.world[23][2] + F.world[24][2]) / 2];
  const h0 = hip(frames[0]), travel = frames.map(F => { const h = hip(F); return [h[0] - h0[0], h[1] - h0[1], h[2] - h0[2]] });
  return { fps: r.fps, videoFps: r.fps, width: W, height: H, start: r.start || 0, frames, travel, measured: true, source: "ultra",
           cameras: [{ label: "Ultra", offset: 0, syncConfidence: 1, angle: 0 }] };
}
