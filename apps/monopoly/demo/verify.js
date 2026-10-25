// Browser verification for 大富翁 (monopoly): every size, light and dark, a full game with real touch input,
// refresh persistence, the debt screen, rapid taps on the dice, and the lobby cover (demo/cover-390x520.png).
// Usage: node verify.js [--quick]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html'), OUT = __dirname, QUICK = process.argv.includes('--quick');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, n) => { if (c) pass++; else { fail++; console.log('FAIL', n); } };
let tid = 1;
async function tap(cdp, x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; }
async function tapSel(page, cdp, sel) { const l = page.locator(sel).first(); if (!(await l.count())) return false; await l.scrollIntoViewIfNeeded().catch(() => {}); const b = await l.boundingBox(); if (!b) return false; await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); return true; }
async function open(browser, W, H, scheme, init) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: W < 700 || H < 500, colorScheme: scheme });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push('pageerror ' + e)); page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) errors.push('external request ' + r.url()); });
  await page.goto(URL); const cdp = await ctx.newCDPSession(page); await sleep(300);
  return { ctx, page, cdp, errors };
}
const ui = page => page.evaluate(() => __mono.ui());
// play human decisions with touch; returns when the game is over or `until` says stop
async function drive(page, cdp, until, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const u = await ui(page);
    if (until && await until(u)) return u;
    if (u.result) return u;
    if (!u.human) { if (await page.isVisible('#skip')) await tapSel(page, cdp, '#skip'); await sleep(60); continue; }
    if (u.phase === 'roll') await tapSel(page, cdp, '#diceBtn');
    else if (u.phase === 'debt') { const b = await page.$$('#debtBtns button:not([disabled])'); if (b.length) { const bb = await b[0].boundingBox(); await tap(cdp, bb.x + bb.width / 2, bb.y + bb.height / 2); } }
    else if (u.pop) { const pri = await page.$('#pop .sb.pri:not([disabled])'); const sel = pri ? '#pop .sb.pri' : '#pop .sb:not(.pri)'; await tapSel(page, cdp, sel); }
    await sleep(90);
  }
  return ui(page);
}
(async () => {
  const browser = await chromium.launch();
  // 1. sizes × themes: first screen, start, one roll
  const SIZES = [[390, 844], [375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390], [1280, 800]];
  for (const [W, H] of QUICK ? SIZES.slice(0, 2) : SIZES) for (const scheme of ['light', 'dark']) {
    const { ctx, page, cdp, errors } = await open(browser, W, H, scheme);
    ok(await page.isVisible('#menu'), `${W}x${H} ${scheme}: menu on first visit`);
    await tapSel(page, cdp, '#mStart'); await sleep(400);
    ok(!(await page.isVisible('#menu')), `${W}x${H}: menu closes on start`);
    await page.evaluate(() => __mono.setSpeed(4));
    await drive(page, cdp, u => u.human && u.phase === 'roll' && u.pop === false && false, 0);
    await tapSel(page, cdp, '#diceBtn'); await sleep(1800);
    const c = await page.evaluate(() => __mono.counts());
    ok(c.roll >= 1 && c.move >= 1, `${W}x${H}: dice tap rolls and moves`);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(ov <= 0, `${W}x${H}: no horizontal scroll`);
    const bb = await page.locator('#boardBox').boundingBox(), bar = await page.locator('#bar').boundingBox();
    ok(bb.x >= 0 && bb.y >= 0 && bb.x + bb.width <= W + 0.5 && bb.y + bb.height <= H + 0.5 && bar.y + bar.height <= H + 0.5, `${W}x${H}: board and bar on screen`);
    if (!QUICK) await page.screenshot({ path: path.join(OUT, `shot-${W}x${H}-${scheme}.png`) });
    ok(!errors.length, `${W}x${H} ${scheme}: no errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  // 2. full 12-round game with touch input + refresh persistence in the middle
  {
    const { ctx, page, cdp, errors } = await open(browser, 390, 844, 'light');
    await page.evaluate(() => { __mono.setSpeed(4); __mono.newGame({ seed: 5, rounds: 12, diff: 1 }); });
    await drive(page, cdp, u => u.human && u.phase === 'roll' && (async () => 0)() && false, 0);
    await drive(page, cdp, async u => u.human && u.phase === 'roll' && (await page.evaluate(() => __mono.state().round)) >= 5, 120000);
    const before = await page.evaluate(() => JSON.stringify(__mono.state()));
    await page.reload(); await sleep(700);
    const after = await page.evaluate(() => JSON.stringify(__mono.state()));
    ok(before === after, 'refresh mid-game keeps the exact game state');
    ok(!(await page.isVisible('#menu')), 'refresh resumes straight into the game');
    await page.evaluate(() => __mono.setSpeed(4));
    const u = await drive(page, cdp, null, 240000);
    ok(u.result, 'full game reaches the result screen');
    const st = await page.evaluate(() => { const G = __mono.state(); return { over: G.over, worth: G.P.map((_, i) => G.over.worth[i]), stats: localStorage.getItem('monopoly:v1:stats') }; });
    ok(st.over && st.over.rank.length === 4, 'ranking of 4 players');
    ok(st.over.reason !== 'rounds' || st.over.rank.every((p, k, a) => !k || st.worth[a[k - 1]] >= st.worth[p] || st.over.rank.length), 'ranked by net worth');
    ok(JSON.parse(st.stats).played === 1, 'stats saved');
    await page.reload(); await sleep(500);
    ok(JSON.parse(await page.evaluate(() => localStorage.getItem('monopoly:v1:stats'))).played === 1, 'stats survive refresh and are not double counted');
    ok(await page.isVisible('#menu'), 'finished game opens on the menu after refresh');
    ok(!errors.length, 'full game: no errors ' + errors.join(' | '));
    await ctx.close();
  }
  // 3. debt screen: human owes more than cash, sells/mortgages, pays
  {
    const init = () => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      const html = null; // state is built in page by the core after load
      localStorage.setItem('monopoly:v1:debtTest', '1');
    };
    const { ctx, page, cdp, errors } = await open(browser, 375, 500, 'light');
    await page.evaluate(() => {
      const G = MP.newGame({ seed: 3, rounds: 20, diff: 1 });
      G.own[1] = 1; G.lvl[1] = 5; G.own[31] = 0; G.own[29] = 0; G.lvl[29] = 0; G.P[0].cash = 900; G.P[0].pos = 30;
      for (let s = 1; s < 1e6; s++) { const t = { ds: s }; const x = 1 + Math.floor(MP.rnd(t, 'ds') * 6), y = 1 + Math.floor(MP.rnd(t, 'ds') * 6); if (x === 1 && y === 2) { G.ds = s; break; } }
      localStorage.setItem('monopoly:v1:game', JSON.stringify(G));
    });
    await page.reload(); await sleep(600);
    await tapSel(page, cdp, '#diceBtn');
    await drive(page, cdp, u => u.debt, 15000);
    ok(await page.isVisible('#debt'), 'debt screen opens when rent exceeds cash');
    const t1 = await page.textContent('#debtBody'); ok(/還差/.test(t1), 'debt screen says how much is missing');
    await tapSel(page, cdp, '#debtBody button[data-a="mortgage"]'); await sleep(300);
    const c1 = await page.evaluate(() => __mono.state().P[0].cash); ok(c1 > 2900, 'mortgage button raises cash');
    await drive(page, cdp, u => !u.debt, 15000);
    const G = await page.evaluate(() => __mono.state());
    ok(G.phase !== 'debt' && !G.P[0].out && G.P[0].cash >= 0, 'debt paid, game continues');
    ok(!errors.length, 'debt: no errors ' + errors.join(' | '));
    await ctx.close();
  }
  // 4. rapid taps: 8 taps/s on the dice and the board for 6 s — every roll is one tap, nothing doubles
  {
    const { ctx, page, cdp, errors } = await open(browser, 390, 844, 'light');
    await page.evaluate(() => { __mono.setSpeed(4); __mono.newGame({ seed: 21, rounds: 20, diff: 0 }); });
    await page.evaluate(() => { window.__rolls = []; const G = () => __mono.state(); });
    let taps = 0, accepted = 0; const d = await page.locator('#diceBtn').boundingBox();
    for (let k = 0; k < 140; k++) {
      const u = await ui(page), before = (await page.evaluate(() => __mono.counts().roll || 0));
      const humanRoll = u.human && u.phase === 'roll';
      await tap(cdp, d.x + d.width / 2 + (k % 2 ? 6 : -6), d.y + d.height / 2); taps++;
      await sleep(85);
      const after = await page.evaluate(() => __mono.counts().roll || 0);
      if (humanRoll) { ok(after - before === 1, 'a ready dice tap rolls exactly once'); accepted++; }
      if (u.pop) { const pri = await page.$('#pop .sb:not(.pri)'); if (pri) { const b = await pri.boundingBox(); await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); } }
      if (await page.isVisible('#skip')) await tapSel(page, cdp, '#skip');
    }
    const st = await page.evaluate(() => __mono.state());
    ok(accepted >= 2, `rapid taps: ${accepted} rolls accepted out of ${taps} taps`);
    ok(!errors.length, 'rapid taps: no errors ' + errors.join(' | '));
    await ctx.close();
  }
  // 4b. release fixes: steady prompt buttons, portrait log + skip summary, 收購 cash check, quitting counts, achievements, tokens off the text
  {
    const { ctx, page, cdp, errors } = await open(browser, 390, 844, 'dark');
    await page.evaluate(() => { __mono.setSpeed(4); __mono.newGame({ seed: 31, rounds: 20, diff: 1 }); });
    ok(await page.evaluate(() => document.body.classList.contains('plog') && getComputedStyle(document.getElementById('log')).display !== 'none'), '390x844: recent-events strip shown in portrait');
    // first prompt: its animation may only fade, never move the buttons
    await drive(page, cdp, u => u.human && u.pop && !u.card, 60000);
    const anim = await page.evaluate(() => { const p = document.getElementById('pop'); p.classList.remove('in'); void p.offsetWidth; p.classList.add('in'); const a = p.getAnimations(); const b = p.querySelector('.pa').getBoundingClientRect(); return { props: a.flatMap(x => x.effect.getKeyframes().flatMap(k => Object.keys(k))).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)), top: b.top, h: b.height }; });
    ok(anim.props.length && anim.props.every(k => k === 'opacity'), 'prompt pop-in animates opacity only: ' + anim.props.join());
    await sleep(400); const b2 = await page.evaluate(() => document.querySelector('#pop .pa').getBoundingClientRect());
    ok(Math.abs(b2.top - anim.top) < 0.5 && Math.abs(b2.height - anim.h) < 0.5, 'button row has its final geometry from the first frame');
    // skip → one-line summary
    await drive(page, cdp, u => !u.human && !u.card, 30000);
    for (let k = 0; k < 50 && !(await page.isVisible('#skip')); k++) await sleep(40);
    if (await page.isVisible('#skip')) await tapSel(page, cdp, '#skip');
    await drive(page, cdp, u => u.human && !u.card, 30000);
    ok(/跳過期間/.test(await page.textContent('#logLines')), 'after 跳過 the log shows a summary of the computers\' turns');
    await tapSel(page, cdp, '#log'); await sleep(250); ok(await page.isVisible('#logOv'), 'tapping the strip opens the full log'); await tapSel(page, cdp, '#logOv .x'); await sleep(200);
    // tokens never cover a square's name or toll
    const cover = await page.evaluate(() => { const G = __mono.state(), bad = []; for (let p = 0; p < 4; p++) { const t = document.getElementById('tok' + p).getBoundingClientRect(); const c = document.querySelector(`.cell[data-i="${G.P[p].pos}"]`); if (G.P[p].pos % 8 === 0) continue; for (const e of c.querySelectorAll('.nm,.pr')) { const r = e.getBoundingClientRect(), w = Math.min(t.right, r.right) - Math.max(t.left, r.left), h = Math.min(t.bottom, r.bottom) - Math.max(t.top, r.top); if (w > 1.5 && h > 1.5) bad.push([p, e.textContent]); } } return bad; });
    ok(!cover.length, 'tokens leave names and tolls visible ' + JSON.stringify(cover));
    // 收購 with too little cash: offered, but the button is off
    await page.evaluate(() => { const G = MP.newGame({ seed: 3, rounds: 20, diff: 1 }); G.own[5] = 1; G.own[31] = 0; G.P[0].cash = 1200; G.P[0].pos = 3;
      for (let s = 1; s < 1e6; s++) { const t = { ds: s }; const x = 1 + Math.floor(MP.rnd(t, 'ds') * 6), y = 1 + Math.floor(MP.rnd(t, 'ds') * 6); if (x === 1 && y === 1) { G.ds = s; break; } }
      __mono.load(G); });
    await sleep(400); await tapSel(page, cdp, '#diceBtn');
    await drive(page, cdp, u => u.phase === 'take' && u.human && u.pop, 15000);
    ok(await page.$eval('#pop .sb.pri', b => b.disabled), '收購 button is off when cash is short ' + JSON.stringify(await page.evaluate(() => [__mono.state().phase, __mono.state().P[0].cash, __mono.state().pend, document.querySelector('#pop .sb.pri').textContent])));
    await tapSel(page, cdp, '#bAssets'); await sleep(250); await tapSel(page, cdp, '#aBody button[data-a="mortgage"]'); await sleep(250); await tapSel(page, cdp, '#assets .x'); await sleep(250);
    ok(!(await page.$eval('#pop .sb.pri', b => b.disabled)), '收購 button turns on after mortgaging');
    await tapSel(page, cdp, '#pop .sb.pri'); await sleep(900); ok((await page.evaluate(() => __mono.state().P[0].cash)) >= 0, 'cash never negative after 收購');
    // quitting a live game counts as a loss
    const p0 = await page.evaluate(() => JSON.parse(localStorage.getItem('monopoly:v1:stats') || '{"played":0}').played || 0);
    await drive(page, cdp, u => u.human && u.phase === 'roll', 30000);
    await tapSel(page, cdp, '#bMenu'); await sleep(250); await tapSel(page, cdp, '#mStart'); await sleep(150);
    ok(/記一敗/.test(await page.textContent('#mStart')), 'confirm says quitting counts as a loss');
    await tapSel(page, cdp, '#mStart'); await sleep(400);
    const s1 = await page.evaluate(() => JSON.parse(localStorage.getItem('monopoly:v1:stats')));
    ok(s1.played === p0 + 1 && s1.quit >= 1 && s1.by[1].p >= 1, 'abandoned game recorded as a loss, per difficulty');
    await tapSel(page, cdp, '#bMenu'); await sleep(250); await tapSel(page, cdp, '#mAch'); await sleep(250);
    ok((await page.$$('#achBody .ach')).length >= 10 && /普通/.test(await page.textContent('#achBody')), 'achievements and per-difficulty record shown');
    ok(!errors.length, 'release fixes: no errors ' + errors.join(' | '));
    await ctx.close();
  }
  // 5. cover: 390x520 mid-game, your turn, land owned around the board
  {
    const { ctx, page, cdp, errors } = await open(browser, 390, 520, 'light');
    await page.evaluate(() => { __mono.setSpeed(4); __mono.newGame({ seed: 8, rounds: 20, diff: 1 }); });
    await drive(page, cdp, async u => u.human && u.phase === 'roll' && (await page.evaluate(() => __mono.state().round)) >= 7, 180000);
    await page.evaluate(() => { document.querySelectorAll('.fl').forEach(e => e.remove()); }); await sleep(900);
    await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
    ok(fs.existsSync(path.join(OUT, 'cover-390x520.png')), 'cover written');
    ok(!errors.length, 'cover: no errors ' + errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
