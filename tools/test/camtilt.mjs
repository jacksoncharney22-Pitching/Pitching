// How far the benchmark's cameras look up or down at the pitcher: fits the camera from the motion-capture joints and the tracker's
// 2D points of each view. All 60 views look down by about 8° (2026-11-09), while the app builds the skeleton as if the camera were level,
// so "joints cm" and the tilts on the scorecard include that. `analyse(raw, {_camTilt: -8})` shows what knowing the tilt would give.
//   node tools/test/camtilt.mjs
import { readFileSync, readdirSync } from "fs"; import { gunzipSync } from "zlib";
const dir=new URL("./bench/",import.meta.url).pathname, L=f=>JSON.parse(gunzipSync(readFileSync(dir+f)));
function solve(A,b){const n=A.length;const M=A.map((r,i)=>[...r,b[i]]);for(let i=0;i<n;i++){let p=i;for(let k=i+1;k<n;k++)if(Math.abs(M[k][i])>Math.abs(M[p][i]))p=k;[M[i],M[p]]=[M[p],M[i]];for(let k=0;k<n;k++)if(k!==i){const f=M[k][i]/M[i][i];for(let j=i;j<=n;j++)M[k][j]-=f*M[i][j]}}return M.map((r,i)=>r[n]/r[i])}
const G={};
for(const f of readdirSync(dir).filter(f=>f.endsWith(".raw.json.gz"))){const v=f.replace(".raw.json.gz",""),raw=L(f),tr=L(v+".truth.json.gz");
 const view=v.replace(/^.*?_/,""),X=[],U=[],V=[];
 const n=Math.min(tr.P.length,raw.frames.length);
 for(let t=0;t<n;t+=2)for(const j of [11,12,23,24,25,26,27,28]){const q=raw.frames[t].img[j],p=tr.P[t][j];if(!q||(q[2]??1)<.6)continue;X.push([p[0],p[1],p[2],1]);U.push(q[0]*raw.width);V.push(q[1]*raw.height)}
 const N=(Y)=>{const A=[0,1,2,3].map(i=>[0,1,2,3].map(j=>X.reduce((s,r)=>s+r[i]*r[j],0))),b=[0,1,2,3].map(i=>X.reduce((s,r,k)=>s+r[i]*Y[k],0));return solve(A,b)};
 const a=N(U),c=N(V);
 const r1=a.slice(0,3),r2=c.slice(0,3),cr=[r1[1]*r2[2]-r1[2]*r2[1],r1[2]*r2[0]-r1[0]*r2[2],r1[0]*r2[1]-r1[1]*r2[0]],nn=Math.hypot(...cr),ax=cr.map(x=>x/nn);
 (G[view]??=[]).push([Math.asin(ax[1])*180/Math.PI,Math.atan2(ax[0],ax[2])*180/Math.PI]);
}
const m=a=>a.reduce((s,x)=>s+x,0)/a.length;
for(const k of Object.keys(G).sort())console.log(k.padEnd(11),"camera axis elevation",m(G[k].map(r=>r[0])).toFixed(1),"yaw",m(G[k].map(r=>r[1])).toFixed(1), "each:",G[k].map(r=>r[0].toFixed(0)).join(" "));
