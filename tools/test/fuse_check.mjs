// Max accuracy combines up to seven looks per frame (fuse.js fuseSoft). Frames that most passes missed can arrive with
// one look of each kind; that used to crash ("Cannot read properties of undefined") and stop Max with an error.
// Builds every mix of 1-3 built-in looks and 0-2 stronger-tracker looks from a saved fixture frame and checks each
// combines without an error into 33 finite points with a finite "how sure" for every joint.
//   node tools/test/fuse_check.mjs
import fs from "fs"; import zlib from "zlib"; import { fuseSoft } from "../../fuse.js";
const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL("fixtures/maher_max.json.gz", import.meta.url))));
const fr = raw.frames.filter(f => f && f.img && f.world);
const W = raw.width || 1280, H = raw.height || 720, opts = { k: 4, srcW: { stillClose: 0.3, stillWideMirror: 0.3, rtm: 3, rtmMirror: 3 } };
const jig = (f, d) => f.img.map(p => [p[0] + d, p[1] - d, p[2] ?? 0.9]);
let bad = 0, n = 0;
for (const t of [0.3, 0.5, 0.7]) {
  const f = fr[Math.floor(fr.length * t)];
  for (let nm = 1; nm <= 3; nm++) for (let nr = 0; nr <= 2; nr++) {
    const c = [];
    for (let i = 0; i < nm; i++) c.push({ src: ["full", "zoom", "back"][i], img: jig(f, 0.004 * i), world: f.world.map(p => p.slice()) });
    for (let i = 0; i < nr; i++) c.push({ src: ["rtm", "rtmMirror"][i], img: jig(f, -0.003 * (i + 1)), world: null });
    n++;
    try {
      const o = fuseSoft(c, W, H, opts);
      const ok = o && o.img.length === 33 && o.img.every(p => p.every(Number.isFinite)) && (nm + nr === 1 || (o.spread && o.spread.every(Number.isFinite)));
      if (!ok) { bad++; console.log(`FAIL ${nm} built-in + ${nr} stronger: bad result`) }
    } catch (e) { bad++; console.log(`FAIL ${nm} built-in + ${nr} stronger: ${e.message}`) }
  }
}
console.log(bad ? `${bad} of ${n} mixes FAILED` : `all ${n} mixes combine fine`); process.exit(bad ? 1 : 0);
