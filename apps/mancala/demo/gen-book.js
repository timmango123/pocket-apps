// Usage: node gen-book.js ../index.html <seeds 3-6> [ms]  -> prints MC_BOOK entries. Builds the level-5 opening book: best first move for every seed count, and the best move after each possible first move.
const fs=require('fs');const file=process.argv[2];const seeds=+process.argv[3];const ms=+(process.argv[4]||20000);
const html=fs.readFileSync(file,'utf8');const src=(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)||[])[1];
const MC=new Function(src+';return MC;')();
const out=[];
function entry(hist){const g=MC.newGame({rule:'kalah',seeds});for(const ch of hist){MC.play(g,+ch);}if(g.over)return;
  const r=MC.think({rule:'kalah',b:Array.from(g.b),side:g.side,depth:60,ms,err:0,level:4});
  out.push(`${seeds}|${hist}=${r.pit}`);console.error(seeds,JSON.stringify(hist),'->',r.pit,'score',r.score,'depth',r.depth,r.exact?'exact':'');}
entry('');for(let p=0;p<6;p++)entry(String(p));
console.log(out.join(';'));
