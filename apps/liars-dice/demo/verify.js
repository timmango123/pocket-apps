// Verification for 吹牛骰 (liars-dice).
// 1) Node, using the game's own core (CORE-START..CORE-END in index.html):
//    a) 20000-round auto-play across all three AI levels with an independent recount of every challenge,
//    b) match series strongest (高手) vs weakest (新手) and the neighbouring pairs, heads-up and 4-player,
//       with 95% Wilson confidence intervals.
// 2) Chromium: a bot plays one complete game in the real page against three 一般 computers using real touch input
//    (CDP Input.dispatchTouchEvent) at human pace (>=150 ms between actions): it peeks under its cup by holding it,
//    taps faces / +/- / 喊, holds 開！ for 0.6 s, taps 下一輪, and ends on the result screen. Recorded to demo/game-4x.mp4.
// The recorded game uses seed 20261020 (dice and AI choices are seeded, so the run is reproducible); it was picked from
// seeds 20261014-20261023, of which the advice-following bot wins 4/10 against three 一般 computers.
// Usage: node verify.js [--sim-only] [--bot-only] [--games N] [--seed S]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const LD = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn LD;')();
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const LV = ['新手', '一般', '高手'];

function recount(g) { // independent of LD.handCount
  const l = g.res.bid; let t = 0;
  for (const P of g.P) {
    if (P.out) continue;
    const s = P.hand.slice().sort().join(''), st = g.o.special && P.hand.length === 5 && (s === '12345' || s === '23456');
    if (st) continue;
    let c = P.hand.filter(d => d === l.f || (g.res.wild && d === 1)).length;
    if (g.o.special && P.hand.length === 5 && c === 5) c++;
    t += c;
  }
  return t;
}
const think = [];
function playGame(levels, seed, opt = {}) {
  const n = levels.length, g = LD.newGame({ n, mode: opt.mode || 'lives', special: opt.special !== false, start: 'players', seed, first: seed % n });
  const R = LD.rng(seed * 7 + 3); let rounds = 0;
  while (g.phase !== 'over') {
    LD.startRound(g); rounds++;
    for (let k = 0; k < 400; k++) {
      const p = g.turn, v = LD.viewFor(g, p, { lvl: levels[p], pers: LD.PERS[p % 3], seed: (R() * 4294967295) >>> 0 });
      const t0 = process.hrtime.bigint(), a = LD.think(v); think.push([levels[p], Number(process.hrtime.bigint() - t0) / 1e6]);
      if (a.act === 'call') { if (!LD.doCall(g)) throw new Error('call refused'); break; }
      if (!LD.doBid(g, { q: a.q, f: a.f })) throw new Error('illegal bid ' + JSON.stringify(a));
    }
    if (g.phase !== 'reveal') throw new Error('round did not end');
    if (recount(g) !== g.res.count) throw new Error('count mismatch seed ' + seed);
    if ((g.res.count >= g.res.bid.q) !== g.res.truth || g.res.loser !== (g.res.truth ? g.res.caller : g.res.bidder)) throw new Error('judgement mismatch');
    LD.settle(g);
  }
  return { winner: g.winner, rounds };
}
function wilson(w, n) { const z = 1.96, p = w / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [c - h, c + h]; }
const pct = x => (x * 100).toFixed(1) + '%';

function sim() {
  const T0 = Date.now();
  // a) 20000 rounds, 3-player tables with one AI of each level, all 6 seatings, rules varied
  let rounds = 0, games = 0; const wins = [0, 0, 0], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  while (rounds < 20000) {
    const lv = perms[games % 6], opt = { mode: games % 4 === 3 ? 'dice' : 'lives', special: games % 3 !== 2 };
    const r = playGame(lv, 90000 + games, opt); rounds += r.rounds; games++; wins[lv[r.winner]]++;
  }
  console.log(`[a] ${rounds} rounds / ${games} games (3 players: one 新手, one 一般, one 高手; all seatings; lives+dice modes; shapes on/off)`);
  console.log(`    every challenge recounted independently: 0 mismatches, 0 illegal bids`);
  console.log('    share of games won (fair = 33.3%): ' + wins.map((w, i) => `${LV[i]} ${pct(w / games)} [${wilson(w, games).map(pct).join(', ')}]`).join('   '));
  // b) match series
  const N = arg('--games', 3000);
  for (const [a, b] of [[2, 0], [2, 1], [1, 0]]) {
    let w = 0; for (let i = 0; i < N; i++) { const lv = i % 2 ? [a, b] : [b, a]; const r = playGame(lv, 1000 + i); if (lv[r.winner] === a) w++; }
    const ci = wilson(w, N);
    let w4 = 0; for (let i = 0; i < N; i++) { const lv = [b, b, b, b]; lv[i % 4] = a; const r = playGame(lv, 50000 + i); if (r.winner === i % 4) w4++; }
    const ci4 = wilson(w4, N);
    console.log(`[b] ${LV[a]} vs ${LV[b]}: heads-up ${N} games, ${LV[a]} wins ${pct(w / N)} 95% CI [${ci.map(pct).join(', ')}]` +
      `   |  4-player (one ${LV[a]} vs three ${LV[b]}) ${N} games, ${LV[a]} wins ${pct(w4 / N)} CI [${ci4.map(pct).join(', ')}] (fair 25%)`);
  }
  const by = [[], [], []]; think.forEach(([l, ms]) => by[l].push(ms));
  console.log('    think time per decision in Node: ' + by.map((a, i) => { a.sort((x, y) => x - y); return `${LV[i]} median ${a[a.length >> 1].toFixed(2)} ms p99 ${a[Math.floor(a.length * 0.99)].toFixed(2)} ms`; }).join('; '));
  console.log(`    sim time ${((Date.now() - T0) / 1000).toFixed(0)} s`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const human = () => sleep(170 + Math.floor(Math.random() * 160));
async function touch(cdp, x, y, hold) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(hold || 70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel, hold) {
  const bb = await page.locator(sel).first().boundingBox();
  if (!bb) throw new Error('not visible: ' + sel);
  await touch(cdp, bb.x + bb.width * (0.35 + Math.random() * 0.3), bb.y + bb.height * (0.35 + Math.random() * 0.3), hold);
}

async function bot() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('liarsdice:settings', JSON.stringify({ ais: 3, lvl: 1, mode: 'lives', special: true, start: 'players', peek: 'hold', hint: true, sound: true, vib: true })); } catch (e) {} });
  await page.goto('file://' + APP + '#seed=' + arg('--seed', 20261020));
  const cdp = await ctx.newCDPSession(page);
  await sleep(1200);
  await tapSel(cdp, page, '#sPlay');
  const st = () => page.evaluate(() => window.__ld.state());
  const t0 = Date.now(); let taps = 0, bids = 0, calls = 0, peeks = 0, lastTurnKey = '';
  for (let guard = 0; guard < 6000; guard++) {
    const s = await st();
    if (s.overVisible) break;
    if (s.phase === 'result') { await sleep(900); await human(); await tapSel(cdp, page, '#bNext'); taps++; await sleep(300); continue; }
    if (!s.myTurn) { await sleep(120); continue; }
    const key = s.round + ':' + (s.last ? s.last.q + 'x' + s.last.f : '-');
    if (key === lastTurnKey) { await sleep(120); continue; }
    // look under the cup first (hold), like a player would
    await human();
    await touch(cdp, s.cup.x, s.cup.y, 650 + Math.floor(Math.random() * 300)); peeks++;
    await human();
    const a = s.advice;
    if (a.act === 'call') {
      await tapSel(cdp, page, '#bCall', 650); taps++; calls++; lastTurnKey = key; await sleep(400); continue;
    }
    await tapSel(cdp, page, `.fb[data-f="${a.f}"]`); taps++; await human();
    for (let k = 0; k < 30; k++) {
      const s2 = await st(); if (s2.sel.q === a.q) break;
      await tapSel(cdp, page, s2.sel.q < a.q ? '#qp' : '#qm'); taps++; await human();
    }
    const s3 = await st();
    if (s3.sel.q !== a.q || s3.sel.f !== a.f) throw new Error('panel did not reach ' + JSON.stringify(a) + ' got ' + JSON.stringify(s3.sel));
    await tapSel(cdp, page, '#bBid'); taps++; bids++; lastTurnKey = key;
    await sleep(300);
    const s4 = await st(); if (s4.myTurn && s4.last && s4.last.q === s.last?.q && s4.last.f === s.last?.f) throw new Error('bid did not register');
  }
  await sleep(2600);
  const fin = await st();
  const endText = (await page.textContent('#ovEnd')).replace(/\s+/g, ' ').trim();
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const thinkMs = await page.evaluate(() => window.__ld.thinkMs.slice()), usedWorker = await page.evaluate(() => window.__ld.worker());
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  for (const f of fs.readdirSync(OUT)) if (/^game(-\dx)?\.mp4$/.test(f)) fs.rmSync(path.join(OUT, f));
  const mp4 = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-filter:v', 'setpts=PTS/4,fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  thinkMs.sort((a, b) => a - b);
  console.log(`BOT vs 3x 一般: ${fin.overVisible ? 'COMPLETED' : 'NOT COMPLETED'}  rounds ${fin.round}  result "${endText.slice(0, 60)}"  lives left ${JSON.stringify(fin.lives)}` +
    `  touch actions ${taps} (bids ${bids}, held 開！ ${calls}, cup peeks ${peeks})  play time ${secs}s  video game-4x.mp4 ${Math.round(fs.statSync(mp4).size / 1024)} KB`);
  console.log(`    page AI think (worker=${usedWorker}, round trip): median ${thinkMs[thinkMs.length >> 1]} ms, max ${thinkMs[thinkMs.length - 1]} ms over ${thinkMs.length} decisions;  ${errors.length ? 'ERRORS ' + errors.join(' | ') : 'no console errors'}`);
}

(async () => {
  if (!args.includes('--bot-only')) sim();
  if (!args.includes('--sim-only')) await bot();
})();
