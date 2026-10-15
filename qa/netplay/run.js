// 連線對戰測試：同一個瀏覽器開三頁（房主、加入者、觀戰者），用 mock-claude.js 模擬 room 能力。
//   node qa/netplay/run.js gomoku othello ...   測指定的遊戲（預設：全部有 NET 的遊戲）
//   --hub                                       改從口袋遊樂場（apps/game-hub/dist）開啟，驗證 iframe 橋接
// 每款驗證：大廳看得到房間、整局下完三頁盤面一致、加入者重新整理後回到房間並追上、斷線期間的棋步在重連後補上、再來一局換邊、認輸。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '../..'), APPS = path.join(ROOT, 'apps');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
const args = process.argv.slice(2), HUB = args.includes('--hub'), only = args.filter(a => !a.startsWith('--'));
const games = (only.length ? only : fs.readdirSync(APPS).filter(d => fs.existsSync(path.join(APPS, d, 'index.html')) && /NETPLAY-START/.test(fs.readFileSync(path.join(APPS, d, 'index.html'), 'utf8')))).sort();
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>';
const wrap = html => /^\s*<!doctype/i.test(html) ? html : SKELETON + html + '</body></html>';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  return new Promise(r => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]), file = path.join(APPS, u);
      if (!file.startsWith(APPS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      let body = fs.readFileSync(file);
      if (/\/index\.html$/.test(file)) body = wrap(body.toString());
      res.writeHead(200, { 'content-type': /\.html$/.test(file) ? 'text/html; charset=utf-8' : /\.jpg$/.test(file) ? 'image/jpeg' : 'application/octet-stream' }); res.end(body);
    });
    srv.listen(0, () => r(srv));
  });
}

async function openAs(ctx, base, game, who, errs) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('pageerror', e => errs.push(who + ': ' + e.message));
  // top frame only: inside the hub the game must reach it through the hub's bridge, as on claude.ai
  await page.addInitScript(`if (window === window.top) { window.__mockUser=${JSON.stringify(who)};` + MOCK + '}');
  if (!HUB) { await page.goto(`${base}/${game}/index.html`); return { page, f: page }; }
  await page.goto(`${base}/game-hub/dist/index.html`);
  return { page, f: await hubOpen(page, game) };
}
// open a game through the hub's own UI (tap its card) and return the game's iframe
async function hubOpen(page, game) {
  await page.evaluate(id => {
    const i = JSON.parse(document.getElementById('hub-meta').textContent).findIndex(g => g.id === id);
    const c = document.querySelectorAll('.card')[i]; c.scrollIntoView(); c.click();
  }, game);
  for (let i = 0; i < 100; i++) {
    const f = page.frames().find(fr => fr !== page.mainFrame());
    if (f && await f.evaluate(() => typeof NET !== 'undefined').catch(() => false)) return f;
    await sleep(100);
  }
  throw new Error('大廳裡打不開 ' + game);
}
const ev = (p, fn, a) => p.f.evaluate(fn, a);
async function until(desc, fn, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return; await sleep(60); }
  throw new Error('等太久：' + desc);
}
const st = p => ev(p, () => NET.state());

async function playOut(ps, maxPlies, label) {
  // whoever may move plays a random legal move; the others must catch up before the next one
  for (let k = 0; k < maxPlies; k++) {
    if (await ev(ps[0], () => NET._over()) && await ev(ps[1], () => NET._over())) return k;
    let moved = false;
    for (const p of ps.slice(0, 2)) if (await ev(p, () => NET.canMove())) { await ev(p, () => NET._random()); moved = true; break; }
    if (!moved) await sleep(80);
    const n = (await st(moved ? ps[0] : ps[0])).mv.length;
    await until(label + ' 三頁棋步一致', async () => {
      const s = await Promise.all(ps.map(st));
      const L = Math.max(...s.map(x => x.mv.length));
      return s.every(x => x.mv.length === L);
    });
  }
  return maxPlies;
}
async function sameBoard(ps, label) {
  await until(label + ' 盤面一致', async () => { const s = await Promise.all(ps.map(p => ev(p, () => NET._snap()))); return s.every(x => x === s[0]); });
}

async function testGame(browser, base, game) {
  const errs = [], ctx = await browser.newContext();
  const A = await openAs(ctx, base, game, 'alice', errs), B = await openAs(ctx, base, game, 'bob', errs);
  for (const p of [A, B]) await until(game + ' NET 可用', () => ev(p, () => typeof NET !== 'undefined' && NET.available()));
  const code = 'tq' + Math.random().toString(36).slice(2, 4).replace(/[^a-z0-9]/g, 'x');
  await ev(A, c => NET._join(c, 'h', NET._defaults(), 0), code);
  await until('大廳列出房間', () => ev(B, c => NET._rooms().includes(c), code));
  await ev(B, c => NET._join(c, 'j'), code);
  await until('雙方入座', async () => (await st(A)).opp && (await st(B)).opp);
  const sa = await st(A), sb = await st(B);
  if (sa.side !== 0 || sb.side !== 1) throw new Error('座位錯誤 ' + sa.side + '/' + sb.side);
  const C = await openAs(ctx, base, game, 'carol', errs);
  await until('觀戰者可用', () => ev(C, () => typeof NET !== 'undefined' && NET.available()));
  await ev(C, c => NET._join(c, 'j'), code);
  await until('觀戰者降為觀戰', async () => (await st(C)).seat === 's');
  const ps = [A, B, C];

  await playOut(ps, 6, '開局');
  // B reloads mid-game and resumes from its saved room
  await B.page.reload(); if (HUB) B.f = await hubOpen(B.page, game);
  await until('重整後 NET 可用', () => ev(B, () => typeof NET !== 'undefined' && NET.available()));
  await ev(B, () => NET._resume());
  try { await until('重整後追上', async () => { const a = await st(A), b = await st(B); return b && b.opp && b.mv.length === a.mv.length; }); }
  catch (e) { console.log(JSON.stringify(await st(A)), JSON.stringify(await st(B)), JSON.stringify(await ev(B, () => NET.mySide()))); throw e; }
  await sameBoard(ps, '重整後');
  // A drops; B moves while A is away; A must pick the move up on reconnect
  if (!(await ev(A, () => NET._over()))) {
    if (await ev(A, () => NET.canMove())) { await ev(A, () => NET._random()); await until('A 的一手送達', async () => (await st(B)).mv.length === (await st(A)).mv.length); }
    await A.page.evaluate(() => __mockNet.drop(true));
    const before = (await st(A)).mv.length;
    if (await ev(B, () => NET.canMove())) await ev(B, () => NET._random());
    await sleep(300);
    if ((await st(A)).mv.length !== before) throw new Error('斷線時不該收到棋步');
    await A.page.evaluate(() => __mockNet.drop(false));
    await until('重連後補上', async () => (await st(A)).mv.length === (await st(B)).mv.length);
  }
  const plies = await playOut(ps, 600, '整局');
  await sameBoard(ps, '終局');
  if (!(await ev(A, () => NET._over()))) throw new Error('600 手內沒下完');
  // rematch swaps sides
  await ev(A, () => NET.rematch()); await sleep(200);
  if ((await st(A)).g !== 0) throw new Error('只有一方同意不該開新局');
  await ev(B, () => NET.rematch());
  await until('再來一局', async () => (await st(A)).g === 1 && (await st(B)).g === 1 && (await st(C)).g === 1);
  const a2 = await st(A), b2 = await st(B);
  if (a2.side !== 1 || b2.side !== 0 || a2.mv.length || b2.mv.length) throw new Error('再來一局沒換邊或沒清空');
  await playOut(ps, 3, '第二局');
  // resign
  const res = await ev(A, () => NET.canMove()) ? A : B;
  await ev(res, () => NET.resign());
  await until('認輸傳到對方', async () => ev(res === A ? B : A, () => NET._over()));
  if (HUB) { // closing the game in the hub leaves the room: the other side sees the opponent go offline
    await A.page.click('#back');
    await until('關掉遊戲後對手離線', async () => !(await st(B)).opp);
    A.f = await hubOpen(A.page, game);
    await until('回到大廳後 NET 可用', () => ev(A, () => NET.available()));
    await ev(A, () => NET._resume());
    await until('回到房間', async () => (await st(B)).opp && (await st(A)).opp);
  }
  await ev(A, () => NET.leave()); await ev(B, () => NET.leave());
  await sleep(200);
  if (await ev(B, c => NET._rooms().includes(c), code)) throw new Error('離開後大廳仍列出房間');
  await ctx.close();
  return { plies, errs };
}

(async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  let fail = 0;
  for (const g of games) {
    try {
      const r = await testGame(browser, base, g);
      if (r.errs.length) { fail++; console.log(`✗ ${g}: 頁面錯誤\n  ` + r.errs.slice(0, 5).join('\n  ')); }
      else console.log(`✓ ${g}${HUB ? '（大廳）' : ''}：整局 ${r.plies} 手、重整、斷線、再來一局、認輸都通過`);
    } catch (e) { fail++; console.log(`✗ ${g}: ${e.message.split('\n')[0]}`); }
  }
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
