// Verification for 自訂拼圖 (photo-jigsaw).
// Plays a real 12-piece puzzle with touch drags from the tray (CDP touch events), checks snapping, groups, rotation mode,
// save/continue, photo upload, scatter/zoom/ghost/edge buttons, at 390x844 and the three in-lobby iframe sizes, light and dark.
// Writes cover-390x520.png (a 48-piece puzzle half done) and a few screenshots.
// Usage: node verify.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function check(c, msg) { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); }

async function touchDrag(cdp, pts, stepMs = 16) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  for (let i = 1; i < pts.length; i++) { await sleep(stepMs); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i][0], y: pts[i][1] }] }); }
  await sleep(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); await sleep(150); }
function line(a, b, n) { const out = []; for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return out; }

// Drag piece `id` out of the tray and drop its centre at target(tid) + (dx,dy) (page coordinates, read after the pull-out
// because the camera may nudge while the piece leaves the tray). Returns the destination, or null if the piece was not in the tray.
async function dragFromTray(page, cdp, id, tid, dx, dy) {
  const el = page.locator('.tp[data-id="' + id + '"]');
  if (!(await el.count())) return null;
  await el.scrollIntoViewIfNeeded(); await sleep(80);
  const b = await el.boundingBox(); const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  for (const p of line([sx, sy], [sx, sy - 60], 5)) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); }
  await sleep(30);
  const ps = await page.evaluate(id => window.__game.pieceScreen(id), id);
  if (!ps) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); return null; }
  const t = await page.evaluate(id => window.__game.target(id), tid), tx = t.x + dx, ty = t.y + dy;
  const fx = sx + (tx - ps.x), fy = (sy - 60) + (ty - ps.y);
  for (const p of line([sx, sy - 60], [fx, fy], 12)) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); }
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
  return { x: tx, y: ty };
}

async function newPage(browser, w, h, dark) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(APP); await sleep(500);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors };
}

async function fullPlay(browser) {
  console.log('--- full play at 390x844 (light) ---');
  const { ctx, page, cdp, errors } = await newPage(browser, 390, 844, false);
  await page.screenshot({ path: path.join(OUT, 'title-390x844.png') });
  check(await page.isVisible('#title') && (await page.locator('.gt').count()) === 6, 'title screen shows 5 built-in pictures + photo tile');
  await tapSel(cdp, page, '.chip[data-n="12"]');
  await tapSel(cdp, page, '.gt[data-id="bay"]');
  await tapSel(cdp, page, '#bStart'); await sleep(500);
  let st = await page.evaluate(() => window.__game.state());
  check(st && st.count === 12 && st.tray === 12 && !st.rotMode, '12-piece puzzle starts with all pieces in the tray');
  // drop piece 0 roughly next to the board but not on it: should stay loose
  const far = await dragFromTray(page, cdp, 0, 0, -40, 20);
  check(far, 'piece 0 pulled out of the tray');
  let ps = await page.evaluate(() => window.__game.pieceScreen(0));
  check(ps && !ps.locked && Math.abs(ps.x - far.x) < 6 && Math.abs(ps.y - far.y) < 6, 'piece dropped away from its slot stays loose where dropped');
  // piece 1 dropped near piece 0 at the right relative offset: joins into a group of 2
  await dragFromTray(page, cdp, 1, 1, -35, 24);
  ps = await page.evaluate(() => window.__game.pieceScreen(1));
  check(ps && ps.n === 2 && !ps.locked, 'neighbour dropped close by snaps into a 2-piece group');
  // drag the group (by piece 0) onto the board: both lock
  ps = await page.evaluate(() => window.__game.pieceScreen(0));
  const t0 = await page.evaluate(() => window.__game.target(0));
  await touchDrag(cdp, line([ps.x, ps.y], [t0.x + 6, t0.y - 5], 14));
  await sleep(150);
  st = await page.evaluate(() => window.__game.state());
  check(st.locked === 2, 'group dragged onto the board locks both pieces (' + st.locked + ')');
  // wrong spot on the board: should not lock
  await dragFromTray(page, cdp, 5, 6, 0, 0);
  ps = await page.evaluate(() => window.__game.pieceScreen(5));
  check(ps && !ps.locked, 'piece dropped on the wrong cell does not lock');
  const t5 = await page.evaluate(() => window.__game.target(5));
  await touchDrag(cdp, line([ps.x, ps.y], [t5.x + 3, t5.y + 3], 10)); await sleep(120);
  ps = await page.evaluate(() => window.__game.pieceScreen(5));
  check(ps && ps.locked, 'moved to its own cell it locks');
  // toggle ghost + edge filter
  await tapSel(cdp, page, '#bGhost'); check((await page.getAttribute('#bGhost', 'aria-pressed')) === 'true', 'ghost preview toggles on');
  await tapSel(cdp, page, '#bEdge'); check((await page.getAttribute('#bEdge', 'aria-pressed')) === 'true' && (await page.evaluate(() => [...document.querySelectorAll('.tp')].filter(e => getComputedStyle(e).display !== 'none').every(e => e.classList.contains('edge')))), 'edge filter hides inner pieces in the tray');
  await tapSel(cdp, page, '#bEdge');
  // zoom in/out
  const s0 = (await page.evaluate(() => window.__game.state())).cam.s;
  await tapSel(cdp, page, '#bZoomIn'); const s1 = (await page.evaluate(() => window.__game.state())).cam.s;
  await tapSel(cdp, page, '#bZoomOut'); const s2 = (await page.evaluate(() => window.__game.state())).cam.s;
  check(s1 > s0 * 1.2 && Math.abs(s2 - s0) < 1e-6, 'zoom buttons zoom in and back out');
  await page.screenshot({ path: path.join(OUT, 'play-390x844.png') });
  // save + continue: reload the page mid-game
  await page.evaluate(() => window.__game.save());
  const before = await page.evaluate(() => window.__game.state());
  await page.reload(); await sleep(600);
  check(await page.isVisible('#contSec'), 'after reload the title offers 繼續上次');
  const cdp2 = await ctx.newCDPSession(page);
  await tapSel(cdp2, page, '#bContinue'); await sleep(400);
  const after = await page.evaluate(() => window.__game.state());
  check(after && after.count === 12 && after.locked === before.locked && after.groups === before.groups && after.elapsed >= before.elapsed - 50, 'continue restores locked count, groups and timer');
  // finish the puzzle: drag every remaining piece to its slot
  for (let id = 0; id < 12; id++) {
    const s = await page.evaluate(() => window.__game.state()); if (s.won) break;
    const inTray = await dragFromTray(page, cdp2, id, id, 4, -3);
    if (!inTray) { const t = await page.evaluate(id => window.__game.target(id), id); const p = await page.evaluate(id => window.__game.pieceScreen(id), id); if (p && !p.locked) { await touchDrag(cdp2, line([p.x, p.y], [t.x + 3, t.y + 2], 10)); await sleep(120); } }
  }
  await sleep(1800);
  st = await page.evaluate(() => window.__game.state());
  check(st.won && st.locked === 12 && await page.isVisible('#win'), 'all 12 pieces placed: puzzle completes and the win card shows');
  check(await page.evaluate(() => !localStorage.getItem('photo-jigsaw:v1:save') && !!localStorage.getItem('photo-jigsaw:v1:best')), 'finished puzzle clears the save and records a best time');
  await page.screenshot({ path: path.join(OUT, 'win-390x844.png') });
  // play again from the win card
  await tapSel(cdp2, page, '#wAgain'); await sleep(300);
  st = await page.evaluate(() => window.__game.state());
  check(st && !st.won && st.tray === 12, '再拼一次 reshuffles the same picture');
  // rotation mode via the API
  await page.evaluate(() => window.__game.start('mosaic', 12, true)); await sleep(300);
  st = await page.evaluate(() => window.__game.state()); check(st.rotMode, 'rotation mode puzzle started');
  const ids = await page.evaluate(() => window.__game.trayIds());
  const rid = ids[0], other = (rid + 2) % 12;   // drop on a wrong cell so it stays loose and on screen
  await dragFromTray(page, cdp2, rid, other, 0, 0);
  let rp = await page.evaluate(id => window.__game.pieceScreen(id), rid);
  const rot0 = rp.rot; await tap(cdp2, rp.x, rp.y); await sleep(150);
  rp = await page.evaluate(id => window.__game.pieceScreen(id), rid);
  check(rp.rot === (rot0 + 1) % 4, 'tapping a piece in rotation mode turns it 90°');
  while (rp.rot !== 0) { await tap(cdp2, rp.x, rp.y); await sleep(150); rp = await page.evaluate(id => window.__game.pieceScreen(id), rid); }
  const tr = await page.evaluate(id => window.__game.target(id), rid);
  await touchDrag(cdp2, line([rp.x, rp.y], [tr.x + 3, tr.y + 2], 10)); await sleep(150);
  rp = await page.evaluate(id => window.__game.pieceScreen(id), rid);
  check(rp.locked, 'rotated back to upright it locks into the board');
  // scatter
  await tapSel(cdp2, page, '#bScatter'); st = await page.evaluate(() => window.__game.state());
  check(st.tray === 0 || st.tray < 11, 'scatter button moves tray pieces onto the table (tray now ' + st.tray + ')');
  // pause / menu
  await tapSel(cdp2, page, '#bMenu'); check(await page.isVisible('#pause'), 'menu opens the pause card');
  await tapSel(cdp2, page, '#pQuit'); check(await page.isVisible('#title'), '回到首頁 returns to the title');
  // photo upload: make an image file with the page itself, then pick it
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 1400; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 900, 1400); gr.addColorStop(0, '#f94144'); gr.addColorStop(0.5, '#f9c74f'); gr.addColorStop(1, '#577590'); g.fillStyle = gr; g.fillRect(0, 0, 900, 1400); for (let i = 0; i < 300; i++) { g.fillStyle = `hsl(${i * 7 % 360} 80% ${30 + i % 50}%)`; g.beginPath(); g.arc(Math.random() * 900, Math.random() * 1400, 10 + Math.random() * 60, 0, 7); g.fill(); } return c.toDataURL('image/png'); });
  const photo = path.join(OUT, 'sample-photo.png'); fs.writeFileSync(photo, Buffer.from(png.split(',')[1], 'base64'));
  await page.setInputFiles('#fileInput', photo); await sleep(800);
  check((await page.getAttribute('#gtPhoto', 'aria-pressed')) === 'true' && (await page.textContent('#gtPhoto')).includes('我的照片'), 'photo picked: tile shows 我的照片 and is selected');
  await tapSel(cdp2, page, '.chip[data-n="20"]'); await tapSel(cdp2, page, '#bStart'); await sleep(500);
  st = await page.evaluate(() => window.__game.state());
  check(st && st.rows > st.cols && st.count >= 16 && st.count <= 24, 'portrait photo puzzle uses more rows than columns (' + st.cols + 'x' + st.rows + ')');
  await page.evaluate(() => window.__game.save());
  await page.reload(); await sleep(900);
  check(await page.isVisible('#contSec') && (await page.textContent('#contName')).includes('我的照片'), 'photo puzzle restores after reload (photo kept in IndexedDB)');
  await page.screenshot({ path: path.join(OUT, 'photo-390x844.png') });
  check(errors.length === 0, 'no page errors during full play' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

async function sizes(browser) {
  for (const [w, h] of [[375, 500], [390, 610], [430, 740]]) for (const dark of [false, true]) {
    const { ctx, page, cdp, errors } = await newPage(browser, w, h, dark);
    const tag = `${w}x${h}-${dark ? 'dark' : 'light'}`;
    await page.screenshot({ path: path.join(OUT, `title-${tag}.png`) });
    await tapSel(cdp, page, '.chip[data-n="30"]'); await tapSel(cdp, page, '.gt[data-id="balloons"]');
    await tapSel(cdp, page, '#bStart'); await sleep(400);
    const st = await page.evaluate(() => window.__game.state());
    const ids = await page.evaluate(() => window.__game.trayIds());
    await dragFromTray(page, cdp, ids[0], ids[0], 3, -2);
    const ps = await page.evaluate(id => window.__game.pieceScreen(id), ids[0]);
    check(st && st.count >= 26 && ps && ps.locked, `${tag}: puzzle starts (${st.count} pieces) and a tray drag locks a piece`);
    const vis = await page.evaluate(() => ['bMenu', 'bGhost', 'bEdge', 'bZoomIn', 'bZoomOut', 'bScatter', 'trayScroll'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 20 && r.height > 20 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }));
    check(vis, `${tag}: all controls on screen`);
    await page.evaluate(ids => ids.slice(1, 8).forEach(id => window.__game.place(id)), ids); await sleep(100);
    await page.screenshot({ path: path.join(OUT, `play-${tag}.png`) });
    check(errors.length === 0, `${tag}: no page errors` + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }
}

async function cover(browser) {
  const { ctx, page, cdp, errors } = await newPage(browser, 390, 520, false);
  await page.evaluate(() => window.__game.start('balloons', 48, false)); await sleep(300);
  const st = await page.evaluate(() => window.__game.state());
  const cols = st.cols, rows = st.rows, place = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1 || (r <= 2 && c <= 3) || (r === 1 && c <= 5)) place.push(r * cols + c); }
  await page.evaluate(ids => ids.forEach(id => window.__game.place(id)), place);
  // one loose piece on the table, dragged mid-way
  const ids = await page.evaluate(() => window.__game.trayIds());
  await dragFromTray(page, cdp, ids[0], ids[0], 70, 24);
  await tapSel(cdp, page, '#bGhost');
  await page.evaluate(() => { document.getElementById('hTime').textContent = '03:42'; });
  await sleep(200);
  await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
  check(fs.existsSync(path.join(OUT, 'cover-390x520.png')) && errors.length === 0, 'cover written, no errors');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try { await fullPlay(browser); await sizes(browser); await cover(browser); }
  catch (e) { fails++; console.log('FAIL exception', e); }
  await browser.close();
  console.log(fails ? `VERIFY FAILED (${fails})` : 'VERIFY OK');
  process.exit(fails ? 1 : 0);
})();
