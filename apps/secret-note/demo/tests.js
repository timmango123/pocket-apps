// 文字加密便條：上架重審 toFix 的回歸測試（node tests.js，約 30–50 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent（touchEnd 只放開它列出的手指）。
// 頁面由本機 http 伺服器提供：/app.html（獨立頁）、/tools/（模擬口袋工具箱：iframe srcdoc 載入 open/secret-note.html）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + SRC + '</body></html>';
// same idea as apps/tool-hub/template.html mount(): fetch open/<id>.html and run it through srcdoc
const HUB = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><iframe id="f" style="width:100vw;height:100vh;border:0"></iframe>'
  + '<script>fetch("open/secret-note.html").then(r=>r.text()).then(h=>{document.getElementById("f").srcdoc=h})</script></body></html>';
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'secret-note-')), 'index.html');
fs.writeFileSync(FILE, PAGE);

let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const body = u === '/app.html' || u === '/tools/open/secret-note.html' ? PAGE : u === '/tools/' ? HUB : null;
  if (body == null) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(body);
});

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ORIGIN = 'http://127.0.0.1:' + srv.address().port, APP = ORIGIN + '/app.html';
  const browser = await chromium.launch();
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN }).catch(() => {});
    if (o.init) await ctx.addInitScript(o.init[0], o.init[1]);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(o.url || APP); if (!o.hub) await p.waitForFunction(() => typeof renderNotes === 'function');
    const cdp = await ctx.newCDPSession(p);
    return { ctx, p, cdp };
  }
  const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const box = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); await sleep(60); return p.locator(sel).first().boundingBox(); };
  async function tap(cdp, p, sel, o = {}) {
    const b = await box(p, sel), x = b.x + b.width / 2 + (o.dx || 0), y = b.y + b.height / 2 + (o.dy || 0), id = o.id || 1;
    await T(cdp, 'touchStart', [{ x, y, id }]); await sleep(o.hold || 40); await T(cdp, 'touchEnd', [{ x, y, id }]);
    return { x, y, b };
  }
  const themeIdx = p => p.evaluate(() => ['auto', 'light', 'dark'].indexOf(theme));
  const waitFor = (p, fn, arg, ms = 5000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const toastText = p => p.evaluate(() => document.getElementById('toast').hidden ? '' : document.getElementById('toast-text').textContent);
  async function encrypt(p, cdp, text, pw, fmt) {
    await p.fill('#plain', text); await p.fill('#pw1', pw); await p.fill('#pw2', pw);
    if (fmt) await tap(cdp, p, `label:has(#fmt-${fmt})`);
    await tap(cdp, p, '#btn-enc');
    await p.waitForFunction(() => !busy && !document.getElementById('out-wrap').hidden && document.getElementById('cipher-out').value);
    return p.inputValue('#cipher-out');
  }

  // ---------- 1. 觸控：pointerup 動作、休息的手指、detail 0 重播 ----------
  {
    const { ctx, p, cdp } = await open();
    for (const hold of [40, 600, 1000]) {
      const a = await themeIdx(p); await tap(cdp, p, '#btn-theme', { hold }); await sleep(150);
      assert((await themeIdx(p) - a + 3) % 3 === 1, `1 點佈景主題（按住 ${hold} ms）只前進一格`);
      await sleep(850);
    }
    // tap then replay a detail-0 click on the control, on its edge point and on elementFromPoint: still one step
    const a = await themeIdx(p);
    const t = await tap(cdp, p, '#btn-theme');
    await p.evaluate(({ x, y, b }) => {
      const el = document.getElementById('btn-theme');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: b.x + 1, clientY: b.y + 1 }));
      const hit = document.elementFromPoint(x, y); hit && hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y }));
    }, t);
    await sleep(100);
    assert((await themeIdx(p) - a + 3) % 3 === 1, '1 點一下後再補送 detail 0 的 click（本體、邊緣點、elementFromPoint），佈景主題仍只前進一格');
    // tab switch replay: the new screen's control under the finger must not run
    await sleep(850);
    const t2 = await tap(cdp, p, '#tab-dec');
    await p.evaluate(({ x, y }) => { const hit = document.elementFromPoint(x, y); hit && hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); document.getElementById('tab-enc').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, t2);
    await sleep(100);
    assert(await p.evaluate(() => cols.dataset.mode) === 'dec', '1 點「解密」後補送 detail 0 click 不會再切回加密');
    // a lone detail-0 click (keyboard / screen reader) still acts once
    await sleep(900);
    const c = await themeIdx(p);
    await p.evaluate(() => document.getElementById('btn-theme').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    assert((await themeIdx(p) - c + 3) % 3 === 1, '1 單獨的 detail 0 click（鍵盤）仍動作一次');
    await p.focus('#btn-theme'); const d = await themeIdx(p); await p.keyboard.press('Enter'); await sleep(50);
    assert((await themeIdx(p) - d + 3) % 3 === 1, '1 Enter 鍵切換佈景主題一次');
    // resting finger: finger 1 stays on the title, finger 2 taps controls
    await sleep(850);
    await tap(cdp, p, '#tab-enc'); await sleep(850);
    const h = await box(p, 'h1'), rest = { x: h.x + 10, y: h.y + h.height / 2, id: 7 };
    const restTap = async (sel) => {
      const b = await box(p, sel), q = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 8 };
      await T(cdp, 'touchStart', [rest]); await sleep(40);
      await T(cdp, 'touchStart', [rest, q]); await sleep(60); await T(cdp, 'touchEnd', [q]); await sleep(60);
      await T(cdp, 'touchEnd', [rest]); await sleep(120);
    };
    await restTap('#tab-dec');
    assert(await p.evaluate(() => cols.dataset.mode) === 'dec', '1 一指放在標題上，另一指點「解密」分頁會切換');
    await sleep(850); await restTap('#tab-enc'); await sleep(850);
    const e0 = await themeIdx(p); await restTap('#btn-theme');
    assert((await themeIdx(p) - e0 + 3) % 3 === 1, '1 一指放著時點佈景主題只前進一格');
    await sleep(850); await restTap('.eye[data-for=pw1]');
    assert(await p.evaluate(() => pw1.type) === 'text', '1 一指放著時點「顯示」會顯示密碼');
    await sleep(850); await restTap('label:has(#fmt-qr)');
    assert(await p.evaluate(() => document.querySelector('input[name=fmt]:checked').value) === 'qr', '1 一指放著時點輸出格式 radio 會選取');
    await sleep(850); await restTap('label.check');
    assert(await p.evaluate(() => compact.checked) === true, '1 一指放著時點「緊湊模式」勾選一次（不會勾了又取消）');
    await sleep(850); await restTap('#nb summary');
    assert(await p.evaluate(() => nb.open) === true, '1 一指放著時點「便條本」會展開');
    await sleep(850); await restTap('.note-open');
    assert(await p.evaluate(() => cols.dataset.mode === 'dec' && document.getElementById('cipher-in').value === notes[0].cipher), '1 一指放著時點便條會載入');
    await ctx.close();
  }

  // ---------- 2. 沒有橫向捲動；長標題省略 ----------
  for (const w of [360, 390, 430]) {
    const { ctx, p, cdp } = await open({ w, h: 740 });
    await tap(cdp, p, '#nb summary'); await sleep(100);
    const sw0 = await p.evaluate(() => document.documentElement.scrollWidth);
    await p.evaluate(() => { notes.unshift({ id: 'long', title: '很長的便條標題'.repeat(6), cipher: SAMPLE, createdAt: Date.now() }); renderNotes(); });
    await sleep(100);
    const r = await p.evaluate(() => { const b = document.querySelector('.note-open b'); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, ell: b.scrollWidth > b.clientWidth, right: Math.max(...[...document.querySelectorAll('#notebook, #panel-enc')].map(e => e.getBoundingClientRect().right)) }; });
    assert(sw0 <= w && r.sw <= r.cw && r.right <= w, `2 ${w} 寬打開便條本、加長標題都不需要橫向捲動（${sw0}/${r.sw}/${Math.round(r.right)}）`);
    assert(r.ell, `2 ${w} 寬長標題以省略號截斷`);
    await ctx.close();
  }

  // ---------- 3. 分享連結：大廳裡產生可開啟的連結 ----------
  {
    const { ctx, p, cdp } = await open({ url: ORIGIN + '/tools/#secret-note', hub: true });
    await p.waitForFunction(() => document.getElementById('f').contentDocument && document.getElementById('f').contentDocument.getElementById('cols'));
    const f = p.frames()[1];
    await f.waitForFunction(() => typeof renderNotes === 'function');
    assert(await f.evaluate(() => location.href) === 'about:srcdoc', '3 大廳情境：工具在 about:srcdoc 裡執行');
    assert(await f.evaluate(() => !document.getElementById('fmt-link').disabled && document.getElementById('link-why').hidden), '3 大廳裡提供「分享連結」');
    await f.fill('#plain', '大廳分享測試 ✓'); await f.fill('#pw1', 'lobby-pw-42'); await f.fill('#pw2', 'lobby-pw-42');
    await f.evaluate(() => { const r = document.getElementById('fmt-link'); r.checked = true; r.dispatchEvent(new Event('change')); });
    await f.evaluate(() => document.getElementById('btn-enc').click());
    await f.waitForFunction(() => !busy && document.getElementById('cipher-out').value);
    const link = await f.inputValue('#cipher-out');
    assert(link.startsWith(ORIGIN + '/tools/open/secret-note.html#SN1.'), '3 連結指向同一網站的工具獨立頁：' + link.slice(0, 70));
    const p2 = await ctx.newPage(); p2.on('pageerror', e => errors.push(e.message));
    await p2.goto(link); await p2.waitForFunction(() => typeof renderNotes === 'function');
    assert(await p2.evaluate(() => cols.dataset.mode) === 'dec', '3 開啟連結直接進入「解密」並帶入密文');
    await p2.fill('#pw-dec', 'lobby-pw-42'); await p2.evaluate(() => document.getElementById('btn-dec').click());
    await p2.waitForFunction(() => !busy && !document.getElementById('dec-out-wrap').hidden || !document.getElementById('dec-err').hidden);
    assert(await p2.evaluate(() => document.getElementById('plain-out-text').textContent) === '大廳分享測試 ✓', '3 開啟分享連結後用密碼解開，內容正確');
    await ctx.close();
    // standalone http page: its own address
    const s = await open();
    const l2 = await encrypt(s.p, s.cdp, 'x', 'pw', 'link');
    assert(l2.startsWith(APP + '#SN1.'), '3 獨立頁的分享連結是自己的網址');
    await s.ctx.close();
    // file:// (no address anyone else can open): option hidden with a note
    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p3 = await ctx3.newPage();
    await p3.goto('file://' + FILE); await p3.waitForFunction(() => typeof renderNotes === 'function');
    assert(await p3.evaluate(() => document.getElementById('fmt-link').disabled && !document.getElementById('link-why').hidden && getComputedStyle(document.querySelector('label:has(#fmt-link)')).display === 'none'), '3 無法產生可開啟連結時隱藏「分享連結」並說明原因');
    await ctx3.close();
  }

  // ---------- 4. 儲存空間滿了不說「已存入」 ----------
  {
    const { ctx, p, cdp } = await open();
    await encrypt(p, cdp, '空間測試', 'pw-quota');
    const n0 = await p.evaluate(() => notes.length);
    await p.evaluate(() => { const o = Storage.prototype.setItem; window.__full = true; Storage.prototype.setItem = function (k, v) { if (window.__full && k.endsWith(':notes')) throw new DOMException('full', 'QuotaExceededError'); return o.call(this, k, v); }; });
    await p.fill('#note-title', '存不下'); await tap(cdp, p, '#btn-save-note'); await sleep(100);
    const tt = await toastText(p);
    assert(/儲存空間已滿/.test(tt) && !/已存入/.test(tt), '4 寫入失敗時告訴使用者空間不足：' + tt);
    assert(await p.evaluate(() => notes.length) === n0, '4 寫入失敗時清單不會多一則存不進去的便條');
    await p.reload(); await p.waitForFunction(() => typeof renderNotes === 'function');
    assert(await p.evaluate(() => notes.length) === n0, '4 重新整理後清單與畫面一致');
    // real quota: fill storage, then save
    await encrypt(p, cdp, '真的滿了', 'pw-quota');
    await p.evaluate(() => { let i = 0; for (const size of [1 << 20, 1 << 16, 1 << 10, 64, 1]) { const s = 'x'.repeat(size); for (;;) { try { localStorage.setItem('filler' + i++, s); } catch { break; } } } });
    await p.fill('#note-title', '滿'); await tap(cdp, p, '#btn-save-note'); await sleep(100);
    const t2 = await toastText(p), n2 = await p.evaluate(() => notes.length), stored = await p.evaluate(() => JSON.parse(localStorage.getItem('secret-note:v1:notes')).length);
    assert(/儲存空間已滿/.test(t2) && !/已存入/.test(t2) && n2 === stored, '4 localStorage 真的寫滿時顯示空間不足，畫面上的便條數等於實際存下的數量（' + n2 + '/' + stored + '）');
    await ctx.close();
  }

  // ---------- 5. 刪除可復原；匯出／匯入 ----------
  {
    const { ctx, p, cdp } = await open();
    const c1 = await encrypt(p, cdp, '第一則', 'pw-1'); await p.fill('#note-title', '甲'); await tap(cdp, p, '#btn-save-note'); await sleep(50);
    const before = await p.evaluate(() => notes.map(n => n.title));
    await sleep(850); await tap(cdp, p, '#nb-list li:first-child .btn.danger'); await sleep(100);
    assert(await p.evaluate(() => notes.length) === before.length - 1, '5 刪除一則便條');
    assert(await p.evaluate(() => !document.getElementById('toast-act').hidden && document.getElementById('toast-act').textContent) === '復原', '5 刪除後出現「復原」');
    await sleep(850); await tap(cdp, p, '#toast-act'); await sleep(100);
    assert(JSON.stringify(await p.evaluate(() => notes.map(n => n.title))) === JSON.stringify(before), '5 按「復原」放回原位');
    await p.reload(); await p.waitForFunction(() => typeof renderNotes === 'function');
    assert(JSON.stringify(await p.evaluate(() => notes.map(n => n.title))) === JSON.stringify(before), '5 復原的便條重新整理後還在');
    // export
    await tap(cdp, p, '#nb summary'); await sleep(100);
    const dl = p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await tap(cdp, p, '#btn-export'); const d = await dl;
    const j = d ? JSON.parse(fs.readFileSync(await d.path(), 'utf8')) : null;
    assert(j && j.app === 'secret-note' && j.notes.length === before.length && j.notes.some(n => n.cipher === c1), '5 匯出 JSON 含全部便條的密文');
    assert(j && !JSON.stringify(j).includes('第一則') && j.notes.every(n => Object.keys(n).every(k => ['id', 'title', 'cipher', 'createdAt'].includes(k))), '5 匯出檔只有標題與密文，沒有明文或密碼');
    // import into a fresh browser: one new, one duplicate, one broken
    const o2 = await open();
    await o2.p.evaluate(() => { notes = []; saveNotes([]); renderNotes(); });
    const backup = path.join(path.dirname(FILE), 'backup.json');
    fs.writeFileSync(backup, JSON.stringify({ app: 'secret-note', version: 1, notes: [...j.notes, j.notes[0], { title: '壞的', cipher: 'SN1.AQ' }] }));
    await o2.p.setInputFiles('#import-file', backup); await sleep(300);
    assert(await o2.p.evaluate(() => notes.length) === j.notes.length, '5 匯入備份，略過重複與壞掉的便條：' + await toastText(o2.p));
    await o2.p.reload(); await o2.p.waitForFunction(() => typeof renderNotes === 'function');
    assert(await o2.p.evaluate(c => notes.some(n => n.cipher === c), c1), '5 匯入的便條重新整理後還在');
    await o2.ctx.close(); await ctx.close();
  }

  // ---------- 6. 要加密的文字沒有預填 ----------
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => ({ v: plain.value, ph: plain.placeholder, why: document.getElementById('enc-why').textContent }));
    assert(r.v === '' && r.ph.length > 0 && /請先輸入/.test(r.why), '6 加密框是空的、用 placeholder 提示');
    await ctx.close();
  }

  // ---------- 7、10. 提示：短、不擋內容、不孤字 ----------
  {
    const { ctx, p, cdp } = await open({ w: 360, h: 640 });
    await encrypt(p, cdp, '提示測試', 'pw-toast');
    await tap(cdp, p, '#btn-copy-cipher'); await sleep(100);
    assert(/已複製/.test(await toastText(p)), '7 複製後出現提示');
    const pe = await p.evaluate(() => getComputedStyle(document.getElementById('toast')).pointerEvents);
    assert(pe === 'none', '7 提示本身不攔截點擊（只有它的按鈕可以點）');
    const gone = await waitFor(p, () => document.getElementById('toast').hidden, null, 3600);
    assert(gone, '7 複製提示約 3 秒後消失');
    await p.fill('#note-title', '提示'); await sleep(850); await tap(cdp, p, '#btn-save-note'); await sleep(100);
    const r = await p.evaluate(() => { const s = document.getElementById('toast-text'), rg = document.createRange(); rg.selectNodeContents(s); const lh = parseFloat(getComputedStyle(s).lineHeight) || 21; return { t: s.textContent, lines: Math.round(s.getBoundingClientRect().height / lh), w: document.getElementById('toast').getBoundingClientRect().width }; });
    assert(r.t === '已存入便條本（只存密文）' && r.lines === 1, `10 360 寬存入提示一行顯示（${r.lines} 行，寬 ${Math.round(r.w)}）`);
    await ctx.close();
  }

  // ---------- 8. 觸控目標至少 44 px ----------
  {
    const { ctx, p } = await open({ w: 360, h: 640 });
    const s = await p.evaluate(() => ['#tab-enc', '#tab-dec', '.eye[data-for=pw1]', '.eye[data-for=pw2]'].map(q => { const r = document.querySelector(q).getBoundingClientRect(); return Math.min(r.width, r.height); }));
    assert(s.every(v => v >= 44), '8 加密／解密分頁與「顯示」按鈕至少 44 px：' + s.map(Math.round).join('/'));
    await ctx.close();
  }

  // ---------- 9. 壞掉的儲存資料 ----------
  {
    const seed = (kv) => [(kv) => { if (!sessionStorage.getItem('seeded')) { for (const k in kv) localStorage.setItem('secret-note:v1:' + k, kv[k]); sessionStorage.setItem('seeded', '1'); } }, kv];
    const S = 'SN1.AQAACSfArl53M908cpcARyAGcLV0HSRZpF3ZHruhQz_7ZpLt1faPomEILFw566OCCJP6Wpv2mBl0Ssmxvy1tiK7li4ZrUZw8v8rckHXurCoeXhRwx_m-rZAFQz0ZT4HlVkxIKi9XfyGIBnBVIPaCa9IKS1TGxMsdmHSu6gdWX1vIuW0DRC4';
    const { ctx, p, cdp } = await open({ init: seed({ notes: JSON.stringify([{ cipher: S, title: 'A' }, { cipher: S, title: 'B' }, { id: 'k', cipher: S, title: 'C', createdAt: 'zzz' }, { id: 'k', cipher: S, title: 'D', createdAt: 1e20 }]), prefs: '{"fmt":"zzz","idle":"abc","compact":"yes"}' }) });
    const r = await p.evaluate(() => ({ ids: notes.map(n => n.id), smalls: [...document.querySelectorAll('.note-open small')].map(s => s.textContent), fmt: document.querySelector('input[name=fmt]:checked')?.value, idle: idle.value, compact: compact.checked }));
    assert(r.ids.length === 4 && new Set(r.ids).size === 4 && r.ids.every(Boolean), '9 沒有 id 或 id 重複的便條各自補上唯一 id');
    assert(r.smalls.every(s => !/NaN/.test(s)) && r.smalls.filter(s => s.startsWith('日期不明')).length === 4, '9 壞的建立時間顯示「日期不明」，不是 NaN');
    assert(r.fmt === 'text' && r.idle === '2' && r.compact === false, '9 不合法的 prefs.fmt／idle／compact 用預設值');
    await tap(cdp, p, '#nb summary'); await sleep(100);
    await tap(cdp, p, '#nb-list li:first-child .btn.danger'); await sleep(100);
    assert(await p.evaluate(() => notes.map(n => n.title).join('')) === 'BCD', '9 刪一則只刪掉那一則');
    await ctx.close();
    const o2 = await open({ init: seed({ prefs: '[1,2]', notes: '{"a":1}' }) });
    assert(await o2.p.evaluate(() => document.querySelector('input[name=fmt]:checked')?.value === 'text' && idle.value === '2'), '9 prefs 是陣列時用預設值');
    await o2.ctx.close();
    // existing keys keep loading: theme / prefs / notes from the old version
    const o3 = await open({ init: seed({ theme: '"dark"', prefs: '{"fmt":"qr","idle":5,"compact":true}', notes: JSON.stringify([{ id: 'old1', title: '舊便條', cipher: S, createdAt: 1700000000000 }]) }) });
    const r3 = await o3.p.evaluate(() => ({ theme, fmt: document.querySelector('input[name=fmt]:checked')?.value, idle: idle.value, compact: compact.checked, notes: notes.map(n => n.title + n.id) }));
    assert(r3.theme === 'dark' && r3.fmt === 'qr' && r3.idle === '5' && r3.compact && r3.notes.join() === '舊便條old1', '9 舊版存的佈景主題、設定與便條照常載入');
    await tap(o3.cdp, o3.p, '#nb summary'); await sleep(850); await tap(o3.cdp, o3.p, '.note-open'); await sleep(100); await o3.p.fill('#pw-dec', 'demo1234'); await sleep(850);
    await o3.p.evaluate(() => document.getElementById('btn-dec').click());
    const ok9 = await waitFor(o3.p, () => !busy && !document.getElementById('dec-out-wrap').hidden);
    assert(ok9, '9 舊便條（SN1 範例）仍可解密' + (ok9 ? '' : '：' + JSON.stringify(await o3.p.evaluate(() => [cols.dataset.mode, document.getElementById('cipher-in').value.slice(0, 20), document.getElementById('pw-dec').value, document.getElementById('dec-err').textContent]))));
    await o3.ctx.close();
  }

  await browser.close(); srv.close();
  assert(!errors.length, '沒有頁面錯誤' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); srv.close(); process.exit(1); });
