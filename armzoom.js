// Feole Pitching: close-up look at the throwing arm around release (see armZoom below)
import { rtmLook } from "./rtm.js";

// ---------------------------------------------------------------- close-up of the throwing arm around release
// At release the arm is a blur and fills only a small part of a whole-body look. The stronger tracker looks again with
// the picture cropped round the throwing shoulder and arm (about 2-3x the pixels on the arm), normal and mirrored.
// Where its two looks agree with each other and with the first looks, they sharpen the elbow, wrist and hand; where
// they don't, the joint is marked unsure, so the 3D rebuild fills it in with the throwing motion instead of guessing.
export async function armZoom(v, frames, W, H, fps, seekTo, say = () => {}, isCancelled = () => false) {
  const N = frames.length, px = (f, j) => [f.img[j][0] * W, f.img[j][1] * H];
  // throwing side: the wrist that moves fastest on screen
  const sp = [15, 16].map(j => { let m = 0, at = 0; for (let i = 1; i < N; i++) { const a = frames[i - 1], b = frames[i]; if (!a || !b) continue; const d = Math.hypot(...px(b, j).map((x, k) => x - px(a, j)[k])); if (d > m) { m = d; at = i } } return [m, at] });
  const [S, E, Wr, HND] = sp[1][0] >= sp[0][0] ? [12, 14, 16, [18, 20, 22]] : [11, 13, 15, [17, 19, 21]];
  const peak = (sp[1][0] >= sp[0][0] ? sp[1] : sp[0])[1], half = Math.round(0.17 * fps), lo = Math.max(0, peak - half), hi = Math.min(N - 1, peak + half);
  const HZ = { [S]: S === 12 ? 6 : 5, [E]: E === 14 ? 8 : 7, [Wr]: Wr === 16 ? 10 : 9 };   // Halpe-26 shoulder/elbow/wrist
  for (let i = lo; i <= hi; i++) {
    const f = frames[i]; if (!f) continue;
    if (isCancelled()) throw new Error("cancelled");
    await seekTo(i);
    const sh = px(f, S), arm = Math.hypot(...px(f, E).map((x, k) => x - sh[k])) + Math.hypot(...px(f, Wr).map((x, k) => x - px(f, E)[k]));
    const body = Math.max(...f.img.map(p => p[1] * H)) - Math.min(...f.img.map(p => p[1] * H));
    const r = Math.max(1.15 * arm, 0.3 * body);                                   // the whole arm fits whichever way it points
    const box = [sh[0] - r, sh[1] - r, sh[0] + r, sh[1] + r];
    const A = await rtmLook(v, W, H, box, false), B = await rtmLook(v, W, H, box, true);
    for (const j of [E, Wr]) {
      const a = A[HZ[j]], b = B[HZ[j]]; if (!a || !b) continue;
      const dis = Math.hypot(a[0] - b[0], a[1] - b[1]) / body;
      const cur = px(f, j), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], jump = Math.hypot(m[0] - cur[0], m[1] - cur[1]) / body;
      if (dis < 0.04 && jump < 0.08) {                                            // close-up agrees with itself and the first looks: refine
        const w = 0.65, nx = (cur[0] * (1 - w) + m[0] * w) / W, ny = (cur[1] * (1 - w) + m[1] * w) / H;
        const dx = nx - f.img[j][0], dy = ny - f.img[j][1];
        f.img[j] = [nx, ny, f.img[j][2]];
        if (j === Wr) HND.forEach(k => { f.img[k] = [f.img[k][0] + dx, f.img[k][1] + dy, f.img[k][2]] });
        if (f.spread) f.spread[j] = Math.min(f.spread[j] ?? 1, Math.max(0.02, dis));
      } else if (f.spread) f.spread[j] = Math.max(f.spread[j] ?? 0, 0.1);         // the looks disagree: mark the joint unsure (the 3D rebuild fills it in)
      else f.spread = f.img.map((_, k) => k === j ? 0.1 : 0);
    }
    if ((i - lo) % 3 === 0) say(`close-up of the throwing arm: frame ${i - lo + 1} of ${hi - lo + 1}`, 1);
  }
}
