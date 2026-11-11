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
      if (!r.pending) return resolve(r);
      // The service answers at once with a job ticket and works in the background; ask every few seconds until it's
      // done (the ticket was being taken for the result, so the app crashed reading a skeleton that wasn't there)
      const t1 = Date.now(), url = base.replace(/\/$/, "") + "/result/" + encodeURIComponent(r.job);
      let misses = 0;
      const poll = async () => {
        const s = Math.round((Date.now() - t1) / 1000);
        if (s > 20 * 60) return reject(new Error("The cloud 3D service took too long. Try a shorter window around the pitch."));
        let j = null;
        try { const resp = await fetch(url, { cache: "no-store" }); j = await resp.json() } catch (e) { j = null }
        if (!j) { if (++misses > 5) return reject(new Error("Couldn't reach the cloud 3D service. Check your connection and try again.")); return setTimeout(poll, 4000) }
        misses = 0;
        if (j.pending) { onStatus(`Cloud graphics card: ${j.stage || "working"} · ${s} s${s > 60 ? " (the first run of the day also loads the models)" : ""}`, Math.min(0.95, 0.15 + s / 400)); return setTimeout(poll, 3000) }
        if (!j.ok) return reject(new Error("The cloud 3D service couldn't analyse this clip: " + (j.error || "unknown reason")));
        resolve(j);
      };
      setTimeout(poll, 2000) };
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
  // ONE camera, not "measured": GVHMR's 3D is a learned guess from a single video, not several cameras. Taken as measured,
  // the app skipped every pitching fix (lab-throw arm, depth checks, turn gains) and Jackson's first real Ultra pitches
  // looked worse than Max (Boston College lefty: elbow at release 86° -> 41°, max layback 116° -> 136°, separation at
  // foot strike 27° -> 31-52° this way). So: its 2D projection is the tracker reading and its 3D is the learned depth
  // (the same slot the lifter fills for Fast/High/Max), and analyse() treats it like any other single camera.
  const l3 = frames.map(F => {
    const Wd = F.world, mid = (a, b) => [0, 1, 2].map(k => (a[k] + b[k]) / 2), L = Array.from({ length: 17 }, () => [0, 0, 0]);
    for (const [mp, h] of Object.entries(H36)) L[h] = Wd[mp].slice();
    const hip = mid(Wd[23], Wd[24]), sh = mid(Wd[11], Wd[12]); L[0] = hip; L[8] = sh; L[7] = mid(hip, sh); L[10] = Wd[0].slice();
    return L.map(p => [p[0] - hip[0], p[1] - hip[1], p[2] - hip[2]]);
  });
  for (const F of frames) { const Wd = F.world, hc = [0, 1, 2].map(k => (Wd[23][k] + Wd[24][k]) / 2); F.world = Wd.map(p => [p[0] - hc[0], p[1] - hc[1], p[2] - hc[2]]) }
  return { fps: r.fps, videoFps: r.fps, width: W, height: H, start: r.start || 0, frames, l3, source: "ultra" };
}
// Ultra joints (MediaPipe numbering) -> the learned-depth model's 17 joints (Human3.6M order), as in pipeline.js
const H36 = { 0: 9, 11: 11, 12: 14, 13: 12, 14: 15, 15: 13, 16: 16, 23: 4, 24: 1, 25: 5, 26: 2, 27: 6, 28: 3 };
