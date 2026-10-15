// Verify score-board: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const mk = async (o = {}) => {
    const vp = o.viewport || { width: 390, height: 844 };
    const ctx = await browser.newContext({ viewport: vp, isMobile: o.mobile !== false, hasTouch: o.mobile !== false, deviceScaleFactor: 2, colorScheme: o.dark ? 'dark' : 'light', reducedMotion: o.reduce ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage(); const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(200);
    ok(await page.evaluate(() => innerWidth) === vp.width, `innerWidth == ${vp.width}`);
    return { ctx, page, errors };
  };
  ok(!fs.readFileSync(SRC, 'utf8').includes('�'), 'no U+FFFD in source');
  const checks = async (page, name) => {
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.documentElement.scrollHeight, innerHeight]);
    ok(sw[0] <= sw[1] && sw[2] <= sw[3], `${name} no page scroll (${sw.join(',')})`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input:not([type=checkbox])')].filter(e => e.offsetParent && !e.closest('.scrim[hidden]')).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, w: Math.round(r.width), h: Math.round(r.height) }; }).filter(r => r.w < 44 || r.h < 44));
    ok(small.length === 0, `${name} touch targets >= 44px ${JSON.stringify(small.slice(0, 5))}`);
    const wrap = await page.evaluate(() => [...document.querySelectorAll('.score')].every(s => { const r = document.createRange(); r.selectNodeContents(s); const b = r.getBoundingClientRect(), pb = s.parentElement.getBoundingClientRect(); return b.height < parseFloat(getComputedStyle(s).fontSize) * 1.6 && b.left >= pb.left - 1 && b.right <= pb.right + 1; }));
    ok(wrap, `${name} scores fit on one line`);
  };

  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 } },
    { name: '360x780', viewport: { width: 360, height: 780 } },
    { name: '844x390', viewport: { width: 844, height: 390 } },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, dark: true },
    { name: '1280x800', viewport: { width: 1280, height: 800 }, mobile: false },
  ];
  for (const s of sizes) {
    const { ctx, page, errors } = await mk(s);
    await page.evaluate(() => { for (let i = 0; i < 18; i++) window.__sb.apply(0, 1, false); for (let i = 0; i < 15; i++) window.__sb.apply(1, 1, false); });
    await page.waitForTimeout(250);
    await checks(page, s.name);
    // upper team rotated in portrait only
    const rot = await page.evaluate(() => document.querySelector('.team').classList.contains('rot'));
    ok(rot === (s.viewport.height > s.viewport.width), `${s.name} rotate 180 on top team only in portrait (${rot})`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844' || s.name === '844x390') {
      // multi-player mode via settings UI
      await page.click('#menu-btn'); await page.click('#m-settings'); await page.selectOption('#s-count', '5');
      await page.fill('#pn-2', '小綠綠綠'); await page.fill('#pi-0', '25000'); await page.fill('#pi-1', '25000'); await page.fill('#pi-2', '25000'); await page.fill('#pi-3', '25000'); await page.fill('#pi-4', '-999999');
      if (s.name === '390x844') await page.screenshot({ path: `${OUT}/${s.name}-settings.png` });
      await page.click('#s-save'); await page.waitForTimeout(300);
      await page.click('#p0-plus'); await page.click('#p3-minus');
      await checks(page, s.name + '-multi');
      await page.screenshot({ path: `${OUT}/${s.name}-multi.png` });
    }
    ok(errors.length === 0, `${s.name} no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  {
    const { ctx, page, errors } = await mk({ reduce: true });
    // rule logic
    const w = await page.evaluate(() => { const W = window.__sb.winner; return {
      b2020: W([20, 20], 'badminton'), b2120: W([21, 20], 'badminton'), b2220: W([22, 20], 'badminton'), b2119: W([21, 19], 'badminton'),
      b2929: W([29, 29], 'badminton'), b3029: W([30, 29], 'badminton'), b2928: W([29, 28], 'badminton'),
      t1110: W([11, 10], 'tt'), t1210: W([12, 10], 'tt'), v2524: W([25, 24], 'volley'), v2725: W([25, 27], 'volley'),
      tg: W([10, 33, 32], 'target', 32), tg2: W([10, 31, 2], 'target', 32), free: W([100, 0], 'free') }; });
    ok(w.b2020 === -1 && w.b2120 === -1 && w.b2220 === 0 && w.b2119 === 0, `badminton 20:20 needs +2 (21:20 none, 22:20 win, 21:19 win)`);
    ok(w.b2929 === -1 && w.b3029 === 0 && w.b2928 === -1, `badminton 29:29 next point wins (30:29 -> win, 29:28 none)`);
    ok(w.t1110 === -1 && w.t1210 === 0 && w.v2524 === -1 && w.v2725 === 1, 'table tennis / volleyball by-2 rules');
    ok(w.tg === 1 && w.tg2 === -1 && w.free === -1, 'target & free rules');

    // tap halves: top half +1, bottom half -1 (top team rotated)
    const box = await (await page.$('.team[data-p="1"]')).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.25);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.25);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.75);
    let sc = await page.evaluate(() => window.__sb.st.players.map(p => p.score));
    let lg = await page.evaluate(() => window.__sb.st.log.length);
    ok(sc[1] === 1 && lg === 1, `bottom team: +1 +1 -1 within 1.5s -> score ${sc[1]}, merged into ${lg} record`);
    // rotated top team: its visual bottom half is its "+"
    const b0 = await (await page.$('.team[data-p="0"]')).boundingBox();
    await page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height * 0.8);
    sc = await page.evaluate(() => window.__sb.st.players.map(p => p.score));
    ok(sc[0] === 1, `rotated top team: tapping its (upside-down) upper half adds -> ${sc[0]}`);
    // merge: 3 quick +1 then undo once removes all 3
    await page.click('#step-1');
    for (let i = 0; i < 3; i++) await page.click('#p1-plus', { force: true });
    sc = await page.evaluate(() => window.__sb.st.players[1].score);
    await page.click('#undo');
    const after = await page.evaluate(() => window.__sb.st.players[1].score);
    ok(sc === 4 && after === 1, `+1+1+1 merged: ${sc} -> undo -> ${after}`);
    await page.click('#redo');
    ok(await page.evaluate(() => window.__sb.st.players[1].score) === 4, 'redo restores merged +3');
    // 50 undo
    const r50 = await page.evaluate(() => {
      const S = window.__sb; const before = S.st.players.map(p => p.score).join();
      const seq = [];
      for (let i = 0; i < 50; i++) { const p = i % 2, d = (i % 7) - 3 || 2; S.apply(p, d, false); seq.push(d); if (i === 25) S.nextRound(); }
      const mid = S.st.players.map(p => p.score).join();
      for (let i = 0; i < 51; i++) S.undo();
      const back = S.st.players.map(p => p.score).join();
      for (let i = 0; i < 51; i++) S.redo();
      return { before, back, mid, again: S.st.players.map(p => p.score).join(), round: S.st.round, redoLen: S.st.redo.length };
    });
    ok(r50.back === r50.before && r50.again === r50.mid && r50.round === 2, `50 ops + round switch: undo all -> ${r50.back}, redo all -> ${r50.again} (round ${r50.round})`);
    ok(await page.evaluate(() => { window.__sb.apply(0, 1, false); return window.__sb.st.redo.length; }) === 0, 'new op clears redo stack');
    // swipe: up 72px = +3 on bottom team
    await page.evaluate(() => { const s = window.__sb.st; s.players.forEach(p => p.score = 0); s.log = []; });
    const bb = await (await page.$('.team[data-p="1"]')).boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const x = bb.x + bb.width / 2, y0 = bb.y + bb.height * 0.7;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - k * 10 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    sc = await page.evaluate(() => window.__sb.st.players[1].score);
    ok(sc === 3, `swipe up 80px on team = +3 (24px per point) -> ${sc}`);

    // numeric input validation
    await page.click('#input-btn'); await page.selectOption('#num-player', '0'); await page.fill('#num-value', 'abc'); await page.click('#num-ok');
    ok(/整數/.test(await page.textContent('#num-err')), 'non-numeric rejected');
    await page.fill('#num-value', '9999999'); await page.click('#num-ok');
    ok(/超出範圍/.test(await page.textContent('#num-err')), 'out of range rejected');
    await page.fill('#num-value', '-7'); await page.click('#num-ok');
    ok(await page.evaluate(() => window.__sb.st.players[0].score) === -7, 'input -7 applied');
    // clamp via api
    await page.evaluate(() => window.__sb.apply(0, 5000000, false));
    ok(await page.evaluate(() => window.__sb.st.players[0].score) === 999999, 'score clamped to 999999');

    // badminton flow through UI: settings -> badminton, play to 29:29 then win at 30
    await page.click('#menu-btn'); await page.click('#m-settings'); await page.selectOption('#s-rule', 'badminton'); await page.click('#s-save');
    await page.evaluate(() => { const S = window.__sb; S.st.players.forEach(p => p.score = 0); S.st.log = []; for (let i = 0; i < 20; i++) { S.apply(0, 1, false); S.apply(1, 1, false); } });
    await page.waitForTimeout(100);
    ok(await page.isHidden('#win'), '20:20 no winner yet');
    await page.evaluate(() => { const S = window.__sb; S.apply(0, 1, false); S.apply(1, 1, false); for (let i = 0; i < 8; i++) { S.apply(0, 1, false); S.apply(1, 1, false); } });
    ok(await page.isHidden('#win') && (await page.evaluate(() => window.__sb.st.players.map(p => p.score).join(':'))) === '29:29', '29:29 still no winner');
    await page.click('#p1-plus', { force: true });
    await page.waitForTimeout(100);
    ok(!(await page.isHidden('#win')) && (await page.textContent('#win-score')) === '29 : 30', `30:29 -> win overlay "${await page.textContent('#win-name')}" ${await page.textContent('#win-score')}`);
    await page.screenshot({ path: `${OUT}/390x844-win.png` });
    await page.click('#win-next');
    ok((await page.evaluate(() => window.__sb.st.sets.join(':'))) === '0:1' && (await page.evaluate(() => window.__sb.st.players.map(p => p.score).join(':'))) === '0:0', 'next set: set score 0:1, scores reset');
    // serve indicator follows last scorer
    await page.click('#p0-plus', { force: true });
    ok(await page.evaluate(() => !document.querySelector('.team[data-p="0"] .serve').hidden), 'serve dot on last scorer');

    // persistence
    await page.waitForTimeout(400); await page.reload(); await page.waitForTimeout(200);
    ok((await page.evaluate(() => window.__sb.st.sets.join(':') + '/' + window.__sb.st.players[0].score)) === '0:1/1', 'state survives reload');
    // rounds + CSV
    await page.click('#menu-btn'); await page.click('#m-settings'); await page.selectOption('#s-rule', 'free'); await page.check('#s-rounds'); await page.click('#s-save');
    await page.evaluate(() => { const S = window.__sb; S.apply(0, 3, false); S.nextRound(); S.apply(1, 5, false); S.apply(0, -1, false); });
    const csv = await page.evaluate(() => window.__sb.resultCSV());
    ok(csv.split('\n').length === 4 && /^2,-1,5$/m.test(csv), `round matrix CSV:\n${csv}`);
    ok(/藍隊 3｜橘隊 5/.test(await page.evaluate(() => window.__sb.resultText())), 'result text format');
    await page.click('#menu-btn'); await page.click('#m-log'); await page.waitForTimeout(100);
    await page.screenshot({ path: `${OUT}/390x844-log.png` });
    await page.click('#log .x');
    // lock
    await page.click('#menu-btn'); await page.click('#m-lock');
    const s0 = await page.evaluate(() => window.__sb.st.players[0].score);
    await page.click('#p0-plus', { force: true });
    ok(await page.evaluate(() => window.__sb.st.players[0].score) === s0, 'locked: taps ignored');
    const ub = await (await page.$('#unlock')).boundingBox();
    await page.mouse.move(ub.x + 10, ub.y + 10); await page.mouse.down(); await page.waitForTimeout(1150); await page.mouse.up();
    ok(await page.evaluate(() => !window.__sb.st.locked), 'long-press 1s unlocks');
    // keyboard
    await page.keyboard.press('q'); await page.keyboard.press('Control+z');
    ok(await page.evaluate(() => window.__sb.st.players[0].score) === s0, 'Q then Ctrl+Z');
    ok(errors.length === 0, `flow no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
