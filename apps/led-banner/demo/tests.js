// 跑馬燈看板：上架評分 toFix 的回歸測試（node tests.js，約 30 秒）
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'led-banner-')), 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '\n</body></html>');
const URL = 'file://' + WRAP;
const KEY = 'led-banner:v1:';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, { dpr = 2, init, hash = '' } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: dpr, acceptDownloads: true });
    await ctx.addInitScript(([k, extra]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem(k + 'gestHelp', 'true'); if (extra) for (const [a, b] of Object.entries(extra)) localStorage.setItem(k + a, b); } }, [KEY, init || null]);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL + hash); await p.waitForFunction(() => window.__led);
    const cdp = await ctx.newCDPSession(p);
    return { ctx, p, cdp };
  }
  const touch = (cdp, type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  async function tap(cdp, x, y) { await touch(cdp, 'touchStart', x, y); await touch(cdp, 'touchEnd', x, y); }
  async function swipe(cdp, x0, y0, x1, y1, steps = 8) { await touch(cdp, 'touchStart', x0, y0); for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await touch(cdp, 'touchEnd', x1, y1); }
  const center = (p, sel) => p.$eval(sel, el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const toastText = p => p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent);
  const playerOpen = p => p.waitForFunction(() => !document.querySelector('#player').hidden && __led.pl.W > 1);

  // 1. 否決：LED／文字的靜止與向上，長訊息不再切掉頭尾，改成捲動；編輯頁有提示
  {
    const { ctx, p } = await open(844, 390);
    const r = await p.evaluate(() => {
      const pl = __led.pl, cv = document.querySelector('#plc'); document.querySelector('#player').hidden = false;
      const bbox = () => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let a = cv.width, b = -1; for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) { const k = (y * cv.width + x) * 4; if (d[k] + d[k + 1] + d[k + 2] > 380) { a = Math.min(a, x); b = Math.max(b, x); } } return { a, b, w: cv.width }; };
      const out = [];
      for (const led of [true, false]) for (const dir of ['static', 'up']) for (const n of [6, 30, 60, 198]) {
        __led.cfg = Object.assign({}, __led.cfg, { text: 'A' + '中'.repeat(n) + 'Z', led, dir, blink: 'off', glow: 0, rows: 24, fg: '#ffffff', rainbow: false });
        pl.resize(true); pl.off = dir === 'up' ? pl.H : 0; pl.t = 0; pl.draw(); const bb = bbox();
        out.push({ led, dir, n, eff: pl.dir, clipped: bb.a <= 2 && bb.b >= bb.w - 4, period: pl.period(), W: pl.W });
      }
      document.querySelector('#player').hidden = true; return out;
    });
    for (const x of r) {
      if (x.n === 6) assert(x.eff === x.dir && !x.clipped, `短訊息 led=${x.led} ${x.dir} 仍整段置中顯示（${x.eff}）`);
      else assert(x.eff === 'left' && x.period > x.W, `長訊息 ${x.n + 2} 字 led=${x.led} ${x.dir} → 改向左捲動，整段會依序經過畫面`);
    }
    await p.evaluate(() => { __led.cfg = Object.assign({}, __led.cfg, { text: '中'.repeat(40), dir: 'static', led: true }); });
    assert(await p.isVisible('#fitNote'), '編輯頁預覽提示「文字較長：播放時改為向左捲動」');
    await p.evaluate(() => { __led.cfg = Object.assign({}, __led.cfg, { text: '短', dir: 'static' }); });
    assert(await p.isHidden('#fitNote'), '短文字不顯示提示');
    await ctx.close();
  }

  // 2. 否決：控制列隱藏時，叫出控制列的那一下不會按到底下的 ×／⏸／＋（真實觸控）
  for (const target of ['#pExit', '#pPause', '#pFast']) {
    const { ctx, p, cdp } = await open(844, 390);
    await p.click('#btnPlay'); await playerOpen(p);
    const [x, y] = await center(p, target);
    await p.evaluate(() => document.querySelector('#pctl').classList.add('hide'));
    const before = await p.evaluate(() => __led.cfg.speed);
    await tap(cdp, x, y);
    await p.waitForFunction(() => !document.querySelector('#pctl').classList.contains('hide'));
    const off1 = await p.evaluate(() => __led.pl.off);
    await p.waitForFunction(o => __led.pl.off > o, off1, { timeout: 10000 }).catch(() => {});
    const a = await p.evaluate(() => ({ closed: document.querySelector('#player').hidden, speed: __led.cfg.speed, off: __led.pl.off }));
    assert(!a.closed && a.speed === before && a.off > off1, `點隱藏控制列的 ${target} 位置：只叫出控制列（關閉=${a.closed}、速度變化=${a.speed - before}、仍在播放=${a.off > off1}）`);
    if (target === '#pFast') {
      await tap(cdp, x, y); await p.waitForFunction(b => __led.cfg.speed === b + 1, before, { timeout: 5000 }).catch(() => {});
      assert(await p.evaluate(() => __led.cfg.speed) === before + 1, '控制列顯示後再點＋才加速（一下只算一次）');
      // holding a finger down pauses the auto-hide timer
      await touch(cdp, 'touchStart', 200, 120);
      await p.waitForTimeout(3600);
      assert(!(await p.evaluate(() => document.querySelector('#pctl').classList.contains('hide'))), '手指按住時控制列不會自動隱藏');
      await touch(cdp, 'touchEnd', 200, 120);
    }
    if (target === '#pExit') {
      // double tap exits, and the second tap does not fall through to the editor underneath
      await p.evaluate(() => document.querySelector('#pctl').classList.add('hide'));
      await p.evaluate(() => { window.__clicks = 0; document.addEventListener('click', (e) => { if (!e.target.closest('#player')) window.__clicks++; }); });
      // send both taps back to back (no round trips in between) so a loaded machine still sees a double tap; retry if it did not
      for (let i = 0; i < 6 && !(await p.evaluate(() => document.querySelector('#player').hidden)); i++) {
        await p.waitForTimeout(400); // let any earlier tap fall out of the double-tap window, so a retry is a fresh pair
        await p.evaluate(() => document.querySelector('#pctl').classList.add('hide'));
        await Promise.all([touch(cdp, 'touchStart', 300, 150), touch(cdp, 'touchEnd', 300, 150), touch(cdp, 'touchStart', 300, 150), touch(cdp, 'touchEnd', 300, 150)]);
        await p.waitForFunction(() => document.querySelector('#player').hidden, null, { timeout: 3000 }).catch(() => {});
      }
      await p.waitForFunction(() => document.querySelector('#player').hidden);
      await p.waitForTimeout(150);
      assert(await p.evaluate(() => window.__clicks) === 0, '點兩下結束播放，兩下都不會掉到底下（編輯頁）的按鈕');
    }
    await ctx.close();
  }

  // 3. 中：播放中上下滑換看板，不會蓋掉編輯中的文字
  {
    const { ctx, p, cdp } = await open(390, 844);
    for (const t of ['我愛你', '生日快樂']) { await p.fill('#txt', t); await p.click('#btnSave'); }
    await p.fill('#txt', '沒存的重要訊息');
    await p.click('#btnPlay'); await playerOpen(p);
    await swipe(cdp, 100, 420, 300, 420); // portrait: across the rotated sign
    await p.waitForFunction(() => __led.playCfg && __led.playCfg.text !== '沒存的重要訊息', null, { timeout: 5000 }).catch(() => {});
    assert(await p.evaluate(() => __led.playCfg && ['我愛你', '生日快樂'].includes(__led.playCfg.text)), '上下滑切到我的看板裡的一則');
    await p.keyboard.press('Escape');
    assert(await p.inputValue('#txt') === '沒存的重要訊息', '關閉播放器後輸入框仍是原文字');
    await p.reload(); await p.waitForFunction(() => window.__led);
    assert(await p.inputValue('#txt') === '沒存的重要訊息', '重新整理後仍是原文字');
    // carousel uses the same path
    await p.evaluate(() => { const c = document.querySelector('#carousel'); c.checked = true; c.dispatchEvent(new Event('change')); });
    await p.click('#btnPlay'); await playerOpen(p);
    await p.evaluate(() => { __led.pl.off = __led.pl.period() * 5; });
    await p.waitForFunction(() => __led.playCfg, null, { timeout: 5000 }).catch(() => {});
    await p.keyboard.press('Escape');
    assert(await p.inputValue('#txt') === '沒存的重要訊息', '輪播切換後關閉，文字也沒被改');
    await ctx.close();
  }

  // 4. 小：#t= 連結只套用一次，之後的編輯在重新整理後保留
  {
    const code = await (async () => { const { ctx, p } = await open(); const c = await p.evaluate(() => __led.encode(Object.assign({}, __led.cfg, { text: '連結裡的看板' }))); await ctx.close(); return c; })();
    const { ctx, p } = await open(390, 844, { hash: '#t=' + code });
    assert(await p.inputValue('#txt') === '連結裡的看板', '開啟 #t= 連結套用分享的看板');
    assert(await p.evaluate(() => location.hash) === '', '套用後網址的 #t= 已清掉');
    await p.fill('#txt', '我改過了'); await p.evaluate(() => new Promise(r => setTimeout(r, 500)));
    await p.reload(); await p.waitForFunction(() => window.__led);
    assert(await p.inputValue('#txt') === '我改過了', '重新整理不會再被連結蓋掉');
    await ctx.close();
  }

  // 5. 小：刪除可復原；匯出／匯入全部看板
  {
    const saved = JSON.stringify(['甲', '乙', '丙'].map(text => ({ text })));
    const { ctx, p } = await open(390, 844, { init: { saved } });
    await p.click('#btnBoards'); await p.click('#blist [data-del="1"]'); await p.click('#bDelYes');
    assert(await p.evaluate(() => __led.saved.map(b => b.text).join()) === '甲,丙', '刪除後剩 2 則');
    assert((await toastText(p)).includes('復原') && await p.isVisible('#toast .tact'), '刪除後出現「復原」');
    const tb = await p.$eval('#toast .tact', b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
    assert(tb[0] >= 44 && tb[1] >= 44, '復原按鈕至少 44×44');
    await p.click('#toast .tact');
    assert(await p.evaluate(() => __led.saved.map(b => b.text).join()) === '甲,乙,丙', '按復原後放回原位置');
    assert(await p.evaluate(k => JSON.parse(localStorage.getItem(k + 'saved')).length, KEY) === 3, '復原也寫入儲存');
    await p.click('#btnBackup');
    const bk = await p.inputValue('#backupCode');
    assert(bk.length > 20, '匯出備份產生備份文字');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('#btnBkFile')]);
    const file = dl ? fs.readFileSync(await dl.path(), 'utf8') : '';
    assert(dl && /^led-banner-\d{8}\.json$/.test(dl.suggestedFilename()) && JSON.parse(file).boards.length === 3, '下載備份檔 ' + (dl && dl.suggestedFilename()));
    await p.click('#dlgShare [data-close]');
    await p.evaluate(k => { localStorage.setItem(k + 'saved', '[]'); }, KEY); await p.reload(); await p.waitForFunction(() => window.__led);
    await p.click('#btnBoards'); await p.click('#btnRestore');
    await p.evaluate(() => { window.__toasts = []; new MutationObserver(() => window.__toasts.push(document.querySelector('#toast').textContent)).observe(document.querySelector('#toast'), { childList: true, characterData: true, subtree: true }); });
    await p.fill('#importCode', bk.slice(0, 30) + '\n' + bk.slice(30)); await p.click('#btnDoImport');
    await p.waitForFunction(() => __led.saved.length === 3, null, { timeout: 5000 }).catch(() => {});
    assert(await p.evaluate(() => __led.saved.length === 3 && window.__toasts.some(t => t.includes('新增 3 則'))), '貼上備份文字（中間被換行）還原 3 則');
    await p.evaluate(k => { localStorage.setItem(k + 'saved', '[]'); }, KEY); await p.reload(); await p.waitForFunction(() => window.__led);
    await p.click('#btnImport');
    await p.setInputFiles('#bkFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await p.waitForFunction(() => __led.saved.length === 3, null, { timeout: 5000 }).catch(() => {});
    assert(await p.evaluate(() => __led.saved.length) === 3, '選擇備份檔還原 3 則');
    const cur = await p.inputValue('#txt');
    await p.evaluate(() => { window.__toasts = []; new MutationObserver(() => window.__toasts.push(document.querySelector('#toast').textContent)).observe(document.querySelector('#toast'), { childList: true, characterData: true, subtree: true }); });
    await p.click('#btnImport'); await p.fill('#importCode', '%%%壞掉'); await p.click('#btnDoImport');
    assert(await p.evaluate(() => window.__toasts.some(t => t.includes('無法辨識'))) && await p.inputValue('#txt') === cur, '壞代碼被擋下，不動目前文字');
    await ctx.close();
  }

  // 6. 小：代碼解析與 200 字限制
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => {
      const L = window.__led, b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '');
      const ok = c => { try { L.decode(c); return true; } catch (e) { return false; } };
      const code = L.encode(Object.assign({}, L.cfg, { text: '換行測試 🎉' }));
      const wrapped = code.replace(/(.{10})/g, '$1\n  ');
      const emoji = '中'.repeat(199) + '👨‍👩‍👧‍👦';
      const over = '中'.repeat(199) + '👨‍👩‍👧‍👦👍';
      return {
        wrapped: ok(wrapped) && L.decode(wrapped).text === '換行測試 🎉',
        junk: ['null', '123', '[]', '{}', '"x"', '{"text":5}', '{"text":"  "}'].map(s => ok(b64(s))),
        keepEmoji: L.decode(L.encode({ text: emoji })).text === emoji,
        cutWhole: L.decode(L.encode({ text: over })).text === emoji,
      };
    });
    assert(r.wrapped, '代碼中間被換行、空白仍可解碼');
    assert(r.junk.every(x => !x), 'null／123／[]／{}／非字串 text 一律當成無法辨識 ' + JSON.stringify(r.junk));
    assert(r.keepEmoji, '199 字＋家庭表情完整保留');
    assert(r.cutWhole, '超過 200 字時以字素截斷，不留半個表情');
    const fam = '👨‍👩‍👧‍👦'.repeat(18);
    await p.fill('#txt', fam);
    assert(await p.inputValue('#txt') === fam && (await p.textContent('#counter')) === '18 / 200', '18 個家庭表情可以完整輸入，計數 18 / 200');
    await p.fill('#txt', '好'.repeat(205));
    assert((await p.inputValue('#txt')).length === 200 && (await p.textContent('#counter')) === '200 / 200', '超過 200 字被截到 200，計數一致');
    await ctx.close();
  }

  // 7. 小：播放器手勢說明（第一次自動顯示、? 鍵再看）；點掉說明不會被算成點擊
  {
    const { ctx, p, cdp } = await open(844, 390);
    await p.evaluate(k => localStorage.removeItem(k + 'gestHelp'), KEY);
    await p.click('#btnPlay'); await playerOpen(p);
    assert(await p.isVisible('#gHelp') && (await p.textContent('#gHelp')).includes('點兩下'), '第一次播放顯示手勢說明');
    await tap(cdp, 300, 150);
    await p.waitForFunction(() => document.querySelector('#gHelp').hidden);
    await tap(cdp, 300, 150);
    await p.waitForTimeout(100);
    assert(!(await p.evaluate(() => document.querySelector('#player').hidden)), '點掉說明的那一下不算進「點兩下結束」');
    await p.click('#pHelp'); assert(await p.isVisible('#gHelp'), '控制列的 ? 可再看手勢說明');
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
    await p.click('#btnPlay'); await playerOpen(p);
    assert(await p.isHidden('#gHelp'), '第二次播放不再自動顯示');
    await ctx.close();
  }

  // 8. 小：觸控尺寸；直式播放時控制列跟著轉
  {
    const { ctx, p } = await open(360, 640);
    const m = await p.evaluate(() => {
      const hs = [...document.querySelectorAll('.seg button')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect().height);
      const sel = document.querySelector('#carN').getBoundingClientRect().height;
      // every colour dot: a point 21px from its centre still hits it, and neighbours' 44px areas do not overlap
      const bad = [];
      for (const row of ['#fgColors', '#bgColors']) {
        const els = [...document.querySelectorAll(row + ' .cdot, ' + row + ' .cpick')];
        els.forEach(el => el.scrollIntoView({ block: 'center' }));
        for (const el of els) {
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          for (const [dx, dy] of [[-21, 0], [21, 0], [0, -21], [0, 21]]) { const hit = document.elementFromPoint(cx + dx, cy + dy); if (!hit || !(el === hit || el.contains(hit))) bad.push(el.getAttribute('aria-label') || el.title); }
        }
      }
      return { hs, sel, bad };
    });
    assert(m.hs.every(h => h >= 44), '分段按鈕都至少 44px 高 ' + Math.min(...m.hs));
    assert(m.sel >= 44, '輪播次數選單至少 44px 高 ' + m.sel);
    assert(!m.bad.length, '色點 44px 點擊範圍互不重疊 ' + m.bad.slice(0, 3).join('、'));
    await ctx.close();
    const o = await open(390, 844);
    await o.p.click('#btnPlay'); await playerOpen(o.p);
    const rr = await o.p.evaluate(() => { const r = document.querySelector('#pctl').getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right, cls: document.querySelector('#player').className }; });
    assert(rr.h > rr.w && rr.right > 300 && rr.right <= 390, `直式播放：控制列轉 90° 放在長邊側（${Math.round(rr.w)}×${Math.round(rr.h)}）`);
    assert(await o.p.evaluate(() => getComputedStyle(document.querySelector('#rotHint')).transform !== 'none' && document.body.classList.contains('prot')), '「請將手機橫放」提示與 toast 一起轉');
    await o.p.keyboard.press('Escape');
    assert(!(await o.p.evaluate(() => document.body.classList.contains('prot'))), '關閉後 toast 恢復正常方向');
    await o.ctx.close();
  }

  // 9. 小：分享連結、Enter 直接播放
  {
    const { ctx, p } = await open();
    await p.fill('#txt', '連結分享測試');
    await p.click('#btnShare');
    const link = await p.inputValue('#shareLink');
    assert(/^https:\/\/.+led-banner\.html#t=[A-Za-z0-9_-]+$/.test(link) || /#t=[A-Za-z0-9_-]+$/.test(link), '分享視窗有可直接開啟的 #t= 連結');
    const code = link.split('#t=')[1];
    assert(await p.evaluate(c => __led.decode(c).text, code) === '連結分享測試', '連結裡的代碼還原同一個看板');
    await p.click('#dlgShare [data-close]');
    assert(await p.getAttribute('#txt', 'enterkeyhint') === 'go', '#txt 有 enterkeyhint="go"');
    await p.focus('#txt'); await p.keyboard.press('Enter');
    await playerOpen(p);
    assert(await p.isVisible('#player'), '在輸入框按 Enter 直接全螢幕播放');
    await ctx.close();
  }

  // 10–11. 小：文字模式以裝置解析度畫字，光暈預先畫進 tile，只保留畫面附近的 tile
  {
    const { ctx, p } = await open(844, 390, { dpr: 3 });
    await p.evaluate(() => { __led.cfg = Object.assign({}, __led.cfg, { text: '長'.repeat(200), led: false, glow: 10, rainbow: true, dir: 'left', blink: 'off' }); });
    await p.click('#btnPlay'); await playerOpen(p);
    await p.waitForFunction(() => __led.pl.tc.size > 0);
    const r = await p.evaluate(() => new Promise(res => {
      const pl = __led.pl, first = pl.tile(0); let max = 0, frames = 0;
      const shadowSets = []; const ctx = pl.ctx; const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'shadowBlur');
      Object.defineProperty(ctx, 'shadowBlur', { configurable: true, set(v) { shadowSets.push(v); desc.set.call(this, v); }, get() { return desc.get.call(this); } });
      const step = () => { pl.off += pl.W * .37; pl.draw(); max = Math.max(max, pl.tc.size); if (++frames < 40) requestAnimationFrame(step); else { delete ctx.shadowBlur; res({ th: first.height, H: pl.H, dpr: pl.dpr, max, chunks: pl.chunks.length, shadow: shadowSets.filter(v => v > 0).length }); } };
      step();
    }));
    assert(r.dpr === 3 && Math.abs(r.th - r.H * 3) <= 1, `文字 tile 以裝置像素繪製（高 ${r.th}，畫面 ${r.H}×${r.dpr}）`);
    assert(r.max <= 12 && r.chunks > r.max, `長文字只保留畫面附近 tile（最多 ${r.max} / 共 ${r.chunks}）`);
    assert(r.shadow === 0, '每幀繪製不再對整段文字做 shadowBlur（光暈在 tile 裡）');
    await ctx.close();
  }


  // R2 否決：一指按著看板（或預覽），另一指點按鈕仍然有效；單指點一下只算一次
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const { ctx, p, cdp } = await open(w, h);
    await p.click('#btnPlay'); await playerOpen(p);
    const S = await center(p, '#pSlow'); const rest = [w * 0.1, h * 0.3];
    const sp = () => p.evaluate(() => (__led.playCfg || __led.cfg).speed);
    const a = await sp();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rest[0], y: rest[1], id: 0 }] });
    for (let i = 1; i <= 3; i++) {
      await p.evaluate(() => document.querySelector('#pctl').classList.remove('hide'));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rest[0], y: rest[1], id: 0 }, { x: S[0], y: S[1], id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: S[0], y: S[1], id: 1 }] });
      await p.waitForFunction(([a, i]) => (__led.playCfg || __led.cfg).speed === a - i, [a, i], { timeout: 15000 }).catch(() => {});
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: rest[0], y: rest[1], id: 0 }] });
    assert(await sp() === a - 3, `${w}×${h} 一指按住看板、另一指點 − 三次 → 速度 −3（${await sp() - a}）`);
    assert(!(await p.evaluate(() => document.querySelector('#player').hidden)), `${w}×${h} 兩指操作不會被當成點兩下結束`);
    // one finger, one tap on + → exactly +1, also after the browser's own click has arrived (and was swallowed)
    await p.evaluate(() => { document.querySelector('#pctl').classList.remove('hide'); window.__nc = 0; document.addEventListener('click', (e) => { if (e.isTrusted && e.target.closest('#pFast')) window.__nc++; }, true); });
    const F = await center(p, '#pFast'); const b = await sp();
    await tap(cdp, F[0], F[1]);
    await p.waitForFunction(() => window.__nc > 0, null, { timeout: 15000 }).catch(() => {});
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 50))));
    assert(await sp() === b + 1, `${w}×${h} 單指點＋一次只加 1（${await sp() - b}）`);
    await ctx.close();
  }
  {
    const { ctx, p, cdp } = await open(390, 844);
    const pv = await center(p, '#pv'); const A = await center(p, '#tpls [data-t="我愛你"]');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pv[0], y: pv[1], id: 0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pv[0], y: pv[1], id: 0 }, { x: A[0], y: A[1], id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: A[0], y: A[1], id: 1 }] });
    await p.waitForFunction(() => __led.cfg.text === '我愛你', null, { timeout: 15000 }).catch(() => {});
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: pv[0], y: pv[1], id: 0 }] });
    assert(await p.evaluate(() => __led.cfg.text) === '我愛你', '編輯頁：一指按在預覽上，另一指點範本有效');
    // segmented button and colour dot with a second finger too
    const D = await center(p, '#fgColors [data-fg="#ff3df2"]');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pv[0], y: pv[1], id: 0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pv[0], y: pv[1], id: 0 }, { x: D[0], y: D[1], id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: D[0], y: D[1], id: 1 }] });
    await p.waitForFunction(() => __led.cfg.fg === '#ff3df2', null, { timeout: 15000 }).catch(() => {});
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: pv[0], y: pv[1], id: 0 }] });
    assert(await p.evaluate(() => __led.cfg.fg) === '#ff3df2', '編輯頁：第二指點色點有效');
    await ctx.close();
  }

  // R2 建議：被吃掉的只有同一點附近 450ms 內的 click，不是「下一個 click」
  {
    const { ctx, p } = await open(844, 390);
    await p.click('#btnPlay'); await playerOpen(p);
    const r = await p.evaluate(() => {
      const pl = document.querySelector('#plc'); document.querySelector('#pctl').classList.add('hide');
      const pe = (type, x, y) => pl.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 9, pointerType: 'touch', isPrimary: true }));
      pe('pointerdown', 420, 100); pe('pointerup', 420, 100); // reveal tap high on the sign
      const s0 = __led.cfg.speed;
      const fast = document.querySelector('#pFast'), fr = fast.getBoundingClientRect();
      fast.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: fr.left + fr.width / 2, clientY: fr.top + fr.height / 2 }));
      const s1 = __led.cfg.speed;
      return { far: s1 - s0, shown: !document.querySelector('#pctl').classList.contains('hide') };
    });
    assert(r.shown && r.far === 1, '叫出控制列後，立刻點遠處的＋不會被誤吃（' + r.far + '）');
    await p.waitForTimeout(400); // not a double tap with the synthetic tap above
    const r2 = await p.evaluate(() => {
      const pl = document.querySelector('#plc'); document.querySelector('#pctl').classList.add('hide');
      const fast = document.querySelector('#pFast'), fr = fast.getBoundingClientRect(), x = fr.left + fr.width / 2, y = fr.top + fr.height / 2;
      const pe = (type) => pl.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 10, pointerType: 'touch', isPrimary: true }));
      pe('pointerdown'); pe('pointerup'); const s0 = __led.cfg.speed;
      fast.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      return __led.cfg.speed - s0;
    });
    assert(r2 === 0, '在隱藏的＋位置叫出控制列，同一點跟著來的 click 被吃掉');
    await ctx.close();
  }

  // R2 細節：我的看板「最近刪除」可在重新整理後復原；單色文字模式顏色預先畫進 tile
  {
    const saved = JSON.stringify(['甲', '乙'].map(text => ({ text })));
    const { ctx, p } = await open(390, 844, { init: { saved } });
    await p.click('#btnBoards'); await p.click('#blist [data-del="0"]'); await p.click('#bDelYes');
    await p.reload(); await p.waitForFunction(() => window.__led);
    await p.click('#btnBoards');
    assert(await p.isVisible('#trashBox') && (await p.textContent('#tlist')).includes('甲'), '重新整理後「最近刪除」仍列出刪掉的看板');
    await p.click('#tlist [data-undel="0"]');
    assert(await p.evaluate(() => __led.saved.map(b => b.text).join()) === '甲,乙' && await p.isHidden('#trashBox'), '從最近刪除復原到原位置');
    await p.click('#dlgBoards [data-close]');
    const tint = await p.evaluate(() => {
      __led.cfg = Object.assign({}, __led.cfg, { text: '中', led: false, rainbow: false, fg: '#00e5ff', glow: 0 });
      const pv = __led.pv; pv.build(); const c = pv.tile(0), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let blue = 0, white = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 250) { if (d[i] < 40 && d[i + 2] > 200) blue++; else if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++; }
      return { blue, white, tint: pv.tint };
    });
    assert(tint.tint === '#00e5ff' && tint.blue > 50 && tint.white === 0, '單色文字模式：tile 已是字色（每幀不再合成顏色）');
    await ctx.close();
  }

  assert(!errors.length, '沒有 console／page error ' + errors.slice(0, 3).join(' | '));
  await browser.close();
  try { fs.rmSync(path.dirname(WRAP), { recursive: true, force: true }); } catch (e) {}
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
