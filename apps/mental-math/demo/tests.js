// 粉筆心算：上架評分 toFix 的回歸測試（node tests.js，約 40 秒）
// 核心規則直接跑遊戲自己的 CORE；頁面測試用真實 CDP Input.dispatchTouchEvent，等待都看條件（畫面、遊戲狀態），不靠固定秒數。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 1. core rules (node) ----------
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {mulberry32,genProblem,genOptions,newGame,newGameAt,step,answer,simulFor,tierFor,negFor,curT,optsFor};')();
const evalText = t => Function('return (' + t.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/') + ')')();
{
  // difficulty wall at 6000 split up: tier 6 at 6000, 4 at once at 7500, negatives at 9000
  ok(C.tierFor(6000) === 6 && C.simulFor(6000) === 3 && C.simulFor(7499) === 3 && C.simulFor(7500) === 4 && !C.negFor(8999) && C.negFor(9000),
    'difficulty steps staggered: tier 6 @6000, 4 falling @7500, negatives @9000');
  const r = C.mulberry32(42); let bad = 0, negSeen = 0;
  for (let i = 0; i < 20000; i++) {
    const p = C.genProblem(6, r, false), o = C.genOptions(p, 4, r, false);
    if (p.ans < 0 || o.some(x => x < 0) || evalText(p.text) !== p.ans || o.filter(x => x === p.ans).length !== 1 || new Set(o).size !== 4) bad++;
    const q = C.genProblem(6, r, true); if (q.ans < 0) negSeen++;
  }
  ok(bad === 0 && negSeen > 2000, `tier 6 before 9000 has no negative answers/options (bad ${bad}); with negatives on ${negSeen}/20000 negative`);
}
{
  // sprint: a wrong answer costs 2 s and locks 0.8 s; mashing 4 keys at 8/s without reading scores below a fair player
  const g = C.newGame({ mode: 'sprint', seed: 3 });
  while (!g.cur) C.step(g, 1 / 60);
  const wi = g.cur.opts.findIndex(v => v !== g.cur.prob.ans), t0 = g.timeLeft;
  ok(C.answer(g, wi) === 'wrong' && Math.abs(g.timeLeft - (t0 - 2)) < 1e-9 && Math.abs(g.lock - 0.8) < 1e-9 && g.lives === 3, 'sprint wrong: -2 s, 0.8 s lock, no chalk');
  const play = (seed, fn) => { const g = C.newGame({ mode: 'sprint', seed }); let t = 0, n = 0; while (!g.over) { C.step(g, 1 / 60); t += 1 / 60; fn(g, t, n++); } return g; };
  const mash = [], fair = [];
  for (let s = 1; s <= 40; s++) {
    let next = 0, k = 0;
    mash.push(play(s, (g, t) => { if (t >= next && g.cur) { C.answer(g, k++ % g.cur.opts.length); next = t + 0.125; } }));
    const er = C.mulberry32(s * 7); let cur = -1, w = 0;
    fair.push(play(s, g => { if (g.cur && g.cur.id !== cur) { cur = g.cur.id; w = 1.2; } if (g.cur && (w -= 1 / 60) <= 0 && g.lock <= 0) { let i = g.cur.opts.indexOf(g.cur.prob.ans); if (er() < 0.05) i = (i + 1) % g.cur.opts.length; if (C.answer(g, i) === 'ok') cur = -1; else w = 0.4; } }));
  }
  const avg = a => a.reduce((x, g) => x + g.answered, 0) / a.length;
  ok(avg(mash) < 20 && avg(mash) < avg(fair) * 0.6, `sprint mash 8/s avg ${avg(mash).toFixed(1)} correct vs fair 1.2 s/problem player ${avg(fair).toFixed(1)}`);
  const mashAcc = mash.map(g => g.answered / (g.answered + g.wrongN)); ok(Math.max(...mashAcc) < 0.8, 'mashing never reaches the 80% accuracy the 閃電手 badge needs');
}
{
  // first 20 answers of classic: a wrong only breaks the combo; afterwards (and in hard mode) it costs a chalk
  const g = C.newGame({ mode: 'classic', seed: 9 });
  const cur = () => { while (!g.cur) C.step(g, 1 / 60); return g.cur; };
  for (let i = 0; i < 3; i++) { const c = cur(); g.lock = 0; C.answer(g, c.opts.findIndex(v => v !== c.prob.ans)); }
  ok(g.lives === 3 && !g.over && g.combo === 0, 'classic: 3 wrong answers in the first 20 cost no chalk');
  while (g.answered < 20) { const c = cur(); g.lock = 0; C.answer(g, c.opts.indexOf(c.prob.ans)); }
  const c = cur(); g.lock = 0; C.answer(g, c.opts.findIndex(v => v !== c.prob.ans));
  ok(g.lives === 2, 'classic: after 20 correct answers a wrong costs a chalk');
  const h = C.newGame({ mode: 'classic', hard: true, seed: 9 }); while (!h.cur) C.step(h, 1 / 60);
  C.answer(h, h.cur.opts.findIndex(v => v !== h.cur.prob.ans)); ok(h.lives === 2, 'hard mode: a wrong costs a chalk from the start');
}
{
  // falling behind: when one problem hits the bottom the others back up, so chalk goes one at a time (no 4-at-once wipe)
  const g = C.newGame({ mode: 'classic', seed: 5 }); g.score = 8000; g.answered = 200; let t = 0; const lost = [];
  while (!g.over && t < 120) { C.step(g, 1 / 60); t += 1 / 60; if (g.lives < 3 - lost.length) lost.push(t); }
  const gap = lost.length >= 3 ? lost[2] - lost[0] : 0;
  ok(gap > 1.5, `idle at 4 falling: 3 chalks lost over ${gap.toFixed(2)} s (not all at once)`);
}
{
  const g1 = C.newGameAt({ mode: 'classic', seed: 1 }), g4 = C.newGameAt({ mode: 'classic', seed: 1, start: 4 });
  ok(g1.tier === 1 && g4.tier === 4 && C.curT(g4) < C.curT(g1) && C.newGameAt({ mode: 'classic', seed: 1, start: 9 }).tier === 6, 'start at tier N: tier N and faster fall from the first problem');
}

// ---------- 2. page (real touch) ----------
const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(html); });
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL_ = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function open(w = 390, h = 844, ls = { tut: '1' }) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(o => { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', 1); localStorage.clear(); for (const k in o) localStorage.setItem('mentalmath.' + k, o[k]); } }, ls);
    await p.addInitScript(() => { window.__clicks = []; addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); window.__clicks.push(b ? (b.id || b.dataset.mode || b.className) : e.target.tagName); }); });
    await p.goto(URL_); await p.waitForFunction(() => window.__game && document.querySelector('[data-mode=classic]').getBoundingClientRect().height > 0);
    const cdp = await ctx.newCDPSession(p); const F = {};
    const send = type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: Object.entries(F).map(([id, q]) => ({ x: q.x, y: q.y, id: +id })) });
    const H = {
      down: async (id, x, y) => { F[id] = { x, y }; await send('touchStart'); },
      up: async id => { const q = F[id]; delete F[id]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: q.x, y: q.y, id: +id }] }); },
      tap: async (x, y, hold = 40, id = 5) => { await H.down(id, x, y); if (hold) await sleep(hold); await H.up(id); },
    };
    return { ctx, p, H };
  }
  const st = p => p.evaluate(() => window.__game.state());
  const vis = p => p.evaluate(() => ['menu', 'pause', 'result', 'settings', 'achv', 'help'].filter(i => !document.getElementById(i).hidden));
  const box = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right }; }, sel);
  const tapSel = async (o, sel, hold) => { const b = await box(o.p, sel); await o.H.tap(b.x, b.y, hold); };
  const waitCur = p => p.waitForFunction(() => { const s = window.__game.state(); return s.cur && s.lock <= 0; }, null, { timeout: 15000 }).then(() => st(p));
  const key = (p, i) => box(p, `#kg .k:nth-child(${i + 1})`);
  const settle = p => p.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const wrongKey = async o => { const s = await waitCur(o.p); const i = s.cur.opts.findIndex(v => v !== s.cur.ans); return { i, k: await key(o.p, i), s }; };
  // hard mode run ended by the 3rd wrong answer, held for `hold` ms
  async function endHard(o, hold) {
    await tapSel(o, '[data-mode=hard]'); await o.p.waitForFunction(() => window.__game.state().scene === 'play');
    for (let n = 0; n < 2; n++) { const { k } = await wrongKey(o); await o.H.tap(k.x, k.y); }
    const { k } = await wrongKey(o); await o.H.down(5, k.x, k.y);
    if (hold) { await o.p.waitForFunction(() => window.__game.state().over); await sleep(hold); }
    return k;
  }

  // 2a. ghost click at the end of a run: finger held 1.3 s / 2 s on the last answer, result must stay
  for (const [w, h, hold] of [[360, 640, 2000], [390, 844, 1300]]) {
    const o = await open(w, h);
    await endHard(o, hold);
    await o.p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 5000 });
    await o.p.evaluate(() => { window.__clicks = []; }); await o.H.up(5); await sleep(150); await settle(o.p);
    const s = await st(o.p), v = await vis(o.p), share = await o.p.evaluate(() => document.getElementById('rShareBox').innerHTML + document.getElementById('toast').style.opacity);
    ok(v.join() === 'result' && s.over && share === '0', `${w}x${h} hold ${hold} ms on the last answer: result stays, no new run / share (clicks ${JSON.stringify(await o.p.evaluate(() => window.__clicks))})`);
    if (w === 390 && hold === 1300) {
      // slow taps on fresh presses still work: 0.6 s on 分享, 1 s on 再來一局
      await tapSel(o, '#rShare', 600); await o.p.waitForFunction(() => document.getElementById('toast').style.opacity === '1' || document.querySelector('#rShareBox .sharebox'), null, { timeout: 3000 }).catch(() => {});
      ok(await o.p.evaluate(() => document.getElementById('toast').style.opacity === '1' || !!document.querySelector('#rShareBox .sharebox')), 'result: 0.6 s press on 分享成績 works');
      await tapSel(o, '#rAgain', 1000); await settle(o.p);
      ok((await st(o.p)).scene === 'play' && !(await st(o.p)).over, 'result: 1 s press on 再來一局 starts a new run');
    }
    await o.ctx.close();
  }
  // 2b. another finger resting on the board while the run ends: a fresh tap with a second finger still works
  {
    const o = await open();
    await tapSel(o, '[data-mode=hard]'); await o.p.waitForFunction(() => window.__game.state().scene === 'play');
    await o.H.down(7, 200, 200); // resting finger on the blackboard
    for (let n = 0; n < 3; n++) { const { k } = await wrongKey(o); await o.H.tap(k.x, k.y, 40, 5); }
    await o.p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 5000 });
    await settle(o.p); const m = await box(o.p, '#rMenu'); await o.H.tap(m.x, m.y, 600, 6); await settle(o.p);
    ok((await vis(o.p)).join() === 'menu', 'finger resting since the run: 0.6 s tap with a 2nd finger on 回選單 works');
    await o.H.up(7); await settle(o.p); await sleep(100);
    ok((await vis(o.p)).join() === 'menu' && (await st(o.p)).scene === 'menu', 'releasing the resting finger afterwards clicks nothing');
    // menu buttons: single / 0.6 s / 1 s presses open settings and help and close them again
    for (const hold of [40, 600, 1000]) {
      await tapSel(o, '#bSet', hold); await settle(o.p); const a = (await vis(o.p)).join();
      await tapSel(o, '#sOk', hold); await settle(o.p); const b = (await vis(o.p)).join();
      await tapSel(o, '#bHelp', hold); await settle(o.p); const c = (await vis(o.p)).join();
      await tapSel(o, '#hOk', hold); await settle(o.p); const d = (await vis(o.p)).join();
      ok(a === 'menu,settings' && b === 'menu' && c === 'menu,help' && d === 'menu', `menu ${hold} ms presses: settings ${a} → ${b}, help ${c} → ${d}`);
    }
    await o.ctx.close();
  }
  // 2c. sprint: timer runs out while a finger is held 2 s on a key → result stays
  {
    const o = await open();
    await tapSel(o, '[data-mode=sprint]'); await o.p.waitForFunction(() => window.__game.state().scene === 'play');
    await o.p.evaluate(() => { G.timeLeft = 1.2; });
    const k = await key(o.p, 0); await o.p.waitForFunction(() => G.timeLeft < 0.3);
    await o.H.down(5, k.x, k.y); await o.p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 5000 }); await sleep(900);
    await o.H.up(5); await sleep(150); await settle(o.p);
    ok((await vis(o.p)).join() === 'result' && (await st(o.p)).over, 'sprint: finger held through 時間到 does not hit the result buttons');
    await o.ctx.close();
  }
  // 2d. corrupt storage → defaults, no errors, playable; old saved keys still load
  {
    const o = await open();
    for (const [k, v] of [['best', 'null'], ['best', '[1,2]'], ['ach', 'null'], ['stats', 'null'], ['stats', '"x"'], ['settings', 'null'], ['settings', '{"theme":5,"sound":"y","start":"z"}'], ['best', '{not json'], ['reach', '"q"']]) {
      await o.p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem('mentalmath.tut', '1'); localStorage.setItem('mentalmath.' + k, v); }, [k, v]);
      const n = errors.length; await o.p.reload(); await o.p.waitForFunction(() => window.__game && document.querySelector('[data-mode=classic]').getBoundingClientRect().height > 0); await settle(o.p);
      const menu = await o.p.evaluate(() => document.getElementById('bC').textContent + '|' + document.documentElement.dataset.theme);
      await tapSel(o, '[data-mode=sprint]'); await o.p.waitForFunction(() => window.__game.state().scene === 'play', null, { timeout: 3000 }).catch(() => {}); await settle(o.p);
      ok(errors.length === n && /^最高分 0\|(dark|light)$/.test(menu) && (await st(o.p)).scene === 'play', `corrupt mentalmath.${k}=${v}: defaults (${menu}), playable, no errors`);
    }
    await o.ctx.close();
  }
  {
    const d = new Date(), td = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const o = await open(390, 844, { tut: '1', best: JSON.stringify({ classic: 1234, sprint: 31, daily: { d: td, s: 50 } }), stats: JSON.stringify({ games: 4, correct: 90, wrong: 3, miss: 5, rs: 80, rn: 90 }), ach: JSON.stringify({ c20: 1 }), settings: JSON.stringify({ theme: 'light', sound: false, vib: true, assist: false }) });
    const t = await o.p.evaluate(() => [document.getElementById('bC').textContent, document.getElementById('bS').textContent, document.getElementById('bD').textContent, document.getElementById('achN').textContent, document.documentElement.dataset.theme].join('|'));
    ok(t === '最高分 1234|最佳 31 題|今日 50 分．首局 50|1/12|light', 'old saved data loads: ' + t);
    await o.ctx.close();
  }
  // 2e. live saving: stats and best are written during the run, wrong answers show the right one
  {
    const o = await open();
    await tapSel(o, '[data-mode=classic]'); await o.p.waitForFunction(() => window.__game.state().scene === 'play');
    for (let n = 0; n < 2; n++) { const s = await waitCur(o.p); const k = await key(o.p, s.cur.opts.indexOf(s.cur.ans)); await o.H.tap(k.x, k.y); await o.p.waitForFunction(m => window.__game.state().answered > m, n); }
    const { i, s } = await wrongKey(o); const ai = s.cur.opts.indexOf(s.cur.ans);
    const kk = await key(o.p, i); await o.H.tap(kk.x, kk.y); await o.p.waitForFunction(() => document.querySelector('.k.ans'));
    const shown = await o.p.evaluate(() => [...document.querySelectorAll('#kg .k')].findIndex(b => b.classList.contains('ans')));
    ok(shown === ai, 'wrong answer: the correct key is outlined');
    const ls = await o.p.evaluate(() => [JSON.parse(localStorage.getItem('mentalmath.stats')), JSON.parse(localStorage.getItem('mentalmath.best'))]);
    ok(ls[0].correct === 2 && ls[0].wrong === 1 && ls[0].games === 1 && ls[1].classic > 0 && (await st(o.p)).lives === 3, `mid-run: stats ${JSON.stringify(ls[0])}, best ${JSON.stringify(ls[1])}, lives 3 (first 20 free)`);
    // answer pitch is capped: combo 400 → no oscillator range warning
    const n = errors.length; await o.p.evaluate(() => { G.combo = 400; });
    const s2 = await waitCur(o.p); const k2 = await key(o.p, s2.cur.opts.indexOf(s2.cur.ans)); await o.H.tap(k2.x, k2.y); await o.p.waitForFunction(() => window.__game.state().answered >= 3); await sleep(150);
    ok(errors.length === n, 'combo 400 correct answer: no audio range warning');
    await o.ctx.close();
  }
  // 2f. start tier: reached tier 4 → 起點 button cycles 1..4, classic starts at the chosen tier
  {
    const o = await open(390, 844, { tut: '1', reach: '4' });
    ok(!(await o.p.evaluate(() => document.getElementById('bStart').hidden)), '起點 button shown after reaching tier 2+');
    await tapSel(o, '#bStart'); await tapSel(o, '#bStart'); await settle(o.p);
    ok(await o.p.evaluate(() => document.getElementById('bStartN').textContent) === '第 3 節', 'tapping 起點 twice → 第 3 節');
    await tapSel(o, '[data-mode=classic]'); await settle(o.p);
    ok((await st(o.p)).tier === 3, 'classic starts at tier 3');
    await o.ctx.close();
    const o2 = await open(); ok(await o2.p.evaluate(() => document.getElementById('bStart').hidden), 'no 起點 button before reaching tier 2'); await o2.ctx.close();
  }
  // 2g. layout: tap targets ≥44, landscape menu/result fit the first screen, 375x500 achievements close button visible
  {
    const o = await open(); await tapSel(o, '#bSet'); await settle(o.p);
    const seg = await box(o.p, '#thSeg button'); ok(seg.h >= 44 && seg.w >= 44, `settings theme buttons ${seg.w.toFixed(0)}x${seg.h.toFixed(0)}`);
    await o.ctx.close();
  }
  const inView = (o, sels) => o.p.evaluate(s => s.map(q => { const e = document.querySelector(q), b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 0.5 && b.left >= 0 && b.right <= innerWidth + 0.5 && b.height >= 44 ? '' : q + ' ' + Math.round(b.top) + '-' + Math.round(b.bottom); }).filter(Boolean), sels);
  for (const [w, h] of [[844, 390], [667, 375], [375, 500], [360, 640]]) {
    const o = await open(w, h, { tut: '1', reach: '3' });
    await settle(o.p);
    let bad = await inView(o, ['[data-mode=classic]', '#bStart', '[data-mode=sprint]', '[data-mode=daily]', '[data-mode=mul]', '[data-mode=div]', '[data-mode=hard]', '#bHelp', '#bAch', '#bSet']);
    await tapSel(o, '#bAch'); await settle(o.p); bad = bad.concat(await inView(o, ['#aOk'])); await tapSel(o, '#aOk');
    await tapSel(o, '#bHelp'); await settle(o.p); bad = bad.concat(await inView(o, ['#hOk'])); await tapSel(o, '#hOk');
    if (w > h) { await tapSel(o, '#bSet'); await settle(o.p); bad = bad.concat(await inView(o, ['#sOk', '#sTut'])); await tapSel(o, '#sOk'); }
    await endHard(o, 0); await o.H.up(5);
    await o.p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 5000 }); await sleep(400);
    bad = bad.concat(await inView(o, ['#rAgain', '#rShare', '#rMenu']));
    ok(!bad.length, `${w}x${h}: menu, achievements, help${w > h ? ', settings' : ''} and result buttons on the first screen ${bad.join(', ')}`);
    await o.ctx.close();
  }
  // 2h. daily: menu and result show the first-run score
  {
    const o = await open();
    await tapSel(o, '[data-mode=daily]'); await o.p.waitForFunction(() => window.__game.state().scene === 'play');
    const s = await waitCur(o.p); const k = await key(o.p, s.cur.opts.indexOf(s.cur.ans)); await o.H.tap(k.x, k.y); await o.p.waitForFunction(() => window.__game.state().score > 0);
    await o.p.evaluate(() => { G.lives = 1; G.answered = 25; });
    const w = await wrongKey(o); await o.H.tap(w.k.x, w.k.y);
    await o.p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 5000 });
    const first = await o.p.evaluate(() => document.getElementById('rDay').textContent);
    await tapSel(o, '#rMenu'); await settle(o.p);
    const lab = await o.p.evaluate(() => document.getElementById('bD').textContent);
    ok(first === '這是今日首局成績' && /^今日 \d+ 分．首局 \d+$/.test(lab), `daily first run noted: "${first}", menu "${lab}" ${(await vis(o.p)).join()} ${await o.p.evaluate(() => localStorage.getItem('mentalmath.best'))}`);
    await o.ctx.close();
  }
  ok(!errors.length, 'no page/console errors or warnings ' + errors.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log(fails ? `FAIL ${fails} check(s) failed` : 'all mental-math checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
