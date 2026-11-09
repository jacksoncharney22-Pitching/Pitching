// Delivery tempo vs motion capture on the 60 benchmark views: leg lift to foot strike (shown to coaches) and foot strike to release (not shown: 34 ms off a 21 ms spread).   node tools/test/tempo.mjs
import {readFileSync,readdirSync} from "fs";import {gunzipSync} from "zlib";
const R=new URL("../../",import.meta.url).pathname;const {analyse}=await import(R+"pipeline.js");const {armLibFor}=await import(R+"tools/test/truth.mjs");
const dir=R+"tools/test/bench/",L=f=>JSON.parse(gunzipSync(readFileSync(dir+f)));
const X={ll:[],fr:[]},Y={ll:[],fr:[]};
for(const f of readdirSync(dir).filter(f=>f.endsWith(".raw.json.gz"))){const v=f.replace(".raw.json.gz",""),raw=L(f),tr=L(v+".truth.json.gz");
 const D=analyse({...raw,heightIn:tr.height/0.0254},{armLib:armLibFor(tr.sp)});const fps=D.fps;const ph=n=>D.phases.find(p=>p.name===n).frame;
 const lead=D.throwHand==="R"?25:26; let tl=0;for(let t=0;t<tr.events.fs;t++)if(tr.P[t][lead][1]>tr.P[tl][lead][1])tl=t;
 X.ll.push((ph("Foot strike")-(D.phases.find(p=>/lift/i.test(p.name))||D.phases[0]).frame)/fps*1000);Y.ll.push((tr.events.fs-tl)/fps*1000);
 X.fr.push((ph("Release")-ph("Foot strike"))/fps*1000);Y.fr.push((tr.events.br-tr.events.fs)/fps*1000);
 if(Math.abs(X.ll.at(-1)-Y.ll.at(-1))>150)console.log(v,X.ll.at(-1).toFixed(0),Y.ll.at(-1).toFixed(0),"ll",(D.phases.find(p=>/lift/i.test(p.name))||D.phases[0]).frame,tl);
}
const m=x=>x.reduce((s,y)=>s+y,0)/x.length,sd=x=>{const u=m(x);return Math.sqrt(m(x.map(v=>(v-u)**2)))};const r=(x,y)=>{const a=m(x),b=m(y);return m(x.map((v,i)=>(v-a)*(y[i]-b)))/(sd(x)*sd(y))};
for(const k of ["ll","fr"]){const e=X[k].map((v,i)=>Math.abs(v-Y[k][i]));console.log(k,"mean err",m(e).toFixed(0),"bias",(m(X[k])-m(Y[k])).toFixed(0),"app",m(X[k]).toFixed(0),"truth",m(Y[k]).toFixed(0),"spread",sd(Y[k]).toFixed(0),"r",r(X[k],Y[k]).toFixed(2))}
