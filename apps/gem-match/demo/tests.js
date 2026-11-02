// Unit tests for gem-match core rules (swap / match / specials / combos / ice / stone / pearl / shuffle)
// Usage: node tests.js [--core]   (extracts the core from ../index.html between CORE markers; without --core also runs
// the browser regression checks in mobile Chromium with real CDP touch)
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
// ---------- release-review fixes (2026-11-02) ----------
const X=new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1]+'\nreturn {MASKS,maskOf,RING_SAFE,leftText};')();
const TUNE=JSON.parse(html.match(/var TUNE = (\[[\s\S]*?\]);/)[1]);
const def=n=>{const t=TUNE[n-1];return C.levelDef(n,t[0]/100,t[1],t[3]);};
{ // board shapes: 50-60 unchanged, 61+ many different (mirrored) shapes, conveyor levels keep the outer ring open
  const holes=n=>Array.from(def(n).mask).map((v,i)=>v?'':i).filter(String).join(',');
  let same=true; for(let n=50;n<=60;n++){ const w=9,mi=n%7,old=[]; for(let i=0;i<81;i++) if(X.MASKS[mi](i%w,(i/w)|0,w)) old.push(i); if(old.join(',')!==holes(n)) same=false; }
  ok(same,'levels 50-60 keep their original board shapes');
  const late=new Set(), ring=new Set(); let ringOpen=true, adjSame=0;
  for(let n=61;n<=100;n++){ late.add(holes(n)); if(n>=85){ ring.add(holes(n)); const L=def(n); if(L.ring.some(c=>!L.mask[c])) ringOpen=false; } if(n>61&&holes(n)===holes(n-1)) adjSame++; }
  ok(late.size>=20,'levels 61-100 use at least 20 different board shapes (got '+late.size+', was 7 masks cycling)');
  ok(ring.size>=8,'conveyor levels 85-100 use at least 8 shapes (got '+ring.size+', was 3)');
  ok(ringOpen,'conveyor ring cells are never holes'); ok(adjSame===0,'no two consecutive levels share a board shape');
}
{ // fail card: the score goal says how many points are missing, with a unit (was a bare "★ 5480" next to the HUD target)
  ok(X.leftText({t:'score',q:8300},5480)==='還差 5480 分','fail card score goal reads "還差 5480 分"');
  ok(X.leftText({t:'ice',q:0},7)==='7','other goals still show the count left');
}
{ // late-game luck: the game's own AI single-attempt pass rate for 81-100 (was 18-37%, target ~35-50%)
  let tot=0,minP=1,unsolved=[]; const R=40;
  for(let n=81;n<=100;n++){ const L=def(n); let w=0; for(let s=0;s<R;s++) if(C.simulate(L,0x2a17+s*7919+n*13).win) w++; tot+=w/R; minP=Math.min(minP,w/R); if(!w) unsolved.push(n); }
  ok(tot/20>=0.3,'levels 81-100 average AI pass rate >= 30% ('+(tot/20*100).toFixed(1)+'%)');
  ok(minP>=0.15&&!unsolved.length,'every level 81-100 is cleared by the AI in >= 15% of attempts (min '+(minP*100).toFixed(0)+'%)');
}
// a legal, non-winning move in T oriented so its start cell keeps (stable) or loses (!stable) the gem it had in `before`
function pickMove(T,before,stable){
  for(const mv of C.listMoves(T)) for(const [a,b] of [[mv[0],mv[1]],[mv[1],mv[0]]]){
    const same=T.cell[a]&&C.gid(T.cell[a])===C.gid(before[a]); if(same!==stable||!before[a]) continue;
    const t=C.cloneS(T); if(C.trySwap(t,a,b,null)&&!t.over) return [a,b]; }
  return null;
}
const done=()=>{ console.log('unit tests:',pass,'passed,',fail,'failed'); process.exitCode=fail?1:0; };
if(process.argv.includes('--core')) done(); else browser().then(done,e=>{ fail++; console.log('FAIL browser tests crashed:',e&&e.stack||e); done(); });

// ---------- browser: real CDP touch in mobile Chromium ----------
async function browser(){
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const APP='file://'+path.resolve(__dirname,'..','index.html');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const SEEN={basic:1,special:1,collect:1,ice:1,ice2:1,pearl:1,shape:1,multi:1,stone:1,belt:1,bomb:1};
  const b=await chromium.launch(); const errors=[];
  try{
    const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true,colorScheme:'dark',reducedMotion:'reduce'});
    await ctx.addInitScript(s=>{ try{ localStorage.setItem('gemmatch.intro',s); }catch(e){} }, JSON.stringify(SEEN)); // fresh context = empty storage; never cleared on reload
    const page=await ctx.newPage(); page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{ if(m.type()==='error') errors.push(m.text()); });
    await page.goto(APP); const cdp=await ctx.newCDPSession(page);
    const T=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts});
    const st=()=>page.evaluate(()=>window.__game.state());
    async function until(fn,ms=20000,arg){ const t0=Date.now(); while(Date.now()-t0<ms){ if(await page.evaluate(fn,arg)) return true; await sleep(30); } return false; }
    const idle=()=>until(()=>{ const s=window.__game.state(); return !s.busy&&!s.queued; });
    async function tap(sel){ const r=await page.locator(sel).boundingBox(); await T('touchStart',[{x:r.x+r.width/2,y:r.y+r.height/2,id:1}]); await sleep(40); await T('touchEnd',[]); await sleep(120); }
    async function swipe(a,c){ const g=await st(), B=g.board, w=g.w; const P=i=>[B.x+(i%w+0.5)*B.cs,B.y+(Math.floor(i/w)+0.5)*B.cs];
      const [x0,y0]=P(a),[x1,y1]=P(c); await T('touchStart',[{x:x0,y:y0,id:1}]); for(let k=1;k<=4;k++){ await T('touchMove',[{x:x0+(x1-x0)*0.8*k/4,y:y0+(y1-y0)*0.8*k/4,id:1}]); } await T('touchEnd',[]); }
    async function level(n,seed){ await until(()=>!!window.__game); if(await page.isVisible('#title')) await tap('#tSelect'); else if((await st()).status==='play'){ await tap('#bPause'); await tap('#pSelect'); }
      if(n>1&&(await page.getAttribute('#unlockSw','aria-checked'))!=='true') await tap('#unlockSw');
      await page.evaluate(n=>document.querySelector('.node[data-n="'+n+'"]').scrollIntoView({block:'center'}),n); await sleep(150);
      await page.evaluate(s=>window.__game.setSeed(s),seed); await tap('.node[data-n="'+n+'"]'); await until(()=>window.__game.state().status==='play'); await idle(); }
    // 1) level 1 seed 49 (the game's AI wins it in 5 moves). Node mirror follows every move.
    await level(1,49); const S=C.newGame(def(1),49);
    ok(await until(()=>window.__game.state().warm===0,5000),'all gem sprites are pre-drawn shortly after the level starts');
    ok((await st()).sprites>=26,'sprite cache holds every colour x special + rainbow + pearl ('+(await st()).sprites+')');
    // pause mid-cascade freezes the animation; resume finishes it and the board matches the rules
    let m=C.aiPick(S); await swipe(m[0],m[1]); C.trySwap(S,m[0],m[1],null);
    await until(()=>window.__game.state().busy,2000); await tap('#bPause');
    const p0=await st(); await sleep(400); const p1=await st();
    ok(p0.status==='paused'&&p1.busy&&p1.anims===p0.anims&&p1.anims>0,'animations are frozen while paused ('+p0.anims+' -> '+p1.anims+')');
    await tap('#pResume'); await idle(); let g=await st();
    ok(g.cells.join()===Array.from(S.cell).join()&&g.moves===S.moves,'after resume the board matches the rules mirror');
    // a swipe made while the previous move is still animating is kept and played afterwards (was dropped)
    //    (the second swipe starts on a gem that is already in its final cell, so the replay targets the gem under the finger)
    let before=Array.from(S.cell); m=C.aiPick(S); C.trySwap(S,m[0],m[1],null);
    const m2=pickMove(S,before,true); ok(!!m2,'mirror: found a buffered swipe that starts on a gem that does not move');
    await swipe(m[0],m[1]); await until(()=>window.__game.state().busy,2000);
    await swipe(m2[0],m2[1]); C.trySwap(S,m2[0],m2[1],null);
    const q=await st(); ok(q.busy&&q.queued,'second swipe during the animation is queued');
    await idle(); g=await st();
    ok(g.moves===S.moves&&g.cells.join()===Array.from(S.cell).join(),'queued swipe was played once: moves '+g.moves+' = '+S.moves);
    // play on (without winning) until the next move wins
    while(!S.over){ m=C.aiPick(S); const T2=C.cloneS(S); C.trySwap(T2,m[0],m[1],null); if(T2.over) break; await swipe(m[0],m[1]); C.trySwap(S,m[0],m[1],null); await idle(); }
    // winning move -> pause during the cascade -> map: no page error, the win (with bonus) is already saved
    m=C.aiPick(S); await swipe(m[0],m[1]); C.trySwap(S,m[0],m[1],null); const F=C.cloneS(S); if(F.moves>0) C.bonus(F,null);
    ok(S.over==='win','mirror: this move wins');
    const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem('gemmatch.progress'))||'{}');
    ok(saved[1]&&saved[1].b===F.score,'win is saved the moment the move resolves, bonus included ('+JSON.stringify(saved[1])+' vs '+F.score+')');
    const pst=await st(); await tap('#bPause'); ok(pst.busy&&await page.isVisible('#pause'),'pause opens during the winning cascade');
    await tap('#pSelect'); await sleep(700);
    ok((await st()).status==='select'&&!(await page.isVisible('#win')),'leaving to the map stops the old move (no win card pops up later)');
    // the reached win stays after a reload
    // (give Chromium's storage backend a moment to commit before the reload, as a user's reload would)
    await sleep(600); await page.reload(); await until(()=>!!window.__game);
    const prog=JSON.parse(await page.evaluate(()=>localStorage.getItem('gemmatch.progress'))||'{}');
    ok(prog[1]&&prog[1].s>=1,'progress for level 1 survives reload '+JSON.stringify(prog)+' '+(await page.evaluate(()=>JSON.stringify(Object.assign({},localStorage))+' '+location.href)));
    // a buffered swipe that starts on a gem which is about to be replaced (still falling / popping under the finger) is dropped
    {
      await level(1,49); const S4=C.newGame(def(1),49); const b4=Array.from(S4.cell); const m4=C.aiPick(S4); C.trySwap(S4,m4[0],m4[1],null);
      const st4=pickMove(S4,b4,false); ok(!!st4,'mirror: found a valid swipe whose start cell gets a different gem');
      await swipe(m4[0],m4[1]); await until(()=>window.__game.state().busy,2000); const d0=(await st()).dropped;
      await swipe(st4[0],st4[1]); const q4=await st(); await idle(); const g4=await st();
      ok(q4.queued&&g4.dropped===d0+1&&g4.moves===S4.moves&&g4.cells.join()===Array.from(S4.cell).join(),'swipe aimed at a gem that was replaced is dropped, not played on the new gem (moves '+g4.moves+' = '+S4.moves+')');
      // hammer armed, then 提示: the hammer is disarmed, so the next board tap selects instead of smashing
      await tap('#bHammer'); ok((await st()).mode==='hammer','hammer arms');
      await tap('#bHint'); const h1=await st(); ok(h1.mode==='','tapping 提示 disarms the hammer');
      const P=i=>[h1.board.x+(i%h1.w+0.5)*h1.board.cs,h1.board.y+(Math.floor(i/h1.w)+0.5)*h1.board.cs]; const [hx,hy]=P(40);
      await T('touchStart',[{x:hx,y:hy,id:1}]); await sleep(40); await T('touchEnd',[]); await sleep(150); const h2=await st();
      ok(h2.hammers===h1.hammers&&h2.cells.join()===h1.cells.join()&&h2.sel===40,'next board tap selects the gem (hammers '+h2.hammers+', sel '+h2.sel+')');
    }
    // restart during a cascade: the old move stops, the new game is clean and stays equal to a fresh mirror
    await level(1,49); const S2=C.newGame(def(1),49); m=C.aiPick(S2); await swipe(m[0],m[1]); await until(()=>window.__game.state().busy,2000);
    await tap('#bPause'); await tap('#pRestart'); await idle(); await sleep(300); g=await st(); const rs=await page.evaluate(()=>window.__game.seed());
    ok(g.status==='play'&&g.moves===def(1).moves&&g.cells.join()===Array.from(C.newGame(def(1),rs).cell).join(),'restart during a cascade starts a clean game');
    // map: locked nodes show their number and a centred lock
    await tap('#bPause'); await tap('#pSelect'); if((await page.getAttribute('#unlockSw','aria-checked'))==='true') await tap('#unlockSw');
    const lk=await page.evaluate(()=>{ const n=document.querySelector('.node.lock'); const a=n.getBoundingClientRect(), s=n.querySelector('svg').getBoundingClientRect(); return { txt:(n.querySelector('.n')||{}).textContent, num:n.dataset.n, dx:Math.abs((s.left+s.right)/2-(a.left+a.right)/2), inside:s.top>=a.top&&s.bottom<=a.bottom }; });
    ok(lk.txt===lk.num&&lk.dx<1.5&&lk.inside,'locked node shows its level number and a centred lock '+JSON.stringify(lk));
    // goal toast keeps "(N 步)" together
    await tap('.node[data-n="1"]'); ok((await page.textContent('#toast')).includes(' 步）'),'goal text uses a no-break space before 步');
    await ctx.close();
    // 360x640: 9x9 boards get the extra width (cells >= 39 px)
    const c2=await b.newContext({viewport:{width:360,height:640},deviceScaleFactor:2,hasTouch:true,isMobile:true,reducedMotion:'reduce'});
    await c2.addInitScript(s=>{ try{ localStorage.setItem('gemmatch.intro',s); localStorage.setItem('gemmatch.unlockAll','true'); }catch(e){} }, JSON.stringify(SEEN));
    const p2=await c2.newPage(); p2.on('pageerror',e=>errors.push(String(e))); await p2.goto(APP); await p2.waitForFunction(()=>!!window.__game);
    await p2.click('#tSelect'); await p2.evaluate(()=>document.querySelector('.node[data-n="60"]').scrollIntoView({block:'center'})); await p2.click('.node[data-n="60"]');
    await p2.waitForFunction(()=>window.__game.state().status==='play'); const cs=(await p2.evaluate(()=>window.__game.state())).board.cs;
    ok(cs>=39,'9x9 board at 360 px wide has cells >= 39 px (got '+cs+')'); await c2.close();
  } finally { await b.close(); }
  ok(errors.length===0,'no page/console errors in the browser run '+errors.slice(0,3).join(' | '));
}
