// 測速與里程瀏覽器驗證：node verify.js
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
  ok((await p.textContent('#unit')) === 'mph' && /mi$/.test(await p.textContent('#s-dist')), '點速度切換到 mph，距離改為英里');
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
  await p.click('#rec-resume'); await p.waitForTimeout(300);
  ok((await p.textContent('#state')) === '已暫停' && Math.abs(num(await p.textContent('#s-dist')) - 460) <= 7, '選「繼續」：恢復距離並等待按繼續');
  await ctx.setGeolocation(at(800)); await p.click('#btn-run'); await p.waitForTimeout(1000); await ctx.setGeolocation(at(820)); await p.waitForTimeout(1000); await ctx.setGeolocation(at(840)); await p.waitForTimeout(600);
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
  for (const [name, o] of [['390x844-demo', mob], ['390x844-dark', { ...mob, colorScheme: 'dark' }], ['360x780', { ...mob, viewport: { width: 360, height: 780 } }], ['1280x860-desktop', { viewport: { width: 1280, height: 860 } }], ['cover', { ...mob, viewport: { width: 390, height: 520 } }]]) {
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
  await browser.close(); srv.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
