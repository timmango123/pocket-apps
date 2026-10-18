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
  if (full) { await sleep(500); ok(await page.locator('#toast').isVisible() && (await page.locator('#toast').textContent()).includes('字牌'), tag + ' first game shows the onboarding tip'); }
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
  if (!full) { await ctx.close(); return; }
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
    const not = st.tray.filter(c => st.answer.indexOf(c) < 0).slice(0, 4);
    await page.evaluate(ws => { ws.forEach(c => window.__ig.tap(c)); window.__ig.submit(); }, not);
    await sleep(1300);
  }
  ok(await page.locator('#lose').isVisible(), tag + ' lose overlay after six misses');
  ok((await page.locator('#lAns').textContent()).length === 4, tag + ' answer revealed on loss');
  // daily
  await tap(page, '#lMenu'); await sleep(200); await tap(page, '#tDaily'); await sleep(250);
  st = await page.evaluate(() => window.__ig.get());
  ok(st.mode === 'daily' && st.tray.length === 12, tag + ' daily puzzle starts');
  // reload keeps progress and theme toggle persists
  await tap(page, '#bBack'); await sleep(200); await tap(page, '#tTheme'); await sleep(100);
  const t1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.reload(); await sleep(400);
  const t2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  ok(t1 && t1 === t2, tag + ' theme choice persists across reload (' + t1 + ')');
  const prog2 = await page.evaluate(() => window.__ig.prog());
  ok(prog2.levels[1] === 3, tag + ' progress persists across reload');
  ok((await page.locator('#tLvMeta').textContent()).includes('第 2 關'), tag + ' title shows next level to play');
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
  ok(st.level === 100 && st.tray.length === 14, tag + ' level 100 opens with 14 keys');
  await tap(page, '#bBack'); await sleep(250); await tap(page, '#unlockSw'); await sleep(250);
  ok(await page.locator('#grid .lt:nth-child(50)').isDisabled(), tag + ' switching off re-locks level 50');
  ok(errors.length === 0, tag + ' no page errors after full flow: ' + errors.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await session(browser, { width: 390, height: 844 }, false, true);
  // cover: a 390×520 viewport mid-game (level 65 sample: one judged guess, two characters placed)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const page = await ctx.newPage(); await page.goto(APP); await sleep(300);
    await page.evaluate(() => window.__ig.start('level', { level: 65 }));
    const st = await page.evaluate(() => window.__ig.get()), a = st.answer, not = st.tray.filter(c => a.indexOf(c) < 0);
    await page.evaluate(g => { g.forEach(c => window.__ig.tap(c)); window.__ig.submit(); }, [a[1], not[0], a[2], not[1]]); await sleep(1400);
    await page.evaluate(g => g.forEach(c => window.__ig.tap(c)), [a[0], a[1]]); await sleep(150);
    await page.screenshot({ path: path.join(__dirname, 'cover-390x520.png') });
    ok(fs.existsSync(path.join(__dirname, 'cover-390x520.png')), 'cover written');
    await ctx.close();
  }
  for (const vp of [{ width: 375, height: 500 }, { width: 390, height: 610 }, { width: 430, height: 740 }]) {
    await session(browser, vp, false, false);
    await session(browser, vp, true, false);
  }
  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
