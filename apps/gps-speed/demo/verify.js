// 測速與里程瀏覽器驗證：node verify.js（QUICK=1 跳過第 4 節的示範截圖）
// Chromium 授予定位權限後，用 context.setGeolocation 沿已知路線（每秒向北 10 m = 36 km/h）送出定位，
// 檢查距離、速度、平均、跳點過濾、暫停、背景中斷、結束儲存、GPX 匯出；另測拒絕權限、嵌入頁面禁止定位、示範模式與意外關閉復原。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '../index.html'), OUT = __dirname;
const SKELETON = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const M_LAT = 1 / 111194.93, LAT0 = 25.0330, LON0 = 121.5300;
const at = north => ({ latitude: LAT0 + north * M_LAT, longitude: LON0, accuracy: 5 });

function serve() {
  const srv = http.createServer((req, res) => {
    const html = fs.readFileSync(SRC, 'utf8');
    if (req.url.startsWith('/framed')) { // 模擬 claude.ai：iframe 沒有授權 geolocation
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(SKELETON + `<iframe id="f" style="width:390px;height:800px;border:0" sandbox="allow-scripts allow-popups" allow="" srcdoc="${(SKELETON + html).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></body></html>`);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SKELETON + html + '</body></html>');
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}
const num = s => parseFloat(String(s).replace(/[^\d.]/g, ''));

(async () => {
  const srv = await serve(), base = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const mob = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Taipei', acceptDownloads: true };
  const watch = p => { const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); return errs; };

  // ---------- 1. 沒有權限時載入 ----------
  {
    const ctx = await browser.newContext(mob), p = await ctx.newPage(), errs = watch(p);
    await p.goto(base); await p.waitForTimeout(800);
    ok(await p.isVisible('#guide') && await p.isHidden('#controls'), '載入時只顯示引導卡，不主動要求權限');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 寬無水平捲動');
    await p.screenshot({ path: path.join(OUT, '390x844-idle.png') });
    // 拒絕權限（未授權時 Chromium 自動拒絕）
    await p.click('#btn-start'); await p.waitForTimeout(1200);
    const msg = await p.textContent('#msg');
    ok(await p.isVisible('#msg') && /權限/.test(msg) && await p.isVisible('#guide'), '拒絕定位：顯示說明並回到引導卡：' + msg.slice(0, 40));
    ok(/timmango123\.github\.io\/pocket-apps\/tools\/#gps-speed/.test(await p.innerHTML('#msg')), '非網站環境被拒時附上網站版連結');
    ok(errs.length === 0, '拒絕時沒有 console 錯誤 ' + errs.join(' | '));
    await ctx.close();
  }

  // ---------- 2. 嵌入頁面不允許定位（claude.ai 情境） ----------
  {
    const ctx = await browser.newContext(mob); await ctx.grantPermissions(['geolocation']);
    const p = await ctx.newPage(), errs = watch(p);
    await p.goto(base + 'framed'); await p.waitForTimeout(800);
    const f = p.frame({ url: /srcdoc/ }) || p.frames()[1];
    await f.click('#btn-start'); await f.waitForTimeout(500);
    const html = await f.innerHTML('#msg');
    ok(/不允許使用 GPS/.test(html) && /href="https:\/\/timmango123\.github\.io\/pocket-apps\/tools\/#gps-speed" target="_blank"/.test(html), 'iframe 未授權定位：說明需要網站版並提供新分頁連結');
    ok(errs.length === 0, '嵌入頁面無 console 錯誤 ' + errs.join(' | '));
    await ctx.close();
  }

  // ---------- 3. 沿已知路線移動 ----------
  const ctx = await browser.newContext(mob);
  await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation(at(0));
  const p = await ctx.newPage(), errs = watch(p);
  await p.goto(base); await p.waitForTimeout(500);
  await p.click('#btn-start');
  await p.waitForFunction(() => +document.getElementById('npts').textContent > 0, null, { timeout: 8000 });
  ok(await p.isVisible('#controls') && (await p.textContent('#state')) === '記錄中', '開始後顯示控制列與「記錄中」');
  const N = 40;
  for (let i = 1; i <= N; i++) { await p.waitForTimeout(1000); await ctx.setGeolocation(at(10 * i)); }
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ dist: document.getElementById('s-dist').textContent, spd: document.getElementById('spd').textContent, avg: document.getElementById('s-avg').textContent, max: document.getElementById('s-max').textContent, acc: document.getElementById('acc').textContent, sig: document.getElementById('sig').dataset.lv, n: document.getElementById('npts').textContent, pace: document.getElementById('pace').textContent, move: document.getElementById('s-move').textContent, real: trip.dist, ts: trip.segs[0].map(q => q.t) }));
  const dt = (r.ts[r.ts.length - 1] - r.ts[0]) / 1000, trueV = 400 / dt * 3.6;
  console.log('   ', JSON.stringify({ dist: r.dist, spd: r.spd, avg: r.avg, max: r.max, acc: r.acc, n: r.n, pace: r.pace, move: r.move, secs: dt.toFixed(1) }));
  ok(Math.abs(num(r.dist) - 400) <= 4, `距離顯示 ${r.dist}（實際 400 m，誤差 < 1%）`);
  ok(Math.abs(num(r.spd) - trueV) <= 3, `目前速度 ${r.spd} km/h（以實際送出時間算約 ${trueV.toFixed(1)}）`);
  ok(Math.abs(num(r.avg) - trueV) <= 3, `平均速度 ${r.avg}`);
  ok(r.acc === '±5 m' && r.sig === '3', 'GPS 狀態列：±5 m、訊號良好');
  ok(+r.n === N + 1, `記錄 ${r.n} 點`);
  ok(/^\d'\d\d"$/.test(r.pace), '配速 ' + r.pace + ' /km');
  // 跳點：瞬間跳到 5 km 外
  await p.waitForTimeout(1000); await ctx.setGeolocation(at(5400)); await p.waitForTimeout(600);
  ok(Math.abs(num(await p.textContent('#s-dist')) - 400) <= 4, '瞬間跳 5 km 的定位被丟棄，距離不變');
  await ctx.setGeolocation(at(410)); await p.waitForTimeout(1000); await ctx.setGeolocation(at(420)); await p.waitForTimeout(500);
  ok(Math.abs(num(await p.textContent('#s-dist')) - 420) <= 5, '回到路線後繼續累加：' + await p.textContent('#s-dist'));
  // 精度差的點：不計距離
  await ctx.setGeolocation({ ...at(425), accuracy: 60 }); await p.waitForTimeout(700);
  ok(Math.abs(num(await p.textContent('#s-dist')) - 420) <= 5 && (await p.getAttribute('#sig', 'data-lv')) === '1', '精度 60 m 的點不計入距離、訊號顯示「差」');
  await ctx.setGeolocation(at(430)); await p.waitForTimeout(1000); await ctx.setGeolocation(at(440)); await p.waitForTimeout(500);
  // 單位切換
  await p.click('#speedo'); await p.waitForTimeout(150);
  ok((await p.textContent('#unit')) === 'mph' && (await p.textContent('#u-dist')) === 'mi', '點速度切換到 mph，距離改為英里');
  await p.click('#btn-unit'); await p.click('#btn-unit'); await p.click('#btn-unit'); await p.waitForTimeout(150);
  ok((await p.textContent('#unit')) === 'km/h', '單位循環回到 km/h');
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('gps-speed.v1')).unit) === 'kmh', '單位存在 gps-speed.v1');
  await p.screenshot({ path: path.join(OUT, '390x844-running.png') });
  // 背景中斷：模擬頁面隱藏 → 回來
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  ok(await p.evaluate(() => watchId === null), '頁面隱藏時清除 watchPosition');
  await p.waitForTimeout(500); await ctx.setGeolocation(at(600));
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); hiddenAt -= 60000; document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(1000); await ctx.setGeolocation(at(610)); await p.waitForTimeout(600);
  const g = await p.evaluate(() => ({ w: watchId !== null, segs: trip.segs.length, gap: trip.gaps[trip.gaps.length - 1], toast: document.getElementById('toast').textContent }));
  ok(g.w && g.segs === 2 && g.gap === true && /背景中斷/.test(g.toast), '回到前景重新定位、開新段並以虛線連接：' + g.toast);
  ok(Math.abs(num(await p.textContent('#s-dist')) - 450) <= 6, '中斷期間的直線距離不計入：' + await p.textContent('#s-dist'));
  // 暫停 → 繼續
  await p.click('#btn-run'); await p.waitForTimeout(150);
  ok((await p.textContent('#state')) === '已暫停' && await p.evaluate(() => watchId === null), '暫停：停止定位');
  const t1 = await p.textContent('#s-time'); await p.waitForTimeout(2200);
  ok(t1 === await p.textContent('#s-time'), '暫停時經過時間不走');
  await ctx.setGeolocation(at(700)); await p.click('#btn-run'); await p.waitForTimeout(300);
  ok((await p.textContent('#state')) !== '已暫停', '繼續記錄');
  await p.waitForTimeout(700); await ctx.setGeolocation(at(710)); await p.waitForTimeout(600);
  ok(Math.abs(num(await p.textContent('#s-dist')) - 460) <= 7 && await p.evaluate(() => trip.segs.length === 3 && trip.gaps[2] === false), '暫停後第一點不和前段連線（分段，實線）');
  // 意外重新整理 → 復原
  await p.reload(); await p.waitForTimeout(600);
  ok(await p.isVisible('#recover') && /沒有結束/.test(await p.textContent('#recover-txt')), '重新整理後提示「上次的行程沒有結束」：' + await p.textContent('#recover-txt'));
  await ctx.setGeolocation(at(800)); await p.click('#rec-resume'); await p.waitForTimeout(300);
  ok((await p.textContent('#state')) !== '已暫停' && await p.isHidden('#recover') && Math.abs(num(await p.textContent('#s-dist')) - 460) <= 7, '選「繼續」：恢復距離並直接開始記錄');
  await p.waitForTimeout(1000); await ctx.setGeolocation(at(820)); await p.waitForTimeout(1000); await ctx.setGeolocation(at(840)); await p.waitForTimeout(600);
  ok(Math.abs(num(await p.textContent('#s-dist')) - 500) <= 8, '復原後繼續累加：' + await p.textContent('#s-dist'));
  // 結束並儲存（按兩次）
  await p.click('#btn-stop');
  ok((await p.textContent('#stop-lbl')) === '再按一次', '結束需要再按一次確認');
  await p.click('#btn-stop'); await p.waitForTimeout(500);
  ok(await p.isVisible('#detail') && await p.isVisible('#guide'), '儲存後開啟紀錄詳情、回到引導卡');
  await p.screenshot({ path: path.join(OUT, '390x844-detail.png') });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dt-gpx')]);
  const gpxPath = path.join(OUT, 'export.gpx'); await dl.saveAs(gpxPath);
  const gpx = fs.readFileSync(gpxPath, 'utf8');
  ok(/^gps-\d{8}-\d{4}\.gpx$/.test(dl.suggestedFilename()) && (gpx.match(/<trkseg>/g) || []).length === 4 && /<time>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/time>/.test(gpx), `匯出 GPX：${dl.suggestedFilename()}，4 段 trkseg、UTC 時間`);
  await p.click('#detail [data-close]');
  await p.click('#tab-log');
  ok(await p.locator('#log-list li').count() === 1 && /500 m/.test(await p.textContent('#log-list')), '紀錄清單 1 筆：' + (await p.textContent('#log-list li')).replace(/\s+/g, ' '));
  // 匯入剛剛的 GPX
  await p.setInputFiles('#gpx-in', gpxPath); await p.waitForTimeout(500);
  ok(await p.isVisible('#detail') && await p.locator('#log-list li').count() === 2 && /匯入/.test(await p.textContent('#dt-title')), '匯入 GPX 成為新紀錄並開啟詳情');
  const imp = await p.evaluate(() => tracks[0].stats.dist);
  ok(Math.abs(imp - 500) <= 8, `匯入軌跡距離 ${imp.toFixed(0)} m（四段各自加總，段間不連線）`);
  await p.click('#dt-del'); await p.click('#dt-del'); await p.waitForTimeout(200);
  ok(await p.locator('#log-list li').count() === 1, '刪除需按兩次');
  ok(errs.length === 0, '整段流程沒有 console 錯誤 ' + errs.join(' | '));
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '紀錄頁無水平捲動');
  await ctx.close();
  fs.unlinkSync(gpxPath);

  // ---------- 4. 示範模式、各尺寸、封面 ----------
  for (const [name, o] of process.env.QUICK ? [] : [['390x844-demo', mob], ['390x844-dark', { ...mob, colorScheme: 'dark' }], ['360x780', { ...mob, viewport: { width: 360, height: 780 } }], ['1280x860-desktop', { viewport: { width: 1280, height: 860 } }], ['cover', { ...mob, viewport: { width: 390, height: 520 } }]]) {
    const c = await browser.newContext(o), q = await c.newPage(), e2 = watch(q);
    await q.goto(base); await q.waitForTimeout(300);
    await q.click('#btn-demo'); await q.waitForTimeout(name === 'cover' ? 36000 : 8000);
    const d = num(await q.textContent('#s-dist'));
    ok(d > 0 && (await q.textContent('#state')) === '示範中', `${name}：示範模式在跑（${await q.textContent('#s-dist')}・${await q.textContent('#spd')} km/h）`);
    ok(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}：無水平捲動`);
    ok(e2.length === 0, `${name}：無錯誤 ${e2.join('|')}`);
    if (name === 'cover') {
      await q.addStyleTag({ content: '#demo-tag,.toast{display:none!important}' });
      await q.evaluate(() => window.scrollTo(0, document.querySelector('.speedo').getBoundingClientRect().top + scrollY - 10));
      await q.waitForTimeout(300);
      await q.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
    } else await q.screenshot({ path: path.join(OUT, name + '.png') });
    await c.close();
  }

  // ---------- 5. 2026-11 審查修正的回歸檢查 ----------
  const fresh = async (o = {}, init, arg) => { const c = await browser.newContext({ ...mob, ...o }); if (init) await c.addInitScript(init, arg); const q = await c.newPage(); return { c, q, e: watch(q) }; };
  // 5a. 復原卡沒處理就開始新行程：舊行程先存進紀錄，不會被覆蓋；卡上的「繼續」不能蓋掉正在記錄的行程
  {
    const { c, q, e } = await fresh(); await c.grantPermissions(['geolocation']); await c.setGeolocation(at(0));
    await q.goto(base); await q.click('#btn-start'); await q.waitForFunction(() => trip && trip.n > 0);
    for (let i = 1; i <= 3; i++) { await q.waitForTimeout(1000); await c.setGeolocation(at(10 * i)); await q.waitForFunction(n => trip.n >= n, i + 1, { timeout: 8000 }); }
    await q.evaluate(() => saveLive()); await q.reload(); await q.waitForSelector('#recover:not([hidden])');
    await c.setGeolocation(at(9000)); await q.click('#btn-start'); await q.waitForFunction(() => trip && trip.n > 0);
    const st = await q.evaluate(() => ({ saved: tracks.length, savedDist: Math.round(tracks[0].stats.dist), card: !document.getElementById('recover').hidden, stored: JSON.parse(localStorage.getItem('gps-speed.v1.tracks')).length }));
    ok(st.saved === 1 && st.savedDist === 30 && !st.card && st.stored === 1, '復原卡沒處理就開始新行程：舊行程（30 m）已存進紀錄、卡片收起 ' + JSON.stringify(st));
    for (let i = 1; i <= 2; i++) { await q.waitForTimeout(1000); await c.setGeolocation(at(9000 + 10 * i)); await q.waitForFunction(n => trip.n >= n, i + 1, { timeout: 8000 }); }
    const before = await q.evaluate(() => trip.dist);
    await q.evaluate(() => document.getElementById('rec-resume').click());
    ok(await q.evaluate(d => trip.dist === d && mode === 'running' && watchId !== null, before), '記錄中按到舊的「繼續」不會換掉正在記錄的行程');
    ok(e.length === 0, '復原流程無錯誤 ' + e.join('|')); await c.close();
  }
  // 5b. 捨棄可以復原
  {
    const live = { segs: [[[25.03, 121.53, null, 1.7e12, 5, 1], [25.0301, 121.53, null, 1.7e12 + 1000, 5, 1]]], gaps: [false], n: 2, dist: 11, moving: 1, max: 1, runMs: 1000, startedAt: 1.7e12 };
    const { c, q, e } = await fresh({}, l => localStorage.setItem('gps-speed.v1.live', l), JSON.stringify(live));
    await q.goto(base); await q.click('#rec-drop');
    ok(await q.isHidden('#recover') && !(await q.evaluate(() => localStorage.getItem('gps-speed.v1.live'))), '捨棄：卡片收起、快照刪除');
    await q.click('#toast button');
    ok(await q.isVisible('#recover') && !!(await q.evaluate(() => localStorage.getItem('gps-speed.v1.live'))), '捨棄後按「復原」回來');
    ok(e.length === 0, '捨棄／復原無錯誤 ' + e.join('|')); await c.close();
  }
  // 5c. 本機紀錄壞資料：紀錄頁不丟 page error；儲存空間滿時記錄中提示一次
  {
    const bad = JSON.stringify([null, { id: 'x' }, { id: 'y', stats: {}, segs: 5 }, { id: 'z', stats: { dist: 100 }, segs: [[[25, 121, null, null, null, null], [25.001, 121, null, null, null, null]]] }]);
    const { c, q, e } = await fresh({}, b => localStorage.setItem('gps-speed.v1.tracks', b), bad);
    await q.goto(base); await q.click('#tab-log');
    ok(await q.locator('#log-list li').count() === 1, '壞資料：只留下可讀的 1 筆');
    await q.click('#log-list button');
    ok(await q.isVisible('#dt-note') && (await q.locator('.kv b').allTextContents()).filter(x => x === '—').length === 4, '沒有時間的紀錄：時間與速度顯示「—」並說明');
    await q.click('#detail [data-close]'); await q.click('#tab-live');
    await q.click('#btn-demo'); await q.waitForFunction(() => trip && trip.n > 2);
    await q.evaluate(() => { demo = null; Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; saveLive(); });
    ok(/空間不足/.test(await q.textContent('#toast')), '空間不足：自動保存失敗時提示：' + await q.textContent('#toast'));
    ok(e.length === 0, '壞資料／空間不足無 page error ' + e.join('|')); await c.close();
  }
  // 5d. 360／320 寬：統計卡與詳情的數字不被切掉（開車速度、1000 km/h、各單位）
  for (const w of [360, 320]) {
    const { c, q, e } = await fresh({ viewport: { width: w, height: 640 } }); await q.goto(base); await q.click('#btn-demo');
    await q.waitForFunction(() => trip && trip.n > 2);
    const cut = [];
    for (const u of ['kmh', 'mph', 'mps', 'kn']) {
      cut.push(...await q.evaluate(u => { settings.unit = u; trip.dist = 1234000; trip.moving = 1234000 / 277; trip.max = 277.7; trip.runMs = 99 * 3600e3; renderNow(); return [...document.querySelectorAll('.stat .v, #spd')].filter(x => x.scrollWidth > x.clientWidth + 1).map(x => u + ':' + x.id + '=' + x.textContent); }, u));
    }
    await q.evaluate(() => { settings.unit = 'kmh'; renderNow(); }); await q.click('#btn-stop'); await q.click('#btn-stop'); await q.waitForSelector('#detail:not([hidden])');
    cut.push(...await q.evaluate(() => [...document.querySelectorAll('.kv b')].filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent)));
    ok(cut.length === 0, `${w} 寬：1000 km/h、四種單位、99 小時都沒有數字被切掉 ${cut.join(' ')}`);
    // toast 不攔截點擊、不蓋住「匯出 GPX／刪除」
    const tb = await q.evaluate(() => { const t = document.getElementById('toast'), r = t.getBoundingClientRect(), hit = ['dt-gpx', 'dt-del'].some(id => { const b = document.getElementById(id).getBoundingClientRect(); return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top; }); return { visible: !t.hidden, pe: getComputedStyle(t).pointerEvents, hit }; });
    ok(tb.visible && tb.pe === 'none' && !tb.hit, `${w} 寬：詳情開著時 toast 不攔截點擊、不蓋住匯出／刪除 ${JSON.stringify(tb)}`);
    // 刪除後可以復原
    await q.click('#dt-del'); await q.click('#dt-del');
    ok(await q.evaluate(() => tracks.length) === 0, '刪除後清單為空');
    await q.click('#toast button');
    ok(await q.evaluate(() => tracks.length === 1 && JSON.parse(localStorage.getItem('gps-speed.v1.tracks')).length === 1), '刪除後 6 秒內按「復原」找回紀錄（也寫回儲存）');
    ok(e.length === 0, `${w} 寬無錯誤 ` + e.join('|')); await c.close();
  }
  // 5e. 分頁與設定分段按鈕 ≥ 44 px
  {
    const { c, q } = await fresh(); await q.goto(base); await q.click('#btn-settings');
    const hs = await q.evaluate(() => [...document.querySelectorAll('.tabs button, .seg button')].map(b => b.getBoundingClientRect().height));
    ok(hs.every(h => h >= 44), '分頁與分段按鈕高度 ≥ 44：' + hs.map(Math.round).join(',')); await c.close();
  }
  // 5f. 矮畫面：速度數字和暫停鍵能同時出現在畫面上；橫式不捲動就看得到
  for (const [w, h] of [[375, 500], [390, 610], [844, 390]]) {
    const { c, q } = await fresh({ viewport: { width: w, height: h } }); await q.goto(base); await q.click('#btn-demo'); await q.waitForFunction(() => trip && trip.n > 1);
    const r = await q.evaluate(() => { scrollTo(0, 0); const a = document.getElementById('spd').getBoundingClientRect(), b = document.getElementById('btn-run').getBoundingClientRect(); return { span: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top), top0: Math.max(a.bottom, b.bottom) }; });
    ok(r.span <= h && (w < h || r.top0 <= h), `${w}×${h}：速度與暫停鍵範圍 ${Math.round(r.span)} px ≤ ${h}` + (w > h ? `，不捲動就看得到（${Math.round(r.top0)}）` : '')); await c.close();
  }
  // 5g. 地圖：單點不離開自動跟隨，拖曳超過 8 px 才離開
  {
    const { c, q } = await fresh(); await q.goto(base); await q.click('#btn-demo'); await q.waitForFunction(() => trip && trip.n > 3);
    const b = await q.locator('#track').boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const cdp = await c.newCDPSession(q), touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [{ x: cx, y: cy, id: 1 }]); await touch('touchMove', [{ x: cx + 3, y: cy + 2, id: 1 }]); await touch('touchEnd', []);
    await q.waitForTimeout(400);
    ok(await q.evaluate(() => view.follow) && await q.isHidden('#btn-follow'), '單點（移動 3 px）地圖仍在自動跟隨');
    await touch('touchStart', [{ x: cx, y: cy, id: 1 }]); for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: cx + 10 * i, y: cy, id: 1 }]); await touch('touchEnd', []);
    await q.waitForFunction(() => !view.follow);
    ok(await q.isVisible('#btn-follow'), '拖曳 50 px 後離開自動跟隨並出現「自動跟隨」'); await c.close();
  }
  // 5h. 匯出全部 → 一次匯入多個檔案
  {
    const { c, q, e } = await fresh(); await q.goto(base);
    const recs = [0, 1].map(k => ({ id: 'r' + k, startedAt: 1.7e12 + k * 1e7, src: 'gps', segs: [[[25, 121 + k, null, 1.7e12 + k * 1e7, 5, 2], [25.001, 121 + k, null, 1.7e12 + k * 1e7 + 60000, 5, 2]]], gaps: [false], stats: { dist: 111, elapsed: 60, moving: 60, avg: 1.85, max: 2 } }));
    await q.evaluate(r => { tracks = r; saveTracks(); setTab('log'); }, recs);
    const [dl] = await Promise.all([q.waitForEvent('download'), q.click('#btn-export-all')]);
    const fp = path.join(OUT, 'all.gpx'); await dl.saveAs(fp); const txt = fs.readFileSync(fp, 'utf8');
    ok((txt.match(/<trk>/g) || []).length === 2, '匯出全部：一個檔案 2 個 <trk>');
    const fp2 = path.join(OUT, 'one.gpx'); fs.writeFileSync(fp2, '<gpx><trk><name><![CDATA[早晨通勤]]></name><trkseg><trkpt lat="200" lon="121"/><trkpt lat="25" lon="121"><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="25.001" lon="121"><time>2026-01-01T00:01:00Z</time></trkpt></trkseg></trk></gpx>');
    await q.setInputFiles('#gpx-in', [fp, fp2]); await q.waitForFunction(() => tracks.length === 5);
    const names = await q.evaluate(() => tracks.slice(0, 3).map(r => r.name + ':' + Math.round(r.stats.dist)));
    ok(names[0] === '早晨通勤:111', '一次匯入多個檔案：共 5 筆；名稱去掉 CDATA、lat=200 的點被丟掉 ' + names.join(','));
    fs.unlinkSync(fp); fs.unlinkSync(fp2);
    ok(e.length === 0, '匯出全部／多檔匯入無錯誤 ' + e.join('|')); await c.close();
  }
  await browser.close(); srv.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
