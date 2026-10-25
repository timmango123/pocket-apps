// Playwright verification for 成語猜字 (idiom-guess): loads the page at 390×844 and the three in-lobby iframe sizes, light and dark,
// asserts no page errors, plays level 1 to a win with touch taps, loses a free-play round, buys a hint, checks saved progress,
// and writes demo/cover-390x520.png (mid-game, sample content). Usage: node verify.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

async function tap(page, sel) { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('no element ' + sel); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
async function tapChar(page, c) { await tap(page, `#tray .key[data-c="${c}"]`); }

async function session(browser, vp, dark, full) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(APP); await sleep(400);
  const tag = `${vp.width}x${vp.height} ${dark ? 'dark' : 'light'}`;
  ok(await page.locator('#title').isVisible(), tag + ' title visible');
  ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, tag + ' no horizontal overflow');
  // level select → level 1
  await tap(page, '#tLevels'); await sleep(250);
  ok(await page.locator('#select').isVisible(), tag + ' level select opens');
  ok((await page.locator('#grid .lt').count()) === 100, tag + ' 100 level tiles');
  await tap(page, '#grid .lt.cur'); await sleep(250);
  let st = await page.evaluate(() => window.__ig.get());
  ok(st.mode === 'level' && st.level === 1 && st.tray.length === 8, tag + ' level 1 started with 8 keys');
  if (full) { await sleep(500); ok(await page.locator('#toast').isVisible() && (await page.locator('#toast').textContent()).includes('字牌'), tag + ' first game shows the onboarding tip');
    ok(await page.evaluate(() => { const t = document.getElementById('toast').getBoundingClientRect(), r = document.querySelector('#board .row.cur').getBoundingClientRect(), c = document.getElementById('clue').getBoundingClientRect(); return t.top >= r.bottom && t.bottom <= c.top; }), tag + ' tip sits between the current row and the meaning bar'); }
  // tiles & keys fit the viewport
  const fits = await page.evaluate(() => [...document.querySelectorAll('#board .tile, #tray .key, #actions .abtn, .hud .ibtn')].every(e => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 0.5 && b.top >= 0 && b.bottom <= innerHeight + 0.5; }));
  ok(fits, tag + ' board, tray and buttons inside the viewport');
  const th = await page.evaluate(() => document.querySelector('#board .tile').getBoundingClientRect().height);
  ok(th >= 26, tag + ' tiles at least 26px (' + Math.round(th) + ')');
  // a wrong guess: pick the answer with the last two swapped → 2 hits, 2 near
  const a = st.answer, wrong = a[0] + a[1] + a[3] + a[2];
  for (const c of wrong) await tapChar(page, c);
  await tap(page, '#bGo'); await sleep(1400);
  st = await page.evaluate(() => window.__ig.get());
  ok(st.guesses.length === 1 && st.results[0].join('') === 'hhnn', tag + ' feedback hhnn after swapped guess');
  // delete works, then the right answer
  await tapChar(page, a[0]); await tap(page, '#bDel');
  st = await page.evaluate(() => window.__ig.get());
  ok(st.cur.join('') === '', tag + ' delete clears the slot');
  for (const c of a) await tapChar(page, c);
  await tap(page, '#bGo'); await sleep(1700);
  ok(await page.locator('#win').isVisible(), tag + ' win overlay shown');
  ok((await page.locator('#wMean').textContent()).length > 3, tag + ' meaning shown after the round');
  const prog = await page.evaluate(() => window.__ig.prog());
  ok(prog.levels[1] === 3 && prog.coins > 80, tag + ' progress saved: 3 stars, coins earned (' + prog.coins + ')');
  ok(errors.length === 0, tag + ' no page errors: ' + errors.join(' | '));
  if (!full) {
    // every size: the unlock-all switch in the level-select header opens every level, and a far tile opens its level
    await tap(page, '#wMenu'); await sleep(250); await tap(page, '#tLevels'); await sleep(300);
    await tap(page, '#unlockSw'); await sleep(250);
    ok((await page.locator('#unlockSw').getAttribute('aria-checked')) === 'true' && (await page.locator('#grid .lt:disabled').count()) === 0, tag + ' unlock-all enables every tile');
    await page.locator('#grid .lt:nth-child(100)').tap(); await sleep(300);
    st = await page.evaluate(() => window.__ig.get());
    ok(st.mode === 'level' && st.level === 100 && st.tray.length === 21 && (await page.locator('#board .row').count()) === 4, tag + ' tile 100 opens level 100 (21 keys, 4 rows)');
    const fits2 = await page.evaluate(() => [...document.querySelectorAll('#board .tile, #tray .key, #actions .abtn, .hud .ibtn, #clue')].every(e => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 0.5 && b.top >= 0 && b.bottom <= innerHeight + 0.5; }));
    ok(fits2, tag + ' level 100 (14 keys) fits the viewport');
    ok(await page.evaluate(() => document.getElementById('clue').getBoundingClientRect().height >= 44), tag + ' meaning bar is a 44px tap target');
    // tapping the meaning bar buys the meaning
    const c0 = st.coins; await tap(page, '#clue'); await sleep(200);
    st = await page.evaluate(() => window.__ig.get());
    ok(st.clue && st.coins === c0 - 10, tag + ' tapping the meaning bar shows the meaning for 10');
    // the same four characters cannot be submitted twice
    const w4 = st.tray.filter(c => st.answer.indexOf(c) < 0).slice(0, 4);
    for (let r = 0; r < 2; r++) { for (const c of w4) await tapChar(page, c); await tap(page, '#bGo'); await sleep(r ? 300 : 1300); }
    st = await page.evaluate(() => window.__ig.get());
    ok(st.guesses.length === 1 && (await page.locator('#toast').textContent()).includes('猜過'), tag + ' repeated guess is refused with a note');
    for (let i = 0; i < 4; i++) { await tap(page, '#bDel'); await sleep(40); }
    // leaving with the back button keeps the round: the tile shows a dot and reopening it continues
    await tap(page, '#bBack'); await sleep(300);
    ok((await page.locator('#grid .lt:nth-child(100).wip').count()) === 1, tag + ' level in progress is marked in the grid');
    await page.locator('#grid .lt:nth-child(100)').tap(); await sleep(300);
    st = await page.evaluate(() => window.__ig.get());
    ok(st.level === 100 && st.guesses.length === 1 && st.clue, tag + ' reopening the level resumes the round');
    // lose level 100 (4 guesses): the retry brings another rare idiom, not the answer just shown
    const ans0 = st.answer, nn = st.tray.filter(c => ans0.indexOf(c) < 0);
    for (let g = 1; g < 4; g++) { for (const c of nn.slice(g * 4, g * 4 + 4)) await tapChar(page, c); await tap(page, '#bGo'); await sleep(g < 3 ? 1300 : 1900); }
    ok(await page.locator('#lose').isVisible() && (await page.locator('#lMsg').textContent()).includes('四次'), tag + ' level 100 lost after four guesses');
    await tap(page, '#lRetry'); await sleep(300);
    st = await page.evaluate(() => window.__ig.get());
    ok(st.level === 100 && st.guesses.length === 0 && st.answer !== ans0 && st.tray.length === 21, tag + ' retry after a loss uses another idiom');
    await tap(page, '#bBack'); await sleep(250); await tap(page, '#unlockSw'); await sleep(200);
    ok(await page.locator('#grid .lt:nth-child(50)').isDisabled(), tag + ' switching off re-locks level 50');
    ok(errors.length === 0, tag + ' no page errors after unlock flow: ' + errors.join(' | '));
    await ctx.close(); return;
  }
  // next level: buy a reveal hint, then lose a free-play round
  await tap(page, '#wNext'); await sleep(250);
  st = await page.evaluate(() => window.__ig.get());
  ok(st.level === 2 && st.guesses.length === 0, tag + ' next level starts');
  const coins0 = st.coins;
  await tap(page, '#bHint'); await sleep(200); await tap(page, '#h3'); await sleep(200);
  st = await page.evaluate(() => window.__ig.get());
  ok(st.coins === coins0 - 25 && st.cur.filter(Boolean).length === 1 && st.answer.indexOf(st.cur.filter(Boolean)[0]) >= 0, tag + ' reveal hint costs 25 and locks a correct character');
  await tap(page, '#bBack'); await sleep(200); await tap(page, '#sBack'); await sleep(200);
  await tap(page, '#tFree'); await sleep(250);
  st = await page.evaluate(() => window.__ig.get());
  ok(st.mode === 'free' && st.tray.length === 12, tag + ' free play with 12 keys');
  await page.evaluate(() => { document.documentElement.style.setProperty('--x', '1'); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let g = 0; g < 6; g++) {
    st = await page.evaluate(() => window.__ig.get());
    const nn = st.tray.filter(c => st.answer.indexOf(c) < 0), not = [0, 1, 2, 3].map(k => nn[(g + k) % nn.length]);
    await page.evaluate(ws => { ws.forEach(c => window.__ig.tap(c)); window.__ig.submit(); }, not);
    await sleep(1300);
  }
  ok(await page.locator('#lose').isVisible(), tag + ' lose overlay after six misses');
  ok((await page.locator('#lAns').textContent()).length === 4, tag + ' answer revealed on loss');
  // daily
  await tap(page, '#lMenu'); await sleep(200); await tap(page, '#tDaily'); await sleep(250);
  st = await page.evaluate(() => window.__ig.get());
  ok(st.mode === 'daily' && st.tray.length === 12, tag + ' daily puzzle starts');
  {
    const c0 = st.coins; await page.evaluate(() => { const s = window.__ig.get(); [...s.answer].forEach(c => window.__ig.tap(c)); window.__ig.submit(); }); await sleep(1700);
    const c1 = (await page.evaluate(() => window.__ig.get())).coins;
    ok(c1 === c0 + 55, tag + ' first daily win pays 55 (' + (c1 - c0) + ')');
    await tap(page, '#wMenu'); await sleep(200);
    ok((await page.locator('#tDailyMeta').textContent()).includes('今天已解'), tag + ' title shows the daily is solved');
    await tap(page, '#tDaily'); await sleep(250);
    await page.evaluate(() => { const s = window.__ig.get(); [...s.answer].forEach(c => window.__ig.tap(c)); window.__ig.submit(); }); await sleep(1700);
    ok((await page.evaluate(() => window.__ig.get())).coins === c1, tag + ' replaying the solved daily pays nothing (no coin farming)');
    await tap(page, '#wMenu'); await sleep(200); await tap(page, '#tDaily'); await sleep(250);
    st = await page.evaluate(() => window.__ig.get());
  }
  // reload keeps progress and theme toggle persists
  await tap(page, '#bBack'); await sleep(200); await tap(page, '#tTheme'); await sleep(100);
  const t1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.reload(); await sleep(400);
  const t2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  ok(t1 && t1 === t2, tag + ' theme choice persists across reload (' + t1 + ')');
  const prog2 = await page.evaluate(() => window.__ig.prog());
  ok(prog2.levels[1] === 3, tag + ' progress persists across reload');
  ok((await page.locator('#tLvMeta').textContent()).includes('第 2 關'), tag + ' title shows next level to play');
  // rapid input: 8 taps per second alternating between far-apart keys must all register, and 刪除 clears them
  {
    await page.evaluate(() => window.__ig.start('level', { level: 50 })); await sleep(200);
    const cdp = await ctx.newCDPSession(page); const s0 = await page.evaluate(() => window.__ig.get()); let got = 0;
    for (let round = 0; round < 3; round++) {
      for (const c of [s0.tray[0], s0.tray[11], s0.tray[5], s0.tray[7]]) { const b = await page.locator(`#tray .key[data-c="${c}"]`).boundingBox(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(85); }
      got += (await page.evaluate(() => window.__ig.get().cur)).filter(Boolean).length;
      for (let i = 0; i < 4; i++) { await tap(page, '#bDel'); await sleep(60); }
    }
    ok(got === 12, tag + ' 12 rapid touch taps (8/s) all registered (' + got + ')');
    ok((await page.evaluate(() => window.__ig.get().cur)).filter(Boolean).length === 0, tag + ' rapid deletes clear the row');
    await tap(page, '#bBack'); await sleep(200); await tap(page, '#sBack'); await sleep(200);
  }
  // unlock-all switch: level 50 is locked by default, opens once the switch is on, and the choice persists
  await tap(page, '#tLevels'); await sleep(250);
  ok(await page.locator('#grid .lt:nth-child(50)').isDisabled(), tag + ' level 50 locked by default');
  ok(!(await page.locator('#grid .lt:nth-child(2)').isDisabled()), tag + ' level 2 unlocked after finishing level 1');
  await tap(page, '#unlockSw'); await sleep(250);
  ok((await page.locator('#unlockSw').getAttribute('aria-checked')) === 'true', tag + ' unlock switch turns on');
  ok((await page.locator('#grid .lt:disabled').count()) === 0, tag + ' all 100 tiles enabled with unlock-all');
  await page.locator('#grid .lt:nth-child(50)').tap(); await sleep(300);
  st = await page.evaluate(() => window.__ig.get());
  ok(st.mode === 'level' && st.level === 50 && st.tray.length === 12, tag + ' tapping tile 50 opens level 50');
  await page.reload(); await sleep(400); await tap(page, '#tLevels'); await sleep(250);
  ok((await page.locator('#unlockSw').getAttribute('aria-checked')) === 'true' && (await page.locator('#grid .lt:disabled').count()) === 0, tag + ' unlock-all persists across reload');
  await page.locator('#grid .lt:nth-child(100)').tap(); await sleep(300);
  st = await page.evaluate(() => window.__ig.get());
  ok(st.level === 100 && st.tray.length === 21, tag + ' level 100 opens with 21 keys');
  await tap(page, '#bBack'); await sleep(250); await tap(page, '#unlockSw'); await sleep(250);
  ok(await page.locator('#grid .lt:nth-child(50)').isDisabled(), tag + ' switching off re-locks level 50');
  ok(errors.length === 0, tag + ' no page errors after full flow: ' + errors.join(' | '));
  await ctx.close();
}

// Checks for the independent review (2026-10-18): saved rounds, no loss dodging, free-practice farming, hint stars, toasts, help card, contrast, landscape.
async function review(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(APP); await sleep(400);
  const get = () => page.evaluate(() => window.__ig.get());
  const wrongRows = (st, n, from = 0) => { const nn = st.tray.filter(c => st.answer.indexOf(c) < 0); return Array.from({ length: n }, (_, g) => [0, 1, 2, 3].map(k => nn[(from + g + k) % nn.length])); };
  const guess = async (row, wait = 1300) => { for (const c of row) await tapChar(page, c); await tap(page, '#bGo'); await sleep(wait); };
  ok(!(await page.locator('#title .sub').textContent()).includes('六次'), 'review: title no longer promises six chances');
  ok(!(await page.locator('#help').textContent()).includes('全球'), 'review: help no longer says 全球同一題 (the daily follows the phone date)');
  // unlock toast must not cover the switch row
  await tap(page, '#tLevels'); await sleep(250); await tap(page, '#unlockSw'); await sleep(150);
  const ov = await page.evaluate(() => { const a = document.getElementById('toast').getBoundingClientRect(), b = document.getElementById('unlockSw').getBoundingClientRect(); return !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right); });
  ok(!ov && await page.locator('#toast').isVisible(), 'review: 已解鎖全部關卡 toast does not overlap the switch');
  // level 70: three wrong guesses, refresh, reopen → same round
  await page.locator('#grid .lt:nth-child(70)').tap(); await sleep(300);
  let st = await get(); const ans70 = st.answer;
  for (const r of wrongRows(st, 3)) await guess(r);
  await page.reload(); await sleep(500);
  ok((await page.locator('#tLvMeta').textContent()) !== null, 'review: reload ok');
  await tap(page, '#tLevels'); await sleep(300);
  ok((await page.locator('#grid .lt:nth-child(70).wip').count()) === 1, 'review: after a refresh level 70 is still marked in progress');
  await page.locator('#grid .lt:nth-child(70)').tap(); await sleep(300);
  st = await get();
  ok(st.answer === ans70 && st.guesses.length === 3 && st.max === 4, 'review: refresh keeps the round (same idiom, 3 guesses used, 4 chances)');
  // leaving for another level does not drop it either
  await tap(page, '#bBack'); await sleep(250); await page.locator('#grid .lt:nth-child(71)').tap(); await sleep(300);
  st = await get(); await guess(wrongRows(st, 1)[0]);
  await tap(page, '#bBack'); await sleep(250); await page.locator('#grid .lt:nth-child(70)').tap(); await sleep(300);
  st = await get();
  ok(st.level === 70 && st.answer === ans70 && st.guesses.length === 3, 'review: playing level 71 meanwhile keeps the level 70 round');
  await guess(wrongRows(st, 1, 5)[0], 1900);
  ok(await page.locator('#lose').isVisible() && (await page.evaluate(() => window.__ig.prog().fails[70])) === 1, 'review: the fourth miss is a counted loss');
  await tap(page, '#lRetry'); await sleep(300); st = await get();
  ok(st.answer !== ans70 && st.guesses.length === 0, 'review: retry after the loss is another idiom');
  await page.reload(); await sleep(400); await tap(page, '#tLevels'); await sleep(250); await page.locator('#grid .lt:nth-child(70)').tap(); await sleep(300);
  ok((await get()).answer !== ans70, 'review: refreshing after the loss does not bring the lost idiom back');
  // full row: a fifth tap says so
  st = await get(); const fr = wrongRows(st, 1)[0];
  for (const c of fr) await tapChar(page, c);
  await tapChar(page, st.tray.find(c => !fr.includes(c))); await sleep(120);
  ok((await page.locator('#toast').textContent()).includes('四格都滿'), 'review: tapping a key with the row full gives feedback');
  for (let i = 0; i < 4; i++) { await tap(page, '#bDel'); await sleep(40); }
  // hints cost stars: reveal one character then win in one guess → 2 stars, not 3
  await tap(page, '#bBack'); await sleep(250); await page.locator('#grid .lt:nth-child(5)').tap(); await sleep(300);
  await tap(page, '#bHint'); await sleep(200); await tap(page, '#h3'); await sleep(200);
  st = await get(); for (const c of st.answer) if (!st.cur.includes(c)) await tapChar(page, c); await tap(page, '#bGo'); await sleep(1800);
  ok(await page.locator('#win').isVisible() && (await page.evaluate(() => window.__ig.prog().levels[5])) === 2 && (await page.locator('#wNote').textContent()).includes('少 1 顆星'), 'review: 揭開一字 costs a star (one-guess win → 2 stars)');
  // star thresholds on a four-chance level: win on the 4th guess → 1 star
  await tap(page, '#wMenu'); await sleep(200); await tap(page, '#tLevels'); await sleep(250); await page.locator('#grid .lt:nth-child(90)').tap(); await sleep(300);
  st = await get(); for (const r of wrongRows(st, 3)) await guess(r); await guess(st.answer.split(''), 1800);
  ok((await page.evaluate(() => window.__ig.prog().levels[90])) === 1, 'review: a four-chance level won on the last guess gives 1 star');
  // free practice: a loss never replays the same idiom and pays nothing until a real win
  await tap(page, '#wMenu'); await sleep(200); await tap(page, '#tFree'); await sleep(300);
  st = await get(); const freeAns = st.answer, coins0 = st.coins;
  for (const r of wrongRows(st, 6)) await guess(r, 300); await sleep(1600);
  ok(await page.locator('#lose').isVisible() && !(await page.locator('#lNext').isVisible()) && (await page.locator('#lRetry').textContent()) === '再來一題', 'review: free-practice loss offers 再來一題');
  await tap(page, '#lRetry'); await sleep(300); st = await get();
  ok(st.mode === 'free' && st.answer !== freeAns && st.coins === coins0, 'review: free-practice retry is a different idiom (no answer-copy coin farm)');
  // daily lost → retry note says it is over, not solved
  await tap(page, '#bBack'); await sleep(200); await tap(page, '#tDaily'); await sleep(300);
  st = await get(); for (const r of wrongRows(st, 6)) await guess(r, 300); await sleep(1600);
  ok((await page.locator('#lRetry').textContent()).includes('不計墨珠'), 'review: lost daily offers a practice retry');
  await tap(page, '#lRetry'); await sleep(450);
  ok((await page.locator('#toast').textContent()).includes('已經結束'), 'review: lost-daily retry note says the day is over, not 已經解過');
  ok(errors.length === 0, 'review: no page errors: ' + errors.join(' | '));
  await ctx.close();
  // dark mode grey tiles readable (contrast ≥ 4.5)
  { const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' }); const p = await c2.newPage(); await p.goto(APP); await sleep(300);
    await p.evaluate(() => { window.__ig.start('level', { level: 100 }); const s = window.__ig.get(); s.tray.filter(c => !s.answer.includes(c)).slice(0, 4).forEach(c => window.__ig.tap(c)); window.__ig.submit(); }); await sleep(1400);
    const cr = await p.evaluate(() => { const t = document.querySelector('#board .tile.m'), cs = getComputedStyle(t); const L = s => { const v = s.match(/[\d.]+/g).slice(0, 3).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; }; const a = L(cs.color), b = L(cs.backgroundColor); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); });
    ok(cr >= 4.5, 'review: dark-mode grey tile contrast ' + cr.toFixed(2) + ' ≥ 4.5'); await c2.close(); }
  // 844×390: help 知道了 visible without scrolling; right column starts at the top
  { const c3 = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }); const p = await c3.newPage(); await p.goto(APP); await sleep(300);
    await p.click('#tHelp'); await sleep(900);
    const vis = await p.evaluate(() => { const b = document.getElementById('hOk').getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { ok: b.top >= 0 && b.bottom <= innerHeight && document.getElementById('hOk').offsetHeight >= 44 && !!(e && e.closest('#hOk')), d: [Math.round(b.top), Math.round(b.bottom), Math.round(b.height), innerHeight, e && (e.id || e.className)].join(',') }; });
    ok(vis.ok, 'review: 844×390 help card keeps 知道了 fully on screen (' + vis.d + ')');
    await p.click('#hOk'); await sleep(200); await p.evaluate(() => window.__ig.start('level', { level: 50 })); await sleep(300);
    const gapTop = await p.evaluate(() => document.getElementById('clue').getBoundingClientRect().top - document.querySelector('.hud').getBoundingClientRect().bottom);
    const keyH = await p.evaluate(() => document.querySelector('#tray .key').getBoundingClientRect().height);
    ok(gapTop <= 16 && keyH >= 52, 'review: landscape right column has no empty top area (gap ' + Math.round(gapTop) + ' px, keys ' + Math.round(keyH) + ' px)'); await c3.close(); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await session(browser, { width: 390, height: 844 }, false, true);
  // cover: a 390×520 viewport mid-game (level 65 sample: one judged guess, two characters placed)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
    await ctx.addInitScript(() => { try { localStorage.setItem('idiom-guess:v1:seen', 'true'); } catch (e) { } });
    const page = await ctx.newPage(); await page.goto(APP); await sleep(300);
    await page.evaluate(() => window.__ig.start('level', { level: 65 }));
    const st = await page.evaluate(() => window.__ig.get()), a = st.answer, not = st.tray.filter(c => a.indexOf(c) < 0);
    await page.evaluate(g => { g.forEach(c => window.__ig.tap(c)); window.__ig.submit(); }, [a[1], not[0], a[2], not[1]]); await sleep(1400);
    await page.evaluate(g => g.forEach(c => window.__ig.tap(c)), [a[0], a[1]]); await sleep(150);
    await page.screenshot({ path: path.join(__dirname, 'cover-390x520.png') });
    ok(fs.existsSync(path.join(__dirname, 'cover-390x520.png')), 'cover written');
    await ctx.close();
  }
  for (const vp of [{ width: 375, height: 500 }, { width: 390, height: 610 }, { width: 430, height: 740 }, { width: 360, height: 640 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
    await session(browser, vp, false, false);
    await session(browser, vp, true, false);
  }
  await review(browser);
  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
