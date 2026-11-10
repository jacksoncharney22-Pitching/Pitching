// Damaged-input check (no browser): the skeleton build must never crash or hang on bad tracker output, which is what a
// shaky phone clip, a pitcher walking out of the picture or a two-second upload produce. Every fixture is damaged in
// several ways (frames lost at random or in one long run, very short clips, NaN points, the throwing arm never seen,
// no 3D points, a pitcher standing still, ...) and run through analyse() and detectSlowFactor() with the lab arm library.
// A run passes if it either returns a result whose events are in order and whose numbers are finite or empty, or stops
// with a plain message (an Error with text); it fails on a crash inside the maths (TypeError etc.) or a run over 20 s.
//   node tools/test/robust.mjs           (exit 1 on any failure)
import { readFileSync, readdirSync } from "fs"; import { gunzipSync } from "zlib";
import { dirname, join } from "path"; import { fileURLToPath } from "url";
import { analyse, detectSlowFactor } from "../../pipeline.js";
const here = dirname(fileURLToPath(import.meta.url)), fx = join(here, "fixtures");
const LIB = JSON.parse(readFileSync(join(here, "../../armlib.json"), "utf8"));
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const clone = o => JSON.parse(JSON.stringify(o));
const DAMAGE = {
  "30% of frames lost": r => { r.frames = r.frames.map(f => rnd() < 0.3 ? null : f) },
  "70% of frames lost": r => { r.frames = r.frames.map(f => rnd() < 0.7 ? null : f) },
  "middle third lost": r => { const n = r.frames.length; r.frames = r.frames.map((f, i) => i > n / 3 && i < 2 * n / 3 ? null : f) },
  "first 12 frames only": r => { r.frames = r.frames.slice(0, 12) },
  "3 frames": r => { r.frames = r.frames.slice(0, 3) },
  "1 frame": r => { r.frames = r.frames.slice(0, 1) },
  "no frames": r => { r.frames = [] },
  "all frames lost": r => { r.frames = r.frames.map(() => null) },
  "NaN points": r => { for (const f of r.frames) if (f && rnd() < 0.2) { const j = Math.floor(rnd() * 33); f.img[j][0] = NaN; if (f.world) f.world[j][2] = NaN } },
  "throwing arm never seen": r => { for (const f of r.frames) if (f) for (const j of [11, 12, 13, 14, 15, 16]) f.img[j][2] = 0 },
  "no 3D points": r => { for (const f of r.frames) if (f) delete f.world },
  "no learned depth": r => { delete r.l3 },
  "standing still": r => { const f0 = r.frames.find(Boolean); r.frames = r.frames.map(() => clone(f0)) },
  "claimed 240 fps": r => { r.fps = 240; r.videoFps = 240 },
  "tiny picture": r => { r.width = 64; r.height = 48 },
  "reversed in time": r => { r.frames.reverse() },
};
const files = readdirSync(fx).filter(f => /\.json(\.gz)?$/.test(f));
let bad = 0, n = 0;
for (const file of files) {
  const buf = readFileSync(join(fx, file)), base = JSON.parse((file.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8"));
  if (!Array.isArray(base.frames)) continue;
  for (const [name, hurt] of Object.entries(DAMAGE)) {
    const raw = clone(base); seed = 7; hurt(raw);
    if (raw.l3 && raw.l3.length !== undefined && raw.l3.length !== raw.frames.length) delete raw.l3;   // learned depth is per frame: keep it only when the frames still line up
    const t0 = Date.now(); let res = "ok", why = "";
    try {
      detectSlowFactor(clone(raw));
      const D = analyse(raw, { hand: "auto", armLib: LIB });
      const fr = (D.phases || []).map(p => p.frame).filter(x => x != null);
      if (fr.some((x, i) => i && x < fr[i - 1])) { res = "FAIL"; why = "events out of order " + D.phases.map(p => p.name + " " + p.frame).join(", ") }
      for (const [k, a] of Object.entries(D.metrics || {})) if (Array.isArray(a) && a.some(x => x != null && !Number.isFinite(x))) { res = "FAIL"; why = "non-finite " + k; break }
      if (D.pose && D.pose.some(F => F && F.some(p => p && p.some(x => !Number.isFinite(x))))) { res = "FAIL"; why = "non-finite skeleton point" }
    } catch (e) {
      if (e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || !e.message) { res = "FAIL"; why = "crash: " + (e && e.stack || e).toString().split("\n").slice(0, 2).join(" ") }
      else { res = "stop"; why = e.message }
    }
    const ms = Date.now() - t0; if (ms > 20000) { res = "FAIL"; why += ` took ${ms} ms` }
    n++; if (res === "FAIL") bad++;
    console.log(`${res.padEnd(5)} ${file.padEnd(22)} ${name.padEnd(24)} ${(ms / 1000).toFixed(1)} s  ${why}`);
  }
}
console.log(`\n${n - bad} of ${n} damaged runs handled`);
process.exit(bad ? 1 : 0);
