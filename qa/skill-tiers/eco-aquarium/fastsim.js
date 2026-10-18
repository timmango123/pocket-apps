// Offline cross-check: node fastsim.js ../../../apps/eco-aquarium/index.html [days] [tiers]. Runs the game core (ECO.step: motion + model, 4x) without a browser, 5 seeds per tier, keeper policies modelled on bot.js. For quick variance checks only; bot.js is the real-input playtest.
const fs=require('fs');
const load=f=>new Function(fs.readFileSync(f,'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1]+';return ECO;')();
function mul(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
const file=process.argv[2], DAYS=+(process.argv[3]||10), E=load(file), {DAY,HOUR}=E;
const T={clumsy:{every:[4,20],mis:0.15},casual:{every:[6,12],mis:0.06},skilled:{every:[5,7],mis:0.02}};
const tiers=(process.argv[4]||'clumsy,casual,skilled').split(',');
for(const tier of tiers){const rows=[];for(const seed of [1,2,3,4,5]){
 const r=mul(seed*7919+tier.length*31);const st=E.sampleTank(1000+seed,60);E.resize(st,844/9.2,390/9.2,3+84/9.2,76/9.2);
 const end=st.t+DAYS*DAY;let next=st.t,feeds=0,min=99;const d0=st.died,b0=st.born;let starveD=0;
 const feed=n=>{for(let i=0;i<n;i++){E.feed(st);feeds++;}};
 while(st.t<end){
  if(st.t>=next){const [lo,hi]=T[tier].every;next=st.t+(lo+r()*(hi-lo))*HOUR;
   const n=st.fish.length, hungry=n&&(st.fish.filter(f=>f.hunger>0.6).length>n/2), starving=n&&st.fish.filter(f=>f.hunger>0.85).length>=Math.max(1,n*0.25);
   const q=E.quality(st), w=st.water, dirty=w.nitrate>45||w.algae>40||st.detritus>2||w.o2<55||w.ammonia>0.2;
   const mis=r()<T[tier].mis;
   if(tier==='clumsy'){const x=r(); if(x<0.5){const k=1+Math.floor(r()*3); if(mis)E.waterChange(st,0.3); else feed(k);} else if(x<0.62){ if(mis)feed(2); else E.waterChange(st,0.3);} else if(x<0.72)E.setLight(st,(st.light+1)%4); else if(x<0.84&&q.label==='危險')E.waterChange(st,0.3);}
   else if(tier==='casual'){ if(mis){E.setLight(st,(st.light+1)%4);} else { if(hungry||starving)feed(1+(r()<0.3?1:0)); else if(r()<0.35)feed(1); if((q.label!=='清澈'||dirty)&&r()<0.85)E.waterChange(st,0.3);} }
   else { const p=starving?2:hungry?1:(r()<0.5?1:0); feed(p); if(E.load(st)>E.CAP)st.breedOff=true; else if(E.load(st)<E.CAP*0.75)st.breedOff=false; if(w.nitrate>40||w.ammonia>0.2||w.algae>45)E.waterChange(st,0.3); if(st.light!==2)E.setLight(st,2); }
  }
  E.step(st,0.1,4); for(let i=0;i<7;i++)E.step(st,0.1,4);
  min=Math.min(min,st.fish.length);
 }
 const why={};for(const l of st.log){const m=l.msg.match(/(餓死|水質不佳|缺氧|老去|吃掉|生病)/);if(m)why[m[1]]=(why[m[1]]||0)+1;}
 rows.push(`s${seed}: ${JSON.stringify(why)} end ${st.fish.length} min ${min} died ${st.died-d0} born ${st.born-b0} feeds ${feeds} q ${E.quality(st).score} o2 ${st.water.o2|0}`);
}console.log(file,tier,'\n  '+rows.join('\n  '));}
