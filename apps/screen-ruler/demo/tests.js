// 螢幕尺規：上架評分 toFix 的回歸測試（node tests.js，約 40–70 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent；CDP 的 touchEnd 只放開它列出的手指。
// 頁面經本機 http 伺服器提供（重新整理後 localStorage 要留著；file:// 的來源不固定）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
const K = 'screen-ruler:v1:';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const T0 = Date.now();

// counts every run of a button's onclick (the action itself), so double runs are visible
const COUNT = `window.__runs={};document.querySelectorAll('button').forEach(el=>{if(el.id&&el.onclick&&!el.__w){const f=el.onclick;el.__w=1;el.onclick=function(e){__runs[el.id]=(__runs[el.id]||0)+1;return f.call(this,e);};}});`;

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(HTML); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const errors = [];
  async function open(o = {}) {
    const ctx = o.ctx || await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
    if (o.init) await ctx.addInitScript(o.init[0], o.init[1]);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push((o.tag || '') + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push((o.tag || '') + ' ' + m.text()); });
    await p.goto(URL); await p.waitForFunction(() => window.__sr); await sleep(150);
    await p.evaluate(COUNT);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tapXY = async (x, y, hold = 50, id = 1) => { await touch('touchStart', [{ x, y, id }]); await sleep(hold); await touch('touchEnd', [{ x, y, id }]); };
    const center = async sel => { await p.locator(sel).first().evaluate(e => e.scrollIntoView({ block: 'nearest' })); await sleep(40); const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2, b]; };
    const tap = async (sel, hold = 50) => { const [x, y] = await center(sel); await tapXY(x, y, hold); await sleep(60); };
    const ev = (fn, a) => p.evaluate(fn, a);
    const runs = () => ev(() => Object.assign({}, window.__runs));
    const resetRuns = () => ev(() => { window.__runs = {}; });
    const cand = () => ev(() => parseFloat(document.getElementById('calVal').textContent));
    const mode = () => ev(() => [...document.querySelectorAll('.bar button')].find(b => b.getAttribute('aria-pressed') === 'true').id);
    const waitFor = (fn, a, ms = 3000) => p.waitForFunction(fn, a, { timeout: ms }).then(() => true, () => false);
    // a detail-0 click as Chromium 141 sends it after a handled tap
    const d0 = (sel, xy) => ev(([sel, xy]) => { const el = sel ? document.querySelector(sel) : document.elementFromPoint(xy[0], xy[1]); if (!el) return false; const r = el.getBoundingClientRect(); return el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: xy ? xy[0] : r.x + r.width / 2, clientY: xy ? xy[1] : r.y + r.height / 2 })); }, [sel, xy || null]);
    return { ctx, p, touch, tapXY, center, tap, ev, runs, resetRuns, cand, mode, waitFor, d0 };
  }

  // ---------- 1. 另一指按著時點按鈕仍有作用 ----------
  {
    const o = await open({ tag: '1' });
    await o.tap('#mSet'); await o.waitFor(() => !document.getElementById('setSheet').hidden);
    const rest = await o.center('.head h1');
    const withRest = async (sel, extra) => {
      const [x, y] = await o.center(sel);
      await o.touch('touchStart', [{ x: rest[0], y: rest[1], id: 1 }]); await sleep(80);
      await o.touch('touchStart', [{ x: rest[0], y: rest[1], id: 1 }, { x, y, id: 2 }]); await sleep(50);
      await o.touch('touchEnd', [{ x, y, id: 2 }]); await sleep(120);
      if (extra) await extra();
      await o.touch('touchEnd', [{ x: rest[0], y: rest[1], id: 1 }]); await sleep(150);
    };
    await o.resetRuns(); let c0 = await o.cand();
    await withRest('#calPlus');
    assert(Math.abs(await o.cand() - c0 - 0.01) < 1e-6 && JSON.stringify(await o.runs()) === '{"calPlus":1}', '一指按著標題，另一指點「+」：px/mm 只加 0.01，沒有其他按鈕被觸發 ' + JSON.stringify(await o.runs()));
    await sleep(300); await o.resetRuns();
    await withRest('#cmCoin');
    assert(await o.ev(() => document.getElementById('cmCoin').getAttribute('aria-pressed')) === 'true' && (await o.runs()).cmCoin === 1, '一指按著時點「硬幣」：切換一次');
    await sleep(300); await o.resetRuns();
    await withRest('#mRuler');
    assert(await o.mode() === 'mRuler' && JSON.stringify(await o.runs()) === '{"mRuler":1}', '一指按著時點底部「尺規」：切換一次');
    await sleep(300);
    // one finger drags line A, the other taps "in"
    await o.waitFor(() => document.getElementById('lineA').getBoundingClientRect().width > 0);
    const A = await o.center('#lineA'), I = await o.center('#uIn'); await o.resetRuns();
    await o.touch('touchStart', [{ x: A[0], y: A[1] + 60, id: 1 }]); await sleep(60);
    await o.touch('touchMove', [{ x: A[0] + 20, y: A[1] + 60, id: 1 }]); await sleep(60);
    await o.touch('touchStart', [{ x: A[0] + 20, y: A[1] + 60, id: 1 }, { x: I[0], y: I[1], id: 2 }]); await sleep(50);
    await o.touch('touchEnd', [{ x: I[0], y: I[1], id: 2 }]); await sleep(120);
    const inOn = await o.ev(() => document.getElementById('uIn').getAttribute('aria-pressed'));
    await o.touch('touchEnd', [{ x: A[0] + 20, y: A[1] + 60, id: 1 }]); await sleep(120);
    assert(inOn === 'true' && (await o.runs()).uIn === 1, '一指拖曳量測線時另一指點「in」：單位切換一次');
    // 1–8 px outside a button's edge still counts (the browser's own touch adjustment did that before)
    await sleep(300); await o.tap('#mSet'); await sleep(300);
    let edgeMiss = [];
    for (const off of [2, 4, 6]) for (const side of 'LRTB') {
      const [, , b] = await o.center('#calPlus'); let x = b.x + b.width / 2, y = b.y + b.height / 2;
      if (side === 'L') x = b.x - off; if (side === 'R') x = b.x + b.width + off; if (side === 'T') y = b.y - off; if (side === 'B') y = b.y + b.height + off;
      await o.resetRuns(); await o.tapXY(x, y); await sleep(60); if ((await o.runs()).calPlus !== 1) edgeMiss.push(side + off); await sleep(300);
    }
    { const c0 = await o.cand(); const [, , b] = await o.center('#calPlus'); for (const off of [4, 6]) { await o.tapXY(b.x - off, b.y + b.height / 2); await sleep(300); }
      assert(Math.abs(await o.cand() - c0 - 0.02) < 1e-6, '「+」左 4、6 px：各加 0.01，校準滑桿沒有跳動'); }
    assert(!edgeMiss.length, '點在「+」外 2、4、6 px 仍算點到（左邊不會落到滑桿） ' + edgeMiss.join(','));
    await o.ctx.close();
  }

  // ---------- 2. detail 0 的 click 不會讓動作跑兩次 ----------
  {
    const o = await open({ tag: '2' });
    await o.tap('#mSet'); await sleep(200);
    for (const [name, delay] of [['同時', 0], ['30 ms 後', 30], ['300 ms 後', 300]]) {
      await sleep(300); await o.resetRuns(); const c0 = await o.cand(); const [x, y, b] = await o.center('#calPlus');
      await o.tapXY(x, y); await sleep(delay);
      await o.d0('#calPlus'); await o.d0(null, [b.x + 1, b.y + 1]); await o.d0(null, [x, y]);
      await sleep(100);
      assert(Math.abs(await o.cand() - c0 - 0.01) < 1e-6 && (await o.runs()).calPlus === 1, '點「+」後' + name + '補送 detail 0 click（本身、邊緣點、elementFromPoint）：只加 0.01');
    }
    await sleep(900); { const c0 = await o.cand(); await o.d0('#calPlus'); assert(Math.abs(await o.cand() - c0 - 0.01) < 1e-6, '沒有點按時單獨的 detail 0 click（輔助技術）仍作用一次'); }
    await sleep(900); {
      const c0 = await o.cand(); await o.p.focus('#calPlus'); await o.p.keyboard.press('Enter'); await sleep(50);
      assert(Math.abs(await o.cand() - c0 - 0.01) < 1e-6, '鍵盤 Enter 按「+」作用一次');
    }
    // a screen-changing tap: the follow-up click must not run the old or the new control
    await sleep(900); await o.resetRuns(); const [x, y] = await o.center('#mProt');
    await o.tapXY(x, y); await sleep(30); await o.d0(null, [x, y]); await o.d0('#mProt'); await sleep(100);
    assert(await o.mode() === 'mProt' && JSON.stringify(await o.runs()) === '{"mProt":1}', '點模式鈕後補送 detail 0 click：模式只切換一次 ' + JSON.stringify(await o.runs()));
    // 0.6 s and 1 s holds on a non-repeating button run once
    for (const hold of [600, 1000]) { await sleep(300); await o.resetRuns(); await o.tap('#mGrid', hold); await sleep(60); await o.d0('#mGrid');
      assert(JSON.stringify(await o.runs()) === '{"mGrid":1}', '按住「網格」' + hold / 1000 + ' 秒：作用一次'); await sleep(300); await o.tap('#mProt'); }
    await o.ctx.close();
  }

  // ---------- 3. 取色數值不被切掉 ----------
  for (const [w, h] of [[360, 640], [390, 844], [430, 932], [844, 390]]) {
    const o = await open({ w, h, tag: '3-' + w });
    await o.ev(() => { document.getElementById('mColor').click(); });
    await sleep(150);
    // the widest strings the fields ever hold
    await o.ev(() => { const i = document.getElementById('vRgb'), j = document.getElementById('vHsl'); i.value = 'rgb(255, 255, 255)'; j.value = 'hsl(359, 100%, 100%)'; });
    const r = await o.ev(() => ['vHex', 'vRgb', 'vHsl'].map(id => { const e = document.getElementById(id); return [id, e.scrollWidth, e.clientWidth]; }));
    assert(r.every(([, s, c]) => s <= c), w + '×' + h + ' HEX/RGB/HSL 欄位完整顯示 ' + r.map(x => x.join(' ')).join(' / '));
    // 6. card calibration at a real phone density (6 px/mm)
    await o.ev(() => document.getElementById('mSet').click()); await sleep(150);
    const c = await o.ev(() => { const r = document.getElementById('calRange'); r.value = '6'; r.dispatchEvent(new Event('input', { bubbles: true }));
      const f = document.getElementById('cardF').getBoundingClientRect(), bx = document.getElementById('calBox').getBoundingClientRect(), rh = document.getElementById('cardRh').getBoundingClientRect();
      return { fw: Math.round(f.width), fh: Math.round(f.height), inBox: rh.right <= bx.right + 0.5 && rh.left >= bx.left && f.left >= bx.left - 0.5 && f.right <= bx.right + 0.5 }; });
    const portrait = h > w;
    assert(c.inBox && (portrait ? c.fw === 324 && c.fh === 514 : c.fw === 514), w + '×' + h + ' 信用卡校準 6 px/mm：' + (portrait ? '直放 ' : '橫放 ') + c.fw + '×' + c.fh + '，框與把手都在校準區內');
    await o.ctx.close();
  }
  // drag the upright card's handle: width follows the finger 1:1
  {
    const o = await open({ w: 360, h: 640, tag: '6' });
    await o.tap('#mSet'); await sleep(150);
    await o.ev(() => { const r = document.getElementById('calRange'); r.value = '5'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    const [x, y] = await o.center('#cardRh');
    await o.touch('touchStart', [{ x, y, id: 1 }]); for (let i = 1; i <= 5; i++) { await o.touch('touchMove', [{ x: x + i * 10.796, y, id: 1 }]); await sleep(20); } await o.touch('touchEnd', [{ x: x + 53.98, y, id: 1 }]);
    await sleep(100);
    assert(Math.abs(await o.cand() - 6) < 0.02, '直放卡片：把手向右拖 53.98 px，5 → 6 px/mm（' + await o.cand() + '）');
    await o.ctx.close();
  }

  // ---------- 4. 在設定裡換單位，量測線不歸零 ----------
  {
    const o = await open({ tag: '4' });
    const before = await o.ev(() => [window.__sr.lines.a, window.__sr.lines.b]);
    await o.tap('#mSet'); await sleep(200); await o.tap('#uIn2'); await sleep(200); await o.tap('#uMm2'); await sleep(300); await o.tap('#uIn2'); await sleep(300); await o.tap('#mRuler');
    await o.waitFor(() => !document.getElementById('rulerLayer').hidden && document.getElementById('dist').textContent.includes('in'));
    const after = await o.ev(() => [window.__sr.lines.a, window.__sr.lines.b, document.getElementById('dist').textContent]);
    assert(after[0] === before[0] && after[1] === before[1] && !/^0\.00 in/.test(after[2]), '設定裡換單位後回尺規：兩線位置不變 ' + JSON.stringify(after));
    await o.ctx.close();
  }

  // ---------- 5. 壞掉的 localStorage 不會讓啟動中斷 ----------
  {
    const bad = [['colors', '[1, null, "zzz", "#2a9d8f"]'], ['calib', '{"pxPerMm":"5"}'], ['calib', '{"pxPerMm":5,"method":7,"date":3}'], ['mode', '"toString"'], ['mode', '"constructor"'],
      ['prefs', '{"gColor":"red","gPx":"abc","gStep":"px","orient":"diag","full":"yes"}'], ['prefs', 'null'], ['theme', '{}'], ['lines', '{"o":"h","a":"x","b":null}'], ['prot', '{"a1":"5","a2":-9}']];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const [k, v] of bad) {
      const n0 = errors.length;
      const pg = await ctx.newPage(); pg.on('pageerror', e => errors.push('5 ' + k + ' ' + e.message));
      await pg.goto(URL); await pg.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); }, [K + k, v]);
      await pg.reload(); await sleep(250);
      const s = await pg.evaluate(() => ({ sr: !!window.__sr, mode: [...document.querySelectorAll('.bar button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.id).join(), cols: window.__sr && window.__sr.colors, ppm: window.__sr && window.__sr.ppm(), dist: document.getElementById('dist').textContent }));
      assert(s.sr && s.mode && errors.length === n0 && s.dist, '壞資料 ' + k + '=' + v.slice(0, 40) + ' → 正常開啟（' + s.mode + (k === 'colors' ? ' ' + JSON.stringify(s.cols) : '') + (k === 'calib' ? ' ppm ' + s.ppm.toFixed(3) : '') + '）');
      if (k === 'colors') assert(JSON.stringify(s.cols) === '["#2A9D8F"]', 'colors 只留合法的 #RRGGBB');
      if (k === 'calib' && v.includes('"5"')) assert(Math.abs(s.ppm - 96 / 25.4) < 1e-9, 'pxPerMm 是字串時視為未校準');
      await pg.close();
    }
    await ctx.close();
  }

  // ---------- 7. 量測線、量角器兩臂重新整理後保留；清除取色紀錄可復原 ----------
  {
    const o = await open({ tag: '7' });
    const A = await o.center('#lineA');
    await o.touch('touchStart', [{ x: A[0], y: A[1], id: 1 }]); await o.touch('touchMove', [{ x: A[0] + 37, y: A[1], id: 1 }]); await o.touch('touchEnd', [{ x: A[0] + 37, y: A[1], id: 1 }]); await sleep(100);
    const l0 = await o.ev(() => [Math.round(__sr.lines.a), Math.round(__sr.lines.b)]);
    await o.tap('#mProt'); await sleep(250);
    const H = await o.center('#arm-a2 .hit');
    const cxy = await o.ev(() => { const r = document.getElementById('ws').getBoundingClientRect(), c = document.querySelector('#prot .ctr'); return [r.left + +c.getAttribute('cx'), r.top + +c.getAttribute('cy')]; });
    await o.touch('touchStart', [{ x: H[0], y: H[1], id: 1 }]); await o.touch('touchMove', [{ x: cxy[0], y: cxy[1] - 80, id: 1 }]); await o.touch('touchEnd', [{ x: cxy[0], y: cxy[1] - 80, id: 1 }]); await sleep(100);
    const a0 = await o.ev(() => __sr.prot.a2);
    await o.tap('#mRuler'); await sleep(200);
    await o.p.reload(); await o.p.waitForFunction(() => window.__sr); await sleep(250);
    const l1 = await o.ev(() => [Math.round(__sr.lines.a), Math.round(__sr.lines.b)]);
    assert(l0[0] === l1[0] && l0[1] === l1[1] && l0[0] !== 113, '量測線位置重新整理後保留 ' + JSON.stringify([l0, l1]));
    assert(Math.abs(a0 - 90) < 0.5 && await o.ev(() => __sr.prot.a2) === a0, '量角器臂 2 拖到 ' + a0 + '° 後重新整理仍是 ' + a0 + '°');
    await o.ev(COUNT);
    await o.ev(k => localStorage.setItem(k, '["#E63946","#2A9D8F","#264653"]'), K + 'colors'); await o.p.reload(); await o.p.waitForFunction(() => window.__sr); await o.ev(COUNT);
    await o.tap('#mColor'); await sleep(200); await o.tap('#clearHist'); await sleep(100);
    const cleared = await o.ev(() => [__sr.colors.length, !document.getElementById('undoHist').hidden]);
    await sleep(300); await o.tap('#undoHist'); await sleep(100);
    const back = await o.ev(() => [__sr.colors.join(), JSON.parse(localStorage.getItem('screen-ruler:v1:colors')).length, document.getElementById('undoHist').hidden]);
    assert(cleared[0] === 0 && cleared[1] && back[0] === '#E63946,#2A9D8F,#264653' && back[1] === 3 && back[2], '清除取色紀錄後按「復原紀錄」找回 3 個（並存檔）');
    await o.ctx.close();
  }

  // ---------- 8. 網格自訂 px 超出範圍會提示並還原 ----------
  {
    const o = await open({ tag: '8' });
    await o.tap('#mGrid'); await sleep(200); await o.p.selectOption('#gStep', 'px'); await sleep(100);
    for (const v of ['3', '401', '-5', '']) {
      await o.p.fill('#gPx', v); await sleep(50);
      const s = await o.ev(() => ({ inv: document.getElementById('gPx').getAttribute('aria-invalid'), info: document.getElementById('gridInfo').textContent, step: document.getElementById('grid').dataset.step }));
      assert(s.inv === 'true' && /4–400/.test(s.info) && /40 px/.test(s.info) && s.step === '40.000', '自訂間距輸入「' + v + '」：欄位標紅，說明「' + s.info + '」');
      await o.p.locator('#gPx').blur(); await sleep(50);
      const r = await o.ev(() => [document.getElementById('gPx').value, document.getElementById('gPx').getAttribute('aria-invalid')]);
      assert(r[0] === '40' && r[1] === 'false', '離開欄位後還原為 40');
    }
    await o.p.fill('#gPx', '120'); await sleep(50);
    assert(await o.ev(() => document.getElementById('grid').dataset.step) === '120.000', '輸入 120 立即套用');
    await o.ctx.close();
  }

  // ---------- 9. 手動校準空白欄位會說是哪一格 ----------
  {
    const o = await open({ tag: '9' });
    await o.tap('#mSet'); await sleep(200); await o.tap('#cmManual'); await sleep(150);
    await o.p.fill('#mDiag', ''); await sleep(300); await o.tap('#mApply'); await sleep(100);
    const e1 = await o.ev(() => document.getElementById('calErr').textContent);
    assert(/對角線/.test(e1) && !/裝置像素比/.test(e1) && await o.ev(() => !localStorage.getItem('screen-ruler:v1:calib')), '對角線空白時按套用：「' + e1 + '」，不存校準');
    await o.p.fill('#mDiag', '6.1'); await o.p.fill('#mDpr', ''); await o.p.locator('#mDpr').blur(); await sleep(300); await o.tap('#mApply'); await sleep(100);
    const e2 = await o.ev(() => document.getElementById('calErr').textContent);
    assert(/裝置像素比/.test(e2) && !/對角線/.test(e2), '裝置像素比空白：「' + e2 + '」');
    await o.ctx.close();
  }

  // ---------- 10. 分段鈕至少 44 px 高；11. 直式量角器讀數靠近量角器 ----------
  {
    const o = await open({ w: 360, h: 640, tag: '10' });
    const hs = [];
    for (const m of ['mRuler', 'mProt', 'mSet']) { await o.ev(m => document.getElementById(m).click(), m); await sleep(200);
      hs.push(...await o.ev(() => [...document.querySelectorAll('.seg button')].filter(b => b.getClientRects().length).map(b => Math.round(b.getBoundingClientRect().height * 10) / 10))); }
    assert(hs.length >= 10 && Math.min(...hs) >= 44, '分段鈕高度最小 ' + Math.min(...hs) + ' px（' + hs.length + ' 個）');
    for (const [w, h] of [[360, 640], [390, 844], [844, 390]]) {
      await o.p.setViewportSize({ width: w, height: h }); await o.ev(() => document.getElementById('mProt').click()); await sleep(300);
      const g = await o.ev(() => { const ws = document.getElementById('ws').getBoundingClientRect(), a = document.getElementById('angleOut').getBoundingClientRect(), rim = document.querySelector('#prot .rim').getBoundingClientRect();
        return { gap: Math.round(rim.top - a.bottom), above: Math.round(a.top - ws.top), below: Math.round(ws.bottom - rim.bottom), rw: Math.round(rim.width), W: Math.round(ws.width) }; });
      assert(g.gap >= 20 && g.gap <= 50 && Math.abs(g.above - g.below) <= 40 + (h < 500 ? 30 : 0) && g.rw >= Math.min(g.W - 70, 2 * (h - 300)) - 1, w + '×' + h + ' 半圓量角器置中：讀數與刻度相距 ' + g.gap + ' px，上 ' + g.above + ' / 下 ' + g.below + '，直徑 ' + g.rw + '/' + g.W);
    }
    await o.ctx.close();
  }

  // ---------- r2-1. 垂直量測：換模式不改變讀數；真的旋轉才按比例移動 ----------
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const o = await open({ w, h, tag: 'r2-1' });
    await o.tap('#oV'); await sleep(150);
    const read = () => o.ev(() => [Math.round(__sr.lines.a), Math.round(__sr.lines.b), document.getElementById('dist').dataset.mm]);
    const r0 = await read(), seq = [];
    for (let k = 0; k < 2; k++) for (const m of ['#mGrid', '#mRuler', '#mProt', '#mRuler', '#mSet', '#mRuler', '#mColor', '#mRuler']) { await sleep(250); await o.tap(m); }
    await o.waitFor(() => !document.getElementById('rulerLayer').hidden); await sleep(200);
    const r1 = await read(), saved = await o.ev(k => JSON.parse(localStorage.getItem(k)), K + 'lines');
    assert(r1.join() === r0.join() && Math.round(saved.a) === r0[0] && Math.round(saved.b) === r0[1], w + '×' + h + ' 垂直：網格／量角器／設定／取色來回兩次，讀數不變 ' + r0[2] + ' → ' + r1[2] + ' mm');
    await o.ctx.close();
  }
  {
    const o = await open({ w: 390, h: 844, tag: 'r2-1b' });
    const a0 = await o.ev(() => __sr.lines.a);
    await o.p.setViewportSize({ width: 844, height: 390 }); await sleep(400);
    const a1 = await o.ev(() => __sr.lines.a);
    assert(a1 > a0 * 1.5, '真的旋轉（390→844 寬）時量測線仍按比例移動 ' + Math.round(a0) + ' → ' + Math.round(a1));
    await o.ctx.close();
  }

  // ---------- r2-2/3. 另一指按著時原生欄位可用；點按鈕後馬上點選色器不被吞 ----------
  {
    const o = await open({ tag: 'r2-2' });
    await o.ev(() => { window.__pick = []; HTMLSelectElement.prototype.showPicker = function () { __pick.push('select:' + this.id); };
      document.addEventListener('click', e => { if (e.target.type === 'color') { e.preventDefault(); __pick.push('color:' + e.target.id); } }); });
    const rest = await o.center('.head h1');
    const withRest = async sel => { const [x, y] = await o.center(sel);
      await o.touch('touchStart', [{ x: rest[0], y: rest[1], id: 1 }]); await sleep(80);
      await o.touch('touchStart', [{ x: rest[0], y: rest[1], id: 1 }, { x, y, id: 2 }]); await sleep(50);
      await o.touch('touchEnd', [{ x, y, id: 2 }]); await sleep(150);
      await o.touch('touchEnd', [{ x: rest[0], y: rest[1], id: 1 }]); await sleep(150); };
    const ae = () => o.ev(() => document.activeElement && document.activeElement.id);
    await o.tap('#mSet'); await sleep(300); await o.tap('#cmManual'); await sleep(300);
    for (const id of ['#mDiag', '#mW']) { await o.ev(() => document.activeElement.blur()); await withRest(id); assert(await ae() === id.slice(1), '一指按著時點「' + id + '」：取得焦點'); await sleep(300); }
    await o.ev(() => document.activeElement.blur()); await o.tap('#mGrid'); await sleep(300);
    await withRest('#gColor'); await sleep(100);
    await o.p.selectOption('#gStep', '5mm'); await sleep(300); await withRest('#gStep');
    const pk = await o.ev(() => __pick.join());
    assert(/color:gColor/.test(pk) && /select:gStep/.test(pk) && (pk.match(/color/g) || []).length === 1, '一指按著時點線色、間距：選色器與下拉選單各開一次 ' + pk);
    // fresh tap on the colour well 400 ms after a button tap
    await o.ev(() => { __pick = []; }); await sleep(300); await o.tap('#mProt'); await sleep(300); await o.tap('#mGrid'); await sleep(400);
    const [cx, cy] = await o.center('#gColor'); await o.tapXY(cx, cy); await sleep(300);
    assert(await o.ev(() => __pick.join()) === 'color:gColor', '點「網格」後 400 ms 點線色：選色器開一次（不被防護吞掉）');
    // the leftover detail-0 click of a tap still never reaches the colour well that is now under it
    await o.ev(() => { __pick = []; }); await sleep(300); await o.tap('#mProt'); await sleep(300);
    const [gx, gy] = await o.center('#mGrid'); await o.tapXY(gx, gy); await sleep(30); await o.d0('#gColor'); await sleep(100);
    assert(await o.ev(() => __pick.join()) === '', '點「網格」後補送的 detail 0 click 不會打開剛出現的選色器');
    await o.ctx.close();
  }

  // ---------- r2-5/6. 直放卡片標示橫書；匯出／匯入；復原紀錄重新整理後仍可用 ----------
  {
    const o = await open({ tag: 'r2-6' });
    await o.tap('#mSet'); await sleep(200);
    const cap = await o.ev(() => { const c = document.getElementById('cardCap'), r = c.getBoundingClientRect(), f = document.getElementById('cardF').getBoundingClientRect(); return { wm: getComputedStyle(c).writingMode, inside: r.left >= f.left && r.right <= f.right && r.top >= f.top && r.top - f.top < 30, w: r.width, h: r.height }; });
    assert(cap.wm === 'horizontal-tb' && cap.inside && cap.w > cap.h, '直放卡片標示橫書、在框內上方 ' + JSON.stringify(cap));
    await o.ev(k => { localStorage.setItem(k + 'colors', '["#E63946","#2A9D8F"]'); localStorage.setItem(k + 'calib', JSON.stringify({ pxPerMm: 6.25, method: 'card', dpr: 2, screenW: 390, screenH: 844, date: '2026-11-01' })); }, K);
    await o.p.reload(); await o.p.waitForFunction(() => window.__sr); await o.ev(COUNT);
    await o.tap('#mSet'); await sleep(200);
    const [dl] = await Promise.all([o.p.waitForEvent('download', { timeout: 5000 }), o.tap('#expBtn')]);
    const file = await dl.path(); const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(data.app === 'screen-ruler' && data.calib.pxPerMm === 6.25 && data.colors.join() === '#E63946,#2A9D8F' && data.lines && data.prot, '匯出備份 JSON：校準、取色紀錄、量測線、量角器都在（' + dl.suggestedFilename() + '）');
    // import into a fresh browser profile
    const o2 = await open({ tag: 'r2-6b' });
    await o2.tap('#mSet'); await sleep(200);
    await o2.p.setInputFiles('#impFile', file); await o2.waitFor(() => window.__sr.calib && window.__sr.colors.length === 2);
    const got = await o2.ev(() => [__sr.calib && __sr.calib.pxPerMm, __sr.colors.join(), document.getElementById('calBadge').textContent, localStorage.getItem('screen-ruler:v1:colors')]);
    assert(got[0] === 6.25 && got[1] === '#E63946,#2A9D8F' && /已校準/.test(got[2]) && got[3].includes('E63946'), '新的瀏覽器匯入備份：校準與取色紀錄還原並存檔');
    await o2.p.setInputFiles('#impFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{oops') }); await sleep(200);
    assert(/無法匯入/.test(await o2.ev(() => document.getElementById('toast').textContent)) && await o2.ev(() => __sr.colors.length) === 2, '壞掉的備份檔：顯示無法匯入，資料不變');
    await o2.ctx.close();
    // 復原紀錄 survives a reload until a new colour is picked
    await o.tap('#mColor'); await sleep(200); await o.tap('#clearHist'); await sleep(100);
    await o.p.reload(); await o.p.waitForFunction(() => window.__sr); await o.ev(COUNT);
    await o.tap('#mColor'); await sleep(200);
    assert(await o.ev(() => !document.getElementById('undoHist').hidden), '清除紀錄後重新整理，「復原紀錄」仍在');
    await o.tap('#undoHist'); await sleep(100);
    assert(await o.ev(() => __sr.colors.join() === '#E63946,#2A9D8F' && !localStorage.getItem('screen-ruler:v1:clearedColors')), '重新整理後按「復原紀錄」找回 2 個');
    await o.ctx.close();
  }

  // ---------- 12. 校準 −／+ 按住連續調整，單點仍只一步 ----------
  {
    const o = await open({ tag: '12' });
    await o.tap('#mSet'); await sleep(200);
    let c0 = await o.cand(); await o.resetRuns(); await o.tap('#calPlus', 1300); await sleep(60); await o.d0('#calPlus'); await sleep(100);
    const dHold = +(await o.cand() - c0).toFixed(3);
    assert(dHold >= 0.05 && dHold <= 0.15 && !(await o.runs()).calPlus, '按住「+」1.3 秒連續增加 ' + dHold + '，放開時不再多加一步');
    await sleep(300); c0 = await o.cand(); await o.tap('#calMinus', 1300); await sleep(100);
    assert(await o.cand() < c0 - 0.04, '按住「−」1.3 秒連續減少');
    await sleep(300); c0 = await o.cand(); await o.tap('#calPlus', 600); await sleep(100);
    assert(Math.abs(await o.cand() - c0 - 0.01) < 1e-6, '按住 0.6 秒（未到連續門檻）只加 0.01');
    await sleep(300); c0 = await o.cand(); const [x, y] = await o.center('#calMinus'); for (let i = 0; i < 8; i++) { await o.tapXY(x, y, 40); await sleep(85); } await sleep(100);
    assert(Math.abs(await o.cand() - c0 + 0.08) < 1e-6, '每秒 8 下連點「−」8 次：剛好 −0.08');
    await o.ctx.close();
  }

  assert(!errors.length, '全程沒有頁面錯誤 ' + errors.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log(`${fails ? '有 ' + fails + ' 項失敗' : '全部通過'}（${Math.round((Date.now() - T0) / 1000)} 秒）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
