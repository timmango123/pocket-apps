// 網站版（GitHub Pages）測試：分享網址、上一頁、分享按鈕、加入主畫面的設定、離線開啟。
//   python3 scripts/build_site.py _site && node qa/pages/run.js [_site]
// 網站放在 /pocket-apps/ 底下，跟 GitHub Pages 的網址結構一樣。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SITE = path.resolve(process.argv[2] || path.join(__dirname, '../../_site'));
const PREFIX = '/pocket-apps';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };

function serve() {
  return new Promise(r => {
    const srv = http.createServer((req, res) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if (!u.startsWith(PREFIX + '/')) { res.writeHead(404); return res.end(); }
      let file = path.join(SITE, u.slice(PREFIX.length));
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => r(srv));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function check(ok, label) { console.log((ok ? '✓ ' : '✗ ') + label); if (!ok) fails++; }
const playerReady = p => p.waitForFunction(() => !document.getElementById('player').hidden && document.getElementById('loading').hidden && document.querySelector('#stage iframe'), null, { timeout: 30000 }).then(() => true, () => false);
const onShelf = p => p.waitForFunction(() => document.getElementById('player').hidden && !document.getElementById('hub').hidden, null, { timeout: 5000 }).then(() => true, () => false);

(async () => {
  if (!fs.existsSync(path.join(SITE, 'games/index.html'))) { console.log('找不到 ' + SITE + '，先跑 python3 scripts/build_site.py'); process.exit(1); }
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}${PREFIX}`;
  const browser = await chromium.launch();
  const errs = [];

  // 1. links and the back button
  for (const [hub, first] of [['games', 'gomoku'], ['tools', null]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(hub + ': ' + e.message));
    await p.addInitScript(() => { delete Navigator.prototype.share; });
    await p.goto(`${base}/${hub}/`);
    const ids = await p.evaluate(() => JSON.parse(document.getElementById('hub-meta').textContent).map(g => g.id));
    const id = first || ids[0], other = ids[1];
    await p.goto(`${base}/${hub}/#${id}`);
    check(await playerReady(p), `${hub}：網址 #${id} 直接打開`);
    check((await p.title()).includes(await p.textContent('#ptitle')), `${hub}：分頁標題換成這款的名字`);
    check(await p.isVisible('#share'), `${hub}：有分享按鈕`);
    for (const w of [390, 360]) {
      await p.setViewportSize({ width: w, height: 800 });
      check(await p.evaluate(() => { const b = document.querySelector('.bar'); return b.scrollWidth <= b.clientWidth + 1; }), `${hub}：上方按鈕列在 ${w}px 寬不超出`);
    }
    await p.click('#share');
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check(clip === `${base}/${hub}/#${id}`, `${hub}：沒有系統分享時複製連結（${clip}）`);
    check(await p.isVisible('#toast'), `${hub}：顯示「已複製連結」`);
    await p.click('#back');
    check(await onShelf(p) && await p.evaluate(() => location.hash === ''), `${hub}：按大廳回到架上，網址清掉 #`);
    await p.evaluate(id => { const i = JSON.parse(document.getElementById('hub-meta').textContent).findIndex(g => g.id === id); const c = document.querySelectorAll('.card')[i]; c.scrollIntoView(); c.click(); }, other);
    check(await playerReady(p) && await p.evaluate(id => location.hash === '#' + id, other), `${hub}：從架上開啟時網址變成 #${other}`);
    await p.goBack();
    check(await onShelf(p), `${hub}：手機的上一頁回到架上`);
    await p.goForward();
    check(await playerReady(p) && await p.evaluate(id => document.querySelector('#stage iframe').title && location.hash === '#' + id, other), `${hub}：下一頁再打開同一款`);
    await p.click('#back'); await onShelf(p);
    await p.evaluate(() => { document.querySelectorAll('.card')[0].click(); });
    await sleep(300);
    check(!(await p.isHidden('#player')), `${hub}：關掉後馬上開下一款不會被上一頁事件關掉`);
    await p.goto(`${base}/${hub}/#no-such-app`);
    check(await onShelf(p), `${hub}：不存在的 # 停在架上`);
    await ctx.close();
  }

  // 2. install metadata
  {
    const ctx = await browser.newContext(), p = await ctx.newPage();
    for (const sub of ['', 'games/', 'tools/']) {
      await p.goto(`${base}/${sub}`);
      const href = await p.evaluate(() => document.querySelector('link[rel=manifest]')?.href);
      const m = href && await p.evaluate(h => fetch(h).then(r => r.json()), href).catch(() => null);
      check(m && m.name && m.display === 'standalone' && m.start_url && m.icons.length >= 2, `${sub || '首頁'}：manifest 完整（${m && m.name}）`);
      for (const ic of (m && m.icons) || []) {
        const size = await p.evaluate(async src => { const b = await (await fetch(src)).blob(); const im = await createImageBitmap(b); return im.width + 'x' + im.height; }, new URL(ic.src, href).href).catch(() => '');
        check(size === ic.sizes, `${sub || '首頁'}：圖示 ${ic.sizes} 存在`);
      }
    }
    await ctx.close();
  }

  // 3. offline: a game opened once still opens with no connection
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
    p.on('pageerror', e => errs.push('offline: ' + e.message));
    await p.goto(`${base}/games/`);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload(); // now controlled by the service worker
    check(await p.evaluate(() => !!navigator.serviceWorker.controller), '離線：service worker 接管頁面');
    await p.goto(`${base}/games/#othello`);
    await playerReady(p);
    await sleep(500);
    // stop the server itself: Playwright's offline switch doesn't reach the service worker's own requests
    srv.close(); srv.closeAllConnections();
    await p.goto(`${base}/games/#othello`);
    check(await playerReady(p), '離線：玩過的遊戲照樣打開');
    await p.goto(`${base}/games/#chess`);
    check(await p.waitForFunction(() => /載入失敗/.test(document.getElementById('lmsg').textContent), null, { timeout: 15000 }).then(() => true, () => false), '離線：沒玩過的遊戲顯示載入失敗，不會卡住');
    await ctx.close();
  }

  check(!errs.length, '沒有頁面錯誤' + (errs.length ? '：' + errs.slice(0, 3).join('；') : ''));
  await browser.close();
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})();
