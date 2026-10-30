// 光環穿越 (color-rings)：9.5 上架複審修正的回歸測試（node tests.js，約 20 秒）。
// 1) core：亂數產生器可接續、整局存檔／還原後與原局一模一樣、壞存檔被拒、六種障礙成就可達成
// 2) 頁面（本機 http + 真實 CDP 觸控）：存檔驗證、第二指也能彈跳、繼續後先凍結等點擊、
//    離開頁面存下進行中的一局並在重新載入後接續、從暫停回主選單只結算一次、結算卡防誤觸、
//    旋轉才暫停（工具列高度變化不暫停）、色盲圖樣開關會保存、Esc 關閉面板
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const CR = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn CR;')();
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const step = m => { if (process.env.DEBUG) console.log('  ..', m); };

// ---------------- core ----------------
{
  const a = CR.rng(12345); for (let i = 0; i < 37; i++) a();
  const b = CR.rng(a.st()), xs = [a(), a(), a()], ys = [b(), b(), b()];
  assert(JSON.stringify(xs) === JSON.stringify(ys), 'a generator re-seeded with st() continues the same sequence');
  const c = CR.rng(4000000000), d = CR.rng(4000000000 >>> 0);
  assert(c() === d(), 'seeds above 2^31 give the same numbers as before');

  // play a bot run to ~15, save, restore, then drive both copies with the same taps: they must stay identical
  const bot = (S, until) => { let pend = -1, next = 0, g = 0; while (!S.dead && S.score < until && g++ < 200000) { if (pend >= 0 && S.t >= pend) { CR.tap(S); pend = -1; } if (pend < 0 && S.t >= next) { if (CR.plan(S, 0.15)) pend = S.t + 0.15; next = S.t + 0.04; } CR.tick(S); } };
  const S = CR.newRun(777, 780); CR.tap(S); bot(S, 15); S.ev = [];
  const T = CR.restore(CR.snapshot(S), 780);
  assert(T && T.score === S.score && T.ball.y === S.ball.y && T.obs.length === S.obs.length, 'a saved run restores with the same score, ball and obstacles (score ' + S.score + ')');
  const taps = []; { const U = CR.restore(CR.snapshot(S), 780); let pend = -1, next = 0; for (let k = 0; k < 120 * 20 && !U.dead; k++) { if (pend >= 0 && U.t >= pend) { CR.tap(U); taps.push(k); pend = -1; } if (pend < 0 && U.t >= next) { if (CR.plan(U, 0.15)) pend = U.t + 0.15; next = U.t + 0.04; } CR.tick(U); } }
  const replay = R => { let j = 0; for (let k = 0; k < 120 * 20 && !R.dead; k++) { if (taps[j] === k) { CR.tap(R); j++; } CR.tick(R); } return [R.score, R.dead, R.ball.y.toFixed(6), R.count, R.obs.map(o => o.type + o.col + o.cy).join()].join('|'); };
  const r1 = replay(S), r2 = replay(T);
  assert(r1 === r2, 'original and restored run play out identically for 20 s of the same taps, new obstacles included (' + r1.split('|').slice(0, 2).join(' ') + ')');
  const bad = ['', '{', 'null', '{"v":1}', JSON.stringify({ v: 1, rs: 1, S: { ball: { y: NaN } } })];
  const dead = CR.newRun(5, 780); CR.tap(dead); dead.dead = true;
  const fresh = CR.newRun(6, 780);
  const tampered = JSON.parse(CR.snapshot(T)); tampered.S.obs[0].rots[0].w = 'fast';
  assert(bad.every(x => CR.restore(x, 780) === null) && CR.restore(CR.snapshot(dead), 780) === null && CR.restore(CR.snapshot(fresh), 780) === null && CR.restore(JSON.stringify(tampered), 780) === null,
    'garbage, a finished run, an unstarted run and a tampered obstacle are all rejected');
  // the replaced achievement (all six obstacle kinds in one run) is reachable: a long bot run passes all of them
  const L = CR.newRun(31, 780); CR.tap(L); bot(L, 60);
  assert(CR.UNLOCK.every(u => L.kinds[u[0]]), 'a run past 38 passes all six obstacle kinds (score ' + L.score + ', kinds ' + Object.keys(L.kinds).join('/') + ')');
}

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(APP)); });
  srv.unref();
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const srv = await serve(), URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  async function open(storage = {}, w = 390, h = 844) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); for (const k in s) localStorage.setItem(k, s[k]); } }, storage);
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    const st = () => p.evaluate(() => window.__game.state());
    const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('colorrings.' + k)), k);
    const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: q[2] || i + 1 })) });
    const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(30); await touch('touchEnd', []); };
    const waitState = (s, timeout = 15000) => p.waitForFunction(s => window.__game.state().state === s, s, { timeout });
    // tap a button once it is on screen and no longer animating in, and wait for its click to arrive
    const tap = async (sel, before) => {
      await p.waitForFunction(s => { const e = document.querySelector(s); if (!e || e.closest('.hidden')) return false; const r = e.getBoundingClientRect(); const c = e.closest('.card'); return r.width > 0 && !(c && c.getAnimations().some(a => a.playState === 'running')) && !document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.ov') === e.closest('.ov') && a.animationName !== 'breathe'); }, sel);
      await p.evaluate(s => { window.__clicked = 0; document.querySelector(s).addEventListener('click', () => { window.__clicked++; }, { once: true }); }, sel);
      const b = await p.locator(sel).boundingBox(); if (before) await before(); await tapAt(b.x + b.width / 2, b.y + b.height / 2);
      await p.waitForFunction(() => window.__clicked > 0, null, { timeout: 5000 });
    };
    // a tap on the play field (below the HUD, away from the buttons)
    const field = async () => { const n = (await st()).taps, v = p.viewportSize(); await tapAt(v.width / 2, v.height * 0.7); await p.waitForFunction(n => window.__game.state().taps > n, n, { timeout: 5000 }); };
    return { ctx, p, cdp, st, ls, touch, tapAt, tap, field, waitState };
  }

  // 1. corrupt storage never shows NaN or unlocks things
  {
    const t = await open({ 'colorrings.best': '1e400', 'colorrings.gems': '"many"', 'colorrings.skins': '[0,3,"2",9]', 'colorrings.skin': '2',
      'colorrings.settings': '{"pat":"yes","snd":false}', 'colorrings.stats': '{"plays":-4,"total":"x"}', 'colorrings.ach': '[1]', 'colorrings.daily': '{"date":"today","best":99}', 'colorrings.run': '"broken"' });
    const s = await t.st();
    assert(s.state === 'title' && s.best === 0 && s.gems === 0, 'infinite best and text gems fall back to 0 (best ' + s.best + ', gems ' + s.gems + ')');
    assert(await t.p.textContent('#tBest') === '0' && /\d\d\/\d\d/.test(await t.p.textContent('#tDaily')), 'title shows 0 and no bogus daily record');
    assert(s.pat === false && await t.p.getAttribute('#bMute', 'aria-label') === '音效關', 'only real booleans are taken from settings ("yes" ignored, false kept)');
    await t.tap('#bShop'); const skins = await t.p.$$eval('.skin .pr', e => e.map(x => x.textContent));
    assert(skins[0] === '使用中' && skins[3] === '點一下使用' && /星晶兌換/.test(skins[2]), 'a skin that is not owned cannot be selected; owned ones survive (' + skins.join(' / ') + ')');
    await t.p.keyboard.press('Escape'); await t.p.waitForSelector('#shopOv.hidden', { state: 'attached' });
    assert(true, 'Escape closes the open panel');
    await t.tap('#bStats');
    const grid = await t.p.$$eval('#stGrid b', e => e.map(x => x.textContent)), achs = await t.p.$$eval('#achList b', e => e.map(x => x.textContent));
    assert(grid.join() === '0,0,0,0' && !achs.includes('清心寡慾') && achs.includes('見多識廣'), 'stats read 0 and the impossible "no star" achievement is replaced (' + grid.join() + ')');
    await t.ctx.close();
  }

  // 2. real touch: a tap starts and jumps; pause; 繼續 waits frozen for a tap; a second finger jumps too
  {
    const t = await open();
    await t.tap('#bPlay'); await t.waitState('ready');
    await t.p.waitForFunction(() => !document.getElementById('hint').classList.contains('hidden'));
    await t.field();
    let s = await t.st();
    assert(s.state === 'play' && s.started && s.taps === 1 && s.vy < 0, 'a touch on the field starts the run with a jump');
    // pause button is a 44px target and does not make the ball jump (a key jump first keeps the ball up while we aim)
    const box = await t.p.locator('#bPause').boundingBox();
    assert(box.width >= 44 && box.height >= 44, 'pause button is 44×44');
    await t.tap('#bPause', () => t.p.keyboard.press('Space')); await t.waitState('pause');
    assert((await t.st()).taps === 2, 'tapping pause does not also jump');
    // 繼續: the world stays frozen until the next tap, which is a jump
    await t.tap('#bResume');
    const h0 = await t.st(); await sleep(400); const h1 = await t.st();
    assert(h0.state === 'hold' && h1.state === 'hold' && h0.t === h1.t && h0.y === h1.y, 'after 繼續 the ball and rings stay frozen until a tap (no fall while the finger moves off the button)');
    assert(await t.p.textContent('#hint') === '點一下繼續點下去光球就會往上彈', 'the hint says tap to continue');
    await t.field();
    s = await t.st();
    assert(s.state === 'play' && s.vy < 0 && s.t > h1.t && s.taps === 3, 'the tap resumes the run with a jump');
    await t.ctx.close();
  }

  // 2b. a second finger jumps too, a held or moving finger does nothing more
  {
    const t = await open();
    await t.tap('#bPlay'); await t.waitState('ready');
    await t.touch('touchStart', [[150, 600, 1]]); await t.p.waitForFunction(() => window.__game.state().taps >= 1, null, { timeout: 5000 });
    await sleep(60); // taps closer than 40 ms count once (a finger and its echo)
    await t.touch('touchStart', [[150, 600, 1], [260, 640, 2]]); await t.p.waitForFunction(() => window.__game.state().taps >= 2, null, { timeout: 5000 });
    await t.touch('touchMove', [[150, 620, 1], [260, 660, 2]]); await sleep(60);
    const s = await t.st();
    assert(s.taps === 2 && s.state === 'play', 'first finger, then a second finger while the first is held: two jumps; moving them adds none');
    await t.touch('touchEnd', [[150, 620, 1], [260, 660, 2]]);
    await t.ctx.close();
  }

  // 3. leaving the page keeps the run; reloading resumes it paused; quitting banks it exactly once
  {
    const t = await open({ 'colorrings.best': '3', 'colorrings.gems': '10' });
    await t.tap('#bPlay'); await t.waitState('ready'); await t.field();
    const sc = await t.p.evaluate(() => { const g = window.__game; g.fastForward(9); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' })); return g.state().score; });
    await t.waitState('pause');
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    let s = await t.st();
    assert(s.state === 'pause' && s.score === sc && s.started && !s.dead, 'after a reload the run comes back paused at the same score (' + s.score + ')');
    assert(s.best === sc && await t.ls('best') === sc, 'the record was flushed on pagehide (best ' + await t.ls('best') + ')');
    assert(s.runGems > 0 && s.gems === 10 && await t.ls('gems') === 10, 'run gems are carried by the saved run, not banked twice (run ' + s.runGems + ')');
    assert(await t.p.isVisible('#pauseOv') && await t.p.textContent('#pScore') === String(sc), 'the pause card shows the resumed score');
    step('home'); await t.tap('#bHome'); await t.waitState('title');
    const stats = await t.ls('stats'), gems = await t.ls('gems');
    assert(stats.plays === 1 && stats.total === s.score && gems === 10 + s.runGems, '主選單 from pause banks the run once (plays ' + stats.plays + ', gems ' + gems + ')');
    assert(await t.ls('run') === null, 'and clears the saved run');
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    s = await t.st();
    assert(s.state === 'title' && (await t.ls('stats')).plays === 1 && s.gems === gems, 'reloading afterwards starts at the title with nothing counted twice');
    // a resumed run plays on: 繼續, then the tap
    await t.tap('#bPlay'); await t.waitState('ready'); await t.field();
    await t.p.evaluate(() => { window.__game.fastForward(4); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' })); });
    await t.waitState('pause'); await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    step('resume'); await t.tap('#bResume'); await t.waitState('hold');
    const h = await t.st(); step('field'); await t.field(); const r = await t.st();
    assert(h.score >= 4 && r.t > h.t && r.score >= h.score, 'the resumed run plays on from where it was (score ' + h.score + ')');
    await t.ctx.close();
  }

  // 4. death: banked once, result card ignores taps for a moment, then works
  {
    const t = await open();
    await t.tap('#bPlay'); await t.waitState('ready'); await t.field();
    await t.waitState('over');
    let s = await t.st();
    assert((await t.ls('stats')).plays === 1, 'a fall ends the run and counts one play');
    await t.p.waitForFunction(() => !document.querySelector('#overOv .card').getAnimations().some(a => a.playState === 'running'));
    await t.p.evaluate(() => window.__game.overAt());
    const b = await t.p.locator('#bAgain').boundingBox();
    await t.tapAt(b.x + b.width / 2, b.y + b.height / 2); await sleep(150);
    assert((await t.st()).state === 'over', 'a tap on 再玩一次 right as the card appears is ignored (it was meant as a jump)');
    await sleep(600);
    await t.tap('#bAgain'); await t.waitState('ready');
    assert((await t.ls('stats')).plays === 1, 'a moment later 再玩一次 works, and the finished run is not counted again');
    await t.ctx.close();
  }

  // 5. rotation pauses, a toolbar height change does not (a key jump right before each resize keeps the ball up)
  {
    const t = await open();
    await t.tap('#bPlay'); await t.waitState('ready'); await t.field();
    const resized = (w, h) => t.p.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h && new Promise(r => requestAnimationFrame(() => r(true))), [w, h], { timeout: 5000 });
    await t.p.keyboard.press('Space'); await t.p.setViewportSize({ width: 390, height: 760 }); await resized(390, 760);
    const a = (await t.st()).state;
    await t.p.keyboard.press('Space'); await t.p.setViewportSize({ width: 844, height: 390 }); await resized(844, 390);
    const b = (await t.st()).state;
    assert(a === 'play', 'a height-only resize (Safari toolbar) keeps playing (' + a + ')');
    assert(b === 'pause' && await t.p.isVisible('#pauseOv'), 'turning the phone mid-run pauses (' + b + ')');
    await t.tap('#bResume'); await t.field();
    assert((await t.st()).state === 'play', '繼續 + tap plays on in landscape');
    await t.ctx.close();
  }

  // 6. colour-blind patterns: the switch is a real toggle and is remembered
  {
    const t = await open();
    await t.tap('#bSet'); await t.tap('#swPat');
    assert(await t.p.getAttribute('#swPat', 'aria-checked') === 'true' && (await t.ls('settings')).pat === true, 'colour-blind patterns switch on and are saved');
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    assert((await t.st()).pat === true, 'patterns stay on after a reload');
    await t.ctx.close();
  }

  await browser.close();
  assert(!errors.length, 'no page or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `FAIL ${fails} check(s) failed` : 'all color-rings checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
