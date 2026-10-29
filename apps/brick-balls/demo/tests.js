// 幾何霓虹磚：上架評分修正的回歸測試（node tests.js，約 40 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opt });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    if (opt.storage) await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); for (const k in s) localStorage.setItem(k, s[k]); } }, opt.storage);
    await p.goto(URL); await p.waitForFunction(() => window.__bb);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
    const st = () => p.evaluate(() => window.__bb.state());
    const tap = async sel => { const b = await p.locator(sel).boundingBox(); await touch('touchStart', [[b.x + b.width / 2, b.y + b.height / 2]]); await sleep(40); await touch('touchEnd', []); await sleep(60); };
    // press, drag straight up-ish (指向 mode), release
    const shoot = async (dx = 40) => {
      const vp = p.viewportSize(), x0 = vp.width / 2, y0 = vp.height * 0.6; await touch('touchStart', [[x0, y0]]);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [[x0 + dx * i / 6, y0 - 160 * i / 6]]); await sleep(16); }
      await touch('touchEnd', []); await sleep(30);
    };
    const save = k => p.evaluate(k => JSON.parse(localStorage.getItem('brickballs.' + k)), k);
    return { ctx, p, cdp, touch, st, tap, shoot, save };
  }

  // 1. 壞掉的存檔與設定不會讓頁面掛掉，直接丟掉
  {
    const t = await open(390, 844, { storage: {
      'brickballs.save': JSON.stringify({ mode: 'level', n: 5, S: '{broken' }),
      'brickballs.saveE': JSON.stringify({ mode: 'endless', S: JSON.stringify({ bricks: 'x' }) }),
      'brickballs.progress': '[1,2,3]', 'brickballs.stars': '{"1":7,"2":2}', 'brickballs.stats': '{"best":"lots","shots":-4}',
      'brickballs.settings': '{"theme":"neon","assist":9,"aim":"sling"}' } });
    await sleep(300);
    assert(await t.p.isHidden('#tCont'), '壞存檔：不顯示「繼續遊戲」');
    eq(await t.p.evaluate(() => [localStorage.getItem('brickballs.save'), localStorage.getItem('brickballs.saveE')]), [null, null], '壞存檔從 storage 移除');
    eq(await t.p.textContent('#tPlay'), '開始遊戲', '陣列形式的 progress 不算過關');
    await t.tap('#tSet'); await sleep(450); // after the card's pop-in animation
    eq(await t.p.$$eval('#setBody button[aria-pressed="true"]', bs => bs.map(b => b.textContent)), ['彈弓', '自動', '自動', '開', '開', '開'], '不合法的設定值回到預設，合法的（彈弓）保留');
    const hs = await t.p.$$eval('#setBody button', bs => bs.map(b => b.getBoundingClientRect().height));
    assert(Math.min(...hs) >= 44, `設定按鈕高度 ≥ 44px（最小 ${Math.min(...hs)}）`);
    await t.ctx.close();
  }

  // 2. 發射中離開頁面：這一球照同樣物理算完再存；重開後不能重射這一球
  {
    const t = await open();
    await t.tap('#tPlay'); await sleep(200);
    const pre = await t.p.evaluate(() => window.__bb.snapshot());
    await t.shoot(30);
    const s1 = await t.st(); eq(s1.phase, 'run', '拖曳放開後發射');
    await sleep(250);
    await t.p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const sv = await t.save('save');
    const exp = await t.p.evaluate(([pre, a]) => { const S = JSON.parse(pre); BB.rebuild(S); BB.runTurn(S, a, null); return { turn: S.turn, hp: S.bricks.map(b => b.hp).join(), x: S.launchX }; }, [pre, s1.aim]);
    const got = JSON.parse(sv.S);
    eq({ turn: got.turn, hp: got.bricks.map(b => b.hp).join(), x: got.launchX }, exp, '存檔＝這一球打完後的盤面（與核心模擬一致）');
    assert(sv.undo && JSON.parse(sv.undo).turn === 1, '悔一回合的存檔仍是發射前');
    await t.p.reload(); await t.p.waitForFunction(() => window.__bb); await sleep(200);
    assert((await t.p.textContent('#tCont')).includes('第 2 回合'), '重開後「繼續遊戲」在第 2 回合');
    await t.tap('#tCont'); await sleep(100);
    const s2 = await t.st(); eq([s2.phase, s2.turn], ['aim', 2], '繼續後從第 2 回合瞄準');
    assert(await t.p.isEnabled('#bUndo'), '繼續後仍可悔一回合');

    // 3. 關卡與無盡各自一個存檔，不互相覆蓋
    await t.tap('#bPause'); await t.tap('#pHome'); await sleep(100);
    await t.tap('#tEndless'); await sleep(150); eq((await t.st()).mode, 'endless', '進入無盡模式');
    await t.shoot(-20); await t.p.waitForFunction(() => window.__bb.state().phase === 'aim', null, { timeout: 15000 });
    await t.tap('#bPause'); await t.tap('#pHome'); await sleep(100);
    const both = await t.p.evaluate(() => [!!localStorage.getItem('brickballs.save'), !!localStorage.getItem('brickballs.saveE')]);
    eq(both, [true, true], '關卡存檔與無盡存檔同時存在');
    assert((await t.p.textContent('#tEndless')).startsWith('繼續無盡'), '無盡按鈕顯示「繼續無盡」');
    assert((await t.p.textContent('#tCont')).includes('無盡'), '「繼續遊戲」是最近的無盡');
    eq(await t.p.textContent('#tPlay'), '繼續第 1 關', '開始鍵接續第 1 關的存檔，不會重開蓋掉');
    await t.tap('#tPlay'); await sleep(100);
    eq([(await t.st()).mode, (await t.st()).turn], ['level', 2], '接續第 1 關第 2 回合');
    await t.ctx.close();
  }

  // 4. 磚塊還在落下時就按住：一落定立刻開始瞄準，放開就發射（不吃掉這一下）
  {
    const t = await open();
    await t.tap('#tPlay'); await sleep(150);
    await t.shoot(10);
    await t.p.waitForFunction(() => ['gather', 'drop'].includes(window.__bb.state().phase), null, { timeout: 15000, polling: 5 });
    const x0 = 195, y0 = 500; await t.touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= 4; i++) { await t.touch('touchMove', [[x0 - 10 * i, y0 - 40 * i]]); await sleep(10); }
    await t.p.waitForFunction(() => window.__bb.state().phase === 'aim', null, { timeout: 5000 });
    const a = await t.st(); assert(a.aimValid, '落定後已依手指位置瞄準');
    await t.touch('touchMove', [[x0 - 45, y0 - 170]]); await t.touch('touchEnd', []); await sleep(50);
    eq([(await t.st()).phase, (await t.st()).turn], ['run', 2], '放開即發射第 2 回合');
    // 只是點一下（沒拖曳）不會發射
    await t.p.waitForFunction(() => window.__bb.state().phase === 'aim', null, { timeout: 15000 });
    await t.touch('touchStart', [[200, 400]]); await t.touch('touchEnd', []); await sleep(50);
    eq((await t.st()).phase, 'aim', '輕點不發射');
    await t.ctx.close();
  }

  // 5. 壓線失敗：存檔保留悔一回合；動畫期間回主選單不會再跳出失敗畫面
  {
    const t = await open();
    const lost = await t.p.evaluate(() => {
      const S = BB.newGame(BB.levels()[0]); S.hpRef = 10; S.bricks.forEach(b => { b.hp = 999; b.max = 999; });
      S.bricks[0].r = 8; S.bricks[0].c = 3; BB.rebuild(S);
      const o = {}; for (const k of ['lv', 'endless', 'seed', 'balls', 'launchX', 'turn', 'bricks', 'items', 'nid', 'reserve', 'minMargin', 'hpRef', 'status', 'totalDmg']) o[k] = S[k];
      o.items = o.items.filter(it => !(it.r === 8 && it.c === 3));
      localStorage.setItem('brickballs.save', JSON.stringify({ mode: 'level', n: 1, S: JSON.stringify(o), undo: null, undoUsed: false, t: Date.now() }));
      return o.turn;
    });
    await t.p.reload(); await t.p.waitForFunction(() => window.__bb); await sleep(150);
    await t.tap('#tCont'); await sleep(100);
    await t.shoot(0);
    await t.p.waitForFunction(() => window.__bb.state().phase === 'over', null, { timeout: 20000, polling: 5 });
    const sv = await t.save('save');
    assert(sv && sv.autoUndo && JSON.parse(sv.S).turn === lost && sv.undoUsed, '失敗後存檔＝發射前（已用掉悔一回合）');
    await t.tap('#bPause'); await t.tap('#pHome'); await sleep(900);
    assert(await t.p.isHidden('#lose'), '失敗動畫期間回主選單：失敗畫面不會再跳出');
    eq((await t.st()).mode, 'demo', '仍在主選單');
    await t.tap('#tCont'); await sleep(150);
    eq([(await t.st()).turn, (await t.st()).phase], [lost, 'aim'], '「繼續」回到壓線前一回合');
    assert((await t.p.textContent('#toast')).includes('自動悔一回合'), '提示已自動悔一回合');
    assert(await t.p.isDisabled('#bUndo'), '悔一回合已用掉');
    await t.ctx.close();
  }

  // 6. 滑鼠：按下就以游標位置瞄準（不用先移動）；淺色主題磚上數字對比
  {
    const t = await open(1024, 768, { isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
    await t.p.click('#tPlay'); await sleep(150);
    const f = await t.p.evaluate(() => window.__bb.field());
    const lx = f.fx + f.launchX * f.sc, ly = f.fy + (f.floor - f.R) * f.sc;
    const tx = lx + 200, ty = ly - 200; // 45°
    await t.p.evaluate(([x, y]) => { const o = { clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1, bubbles: true, isPrimary: true, button: 0 }; const cv = document.getElementById('cv'); cv.dispatchEvent(new PointerEvent('pointerdown', o)); cv.dispatchEvent(new PointerEvent('pointerup', o)); }, [tx, ty]);
    const s = await t.st(); eq(s.phase, 'run', '滑鼠點擊發射');
    assert(Math.abs(s.aim - 45) < 0.6, `沒移動過也以點擊位置瞄準（${s.aim.toFixed(1)}°）`);
    const tc = await t.p.evaluate(() => ['rgb(0,197,219)', 'rgb(219,147,0)', 'rgb(107,66,219)'].map(window.__bb.textOn));
    eq(tc, ['#14141f', '#14141f', '#ffffff'], '淺色主題：亮色磚用深色數字，深色磚用白字');
    await t.ctx.close();
  }

  // 7. 橫向與旋轉：場地與按鈕不重疊、按鈕 ≥ 44px
  {
    const t = await open(390, 844);
    await t.tap('#tPlay'); await sleep(150);
    const sc1 = (await t.p.evaluate(() => window.__bb.field())).sc;
    await t.p.setViewportSize({ width: 844, height: 390 }); await sleep(200);
    const f = await t.p.evaluate(() => window.__bb.field());
    assert(f.sc !== sc1 && f.fy + (f.floor + 12) * f.sc <= 390 + 1, `旋轉後重新排版，場地在畫面內（sc ${sc1.toFixed(2)}→${f.sc.toFixed(2)}）`);
    const pill = await t.p.locator('#bUndo').boundingBox();
    assert(pill.x >= f.fx + 390 * f.sc, '橫向：悔一回合按鈕在場地右側，不蓋場地');
    assert(pill.height >= 44, '橫向：按鈕高度 ≥ 44px');
    await t.shoot(0); eq((await t.st()).phase, 'run', '橫向可拖曳發射');
    await t.ctx.close();
  }

  // 8. 快進開著會沿用到下一回合
  {
    const t = await open(390, 844, { storage: { 'brickballs.unlockAll': 'true' } });
    await t.tap('#tSelect'); await sleep(200);
    await t.p.locator('.lt[data-n="90"]').scrollIntoViewIfNeeded(); await t.tap('.lt[data-n="90"]'); await sleep(150);
    if (await t.p.isVisible('#iOk')) await t.tap('#iOk');
    // shoot until a turn lasts 3 s (shallow shots bounce longer), turn 快進 on there, then the next long turn must speed up by itself
    const longTurn = async dx => {
      for (let k = 0; k < 6; k++) {
        await t.p.waitForFunction(() => window.__bb.state().phase === 'aim', null, { timeout: 30000 });
        await t.shoot(k % 2 ? -dx : dx);
        await t.p.waitForFunction(() => window.__bb.state().runT >= 3.05 || window.__bb.state().phase !== 'run', null, { timeout: 15000 });
        if ((await t.st()).phase === 'run') return true;
      }
      return false;
    };
    if (await longTurn(420)) {
      await t.tap('#bFF'); eq((await t.st()).speed, 2.5, '快進開啟');
      if (await longTurn(-420)) eq([(await t.st()).speed, await t.p.getAttribute('#bFF', 'aria-pressed')], [2.5, 'true'], '下一個長回合 3 秒後自動快進');
      else console.log('skip 沒有第二個長回合');
    } else console.log('skip 沒有超過 3 秒的回合');
    await t.ctx.close();
  }

  await browser.close();
  eq(errors, [], '沒有頁面錯誤');
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
