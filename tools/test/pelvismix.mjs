// How much of the app's own hip turn the whole-body fit should keep, by camera (report only).
// Runs the 60 benchmark views with the fit at pelvisMix 0 and 1 and saves signed pelvis/separation/trunk errors at
// foot strike, arm cocked and release plus the estimated camera direction, so any mix can be scored by interpolation
// (the mix only turns the hip line, so readings in between move in a straight line).
//   node tools/test/pelvismix.mjs [out.json]
import { readFileSync, readdirSync, writeFileSync } from "fs"; import { gunzipSync } from "zlib";
import { dirname, resolve } from "path"; import { fileURLToPath } from "url";
import { analyse } from "../../pipeline.js"; import { truthD, armLibFor } from "./truth.mjs";
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "bench") + "/", L = f => JSON.parse(gunzipSync(readFileSync(dir + f)));
const BL = JSON.parse(readFileSync(dir + "bodylib_holdout.json", "utf8")), wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
const KEYS = ["pelvisRot", "trunkRot", "separation"], out = [];
for (const f of readdirSync(dir).filter(f => f.endsWith(".raw.json.gz"))) {
  const v = f.replace(".raw.json.gz", ""), raw = L(f), tr = L(v + ".truth.json.gz"), T = truthD(tr), row = { v };
  for (const m of [0, 1]) {
    const D = analyse({ ...raw, heightIn: tr.height / 0.0254 }, { armLib: armLibFor(tr.sp), bodyLib: BL, bodyFit: true, bodyFitOpts: { pelvisMix: m, pelvisMixPre: 1 } });
    row.cam = D.cameraDir;
    for (const k of KEYS) for (const e of ["fs", "mer", "br"]) { const t = tr.events[e], a = D.metrics[k]?.[t], b = T.metrics[k]?.[t]; row[`${k}|${e}|${m}`] = a != null && b != null ? wrap(a - b) : null }
  }
  out.push(row); process.stderr.write(".");
}
writeFileSync(process.argv[2] || "/tmp/pelvismix.json", JSON.stringify(out));
