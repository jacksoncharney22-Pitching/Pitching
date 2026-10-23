// JP Pitching: combining many tracker looks at the same frame (no DOM; testable in node)
const MIRJ = j => ({1:4,2:5,3:6,4:1,5:2,6:3,7:8,8:7,9:10,10:9,11:12,12:11,13:14,14:13,15:16,16:15,17:18,18:17,19:20,20:19,21:22,22:21,23:24,24:23,25:26,26:25,27:28,28:27,29:30,30:29,31:32,32:31})[j] ?? j;
const LR_PAIRS = [[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],[23,24],[25,26],[27,28],[29,30],[31,32]];
const LEG_PAIRS = [[25,26],[27,28],[29,30],[31,32]], ARM_PAIRS = [[13,14],[15,16],[17,18],[19,20],[21,22]];
const FUSE_J = [0,11,12,13,14,15,16,23,24,25,26,27,28];
// a tracker result -> full-frame pose. crop: {sx, sy, side, mirror} in video pixels (null = the whole frame)
export function toFrame(lm, wl, crop, W, H) {
  const img = new Array(33), world = new Array(33);
  for (let j = 0; j < 33; j++) {
    const k = crop?.mirror ? MIRJ(j) : j, p = lm[k], w = wl ? wl[k] : { x: 0, y: 0, z: 0 };
    const u = crop?.mirror ? 1 - p.x : p.x;
    img[j] = crop ? [(crop.sx + u * crop.side) / W, (crop.sy + p.y * crop.side) / H, p.visibility ?? 1] : [p.x, p.y, p.visibility ?? 1];
    world[j] = [crop?.mirror ? -w.x : w.x, w.y, w.z];
  }
  return { img, world };
}
export function poseBox(f, W, H) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of f.img) { const x = p[0] * W, y = p[1] * H; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  return [(x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0, 8)];
}
const poseDist = (a, b, W, H) => FUSE_J.reduce((s, j) => s + Math.hypot((a.img[j][0] - b.img[j][0]) * W, (a.img[j][1] - b.img[j][1]) * H), 0) / FUSE_J.length;
// several people in view (batter, catcher, umpire, coach): keep the one that is the pitcher
export function pickPitcher(res, crop, W, H, ref) {
  const n = res.landmarks?.length || 0; if (!n) return null;
  const all = []; for (let i = 0; i < n; i++) all.push(toFrame(res.landmarks[i], res.worldLandmarks?.[i], crop, W, H));
  if (n === 1 && !ref) return all[0];
  if (!ref) return all.reduce((a, b) => poseBox(b, W, H)[2] > poseBox(a, W, H)[2] ? b : a);       // biggest person
  const rb = poseBox(ref, W, H); let best = null, bd = Infinity;
  for (const f of all) { const d = poseDist(f, ref, W, H); if (d < bd) { bd = d; best = f } }
  return bd < 0.6 * rb[2] ? best : null;                                                           // nobody near the pitcher: drop it
}
function swapPairs(f, pairs) { for (const [a, b] of pairs) for (const k of ["img", "world"]) { if (!f[k]) continue; const x = f[k][a]; f[k][a] = f[k][b]; f[k][b] = x } }
function groupDist(f, ref, pairs, swapped, W, H) { let s = 0; for (const [a, b] of pairs) { const A = f.img[swapped ? b : a], B = f.img[swapped ? a : b]; s += Math.hypot((A[0] - ref.img[a][0]) * W, (A[1] - ref.img[a][1]) * H) + Math.hypot((B[0] - ref.img[b][0]) * W, (B[1] - ref.img[b][1]) * H) } return s }
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0 };
function medianPose(cs) { const cw = cs.filter(c => c.world); return { img: cs[0].img.map((_, j) => [0, 1, 2].map(d => med(cs.map(c => c.img[j][d])))), world: cw.length ? cw[0].world.map((_, j) => [0, 1, 2].map(d => med(cw.map(c => c.world[j][d])))) : null } }
// robust fusion of every look at one frame: left/right labels aligned, outliers dropped per joint, visibility-weighted mean
export function fuse(cands, W, H) {
  cands = cands.filter(Boolean).map(c => ({ img: c.img.map(p => p.slice()), world: c.world.map(p => p.slice()) }));
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  let ref = medianPose(cands);
  for (const c of cands) for (const pairs of [LR_PAIRS, LEG_PAIRS, ARM_PAIRS])
    if (groupDist(c, ref, pairs, true, W, H) < 0.7 * groupDist(c, ref, pairs, false, W, H)) swapPairs(c, pairs);
  ref = medianPose(cands);
  const size = poseBox(ref, W, H)[2], out = { img: new Array(33), world: new Array(33), agree: 0 };
  let spread = 0;
  for (let j = 0; j < 33; j++) {
    const d = cands.map(c => Math.hypot((c.img[j][0] - ref.img[j][0]) * W, (c.img[j][1] - ref.img[j][1]) * H));
    const thr = Math.max(2.5 * 1.4826 * med(d), 0.025 * size);
    const keep = cands.filter((_, i) => d[i] <= thr), ws = keep.map(c => Math.max(0.05, c.img[j][2]));
    const W8 = ws.reduce((a, b) => a + b, 0);
    const xy = [0, 1].map(k => keep.reduce((a, c, i) => a + c.img[j][k] * ws[i], 0) / W8);
    const vis = keep.reduce((a, c) => a + c.img[j][2], 0) / keep.length * Math.sqrt(keep.length / cands.length);
    out.img[j] = [xy[0], xy[1], vis];
    out.world[j] = [0, 1, 2].map(k => med(keep.map(c => c.world[j][k])));
    if (FUSE_J.includes(j)) spread += med(d) / size;
  }
  out.agree = spread / FUSE_J.length;
  return out;
}

// soft version: every look counts, weighted by how far it sits from the consensus (iteratively re-weighted),
// so the result can't jump when one look drops in or out between frames
const finite = c => !!c && c.img.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])) && (!c.world || c.world.every(p => p.every(Number.isFinite)));
export function fuseSoft(cands, W, H, { srcW = {}, iters = 3, k = 2, floor = 0.012 } = {}) {
  // looks from the stronger tracker carry no 3D (world: null): they count for where joints are on screen, and the
  // depth comes from the looks that have it
  cands = cands.filter(finite).map(c => ({ ...c, img: c.img.map(p => [p[0], p[1], Number.isFinite(p[2]) ? p[2] : 0.5]) })).map(c => ({ src: c.src, img: c.img.map(p => p.slice()), world: c.world ? c.world.map(p => p.slice()) : null }));
  if (!cands.some(c => c.world)) return null;
  // the stronger tracker decides where the joints are on screen; the built-in tracker's looks only supply depth.
  // The stronger tracker's normal and mirrored looks checking each other decide how sure each joint is.
  const isRtm = c => typeof c.src === "string" && c.src.startsWith("rtm");
  const rt = cands.filter(isRtm), mpc = cands.filter(c => !isRtm(c));
  if (rt.length && mpc.length) {
    const base = fuseSoft(mpc, W, H, { srcW, iters, k, floor });
    if (!base) return null;
    const ref = medianPose(rt);
    for (const c of [base, ...rt]) for (const pairs of [LR_PAIRS, LEG_PAIRS, ARM_PAIRS])
      if (groupDist(c, ref, pairs, true, W, H) < 0.7 * groupDist(c, ref, pairs, false, W, H)) swapPairs(c, pairs);
    const size = poseBox(ref, W, H)[2], out = { img: new Array(33), world: base.world, spread: new Array(33) };
    for (let j = 0; j < 33; j++) {
      const ws = rt.map(c => Math.max(0.05, c.img[j][2])), S = ws.reduce((a, b) => a + b, 0);
      const x = rt.reduce((a, c, i) => a + c.img[j][0] * ws[i], 0) / S, y = rt.reduce((a, c, i) => a + c.img[j][1] * ws[i], 0) / S;
      out.img[j] = [x, y, rt.reduce((a, c) => a + c.img[j][2], 0) / rt.length];
      out.spread[j] = rt.length > 1 ? Math.round(med(rt.map(c => Math.hypot((c.img[j][0] - x) * W, (c.img[j][1] - y) * H))) / size * 1e4) / 1e4 : base.spread[j];
    }
    return out;
  }
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  let ref = medianPose(cands);
  for (const c of cands) for (const pairs of [LR_PAIRS, LEG_PAIRS, ARM_PAIRS])
    if (groupDist(c, ref, pairs, true, W, H) < 0.7 * groupDist(c, ref, pairs, false, W, H)) swapPairs(c, pairs);
  ref = medianPose(cands);
  const size = poseBox(ref, W, H)[2], out = { img: new Array(33), world: new Array(33), spread: new Array(33) };
  const sw = cands.map(c => srcW[c.src] ?? 1);
  for (let j = 0; j < 33; j++) {
    let cx = ref.img[j][0], cy = ref.img[j][1], ws = null;
    for (let it = 0; it < iters; it++) {
      const d = cands.map(c => Math.hypot((c.img[j][0] - cx) * W, (c.img[j][1] - cy) * H));
      const sig = Math.max(1.4826 * med(d), floor * size);
      ws = cands.map((c, i) => sw[i] * Math.max(0.05, c.img[j][2]) / (1 + (d[i] / (k * sig)) ** 2));
      const S = ws.reduce((a, b) => a + b, 0);
      cx = cands.reduce((a, c, i) => a + c.img[j][0] * ws[i], 0) / S; cy = cands.reduce((a, c, i) => a + c.img[j][1] * ws[i], 0) / S;
    }
    const S = ws.reduce((a, b) => a + b, 0), S0 = cands.reduce((a, c, i) => a + sw[i] * Math.max(0.05, c.img[j][2]), 0);
    const vis = cands.reduce((a, c, i) => a + c.img[j][2] * ws[i], 0) / S * Math.sqrt(S / S0);
    out.img[j] = [cx, cy, vis];
    let SW = 0; const wv = [0, 0, 0]; cands.forEach((c, i) => { if (!c.world) return; SW += ws[i]; for (let q = 0; q < 3; q++) wv[q] += c.world[j][q] * ws[i] });
    out.world[j] = SW > 0 ? wv.map(v => v / SW) : ref.world[j].slice();
    // how much the looks disagree about this joint (share of body height): high when a limb is a motion blur
    out.spread[j] = Math.round(med(cands.map(c => Math.hypot((c.img[j][0] - cx) * W, (c.img[j][1] - cy) * H))) / size * 1e4) / 1e4;
  }
  return finite(out) ? out : null;
}
