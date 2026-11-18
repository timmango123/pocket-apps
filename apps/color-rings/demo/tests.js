// 光環穿越 (color-rings)：上架複審回歸測試（node tests.js，約 60 秒）。
// 1) core：亂數產生器可接續、整局存檔／還原後與原局一模一樣、壞存檔被拒、六種障礙成就可達成；
//    R1：練習環（同色、慢、掉到底會彈回）、60/80 分的新障礙、難度數字到 110 封頂、擺動／多環最小通過窗、
//    死因（撞色 / 掉出）、產生障礙的時間
// 2) 頁面（本機 http + 真實 CDP 觸控）：存檔驗證、第二指也能彈跳、繼續後先凍結等點擊、
//    離開頁面存下進行中的一局並在重新載入後接續、從暫停回主選單只結算一次、結算卡防誤觸、
//    旋轉才暫停（工具列高度變化不暫停）、色盲圖樣開關會保存、Esc 關閉面板；
//    R1：另一指按著時按鈕照常（tap layer）、按鈕邊緣內 1–4 px、點按後 detail 0 click 只算一次、
//    按住 0.6 / 1 s、死亡時按下的手指不會在結算卡開新局、商店確認、玩法入口、版面細節
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
  assert(CR.UNLOCK.slice(0, 6).every(u => L.kinds[u[0]]), 'a run past 38 passes all six original obstacle kinds (score ' + L.score + ', kinds ' + Object.keys(L.kinds).join('/') + ')');

  // R1#5 the opening: practice ring (one colour, slow), gentle second ring, the bottom bounces the ball back meanwhile
  let okIntro = true, okSecond = true;
  for (let seed = 1; seed <= 40; seed++) {
    const P = CR.newRun(seed, 780), o0 = P.obs[0], o1 = P.obs[1];
    if (!(o0.type === 'ring' && o0.ps.every(p => p.c === P.ball.c) && o0.w <= 0.9 + 1e-9)) okIntro = false;
    if (o1.type === 'ring' && !(o1.w <= 1.1 + 1e-9 && o1.ps.filter(p => p.c === o1.col).length >= 3)) okSecond = false;
  }
  assert(okIntro, 'R1#5: the first ring is a practice ring: all in the ball\'s colour, turning at 0.9 rad/s');
  assert(okSecond, 'R1#5: the second ring turns at most 1.1 rad/s and three of its quarters are in the colour it was dealt for');
  { const P = CR.newRun(3, 780); CR.tap(P); for (let k = 0; k < 120 * 12; k++) CR.tick(P);
    assert(!P.dead && P.ev.some(e => e.e === 'bounce'), 'R1#5: with no taps at all, the ball bounces off the bottom for 12 s instead of falling out before the first ring'); }
  { const P = CR.newRun(4, 780); CR.tap(P); bot(P, 1); let k = 0; P.passed = 1; while (!P.dead && k++ < 120 * 30) CR.tick(P);
    assert(P.dead && P.why === 'fall' && P.bounces === CR.BOUNCES, 'R1#5: after the first ring the bottom bounces only ' + CR.BOUNCES + ' more times, then a fall ends the run (bounces ' + P.bounces + ', why ' + P.why + ')'); }
  { const P = CR.newRun(5, 780); CR.tap(P); bot(P, 4);
    assert(P.passed >= 2 && !CR.floorOn(P), 'R1#5: past the two practice rings the floor is gone (passed ' + P.passed + ')'); }

  // R1#6 + #7: later variety, difficulty number follows the real curve
  assert(CR.poolFor(59).indexOf('eight') < 0 && CR.poolFor(60).indexOf('eight') >= 0 && CR.poolFor(80).indexOf('gate') >= 0, 'R1#6: a figure-8 ring unlocks at 60 and a double-cross gate at 80');
  { const P = CR.newRun(8, 780); CR.tap(P); P.score = 60; P.cam -= 2600; CR.fill(P); const t1 = P.obs.map(o => o.type);
    P.score = 80; P.cam -= 2600; CR.fill(P); const t2 = P.obs.map(o => o.type);
    assert(t1.includes('eight') && t2.includes('gate'), 'R1#6: reaching 60 / 80 deals the new kind right away (' + t2.slice(-6).join(',') + ')'); }
  assert(CR.spacingFor(60) === 260 && CR.spacingFor(110) < 246 && CR.spacingFor(110) === CR.spacingFor(300), 'R1#6: spacing keeps tightening gently from 60 to 110, then stays (' + CR.spacingFor(110).toFixed(1) + ')');
  const dl = [0, 8, 59, 60, 100, 109, 110, 200, 400].map(CR.diffFor);
  assert(dl.every((d, i) => !i || d >= dl[i - 1]) && CR.diffFor(110) === CR.diffFor(400) && CR.diffFor(109) < CR.diffFor(110) && CR.PEAK === 110, 'R1#7: 難度 rises until 110 (where the game stops getting harder) and then stays (' + dl.join(',') + ')');

  // R1#8 + #13: every obstacle leaves at least its required window: 0.22 s, +0.04 for several rings, +0.03 variable / +0.08 swinging; built quickly
  { const R = CR.rng(77); let bad = [], minSwingMulti = 9, n = 0, checks = 0, maxChecks = 0; const times = [];
    for (let s = 20; s <= 130; s += 5) for (const type of CR.poolFor(s)) for (let k = 0; k < 6; k++) {
      const t0 = performance.now(), o = CR.build(type, s, R, k % 4); times.push(performance.now() - t0); n++;
      checks += o.slowed + 1; maxChecks = Math.max(maxChecks, o.slowed + 1); // fairness re-checks: the cost of a build, independent of machine load
      if (o.win < CR.needWin(o) - 1e-9) bad.push(type + '@' + s + ':' + o.win.toFixed(3));
      if (o.mode === 2 && o.rots.length > 1) minSwingMulti = Math.min(minSwingMulti, o.win);
    }
    assert(!bad.length, 'R1#8: all ' + n + ' obstacles from 20 to 130 meet their minimum window' + (bad.length ? ' (' + bad.slice(0, 4).join(' ') + ')' : ''));
    assert(minSwingMulti >= 0.34 - 1e-9, 'R1#8: swinging double / triple / 8 rings leave at least 0.34 s (shortest ' + minSwingMulti.toFixed(3) + ' s)');
    times.sort((a, b) => a - b); const med = times[times.length >> 1];
    // the old loop re-checked up to 24 times (often 13 at score 60+); now at most 8 and about 3 on average (seeded, so deterministic)
    assert(maxChecks <= 8 && checks / n <= 4, 'R1#13: an obstacle build runs the fairness check at most ' + maxChecks + ' times, ' + (checks / n).toFixed(2) + ' on average');
    assert(med < 15, 'R1#13: median build time ' + med.toFixed(1) + ' ms (generous bound, only catches a gross regression)'); }
  // eight / gate are mirrored so they are always passable
  { const R = CR.rng(5); let ok = true; for (let k = 0; k < 30; k++) for (const type of ['eight', 'gate']) { const o = CR.build(type, 90, R, k % 4); if (!(o.win > 0.2)) ok = false; }
    assert(ok, 'R1#6: every 8 ring and gate built leaves a real window'); }

  // R1#10: the run knows why it ended
  { const P = CR.newRun(9, 780); CR.tap(P); bot(P, 3); let k = 0; while (!P.dead && k++ < 120 * 30) { if (k % 12 === 0) CR.tap(P); CR.tick(P); }
    assert(P.dead && P.why === 'hit' && P.hitC >= 0 && P.hitC !== P.ball.c, 'R1#10: jumping into a ring ends with why=hit and the colour that was touched (' + P.hitC + ' vs ball ' + P.ball.c + ')'); }
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

  // helpers for the R1 touch checks
  const box = (t, sel) => t.p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
  const settled = (t, sel) => t.p.waitForFunction(s => { const e = document.querySelector(s); if (!e || e.closest('.hidden')) return false; const r = e.getBoundingClientRect(); if (!r.width) return false; const ov = e.closest('.ov'); return !(ov && ov.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.animationName !== 'breathe')); }, sel, { timeout: 10000 });
  const touchAt = async (t, x, y, hold = 40, id = 1) => { await t.touch('touchStart', [[x, y, id]]); await sleep(hold); await t.touch('touchEnd', [[x, y, id]]); await sleep(40); };
  const tapSel = async (t, sel, hold = 40) => { await settled(t, sel); await sleep(30); const b = await box(t, sel); await touchAt(t, b.cx, b.cy, hold); };
  const d0 = (t, how, sel) => t.p.evaluate(([how, s]) => { const e = document.querySelector(s), r = e.getBoundingClientRect(); const x = how === 'edge' ? r.left + 1 : r.left + r.width / 2, y = r.top + r.height / 2;
    const tg = how === 'el' ? e : document.elementFromPoint(x, y) || document.body; tg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y, view: window })); }, [how, sel]);
  const aria = (t, sel) => t.p.getAttribute(sel, 'aria-checked');
  const toHold = async t => { await tapSel(t, '#bPlay'); await t.waitState('ready'); await t.field(); await t.p.keyboard.press('KeyP'); await t.waitState('pause'); await tapSel(t, '#bResume'); await t.waitState('hold'); };

  // 1. corrupt storage never shows NaN or unlocks things
  {
    const t = await open({ 'colorrings.best': '1e400', 'colorrings.gems': '"many"', 'colorrings.skins': '[0,3,"2",9]', 'colorrings.skin': '2',
      'colorrings.settings': '{"pat":"yes","snd":false}', 'colorrings.stats': '{"plays":-4,"total":"x"}', 'colorrings.ach': '[1]', 'colorrings.daily': '{"date":"today","best":99}', 'colorrings.run': '"broken"' });
    const s = await t.st();
    assert(s.state === 'title' && s.best === 0 && s.gems === 0, 'infinite best and text gems fall back to 0 (best ' + s.best + ', gems ' + s.gems + ')');
    assert(await t.p.textContent('#tBest') === '0' && /\d\d\/\d\d/.test(await t.p.textContent('#tDaily')), 'title shows 0 and no bogus daily record');
    assert(s.pat === false && await t.p.getAttribute('#bMute', 'aria-label') === '音效關', 'only real booleans are taken from settings ("yes" ignored, false kept)');
    await t.tap('#bShop'); const skins = await t.p.$$eval('.skin .pr', e => e.map(x => x.textContent));
    assert(skins.length === 8 && skins[0] === '使用中' && skins[3] === '點一下使用' && /星晶/.test(skins[2]) && /星晶/.test(skins[7]), 'a skin that is not owned cannot be selected; owned ones survive; 8 skins (' + skins.join(' / ') + ')');
    await t.p.keyboard.press('Escape'); await t.p.waitForSelector('#shopOv.hidden', { state: 'attached' });
    assert(true, 'Escape closes the open panel');
    await t.tap('#bStats');
    const grid = await t.p.$$eval('#stGrid b', e => e.map(x => x.textContent)), achs = await t.p.$$eval('#achList b', e => e.map(x => x.textContent));
    assert(grid.join() === '0,0,0,0' && !achs.includes('清心寡慾') && achs.includes('見多識廣') && achs.includes('光環全覽'), 'stats read 0; achievements include the 6-kind and the new 8-kind one (' + grid.join() + ')');
    await t.ctx.close();
  }
  // old saves keep loading: skins 1..3 and the chosen skin
  {
    const t = await open({ 'colorrings.skins': '[0,1,2,3]', 'colorrings.skin': '3', 'colorrings.gems': '12', 'colorrings.best': '41' });
    const s = await t.st();
    assert(s.owned.join() === '0,1,2,3' && s.skin === 3 && s.gems === 12 && s.best === 41, 'existing colorrings.skins / skin / gems / best load unchanged (' + s.owned.join() + ')');
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
    const bx = await t.p.locator('#bPause').boundingBox();
    assert(bx.width >= 44 && bx.height >= 44, 'pause button is 44×44');
    await t.tap('#bPause', () => t.p.keyboard.press('Space')); await t.waitState('pause');
    assert((await t.st()).taps === 2, 'tapping pause does not also jump');
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
    await sleep(60);
    await t.touch('touchStart', [[150, 600, 1], [260, 640, 2]]); await t.p.waitForFunction(() => window.__game.state().taps >= 2, null, { timeout: 5000 });
    await t.touch('touchMove', [[150, 620, 1], [260, 660, 2]]); await sleep(60);
    const s = await t.st();
    assert(s.taps === 2 && s.state === 'play', 'first finger, then a second finger while the first is held: two jumps; moving them adds none');
    await t.touch('touchEnd', [[150, 620, 1], [260, 660, 2]]);
    await t.ctx.close();
  }

  // R1#1: a finger resting on the field (or the backdrop) never blocks the buttons; both release orders
  {
    const t = await open();
    const fails = [];
    const rest = async (sel, restPt, order) => {
      await settled(t, sel); const b = await box(t, sel);
      await t.touch('touchStart', [[restPt[0], restPt[1], 7]]); await sleep(90);
      await t.touch('touchStart', [[restPt[0], restPt[1], 7], [b.cx, b.cy, 1]]); await sleep(60);
      if (order === 'tapFirst') { await t.touch('touchEnd', [[b.cx, b.cy, 1]]); await sleep(80); await t.touch('touchEnd', [[restPt[0], restPt[1], 7]]); }
      else { await t.touch('touchEnd', [[restPt[0], restPt[1], 7]]); await sleep(40); await t.touch('touchEnd', [[b.cx, b.cy, 1]]); }
      await sleep(120);
    };
    for (const order of ['tapFirst', 'restFirst']) {
      await toHold(t); // the resting finger on the field is a jump; then pause while it is held
      await rest('#bPause', [80, 700], order); if ((await t.st()).state !== 'pause') fails.push('pause/' + order);
      await rest('#bResume', [20, 820], order); if ((await t.st()).state !== 'hold') fails.push('resume/' + order);
      let s0 = (await t.st()).snd; await rest('#bMute', [80, 700], order); if ((await t.st()).snd === s0) fails.push('mute/' + order);
      await t.p.keyboard.press('KeyP'); await t.waitState('pause');
      await rest('#bHome', [20, 820], order); if ((await t.st()).state !== 'title') fails.push('home/' + order);
      await rest('#bSet', [30, 300], order); if (!await t.p.isVisible('#setOv')) fails.push('set/' + order);
      const a0 = await aria(t, '#swVib'); await rest('#swVib', [20, 60], order); if (await aria(t, '#swVib') === a0) fails.push('swVib/' + order);
      await rest('#setOv [data-close]', [20, 60], order); if (await t.p.isVisible('#setOv')) fails.push('close/' + order);
    }
    assert(!fails.length, 'R1#1: with another finger held on the field or backdrop, pause / 繼續 / 音效 / 主選單 / 設定 / a switch / 關閉 each act once, both release orders' + (fails.length ? ' (failed: ' + fails.join(' ') + ')' : ''));
    // two fingers on the field still both jump
    const a = await t.st(); await tapSel(t, '#bPlay'); await t.waitState('ready');
    await t.touch('touchStart', [[120, 650, 7]]); await sleep(90); await t.touch('touchStart', [[120, 650, 7], [270, 650, 1]]); await sleep(60);
    await t.touch('touchEnd', [[270, 650, 1]]); await sleep(40); await t.touch('touchEnd', [[120, 650, 7]]); await sleep(100);
    assert((await t.st()).taps - a.taps === 2, 'R1#1: the field\'s own hold-to-jump still works for each finger (two fingers, two jumps)');
    await t.ctx.close();
  }

  // R1#2: taps 1–4 px inside a button's edge act (press feedback no longer shrinks the button); 0.6 s / 1 s holds act once
  {
    const t = await open();
    const noTransform = await t.p.evaluate(() => { const bad = []; for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.selectorText && /:active|\.press/.test(r.selectorText) && /transform/.test(r.cssText)) bad.push(r.selectorText); return bad; });
    assert(!noTransform.length, 'R1#2: no :active / .press rule moves or scales a button (' + (noTransform.join(' ') || 'none') + ')');
    const miss = [];
    const edges = (b, off) => [['L', b.x + off, b.cy], ['R', b.x + b.w - off, b.cy], ['T', b.cx, b.y + off], ['B', b.cx, b.y + b.h - off]];
    for (const [side, off] of [['L', 2], ['R', 2], ['T', 1], ['B', 4]]) {
      await settled(t, '#bPlay'); const b = await box(t, '#bPlay'); const pt = edges(b, off).find(e => e[0] === side);
      await touchAt(t, pt[1], pt[2]); await sleep(60); if ((await t.st()).state !== 'ready') miss.push('bPlay ' + side + off);
      await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    }
    await toHold(t);
    for (const [side, off] of [['L', 1], ['R', 1], ['T', 3], ['B', 1]]) {
      const b = await box(t, '#bMute'), s0 = (await t.st()).snd, pt = edges(b, off).find(e => e[0] === side);
      await touchAt(t, pt[1], pt[2]); await sleep(60); if ((await t.st()).snd === s0) miss.push('bMute ' + side + off);
    }
    for (const [side, off] of [['L', 1], ['R', 1], ['T', 2], ['B', 1]]) {
      let b = await box(t, '#bPause'), pt = edges(b, off).find(e => e[0] === side);
      await touchAt(t, pt[1], pt[2]); await sleep(60); if ((await t.st()).state !== 'pause') { miss.push('bPause ' + side + off); await t.p.keyboard.press('KeyP'); await t.waitState('pause'); }
      await settled(t, '#bResume'); b = await box(t, '#bResume'); pt = edges(b, side === 'T' ? 4 : 2).find(e => e[0] === side);
      await touchAt(t, pt[1], pt[2]); await sleep(60); if ((await t.st()).state !== 'hold') { miss.push('bResume ' + side); await tapSel(t, '#bResume'); }
    }
    assert(!miss.length, 'R1#2: taps 1–4 px inside the left / right / top / bottom edge of 開始遊戲, 音效, 暫停 and 繼續 all act' + (miss.length ? ' (missed: ' + miss.join(', ') + ')' : ''));
    // holds
    await t.p.keyboard.press('KeyP'); await t.waitState('pause'); await tapSel(t, '#bHome', 600); await t.waitState('title');
    await tapSel(t, '#bSet', 600); await sleep(80); const v0 = await aria(t, '#swVib');
    await tapSel(t, '#swVib', 1000); await sleep(80); const v1 = await aria(t, '#swVib');
    await tapSel(t, '#swVib', 600); await sleep(80); const v2 = await aria(t, '#swVib');
    assert(await t.p.isVisible('#setOv') && v1 !== v0 && v2 === v0, 'R1#2: 0.6 s and 1 s holds on 主選單, 設定 and a switch each act exactly once');
    await t.ctx.close();
  }

  // R1#3: tap then a detail-0 click (CI Chromium 141) on the control, its edge and elementFromPoint: acts once; lone detail-0 acts once; Enter works
  {
    const t = await open();
    await tapSel(t, '#bSet'); await sleep(30);
    const sw0 = await t.p.$$eval('#setOv .sw', e => e.map(x => x.getAttribute('aria-checked')).join());
    await d0(t, 'pt', '#bSet'); await sleep(60); // the point where 設定 was is now the settings sheet
    const sw1 = await t.p.$$eval('#setOv .sw', e => e.map(x => x.getAttribute('aria-checked')).join());
    assert(sw0 === sw1 && await t.p.isVisible('#setOv'), 'R1#3: a detail-0 click right after the tap that opened 設定 runs nothing on the new sheet');
    const flips = [];
    for (const sw of ['#swPat', '#swGlow', '#swVib', '#swSnd']) {
      const a0 = await aria(t, sw); await tapSel(t, sw); await sleep(30);
      for (const how of ['el', 'edge', 'pt']) await d0(t, how, sw);
      await sleep(60); flips.push(a0 !== await aria(t, sw));
    }
    assert(flips.every(Boolean), 'R1#3: each settings switch flips exactly once after tap + three detail-0 clicks (' + flips.join() + ')');
    await sleep(850);
    let a0 = await aria(t, '#swVib'); await d0(t, 'el', '#swVib'); await sleep(60);
    assert(await aria(t, '#swVib') !== a0, 'R1#3: a lone detail-0 click (no tap in the last 800 ms) acts once');
    a0 = await aria(t, '#swVib'); await t.p.focus('#swVib'); await t.p.keyboard.press('Enter'); await sleep(60);
    assert(await aria(t, '#swVib') !== a0, 'R1#3: Enter on a focused switch still toggles it');
    await tapSel(t, '#setOv [data-close]'); await sleep(30); await d0(t, 'pt', '#setOv [data-close]'); await sleep(80);
    assert(!await t.p.isVisible('#setOv') && (await t.st()).state === 'title', 'R1#3: 關閉 + detail-0 click leaves the title untouched');
    await toHold(t);
    const m0 = (await t.st()).snd; await tapSel(t, '#bMute'); for (const how of ['el', 'edge', 'pt']) await d0(t, how, '#bMute'); await sleep(60);
    assert((await t.st()).snd !== m0, 'R1#3: HUD 音效 + detail-0 clicks toggles once');
    await tapSel(t, '#bPause'); await d0(t, 'pt', '#bPause'); await sleep(80);
    assert((await t.st()).state === 'pause', 'R1#3: 暫停 + a detail-0 click on the card under the finger stays paused');
    await tapSel(t, '#bResume'); await d0(t, 'el', '#bResume'); await d0(t, 'pt', '#bResume'); await sleep(80);
    assert((await t.st()).state === 'hold', 'R1#3: 繼續 + detail-0 clicks resumes once (and the pause button under the finger is not hit)');
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
    await t.tap('#bPlay'); await t.waitState('ready'); await t.field();
    await t.p.evaluate(() => { window.__game.fastForward(4); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' })); });
    await t.waitState('pause'); await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    step('resume'); await t.tap('#bResume'); await t.waitState('hold');
    const h = await t.st(); step('field'); await t.field(); const r = await t.st();
    assert(h.score >= 4 && r.t > h.t && r.score >= h.score, 'the resumed run plays on from where it was (score ' + h.score + ')');
    await t.ctx.close();
  }

  // 4. death: banked once, result card ignores taps for a moment, then works; R1#4 ghost restart; R1#10 cause on the card
  {
    const t = await open();
    await t.tap('#bPlay'); await t.waitState('ready'); await t.field();
    // past the practice rings, then no taps; nothing left below the ball (it could otherwise fall back into a passed ring), so it falls out
    await t.p.evaluate(() => { window.__game.fastForward(4); window.__game.clearBelow(); });
    await t.waitState('over');
    assert((await t.st()).why === 'fall', 'the run ended by falling off the bottom (why ' + (await t.st()).why + ')');
    assert((await t.ls('stats')).plays === 1, 'a fall ends the run and counts one play');
    assert(/掉出畫面/.test(await t.p.textContent('#oWhy')), 'R1#10: the result card says the ball fell off the bottom (' + await t.p.textContent('#oWhy') + ')');
    await t.p.waitForFunction(() => !document.querySelector('#overOv .card').getAnimations().some(a => a.playState === 'running'));
    await t.p.evaluate(() => window.__game.overAt());
    const b = await t.p.locator('#bAgain').boundingBox();
    await t.tapAt(b.x + b.width / 2, b.y + b.height / 2); await sleep(150);
    assert((await t.st()).state === 'over', 'a tap on 再玩一次 right as the card appears is ignored (it was meant as a jump)');
    await sleep(600);
    await t.tap('#bAgain'); await t.waitState('ready');
    assert((await t.ls('stats')).plays === 1, 'a moment later 再玩一次 works, and the finished run is not counted again');
    // R1#4: a finger that goes down while the ball shatters and lifts on 再玩一次 after the card is up starts nothing
    let ghost = [];
    for (const hold of [700, 950]) {
      if ((await t.st()).state !== 'ready') { await tapSel(t, '#bAgain'); await t.waitState('ready'); }
      await t.field(); await t.p.evaluate(() => window.__game.fastForward(4)); await t.waitState('dying', 10000);
      await t.touch('touchStart', [[b.x + b.width / 2, b.y + b.height / 2, 3]]);
      await t.waitState('over', 5000); await sleep(hold);
      await t.touch('touchEnd', [[b.x + b.width / 2, b.y + b.height / 2, 3]]); await sleep(250);
      ghost.push((await t.st()).state);
      await sleep(500);
    }
    assert(ghost.every(s => s === 'over'), 'R1#4: a touch that began before the result card and lifts on 再玩一次 0.7 / 0.95 s later does not start a run (' + ghost.join() + ')');
    await tapSel(t, '#bAgain'); await t.waitState('ready');
    assert(true, 'R1#4: a fresh tap on 再玩一次 then starts the run');
    // the same rule on the pause card: a field finger held while P pauses does not tap 繼續 when it lifts there
    await t.field(); const rb = await (async () => { await t.p.keyboard.press('KeyP'); await t.waitState('pause'); await settled(t, '#bResume'); const r = await box(t, '#bResume'); await t.p.keyboard.press('KeyP'); await t.waitState('hold'); return r; })();
    await t.touch('touchStart', [[rb.cx, rb.cy, 4]]); await t.waitState('play'); await t.p.keyboard.press('KeyP'); await t.waitState('pause'); await sleep(300);
    await t.touch('touchEnd', [[rb.cx, rb.cy, 4]]); await sleep(200);
    assert((await t.st()).state === 'pause', 'R1#4: a finger that went down before the pause card appeared does not press 繼續 when it lifts on it');
    // R1#10: a hit names the colours
    await tapSel(t, '#bHome'); await t.waitState('title'); await tapSel(t, '#bPlay'); await t.waitState('ready'); await t.field();
    await t.p.evaluate(() => window.__game.fastForward(3));
    for (let k = 0; k < 150 && (await t.st()).state === 'play'; k++) { await t.p.keyboard.press('Space'); await sleep(70); }
    await t.waitState('over', 8000); const s = await t.st(), why = await t.p.textContent('#oWhy');
    assert(s.why === 'hit' ? /撞到.+色，光球是.+色/.test(why) : /掉出畫面/.test(why), 'R1#10: the card states the cause that ended the run (' + s.why + ': ' + why + ')');
    await t.ctx.close();
  }

  // 5. rotation pauses, a toolbar height change does not
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
    assert((await t.st()).br >= 8, 'R1#11: the ball is drawn at least 8 px in landscape (' + (await t.st()).br.toFixed(1) + ')');
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

  // R1#9: the shop asks before spending gems
  {
    const t = await open({ 'colorrings.gems': '170' });
    await tapSel(t, '#bShop');
    const sk = async i => { const b = await t.p.$$eval('.skin', (e, i) => { const r = e[i].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, i); await touchAt(t, b[0], b[1]); await sleep(80); };
    await sk(4); let s = await t.st();
    assert(s.gems === 170 && !s.owned.includes(4) && await t.p.isVisible('#buyBar') && /150 星晶兌換「寶石」/.test(await t.p.textContent('#buyTxt')), 'R1#9: tapping an affordable skin only asks (用 150 星晶兌換「寶石」？) and spends nothing');
    await tapSel(t, '#bBuyNo'); s = await t.st();
    assert(s.gems === 170 && !s.owned.includes(4) && !await t.p.isVisible('#buyBar'), 'R1#9: 取消 buys nothing');
    await sk(4); await tapSel(t, '#bBuy'); s = await t.st();
    assert(s.gems === 20 && s.owned.includes(4) && s.skin === 4 && (await t.ls('gems')) === 20 && (await t.ls('skins')).includes(4), 'R1#9: 確定兌換 spends 150, owns and wears the skin, and saves it');
    await sk(5); s = await t.st();
    assert(s.gems === 20 && !await t.p.isVisible('#buyBar'), 'R1#9: a skin you cannot afford asks nothing (a toast says how many are missing)');
    await t.ctx.close();
  }

  // R1#10–12: 玩法 entry, record chip, settings fit at 360×640 (or show a cue), skins fit at 320×568
  {
    const t = await open({ 'colorrings.best': '42', 'colorrings.gems': '75' }, 360, 640);
    const rec = await t.p.evaluate(() => { const r = document.querySelector('.rec'); const k = [...r.children].map(c => c.getBoundingClientRect()); return { gaps: [k[1].left - k[0].right, k[2].left - k[1].right], text: r.textContent }; });
    assert(Math.abs(rec.gaps[0] - rec.gaps[1]) < 1 && rec.text === '最高42星晶75', 'R1#11: the record chip has equal gaps around its dot (' + rec.gaps.map(g => g.toFixed(1)).join(' / ') + ')');
    await tapSel(t, '#bHelp'); await sleep(80);
    assert(await t.p.isVisible('#helpOv') && /同色/.test(await t.p.textContent('#helpOv')), 'R1#10: the title has a 玩法 button that opens the rules');
    const hl = await t.p.evaluate(() => { const l = document.querySelector('#helpOv .list'); return { scroll: l.scrollHeight > l.clientHeight + 4, more: l.classList.contains('more'), cue: !document.querySelector('#helpOv .morecue').classList.contains('hidden') }; });
    assert(!hl.scroll || (hl.more && hl.cue), 'R1#12: 玩法 at 360×640 either fits or fades out with a 往下捲動 cue (' + JSON.stringify(hl) + ')');
    await t.p.evaluate(() => { const l = document.querySelector('#helpOv .list'); l.scrollTop = l.scrollHeight; });
    await sleep(100);
    assert(!await t.p.evaluate(() => document.querySelector('#helpOv .list').classList.contains('more')), 'R1#12: the cue goes away at the end of the list');
    await tapSel(t, '#helpOv [data-close]'); await tapSel(t, '#bSet'); await sleep(80);
    const st = await t.p.evaluate(() => { const l = document.querySelector('#setOv .list'); return { fits: l.scrollHeight <= l.clientHeight + 1, cue: l.classList.contains('more') }; });
    assert(st.fits || st.cue, 'R1#12: settings at 360×640 show every switch without cutting off (' + JSON.stringify(st) + ')');
    await t.ctx.close();
    const u = await open({}, 320, 568);
    await tapSel(u, '#bShop'); await sleep(100);
    const over = await u.p.evaluate(() => { const g = document.getElementById('skins').getBoundingClientRect(); return Math.max(...[...document.querySelectorAll('.skin')].map(s => s.getBoundingClientRect().right - g.right)); });
    assert(over <= 0.5, 'R1#12: at 320×568 every skin stays inside the shop (' + over.toFixed(1) + ' px past the edge)');
    await u.ctx.close();
  }

  await browser.close();
  assert(!errors.length, 'no page or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `FAIL ${fails} check(s) failed` : 'all color-rings checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
