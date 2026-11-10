// 夜市花燈：上架評分 toFix 的回歸測試（node tests.js，約 60 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
// 只等條件、不靠固定延遲；不從牆鐘幀間隔算任何時間敏感的值。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
let fails = 0;
// the page's own chase-guide code (computeGuide), run in Node over every chaseable level: following it must solve the board
function guideSweep() {
  const core = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
  const gsrc = html.match(/(function chaseable[\s\S]*?)\nfunction setGuide/)[1];
  const K = new Function(core + '\nvar G = null, guideOn = true;\n' + gsrc + '\nreturn { buildBoard, initCells, press, solved, levelDef, chaseable, step: function (g) { G = g; computeGuide(); return G.guide; } };')();
  let bad = [], levels = 0, worst = 0;
  for (let n = 1; n <= LEVELS.length; n++) {
    const def = K.levelDef(LEVELS[n - 1]), B = K.buildBoard(def); if (!K.chaseable(B)) continue; levels++;
    const g = { B, s: K.initCells(B, def.start), guidePlan: null, usedSolve: false, done: false }; let taps = 0;
    while (!K.solved(B, g.s) && taps < 2000) {
      const gd = K.step(g); if (!gd) break; const c = gd.cells[0];
      for (let k = 0; k < c.k; k++) { K.press(B, g.s, c.i); taps++; }
      if (g.guidePlan) { const e = g.guidePlan.find(q => q.i === c.i); if (e) e.k = 0; }
    }
    if (!K.solved(B, g.s)) bad.push(n); worst = Math.max(worst, taps / LEVELS[n - 1][7]);
  }
  return { levels, bad, worst };
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const ALLINTRO = { basic: 1, chase: 1, tri: 1, var: 1, hex: 1, hex3: 1, mix: 1 };
const dk = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

(async () => {
  { const r = guideSweep(); assert(r.levels === 55 && !r.bad.length, `追燈導引：照著點能解完全部 ${r.levels} 個方格十字關（含三色），最多 ${r.worst.toFixed(1)}× 最少步數` + (r.bad.length ? ' 失敗 ' + r.bad : '')); }
  const browser = await chromium.launch();
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: o.scheme || 'dark' });
    const store = Object.assign({ intro: ALLINTRO, unlockAll: true }, o.store || {});
    await ctx.addInitScript(st => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in st) localStorage.setItem('fliplights.' + k, JSON.stringify(st[k])); } }, store);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1 })) });
    const st = () => p.evaluate(() => __game.state());
    const cell = i => p.evaluate(i => __game.cell(i), i);
    const tapXY = async (x, y) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); };
    const tapCell = async i => { const c = await cell(i); await tapXY(c.x, c.y); };
    const allCells = () => p.evaluate(() => { const a = []; for (let i = 0; i < __game.n(); i++) a.push(__game.cell(i)); return a; });
    const tapEl = async sel => { const b = await p.locator(sel).boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
    const vis = sel => p.isVisible(sel);
    const level = async n => {
      if (!(await vis('#select'))) { if (await vis('#title')) await tapEl('#tSelect'); else await p.evaluate(() => document.getElementById('pSelect').click()); }
      await p.waitForSelector('#select:not(.hidden)');
      await p.locator(`.lt[data-n="${n}"]`).scrollIntoViewIfNeeded(); await tapEl(`.lt[data-n="${n}"]`);
      await p.waitForFunction(n => __game.state().level === n, n);
    };
    const playSolution = async () => { const seq = await p.evaluate(() => __game.solution()), c = await allCells(); for (const i of seq) await tapXY(c[i].x, c[i].y); };
    const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('fliplights.' + k)), k);
    return { ctx, p, cdp, touch, st, cell, allCells, tapXY, tapCell, tapEl, vis, level, playSolution, ls };
  }
  const waitWin = t => t.p.waitForSelector('#win:not(.hidden)', { timeout: 30000 });

  // 1. 兩指重疊（A 下、B 下、A 放、B 放）：每一指都要算
  {
    const t = await open();
    await t.level(25);
    const a = await t.cell(0), b = await t.cell((await t.p.evaluate(() => __game.n())) - 1);
    const m0 = (await t.st()).moves;
    for (let k = 0; k < 8; k++) {
      await t.touch('touchStart', [[a.x, a.y, 1]]);
      await t.touch('touchStart', [[a.x, a.y, 1], [b.x, b.y, 2]]);
      await t.touch('touchEnd', [[b.x, b.y, 2]]);
      await t.touch('touchEnd', []);
    }
    assert((await t.st()).moves - m0 === 16, `兩指重疊 8 次 → +${(await t.st()).moves - m0} 步（應 16）`);

    // 2. 進行中盤面保存：L30 點 12 下 → 重新整理 → 主畫面「繼續第 30 關（12 步）」→ 同一盤 12 步
    await t.level(30);
    for (let k = 0; k < 12; k++) await t.tapCell(k);
    const sol = await t.p.evaluate(() => __game.solution().join(','));
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    const lbl = await t.p.textContent('#tPlay');
    assert(lbl.includes('繼續第 30 關') && lbl.includes('12 步'), '重新整理後主畫面按鈕：' + lbl);
    await t.tapEl('#tPlay'); await t.p.waitForFunction(() => __game.state().level === 30);
    const s30 = await t.st();
    assert(s30.moves === 12 && (await t.p.evaluate(() => __game.solution().join(','))) === sol, `接續 L30：${s30.moves} 步、盤面相同`);
    // 另一關的進度不會覆蓋 L30
    await t.level(31); for (let k = 0; k < 3; k++) await t.tapCell(k);
    await t.level(30); assert((await t.st()).moves === 12, '玩過第 31 關後回到 L30 仍是 12 步');

    // 3. 重來要確認：第一下只變「確定？」且按鈕不變寬，第二下才清空
    const w0 = (await t.p.locator('#bRestart').boundingBox()).width;
    await t.tapEl('#bRestart');
    const w1 = (await t.p.locator('#bRestart').boundingBox()).width;
    assert((await t.st()).moves === 12 && (await t.p.textContent('#rsLbl')) === '確定？' && Math.abs(w1 - w0) < 0.5, `重來第一下不清盤、按鈕寬 ${w0}→${w1}`);
    await t.tapEl('#bRestart'); await t.p.waitForFunction(() => __game.state().moves === 0);
    assert(!(await t.ls('mid')).L['30'], '確認重來後 L30 存檔清掉');
    // 暫停選單的「重來」也一樣要確認
    for (let k = 0; k < 5; k++) await t.tapCell(k);
    await t.tapEl('#bMenu'); await t.p.waitForSelector('#pause:not(.hidden)');
    await t.tapEl('#pRestart');
    assert((await t.st()).moves === 5 && (await t.p.textContent('#pRestart')) === '確定重來？' && await t.vis('#pause'), '暫停選單重來第一下只問確定（5 步還在）');
    await t.tapEl('#pRestart'); await t.p.waitForFunction(() => __game.state().moves === 0 && __game.state().status === 'play');
    assert(!(await t.vis('#pause')), '暫停選單重來第二下才清盤');

    // 4. 每日挑戰點 6 下重新整理也接續
    await t.p.evaluate(() => document.getElementById('pHome').click());
    await t.tapEl('#tDaily'); await t.p.waitForFunction(() => __game.state().mode === 'daily');
    for (let k = 0; k < 6; k++) await t.tapCell(k * 2);
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    assert((await t.p.textContent('#tDaily')).includes('6 步'), '主畫面每日按鈕：' + await t.p.textContent('#tDaily'));
    await t.tapEl('#tDaily'); await t.p.waitForFunction(() => __game.state().mode === 'daily');
    assert((await t.st()).moves === 6, '每日挑戰接續 6 步');
    await t.ctx.close();
  }

  // 5. 提示：重來不補回；用了提示就算最少步數也最多兩星，過關卡寫出用了幾次
  {
    const t = await open();
    await t.level(40);
    await t.tapEl('#bHint'); await t.tapEl('#bHint');
    assert((await t.st()).hints === 1, 'L40 用 2 次提示後剩 1');
    await t.tapEl('#bRestart'); await t.p.waitForFunction(() => __game.state().moves === 0);
    assert((await t.st()).hints === 1 && (await t.p.textContent('#hHints')) === '1', '重來後提示仍是 1（不補回）');
    await t.level(13);
    for (let k = 0; k < 3; k++) await t.tapEl('#bHint');
    await t.playSolution(); await waitWin(t);
    const s = await t.st(), msg = await t.p.textContent('#wMsg');
    assert(s.moves === LEVELS[12][7] && s.stars === 2 && (await t.p.locator('#wStars .on').count()) === 2, `L13 用滿 3 次提示再最少步數 → ${s.stars} 星`);
    assert(msg.includes('用了 3 次提示'), '過關卡：' + msg);
    // 6. 兩星門檻 = 最少 ×2：L10 照解答＋同一盞點兩下（盤面不變，多 2 步）
    await t.tapEl('#wSelect'); await t.level(10);
    const m = LEVELS[9][7]; await t.tapCell(0); await t.tapCell(0); await t.tapCell(1); await t.tapCell(1);
    await t.playSolution(); await waitWin(t);
    const s10 = await t.st();
    assert(s10.moves === m + 4 && s10.stars === 2, `L10 最少 ${m}、用 ${s10.moves} 步 → ${s10.stars} 星（≤ 最少×2 拿兩星）`);
    // 過關當下就存檔（不等煙火動畫）
    await t.tapEl('#wSelect'); await t.level(1);
    await t.playSolution(); await t.p.waitForFunction(() => __game.state().status !== 'play');
    const p1 = await t.ls('progress'), stNow = (await t.st()).status;
    assert(p1 && p1['1'] === LEVELS[0][7] && stNow === 'winning', `解開當下（${stNow}）第 1 關最佳已存：${p1 && p1['1']}`);
    await t.ctx.close();
  }

  // 7. 播放解答：可暫停；過關不記最佳與效率
  {
    const t = await open();
    await t.level(9);
    for (let k = 0; k < 3; k++) await t.tapEl('#bHint');
    await t.tapEl('#bHint'); await t.p.waitForSelector('#solveAsk:not(.hidden)'); await t.tapEl('#sYes');
    await t.p.waitForFunction(() => __game.state().moves >= 2);
    await t.tapEl('#bMenu'); await t.p.waitForSelector('#pause:not(.hidden)');
    const mv = (await t.st()).moves;
    await t.p.waitForFunction(() => { window.__fr = (window.__fr || 0) + 1; return window.__fr > 40; }, null, { polling: 'raf' });
    assert((await t.st()).status === 'paused' && (await t.st()).moves === mv, `播放解答中按 ☰ 會暫停（停在 ${mv} 步）`);
    await t.tapEl('#pResume'); await waitWin(t);
    const prog = await t.ls('progress');
    assert(prog['9'] === 0 && (await t.p.textContent('#wBest')) === '—', '播放解答過關：算過關但不記最佳（progress=0、最佳顯示 —）');
    await t.tapEl('#wSelect'); await t.p.evaluate(() => document.getElementById('sBack').click()); await t.tapEl('#tStats');
    assert((await t.p.textContent('#stGrid')).includes('0%平均效率'), '平均效率不把播放解答算 100%');
    await t.ctx.close();
  }

  // 8. 解鎖全部直接跳到後面章節也會出機制卡
  {
    const t = await open({ store: { intro: { basic: 1 } } });
    await t.level(60); assert(await t.vis('#intro') && (await t.p.textContent('#iTitle')) === '變體作用', '直接進 L60 出「變體作用」卡');
    await t.tapEl('#iOk'); await t.level(99); assert(await t.vis('#intro') && (await t.p.textContent('#iTitle')) === '混合作用', '直接進 L99 出「混合作用」卡');
    await t.tapEl('#iOk');
    // 9. 追燈導引：第 7 關卡片可開導引；照導引點就能過關，最多兩星
    await t.level(7); assert((await t.p.textContent('#iTitle')).includes('追燈'), 'L7 出追燈法教學卡');
    await t.tapEl('#iGuide');
    const followGuide = async max => { const cs = await t.allCells(); let n = 0;
      for (;;) { const g = await t.p.evaluate(() => __game.state().solved ? null : __game.guide()); if (!g || n >= max) return n; const c = g.cells[0]; for (let k = 0; k < c.k; k++) { await t.tapXY(cs[c.i].x, cs[c.i].y); n++; } } };
    let taps = await followGuide(200);
    await waitWin(t);
    assert((await t.st()).stars <= 2 && taps > 0, `照追燈導引 ${taps} 下過 L7，${(await t.st()).stars} 星`);
    await t.ctx.close();
  }

  // 10. 每日連續天數；壞掉的自由盤設定
  {
    const d1 = new Date(); d1.setDate(d1.getDate() - 1); const d2 = new Date(); d2.setDate(d2.getDate() - 2);
    const t = await open({ store: { daily: { [dk(d1)]: 30, [dk(d2)]: 31 }, free: { size: 99, p: 7 } } });
    // play today's board up to one press before the end (saved as an in-progress daily), reload, finish with one tap
    await t.tapEl('#tDaily'); await t.p.waitForFunction(() => __game.state().mode === 'daily');
    const seq = await t.p.evaluate(() => __game.solution()), last = seq.pop();
    await t.p.evaluate(() => { document.getElementById('bMenu').click(); document.getElementById('pHome').click(); });
    await t.p.evaluate(h => { const m = JSON.parse(localStorage.getItem('fliplights.mid')) || { L: {} }; const d = new Date(); m.D = { day: d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(), h, u: 0, gd: 0 }; localStorage.setItem('fliplights.mid', JSON.stringify(m)); }, seq);
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    await t.tapEl('#tDaily'); await t.p.waitForFunction(n => __game.state().mode === 'daily' && __game.state().moves === n, seq.length);
    await t.tapCell(last); await waitWin(t);
    assert((await t.p.textContent('#wMsg')).includes('連續 3 天'), '每日挑戰：' + await t.p.textContent('#wMsg'));
    await t.tapEl('#wNext'); await t.tapEl('#tFree');
    assert((await t.p.getAttribute('#fSize .chip:nth-child(3)', 'aria-pressed')) === 'true', '壞掉的 fliplights.free 讀成預設 5×5');
    await t.tapEl('#fGo'); await t.p.waitForFunction(() => __game.state().mode === 'free');
    assert(await t.p.evaluate(() => __game.n()) === 25, '自由盤生成 5×5');
    for (let k = 0; k < 2; k++) await t.tapCell(k);
    await t.p.evaluate(() => document.getElementById('bMenu').click()); await t.p.evaluate(() => document.getElementById('pHome').click());
    await t.tapEl('#tFree'); assert(await t.vis('#fResume'), '自由盤有「繼續上一盤」');
    await t.tapEl('#fGo'); assert((await t.p.textContent('#fGo')).includes('放棄'), '有進度時重新生成要再按一次確認');
    await t.tapEl('#fResume'); await t.p.waitForFunction(() => __game.state().mode === 'free');
    assert((await t.st()).moves === 2, '繼續上一盤 2 步');
    await t.ctx.close();
  }

  // 11. 360×640 標題：吊燈籠不壓字、下排燈籠不被按鈕蓋；盤面靜止時不再每幀重畫；開局沒有蓋住燈籠的 toast
  {
    const t = await open({ w: 360, h: 640 });
    const r = await t.p.evaluate(() => { const g = __game.title(), h1 = document.querySelector('.ttl h1').getBoundingClientRect(), sub = document.querySelector('.ttl .sub').getBoundingClientRect(), b = document.getElementById('tPlay').getBoundingClientRect();
      return { rowBottom: g.geo.y0 + 28 + g.geo.r * 3.3, h1top: h1.top, y3: g.y3, R3: g.R3, sub: sub.bottom, btn: b.top }; });
    assert(r.rowBottom <= r.h1top, `吊燈籠底 ${r.rowBottom.toFixed(0)} ≤ 標題頂 ${r.h1top.toFixed(0)}`);
    assert(!r.R3 || (r.y3 - 1.6 * r.R3 >= r.sub && r.y3 + 1.75 * r.R3 <= r.btn), `下排燈籠 ${(r.y3 - 1.6 * r.R3).toFixed(0)}–${(r.y3 + 1.75 * r.R3).toFixed(0)} 在 ${r.sub.toFixed(0)}–${r.btn.toFixed(0)} 之間`);
    await t.level(10);
    assert(!(await t.vis('#toast')), '開關卡沒有蓋住最上排的 toast');
    await t.p.waitForFunction(() => !__game.state().animating && document.getElementById('toast').classList.contains('hidden'));
    const cnt = await t.p.evaluate(() => new Promise(res => { let f = 0; const d0 = __game.drawn(); const step = () => { if (++f >= 60) res({ f, d: __game.drawn() - d0 }); else requestAnimationFrame(step); }; requestAnimationFrame(step); }));
    assert(cnt.d > 0 && cnt.d <= cnt.f / 2 + 2, `靜止盤面 ${cnt.f} 幀只重畫 ${cnt.d} 次`);
    // 接續的提示放在目標列上（不壓燈籠）
    for (let k = 0; k < 2; k++) await t.tapCell(k);
    await t.p.reload(); await t.p.waitForFunction(() => window.__game); await t.tapEl('#tPlay'); await t.p.waitForSelector('#toast:not(.hidden)');
    const ov = await t.p.evaluate(() => { const r = document.getElementById('toast').getBoundingClientRect(); let hit = 0; for (let i = 0; i < __game.n(); i++) { const c = __game.cell(i), h = c.pitch * 0.42; if (c.x + h > r.left && c.x - h < r.right && c.y + h > r.top && c.y - h < r.bottom) hit++; } return hit; });
    assert(ov === 0, `接續 toast 蓋到 ${ov} 盞燈籠`);
    await t.ctx.close();
  }

  // 11b. 大廳小視窗：標題的按鈕不用捲動
  for (const [w, h] of [[375, 500], [390, 610]]) {
    const t = await open({ w, h });
    const r = await t.p.evaluate(() => ({ b: document.getElementById('tHelp').getBoundingClientRect().bottom, h: innerHeight, sc: document.getElementById('title').scrollHeight - document.getElementById('title').clientHeight }));
    assert(r.b <= r.h && r.sc <= 0, `${w}×${h} 標題：玩法說明底 ${r.b.toFixed(0)} ≤ ${r.h}，不用捲動`);
    await t.ctx.close();
  }

  // 12. 844×390 過關卡不用捲就看得到「分享成績」
  {
    const t = await open({ w: 844, h: 390, scheme: 'light' });
    await t.level(2); await t.playSolution(); await waitWin(t);
    const b = await t.p.evaluate(() => { const c = document.querySelector('#win .card'), s = document.getElementById('wShare').getBoundingClientRect(); return { sh: c.scrollHeight, ch: c.clientHeight, bottom: s.bottom }; });
    assert(b.sh <= b.ch + 1 && b.bottom <= 390, `844×390 過關卡 ${b.sh}/${b.ch}，分享成績底 ${b.bottom.toFixed(0)}`);
    await t.ctx.close();
  }

  // 13. 舊存檔仍讀得到
  {
    const t = await open({ store: { progress: { 1: 3, 2: 4 }, stars: { 1: 3, 2: 2 }, unlockAll: false } });
    await t.tapEl('#tSelect');
    assert((await t.p.textContent('#selSum')).includes('已點亮 2 / 100') && (await t.p.textContent('#selSum')).includes('★ 5'), '舊 progress/stars：' + await t.p.textContent('#selSum'));
    await t.ctx.close();
  }

  assert(errors.length === 0, 'console/page error：' + (errors.join(' | ') || '無'));
  await browser.close();
  console.log(fails ? `FAIL ${fails} 項` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
