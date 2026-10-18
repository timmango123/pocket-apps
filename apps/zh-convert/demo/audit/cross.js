const {ZC}=require('./eng.js') /* eng.js: loads the CORE block of ../../index.html */;const fs=require('fs');const ch=s=>Array.from(s);const d=ZC.build();
const norm=s=>ch(s).map(c=>d.tv.get(c)||c).join('').replace(/臺/g,'台');
const conv=w=>ZC.join(ZC.convert(w,{dir:'s2t'}));
// simp.txt (from extract-jieba.py): jieba words with frequency >= MINF (default 5, the same cut gen.js uses)
const MINF=+(process.env.MINF||5);
const LEX=new Set(fs.readFileSync(__dirname+'/simp.txt','utf8').split('\n').map(l=>l.split('\t')).filter(r=>+r[1]>=MINF).map(r=>r[0]));
// corpus of real sentences: the hand-checked samples and the test file (plus the family pool below)
let corpus=fs.readFileSync(__dirname+'/../samples.tsv','utf8')+fs.readFileSync(__dirname+'/../tests.js','utf8');
const pool=new Set();const a=ch(corpus);for(let i=0;i+1<a.length;i++){const w=a[i]+a[i+1];if(LEX.has(w))pool.add(w);}
console.error('pool',pool.size);
const endW=new Map(),startW=new Map();for(const w of pool){const b=ch(w);(endW.get(b[1])||endW.set(b[1],[]).get(b[1])).push(w);(startW.get(b[0])||startW.set(b[0],[]).get(b[0])).push(w);}
// family pool: for frequent entries (jieba freq >= 200) also pair the most frequent common words (freq >= 500) ending on
// the entry's first character with those starting on its second character: 方面+条件, 这个面?+包括, 回头+发给 ...
const FQ=new Map(fs.readFileSync(__dirname+'/simp.txt','utf8').split('\n').map(l=>l.split('\t')).filter(r=>r[1]).map(r=>[r[0],+r[1]]));
const COMMON=[...FQ].filter(([w,f])=>f>=500&&ch(w).length===2&&ZC.join(ZC.convert(w,{dir:'t2s'}))===w).sort((a,b)=>b[1]-a[1]).map(r=>r[0]);
const famEnd=new Map(),famStart=new Map();for(const w of COMMON){const b=ch(w);(famEnd.get(b[1])||famEnd.set(b[1],[]).get(b[1])).push(w);(famStart.get(b[0])||famStart.set(b[0],[]).get(b[0])).push(w);}
const out=[],bad=[];
for(const [k,v] of d.sp.m){const b=ch(k);if(b.length!==2)continue;const def=norm(b.map(c=>d.sc.get(c)||c).join(''));if(def===norm(v))continue;
 const W1=(endW.get(b[0])||[]).filter(w=>w!==k).slice(0,4), W2=(startW.get(b[1])||[]).filter(w=>w!==k).slice(0,4);
 const F1=(FQ.get(k)||0)>=200?(famEnd.get(b[0])||[]).filter(w=>w!==k&&!W1.includes(w)).slice(0,4):[], F2=(FQ.get(k)||0)>=200?(famStart.get(b[1])||[]).filter(w=>w!==k&&!W2.includes(w)).slice(0,4):[];
 const seen=new Set();
 for(const [A,B] of [[W1,W2],[F1,W2],[W1,F2],[F1,F2]])for(const w1 of A)for(const w2 of B){const s=w1+w2;if(seen.has(s))continue;seen.add(s);const e=conv(w1)+conv(w2),o=conv(s);(o===e?out:bad).push([k,s,o,e]);}}
console.error('ok',out.length,'bad',bad.length);
fs.writeFileSync(__dirname+'/cross_ok.tsv',out.map(r=>'s2t\t0\t'+r[1]+'\t'+r[3]).join('\n')+'\n');
console.log(bad.map(r=>r[0]+'  '+r[1]+' → '+r[2]+' | split '+r[3]).join('\n'));
