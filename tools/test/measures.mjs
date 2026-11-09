// Delivery measurements vs motion capture (60 benchmark views): stride length, arm slot, hand height and extension at
// release, peak hip-shoulder separation and when it happens.   node tools/test/measures.mjs [--views]
import { readFileSync, readdirSync } from "fs"; import { gunzipSync } from "zlib";
import { analyse, deliveryMeasures } from "../../pipeline.js"; import { truthD, armLibFor } from "./truth.mjs";
const dir=new URL("./bench/", import.meta.url).pathname; const load=f=>JSON.parse(gunzipSync(readFileSync(dir+f)).toString());
const views=readdirSync(dir).filter(f=>f.endsWith(".raw.json.gz")).map(f=>f.replace(".raw.json.gz",""));
const KEYS=["strideLen","strideM","armSlot","relHeight","extension","peakSep","peakSepMs"], E=Object.fromEntries(KEYS.map(k=>[k,[]])), S=Object.fromEntries(KEYS.map(k=>[k,[]])), A=Object.fromEntries(KEYS.map(k=>[k,[]])), T=Object.fromEntries(KEYS.map(k=>[k,[]]));
for(const v of views){const raw=load(v+".raw.json.gz"),tr=load(v+".truth.json.gz"),D=analyse({...raw,heightIn:tr.height/.0254},{armLib:armLibFor(tr.sp)}),TD=truthD(tr);
 const a=deliveryMeasures(D,tr.height),b=deliveryMeasures(TD,tr.height);
 if(process.argv.includes("--views"))console.log(v,KEYS.map(k=>k+" "+(a[k]?.toFixed(2))+"/"+(b[k]?.toFixed(2))).join("  "));
 for(const k of KEYS){E[k].push(Math.abs(a[k]-b[k]));S[k].push(a[k]-b[k]);A[k].push(a[k]);T[k].push(b[k])}}
const m=x=>x.reduce((s,y)=>s+y,0)/x.length,sd=x=>{const u=m(x);return Math.sqrt(m(x.map(v=>(v-u)**2)))};
const r=(x,y)=>{const a=m(x),b=m(y);return m(x.map((v,i)=>(v-a)*(y[i]-b)))/(sd(x)*sd(y))};
console.log("measure        mean err   bias    app mean  truth mean  truth spread  corr");
for(const k of KEYS)console.log(k.padEnd(14),m(E[k]).toFixed(3).padStart(8),m(S[k]).toFixed(3).padStart(7),m(A[k]).toFixed(3).padStart(9),m(T[k]).toFixed(3).padStart(10),sd(T[k]).toFixed(3).padStart(12),r(A[k],T[k]).toFixed(2).padStart(6));
