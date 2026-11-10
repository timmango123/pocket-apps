// 心情日記：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）
// 真實 CDP 觸控：長按刪除不會 ghost click、慢按 0.6/1 秒、另一指按著時點按；草稿、跨午夜、匯入、兩分頁、儲存失敗、PIN、字形計數、版面。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SRC = path.resolve(__dirname, '../index.html');
const SK = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const KEY = 'mood-journal:v1:data', DKEY = 'mood-journal:v1:draft';
const mk = (date, mood, t = [], note = '') => ({ date, mood, tags: t, note, updatedAt: 1 });
const tags = ['工作', '運動', '家人', '朋友'].map((n, i) => ({ id: 't' + i, name: n }));
const ENTRIES = {}; for (let d = 1; d <= 8; d++) ENTRIES[`2026-11-0${d}`] = mk(`2026-11-0${d}`, (d % 5) + 1, ['t0'], 'n' + d);
const NOW = new Date('2026-11-08T21:00:00+08:00');
const errors = [];

(async () => {
  const html = SK + fs.readFileSync(SRC, 'utf8') + '</body></html>';
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, o = {}) {
    const ctx = o.ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'Asia/Taipei', locale: 'zh-TW', acceptDownloads: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('dialog', d => { errors.push('native dialog ' + d.message()); d.dismiss(); });
    if (o.clock !== false) await p.clock.install({ time: o.clock || NOW });
    if (o.data !== undefined) await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); if (v) localStorage.setItem(k, v); } }, [KEY, o.data ? JSON.stringify(o.data) : null]);
    await p.goto(BASE); await p.waitForSelector('#grid button.cell');
    const cdp = await ctx.newCDPSession(p);
    return { ctx, p, cdp };
  }
  const tp = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const ctr = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  // hold for `ms` using real time (the page clock is paused-free: install() keeps it running)
  const touch = async (cdp, x, y, ms) => { await tp(cdp, 'touchStart', [{ x, y, id: 1 }]); await new Promise(r => setTimeout(r, ms)); await tp(cdp, 'touchEnd', []); };
  const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
  const nEntries = p => p.evaluate(() => Object.keys(window.__mj.data.entries).length);
  const moodOn = p => p.evaluate(() => [1, 2, 3, 4, 5].find(v => document.querySelector('#mood-' + v).getAttribute('aria-pressed') === 'true') || 0);

  // ---------- 1. long-press delete: no ghost click (cell placed where 刪除 / 取消 will appear) ----------
  {
    const { ctx, p, cdp } = await open(390, 844, { data: { entries: ENTRIES, tags, settings: { pin: null } } });
    async function alignUnder(ds, target) {
      await p.evaluate(() => document.querySelector('#cfmDlg').showModal()); const b = await ctr(p, target); await p.evaluate(() => document.querySelector('#cfmDlg').close());
      await p.evaluate(([ds, y]) => { const r = document.querySelector(`.cell[data-ds="${ds}"]`).getBoundingClientRect(); window.scrollBy(0, r.top + r.height / 2 - y); }, [ds, b.y]); await settle(p);
      const c = await ctr(p, `.cell[data-ds="${ds}"]`); return { x: b.x, y: c.y };
    }
    for (const hold of [600, 1000]) for (const tgt of ['#cfmYes', '#cfmNo']) {
      const a = await alignUnder('2026-11-02', tgt);
      const onCell = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.dataset?.ds, [a.x, a.y]);
      await touch(cdp, a.x, a.y, hold); await p.waitForTimeout(450);
      const st = await p.evaluate(() => ({ open: document.querySelector('#cfmDlg').open, n: Object.keys(window.__mj.data.entries).length }));
      assert(/^2026-11-0/.test(onCell || '') && st.open && st.n === 8, `長按 ${hold}ms（格子在「${tgt === '#cfmYes' ? '刪除' : '取消'}」下）：確認框開著、沒被刪 ${JSON.stringify(st)}`);
      await p.click('#cfmNo'); await settle(p);
    }
    // confirm then delete, with undo
    let c = await ctr(p, '.cell[data-ds="2026-11-03"]'); await touch(cdp, c.x, c.y, 700); await p.waitForTimeout(100);
    c = await ctr(p, '#cfmYes'); await touch(cdp, c.x, c.y, 40); await settle(p);
    assert(await nEntries(p) === 7, '長按後按「刪除」才刪除');
    c = await ctr(p, '#toastAct'); await touch(cdp, c.x, c.y, 40); await settle(p);
    assert(await nEntries(p) === 8, '刪除後 toast「復原」可以復原');
    // short tap on a recorded cell just selects it, no dialog
    c = await ctr(p, '.cell[data-ds="2026-11-05"]'); await touch(cdp, c.x, c.y, 40); await settle(p);
    assert(await p.evaluate(() => document.querySelector('.cell.sel')?.dataset.ds === '2026-11-05' && !document.querySelector('#cfmDlg').open), '短按格子只選取');
    // backdrop: a press that starts inside the dialog and ends outside does not close it
    await p.evaluate(() => document.querySelector('#cfmDlg').showModal());
    const db = await p.locator('#cfmDlg').boundingBox();
    await tp(cdp, 'touchStart', [{ x: db.x + 20, y: db.y + 20, id: 1 }]); await tp(cdp, 'touchEnd', []); await settle(p);
    assert(await p.evaluate(() => document.querySelector('#cfmDlg').open), '點對話框內部不會關閉');
    await touch(cdp, 20, 20, 40); await settle(p);
    assert(!(await p.evaluate(() => document.querySelector('#cfmDlg').open)), '點背景關閉確認框');

    // (CDP touchEnd lists the finger(s) being lifted)
    // ---------- 2. slow taps and taps with another finger down ----------
    await p.evaluate(() => document.querySelector('#moods').scrollIntoView({ block: 'center' })); await settle(p);
    let n = 0;
    for (const [hold, v] of [[600, 1], [1000, 3]]) { c = await ctr(p, '#mood-' + v); await touch(cdp, c.x, c.y, hold); await p.waitForTimeout(200); if (await moodOn(p) === v) n++; }
    assert(n === 2, `慢按 0.6 秒、1 秒的心情鈕都有效（${n}/2）`);
    await p.click('#mood-3'); // clear back to 0
    // finger on title, 10 taps alternating mood-1 / mood-5 with a second finger
    const h1 = await ctr(p, 'h1'); const m1 = await ctr(p, '#mood-1'), m5 = await ctr(p, '#mood-5');
    await tp(cdp, 'touchStart', [{ x: h1.x, y: h1.y, id: 1 }]);
    const seen = [];
    for (let i = 0; i < 10; i++) { const b = i % 2 ? m5 : m1; await tp(cdp, 'touchStart', [{ x: h1.x, y: h1.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); await tp(cdp, 'touchEnd', [{ x: b.x, y: b.y, id: 2 }]); await settle(p); seen.push(await moodOn(p)); }
    await tp(cdp, 'touchEnd', []); await settle(p);
    assert(seen.join() === '1,5,1,5,1,5,1,5,1,5', `另一指按著標題時，第二指點心情 10 次都生效（${seen.join()}）`);
    // hold mood-2, tap tag t1, lift mood-2 → both count
    await p.click('#mood-5'); // unselect
    const a2 = await ctr(p, '#mood-2'), t1 = await ctr(p, '#tag-t1');
    await tp(cdp, 'touchStart', [{ x: a2.x, y: a2.y, id: 1 }]); await tp(cdp, 'touchStart', [{ x: a2.x, y: a2.y, id: 1 }, { x: t1.x, y: t1.y, id: 2 }]);
    await tp(cdp, 'touchEnd', [{ x: t1.x, y: t1.y, id: 2 }]); await settle(p); await tp(cdp, 'touchEnd', []); await settle(p);
    assert(await moodOn(p) === 2 && await p.getAttribute('#tag-t1', 'aria-pressed') === 'true', '按住心情 2、另一指點標籤，兩個都生效');
    // calendar: hold 11/2, other finger taps 11/6, lift 11/2 → selection 11/2, month unchanged (no fake swipe)
    await p.evaluate(() => document.querySelector('#grid').scrollIntoView({ block: 'center' })); await settle(p);
    const c2 = await ctr(p, '.cell[data-ds="2026-11-02"]'), c6 = await ctr(p, '.cell[data-ds="2026-11-06"]');
    await tp(cdp, 'touchStart', [{ x: c2.x, y: c2.y, id: 1 }]); await tp(cdp, 'touchStart', [{ x: c2.x, y: c2.y, id: 1 }, { x: c6.x, y: c6.y, id: 2 }]);
    await tp(cdp, 'touchEnd', [{ x: c6.x, y: c6.y, id: 2 }]); await settle(p);
    const mid = await p.evaluate(() => document.querySelector('.cell.sel')?.dataset.ds);
    await tp(cdp, 'touchEnd', []); await settle(p);
    const cs = await p.evaluate(() => ({ sel: document.querySelector('.cell.sel')?.dataset.ds, m: document.querySelector('#calH').textContent }));
    assert(mid === '2026-11-06' && cs.sel === '2026-11-02' && cs.m === '2026 年 11 月', `月曆兩指：各自算點按、不會被當成滑動 ${mid} ${JSON.stringify(cs)}`);
    // a real swipe still changes month, and the follow-up click is swallowed
    const s12 = await ctr(p, '.cell[data-ds="2026-11-12"]');
    await tp(cdp, 'touchStart', [{ x: s12.x + 100, y: s12.y, id: 1 }]);
    for (let i = 1; i <= 6; i++) await tp(cdp, 'touchMove', [{ x: s12.x + 100 - i * 25, y: s12.y, id: 1 }]);
    await tp(cdp, 'touchEnd', []); await settle(p);
    assert(await p.textContent('#calH') === '2026 年 12 月', '左滑換到下個月');
    await p.click('#prevM');
    // tap counts: 8 alternating real taps on month buttons → net zero
    for (let i = 0; i < 8; i++) { const b = await ctr(p, i % 2 ? '#prevM' : '#nextM'); await touch(cdp, b.x, b.y, 30); }
    await settle(p); assert(await p.textContent('#calH') === '2026 年 11 月', '上/下個月交替 8 次不多不少');
    await ctx.close();
  }

  // ---------- 3. drafts ----------
  {
    const { ctx, p } = await open(390, 844, { data: { entries: {}, tags, settings: { pin: null } } });
    await p.click('#mood-2'); await p.click('#tag-t0'); await p.fill('#note', '寫了一大段還沒按儲存的心情');
    await p.reload(); await p.waitForSelector('#grid button.cell');
    const st = await p.evaluate(() => ({ note: document.querySelector('#note').value, t0: document.querySelector('#tag-t0').getAttribute('aria-pressed'), msg: document.querySelector('#saveMsg').textContent }));
    assert(await moodOn(p) === 2 && st.note === '寫了一大段還沒按儲存的心情' && st.t0 === 'true' && /已還原/.test(st.msg), '重新整理後草稿（心情、標籤、短記）還原 ' + JSON.stringify(st));
    await p.click('.cell[data-ds="2026-11-05"]'); await p.click('#editDay');
    assert((await p.textContent('#qTitle')).includes('11 月 5 日') && await p.inputValue('#note') === '', '切到別天：表單換成那天');
    await p.click('#mood-4'); await p.fill('#note', '補寫五號');
    await p.click('#backToday');
    assert(await p.inputValue('#note') === '寫了一大段還沒按儲存的心情' && await moodOn(p) === 2, '回到今天：今天的草稿還在');
    await p.click('.cell[data-ds="2026-11-05"]'); await p.click('#editDay');
    assert(await p.inputValue('#note') === '補寫五號', '回到 11/5：那天的草稿也還在');
    await p.click('#saveBtn');
    const dr = await p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), DKEY);
    assert(dr && !dr.items['2026-11-05'] && dr.items['2026-11-08'], '儲存後清掉該天草稿，其他天草稿保留');
    // pagehide flush (draft is also written on every change)
    await p.click('#backToday'); await p.click('#saveBtn');
    assert(await p.evaluate(k => localStorage.getItem(k), DKEY) === null, '全部儲存後沒有殘留草稿');
    // ---------- 4. two tabs: storage event keeps the other tab in sync ----------
    const p2 = await ctx.newPage(); p2.on('pageerror', e => errors.push(e.message));
    await p2.clock.install({ time: NOW }); await p2.goto(BASE); await p2.waitForSelector('#grid button.cell');
    await p.click('.cell[data-ds="2026-11-07"]'); await p.click('#editDay'); await p.click('#mood-1'); await p.click('#saveBtn');
    await p2.waitForFunction(() => !!window.__mj.data.entries['2026-11-07']);
    await p2.click('.cell[data-ds="2026-11-06"]'); await p2.click('#editDay'); await p2.click('#mood-3'); await p2.click('#saveBtn');
    await p.reload(); await p.waitForSelector('#grid button.cell');
    const keys = await p.evaluate(() => Object.keys(window.__mj.data.entries).sort().join());
    assert(keys === '2026-11-05,2026-11-06,2026-11-07,2026-11-08', '兩個分頁各存一天，兩筆都在 ' + keys);
    await p2.close();
    // ---------- 5. storage failure is reported, not "已儲存" ----------
    await p.evaluate(() => { const o = Storage.prototype.setItem; window.__o = o; Storage.prototype.setItem = function (k, v) { if (k === 'mood-journal:v1:data') throw new DOMException('full', 'QuotaExceededError'); return o.call(this, k, v); }; });
    await p.click('#mood-5'); await p.click('#saveBtn');
    const msg = await p.textContent('#saveMsg');
    assert(/無法儲存/.test(msg) && await p.isVisible('#storeBanner'), '寫入失敗時顯示「無法儲存」與橫幅：' + msg);
    await p.evaluate(() => { Storage.prototype.setItem = window.__o; });
    await p.click('#saveBtn');
    assert(!(await p.isVisible('#storeBanner')) && !/無法/.test(await p.textContent('#saveMsg')), '恢復後再存，橫幅消失');
    await ctx.close();
  }

  // ---------- 6. midnight rollover ----------
  {
    const { ctx, p } = await open(390, 844, { clock: new Date('2026-11-08T23:58:00+08:00'), data: { entries: { '2026-11-08': mk('2026-11-08', 5, [], '昨天很開心') }, tags, settings: { pin: null } } });
    await p.clock.fastForward('05:00'); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const st = await p.evaluate(() => [document.querySelector('#qTitle').textContent, document.querySelector('.cell.today')?.dataset.ds]);
    assert(st[0] === '今天感覺如何？' && st[1] === '2026-11-09', '跨過午夜：表單和月曆換到新的今天 ' + st);
    await p.click('#mood-2'); await p.fill('#note', '新的一天'); await p.click('#saveBtn');
    const e = await p.evaluate(() => window.__mj.data.entries);
    assert(e['2026-11-08'].note === '昨天很開心' && e['2026-11-09'].note === '新的一天', '存到 11/9，昨天的紀錄沒被覆寫');
    // unsaved typing across midnight → asks which day
    await p.clock.fastForward('24:00:00'); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.click('#mood-4'); await p.fill('#note', '寫到一半');
    await p.clock.fastForward('24:00:00'); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert((await p.textContent('#qTitle')).includes('11 月 10 日'), '有未存內容時跨午夜，標題明確寫出 11 月 10 日');
    await p.click('#saveBtn');
    assert(await p.isVisible('#cfmDlg') && (await p.textContent('#cfmT')).includes('哪一天'), '儲存時詢問要存到哪一天');
    await p.click('#cfmNo'); // 改存到今天
    const e2 = await p.evaluate(() => window.__mj.data.entries);
    assert(e2['2026-11-11'] && e2['2026-11-11'].note === '寫到一半' && !e2['2026-11-10'], '選「改存到今天」存到 11/11');
    await ctx.close();
  }

  // ---------- 7. import: validation reasons, confirm, undo, paste, download ----------
  {
    const { ctx, p } = await open(390, 844, { data: { entries: { '2026-11-01': mk('2026-11-01', 4, [], '新資料') }, tags, settings: { pin: null } } });
    await p.click('#openSet'); await p.click('#pasteBtn');
    const bad = [
      [{ entries: { '2026-02-30': mk('2026-02-30', 3) }, tags }, '沒有這一天'],
      [{ entries: { '2030-01-01': mk('2030-01-01', 3) }, tags }, '未來'],
      [{ entries: { '2026-10-01': mk('2026-10-01', 3, [1, null]) }, tags }, 'tags'],
      [{ entries: { '2026-10-01': mk('2026-10-01', 6) }, tags }, 'mood'],
    ];
    for (const [d, why] of bad) { await p.fill('#impText', JSON.stringify({ app: 'mood-journal', data: d })); await p.click('#impPaste'); const t = await p.textContent('#setErr'); assert(t.includes(why) && !(await p.evaluate(() => document.querySelector('#cfmDlg').open)), `壞檔被擋並說明原因：${t}`); }
    await p.fill('#impText', '{"entries": {'); await p.click('#impPaste'); assert((await p.textContent('#setErr')).includes('JSON'), '截斷的 JSON 被擋');
    assert(await nEntries(p) === 1, '壞檔都沒改到資料');
    await p.fill('#impText', JSON.stringify({ app: 'mood-journal', data: { entries: { '2026-10-01': mk('2026-10-01', 2, [], '舊備份') }, tags, settings: { pin: null } } }));
    await p.click('#impPaste');
    assert(await p.isVisible('#cfmDlg') && (await p.textContent('#cfmMsg')).includes('取代現有的 1 筆'), '匯入前確認會取代幾筆');
    await p.click('#cfmNo'); assert(await p.evaluate(() => !!window.__mj.data.entries['2026-11-01']), '取消匯入不改資料');
    await p.click('#impPaste'); await p.click('#cfmYes');
    assert(await p.evaluate(() => Object.keys(window.__mj.data.entries).join()) === '2026-10-01', '貼上 JSON 匯入成功');
    await p.click('#toastAct');
    assert(await p.evaluate(() => Object.keys(window.__mj.data.entries).join()) === '2026-11-01', '匯入後「復原」回到原資料');
    await p.click('#openSet');
    assert(await p.isVisible('#restoreImp'), '設定裡有「還原匯入前的資料」');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('#dlJson')]);
    let ok = false; if (dl) { try { ok = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')).data.entries['2026-11-01'].note === '新資料'; } catch (e) {} }
    assert(dl && /^mood-journal-2026-11-08\.json$/.test(dl.suggestedFilename()) && ok, '沒有 downloads 能力時用 Blob 下載 .json');
    // ---------- 8. tag delete asks first ----------
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({ entries: { '2026-11-01': mk('2026-11-01', 4, ['t1']), '2026-11-02': mk('2026-11-02', 4, ['t1']) }, tags, settings: { pin: null } })]);
    await p.reload(); await p.waitForSelector('#grid button.cell');
    await p.click('#openSet'); await p.click('[aria-label="刪除標籤 運動"]');
    assert(await p.isVisible('#cfmDlg') && (await p.textContent('#cfmMsg')).includes('2 筆') && (await p.evaluate(() => window.__mj.data.tags.length)) === 4, '刪除標籤先確認，說明有 2 筆紀錄用到');
    await p.click('#cfmNo'); assert(await p.evaluate(() => window.__mj.data.entries['2026-11-01'].tags.join()) === 't1', '取消後標籤還在');
    await p.click('[aria-label="刪除標籤 運動"]'); await p.click('#cfmYes');
    assert(await p.evaluate(() => window.__mj.data.tags.length === 3 && window.__mj.data.entries['2026-11-01'].tags.length === 0), '確認後才刪除標籤');
    // ---------- 9. grapheme counting ----------
    await p.fill('#newTag', '👨‍👩‍👧‍👦'); await p.click('#addTag');
    assert(await p.evaluate(() => window.__mj.data.tags.some(t => t.name === '👨‍👩‍👧‍👦')), 'ZWJ 家庭 emoji 標籤完整保留');
    await p.fill('#newTag', '一二三四五六七八九十'); assert(await p.inputValue('#newTag') === '一二三四五六七八', '標籤上限 8 字');
    await p.click('#setDlg [data-close]');
    await p.fill('#note', '😀'.repeat(300));
    assert(await p.evaluate(() => window.__mj.glen(document.querySelector('#note').value)) === 280 && (await p.textContent('#count')) === '280 / 280', '短記可放 280 個 emoji，計數以字形計');
    // ---------- 10. search matches tag names ----------
    await p.fill('#note', ''); await p.click('#mood-3'); await p.click('#tag-t2'); await p.click('#saveBtn');
    await p.fill('#search', '家人');
    assert(await p.$$eval('#results li', l => l.filter(x => x.textContent.includes('2026-11-08')).length) === 1, '搜尋標籤名稱「家人」找到只有標籤的那天');
    await ctx.close();
  }

  // ---------- 11. PIN confirm + forgot ----------
  {
    const { ctx, p } = await open(390, 844, { data: { entries: { '2026-11-01': mk('2026-11-01', 4) }, tags, settings: { pin: null } } });
    await p.click('#openSet'); await p.fill('#pinIn', '1234'); await p.fill('#pinIn2', '1243'); await p.click('#pinSet');
    assert((await p.textContent('#setErr')).includes('不一樣') && await p.evaluate(() => !window.__mj.data.settings.pin), 'PIN 兩次不同不會設定');
    await p.fill('#pinIn', '1234'); await p.fill('#pinIn2', '1234'); await p.click('#pinSet');
    await p.waitForFunction(() => !!window.__mj.data.settings.pin);
    await p.reload(); await p.waitForSelector('#grid button.cell');
    assert(await p.isVisible('#lock') && await p.evaluate(() => document.querySelector('.wrap').inert), '上鎖時背後內容不可操作');
    await p.click('#forgotBtn'); assert(await p.isVisible('#wipeBtn'), '鎖定畫面有「忘記 PIN？」說明');
    await p.click('#wipeBtn'); await p.click('#cfmYes'); await p.click('#cfmYes');
    assert(!(await p.isVisible('#lock')) && await nEntries(p) === 0 && await p.evaluate(() => !window.__mj.data.settings.pin), '二次確認後清除全部並解除鎖定');
    await ctx.close();
  }

  // ---------- 12. layout: touch targets, contrast, chart text, settings buttons, save reachable ----------
  for (const [w, h] of [[360, 640], [390, 610]]) {
    const { ctx, p } = await open(w, h, { data: { entries: ENTRIES, tags, settings: { pin: null } } });
    const r = await p.evaluate(() => { const b = document.querySelector('#saveBtn').getBoundingClientRect(); return { bottom: b.bottom, top: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.id }; });
    assert(r.bottom <= h && r.top === 'saveBtn', `${w}×${h}：「儲存」在第一屏內可點（bottom ${Math.round(r.bottom)}）`);
    const f = await p.evaluate(() => { const s = document.querySelector('.chart'), t = s.querySelector('text'); const k = s.getBoundingClientRect().width / 310; return parseFloat(getComputedStyle(t).fontSize) * k; });
    assert(f >= 11.9, `${w}：圖表文字實際 ≥ 12px（${f.toFixed(1)}）`);
    const col = await p.evaluate(() => { const m = getComputedStyle(document.querySelector('.wk span')).color, c = getComputedStyle(document.querySelector('#count')).color, t = getComputedStyle(document.querySelector('.chart text')).fill; return [m, c, t]; });
    assert(col.every(x => x === 'rgb(90, 95, 104)'), '星期列、字數、圖表字改用 --muted ' + col.join(' / '));
    // chart tap anywhere near a point shows it
    await p.evaluate(() => document.querySelector('.chart').scrollIntoView({ block: 'center' })); await settle(p); const cb = await p.locator('.chart').boundingBox(); await p.mouse.click(cb.x + cb.width * 0.15, cb.y + cb.height * 0.5);
    assert(/^11\/\d+ /.test(await p.textContent('#ptinfo')), '點圖表任一處顯示最近那天');
    await p.fill('#search', 'n');
    const sz = await p.evaluate(() => ({ d: document.querySelector('#results .d').getBoundingClientRect().height }));
    assert(sz.d >= 44, `搜尋結果日期鈕高 ≥ 44（${sz.d}）`);
    await p.click('#openSet');
    const st = await p.evaluate(() => ({ x: Math.min(...[...document.querySelectorAll('#tagEdit button')].map(b => Math.min(b.offsetWidth, b.offsetHeight))), tall: [...document.querySelectorAll('#setDlg .btn')].filter(b => !b.closest('[hidden]') && b.offsetHeight > 46).map(b => b.textContent) }));
    assert(st.x >= 44 && !st.tall.length, `標籤 ✕ ≥ 44，設定按鈕不斷行（${st.x}，${st.tall.join(',')}）`);
    await ctx.close();
  }
  {
    const { ctx, p } = await open(360, 640, { data: null });
    const b = await p.locator('#clearSample').boundingBox();
    assert(b.height >= 44 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '清除範例高 ≥ 44、沒有橫向捲動');
    await ctx.close();
  }

  assert(errors.length === 0, '沒有 page/console error ' + errors.join(' | '));
  await browser.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
