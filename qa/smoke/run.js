// 全部 app 的回歸測試。用法：
//   node qa/smoke/run.js            每個 app 在手機尺寸開一次，抓錯誤與水平溢出，再跑所有 demo/tests.js
//   node qa/smoke/run.js --hubs     另外把兩個大廳（apps/*-hub/dist）裡的每一款逐一開啟
//   node qa/smoke/run.js chess sudoku   只測指定的 app
// 不跑 demo/verify.js：那些會錄影、跑上百萬局模擬，一支要好幾分鐘，只在改到該 app 時個別執行。
// 結果寫到 qa/smoke/report.md，有失敗時結束碼為 1。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..'), APPS = path.join(ROOT, 'apps');
const args = process.argv.slice(2), HUBS = args.includes('--hubs'), only = args.filter(a => !a.startsWith('--'));
const apps = fs.readdirSync(APPS).filter(d => !d.endsWith('-hub') && fs.existsSync(path.join(APPS, d, 'index.html')) && (!only.length || only.includes(d))).sort();
// Hosts the sandbox can't reach (fonts, CDNs) aren't app bugs.
const NETWORK = /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED/;

// Same skeleton the Artifact tool wraps a page in at publish time.
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const wrap = html => /^\s*<!doctype/i.test(html) ? html : SKELETON + html + '</body></html>';

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript' };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const m = u.match(/^\/app\/([a-z0-9-]+)\/$/);
    const file = m ? path.join(APPS, m[1], 'index.html') : path.join(APPS, u.replace(/^\/hub\//, ''));
    if (!file.startsWith(APPS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(file);
    if (m || /\/dist\/index\.html$/.test(file)) body = wrap(body.toString());
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(body);
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}

(async () => {
  const srv = await serve(), base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const rows = [], fails = [];
  const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

  console.log(`頁面：${apps.length} 個 app`);
  for (const a of apps) {
    const ctx = await browser.newContext(ctxOpts), p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !NETWORK.test(m.text())) errs.push('console: ' + m.text()); });
    p.on('requestfailed', () => {});
    let note = '';
    try {
      await p.goto(`${base}/app/${a}/`, { waitUntil: 'load', timeout: 30000 });
      await p.waitForTimeout(1500);
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (ow > 1) note = `水平溢出 ${ow}px`;
    } catch (e) { errs.push('載入逾時或失敗：' + e.message.split('\n')[0]); }
    await ctx.close();
    const ok = !errs.length && !note;
    rows.push(`| ${a} | ${ok ? '通過' : '**失敗**'} | ${[note, ...errs.map(e => e.slice(0, 160).replace(/\|/g, '\\|'))].filter(Boolean).join('<br>')} |`);
    if (!ok) fails.push(a);
    process.stdout.write(ok ? '.' : `\n  ✗ ${a}: ${[note, ...errs].filter(Boolean)[0]}\n`);
  }

  const hubRows = [];
  if (HUBS) for (const [hub, dir] of [['game-hub', 'play'], ['tool-hub', 'open']]) {
    const idx = path.join(APPS, hub, 'dist', 'index.html');
    if (!fs.existsSync(idx)) { hubRows.push(`| ${hub} | **失敗** | 沒有 dist/，先跑 build.py |`); fails.push(hub); continue; }
    const ctx = await browser.newContext(ctxOpts), p = await ctx.newPage();
    await p.goto(`${base}/hub/${hub}/dist/index.html`); await p.waitForTimeout(500);
    const ids = await p.evaluate(() => JSON.parse(document.getElementById('hub-meta').textContent).map(g => g.id));
    const bad = [];
    for (const id of ids) {
      const ok = await p.evaluate(async ([id, dir]) => { const r = await fetch(`${dir}/${id}.html`); return r.ok && (await r.text()).length > 500; }, [id, dir]);
      if (!ok) bad.push(id);
    }
    // Open a few end to end through the real player (the full sweep lives in each app's own row above).
    for (const i of [0, Math.floor(ids.length / 2), ids.length - 1]) {
      await p.evaluate(i => { const c = document.querySelectorAll('.card')[i]; c.scrollIntoView(); c.click(); }, i);
      const ok = await p.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 30000 }).then(() => true, () => false);
      if (!ok) bad.push('player:' + i);
      await p.click('#back');
    }
    await ctx.close();
    hubRows.push(`| ${hub} | ${bad.length ? '**失敗**' : '通過'} | ${ids.length} 款${bad.length ? '，有問題：' + bad.join('、') : '檔案都在，播放器可開啟'} |`);
    if (bad.length) fails.push(hub);
  }
  await browser.close(); srv.close();

  console.log(`\n單元測試：`);
  const testRows = [];
  for (const a of apps) {
    const t = path.join(APPS, a, 'demo', 'tests.js');
    if (!fs.existsSync(t)) continue;
    const r = spawnSync('node', [t], { cwd: path.dirname(t), encoding: 'utf8', timeout: 300000 });
    const out = (r.stdout + r.stderr).trim().split('\n'), last = out[out.length - 1] || '';
    const ok = r.status === 0 && !/^FAIL/m.test(r.stdout);
    testRows.push(`| ${a} | ${ok ? '通過' : '**失敗**'} | ${last.slice(0, 160).replace(/\|/g, '\\|')} |`);
    if (!ok) fails.push(a + '（單元測試）');
    // on failure also show which checks failed, so a CI-only failure can be diagnosed from the log
    const why = ok ? [] : out.filter(l => l !== last && /FAIL|✗|失敗|not ok|Error|timeout/i.test(l)).slice(0, 8);
    process.stdout.write(ok ? '.' : `\n  ✗ ${a}: ${last}\n${why.map(l => '      ' + l.trim().slice(0, 200) + '\n').join('')}`);
  }

  const date = new Date().toISOString().slice(0, 10);
  const md = [`# 回歸測試報告（${date}）`, '', `結果：${fails.length ? `**${fails.length} 項失敗**：${fails.join('、')}` : '全部通過'}`, '',
    '測法：Chromium 手機尺寸 390×844 開啟每個 app 1.5 秒，記錄執行錯誤與水平溢出（沙箱連不到的字型與 CDN 不算）；再跑每個 `demo/tests.js`。', '',
    `## 頁面（${apps.length} 個）`, '', '| App | 結果 | 說明 |', '|---|---|---|', ...rows, '',
    ...(HUBS ? ['## 大廳', '', '| 大廳 | 結果 | 說明 |', '|---|---|---|', ...hubRows, ''] : []),
    `## 單元測試（${testRows.length} 個）`, '', '| App | 結果 | 最後一行輸出 |', '|---|---|---|', ...testRows, ''].join('\n');
  if (!only.length) fs.writeFileSync(path.join(__dirname, 'report.md'), md);
  console.log(`\n${fails.length ? '失敗：' + fails.join('、') : '全部通過'}`);
  process.exit(fails.length ? 1 : 0);
})();
