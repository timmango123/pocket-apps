// 摺紙旋律路（foldline）回歸測試：Chromium 手機尺寸、真實 CDP 觸控。對應 2026-11-02 上架評審的每一項待修。
// 用法：node tests.js（約 30–60 秒）。最後一行 PASS n / FAIL n。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const ORIGIN = 'http://foldline.test/';
const PAGE = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' + SRC + '</body></html>';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: opts.dark ? 'dark' : 'light' });
  const external = [], errors = [];
  await ctx.route('**/*', r => { const u = r.request().url(); if (u === ORIGIN) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }); external.push(u); return r.abort(); });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  await page.goto(ORIGIN);
  await page.waitForFunction(() => window.__foldline);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, external, errors };
}
const until = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true, () => false);
async function touchTile(s, idx) { // 真實觸控點在紙片中央
  const p = await s.page.evaluate(i => { const F = window.__foldline, g = F.geom(), t = F.tiles()[i], b = document.getElementById('board').getBoundingClientRect(); return { x: b.left + g.ox + (t.c + .5) * g.T, y: b.top + g.oy + (t.r + .5) * g.T }; }, idx);
  await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
  await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// 依最短接法把盤面接通（透過遊戲自己的 act，不改狀態以外的東西）
const solve = page => page.evaluate(() => { const F = window.__foldline, tl = F.tiles(), sr = F.shortest(); for (const [i, m] of sr.want) { let g = 0; while (tl[i].mask !== m && g++ < 4) F.act(tl[i]); } return F.state().solved; });
const ls = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem('foldline.' + k)), k);

(async () => {
  const browser = await chromium.launch();
  try {
    // 1. 沒有任何對外請求（原本會載入 Google Fonts），沒有錯誤
    {
      const s = await open(browser);
      await s.page.waitForTimeout(300);
      ok(s.external.length === 0, 'no external requests: ' + s.external.join(' '));
      ok(!/fonts\.googleapis|fonts\.gstatic|https?:\/\//.test(SRC.replace(/<!--[\s\S]*?-->/g, '')), 'no external URL in source');
      // 2. 接通當下就存星數與解鎖（不用等小旅人走完）；走路途中重新整理也還在
      await s.page.evaluate(() => window.__foldline.load(13));
      ok(await solve(s.page), 'L14 solved');
      const st = await s.page.evaluate(() => window.__foldline.state());
      const best = await ls(s.page, 'best'), unl = await ls(s.page, 'unlocked');
      ok(best && best[13] >= 1 && !st.walkDone, 'best saved at connect, before the walk ends: ' + JSON.stringify(best));
      ok(unl >= 15, 'next level unlocked at connect: ' + unl);
      await s.page.reload(); await s.page.waitForFunction(() => window.__foldline);
      ok((await ls(s.page, 'best'))[13] >= 1, 'stars survive reload during walk');
      ok(await s.page.evaluate(() => window.__foldline.state().lvIdx) === 14, 'reload during walk continues at the next level');
      // 3. 走完後立刻按「重來」：舊的結算框不會跳到新盤面上
      await s.page.evaluate(() => window.__foldline.load(0));
      await solve(s.page);
      ok(await until(s.page, () => window.__foldline.state().walkDone), 'walk finishes');
      await s.page.click('#resetBtn');
      await s.page.waitForTimeout(1000);
      ok(await s.page.evaluate(() => document.getElementById('winOv').hidden && !window.__foldline.state().solved), 'no stale win dialog after reset');
      ok(s.errors.length === 0, 'no errors: ' + s.errors.join(' | '));
      await s.ctx.close();
    }
    // 4. 關卡中途進度：重新整理後紙片、步數、時間都接著；「重來」要按兩次
    {
      const s = await open(browser);
      await s.page.evaluate(() => { localStorage.setItem('foldline.unlocked', '20'); window.__foldline.load(9); });
      const idxs = await s.page.evaluate(() => window.__foldline.tiles().map((t, i) => t.kind !== 'lock' ? i : -1).filter(i => i >= 0).slice(0, 3));
      for (const i of idxs) await touchTile(s, i);
      const before = await s.page.evaluate(() => ({ m: window.__foldline.tiles().map(t => t.mask), st: window.__foldline.state(), inf: window.__foldline.info() }));
      ok(before.st.moves === 3, 'three touches = three moves (no double count): ' + before.st.moves);
      await s.page.reload(); await s.page.waitForFunction(() => window.__foldline);
      const after = await s.page.evaluate(() => ({ m: window.__foldline.tiles().map(t => t.mask), st: window.__foldline.state(), inf: window.__foldline.info() }));
      ok(after.st.lvIdx === 9 && after.st.moves === 3 && after.m.join() === before.m.join(), 'mid-level progress restored after reload');
      ok(after.inf.timeLeft <= before.inf.timeLeft + 1.1 && after.inf.timeLeft < after.inf.timeMax, 'timer restored, not reset: ' + after.inf.timeLeft + '/' + after.inf.timeMax);
      await s.page.click('#resetBtn');
      ok(await s.page.evaluate(() => window.__foldline.state().moves) === 3, 'first reset tap only arms');
      await s.page.click('#resetBtn');
      ok(await s.page.evaluate(() => window.__foldline.state().moves) === 0, 'second reset tap resets');
      await s.page.reload(); await s.page.waitForFunction(() => window.__foldline);
      ok(await s.page.evaluate(() => window.__foldline.state().moves) === 0, 'reset level stays fresh after reload');
      // 5. 有時限的關卡一載入就倒數（不用先點）
      await s.page.evaluate(() => window.__foldline.load(20));
      ok(await until(s.page, () => { const i = window.__foldline.info(); return i.timeMax > 0 && i.timeLeft < i.timeMax - 0.5; }, null, 20000), 'countdown starts at load');
      // 6. 版面不會因提示文字改變而移動盤面
      const r0 = await s.page.evaluate(() => JSON.stringify(document.getElementById('board').getBoundingClientRect()));
      await s.page.click('#hintBtn');
      await touchTile(s, 0);
      const r1 = await s.page.evaluate(() => JSON.stringify(document.getElementById('board').getBoundingClientRect()));
      ok(r0 === r1, 'board does not move after hint / tap');
      ok(s.errors.length === 0, 'no errors (2): ' + s.errors.join(' | '));
      await s.ctx.close();
    }
    // 7. 提示擺正最短接法上的紙片：每用一次提示，最少剩餘步數都會減少；五線譜灰點 = 最短接法格數
    {
      const s = await open(browser);
      const res = await s.page.evaluate(() => {
        const F = window.__foldline, out = { noHelp: [], dots: [] };
        for (let i = 12; i < 42; i++) {
          F.load(i);
          const sr = F.shortest(); if (F.routeLen() !== sr.want.size) out.dots.push(i);
          for (let h = 0; h < F.info().hints; h++) {
            const d0 = F.shortest().d; document.getElementById('hintBtn').click(); const st = F.state(); if (st.solved) break;
            const d1 = F.shortest().d; if (!(d1 < d0)) { out.noHelp.push(i); break; }
          }
        }
        return out;
      });
      ok(res.noHelp.length === 0, 'every hint shortens the remaining route (L13–L42): ' + res.noHelp.join(','));
      ok(res.dots.length === 0, 'staff dots follow the shortest route: ' + res.dots.join(','));
      // 8. 難度曲線：第 5 關前有純旋轉練習；產生的盤面由小到大；第 13 關時限不比第 12 關少；參考解大致遞增
      const lv = await s.page.evaluate(() => { const F = window.__foldline; return F.levels.map((L, i) => { F.load(i); const inf = F.info(); return { i, rows: L.g.length, cols: L.g[0].length, fold: (L.fold || []).length, par: inf.par, t: inf.timeMax, diff: L.diff, sr: F.shortest() }; }); });
      ok(lv.length === 100, '100 levels');
      ok(lv.every(l => l.sr && l.sr.d === l.par), 'every level: solver finds the shortest route and par equals it (hints exact): ' + lv.filter(l => !l.sr || l.sr.d !== l.par).map(l => l.i + 1).join(','));
      ok(lv.slice(0, 6).every(l => l.fold === 0) && lv[6].fold > 0, 'two extra pure-rotation levels before the first fold level');
      const gen = lv.slice(12);
      ok(gen.every((l, k) => !k || l.rows * l.cols >= gen[k - 1].rows * gen[k - 1].cols), 'generated boards never shrink');
      ok(lv[12].t >= lv[11].t, 'L13 time limit >= L12: ' + lv[12].t + ' vs ' + lv[11].t);
      ok(lv.every((l, k) => !k || l.diff > lv[k - 1].diff), 'difficulty value increases');
      const avg = a => a.reduce((x, y) => x + y.par, 0) / a.length;
      ok(avg(gen.slice(0, 20)) < avg(gen.slice(20, 44)) && avg(gen.slice(20, 44)) < avg(gen.slice(44, 66)) && avg(gen.slice(44, 66)) < avg(gen.slice(66)), 'par rises across the generated levels');
      ok(gen.every((l, k) => !k || l.par >= gen[k - 1].par - 12), 'no big par drop between neighbours');
      // 9. 「解鎖全部關卡」要先累積星數
      await s.page.click('#menuBtn');
      ok(await s.page.evaluate(() => document.getElementById('allSw').hidden && !document.getElementById('allNote').hidden), 'unlock-all hidden before enough stars');
      await s.page.evaluate(() => { const b = {}; for (let i = 0; i < 30; i++) b[i] = 3; localStorage.setItem('foldline.best', JSON.stringify(b)); });
      await s.page.reload(); await s.page.waitForFunction(() => window.__foldline);
      await s.page.click('#menuBtn');
      ok(await s.page.evaluate(() => !document.getElementById('allSw').hidden), 'unlock-all shown after 90 stars');
      ok(s.errors.length === 0, 'no errors (3): ' + s.errors.join(' | '));
      await s.ctx.close();
    }
    // 10. 舊存檔（第 1 版）照樣讀得到：第 5 關以後往後挪兩關
    {
      const s = await open(browser, { init: () => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.clear(); localStorage.setItem('foldline.best', '{"2":1,"5":3}'); localStorage.setItem('foldline.unlocked', '7'); localStorage.setItem('foldline.last', '6'); localStorage.setItem('foldline.muted', 'true'); } } });
      const r = await s.page.evaluate(() => ({ best: JSON.parse(localStorage.getItem('foldline.best')), unl: +localStorage.getItem('foldline.unlocked'), lv: window.__foldline.state().lvIdx, mute: document.getElementById('muteBtn').textContent }));
      ok(r.best[2] === 1 && r.best[7] === 3 && !r.best[5], 'old stars migrated: ' + JSON.stringify(r.best));
      ok(r.unl === 9 && r.lv === 8, 'old unlocked/last migrated: ' + r.unl + ' ' + r.lv);
      ok(r.mute === '✕', 'old mute setting kept');
      await s.ctx.close();
    }
    // 11. 紙片大小：390×844 與大廳 390×663 全部 ≥ 44 px；橫式 844×390 ≥ 36 px；橫式沒有溢出
    for (const [w, h, min] of [[390, 844, 44], [390, 663, 44], [844, 390, 36]]) {
      const s = await open(browser, { viewport: { width: w, height: h } });
      const r = await s.page.evaluate(() => { const F = window.__foldline; let lo = 1e9, at = -1; for (let i = 0; i < 100; i++) { F.load(i); if (F.geom().T < lo) { lo = F.geom().T; at = i; } } const se = document.scrollingElement; return { lo, at, ow: se.scrollWidth - innerWidth, oh: se.scrollHeight - innerHeight, foot: document.querySelector('footer').getBoundingClientRect().bottom }; });
      ok(r.lo >= min, `${w}x${h}: smallest tile ${r.lo}px (L${r.at + 1}) >= ${min}`);
      ok(r.ow <= 0 && r.oh <= 0 && r.foot <= h, `${w}x${h}: no overflow`);
      await s.ctx.close();
    }
    // 12. 深色模式：紙面變暗
    {
      const s = await open(browser, { dark: true });
      const bg = await s.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const px = await s.page.evaluate(() => { const c = document.getElementById('bgc'); const d = c.getContext('2d').getImageData(5, 5, 1, 1).data; return d[0] + d[1] + d[2]; });
      ok(/rgb\((\d+)/.test(bg) && +bg.match(/rgb\((\d+)/)[1] < 60 && px < 200, 'dark mode paper: ' + bg + ' ' + px);
      ok(s.errors.length === 0, 'no errors (dark): ' + s.errors.join(' | '));
      await s.ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fail ? `FAIL ${fail} (pass ${pass})` : `PASS ${pass}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
