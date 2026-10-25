// Scans matches for a wedged puck: puck.on, not frozen, speed > 40 but position moving < 1 px over 2 s (so the 3 s
// auto-reset never fires). Runs the tier bots and the "rush the puck" player. Then checks what releases it.
const fs=require('fs');const html=fs.readFileSync(require('path').resolve(__dirname,'../../../apps/air-hockey/index.html'),'utf8');
const core=new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1]+'\nreturn {newMatch, stepMatch};')();
const {makeTierBot}=require('./tierbot.js');
function scan(M,t,S){const p=M.puck;if(!p.on||M.freeze>0){S.anc=null;return}const v=Math.hypot(p.vx,p.vy);
 if(!S.anc||Math.hypot(p.x-S.anc.x,p.y-S.anc.y)>1||v<=40){S.anc={x:p.x,y:p.y,t};return}
 if(v>40&&t-S.anc.t>2&&!S.hit){S.hit={t:+t.toFixed(1),x:+p.x.toFixed(1),y:+p.y.toFixed(1),v:Math.round(v),me:[Math.round(M.m[1].x),Math.round(M.m[1].y)],ai:[Math.round(M.m[0].x),Math.round(M.m[0].y)]}}}
const out={tier:[],rush:[]};
for(const tier of ['clumsy','casual','skilled','world','superhuman'])for(const n of [5,25,50,75,100])for(let g=0;g<6;g++){
 const M=core.newMatch(n,{seed:4400+g*37+n}),bot=makeTierBot(tier,g*5+n),h=[],S={};let t=0,fx=180,fy=564;
 while(!M.over&&t<400){const p=M.puck;h.push({t,px:p.x,py:p.y,pvx:p.vx,pvy:p.vy,on:p.on,freeze:M.freeze,mx:M.m[1].x,my:M.m[1].y,ox:M.m[0].x,oy:M.m[0].y});
  const D=bot.curDelay(t);while(h.length>2&&h[1].t<=t-D)h.shift();const tg=bot.plan(h[0],t,t-h[0].t);const dx=tg.x-fx,dy=tg.y-fy,d=Math.hypot(dx,dy),st=bot.T.fspd/60;if(d<=st){fx=tg.x;fy=tg.y}else{fx+=dx/d*st;fy+=dy/d*st}
  M.m[1].tx=fx;M.m[1].ty=fy;core.stepMatch(M,1/60);M.ev.length=0;t+=1/60;scan(M,t,S);}
 if(S.hit)out.tier.push(Object.assign({tier,n,g},S.hit));}
console.log('tier-bot wedges:',out.tier.length,'of 150 matches',JSON.stringify(out.tier.slice(0,6)));
// rush player with 260 ms delay
for(const n of [10,50,100])for(let g=0;g<8;g++){const M=core.newMatch(n,{seed:900+g*131+n}),h=[],S={};let t=0,fx=180,fy=564;
 while(!M.over&&t<300){h.push([t,M.puck.x,M.puck.y]);while(h.length>2&&h[1][0]<=t-0.26)h.shift();const q=h[0];const tx=q[1],ty=Math.max(q[2]+10,330),dx=tx-fx,dy=ty-fy,d=Math.hypot(dx,dy),st=40;if(d<=st){fx=tx;fy=ty}else{fx+=dx/d*st;fy+=dy/d*st}
  M.m[1].tx=fx;M.m[1].ty=fy;core.stepMatch(M,1/60);M.ev.length=0;t+=1/60;scan(M,t,S);if(S.hit&&!S.rel){
   // finger lifts: mallet target stays where it is. Does the game ever recover on its own (20 s)?
   const p0={x:M.puck.x,y:M.puck.y};for(let k=0;k<1200;k++){core.stepMatch(M,1/60);M.ev.length=0;}S.hit.recover20sIdle=Math.hypot(M.puck.x-p0.x,M.puck.y-p0.y)>2;
   // now move mallet away: puck released at what speed?
   M.m[1].tx=180;M.m[1].ty=480;let vmax=0;for(let k=0;k<30;k++){core.stepMatch(M,1/60);M.ev.length=0;vmax=Math.max(vmax,Math.hypot(M.puck.vx,M.puck.vy));}S.hit.releaseSpeed=Math.round(vmax);S.rel=1;break;}}
 if(S.hit)out.rush.push(Object.assign({n,g},S.hit));}
console.log('rush-player wedges:',out.rush.length,'of 24',JSON.stringify(out.rush.slice(0,4)));
fs.writeFileSync(__dirname+'/stuck-scan.json',JSON.stringify(out,null,1));
