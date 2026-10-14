// Offline level generator for 三國華容道 (klotski) — produced the 100 embedded levels.
// For each piece composition: random layout -> enumerate its whole reachable state space (BFS) ->
// multi-source BFS from every "曹操 at the exit" state gives the exact minimum moves of every layout ->
// pick layouts whose minimum equals the target M(L) (+1 per level), with difficulty D strictly increasing.
// Uses the game's own core (extracted from ../index.html). Usage: node --max-old-space-size=7000 gen.js  (~10 min)
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
const C=new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1]+'\nreturn {TDIM,parseLevel,keyOf,decode,isGoal,neighbors,solve};')();
function rnd(n){return Math.floor(Math.random()*n)}
function randomLayout(W,H,ex,comp){ // comp: {C:1,V:n,H:n,S:n,X:n}
  for(let tries=0;tries<1000;tries++){
    const g=new Array(W*H).fill('.');let ok=true;
    const order=[];for(const t of ['C','V','H','X','S'])for(let i=0;i<(comp[t]||0);i++)order.push(t);
    for(const t of order){const [w,h]=C.TDIM[t];const opts=[];
      for(let y=0;y+h<=H;y++)for(let x=0;x+w<=W;x++){let f=true;for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(g[(y+j)*W+x+i]!=='.')f=false;
        if(t==='C'&&y===H-2&&x===ex)f=false; if(f)opts.push([x,y]);}
      if(!opts.length){ok=false;break;}const [x,y]=opts[rnd(opts.length)];for(let j=0;j<h;j++)for(let i=0;i<w;i++)g[(y+j)*W+x+i]=t;}
    if(ok)return `${W}x${H}@${ex}:`+g.join('');
  }
}
function component(L,k0){const seen=new Set([k0]);const q=[k0];for(let h=0;h<q.length;h++){for(const n of C.neighbors(L,q[h]))if(!seen.has(n[0])){seen.add(n[0]);q.push(n[0]);}}return q;}
function dists(L,keys){const d=new Map();let q=keys.filter(k=>C.isGoal(L,k));for(const k of q)d.set(k,0);
  for(let h=0;h<q.length;h++){const k=q[h],dk=d.get(k);for(const n of C.neighbors(L,k))if(!d.has(n[0])){d.set(n[0],dk+1);q.push(n[0]);}}return d;}
let seed=20261013;function rand(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
Math.random=rand;
function Mof(L){if(L<=60)return L+4;if(L<=68)return 64+2*(L-60);if(L===69)return 81;return 81+Math.round(1.5*(L-69));}
const BANDS=[
 {from:1,to:4,W:4,H:5,comps:[{C:1,V:2,H:1,S:2},{C:1,V:3,S:2},{C:1,V:2,H:2,S:2}]},
 {from:5,to:10,W:4,H:5,comps:[{C:1,V:2,H:2,S:2},{C:1,V:3,H:1,S:2}]},
 {from:11,to:22,W:4,H:5,comps:[{C:1,V:4,H:1,S:2},{C:1,V:3,H:2,S:2},{C:1,V:2,H:3,S:2}]},
 {from:23,to:30,W:4,H:5,comps:[{C:1,V:4,H:1,S:3},{C:1,V:3,H:2,S:3},{C:1,V:2,H:3,S:3},{C:1,V:4,H:1,S:2},{C:1,V:3,H:2,S:2}]},
 {from:31,to:68,W:4,H:5,comps:[{C:1,V:4,H:1,S:4},{C:1,V:3,H:2,S:4},{C:1,V:2,H:3,S:4}]},
 {from:70,to:77,W:5,H:5,comps:[{C:1,V:6,H:2,S:3},{C:1,V:5,H:3,S:3},{C:1,V:7,H:1,S:3}]},
 {from:78,to:84,W:4,H:6,comps:[{C:1,V:4,H:3,S:4},{C:1,V:5,H:2,S:4}]},
 {from:85,to:92,W:4,H:6,comps:[{C:1,V:4,H:2,S:5,X:1},{C:1,V:5,H:1,S:5,X:1},{C:1,V:3,H:3,S:5,X:1}]},
 {from:93,to:100,W:5,H:5,comps:[{C:1,V:4,H:2,S:6,X:1},{C:1,V:5,H:2,S:4,X:1},{C:1,V:6,H:1,S:4,X:1}]},
];
const TRIES=+process.env.TRIES||6;
function analyse(L,keys,d,k){ // optimal path + trap
  const path=[],steps=[];let cur=k;
  let trapSum=0,n=0;
  while(d.get(cur)>0){const dc=d.get(cur);const N=C.neighbors(L,cur);let worse=0,nxt=null;
    for(const e of N){const v=d.get(e[0]);if(v>=dc)worse++;else if(!nxt)nxt=e;}
    trapSum+=worse/N.length;n++;steps.push([nxt[1],nxt[2]]);cur=nxt[0];}
  return {trap:trapSum/n,steps};
}
const out=[];const usedKeys=new Set();
function mirrorKey(L,k){let s='';for(let y=0;y<L.H;y++){for(let x=0;x<L.W;x++){/*anchor mirror*/}}return null;}
for(const B of BANDS){
  const targets=[];for(let l=B.from;l<=B.to;l++)targets.push(l);
  const cand={};for(const l of targets)cand[l]=[];
  const seenComp=new Set();
  for(const comp of B.comps){
    for(let t=0;t<TRIES;t++){
      const ex=B.W===4?1:(rand()<.5?1:2);
      const s=randomLayout(B.W,B.H,ex,comp);const L=C.parseLevel(s);const k0=C.keyOf(L,L.pieces);
      const keys=component(L,k0);let sig=keys[0];for(const k of keys)if(k<sig)sig=k;if(seenComp.has(sig+ex)){process.stderr.write('dup\n');continue;}seenComp.add(sig+ex);
      const d=dists(L,keys);if(!d.size){process.stderr.write('unsolvable '+keys.length+'\n');continue;}
      let mx=0;const byD={};for(const [k,v] of d){mx=Math.max(mx,v);const m=targets.find(l=>Mof(l)===v);if(m){(byD[v]=byD[v]||[]).push(k);}}
      process.stderr.write(`band ${B.from}-${B.to} ${JSON.stringify(comp)} ex${ex} comp ${keys.length} max ${mx}\n`);
      for(const l of targets){const arr=byD[Mof(l)];if(!arr)continue;
        for(let i=0;i<Math.min(40,arr.length);i++){const k=arr[Math.floor(rand()*arr.length)];const a=analyse(L,keys,d,k);
          const np=C.decode(L,k).length;cand[l].push({W:L.W,H:L.H,ex,k,M:Mof(l),trap:a.trap,steps:a.steps,np});}}
      if(seenComp.size>3){ /* free memory of older sets */ }
    }
  }
  for(const l of targets){if(!cand[l].length){console.error('NO CANDIDATE for level',l,Mof(l));process.exit(1);}out[l]=cand[l];}
  global.gc&&gc();
}
// Level 69: 橫刀立馬
{const s='4x5@1:VCCVVCCVVHHVVSSVS..S';const L=C.parseLevel(s);const k=C.keyOf(L,L.pieces);const keys=component(L,k);const d=dists(L,keys);
 const a=analyse(L,keys,d,k);out[69]=[{W:4,H:5,ex:1,k,M:81,trap:a.trap,steps:a.steps,np:10,name:'橫刀立馬'}];}
const Dof=c=>0.08*c.M+3*c.trap+0.5*c.np;
// choose: D strictly increasing; levels >=61 prefer high trap
const chosen=[];let prev=-1;
const D69=Dof(out[69][0]);
for(let l=1;l<=100;l++){let cs=out[l].filter(c=>Dof(c)>prev+0.03);if(l<69&&l>=61)cs=cs.filter(c=>Dof(c)<D69-0.03*(69-l));
  if(!cs.length){console.error('monotone fail at',l, out[l].map(Dof).sort().slice(-3),prev);process.exit(1);}
  let c;if(l>=61){cs.sort((a,b)=>b.trap-a.trap);c=cs[Math.min(cs.length-1, Math.floor(cs.length*0.3))];}else{cs.sort((a,b)=>Dof(a)-Dof(b));c=cs[0];}
  chosen[l]=c;prev=Dof(c);}
const res=[];for(let l=1;l<=100;l++){const c=chosen[l];
  // full grid string from key
  const L={W:c.W,H:c.H};const P=C.decode(L,c.k);const g=new Array(c.W*c.H).fill('.');for(const p of P)for(let j=0;j<p.h;j++)for(let i=0;i<p.w;i++)g[(p.y+j)*c.W+p.x+i]=p.t;
  const enc=c.steps.map(s=>s[0].toString(36)+s[1].toString(36)).join('');
  res.push({l,str:`${c.W}x${c.H}@${c.ex}:`+g.join(''),M:c.M,trap:+c.trap.toFixed(3),np:c.np,D:+Dof(c).toFixed(3),sol:enc,name:c.name||''});}
fs.writeFileSync(require('path').join(__dirname,'levels.json'),JSON.stringify(res));
console.log('ok');for(const r of res)if(r.l%10==1||r.l>95)console.log(r.l,r.str,r.M,r.trap,r.np,r.D);
