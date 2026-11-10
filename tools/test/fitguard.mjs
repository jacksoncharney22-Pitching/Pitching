// The lab-matched body (bodyfit.js, trial ?bodyfit=1) must be used when it lines up with the video and refused when it
// doesn't: Maher and Staumont get the fit; the same clips with their second half scrambled (the tracker jumping around)
// and Hackimer's speed-ramped slow motion keep the app's own body. Exit 1 if not.   node tools/test/fitguard.mjs
import { readFileSync } from "fs"; import { gunzipSync } from "zlib";
import { analyse } from "../../pipeline.js";
const here = new URL(".", import.meta.url).pathname, LIB = JSON.parse(readFileSync(here + "../../bodylib.json", "utf8")), ARM = JSON.parse(readFileSync(here + "../../armlib.json", "utf8"));
const load = f => { const r = JSON.parse(gunzipSync(readFileSync(here + "fixtures/" + f + ".json.gz"))); return r.raw || r };
const scramble = raw => { const T = raw.frames.length; return { ...raw, frames: raw.frames.map((fr, t) => t > T * 0.45 && fr ? raw.frames[(t * 7) % T] || fr : fr) } };
let bad = 0;
const check = (name, raw, want) => { const D = analyse(raw, { armLib: ARM, bodyLib: LIB, bodyFit: true }), used = !!D.bodyFit;
  const miss = D.bodyFit ? D.bodyFit.miss : D.bodyFitMiss; if (used !== want) bad++;
  console.log(`${used === want ? "ok  " : "FAIL"} ${name.padEnd(26)} fit ${used ? "used" : "not used"} (miss ${miss == null ? "-" : (100 * miss).toFixed(1) + "% of body height"}), expected ${want ? "used" : "not used"}`) };
for (const f of ["maher_max", "maher_fast", "staumont_fast"]) { const raw = load(f); check(f, raw, true); check(f + " scrambled", scramble(raw), false) }
check("hackimer_fast", load("hackimer_fast"), false);
process.exit(bad ? 1 : 0);
