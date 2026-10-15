// Rule tests for 果園快刀 in the real page with real CDP touch input (spec 九 acceptance items).
// Usage: node rules-test.js
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  (' + extra + ')' : '')); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(APP); await page.evaluate(() => localStorage.clear()); await page.reload(); await sleep(800); if (process.env.DBG) await page.evaluate(() => { window.__dbg = 1; });
  const cdp = await ctx.newCDPSession(page);
  // swipe from a to b, `steps` moves, `ms` total duration (real timing)
  // Each event carries the finger's own timestamp (like real touch hardware), so a busy test machine cannot
  // change the swipe speed the page measures.
  async function swipe(a, b, ms, steps = 8) {
    const t0 = Date.now();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t0 / 1000, touchPoints: [{ x: a[0], y: a[1] }] });
    for (let i = 1; i <= steps; i++) { const tgt = t0 + ms * i / steps; const d = tgt - Date.now(); if (d > 0) await sleep(d); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', timestamp: tgt / 1000, touchPoints: [{ x: a[0] + (b[0] - a[0]) * i / steps, y: a[1] + (b[1] - a[1]) * i / steps }] }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: (t0 + ms + 10) / 1000, touchPoints: [] });
  }
  const st = () => page.evaluate(() => __game.state());
  if (process.env.DBG) page.on('console', m => console.log('  page:', m.text()));
  const ids = () => page.evaluate(() => __game.snap().items.map(i => i.id));
  // start classic by slicing the start melon
  let s = await page.evaluate(() => __game.snap()); const m = s.items.find(i => i.kind === 'start');
  await swipe([m.x - m.r * 1.4, m.y], [m.x + m.r * 1.4, m.y], 100);
  await sleep(1000);
  check('slicing 「開始」 starts the game', (await st()).state === 'play');
  await page.evaluate(() => { __game.hold(); __game.set({ waveTimer: 1e9 }); });
  await sleep(2600); // let the first wave (if any) clear
  await page.evaluate(() => __game.set({ lives: 3, score: 0, nextLife: 100, misses: 0 }));
  await page.evaluate(() => { __game.snap().items.length; });
  // 1. slow drag does not cut
  let id = await page.evaluate(() => __game.place('apple', 195, 400));
  await swipe([120, 400], [270, 400], 600, 30); await sleep(300); // 0.25 px/ms
  check('slow drag (0.25 px/ms) does not cut', (await ids()).includes(id));
  await swipe([120, 400], [270, 400], 90); await sleep(1000);
  let g = await st();
  check('fast swipe cuts a fruit for 1 point', !(await ids()).includes(id) && g.score === 1, 'score ' + g.score);
  // 2. combo: 3 in one stroke -> 3 + 3
  await page.evaluate(() => { __game.set({ score: 0 }); __game.place('orange', 90, 300); __game.place('kiwi', 195, 300); __game.place('lemon', 300, 300); });
  await swipe([20, 300], [370, 300], 120); await sleep(1000);
  g = await st(); check('3 fruits in one stroke = 3 + 3 combo bonus', g.score === 6, 'score ' + g.score);
  await page.evaluate(() => { __game.set({ score: 0 }); __game.place('orange', 90, 300); __game.place('kiwi', 300, 300); });
  await swipe([20, 300], [370, 300], 120); await sleep(1000);
  g = await st(); check('2 fruits in one stroke = no bonus', g.score === 2, 'score ' + g.score);
  // 3. chestnut: -1 life, clears fruits, no score
  await page.evaluate(() => { __game.set({ score: 0 }); __game.place('melon', 80, 600); __game.place('mango', 310, 600); __game.place('nut', 195, 300); });
  await swipe([120, 300], [270, 300], 90); await sleep(1000);
  g = await st(); const left = (await page.evaluate(() => __game.snap().items.filter(i => i.kind !== 'start').length));
  check('chestnut costs 1 life and clears all fruit without score', g.lives === 2 && left === 0 && g.score === 0, `lives ${g.lives}, items left ${left}, score ${g.score}`);
  // 4. missed fruit costs a life
  await page.evaluate(() => __game.place('apple', 195, 820, 300));
  await sleep(1500); g = await st();
  check('a fruit falling off the bottom costs 1 life', g.lives === 1 && g.misses === 1, `lives ${g.lives}, misses ${g.misses}`);
  // 5. extra life at 100 points (cap 3)
  await page.evaluate(() => { __game.set({ score: 99 }); __game.place('apple', 195, 400); });
  await swipe([120, 400], [270, 400], 90); await sleep(1000);
  g = await st(); check('reaching 100 points restores a leaf', g.lives === 2 && g.score === 100, `lives ${g.lives}, score ${g.score}`);
  // 6. specials
  await page.evaluate(() => __game.place('ice', 195, 400)); await swipe([120, 400], [270, 400], 90);
  for (let k = 0; k < 40; k++) { g = await st(); if (g.slowmo > 0) break; await sleep(25); } check('冰梨 starts 4 s slow motion', g.slowmo > 3 && g.slowmo <= 4, 'slowmo ' + g.slowmo.toFixed(2));
  await page.evaluate(() => __game.set({ slowmo: 0 }));
  await page.evaluate(() => __game.place('peach', 195, 400)); await swipe([120, 400], [270, 400], 90);
  for (let k = 0; k < 40; k++) { g = await st(); if (g.pull > 0) break; await sleep(25); } check('彩虹桃 pulls fruit to the centre for 3 s', g.pull > 2 && g.pull <= 3, 'pull ' + g.pull.toFixed(2));
  const f1 = await page.evaluate(() => __game.place('apple', 40, 700)); await sleep(1500);
  const p1 = await page.evaluate(id => __game.snap().items.find(i => i.id === id), f1);
  check('…and the pulled fruit moved toward the centre', p1 && Math.abs(p1.x - 195) < 60 && Math.abs(p1.y - 354) < 120, p1 && `at ${p1.x.toFixed(0)},${p1.y.toFixed(0)}`);
  await sleep(2000);
  await page.evaluate(() => { __game.clear(); __game.set({ score: 0, pull: 0, lives: 3 }); });
  const pid = await page.evaluate(() => __game.place('pine', 195, 400));
  for (let k = 0; k < 5; k++) {
    const p = await page.evaluate(id => __game.snap().items.find(i => i.id === id), pid);
    if (!p) break;
    await swipe([Math.max(5, p.x - 90), p.y], [Math.min(385, p.x + 90), p.y], 70); await sleep(600);
  }
  await sleep(800); g = await st(); check('金鳳梨: 5 strokes = 4 × 1 + 10', g.score === 14 && !(await ids()).includes(pid), 'score ' + g.score);
  // 7. HUD difficulty
  await page.evaluate(() => __game.jump(46)); await sleep(200);
  const hd = await page.textContent('#hDiff'); check('HUD shows 難度 = 1 + floor(t/15)', hd === '4', 'HUD ' + hd);
  // 8. game over saves best
  await page.evaluate(() => { __game.set({ score: 37, lives: 1 }); __game.place('apple', 195, 820, 300); });
  await sleep(4000);
  g = await st(); const bestLS = await page.evaluate(() => localStorage.getItem('fruitslash.best'));
  check('game over screen + best saved to fruitslash.best', g.state === 'over' && await page.isVisible('#overOv') && bestLS === '37', `state ${g.state}, best ${bestLS}`);
  const statsLS = await page.evaluate(() => JSON.parse(localStorage.getItem('fruitslash.stats')));
  check('fruitslash.stats records slices / per-fruit / max combo', statsLS && statsLS.slices > 5 && statsLS.per.apple >= 1 && statsLS.maxCombo >= 3, statsLS && `slices ${statsLS.slices}, maxCombo ${statsLS.maxCombo}`);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  // 9. localStorage throwing must not break the game
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx2.addInitScript(() => { const bad = () => { throw new Error('denied'); }; Storage.prototype.getItem = bad; Storage.prototype.setItem = bad; });
  const p2 = await ctx2.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(String(e)));
  await p2.goto(APP); await sleep(800);
  const c2 = await ctx2.newCDPSession(p2);
  s = await p2.evaluate(() => __game.snap()); const m2 = s.items.find(i => i.kind === 'start');
  await c2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: m2.x - m2.r * 1.4, y: m2.y }] });
  for (let i = 1; i <= 6; i++) { await sleep(16); await c2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: m2.x - m2.r * 1.4 + m2.r * 2.8 * i / 6, y: m2.y }] }); }
  await c2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(900);
  await p2.evaluate(() => __game.set({ lives: 1 })); await p2.evaluate(() => __game.place('apple', 195, 820, 300)); await sleep(4000);
  const g2 = await p2.evaluate(() => __game.state());
  check('blocked localStorage: game still plays and ends without errors', g2.state === 'over' && e2.length === 0, e2.join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
