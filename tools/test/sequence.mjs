// Kinematic sequence vs motion capture (pelvis and trunk peak rotation speed, timing and order), 60 benchmark views.
//   node tools/test/sequence.mjs
import { readFileSync, readdirSync } from "fs"; import { gunzipSync } from "zlib";
import { analyse } from "../../pipeline.js"; import { truthD, armLibFor } from "./truth.mjs";
const dir=new URL("./bench/", import.meta.url).pathname; const load=f=>JSON.parse(gunzipSync(readFileSync(dir+f)).toString());
const views=readdirSync(dir).filter(f=>f.endsWith(".raw.json.gz")).map(f=>f.replace(".raw.json.gz",""));
const spd=(a,fps)=>a.map((v,i)=>i&&i<a.length-1&&a[i-1]!=null&&a[i+1]!=null?(a[i+1]-a[i-1])*fps/2:null);
const peak=(a,lo,hi)=>{let b=lo,v=-1e9;for(let t=lo;t<=hi;t++)if(a[t]!=null&&Math.abs(a[t])>v){v=Math.abs(a[t]);b=t}return[b,v]};
const E={p:[],t:[],pv:[],tv:[],gap:[],gt:[],ok:0,n:0};
for(const v of views){const raw=load(v+".raw.json.gz"),tr=load(v+".truth.json.gz"),M=truthD(tr).metrics,D=analyse({...raw,heightIn:tr.height/.0254},{armLib:armLibFor(tr.sp)});const fps=D.fps,{fs,br}=tr.events,lo=fs-Math.round(.1*fps),hi=br+Math.round(.05*fps);
 const f=(m,k)=>peak(spd(m[k],fps),lo,hi);
 const [pa,pva]=f(D.metrics,"pelvisRot"),[ta,tva]=f(D.metrics,"trunkRot"),[pb,pvb]=f(M,"pelvisRot"),[tb,tvb]=f(M,"trunkRot");
 E.p.push(Math.abs(pa-pb)/fps*1e3);E.t.push(Math.abs(ta-tb)/fps*1e3);E.pv.push(Math.abs(pva-pvb));E.tv.push(Math.abs(tva-tvb));E.gap.push((ta-pa)/fps*1e3);E.gt.push((tb-pb)/fps*1e3);E.n++;if((pa<=ta)==(pb<=tb))E.ok++;}
const m=a=>a.reduce((x,y)=>x+y,0)/a.length;console.log("peak timing error ms pelvis",m(E.p).toFixed(0),"trunk",m(E.t).toFixed(0),"| peak speed err deg/s pelvis",m(E.pv).toFixed(0),"trunk",m(E.tv).toFixed(0),"| order right",E.ok,"/",E.n,"| trunk-after-pelvis gap ms app",m(E.gap).toFixed(0),"truth",m(E.gt).toFixed(0),"gap err",m(E.gap.map((g,i)=>Math.abs(g-E.gt[i]))).toFixed(0));
