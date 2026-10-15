// 光路折鏡 (light-path) skill-tier bot. Usage: node bot.js [tiers...] [--levels=1,10,...]
// Reads state via window.__game.state()/cellClient(); acts only through CDP touch taps on the canvas / buttons.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const APP = path.resolve(__dirname, '../../../apps/light-path/index.html');
const src = fs.readFileSync(APP, 'utf8');
const C = new Function(src.slice(src.indexOf('// ===CORE-START==='), src.indexOf('// ===CORE-END===')) + '\nreturn LPCore;')();
const LEVELS = JSON.parse(src.match(/var LEVELS = (\[\[.*?\]\]);/)[1]);

const args = process.argv.slice(2);
const tiers = args.filter(a => H.TIERS[a]);
const TIER_LIST = tiers.length ? tiers : H.TIER_IDS;
const lvArg = args.find(a => a.startsWith('--levels='));
const TEST_LEVELS = lvArg ? lvArg.slice(9).split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
const TIME_CAP = 75000;
const pop = c => (c & 1) + ((c >> 1) & 1) + ((c >> 2) & 1);

function score(lv, ori) {
  const tr = C.trace(lv, ori, false);
  if (C.isWin(lv, tr)) return 1e6;
  let s = 0;
  for (let i = 0; i < lv.N; i++) if (lv.type[i] === C.TARGET) {
    const r = tr.recv[i], m = lv.mask[i];
    s += 4 * pop(r & m) - 3 * pop(r & ~m) + (r === m ? 6 : 0);
  }
  if (tr.crystal) s -= 12;
  return s;
}
function decide(P, lv, ori, tabu) {
  const rot = lv.rot, cur = score(lv, ori);
  const tr = C.trace(lv, ori, false);
  const toggled = i => { const o = new Uint8Array(ori); o[i] ^= 1; return o; };
  const randomTouched = () => { const t = rot.filter(i => tr.touched[i]); return P.rng.pick(t.length ? t : rot); };
  const greedy1 = () => {
    let best = -1, bs = -1e9;
    for (const i of rot) { const s = score(lv, toggled(i)) - (tabu.includes(i) ? 3 : 0) + P.rng() * 0.3; if (s > bs) { bs = s; best = i; } }
    return bs > cur ? best : randomTouched();
  };
  const t = P.tierId;
  if (t === 'clumsy') return P.rng() < 0.5 ? P.rng.pick(rot) : greedy1();
  if (t === 'casual') return P.rng() < 0.15 ? P.rng.pick(rot) : greedy1();
  if (t === 'skilled') {
    let best = -1, bs = -1e9;
    for (const i of rot) {
      const o1 = toggled(i); let s = score(lv, o1);
      if (s < 1e6) for (const j of rot) { if (j === i) continue; o1[j] ^= 1; s = Math.max(s, score(lv, o1) - 0.5); o1[j] ^= 1; }
      s += -(tabu.includes(i) ? 3 : 0) + P.rng() * 0.3;
      if (s > bs) { bs = s; best = i; }
    }
    return bs > cur ? best : randomTouched();
  }
  // world / superhuman: exact search from what is on screen
  const sol = C.solve(lv, ori, 3e6, null);
  if (sol.cost > 0) { const diff = rot.filter(i => sol.ori[i] !== ori[i]); return diff.find(i => tr.touched[i]) ?? diff[0]; }
  return greedy1();
}

async function playAttempt(P, L) {
  const page = P.page, [variant, par] = LEVELS[L - 1];
  const lv = C.build(L, variant);
  await page.evaluate(L => window.__game.start(L), L);
  await H.sleep(400);
  let st = await page.evaluate(() => window.__game.state());
  if (st.level !== L || st.screen !== 'game') throw new Error('start failed ' + JSON.stringify(st));
  // sanity: node build == page build
  if (st.rot.join() !== Array.from(lv.rot).join()) throw new Error('level mismatch L' + L);
  const t0 = Date.now(); let taps = 0, misTaps = 0, undos = 0, dropped = 0; const tabu = [];
  const maxTaps = 6 * par + 30;
  while (!st.won && Date.now() - t0 < TIME_CAP && taps < maxTaps) {
    await H.sleep(P.reactMs() + P.thinkMs());
    const ori = Uint8Array.from(st.ori);
    let i = decide(P, lv, ori, tabu);
    if (P.mistake()) i = P.rng.pick(Array.from(lv.rot).filter(x => x !== i));
    const c = await page.evaluate(i => window.__game.cellClient(i), i);
    const before = st;
    await P.tap(c.x, c.y); taps++;
    tabu.push(i); if (tabu.length > 3) tabu.shift();
    await H.sleep(30);
    st = await page.evaluate(() => window.__game.state());
    const changed = st.ori.map((v, k) => v !== before.ori[k] ? k : -1).filter(k => k >= 0);
    const hitIdx = changed.length ? changed[0] : -1;
    if (st.moves === before.moves && !st.won) {
      // tap landed on nothing rotatable; check whether we actually aimed inside the intended cell
      continue;
    }
    if (hitIdx !== i) {
      misTaps++;
      // tiers that notice the wrong mirror turned use the undo button (free) instead of re-tapping
      const notice = { clumsy: 0.2, casual: 0.6, skilled: 0.9, world: 1, superhuman: 1 }[P.tierId];
      if (!st.won && P.rng() < notice) {
        await H.sleep(P.reactMs());
        await P.tapSelector('#bUndo'); undos++;
        await H.sleep(30);
        st = await page.evaluate(() => window.__game.state());
      }
    }
  }
  const won = st.won;
  if (won) {
    await H.sleep(1300);
  }
  const resultShown = won ? await page.evaluate(() => document.getElementById('result').classList.contains('show')) : false;
  const stars = won ? (st.moves <= par ? 3 : st.moves <= par + Math.max(2, Math.ceil(par * 0.5)) ? 2 : 1) : 0;
  return { cleared: won, moves: st.moves, par, taps, misTaps, undos, ms: Date.now() - t0, stars, resultShown };
}

async function runTier(browser, tierId, idx) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, tierId, 2000 + idx * 7919);
  await H.sleep(900);
  // navigate like a player once: title -> 開始
  await P.tapSelector('#tPlay'); await H.sleep(500);
  const runs = [];
  for (const L of TEST_LEVELS) {
    const run = { level: L, par: LEVELS[L - 1][1], attempts: [], cleared: false };
    for (let a = 1; a <= P.t.attempts; a++) {
      const r = await playAttempt(P, L);
      run.attempts.push(r);
      if (r.cleared) { run.cleared = true; break; }
    }
    const last = run.attempts[run.attempts.length - 1];
    Object.assign(run, { tries: run.attempts.length, moves: last.moves, stars: last.stars, ms: run.attempts.reduce((a, b) => a + b.ms, 0) });
    runs.push(run); try { const pf = require("path").join(__dirname, "partial-" + tierId + ".json"); require("fs").writeFileSync(pf, JSON.stringify({ runs, errors: sess.errors }, null, 1)); } catch (e) {}
    console.log(`[${tierId}] L${L} ${run.cleared ? 'CLEAR' : 'fail'} tries=${run.tries} moves=${run.moves}/par${run.par} stars=${run.stars} mis=${last.misTaps} ${(run.ms / 1000).toFixed(1)}s`);
  }
  const errors = sess.errors.slice();
  await sess.ctx.close();
  const cl = runs.filter(r => r.cleared);
  return { runs, errors, stats: P.stats, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: runs.reduce((a, r) => a + r.tries, 0),
    avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0, threeStar: runs.filter(r => r.stars === 3).length,
    medianSecondsCleared: H.summarize(cl.map(r => +(r.ms / 1000).toFixed(1))) } };
}

(async () => {
  const browser = await H.launch();
  const out = { game: 'light-path', testedLevels: TEST_LEVELS, timeCapMsPerAttempt: TIME_CAP, tiers: {} };
  const t0 = Date.now();
  const res = await Promise.all(TIER_LIST.map((t, i) => runTier(browser, t, i)));
  TIER_LIST.forEach((t, i) => { out.tiers[t] = res[i]; });
  out.wallMs = Date.now() - t0;
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'raw-results.json'), JSON.stringify(out, null, 1));
  console.log('wall', (out.wallMs / 1000).toFixed(0) + 's');
})().catch(e => { console.error(e); process.exit(1); });
