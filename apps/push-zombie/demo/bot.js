// Bot: plays PushZombie via real touch taps with a human-like reaction delay.
// usage: node bot.js [survival|timed] [reactionMs] [minTapGapMs] [maxSeconds]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path=require('path');
const URL='file://'+path.resolve(__dirname,'..','index.html');
const mode=process.argv[2]||'survival', REACT=+(process.argv[3]||150)/1000, GAP=+(process.argv[4]||180), MAXS=+(process.argv[5]||400);
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true,isMobile:true});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await p.goto(URL);await p.waitForTimeout(600);
  await p.tap(mode==='timed'?'#btnTimed':'#btnSurvival');
  const marks={};let lastTap=0;const tapped=new Map();let hearts=3,lossLog=[];
  while(true){
    const s=await p.evaluate(()=>window.__game.state());
    if(s.screen==='over'||s.time>MAXS){console.log(JSON.stringify({mode,REACT,GAP,final:s.score,time:s.time.toFixed(1),hits:s.hits,maxCombo:s.maxCombo,screen:s.screen,marks,lossLog,errs}));break;}
    for(const m of [15,30,45,60,90,120,150,180,240]) if(s.time>=m&&!(m in marks)) marks[m]={score:s.score,hearts:s.hearts,grid:s.cols+'x'+s.rows};
    if(s.hearts<hearts){lossLog.push(s.time.toFixed(1));} hearts=s.hearts;
    const now=Date.now();
    if(s.screen==='play'&&now-lastTap>=GAP){
      // ready targets: visible >= REACT seconds, not cats; most urgent first
      const c=s.graves.filter(g=>g.z&&g.z.type!=='cat'&&(g.z.phase==='rise'||g.z.phase==='top')&&s.time-g.z.riseAt>=REACT);
      c.sort((a,b)=>(b.z.phase==='top'?1+b.z.t/b.z.hold:b.z.p)-(a.z.phase==='top'?1+a.z.t/a.z.hold:a.z.p));
      if(c.length){
        const g=c[0];const key=g.z.id+':'+g.z.hp;
        if(!tapped.has(key)||now-tapped.get(key)>250){tapped.set(key,now);lastTap=now;await p.touchscreen.tap(g.tap.x,g.tap.y);continue;}
      }
    }
    await p.waitForTimeout(8);
  }
  await b.close();
})();
