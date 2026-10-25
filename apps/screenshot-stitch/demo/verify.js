// 長截圖拼接驗證：node verify.js
// 在 390×844、大廳 iframe 三種尺寸（375×500、390×610、430×740）與 360×640、430×932、844×390 橫向，淺色／深色各開一次：
// 不能有錯誤、不能水平捲動、範例要自動接好、接縫放大鏡與匯出面板都能用、按鈕在畫面內。
// 另外量首次可用時間、匯出時間，並輸出 cover-390x520.png 當大廳封面。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const OUT = __dirname, WRAP = path.resolve(__dirname, '_wrapped.html');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + SRC + '</body></html>');
let pass = 0, fail = 0;
// 這台機器常有好幾個瀏覽器同時在跑：時間預算依「每核心負載」放寬（沒人搶 CPU 時就是原本的預算），實際數字照樣印出來
const os = require('os'), LOADF = Math.max(1, os.loadavg()[0] / os.cpus().length);
const ok = (c, m) => { if (c) { pass++; console.log('ok  ' + m); } else { fail++; console.log('FAIL ' + m); } };

(async () => {
  const browser = await chromium.launch();
  const errors = [], ext = [];
  const open = async (w, h, scheme) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, acceptDownloads: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${w}x${h} ${scheme}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} ${scheme} console: ${m.text()}`); });
    p.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) ext.push(r.url()); });
    await p.goto('file://' + WRAP);
    const hd = await p.waitForFunction(() => window.__ss && __ss.phase === 'idle' && __ss.plan && performance.now(), null, { timeout: 15000 });
    return { ctx, p, ms: Math.round(await hd.jsonValue()) };   // 從開始載入頁面到範例接好（頁面自己的時鐘）
  };
  const inView = (p, sel) => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5; }, sel);
  const sizes = [[390, 844], [375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390]];
  const loads = [];
  for (const [w, h] of sizes) for (const scheme of ['light', 'dark']) {
    const { ctx, p, ms } = await open(w, h, scheme); loads.push(ms);
    const tag = `${w}x${h} ${scheme}`;
    const ow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(ow <= 0, `${tag}: 沒有水平捲動`);
    const sm = await p.evaluate(() => __ss.plan.seams.map(s => s.mode + (s.amb ? '?' : '')).join());
    ok(sm === 'overlap,overlap,overlap', `${tag}: 範例 3 個接縫自動對齊`);
    ok(await inView(p, '#goBtn') && await inView(p, '#themeBtn') && await inView(p, '#strip .tile.add'), `${tag}: 匯出、主題、加入按鈕完整在畫面內且 ≥ 44px`);
    const card = await p.evaluate(() => { const c = document.querySelector('.scard'); if (!c) return null; const r = c.getBoundingClientRect(); return r.top < innerHeight - 70; });
    ok(card, `${tag}: 第一屏就看得到接縫卡片`);
    await p.screenshot({ path: `${OUT}/shot-${w}x${h}-${scheme}.png` });
    // 接縫放大鏡
    await p.click('.scard[data-seam="0"]'); await p.waitForTimeout(500);
    ok(await inView(p, '#seamDone') && await inView(p, '#stp0 button:last-child') && await inView(p, '#stp1 button:first-child'), `${tag}: 放大鏡的完成與微調鈕都在畫面內`);
    const magH = await p.evaluate(() => document.querySelector('#mag').clientHeight);
    ok(magH >= 120, `${tag}: 放大鏡高度 ${magH}px`);
    await p.screenshot({ path: `${OUT}/seam-${w}x${h}-${scheme}.png` });
    await p.click('#seamDone'); await p.waitForTimeout(350);
    // 匯出面板
    await p.click('#goBtn'); await p.waitForFunction(() => !document.querySelector('#saveBtn').disabled, null, { timeout: 15000 });
    await p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running')); await p.waitForTimeout(100);   // 等面板滑上來
    ok(await inView(p, '#saveBtn'), `${tag}: 匯出面板的儲存鈕在畫面內`);
    await p.screenshot({ path: `${OUT}/export-${w}x${h}-${scheme}.png` });
    await ctx.close();
  }
  loads.sort((a, b) => a - b);
  ok(loads[Math.floor(loads.length / 2)] < 1500 * LOADF, `首次載入到範例接好（中位數）${loads[Math.floor(loads.length / 2)]} ms（預算 ${Math.round(1500 * LOADF)} ms）`);

  // 主要流程計時（390×844）
  {
    const { ctx, p } = await open(390, 844, 'light');
    const t = await p.evaluate(async () => { const t0 = performance.now(); await __ss.buildExport('png', 1, () => {}, () => false); const t1 = performance.now(); await __ss.buildExport('jpeg', 1, () => {}, () => false); return [Math.round(t1 - t0), Math.round(performance.now() - t1)]; });
    ok(t[0] < 2500 && t[1] < 2500, `範例匯出 PNG ${t[0]} ms、JPEG ${t[1]} ms`);
    // 微調反應時間：按一下重疊 +1 到計畫更新
    await p.click('.scard[data-seam="1"]'); await p.waitForTimeout(500);
    const step = await p.evaluate(async () => {
      const b = document.querySelector('#stp0 button:last-child'), L0 = __ss.plan.seams[1].L, fr = [];
      for (let k = 0; k < 7; k++) {
        const t0 = performance.now();
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, isPrimary: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); fr.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 150));
      }
      fr.sort((a, b) => a - b);
      // 按住連發 2 秒時的畫面更新率
      let n = 0, run = true; const f = () => { n++; if (run) requestAnimationFrame(f); }; requestAnimationFrame(f);
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, isPrimary: true }));
      await new Promise(r => setTimeout(r, 2000)); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 })); run = false;
      return { dL: __ss.plan.seams[1].L - L0, frame: fr[3], fps: n / 2, L: __ss.plan.seams[1].L };
    });
    ok(step.dL > 7 && step.frame < 100, `微調 7 次 +7 px 再按住連發；單次中位數 ${step.frame.toFixed(0)} ms 內畫面更新`);
    ok(step.fps >= 20 / LOADF, `按住連發時畫面每秒 ${step.fps} 格（下限 ${(20 / LOADF).toFixed(1)}）`);
    console.log('    (machine load ' + require('os').loadavg()[0].toFixed(1) + ' on ' + require('os').cpus().length + ' cores)');
    // 範例 → 封面
    await p.click('#seamDone'); await ctx.close();
    const c2 = await browser.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const p2 = await c2.newPage(); p2.on('pageerror', e => errors.push('cover: ' + e.message));
    await p2.goto('file://' + WRAP); await p2.waitForFunction(() => window.__ss && __ss.phase === 'idle' && __ss.plan);
    await p2.waitForTimeout(400);
    await p2.screenshot({ path: `${OUT}/cover-390x520.png` });
    ok(fs.existsSync(`${OUT}/cover-390x520.png`), '輸出 cover-390x520.png');
    await c2.close();
  }
  ok(errors.length === 0, '沒有頁面錯誤 ' + errors.slice(0, 3).join(' | '));
  ok(ext.length === 0, '沒有任何對外請求 ' + ext.slice(0, 3).join(' '));
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
