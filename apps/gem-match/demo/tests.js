// Unit tests for gem-match core rules (swap / match / specials / combos / ice / stone / pearl / shuffle)
// Usage: node tests.js   (extracts the core from ../index.html between CORE markers)
const fs=require('fs'), path=require('path');
const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
const C=new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1]+'\nreturn {R,col,spc,prl,bmb,gid,mkG,withS,levelDef,newGame,cloneS,goalLeft,goalsMet,listMoves,findGroups,trySwap,hammer,bonus,aiPick,simulate,settle,shuffle};')();
let pass=0,fail=0;
function ok(c,msg){ if(c){pass++;} else {fail++; console.log('FAIL',msg);} }
// grid rows: tokens: digit color (0-5) + optional h/v/w/r ; 'P' pearl ; '#' stone ; '-' hole
function board(rows, opts){
  opts=opts||{};
  const L=C.levelDef(1,1); L.goals=opts.goals||[{t:'score',q:999999}]; L.pearls=opts.pearls||0;
  const S=C.newGame(L,12345);
  const w=L.w; let i=0;
  for(const r of rows){ const tk=r.trim().split(/\s+/); for(const t of tk){
    if(t==='P'){S.cell[i]=C.mkG(S,-1,0,1,0);}
    else if(t==='#'){S.cell[i]=0;S.stone[i]=1;}
    else { const c=+t[0]; const s={h:1,v:2,w:3,r:4}[t[1]]||0; S.cell[i]=C.mkG(S,s===4?-1:c,s,0,0); }
    if(opts.ice&&opts.ice.includes(i)) S.ice[i]=1; i++; } }
  return S;
}
const base=[
'0 1 2 3 4 0 1 2',
'1 2 3 4 0 1 2 3',
'2 3 4 0 1 2 3 4',
'3 4 0 1 2 3 4 0',
'4 0 1 2 3 4 0 1',
'0 1 2 3 4 0 1 2',
'1 2 3 4 0 1 2 3',
'2 3 4 0 1 2 3 4'];
function firstClear(ev){ const e=ev.find(x=>x.t==='clear'); return e; }
function cnt(e){ return e.waves.reduce((a,w)=>a+w.ids.length,0); }
// 1 simple match of 3: row0 make 3 zeros: put 0 at (2,1)? Build custom
let S=board(['1 1 0 2 3 4 0 2','0 2 1 4 0 1 2 3',...base.slice(2)]);
let ev=[]; ok(C.trySwap(S,2,10,ev),'3-match swap valid'); let e=firstClear(ev); ok(e&&cnt(e)===3,'3 cleared'); ok(S.moves===S.L.moves-1,'move used');
// invalid swap
S=board(base); const snap=S.cell.slice(); ev=[]; ok(!C.trySwap(S,0,1,ev),'invalid swap rejected'); ok(S.cell.every((g,i)=>g===snap[i])&&S.moves===S.L.moves,'invalid swap no change');
// 4 in a row horizontal swipe -> stripe row (s=1) at moved cell
S=board(['3 3 0 3 2 4 1 2','4 0 3 1 0 1 2 3',...base.slice(2)]); ev=[]; C.trySwap(S,10,2,ev); e=firstClear(ev);
ok(e.made.length===2&&C.spc(e.made[0])===2,'4-run via vertical swipe -> column stripe');
// 5 in row -> rainbow
S=board(['1 1 0 1 1 3 4 0','2 2 1 4 0 1 2 3',...base.slice(2)]); ev=[]; C.trySwap(S,2,10,ev); e=firstClear(ev); ok(cnt(e)===5&&C.spc(e.made[0])===4&&e.made[1]===2,'5-run -> rainbow at swap cell');
// L shape -> wrap
S=board(['1 1 0 1 3 4 0 2','2 3 1 4 0 1 2 3','3 4 1 0 4 2 3 4',...base.slice(3)]); ev=[]; C.trySwap(S,2,3,ev); e=firstClear(ev);
ok(e&&cnt(e)===5&&C.spc(e.made[0])===3,'L shape -> vortex');
// stripe + stripe = cross
S=board(base); S.cell[27]=C.withS(S.cell[27],1); S.cell[28]=C.withS(S.cell[28],2); ev=[]; ok(C.trySwap(S,27,28,ev),'special+special valid'); e=firstClear(ev); ok(cnt(e)>=15,'stripe+stripe cross clears >=15 ('+cnt(e)+')');
// wrap + wrap = 5x5
S=board(base); S.cell[27]=C.withS(S.cell[27],3); S.cell[28]=C.withS(S.cell[28],3); ev=[]; C.trySwap(S,27,28,ev); e=firstClear(ev); ok(e.waves[0].ids.length===25,'vortex+vortex 5x5 ('+e.waves[0].ids.length+')');
// stripe + wrap = 3 rows + 3 cols
S=board(base); S.cell[27]=C.withS(S.cell[27],1); S.cell[28]=C.withS(S.cell[28],3); ev=[]; C.trySwap(S,27,28,ev); e=firstClear(ev); ok(e.waves[0].ids.length===8*3+8*3-9,'stripe+vortex 3 rows+3 cols ('+e.waves[0].ids.length+')');
// rainbow + normal = all of that color
S=board(base); S.cell[27]=C.mkG(S,-1,4,0,0); let target=C.col(S.cell[28]); let nT=[...S.cell].filter(g=>C.col(g)===target).length; ev=[]; C.trySwap(S,27,28,ev); e=firstClear(ev); ok(e.waves[0].ids.length===nT+1,'rainbow+gem clears color ('+e.waves[0].ids.length+' vs '+(nT+1)+')');
// rainbow + rainbow = whole board
S=board(base); S.cell[27]=C.mkG(S,-1,4,0,0); S.cell[28]=C.mkG(S,-1,4,0,0); ev=[]; C.trySwap(S,27,28,ev); e=firstClear(ev); ok(e.waves[0].ids.length===64,'rainbow+rainbow clears all');
// rainbow + stripe -> transforms color then detonates
S=board(base); S.cell[27]=C.mkG(S,-1,4,0,0); S.cell[28]=C.withS(S.cell[28],1); ev=[]; C.trySwap(S,27,28,ev); ok(ev.some(x=>x.t==='trans'),'rainbow+stripe transforms'); e=firstClear(ev); ok(cnt(e)>=30,'rainbow+stripe big clear ('+cnt(e)+')');
// ice under match decrements, stone adjacent breaks
S=board(['1 1 0 2 3 4 0 2','0 # 1 4 0 1 2 3',...base.slice(2)],{ice:[0,1]}); ev=[]; C.trySwap(S,2,10,ev); ok(S.ice[0]===0&&S.ice[1]===0,'ice broken'); ok(S.stone[9]===0,'adjacent stone broken');
// pearl reaches bottom exit and is delivered
S=board([...base.slice(0,6),'1 2 3 4 0 1 2 3','P 3 4 0 1 2 3 4'],{pearls:1,goals:[{t:'pearl',q:1}]}); S.cell[56]=S.cell[56]; // pearl already at bottom row col0
// move a match above to trigger settle; simpler: call settle directly
C.settle(S,ev=[],null); ok(S.pout===1&&ev.some(x=>x.t==='pearl'),'pearl delivered at bottom');
// rainbow when hit by a blast picks a color
// no-move board gets shuffled into a playable one without matches
S=board(['0 1 2 3 0 1 2 3','2 3 0 1 2 3 0 1','0 1 2 3 0 1 2 3','2 3 0 1 2 3 0 1','0 1 2 3 0 1 2 3','2 3 0 1 2 3 0 1','0 1 2 3 0 1 2 3','2 3 0 1 2 3 0 1']);
ok(C.listMoves(S).length===0,'constructed dead board'); C.shuffle(S,null); ok(C.listMoves(S).length>0&&C.findGroups(S).length===0,'shuffle gives moves, no instant match');
// golden pearl may swap one row down even without a match
S=board(['P 1 2 3 4 0 1 2',...base.slice(1)],{pearls:1,goals:[{t:'pearl',q:1}]}); ev=[]; ok(C.trySwap(S,0,8,ev)&&C.prl(S.cell[8])&&S.moves===S.L.moves-1,'pearl steps down (costs a move)'); ok(!C.trySwap(S,8,9,[]),'pearl sideways without match rejected');
// determinism
const L5=C.levelDef(50,1); const a=C.simulate(L5,77,true), b=C.simulate(L5,77,true); ok(JSON.stringify(a)===JSON.stringify(b),'simulation deterministic');
console.log('unit tests:',pass,'passed,',fail,'failed');
process.exitCode=fail?1:0;
