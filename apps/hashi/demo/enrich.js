// Late-level enrichment for 群島橋匠 (applied once, 2026-10-25, on top of gen.js output; release review: L56-100 were
// almost only 1-3 islands in long tree chains). Hill-climbs each level L56..100 on its own island layout and coast:
// adds bridges (loops), doubles single bridges and makes extra 7/8 hubs, keeping only boards the logic solver still
// finishes (=> unique solution) with trial + isolation steps and a 7/8, within ~3% of the old difficulty score and with
// the strictly rising score chain. Island positions and edges are unchanged, so saved boards (cur.<n>) still load.
// Usage: [ONLY=69,89] node enrich.js [fromLevel=56] [tries=450]  -> writes levels-new.json (paste into LEVELS in ../index.html)
const fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const core=html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C=new Function(core+'\nreturn {parseLevel,logicSolve,levelParams,mulberry,encodeLevel};')();
const LEVELS=JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const FROM=+process.argv[2]||56, TRIES=+process.argv[3]||300;
function cellsOf(P,cnt){const cells=[];for(let i=0;i<P.N;i++)cells.push(P.mask[i]?'#':'.');const s=new Array(P.isl.length).fill(0);
 for(let e=0;e<cnt.length;e++)if(cnt[e]){s[P.edges[e].a]+=cnt[e];s[P.edges[e].b]+=cnt[e];}
 for(let i=0;i<P.isl.length;i++){if(s[i]<1||s[i]>8)return null;cells[P.isl[i].c]=String(s[i]);}return C.encodeLevel(P.w,P.h,cells);}
function metr(P,cnt){let mid=0,hi=0;const s=new Array(P.isl.length).fill(0);let E=0;for(let e=0;e<cnt.length;e++)if(cnt[e]){E++;s[P.edges[e].a]+=cnt[e];s[P.edges[e].b]+=cnt[e];}
 for(const v of s){if(v>=4&&v<=6)mid++;if(v>=7)hi++;}return {mid,hi,loops:E-P.isl.length+1};}
function val(m,I){return Math.min(m.mid,Math.ceil(I*0.25))*3+Math.min(m.loops,8)*2+Math.min(m.hi,3)*2;}
const out=LEVELS.map(x=>x.slice());
function climb(L,loMin,tries){
 const P=C.parseLevel(out[L-1][0]), r0=C.logicSolve(P), I=P.isl.length;
 let cnt=Int8Array.from(r0.S.lo), best={s:out[L-1][0],score:out[L-1][1],m:metr(P,cnt)}; if(best.score<Math.max(out[L-2][1]+1,out[L-2][1]*1.01,loMin)) best.m={mid:-99,hi:0,loops:-99};
 const lo=Math.max(out[L-2][1]+1,out[L-2][1]*1.01,loMin), hi=Math.max(lo+1,L<100?Math.min(LEVELS[L-1][1]*1.04,LEVELS[L][1]/1.012):LEVELS[L-1][1]*1.1), rng=C.mulberry(L*99991);
 for(let t=0;t<(best.m.mid<0?tries*4:tries);t++){
  const c2=Int8Array.from(cnt), k=rng();
  if(k<0.55){ // add a new bridge (makes a loop)
   const e=(rng()*c2.length)|0; if(c2[e]) continue; let bad=false; for(const f of P.edges[e].cross) if(c2[f]) bad=true; if(bad) continue; c2[e]=rng()<0.4?2:1;
  } else if(k<0.85){ const e=(rng()*c2.length)|0; if(c2[e]!==1) continue; c2[e]=2; }
  else { const i=(rng()*I)|0, a=P.adj[i]; if(a.length<4) continue; let bad=false; for(const e of a) for(const f of P.edges[e].cross) if(c2[f]) bad=true; if(bad) continue; for(const e of a) c2[e]=2; if(rng()<0.5) c2[a[(rng()*4)|0]]=1; }
  const s=cellsOf(P,c2); if(!s) continue;
  const Q=C.parseLevel(s), r=C.logicSolve(Q); if(r.status!=='solved'||!r.used.trial||!r.used.iso) continue;
  if(r.score<lo||r.score>hi) continue;
  const m=metr(P,c2); if(!m.hi) continue; if(L>=85&&!Q.mask.some(x=>x)) continue;
  if(val(m,I)>=val(best.m,I)){ cnt=c2; best={s,score:r.score,m}; }
 }
 return {best,lo,P,r0,I};
}
const ONLY=(process.env.ONLY||'').split(',').filter(Boolean).map(Number);
for(let L=FROM;L<=100;L++){
 if(ONLY.length&&!ONLY.includes(L)) continue;
 let R=climb(L,LEVELS[L-1][1]*0.97,TRIES); if(R.best.score<R.lo) R=climb(L,0,TRIES*2);
 const {best,lo,P,r0,I}=R; if(best.score<lo){console.log('L'+L,'CHAIN BREAK',best.score,lo);process.exit(1);}
 out[L-1]=[best.s,best.score];
 const m0=metr(P,Int8Array.from(r0.S.lo));
 console.log('L'+L,'I',I,'score',LEVELS[L-1][1],'->',best.score,'mid',m0.mid,'->',best.m.mid,'loops',m0.loops,'->',best.m.loops,'7/8',m0.hi,'->',best.m.hi);
}
fs.writeFileSync('levels-new.json',JSON.stringify(out));
