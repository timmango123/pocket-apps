// 猜拳與硬幣：上架評分 9.5 重審的回歸測試（node tests.js，約 30 秒）。觸控用真實 CDP Input.dispatchTouchEvent，等狀態不靠固定延遲。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const APP = path.resolve(__dirname, '../index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
// the face each coin shows, read from the computed rotateX (m22 = cos θ)
const facing = () => [...document.querySelectorAll('.spin')].map(s => { const m = new DOMMatrix(getComputedStyle(s).transform); return m.m22 > .5 ? 'h' : m.m22 < -.5 ? 't' : 'e'; });

(async () => {
  // served over http, not file://: Chromium can drop a localStorage write across a reload of a file:// page
  const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opt });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__cfReady);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
    const tap = async q => { await touch('touchStart', [q]); await touch('touchEnd', []); };
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    // idle = landed and past the short guard after landing (a tap inside it is treated as part of a double tap)
    const idle = () => p.waitForFunction(() => !__cf.flipping && performance.now() >= __cf.readyAt, null, { timeout: 10000 });
    const flips = () => p.evaluate(() => __cf.session.h + __cf.session.t + __cf.session.seq.filter(f => f === 'e').length);
    return { ctx, p, touch, tap, center, idle, flips };
  }
  const RMopt = { reducedMotion: 'reduce' };

  // 1. 隨機性：crypto 拒絕取樣沒有取模偏差；大量取樣的分布與序列都正常；結果和力度無關
  {
    const t = await open(390, 844, RMopt);
    const rej = await t.p.evaluate(() => {
      const real = crypto.getRandomValues.bind(crypto), out = {};
      const feed = vals => { const q = [...vals]; crypto.getRandomValues = a => { a[0] = q.shift(); return a; }; };
      // n = 3: 2^32 − 1 is the one value past the largest multiple of 3, so it must be redrawn
      feed([0xFFFFFFFF, 5]); out.three = __cf.randInt(3);
      // n = 6000: everything ≥ floor(2^32 / 6000) * 6000 is redrawn
      const lim = Math.floor(0x100000000 / 6000) * 6000; feed([lim, lim + 1, 0xFFFFFFFF, 7]); out.six = __cf.randInt(6000);
      feed([lim - 1]); out.sixTop = __cf.randInt(6000);
      crypto.getRandomValues = real; return out;
    });
    eq(rej, { three: 5 % 3, six: 7, sixTop: (Math.floor(0x100000000 / 6000) * 6000 - 1) % 6000 }, 'randInt 丟棄尾端偏差值後重抽（3、6000）');
    const st = await t.p.evaluate(() => {
      const N = 200000; let h = 0, prev = null; const pair = { hh: 0, ht: 0, th: 0, tt: 0 };
      for (let i = 0; i < N; i++) { const f = __cf.decideFace(); if (f === 'h') h++; if (prev) pair[prev + f]++; prev = f; }
      const tri = [0, 0, 0]; for (let i = 0; i < 90000; i++) tri[__cf.randInt(3)]++;
      __cf.settings.edge = true; let e = 0; for (let i = 0; i < 600000; i++) if (__cf.decideFace() === 'e') e++; __cf.settings.edge = false;
      return { N, h, pair, tri, e };
    });
    const z = (st.h - st.N / 2) / Math.sqrt(st.N / 4);
    assert(Math.abs(z) < 4.5, `20 萬次擲幣正面 ${(st.h / st.N * 100).toFixed(2)}%（z = ${z.toFixed(2)}，|z| < 4.5）`);
    const pe = (st.N - 1) / 4, chiPair = Object.values(st.pair).reduce((s, o) => s + (o - pe) ** 2 / pe, 0);
    assert(chiPair < 22, `前後兩次的四種組合（正正/正反/反正/反反）均勻：χ² = ${chiPair.toFixed(2)}（3 自由度，< 22）`);
    const chiTri = st.tri.reduce((s, o) => s + (o - 30000) ** 2 / 30000, 0);
    assert(chiTri < 20, `randInt(3) 9 萬次均勻（猜拳電腦出拳）：χ² = ${chiTri.toFixed(2)}`);
    assert(st.e > 50 && st.e < 160, `彩蛋開啟時 60 萬次立起來 ${st.e} 次（期望 100）`);
    const plan = await t.p.evaluate(() => { let bad = 0; for (const a0 of [0, 90, 180, 360, 540]) for (let f = 0; f <= 1; f += .05) for (const face of ['h', 't', 'e']) { const a1 = __cf.planSpin(a0, face, f), c = Math.cos(a1 * Math.PI / 180); if (face === 'h' ? c < .99 : face === 't' ? c > -.99 : Math.abs(c) > .01) bad++; } return bad; });
    eq(plan, 0, '動畫規劃：任何起點、任何力度都停在抽到的那一面（含立起來）');
    // the same random draw gives the same face whatever the flick force
    const byForce = await t.p.evaluate(async () => {
      const real = crypto.getRandomValues.bind(crypto), out = [];
      for (const force of [0, .3, .7, 1]) for (const v of [0, 1]) {
        crypto.getRandomValues = a => { a[0] = v; return a; };
        await __cf.flip(force); out.push(__cf.lastFaces[0]);
      }
      crypto.getRandomValues = real; return out.join('');
    });
    eq(byForce, 'hthththt', '結果只由隨機數決定，滑動力度不影響（偶數→正、奇數→反）');
    // real flips through the page: what is drawn = what the coins show = what the text says = what is counted
    let bad = 0;
    for (const n of [1, 3, 5]) {
      await t.p.click('#cnt-' + n);
      for (let i = 0; i < 8; i++) {
        const r = await t.p.evaluate(async fs => { await __cf.flip(Math.random()); return { shown: eval(fs)(), want: __cf.lastFaces, text: document.getElementById('coin-result').textContent }; }, facing.toString());
        const txt = r.want.map(f => f === 'h' ? '正' : f === 't' ? '反' : '立').join(' ');
        if (JSON.stringify(r.shown) !== JSON.stringify(r.want) || r.text !== (n === 1 ? txt.replace('立', '立起來了！') : txt)) bad++;
      }
    }
    eq(bad, 0, '1／3／5 枚各擲 8 次：每枚停的面與結果文字和抽到的一致');
    const cnt = await t.p.evaluate(() => [__cf.session.h + __cf.session.t, __cf.stats.coin.heads + __cf.stats.coin.tails]);
    eq(cnt, [8 + 24 + 40 + 8, 8 + 24 + 40 + 8], '每枚都算進本次與累計（含上面力度測試的 8 次）');
    await t.ctx.close();
  }

  // 2. 觸控：連點、動畫中點、雙擊硬幣都只擲一次；往上滑擲出、往下拖只捲動頁面
  {
    const t = await open();
    const b = await t.center('#btn-flip');
    await t.tap(b); await t.tap(b);
    await t.p.waitForFunction(() => __cf.flipping); await t.idle();
    eq(await t.flips(), 1, '連點「擲硬幣」兩下：只擲一次');
    const s = await t.center('#stage');
    await t.tap(s); await t.p.waitForFunction(() => __cf.flipping); await t.tap(s); await t.tap(b);
    await t.idle(); eq(await t.flips(), 2, '飛行中再點硬幣或按鈕：不會多擲');
    // swipe up from low on the coin
    const st = await t.p.$eval('#stage', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 40]; });
    await t.touch('touchStart', [st]); for (let k = 1; k <= 6; k++) await t.touch('touchMove', [[st[0], st[1] - k * 30]]); await t.touch('touchEnd', []);
    await t.p.waitForFunction(() => __cf.flipping); await t.idle();
    eq(await t.flips(), 3, '在硬幣上往上滑：擲出');
    // drag down on the coin while scrolled: the page scrolls back up, nothing is flipped
    await t.p.evaluate(() => scrollTo(0, 140)); await t.p.waitForFunction(() => scrollY > 100);
    const dn = await t.p.$eval('#stage', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, Math.max(r.top, 0) + 30]; });
    await t.touch('touchStart', [dn]); for (let k = 1; k <= 10; k++) await t.touch('touchMove', [[dn[0], dn[1] + k * 15]]); await t.touch('touchEnd', []);
    await t.p.waitForFunction(() => scrollY < 60);
    eq([await t.flips(), await t.p.evaluate(() => __cf.flipping)], [3, false], '在硬幣上往下拖：頁面往上捲，不擲硬幣');
    // long-press does nothing
    await t.p.evaluate(() => scrollTo(0, 0));
    await t.touch('touchStart', [s]); await t.p.waitForTimeout(650); await t.touch('touchEnd', []);
    await t.p.evaluate(() => new Promise(r => setTimeout(r, 50)));
    eq(await t.flips(), 3, '在硬幣上長按：不擲');
    await t.ctx.close();
  }

  // 3. 減少動態效果：沒有翻轉動畫，但剛落地後的第二下（雙擊）不會變成第二次擲
  {
    const t = await open(390, 844, RMopt);
    const r = await t.p.evaluate(async () => { await __cf.flip(.5); __cf.userFlip(.5); const again = __cf.flipping; await new Promise(r => setTimeout(r, 300)); __cf.userFlip(.5); const later = __cf.flipping; return [again, later]; });
    eq(r, [false, true], '減少動態：落地 250ms 內的點擊略過，之後照常擲');
    await t.idle();
    const anim = await t.p.evaluate(async () => { const p = __cf.flip(1); const a = document.getAnimations().map(a => a.effect.getKeyframes().some(k => k.transform)); await p; return a.some(Boolean); });
    eq(anim, false, '減少動態：硬幣不旋轉、不拋起（只淡入）');
    // rps: a double tap on a pick plays one round
    await t.p.click('#tab-rps');
    const pk = await t.center('#pick-1');
    await t.tap(pk); await t.tap(pk);
    await t.p.waitForFunction(() => document.getElementById('sr').textContent.includes('你出石頭'));
    await t.p.waitForFunction(() => !document.getElementById('pick-1').disabled); await t.p.evaluate(() => new Promise(r => setTimeout(r, 100)));
    eq(await t.p.evaluate(() => { const r = __cf.stats.rps; return r.win + r.lose + r.draw; }), 1, '減少動態：猜拳連點兩下只出一局');
    await t.ctx.close();
  }

  // 4. 「擲硬幣」按鈕在擲的前、中、後都不移動（1／3／5 枚、長的自訂文字、直式與橫式）
  for (const [w, h] of [[390, 844], [360, 640], [844, 390]]) {
    const t = await open(w, h, RMopt);
    await t.p.click('details.set summary'); await t.p.fill('#face-h', '正面朝上'); await t.p.fill('#face-t', '反面朝下');
    const moves = [];
    for (const n of [1, 3, 5]) {
      await t.p.click('#cnt-' + n);
      const y0 = await t.p.$eval('#btn-flip', e => e.getBoundingClientRect().top + scrollY);
      for (let i = 0; i < 4; i++) {
        const ys = await t.p.evaluate(async () => { const y = () => document.getElementById('btn-flip').getBoundingClientRect().top + scrollY; const p = __cf.flip(.5); const mid = y(); await p; return [mid, y()]; });
        for (const y of ys) if (Math.abs(y - y0) > 1) moves.push(`${n} 枚：${y0}→${y}`);
      }
    }
    eq(moves, [], `${w}×${h} 結果文字變長變短，按鈕位置不變`);
    await t.ctx.close();
  }

  // 5. 拋起的高度：力度越大越高，但硬幣大半留在畫面裡
  {
    const t = await open();
    const peak = force => t.p.evaluate(async f => {
      const c = document.querySelector('.coin'), d = c.getBoundingClientRect().width, top0 = c.getBoundingClientRect().top; let min = top0;
      const p = __cf.flip(f); let go = true; p.then(() => go = false);
      await new Promise(r => { const k = () => { min = Math.min(min, c.getBoundingClientRect().top); go ? requestAnimationFrame(k) : r(); }; k(); });
      return { rise: (top0 - min) / d, out: -min / d };
    }, force);
    const lo = await peak(0), hi = await peak(1);
    assert(hi.rise > lo.rise + .3, `力度 1 比力度 0 拋得高（${lo.rise.toFixed(2)}d → ${hi.rise.toFixed(2)}d）`);
    assert(hi.out < .6, `最大力度時硬幣超出畫面頂端的部分 ${(Math.max(0, hi.out) * 100).toFixed(0)}% < 60%（以前整枚飛出畫面）`);
    // the shown face after a full animation matches too
    eq(await t.p.evaluate(fs => JSON.stringify(eval(fs)()) === JSON.stringify(__cf.lastFaces), facing.toString()), true, '完整動畫後停的面與結果一致');
    await t.ctx.close();
  }

  // 6. 儲存：壞資料不會讓頁面壞掉；累計與設定重新整理後還在；飛行中離開頁面也記得那一次
  {
    const t = await open(390, 844, RMopt, () => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.setItem('coin-flip:v1:settings', JSON.stringify({ faces: null, sound: 'x', bestOf: 7, count: 4, theme: 'neon', mode: 'solo', vibe: 0 }));
      localStorage.setItem('coin-flip:v1:stats', JSON.stringify({ coin: { heads: -3, tails: 'many', streak: 99, best: 1e99, last: 'q' }, rps: null }));
      localStorage.setItem('coin-flip:v1:rpsHistory', JSON.stringify([0, 1, 9, 'x', 2]));
    });
    const s = await t.p.evaluate(() => ({ faces: __cf.settings.faces, bestOf: __cf.settings.bestOf, count: __cf.settings.count, theme: __cf.settings.theme, mode: __cf.settings.mode, coin: __cf.stats.coin, rps: __cf.stats.rps, sel: document.getElementById('best-of').value, coins: document.querySelectorAll('.coin').length }));
    eq(s, { faces: { h: '', t: '' }, bestOf: 1, count: 1, theme: 'auto', mode: 'cpu', coin: { heads: 0, tails: 0, edge: 0, streak: 0, best: 0, last: '' }, rps: { win: 0, lose: 0, draw: 0, cur: 0, best: 0 }, sel: '1', coins: 1 }, '壞掉的設定與統計逐欄退回預設，頁面照常可用');
    await t.p.click('#btn-flip'); await t.p.waitForFunction(() => __cf.stats.coin.heads + __cf.stats.coin.tails === 1);
    await t.p.click('#cnt-3'); await t.p.click('details.set summary'); await t.p.fill('#face-h', '字');
    await t.p.reload(); await t.p.waitForFunction(() => window.__cfReady);
    eq(await t.p.evaluate(() => [__cf.stats.coin.heads + __cf.stats.coin.tails, document.querySelectorAll('.coin').length, document.getElementById('face-h').value, document.getElementById('s-h-l').textContent]), [1, 3, '字', '字'], '重新整理後累計、枚數、自訂文字都還在');
    await t.ctx.close();
    const u = await open();
    const r = await u.p.evaluate(async () => {
      const p = __cf.flip(1); dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      const saved = JSON.parse(localStorage.getItem('coin-flip:v1:stats')).coin; await p;
      const after = JSON.parse(localStorage.getItem('coin-flip:v1:stats')).coin;
      return [saved.heads + saved.tails, after.heads + after.tails, __cf.session.h + __cf.session.t];
    });
    eq(r, [1, 1, 1], '飛行中觸發 pagehide：那一次立刻寫入；落地後不會重複計算');
    await u.ctx.close();
  }

  // 7. 螢幕報讀：每次結果都有完整句子（同樣結果連續兩次也會再讀一次）；猜拳與雙人結果也報讀
  {
    const t = await open(390, 844, RMopt);
    await t.p.evaluate(() => { window.__said = []; new MutationObserver(() => { const s = document.getElementById('sr').textContent; if (s) window.__said.push(s); }).observe(document.getElementById('sr'), { childList: true, characterData: true, subtree: true }); });
    await t.p.evaluate(async () => { const real = crypto.getRandomValues.bind(crypto); crypto.getRandomValues = a => { a[0] = 2; return a; }; await __cf.flip(); await __cf.flip(); crypto.getRandomValues = real; });
    await t.p.waitForFunction(() => window.__said.length >= 2);
    eq(await t.p.evaluate(() => window.__said), ['擲出正面', '擲出正面'], '單枚：「擲出正面」，連續兩次正面讀兩次');
    eq(await t.p.$eval('#sr', e => [e.getAttribute('role'), e.getAttribute('aria-live')]), ['status', 'polite'], '報讀區是 polite 的 status');
    eq(await t.p.$eval('#coin-result', e => e.getAttribute('aria-live')), null, '飛行中的「…」不另外報讀');
    await t.p.click('#cnt-3'); await t.p.evaluate(() => __cf.flip());
    await t.p.waitForFunction(() => window.__said.length >= 3);
    assert(/^3 枚：[正反立起來]+、[正反立起來]+、[正反立起來]+。正 \d：反 \d，(正方勝|反方勝|平手)$/.test(await t.p.evaluate(() => window.__said[2])), '3 枚：逐枚與勝負都讀出來：' + await t.p.evaluate(() => window.__said[2]));
    assert(/^最近 \d+ 次：/.test(await t.p.$eval('#seq', e => e.getAttribute('aria-label'))), '最近紀錄的圓點有文字說明');
    await t.p.click('#tab-rps'); await t.p.click('#pick-2');
    await t.p.waitForFunction(() => window.__said.length >= 4);
    assert(/^電腦出(剪刀|石頭|布)，你出布，(你贏了！|你輸了|平手)$/.test(await t.p.evaluate(() => window.__said[3])), '猜拳：讀出雙方出拳與勝負');
    eq(await t.p.$eval('#hand-cpu', e => e.getAttribute('aria-live')), null, '倒數中的手勢不再逐一報讀');
    await t.p.click('#mode-duo');
    await t.p.click('#duo-area .pick[data-p="1"][data-m="0"]'); await t.p.click('#duo-area .pick[data-p="2"][data-m="2"]');
    await t.p.waitForFunction(() => window.__said.length >= 5);
    eq(await t.p.evaluate(() => window.__said[4]), '玩家一出剪刀，玩家二出布，玩家一獲勝！', '雙人：讀出雙方出拳與結果（單局制）');
    await t.ctx.close();
  }

  // 8. 震動開關、彩蛋計數、兩面同字提醒、分頁鍵盤操作、空白鍵不搶走「硬幣設定」的展開
  {
    const t = await open(390, 844, RMopt, () => { window.__vib = []; Object.defineProperty(navigator, 'vibrate', { value: p => { window.__vib.push(p); return true; }, configurable: true }); });
    await t.p.evaluate(() => __cf.flip());
    assert(await t.p.evaluate(() => window.__vib.length) >= 2, '震動預設開：起飛與落地各震一次');
    await t.p.click('details.set summary'); await t.p.click('#vibe');
    await t.p.evaluate(async () => { window.__vib = []; await __cf.flip(); });
    eq(await t.p.evaluate(() => window.__vib.length), 0, '關閉「落地時震動」後不再震動');
    eq(await t.p.evaluate(() => JSON.parse(localStorage.getItem('coin-flip:v1:settings')).vibe), false, '震動設定有存起來');
    await t.p.evaluate(async () => { const real = crypto.getRandomValues.bind(crypto); __cf.settings.edge = true; crypto.getRandomValues = a => { a[0] = 0; return a; }; await __cf.flip(); crypto.getRandomValues = real; __cf.settings.edge = false; });
    eq(await t.p.evaluate(() => [__cf.lastFaces[0], __cf.stats.coin.edge, document.getElementById('coin-result').textContent]), ['e', 1, '立起來了！'], '立起來：結果顯示並記入累計');
    assert((await t.p.textContent('#a-ratio')).includes('立起來 1 次'), '累計說明列出立起來的次數');
    assert(await t.p.$eval('#face-warn', e => e.hidden), '兩面文字不同時沒有提醒');
    await t.p.fill('#face-t', '正'); assert(!(await t.p.$eval('#face-warn', e => e.hidden)), '兩面文字一樣時提醒分不出正反');
    await t.p.fill('#face-t', '');
    // Space on the settings summary toggles it, it does not flip
    const n0 = await t.flips();
    await t.p.focus('details.set summary'); const open0 = await t.p.$eval('details.set', d => d.open);
    await t.p.keyboard.press('Space');
    eq([await t.p.$eval('details.set', d => d.open), await t.flips(), await t.p.evaluate(() => __cf.flipping)], [!open0, n0, false], '焦點在「硬幣設定」按空白鍵：展開／收合，不擲硬幣');
    await t.idle(); await t.p.evaluate(() => document.activeElement.blur()); await t.p.keyboard.press('Space');
    await t.p.waitForFunction(n => __cf.session.h + __cf.session.t + __cf.session.seq.filter(f => f === 'e').length === n + 1, n0);
    assert(true, '其他地方按空白鍵照常擲');
    await t.p.focus('#tab-coin'); await t.p.keyboard.press('ArrowRight');
    eq(await t.p.evaluate(() => [document.activeElement.id, document.getElementById('pane-rps').hidden, document.getElementById('tab-rps').tabIndex, document.getElementById('tab-coin').tabIndex]), ['tab-rps', false, 0, -1], '分頁可用方向鍵切換（roving tabindex）');
    await t.ctx.close();
  }

  // 9. 觸控範圍 ≥ 44px、沒有橫向捲動、對比
  for (const [w, h] of [[320, 568], [390, 844], [844, 390]]) {
    const t = await open(w, h);
    for (const tab of ['coin', 'rps']) {
      await t.p.click('#tab-' + tab);
      if (tab === 'coin') await t.p.click('details.set summary');
      const small = await t.p.evaluate(() => [...document.querySelectorAll('button, summary, select, label.sw, .set-body label')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 6), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      eq(small, [], `${w}×${h} ${tab}：每個按鈕至少 44×44`);
    }
    eq(await t.p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${w}×${h} 沒有橫向捲動`);
    await t.ctx.close();
  }
  {
    const t = await open();
    const ratio = await t.p.evaluate(() => {
      const rgb = c => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number), L = c => { const v = rgb(c).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
      const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const out = {};
      for (const th of ['light', 'dark']) {
        document.documentElement.dataset.theme = th;
        const seq = document.getElementById('seq'); seq.innerHTML = '<i class="h">正</i><i class="e">立</i>';
        const [hi, ei] = seq.children, bg = getComputedStyle(document.querySelector('.stats')).backgroundColor;
        out[th] = [cr(getComputedStyle(hi).color, getComputedStyle(hi).backgroundColor), cr(getComputedStyle(ei).color, getComputedStyle(ei).backgroundColor), cr(getComputedStyle(document.querySelector('.hint')).color, getComputedStyle(document.querySelector('.pane')).backgroundColor)].map(x => +x.toFixed(2));
      }
      return out;
    });
    assert([...ratio.light, ...ratio.dark].every(x => x >= 4.5), `最近紀錄圓點與提示文字對比 ≥ 4.5（淺 ${ratio.light}，深 ${ratio.dark}）`);
    await t.ctx.close();
  }

  // 10. 橫式矮螢幕：硬幣在左、結果與按鈕在右，不用捲動就按得到「擲硬幣」
  for (const [w, h] of [[844, 390], [667, 375]]) {
    const t = await open(w, h);
    for (const n of [1, 5]) {
      await t.p.click('#cnt-' + n);
      const r = await t.p.evaluate(() => { const b = document.getElementById('btn-flip').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(), c = [...document.querySelectorAll('.coin')].map(e => e.getBoundingClientRect());
        return { btn: b.bottom <= innerHeight && b.top >= 0, side: s.right <= b.left, coins: c.every(k => k.top >= s.top && k.bottom <= s.bottom && k.left >= s.left - 1 && k.right <= s.right + 1) }; });
      eq(r, { btn: true, side: true, coins: true }, `${w}×${h} ${n} 枚：按鈕在畫面內、硬幣在左側舞台內`);
    }
    await t.ctx.close();
  }

  eq(errors, [], '沒有頁面錯誤或 console 錯誤');
  await browser.close(); server.close();
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
