// Core tests for 生態水族箱 (eco-aquarium): the ecosystem model between CORE markers, plus a short Playwright drive of the page.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const ECO = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return ECO;')();
const { DAY, HOUR } = ECO;
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const bare = (seed) => { const st = ECO.newTank({ seed: seed || 3 }); return st; };

// --- construction / determinism ---
{
  const a = ECO.sampleTank(42, 60), b = ECO.sampleTank(42, 60);
  ok(JSON.stringify(a) === JSON.stringify(b), 'sample tank is deterministic for a seed');
  ok(a.fish.length >= 17 && a.plants.length >= 7 && a.cleaners.length === 5, 'sample tank has fish, plants and cleaners');
  ok(ECO.quality(a).score >= 75, 'sample tank starts healthy (score ' + ECO.quality(a).score + ')');
  ok(a.history.length >= 100, 'sample tank has a day of history (' + a.history.length + ' samples)');
  ok(a.fish.every(f => f.x >= 0 && f.x <= a.w && f.y >= 0 && f.y <= a.h), 'all fish inside the tank');
  ok(new Set(a.fish.map(f => f.name)).size === a.fish.length, 'fish names are unique while names remain');
  const st = bare();
  ok(ECO.addFish(st, 'nope') === null && ECO.addPlant(st, 'nope') === null && ECO.addCleaner(st, 'nope') === null, 'unknown species rejected');
  for (let i = 0; i < 40; i++) ECO.addFish(st, 'guppy');
  ok(st.fish.length === ECO.MAX_FISH, 'fish count capped at MAX_FISH');
  ok(Math.abs(ECO.load(st) - 30 * 0.15 * 1) < 1e-9, 'load = Σ size × species load');
}
// --- feeding ---
{
  const st = bare(); const f = ECO.addFish(st, 'guppy', { size: 1, hunger: 0.9, x: 50, y: 30 });
  ECO.feed(st, 5);
  ok(st.food.length === 5 && st.food.every(k => k.y < st.tp + 1.5), 'feed drops flakes at the surface');
  ECO.advance(st, 10 * 60);
  ok(f.hunger < 0.5 && st.food.length === 4, 'a hungry fish eats a flake while away (coarse mode)');
  const st2 = bare(); st2.water.bacteria = 0.05; ECO.addFish(st2, 'guppy', { size: 1, hunger: 0, x: 50, y: 30 }); ECO.feed(st2, 4);
  ECO.advance(st2, 4 * HOUR);
  const ctl = bare(); ctl.water.bacteria = 0.05; ECO.addFish(ctl, 'guppy', { size: 1, hunger: 0, x: 50, y: 30 }); ECO.advance(ctl, 4 * HOUR);
  ok(st2.food.length === 0 && st2.detritus > ctl.detritus + 0.3, 'uneaten flakes rot into detritus within hours (' + st2.detritus.toFixed(2) + ' vs ' + ctl.detritus.toFixed(2) + ')');
  ok(st2.water.ammonia > 0.03, 'rotting food raises ammonia (' + st2.water.ammonia.toFixed(3) + ')');
  // realtime: fish swims to a flake and eats it
  const st3 = bare(); const g = ECO.addFish(st3, 'guppy', { size: 1, hunger: 0.9, x: 50, y: 30 }); st3.food.push({ x: 60, y: 30, vy: 0, t: st3.t, w: 0 });
  for (let i = 0; i < 400 && st3.food.length; i++) ECO.step(st3, 1 / 60, 1);
  ok(st3.food.length === 0 && g.hunger < 0.5 && g.chew > -1, 'in real time a hungry fish swims to the flake and eats it');
  const st4 = bare(); const h0 = ECO.addFish(st4, 'guppy', { size: 1, hunger: 0.05, x: 50, y: 30 }); st4.food.push({ x: 52, y: 30, vy: 0, t: st4.t, w: 0 });
  for (let i = 0; i < 120; i++) ECO.step(st4, 1 / 60, 1);
  ok(st4.food.length === 1 && h0.hunger < 0.2, 'a full fish ignores food');
}
// --- hunger, starvation, old age ---
{
  const st = bare(); const f = ECO.addFish(st, 'guppy', { size: 1, hunger: 0 });
  ECO.advance(st, 12 * HOUR);
  ok(f.hunger > 0.3 && f.hunger < 0.6, 'hunger rises ~0.4 in half a day (' + f.hunger.toFixed(2) + ')');
  st.light = 0; const h1 = f.hunger; ECO.advance(st, 6 * HOUR);
  ok(f.hunger - h1 < 6 / 24 * 0.8, 'hunger rises slower in the dark (resting)');
  const st2 = bare(); ECO.addFish(st2, 'guppy', { size: 1, hunger: 0 }); const s2 = ECO.advance(st2, 2 * DAY);
  ok(st2.fish.length === 1 && st2.fish[0].hp > 0.3, 'an unfed fish survives the 2-day offline cap, weakened (hp ' + st2.fish[0].hp.toFixed(2) + ')');
  ok(s2.simSeconds === 2 * DAY && !s2.capped, 'advance reports simulated seconds');
  for (let i = 0; i < 5; i++) ECO.advance(st2, 2 * DAY);
  ok(st2.fish.length === 0 && st2.died === 1 && /餓死/.test(st2.log[0].msg), 'a fish starves eventually and the log says so');
  const st3 = bare(); const o = ECO.addFish(st3, 'guppy', { size: 1, hunger: 0 }); o.life = 2 * HOUR; ECO.advance(st3, 3 * HOUR);
  ok(st3.fish.length === 0 && /老去/.test(st3.log[0].msg), 'old fish die of age');
  const st4 = bare(); const u = ECO.advance(st4, 30 * DAY);
  ok(u.capped && u.simSeconds === ECO.OFFLINE_CAP && Math.abs(u.days - 2) < 1e-6, 'offline catch-up is capped at 2 days');
}
// --- growth & breeding ---
{
  const st = bare(); const f = ECO.addFish(st, 'guppy', { size: 0.15, hunger: 0 });
  for (let d = 0; d < 4; d++) { ECO.feed(st, 4); ECO.advance(st, DAY); }
  ok(f.size >= 1, 'a fed fry grows to adult in a few days (size ' + f.size.toFixed(2) + ')');
  ok(ECO.stage({ sp: 'guppy', size: 0.2, age: 0 }) === '幼魚' && ECO.stage({ sp: 'guppy', size: 0.7, age: 0 }) === '亞成魚' && ECO.stage({ sp: 'guppy', size: 1, age: DAY }) === '成魚' && ECO.stage({ sp: 'guppy', size: 1, age: 21 * DAY }) === '老年', 'life stages');
  const st2 = bare(11); ECO.addFish(st2, 'guppy', { size: 1, sex: 'f', hunger: 0.1, cd: 0 }); ECO.addFish(st2, 'guppy', { size: 1, sex: 'm', hunger: 0.1, cd: 0 });
  for (let i = 0; i < 24 && st2.fish.length < 3; i++) { ECO.feed(st2, 3); ECO.advance(st2, HOUR); }
  ok(st2.fish.length > 2 && st2.fish.slice(2).every(f => f.sp === 'guppy' && f.size < 0.35) && st2.born === st2.fish.length - 2, 'a well-fed pair breeds fry of the same species');
  ok(/生了/.test(st2.log.find(l => /生了/.test(l.msg)).msg), 'birth is logged');
  const st3 = bare(11); ECO.addFish(st3, 'guppy', { size: 1, sex: 'f', hunger: 0.1, cd: 0 }); ECO.addFish(st3, 'guppy', { size: 1, sex: 'f', hunger: 0.1, cd: 0 });
  for (let i = 0; i < 24; i++) { ECO.feed(st3, 3); ECO.advance(st3, HOUR); }
  ok(st3.fish.length === 2, 'two females do not breed');
  const st4 = bare(11); ECO.addFish(st4, 'guppy', { size: 1, sex: 'f', hunger: 0.1, cd: 0 }); ECO.addFish(st4, 'guppy', { size: 1, sex: 'm', hunger: 0.1, cd: 0 }); st4.water.ammonia = 0.6;
  for (let i = 0; i < 12; i++) { ECO.feed(st4, 3); st4.water.ammonia = 0.6; ECO.advance(st4, HOUR); }
  ok(st4.born === 0, 'no breeding in bad water');
  // playtest fix: breeding is gated on the load once every fry is grown, so a well-fed tank levels off instead of hitting 30 and starving
  const st5 = ECO.sampleTank(7, 60); let maxN = 0;
  for (let i = 0; i < 10 * 24; i++) { if (i % 8 === 0) ECO.feed(st5); ECO.advance(st5, HOUR); maxN = Math.max(maxN, st5.fish.length); }
  const adult = st5.fish.reduce((s, f) => s + ECO.SPECIES[f.sp].load, 0);
  ok(maxN < ECO.MAX_FISH && adult <= ECO.CAP * ECO.BREED_ROOM + 5, 'a well-fed sample tank levels off (max ' + maxN + ' fish, grown load ' + adult.toFixed(1) + ')');
  ok(ECO.pinch(bare()) === 6 && ECO.pinch(st5) >= 9 && ECO.pinch({ fish: new Array(30) }) === 16, 'one pinch is sized to the number of fish (6 to 16 flakes)');
}
// --- predation & fights ---
{
  const st = bare(5); const a = ECO.addFish(st, 'angel', { size: 1, hunger: 0.9, x: 50, y: 30 });
  for (let i = 0; i < 4; i++) ECO.addFish(st, 'guppy', { size: 0.15, x: 50 + i, y: 30 });
  ECO.advance(st, 6 * HOUR);
  ok(st.fish.length < 5 && a.hunger < 0.9 && /吃掉/.test(st.log.find(l => /吃掉/.test(l.msg)).msg), 'a hungry angelfish eats fry (coarse)');
  const st2 = bare(5); const b = ECO.addFish(st2, 'betta', { size: 1, hunger: 0.9, x: 40, y: 30 }); const fry = ECO.addFish(st2, 'guppy', { size: 0.15, x: 44, y: 30 });
  for (let i = 0; i < 600 && st2.fish.length === 2; i++) ECO.step(st2, 1 / 60, 1);
  ok(st2.fish.length === 1 && st2.fish[0] === b && b.hunger < 0.9, 'in real time a betta chases and eats a nearby fry');
  const st3 = bare(); ECO.addFish(st3, 'betta', { size: 1, hunger: 0 }); ECO.addFish(st3, 'betta', { size: 1, hunger: 0 }); ECO.advance(st3, 6 * HOUR);
  ok(st3.fish.every(f => f.hp < 0.9) && st3.log.some(l => /鬥魚/.test(l.msg)), 'two bettas fight and lose health');
  const st4 = bare(); ECO.addFish(st4, 'betta', { size: 1, hunger: 0 }); ECO.advance(st4, 6 * HOUR);
  ok(st4.fish[0].hp === 1, 'a lone betta is fine');
}
// --- nitrogen cycle ---
{
  const st = bare(); st.water.bacteria = 0.05; st.water.ammonia = 0; for (let i = 0; i < 8; i++) ECO.addFish(st, 'goldfish', { size: 1, hunger: 0 });
  ECO.advance(st, 8 * HOUR);
  ok(st.water.ammonia > 0.3, 'fish waste raises ammonia with few bacteria (' + st.water.ammonia.toFixed(2) + ')');
  ok(st.water.bacteria > 0.5, 'bacteria colonise when ammonia is present (' + st.water.bacteria.toFixed(2) + ')');
  const st2 = bare(); st2.water.ammonia = 0.5; st2.water.nitrate = 0; st2.water.bacteria = 1; ECO.advance(st2, 6 * HOUR);
  ok(st2.water.ammonia < 0.1 && st2.water.nitrate > 0.5, 'mature bacteria convert ammonia into nitrate');
  const st3 = bare(); st3.water.ammonia = 0.8; st3.water.bacteria = 0.05; for (let i = 0; i < 3; i++) ECO.addFish(st3, 'neon', { size: 1, hunger: 0 });
  for (let i = 0; i < 72; i++) { st3.water.ammonia = 0.8; ECO.advance(st3, HOUR); }
  ok(st3.fish.length < 3 && st3.log.some(l => /水質不佳/.test(l.msg)), 'high ammonia kills fish');
  const st4 = bare(); st4.water.o2 = 10; ECO.addFish(st4, 'neon', { size: 1, hunger: 0 });
  for (let i = 0; i < 24 * 12; i++) { st4.water.o2 = 10; ECO.advance(st4, 600); }
  ok(st4.fish.length === 0 && /缺氧/.test(st4.log[0].msg), 'low oxygen kills fish');
  const st5 = bare(); st5.water.ammonia = 0.4; st5.water.nitrate = 60; st5.water.algae = 40; st5.detritus = 2; st5.food.push({ x: 1, y: 1, t: 0 });
  ECO.waterChange(st5, 0.3);
  ok(Math.abs(st5.water.ammonia - 0.28) < 1e-9 && Math.abs(st5.water.nitrate - 42) < 1e-9 && st5.water.algae < 40 && st5.detritus < 1 && st5.food.length === 0, 'a 30% water change dilutes everything and vacuums the floor');
  const q1 = ECO.quality({ water: { ammonia: 0.02, nitrate: 10, o2: 90, algae: 5 } }), q2 = ECO.quality({ water: { ammonia: 0.6, nitrate: 90, o2: 20, algae: 80 } });
  ok(q1.score >= 95 && q1.label === '清澈' && q2.score === 0 && q2.label === '危險', 'quality score and labels');
}
// --- plants, light, algae, oxygen ---
{
  const mk = (light) => { const st = bare(); st.light = light; st.water.nitrate = 30; st.water.algae = 10; for (let i = 0; i < 4; i++) ECO.addPlant(st, 'vallis', { size: 0.5 }); return st; };
  const bright = mk(3), dark = mk(0), mid = mk(2);
  ECO.advance(bright, DAY); ECO.advance(dark, DAY); ECO.advance(mid, DAY);
  ok(avg(bright.plants, 'size') > avg(mid.plants, 'size') && avg(mid.plants, 'size') > 0.5 && avg(dark.plants, 'size') < 0.5, 'plants grow with light and shrink in the dark');
  ok(bright.water.nitrate < mid.water.nitrate && mid.water.nitrate < 30, 'plants take up nitrate, more under strong light');
  ok(bright.water.algae > mid.water.algae && mid.water.algae > dark.water.algae && dark.water.algae < 10, 'algae grows with light, fades in the dark');
  const o2 = bare(); o2.water.o2 = 50; o2.light = 3; for (let i = 0; i < 5; i++) ECO.addPlant(o2, 'vallis', { size: 1 });
  const no = bare(); no.water.o2 = 50; no.light = 3; ECO.advance(o2, 2 * HOUR); ECO.advance(no, 2 * HOUR);
  ok(o2.water.o2 > no.water.o2, 'plants add oxygen under light');
  const crowd = bare(); crowd.light = 0; crowd.water.o2 = 100; for (let i = 0; i < 12; i++) ECO.addFish(crowd, 'goldfish', { size: 1, hunger: 0 }); ECO.advance(crowd, 12 * HOUR);
  ok(crowd.water.o2 < 70, 'many big fish at night draw oxygen down (' + crowd.water.o2.toFixed(0) + '%)');
  const sp = bare(9); sp.light = 3; sp.water.nitrate = 40; ECO.addPlant(sp, 'vallis', { size: 1 });
  for (let i = 0; i < 10 && sp.plants.length < 2; i++) ECO.advance(sp, DAY);
  ok(sp.plants.length >= 2 && sp.plants[1].kind === 'vallis', 'vallisneria sends out runners');
  const gold = bare(); gold.light = 2; ECO.addPlant(gold, 'anubias', { size: 1 }); ECO.addFish(gold, 'goldfish', { size: 1, hunger: 0.9 }); gold.water.nitrate = 0;
  const g0 = gold.plants[0].size; ECO.advance(gold, DAY);
  ok(gold.plants[0].size < g0, 'a hungry goldfish nibbles plants');
}
// --- cleaners ---
{
  const a = bare(), b = bare(); a.water.algae = b.water.algae = 40; a.light = b.light = 0; for (let i = 0; i < 6; i++) ECO.addCleaner(a, 'snail');
  ECO.advance(a, DAY); ECO.advance(b, DAY);
  ok(a.water.algae < b.water.algae - 5, 'snails graze algae');
  const c = bare(), d = bare(); c.detritus = d.detritus = 4; for (let i = 0; i < 5; i++) ECO.addCleaner(c, 'shrimp');
  ECO.advance(c, 6 * HOUR); ECO.advance(d, 6 * HOUR);
  ok(c.detritus < d.detritus - 1, 'shrimp clean up detritus');
  const e = bare(8); e.detritus = 6; ECO.addCleaner(e, 'snail');
  for (let i = 0; i < 6; i++) { e.detritus = 6; ECO.advance(e, 6 * HOUR); }
  ok(e.cleaners.length > 1 && e.log.some(l => /蘋果螺又多了/.test(l.msg)), 'snails multiply when detritus is high');
  const o = bare(); o.water.algae = 0; o.light = 0; const oto = ECO.addFish(o, 'oto', { size: 1, hunger: 0 }); ECO.advance(o, DAY);
  const o2 = bare(); o2.water.algae = 30; o2.light = 0; const oto2 = ECO.addFish(o2, 'oto', { size: 1, hunger: 0 }); ECO.advance(o2, DAY);
  ok(oto.hunger > 0.7 && oto2.hunger < 0.3, 'otocinclus feed on algae and starve without it');
}
// --- motion / boids ---
{
  const st = bare(2); for (let i = 0; i < 12; i++) ECO.addFish(st, 'neon', { size: 1, hunger: 0 });
  for (let i = 0; i < 600; i++) ECO.step(st, 1 / 60, 1);
  ok(st.fish.every(f => f.x >= 0 && f.x <= st.w && f.y >= 0 && f.y <= st.h - 4), 'fish stay inside the water after 10 s of boids');
  const cx = avg(st.fish, 'x'), cy = avg(st.fish, 'y'), spread = st.fish.reduce((s, f) => s + Math.hypot(f.x - cx, f.y - cy), 0) / st.fish.length;
  const lone = bare(2); for (let i = 0; i < 12; i++) ECO.addFish(lone, 'goldfish', { size: 1, hunger: 0 });
  const lx = avg(lone.fish, 'x'), ly = avg(lone.fish, 'y'), lspread = lone.fish.reduce((s, f) => s + Math.hypot(f.x - lx, f.y - ly), 0) / lone.fish.length;
  ok(spread < 16, 'neons school together (mean spread ' + spread.toFixed(1) + ')');
  ok(lspread > spread, 'non-schooling fish stay more spread out (' + lspread.toFixed(1) + ')');
  const st2 = bare(); const f = ECO.addFish(st2, 'guppy', { size: 1, x: 50, y: 30, hunger: 0 }); f.vx = 0; f.vy = 0;
  ECO.startle(st2, 45, 30, 16); const sx = f.st;
  for (let i = 0; i < 30; i++) ECO.step(st2, 1 / 60, 1);
  ok(sx > 0 && f.x > 50, 'a tap startles a fish away from the finger');
  ok(ECO.fishAt(st2, f.x, f.y, 6) === f && ECO.fishAt(st2, 5, 5, 6) === null, 'fishAt picks the fish under a tap and nothing elsewhere');
  const st3 = bare(); const g = ECO.addFish(st3, 'guppy', { size: 1, x: 50, y: 50 }); ECO.addCleaner(st3, 'snail'); ECO.resize(st3, 80, 136, 10);
  ok(st3.h === 80 && st3.w === 136 && g.y > 60 && Math.abs(g.x - 100) < 1e-9 && st3.cleaners[0].y === 70, 'resize rescales positions and keeps cleaners on the (padded) floor');
  const info = ECO.fishInfo(st3, g);
  ok(info.name === g.name && info.species === '孔雀魚' && /[♀♂]/.test(info.sex) && typeof info.stage === 'string' && typeof info.mood === 'string', 'fishInfo describes a fish');
}
// --- breeding switch, records, milestones, new species (review round) ---
{
  const pair = (seed, off) => { const st = bare(seed); st.breedOff = off; ECO.addFish(st, 'guppy', { size: 1, sex: 'f', hunger: 0.1, cd: 0 }); ECO.addFish(st, 'guppy', { size: 1, sex: 'm', hunger: 0.1, cd: 0 }); for (let i = 0; i < 48; i++) { ECO.feed(st, 3); ECO.advance(st, HOUR); } return st; };
  ok(pair(11, false).born > 0 && pair(11, true).born === 0, 'the breeding switch stops births');
  // near the load limit births slow down: same pair, once in an empty tank and once next to a crowd of adult otos (no litters of their own)
  let lo = 0, hi = 0;
  for (let seed = 1; seed <= 12; seed++) {
    for (const crowd of [0, 1]) { const st = bare(seed); if (crowd) for (let i = 0; i < 26; i++) ECO.addFish(st, 'oto', { size: 1, hunger: 0 }); ECO.addFish(st, 'guppy', { size: 1, sex: 'f', hunger: 0.1, cd: 0 }); ECO.addFish(st, 'guppy', { size: 1, sex: 'm', hunger: 0.1, cd: 0 }); st.water.algae = 60;
      let t = 0; while (!st.born && t < 72) { for (const f of st.fish) f.hunger = 0.1; ECO.advance(st, HOUR); t++; } if (crowd) hi += t; else lo += t; }
  }
  ok(hi > lo * 1.5, 'births come slower near the load limit (mean hours to first litter ' + (lo / 12).toFixed(1) + ' vs ' + (hi / 12).toFixed(1) + ')');
  const st = pair(11, false), r = ECO.records(st);
  ok(r.gen === 2 && st.fish.some(f => f.gen === 2), 'fry are the next generation (' + r.gen + ')');
  ok(r.oldest.days >= 2 && r.school.sp === 'guppy' && r.school.n >= 2, 'records: oldest fish and biggest school');
  ok(r.ms.first && st.log.some(l => /里程碑：第一窩小魚/.test(l.msg)), 'first litter milestone is reached and logged');
  const s2 = ECO.sampleTank(5, 60); for (let d = 0; d < 4; d++) { ECO.feed(s2); ECO.advance(s2, 12 * HOUR); ECO.feed(s2); ECO.waterChange(s2, 0.3); ECO.advance(s2, 12 * HOUR); }
  const r2 = ECO.records(s2);
  ok(r2.best >= 3 && r2.ms.clear3, 'a well-kept sample tank counts clear-water days (' + r2.streak + ', best ' + r2.best + ')');
  ok(ECO.MILESTONES.length === 8 && !r2.ms.clear7, 'eight milestones, the long ones still ahead');
  const s3 = ECO.sampleTank(5, 60); s3.water.ammonia = 0.6; s3.rec.dayMin = 100; ECO.advance(s3, DAY);
  ok(ECO.records(s3).streak === 0, 'a murky day resets the clear-water streak');
  // new species
  const s4 = bare(); const z = ECO.addFish(s4, 'zebra', { size: 1 }), c = ECO.addFish(s4, 'cory', { size: 1, hunger: 0.9, x: 30, y: s4.h - s4.fb - 1 });
  ok(z && c && ECO.SPECIES.zebra.yp < 0.3 && ECO.SPECIES.cory.yp > 0.9, 'zebra danio (top) and cory (bottom) can be added');
  s4.food.push({ x: 33, y: s4.h - s4.fb - 0.3, vy: 0, t: s4.t, w: 0 });
  for (let i = 0; i < 40 && s4.food.length; i++) ECO.motion(s4, 0.1);
  ok(!s4.food.length && c.hunger < 0.9, 'a cory picks up a flake from the sand');
  const s5 = bare(); for (let i = 0; i < 6; i++) ECO.addFish(s5, 'zebra', { size: 1, y: s5.h - 10 }); for (let i = 0; i < 300; i++) ECO.motion(s5, 0.1);
  const zy = s5.fish.reduce((a, f) => a + f.y, 0) / 6, col = (zy - s5.tp) / (s5.h - s5.fb - s5.tp);
  ok(col < 0.4, 'zebras swim up into the top of the water column (' + col.toFixed(2) + ')');
}
// --- save / restore ---
{
  const st = ECO.sampleTank(99, 60); const json = ECO.serialize(st);
  const r = ECO.restore(json, JSON.parse(json).savedAt);
  ok(r && r.st.fish.length === st.fish.length && r.sum === null, 'restore right away: no catch-up');
  const r2 = ECO.restore(json, JSON.parse(json).savedAt + 300 * 1000);
  ok(r2 && r2.sum && Math.abs(r2.sum.simSeconds - 300 * ECO.SCALE) < 5 && Math.abs(r2.st.t - st.t - 300 * ECO.SCALE) < 5, 'restore after five minutes simulates 240× elapsed time (20 tank hours)');
  const r3 = ECO.restore(json, Date.now() + 2 * 3600 * 1000);
  ok(r3.sum.capped && r3.st.t - st.t === ECO.OFFLINE_CAP, 'restore after two days is capped');
  ok(ECO.restore('garbage') === null && ECO.restore('{"st":{}}') === null && ECO.restore(JSON.stringify({ st: { v: 2, fish: [], water: {} } })) === null, 'bad saves are rejected');
  ok(r3.st.history.length <= 450, 'history ring buffer bounded');
}

// --- page drive with Playwright ---
(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); await page.waitForTimeout(800);
  const tap = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) throw new Error('no ' + s); el.click(); }, sel);
  ok(await page.isVisible('#intro'), 'first open shows the intro overlay');
  await tap('#bStart'); await page.waitForTimeout(200);
  ok(await page.isHidden('#intro'), 'intro closes and is remembered');
  const n0 = await page.evaluate(() => window.__eco.st.fish.length);
  ok(n0 >= 17, 'page starts with the sample tank (' + n0 + ' fish)');
  const food0 = await page.evaluate(() => window.__eco.st.food.length);
  await tap('#bFeed'); await page.waitForTimeout(100);
  const pinch = await page.evaluate(() => window.__eco.ECO.pinch(window.__eco.st));
  ok(await page.evaluate(() => window.__eco.st.food.length) === food0 + pinch && pinch >= 6 && pinch <= 16, 'feed button drops one pinch sized for the tank (' + pinch + ' flakes)');
  await tap('#bLight'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__eco.st.light) === 3 && (await page.textContent('#lightLab')) === '強', 'light button cycles to 強');
  await page.evaluate(() => { window.__eco.st.water.nitrate = 60; });
  await tap('#bWater'); await page.waitForTimeout(100);
  ok(Math.abs(await page.evaluate(() => window.__eco.st.water.nitrate) - 42) < 0.5, 'water change button dilutes nitrate by 30%');
  await tap('#bLife'); await page.waitForTimeout(500);
  ok(await page.isVisible('#sheetLife'), 'life sheet opens');
  await tap('button[data-add="fish:goldfish"]'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__eco.st.fish.filter(f => f.sp === 'goldfish').length) === 1, 'adding a goldfish from the sheet');
  await tap('button[data-rem="fish:goldfish"]'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__eco.st.fish.filter(f => f.sp === 'goldfish').length) === 0, 'removing it again');
  await tap('#sheetLife [data-close]'); await page.waitForTimeout(400);
  await tap('#bStats'); await page.waitForTimeout(500);
  ok(await page.isVisible('#graph') && (await page.textContent('#statRows')).includes('氨'), 'stats sheet shows readings and graph');
  await tap('#sheetStats [data-close]');
  // tap a fish
  const hit = await page.evaluate(() => { const st = window.__eco.st, S = window.__eco.S(); const f = st.fish.find(x => x.size >= 1) || st.fish[0]; f.x = st.w / 2; f.y = (st.tp + st.h - st.fb) / 2; window.__eco.showCard(f); return { x: f.x * S, y: f.y * S, name: f.name }; });
  await page.waitForTimeout(100);
  ok(await page.isVisible('#card') && (await page.textContent('#card')).includes(hit.name), 'tapping a fish shows its card with its name');
  const nBefore = await page.evaluate(() => window.__eco.st.fish.length);
  await tap('#cRemove'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__eco.st.fish.length) === nBefore && (await page.textContent('#cRemove')).includes('確定'), 'first tap on 移出 only asks to confirm');
  await tap('#cRemove'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__eco.st.fish.length) === nBefore - 1 && await page.isHidden('#card'), 'second tap removes the fish and closes the card');
  await page.evaluate(() => { const st = window.__eco.st; window.__eco.showCard(st.fish.find(x => x.size >= 1) || st.fish[0]); });
  await tap('#cClose'); await page.waitForTimeout(100);
  ok(await page.isHidden('#card') && (await page.textContent('#cRemove')) === '移出', 'card closes and the remove button is reset');
  // attention cues: starving fish light the feed badge and the quality chip, once in words
  await page.evaluate(() => { for (const f of window.__eco.st.fish) f.hunger = 0.95; window.__eco.st.food = []; });
  const until = async fn => { for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__eco.hud()); if (await page.evaluate(fn)) return true; await page.waitForTimeout(150); } return false; };
  ok(await until(() => document.getElementById('feedBadge').classList.contains('on') && document.getElementById('qual').classList.contains('alert') && /餓/.test(document.getElementById('qsub').textContent)), 'starving fish: feed badge + alert in the quality chip');
  ok((await page.textContent('#toasts')).includes('餓壞'), 'starving fish: one spoken warning');
  await page.evaluate(() => { for (const f of window.__eco.st.fish) f.hunger = 0.1; window.__eco.st.water.o2 = 30; });
  ok(await until(() => !document.getElementById('feedBadge').classList.contains('on') && document.getElementById('waterBadge').classList.contains('bad') && /缺氧/.test(document.getElementById('qsub').textContent)), 'low oxygen: water badge + 缺氧 in the chip');
  await page.evaluate(() => { window.__eco.st.water.o2 = 90; });
  // save + reload with elapsed time
  await page.evaluate(() => { window.__eco.save(); const raw = localStorage.getItem('eco-aquarium:v1:save'); const o = JSON.parse(raw); o.savedAt -= 30 * 60 * 1000; localStorage.setItem('eco-aquarium:v1:save', JSON.stringify(o)); });
  const t1 = await page.evaluate(() => window.__eco.st.t);
  await page.evaluate(() => window.__eco.load()); await page.waitForTimeout(300);
  const t2 = await page.evaluate(() => window.__eco.st.t);
  ok(Math.abs(t2 - t1 - ECO.OFFLINE_CAP) < 600 && (await page.textContent('#toasts')).includes('離開'), 'reopening after 30 min catches up, capped to 2 tank days (' + ((t2 - t1) / DAY).toFixed(1) + ' d) and says so');
  await page.reload(); await page.waitForTimeout(800);
  ok(await page.isHidden('#intro') && (await page.evaluate(() => window.__eco.st.fish.length)) > 0, 'reload restores the saved tank without the intro');
  await page.keyboard.press('f'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__eco.st.food.length) >= 8, 'keyboard F feeds');
  // review round: breeding switch, records panel, intro sound button, new species rows
  await page.evaluate(() => window.__eco.open('sheetLife')); await page.waitForTimeout(500);
  await tap('button[data-breed="off"]'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__eco.st.breedOff === true && document.querySelector('button[data-breed="off"]').getAttribute('aria-pressed') === 'true'), 'breeding switch turns breeding off');
  await tap('button[data-breed="on"]'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => !window.__eco.st.breedOff), 'and back on');
  ok(await page.evaluate(() => !!document.querySelector('button[data-add="fish:zebra"]') && !!document.querySelector('button[data-add="fish:cory"]')), 'zebra danio and cory rows in the life sheet');
  await tap('button[data-add="fish:cory"]'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__eco.st.fish.some(f => f.sp === 'cory')), 'adding a cory');
  await page.evaluate(() => window.__eco.open('sheetStats')); await page.waitForTimeout(500);
  ok(await page.evaluate(() => document.querySelectorAll('#recRows > div').length === 4 && document.querySelectorAll('#msRow span').length === 8 && /最長壽/.test(document.getElementById('recRows').textContent)), 'stats sheet shows 4 records and 8 milestones');
  await page.evaluate(() => window.__eco.closeSheet());
  ok(await page.evaluate(() => /負載/.test(document.getElementById('sheetHelp').textContent) && /6 分鐘/.test(document.getElementById('sheetHelp').textContent)), 'help explains 負載 and the length of a tank day');
  await page.evaluate(() => document.getElementById('bIntroSound').click());
  ok(await page.evaluate(() => localStorage.getItem('eco-aquarium:v1:sound') === 'true' && document.getElementById('mSound').getAttribute('aria-pressed') === 'true'), 'intro sound button turns sound on and the menu agrees');
  await page.evaluate(() => document.getElementById('bIntroSound').click());
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]);
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL browser: ' + e.message); console.log(pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
