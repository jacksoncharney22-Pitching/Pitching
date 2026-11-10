// Delivery measurements vs motion capture (60 benchmark views): stride length, arm slot, hand height and extension at
// release, peak hip-shoulder separation and when it happens.   node tools/test/measures.mjs [--views] [--check | --update]
// --check: fail (exit 1) if a measurement's average error got clearly worse than measures_baseline.json (the delivery
// numbers coaches see: stride, slot, hand height, separation; extension too). --update: save the current errors as the baseline.
import { readFileSync, readdirSync, writeFileSync } from "fs"; import { gunzipSync } from "zlib";
import { analyse, deliveryMeasures } from "../../pipeline.js"; import { truthD, armLibFor } from "./truth.mjs";
// BODYFIT=1: with the whole-body fit (benchmark views use the library built without the benchmark athletes)
const BODYLIB = process.env.BODYFIT ? JSON.parse(readFileSync(new URL("./bench/bodylib_holdout.json", import.meta.url), "utf8")) : null;
const dir=process.env.BENCHDIR?process.env.BENCHDIR.replace(/\/?$/,"/"):new URL("./bench/", import.meta.url).pathname;   // BENCHDIR=<dir>: other views (e.g. unusual_make.py)
 const load=f=>JSON.parse(gunzipSync(readFileSync(dir+f)).toString());
const views=readdirSync(dir).filter(f=>f.endsWith(".raw.json.gz")).map(f=>f.replace(".raw.json.gz",""));
const KEYS=["strideLen","strideM","armSlot","relHeight","extension","peakSep","peakSepMs"], E=Object.fromEntries(KEYS.map(k=>[k,[]])), S=Object.fromEntries(KEYS.map(k=>[k,[]])), A=Object.fromEntries(KEYS.map(k=>[k,[]])), T=Object.fromEntries(KEYS.map(k=>[k,[]]));
const CAM={};
for(const v of views){const raw=load(v+".raw.json.gz"),tr=load(v+".truth.json.gz"),D=analyse({...raw,heightIn:tr.height/.0254},{armLib:armLibFor(tr.sp),...(BODYLIB?{bodyLib:BODYLIB,bodyFit:true}:{}),...(process.env.OPTS?JSON.parse(process.env.OPTS):{})}),TD=truthD(tr);
 const a=deliveryMeasures(D,tr.height),b=deliveryMeasures(TD,tr.height,0);
 if(process.argv.includes("--views"))console.log(v,KEYS.map(k=>k+" "+(a[k]?.toFixed(2))+"/"+(b[k]?.toFixed(2))).join("  "));
 {const c=v.replace(/^\d+_\d+_/,"");(CAM[c]=CAM[c]||[]).push(a.strideM-b.strideM)}
 for(const k of KEYS){E[k].push(Math.abs(a[k]-b[k]));S[k].push(a[k]-b[k]);A[k].push(a[k]);T[k].push(b[k])}}
const m=x=>x.reduce((s,y)=>s+y,0)/x.length,sd=x=>{const u=m(x);return Math.sqrt(m(x.map(v=>(v-u)**2)))};
const r=(x,y)=>{const a=m(x),b=m(y);return m(x.map((v,i)=>(v-a)*(y[i]-b)))/(sd(x)*sd(y))};
console.log("measure        mean err   bias    app mean  truth mean  truth spread  corr");
for(const k of KEYS)console.log(k.padEnd(14),m(E[k]).toFixed(3).padStart(8),m(S[k]).toFixed(3).padStart(7),m(A[k]).toFixed(3).padStart(9),m(T[k]).toFixed(3).padStart(10),sd(T[k]).toFixed(3).padStart(12),r(A[k],T[k]).toFixed(2).padStart(6));
console.log("stride bias by camera (m):",Object.entries(CAM).map(([c,x])=>c+" "+m(x).toFixed(3)).join("  "));
// guard: average error may grow by 5% of the measurement's own error or a small floor (noise between runs is zero: Node is
// deterministic, so any change is a real change in the code)
const BASE = new URL("./measures_baseline.json", import.meta.url), FLOOR = { strideLen: 0.003, strideM: 0.005, armSlot: 0.2, relHeight: 0.005, extension: 0.008, peakSep: 0.3, peakSepMs: 3 };
if (!process.env.BENCHDIR && !process.env.BODYFIT && !process.env.OPTS) {
  const now = Object.fromEntries(KEYS.map(k => [k, +m(E[k]).toFixed(4)]));
  if (process.argv.includes("--update")) { writeFileSync(BASE, JSON.stringify(now, null, 1) + "\n"); console.log("baseline saved") }
  else if (process.argv.includes("--check")) {
    const b = JSON.parse(readFileSync(BASE, "utf8")); let bad = 0;
    for (const k of KEYS) { const lim = b[k] + Math.max(FLOOR[k], 0.05 * b[k]); if (now[k] > lim) { bad++; console.log(`WORSE ${k}: ${now[k]} vs baseline ${b[k]} (limit ${lim.toFixed(4)})`) } else if (now[k] < b[k] - FLOOR[k]) console.log(`better ${k}: ${now[k]} vs ${b[k]} (run --update to keep it)`) }
    if (bad) { console.log(`${bad} delivery measurement(s) got worse`); process.exit(1) } else console.log("delivery measurements: none worse than the baseline");
  }
}
