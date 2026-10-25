// Feole Pitching: import a motion recorded with OpenCap (Stanford; two phones, measured 3D).
// OpenCap's download has a marker file (MarkerData/<trial>.trc): 3D points for every frame, in metres, Y up.
// They're turned into the skeleton Feole Pitching uses, viewed by a virtual side camera, and analysed as a
// measured motion (the 3D is taken as it is: nothing is guessed about depth).

const mid = (a, b) => a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : (a || b || null);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n] };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function parseTRC(text) {
  const lines = text.split(/\r?\n/);
  const meta = lines[2].trim().split(/\s+/), keys = lines[1].trim().split(/\s+/);
  const get = k => meta[keys.indexOf(k)];
  const rate = parseFloat(get("DataRate") || get("CameraRate") || meta[0]);
  const units = (get("Units") || "m").toLowerCase();
  const names = lines[3].split("\t").slice(2).map(s => s.trim()).filter(Boolean);
  const k = units === "mm" ? 0.001 : units === "cm" ? 0.01 : 1;
  const frames = [];
  for (let i = 5; i < lines.length; i++) {
    const c = lines[i].split("\t"); if (c.length < 3 || c[0].trim() === "") continue;
    const f = {};
    names.forEach((n, j) => { const x = parseFloat(c[2 + 3 * j]), y = parseFloat(c[3 + 3 * j]), z = parseFloat(c[4 + 3 * j]); if ([x, y, z].every(Number.isFinite)) f[n] = [x * k, y * k, z * k] });
    frames.push(f);
  }
  if (!(rate > 0) || frames.length < 6) throw new Error("This doesn't look like an OpenCap marker file (.trc).");
  return { rate, names, frames };
}

// both OpenCap marker sets: the anatomical ("_study") markers and the video keypoints
const PICK = {
  rSh: ["r_shoulder_study", "RShoulder"], lSh: ["L_shoulder_study", "LShoulder"],
  rEl: [["r_lelbow_study", "r_melbow_study"], "RElbow"], lEl: [["L_lelbow_study", "L_melbow_study"], "LElbow"],
  rWr: [["r_lwrist_study", "r_mwrist_study"], "RWrist"], lWr: [["L_lwrist_study", "L_mwrist_study"], "LWrist"],
  rHip: ["RHJC_study", "RHip"], lHip: ["LHJC_study", "LHip"],
  rKn: [["r_knee_study", "r_mknee_study"], "RKnee"], lKn: [["L_knee_study", "L_mknee_study"], "LKnee"],
  rAn: [["r_ankle_study", "r_mankle_study"], "RAnkle"], lAn: [["L_ankle_study", "L_mankle_study"], "LAnkle"],
  rHeel: ["r_calc_study", "RHeel"], lHeel: ["L_calc_study", "LHeel"],
  rToe: ["r_toe_study", "RBigToe"], lToe: ["L_toe_study", "LBigToe"],
  nose: ["Nose"], c7: ["C7_study", "Neck"],
};
function pick(f, spec) {
  for (const s of spec) {
    if (Array.isArray(s)) { const a = f[s[0]], b = f[s[1]]; if (a && b) return mid(a, b); if (a || b) return a || b }
    else if (f[s]) return f[s];
  }
  return null;
}

// marker file -> the app's measured-motion format (as if one side-on camera had filmed it, with depth measured)
export function trcToRaw(trc, { W = 1280, H = 720 } = {}) {
  const J = trc.frames.map(f => { const o = {}; for (const k in PICK) o[k] = pick(f, PICK[k]); return o });
  const need = ["rSh", "lSh", "rEl", "lEl", "rWr", "lWr", "rHip", "lHip", "rKn", "lKn", "rAn", "lAn"];
  const okF = J.map(o => need.every(k => o[k]));
  if (okF.filter(Boolean).length < 6) throw new Error("This OpenCap file is missing the shoulder, elbow, wrist, hip, knee or ankle markers.");
  const up = [0, 1, 0];                                                    // OpenSim: Y up
  // throwing direction: the stride (back ankle -> lead ankle at its longest), whichever foot leads
  let best = 0, dir = [1, 0, 0];
  J.forEach((o, t) => { if (!okF[t]) return; for (const [a, b] of [["rAn", "lAn"], ["lAn", "rAn"]]) { const d = sub(o[b], o[a]); d[1] = 0; const n = norm(d); if (n > best) { best = n; dir = unit(d) } } });
  // a side camera 6 m away, looking across the throw; its axes: x right (= toward home), y down, z away from it
  const ex = dir, ey = [0, -1, 0], ez = cross(ex, ey);                  // right-handed: x right, y down, z forward
  const toCam = p => [dot(p, ex), dot(p, ey), dot(p, ez)];
  // MediaPipe-33 layout
  const frames = J.map((o, t) => {
    if (!okF[t]) return null;
    const P = new Array(33).fill(null);
    P[11] = o.lSh; P[12] = o.rSh; P[13] = o.lEl; P[14] = o.rEl; P[15] = o.lWr; P[16] = o.rWr;
    P[23] = o.lHip; P[24] = o.rHip; P[25] = o.lKn; P[26] = o.rKn; P[27] = o.lAn; P[28] = o.rAn;
    const shm = mid(o.lSh, o.rSh), hpm = mid(o.lHip, o.rHip), tr = unit(sub(shm, hpm)), side = unit(sub(o.rSh, o.lSh)), fw = unit(cross(tr, side));
    const torso = norm(sub(shm, hpm));
    const head = o.nose ? sub(o.nose, mul(fw, 0.25 * 0.4 * torso)) : add(shm, add(mul(tr, 0.42 * torso), mul(fw, 0.1 * torso)));
    P[0] = o.nose || add(head, mul(fw, 0.25 * torso));
    const face = [[-0.06, 0.06], [-0.08, 0.06], [-0.1, 0.05], [0.06, 0.06], [0.08, 0.06], [0.1, 0.05], [-0.2, 0], [0.2, 0], [-0.05, -0.08], [0.05, -0.08]];
    face.forEach(([s, h], k) => { P[k + 1] = add(head, add(mul(side, -s * torso), add(mul(fw, 0.18 * torso), mul(tr, h * torso)))) });
    for (const [wr, el, js] of [[16, 14, [18, 20, 22]], [15, 13, [17, 19, 21]]]) { const d = sub(P[wr], P[el]); js.forEach(j => P[j] = add(P[wr], mul(d, 0.3))) }
    for (const [an, heel, toe, kh, kt] of [[27, "lHeel", "lToe", 29, 31], [28, "rHeel", "rToe", 30, 32]]) {
      P[kh] = o[heel] || add(P[an], [0, -0.05, 0]); P[kt] = o[toe] || add(P[an], add(mul(dir, 0.16), [0, -0.06, 0]));
    }
    return P.map(toCam);
  });
  // the virtual picture: orthographic, the whole motion fitted into the frame
  const all = frames.filter(Boolean).flat(), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min(0.9 * W / (x1 - x0), 0.85 * H / (y1 - y0)), ox = W / 2 - s * (x0 + x1) / 2, oy = H / 2 - s * (y0 + y1) / 2;
  const hip0 = frames.find(Boolean), h0 = mid(hip0[23], hip0[24]);
  const out = frames.map(F => F && {
    img: F.map(p => [(ox + s * p[0]) / W, (oy + s * p[1]) / H, 1]),
    world: F, spread: F.map(() => 0.01),
  });
  const travel = frames.map(F => { if (!F) return null; const h = mid(F[23], F[24]); return sub(h, h0) });
  for (let t = 0; t < travel.length; t++) if (!travel[t]) travel[t] = travel[t - 1] || [0, 0, 0];
  return { fps: trc.rate, videoFps: trc.rate, width: W, height: H, start: 0, frames: out, travel, measured: true, source: "opencap",
           cameras: [{ label: "OpenCap (2 phones)", offset: 0, syncConfidence: 1, angle: 0 }] };
}
