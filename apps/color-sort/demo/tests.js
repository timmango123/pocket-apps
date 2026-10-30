// 鍊金藥劑室：上架複審修正的回歸測試（node tests.js，約 40 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http。
// 1) Node：死路偵測不會誤判（有限搜尋說「無解」時，照遊戲規則的完整搜尋也必須無解）；解題器不再剪掉「整管倒進較小空管」
// 2) 頁面：點選→倒水、倒水動畫中連點、試管間的空隙吸附、提示不重複扣、走到一半重新整理接續（含 pagehide）、
//    重來要按兩次、死路提醒、無限悔棋關掉後仍限 ★★、過關當下就記錄、壞掉的存檔、各尺寸點擊間距 ≥ 44px
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

// ---------- 1. core (node) ----------
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {csInit, csSolve, csPour, csWon, csMoves};')();
const LEVELS = JSON.parse(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1]);
const ld = L => ({ tubes: L.t.split('/'), caps: L.c.split('').map(Number), hid: L.h.split(',').map(x => parseInt(x, 36) || 0), fz: L.f.split('').map(Number) });
// plain search with the game's own move rules (no pruning): can this position still be won?
function winnable(S0, max) {
  const key = S => S.t.map(t => t.join(',')).join('|'), seen = new Set([key(S0)]), q = [S0];
  while (q.length) {
    const S = q.pop(); if (core.csWon(S)) return true;
    for (const [a, b] of core.csMoves(S)) { const N = core.csPour(S, a, b).S, k = key(N); if (!seen.has(k)) { seen.add(k); q.push(N); if (seen.size > max) return null; } }
  }
  return false;
}
{
  let seed = 11; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  let dead = 0, wrong = 0, checked = 0;
  for (const n of [5, 12, 21, 30, 41, 55, 61, 66, 71, 75, 85, 95]) for (let g = 0; g < 12; g++) {
    let S = core.csInit(ld(LEVELS[n - 1]));
    for (let k = 0; k < 50; k++) {
      const m = core.csMoves(S); if (!m.length) break;
      const mv = m[Math.floor(rnd() * m.length)]; S = core.csPour(S, mv[0], mv[1]).S; if (core.csWon(S)) break;
      if (core.csSolve(S, { limit: 3000, w: 3 }) === null) { dead++; const w = winnable(S, 300000); if (w !== null) { checked++; if (w) wrong++; } break; }
    }
  }
  assert(dead > 20 && checked === dead && wrong === 0, `死路偵測：隨機亂倒走到 ${dead} 個「解不開」的局面，完整搜尋確認 ${checked} 個全都真的無解（誤判 ${wrong}）`);
  // a pure stack moving whole into a smaller empty tube frees the big one; the solver used to skip that move and called
  // this position unsolvable (which the dead-end warning would then have repeated)
  const D = { tubes: ['b', 'ba', 'aa'], caps: [3, 4, 2], hid: [], fz: [] };
  const r = core.csSolve(core.csInit(D), { limit: 100000 });
  eq([!!(r && r.len > 0), winnable(core.csInit(D), 100000)], [true, true], '解題器會「整管倒進較小的空管」：這個局面算得出解（以前算成無解）');
}

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(APP)); });
  srv.unref();
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const SEEN = { basic: 1, cap5: 1, hidden: 1, mixed: 1, one: 1, frozen: 1 };
  async function open(w = 390, h = 844, store = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(st => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in st) localStorage.setItem('colorsort.' + k, JSON.stringify(st[k])); } },
      Object.assign({ seen: SEEN, unlockAll: true, settings: { sound: false, vib: false } }, store));
    const cdp = await ctx.newCDPSession(p);
    const touch = async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(30);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const load = async () => {
      await p.goto(URL); await p.waitForFunction(() => window.__game);
      await p.evaluate(() => { window.__clicks = {}; document.addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id) __clicks[b.id] = (__clicks[b.id] || 0) + 1; }, true); });
    };
    await load();
    const st = () => p.evaluate(() => Object.assign(__game.state(), __game.more()));
    const until = (fn, arg, timeout = 10000) => p.waitForFunction(fn, arg, { timeout });
    // a button that is on screen and done animating in; returns once its click has arrived
    const tap = async sel => {
      await until(s => { const e = document.querySelector(s); if (!e || e.disabled) return false; const r = e.getBoundingClientRect(); if (!r.width || e.closest('.hidden')) return false;
        const ov = e.closest('.ov'), card = e.closest('.card'); return ![ov, card].some(x => x && x.getAnimations().some(a => a.playState === 'running')); }, sel);
      const id = await p.$eval(sel, e => e.id), n = await p.evaluate(id => __clicks[id] || 0, id);
      const b = await p.locator(sel).boundingBox(); await touch(b.x + b.width / 2, b.y + b.height / 2);
      await until(([id, n]) => (__clicks[id] || 0) > n, [id, n]);
    };
    const tube = i => p.evaluate(i => __game.tubeCenter(i), i);
    const tapTube = async i => { const c = await tube(i); await touch(c.x, c.y); };
    // one pour by touch: select, wait for the lift, then tap the target and wait until the move counts
    const pour = async ([a, b]) => {
      const m = (await st()).moves;
      await tapTube(a); await until(a => __game.state().sel === a, a);
      await tapTube(b); await until(m => __game.state().moves > m, m);
    };
    const idle = () => until(() => !__game.state().animating);
    const level = async n => { await p.evaluate(n => __game.startLevel(n), n); await until(n => __game.state().level === n && __game.state().status === 'play', n); };
    const toast = re => until(re => !document.getElementById('toast').classList.contains('hidden') && new RegExp(re).test(document.getElementById('toast').textContent), re);
    const solve = () => p.evaluate(() => __game.solve());
    return { ctx, p, touch, st, until, tap, tube, tapTube, pour, idle, level, toast, solve, load };
  }

  // 2. 點選→倒水；倒水動畫中連點下一步；試管間空隙吸附
  {
    const t = await open();
    await t.level(2); const sol = await t.solve();
    await t.p.evaluate(() => { window.__downAnim = []; document.getElementById('cv').addEventListener('pointerdown', () => __downAnim.push(__game.state().animating), true); });
    await t.pour(sol[0]);
    eq((await t.st()).mv, [sol[0]], '點一支、再點另一支：倒了一次');
    // next move while the first pour is still animating
    await t.pour(sol[1]);
    const d = await t.p.evaluate(() => __downAnim);
    assert(d[2] === true, '（第二步的第一下確實點在倒水動畫中）');
    await t.idle();
    eq((await t.st()).mv, sol.slice(0, 2), '倒水動畫中連點：第二步照樣算，沒有被吃掉或算兩次');
    // tap in the gap next to a tube: snaps to the nearest tube instead of dropping the selection
    const L = await t.p.evaluate(() => __game.layout());
    const a = sol[2][0], row = L.rows.find(r => a >= r.from && a < r.to), c = await t.tube(a);
    const dir = a < row.to - 1 ? 1 : -1;
    await t.touch(c.x + dir * row.pitch * 0.45, c.y); await t.until(a => __game.state().sel === a, a);
    eq((await t.st()).sel, a, `點在第 ${a + 1} 支試管旁的空隙（間距 ${row.pitch.toFixed(0)}px 的 45%）：選到最近的那支`);
    await t.touch(c.x, row.top - 70); await t.until(() => __game.state().sel === -1);
    eq((await t.st()).sel, -1, '點試管上方的空白處：取消選取');

    // 3. 提示：箭頭還在時再按不另外扣
    await t.tap('#bHint'); await t.until(() => __game.more().hint);
    const h1 = await t.st();
    await t.tap('#bHint'); await t.toast('不另外扣次數');
    const h2 = await t.st();
    eq([h1.hints, h2.hints, h2.hint], [1, 1, h1.hint], '提示用掉 1 次；箭頭還在時再按一次：不再扣');

    // 4. 走到一半重新整理：標題是「繼續第 2 關」，接回同一局面（步數、悔棋、提示次數）
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    await t.p.evaluate(() => { window.__clicks = {}; document.addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id) __clicks[b.id] = (__clicks[b.id] || 0) + 1; }, true); });
    eq(await t.p.textContent('#tPlay'), '繼續第 2 關', '重新整理後：標題主按鈕是「繼續第 2 關」');
    await t.tap('#tPlay'); await t.until(() => __game.state().status === 'play');
    let s = await t.st();
    eq([s.level, s.moves, s.mv, s.hints, s.undos], [2, 2, sol.slice(0, 2), 1, 5], '接回同一局面：步數、走法、提示與悔棋次數都一樣');
    await t.tap('#bUndo'); await t.until(() => __game.state().moves === 1);
    eq([(await t.st()).mv, (await t.st()).undos], [sol.slice(0, 1), 4], '接續後悔棋：退回上一步，悔棋次數扣 1');
    // pagehide while a pour is still animating: that pour is saved
    await t.pour(sol[1]);
    const anim = (await t.st()).animating;
    await t.p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await t.p.reload(); await t.p.waitForFunction(() => window.__game); await t.p.click('#tPlay');
    await t.until(() => __game.state().status === 'play');
    s = await t.st();
    eq([anim, s.mv, s.undos], [true, sol.slice(0, 2), 4], '倒水動畫中 pagehide：那一步有存到');

    // 5. 重來：有步數時要按兩次
    await t.p.evaluate(() => { window.__clicks = {}; document.addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id) __clicks[b.id] = (__clicks[b.id] || 0) + 1; }, true); });
    await t.tap('#bRestart'); await t.toast('再按一次');
    eq((await t.st()).moves, 2, '按一次重來：只提示「再按一次」，步數還在');
    await t.tap('#bRestart'); await t.until(() => __game.state().moves === 0);
    s = await t.st();
    eq([s.moves, s.hints, s.undos], [0, 1, 5], '再按一次：回到起點；提示次數不會因重來補滿');
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    eq(await t.p.textContent('#tPlay'), '開始調配', '重來後重新整理：沒有可接續的步數');
    await t.p.click('#tPlay'); await t.until(() => __game.state().status === 'play');
    eq((await t.st()).hints, 1, '重新整理再進同一關：提示次數仍是 1（沒有被重新整理補滿）');
    await t.ctx.close();
  }

  // 6. 死路：還有合法步但已經解不開 → 提醒；「先看看」可關掉，悔棋可救回
  {
    const t = await open();
    await t.level(71);
    await t.pour([1, 10]);
    await t.until(() => __game.state().status === 'stuck' && !document.getElementById('stuck').classList.contains('hidden'));
    const s = await t.st();
    eq([s.dead, await t.p.textContent('#kTitle'), (await t.p.evaluate(() => __game.legal())).length > 0], ['dead', '這局解不開了', true],
      '第 71 關第一步把第 2 支倒進唯一的空管：還能倒，但提醒「這局解不開了」');
    await t.tap('#kLook'); await t.until(() => __game.state().status === 'play');
    await t.p.waitForTimeout(700);
    eq([(await t.st()).status, await t.p.isVisible('#stuck')], ['play', false], '按「先看看局面」：關掉提醒，同一局面不會一直跳出來');
    await t.tap('#bUndo'); await t.until(() => __game.state().moves === 0);
    await t.p.waitForTimeout(300);
    eq([(await t.st()).status, (await t.st()).undos], ['play', 4], '悔棋回去：不再提醒');
    await t.ctx.close();
  }

  // 7. 無限悔棋用過再關掉：仍然最多 ★★；過關當下就記錄（不必等結算卡出來）
  {
    const t = await open();
    await t.level(3); const sol = await t.solve();
    await t.tap('#bMenu'); await t.tap('#swInf'); await t.tap('#mResume');
    await t.pour(sol[0]); await t.idle();
    await t.tap('#bUndo'); await t.until(() => __game.state().moves === 0);
    eq([(await t.st()).infUsed, await t.p.textContent('#nUndo')], [true, '∞'], '無限悔棋模式悔了一步');
    await t.tap('#bMenu'); await t.tap('#swInf'); await t.tap('#mResume');
    eq(await t.p.textContent('#nUndo'), '5', '關掉無限悔棋');
    for (const mv of sol) await t.pour(mv);
    await t.until(() => __game.state().status === 'won');
    const early = await t.p.evaluate(() => [JSON.parse(localStorage.getItem('colorsort.progress'))[3], JSON.parse(localStorage.getItem('colorsort.stars'))[3], document.getElementById('win').classList.contains('hidden')]);
    eq(early, [sol.length, 2, true], `用最少的 ${sol.length} 步過關：結算卡出來前就記錄了，且只有 ★★`);
    await t.until(() => !document.getElementById('win').classList.contains('hidden'));
    eq(await t.p.$$eval('#wStars .on', e => e.length), 2, '結算卡顯示 ★★');
    assert(/無限悔棋/.test(await t.p.textContent('#wMsg')), '結算卡說明為什麼只有 ★★');
    await t.ctx.close();
  }

  // 8. 壞掉的存檔與紀錄：略過，不出現 NaN，也不報錯
  {
    const t = await open(390, 844, {
      progress: { 1: 5, 2: 'x', 999: 3, 3: -1 }, stars: { 1: 7 }, settings: { sound: 'no', theme: 'neon', pattern: 1 }, stats: { pours: 'NaN', clears: -3 },
      saves: { 4: { m: [[0, 9]], u: 5, hi: 2 }, 5: 'junk', 6: { m: [[0, 3]], u: 3, hi: 1, b: false } }, unlockAll: 'yes'
    });
    eq(await t.p.textContent('#tPlay'), '繼續第 2 關', '只有合法的第 1 關紀錄算數：繼續第 2 關');
    await t.p.click('#tSelect');
    assert((await t.p.textContent('#selSum')).startsWith('已完成 1 / 100 關・三星 0 關'), '選關摘要：已完成 1 / 100 關・三星 0 關（壞資料被略過）');
    eq(await t.p.$$eval('.lt.lock', e => e.length), 98, '「解鎖全部」不是 true：照常上鎖');
    await t.p.click('#sBack'); await t.p.click('#tMenu');
    eq([await t.p.getAttribute('#swSound', 'aria-checked'), await t.p.getAttribute('#swPattern', 'aria-checked'), await t.p.getAttribute('#segTheme [data-v="auto"]', 'aria-pressed')],
      ['true', 'false', 'true'], '型別錯的設定還原成預設值');
    assert(!/NaN|undefined/.test(await t.p.textContent('#statsG')), '統計沒有 NaN');
    await t.p.click('#mResume');
    await t.level(4); eq((await t.st()).moves, 0, '走不通的存檔（試管編號超出）不接續，從頭開始');
    await t.level(6); const s = await t.st();
    eq([s.moves, s.undos, s.hints], [1, 3, 1], '合法的存檔照常接續');
    await t.ctx.close();
  }

  // 9. 點擊間距：最多試管的關卡加上小試管，各種尺寸相鄰試管中心都 >= 44px，全部在上下列之間、畫面之內
  for (const [w, h] of [[375, 500], [390, 610], [390, 844], [320, 568], [844, 390], [667, 375]]) {
    const t = await open(w, h);
    let worst = 1e9, inside = true;
    for (const n of [40, 70, 100]) {
      await t.level(n);
      for (const extra of [0, 1]) {
        if (extra) { await t.tap('#bTube'); await t.until(() => __game.more().bonus); }
        const L = await t.p.evaluate(() => Object.assign(__game.layout(), { hud: document.getElementById('hud').getBoundingClientRect().bottom, bar: document.getElementById('bottom').getBoundingClientRect().top }));
        for (const r of L.rows) if (r.to - r.from > 1) worst = Math.min(worst, r.pitch);
        for (const q of L.pos) if (q.top < L.hud || q.by > L.bar || q.cx - L.w / 2 < 0 || q.cx + L.w / 2 > w) inside = false;
      }
    }
    assert(worst >= 44 && inside, `${w}×${h}：第 40／70／100 關（含加小試管）相鄰試管間距最小 ${worst.toFixed(0)}px，全部在畫面內`);
    await t.ctx.close();
  }

  await browser.close();
  assert(!errors.length, '沒有頁面錯誤' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
