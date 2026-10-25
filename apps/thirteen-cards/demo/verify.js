// Verification for 十三支 (thirteen-cards) in Chromium with Playwright and real CDP touch input.
// (1) Opens the page at 390×844 and the three in-lobby iframe sizes (375×500, 390×610, 430×740) plus 360×640, 430×932
//     and 844×390 landscape, light and dark: no page errors, no horizontal overflow, 44 px tap targets, the table fits.
// (2) Plays rounds with touch taps: start, coach, tap-swap, drag-swap, undo, suggestion, foul warning dialog, compare,
//     result sheet, next round; checks scores are zero-sum and match the rules core, refresh keeps the arrangement,
//     the result and the stats; a special hand (報到) round; a rapid-tap test (8 taps/s alternating rows).
// (3) Writes demo/cover-390x520.png (the table after a round with 打槍 holes) and screenshots of each size.
// Usage: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const TC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return TC;')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const assert = (c, m) => { if (c) { passed++; console.log('ok -', m); } else { failed++; console.log('FAIL -', m); } };
function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
async function touch(cdp, x, y, hold = 50) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(hold); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); if (!b) throw new Error('no box for ' + sel); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function tapCard(cdp, page, id) { const r = await page.evaluate(id => window.__tc.cardRect(id), id); await touch(cdp, r.x + r.w / 2, r.y + r.h / 2); }
async function dragCard(cdp, page, a, b) {
  const A = await page.evaluate(id => window.__tc.cardRect(id), a), B = await page.evaluate(id => window.__tc.cardRect(id), b);
  const x0 = A.x + A.w / 2, y0 = A.y + A.h / 2, x1 = B.x + B.w / 2, y1 = B.y + B.h / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 10, y: y0 + (y1 - y0) * i / 10 }] }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const info = page => page.evaluate(() => window.__tc.info());
async function open(browser, url, vp, scheme) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const ext = [];
  page.on('request', r => { if (!/^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(r.url())) ext.push(r.url()); });
  await page.goto(url); await sleep(600);
  return { ctx, page, errors, ext, cdp: await ctx.newCDPSession(page) };
}
async function waitFor(page, fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await sleep(100); } return false; }
const rowsOf = i => i.my.map(r => r.slice().sort((a, b) => a - b).join()).join('|');

(async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  // ---------- (1) sizes ----------
  const sizes = [[390, 844], [375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390]];
  for (const [w, h] of sizes) for (const scheme of ['light', 'dark']) {
    const s = await open(browser, base + '?seed=7', { width: w, height: h }, scheme);
    const p = s.page;
    const t = await p.evaluate(() => ({ ov: document.documentElement.scrollWidth - innerWidth, title: !document.getElementById('title').classList.contains('hidden') }));
    assert(t.title && t.ov <= 0, `${w}x${h} ${scheme}: title shown, no horizontal overflow`);
    await tapSel(s.cdp, p, '#tGo'); await sleep(1400);
    await p.evaluate(() => document.getElementById('coach').classList.add('hidden'));
    const m = await p.evaluate(() => {
      const out = { small: [], outside: [], overlap: 0 };
      const btns = [...document.querySelectorAll('#top button, #act button:not(.hidden)')];
      btns.forEach(b => { const r = b.getBoundingClientRect(); if (r.width < 44 || r.height < 44) out.small.push(b.id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); if (r.left < 0 || r.right > innerWidth + 0.5 || r.top < 0 || r.bottom > innerHeight + 0.5) out.outside.push(b.id); });
      const cards = [...document.querySelectorAll('#board .cd')].map(c => c.getBoundingClientRect());
      cards.forEach(r => { if (r.left < 0 || r.right > innerWidth + 0.5 || r.top < 0 || r.bottom > innerHeight + 0.5) out.outside.push('card'); });
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) { const a = cards[i], b = cards[j]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.overlap++; }
      const act = document.getElementById('act').getBoundingClientRect(), board = [...document.querySelectorAll('#board .well')].map(x => x.getBoundingClientRect());
      out.wellsAboveAct = board.every(r => r.bottom <= act.top + 1);
      out.cw = cards[0].width;
      out.minis = [...document.querySelectorAll('.mini')].every(x => { const r = x.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight; });
      return out;
    });
    assert(!m.small.length, `${w}x${h} ${scheme}: buttons at least 44 px ${m.small.join(' ')}`);
    assert(!m.outside.length && m.overlap === 0 && m.wellsAboveAct && m.minis, `${w}x${h} ${scheme}: 13 cards on screen, no overlap, rows above the buttons (card ${Math.round(m.cw)} px wide)`);
    if (scheme === 'light' || w === 390) await p.screenshot({ path: path.join(OUT, `shot-${w}x${h}-${scheme}.png`) });
    assert(!s.errors.length, `${w}x${h} ${scheme}: no page errors ${s.errors.join(' | ')}`);
    assert(!s.ext.length, `${w}x${h} ${scheme}: no external requests`);
    await s.ctx.close();
  }

  // ---------- (2) play with touch ----------
  const s = await open(browser, base + '?seed=7', { width: 390, height: 844 }, 'light');
  const { page, cdp } = s;
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(base + '?seed=7'); await sleep(600);
  await tapSel(cdp, page, '#tGo'); await sleep(1500);
  assert(await page.evaluate(() => !document.getElementById('coach').classList.contains('hidden')), 'first round shows the coach tip');
  await tapSel(cdp, page, '#coOk'); await sleep(200);
  let i0 = await info(page);
  assert(i0.phase === 'arrange' && !i0.foul && i0.my[0].length === 3, 'dealt: arrangement starts valid (beginner order)');
  // tap swap across rows
  const a = i0.my[0][0], b = i0.my[2][0];
  await tapCard(cdp, page, a); await sleep(150);
  assert((await info(page)).sel === a, 'tap selects a card');
  await tapCard(cdp, page, b); await sleep(400);
  let i1 = await info(page);
  assert(i1.my[0].includes(b) && i1.my[2].includes(a) && i1.sel === null, 'tap on a card in another row swaps the two');
  await tapSel(cdp, page, '#bUndo'); await sleep(350);
  assert(rowsOf(await info(page)) === rowsOf(i0), 'undo restores the previous arrangement');
  // drag swap
  await dragCard(cdp, page, i0.my[1][0], i0.my[2][1]); await sleep(400);
  let i2 = await info(page);
  assert(i2.my[2].includes(i0.my[1][0]) && i2.my[1].includes(i0.my[2][1]), 'dragging a card onto another row swaps');
  // same-row tap moves selection, second tap deselects
  await tapCard(cdp, page, i2.my[1][0]); await tapCard(cdp, page, i2.my[1][1]); await sleep(120);
  assert((await info(page)).sel === i2.my[1][1], 'tapping in the same row moves the selection');
  await tapCard(cdp, page, i2.my[1][1]); await sleep(120);
  assert((await info(page)).sel === null, 'tapping the selected card again deselects it');
  // make a foul: move the strongest back cards to the front
  let cur = await info(page);
  const backVals = cur.my[2].slice(0, 3);
  for (let k = 0; k < 3; k++) { cur = await info(page); await tapCard(cdp, page, cur.my[0][k]); await sleep(80); await tapCard(cdp, page, backVals[k]); await sleep(380); }
  cur = await info(page);
  const foulExpected = TC.isFoul(TC.rowVals(cur.my));
  assert(cur.foul === foulExpected, 'foul flag matches the rules core');
  if (cur.foul) {
    const lab = await page.evaluate(() => [...document.querySelectorAll('.rw')].length + ' ' + document.getElementById('goS').textContent);
    assert(/倒水/.test(lab) && +lab.split(' ')[0] >= 2, 'foul rows are marked 倒水 and the compare button warns');
    await tapSel(cdp, page, '#bGo'); await sleep(300);
    assert((await info(page)).overlay === 'confirm', 'comparing a fouled hand asks first');
    await tapSel(cdp, page, '#cfNo'); await sleep(300);
    assert((await info(page)).phase === 'arrange', '再調整 keeps arranging');
  }
  // suggestion cycles
  await tapSel(cdp, page, '#bSug'); await sleep(450);
  const s1 = await info(page);
  const sugs = TC.suggestions(s1.hand, 4);
  assert(s1.sugI === 0 && rowsOf(s1) === sugs[0].arr.map(r => r.slice().sort((x, y) => x - y).join()).join('|') && !s1.foul, 'suggestion 1 applied and legal');
  await tapSel(cdp, page, '#bSug'); await sleep(450);
  assert((await info(page)).sugI === 1, 'second tap shows suggestion 2');
  for (let k = 2; k < sugs.length; k++) { await tapSel(cdp, page, '#bSug'); await sleep(200); }
  await tapSel(cdp, page, '#bSug'); await sleep(450);
  assert((await info(page)).sugI === 0 && (await page.textContent('#sugS')).includes(sugs[0].name), 'suggestions wrap around, label names the idea (' + sugs.length + ' ideas)');
  // refresh during arranging keeps the arrangement
  const before = await info(page);
  await page.reload(); await sleep(900);
  let after = await info(page);
  assert(after.phase === 'arrange' && rowsOf(after) === rowsOf(before) && after.round === before.round && after.overlay === null, 'refresh keeps the arrangement in progress (no title in the way)');
  // compare
  await waitFor(page, () => window.__tc.info().aiDone);
  const pre = await info(page);
  await tapSel(cdp, page, '#bGo');
  await sleep(500);
  { const q = await info(page); assert(q.phase === 'reveal', 'compare starts the reveal ' + JSON.stringify({ph: q.phase, ov: q.overlay, busy: q.busy, foul: q.foul})); }
  await page.screenshot({ path: path.join(OUT, 'reveal-390x844.png') });
  assert(await waitFor(page, () => window.__tc.info().overlay === 'result', 30000), 'result sheet appears');
  let r1 = await info(page);
  const exp = TC.settle([{ arr: pre.my, special: null }].concat(r1.opp));
  assert(JSON.stringify(exp.total) === JSON.stringify(r1.res.total), 'round totals match the rules core');
  assert(r1.scores.reduce((x, y) => x + y, 0) === 0 && r1.scores[0] === r1.res.total[0], 'scores are zero-sum and added');
  const sheet = await page.evaluate(() => document.getElementById('resBig').textContent);
  assert(sheet.replace('−', '-').replace('+', '') === String(r1.res.total[0]), 'result sheet shows the round total');
  // refresh at the result
  await page.reload(); await sleep(900);
  let r2 = await info(page);
  assert(r2.phase === 'result' && JSON.stringify(r2.scores) === JSON.stringify(r1.scores), 'refresh after the round keeps the result and scores');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('thirteen-cards:v1:stats')));
  assert(st.rounds === 1 && st.total === r1.res.total[0], 'stats saved');
  // look at the table, then next round from the action bar
  if (r2.overlay !== 'result') await tapSel(cdp, page, '#bSug'); await sleep(400);
  await tapSel(cdp, page, '#resLook'); await sleep(400);
  assert((await info(page)).overlay === null, '看牌桌 hides the sheet');
  await page.setViewportSize({ width: 390, height: 520 }); await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  await tapSel(cdp, page, '#bGo'); await sleep(1600);
  let n2 = await info(page);
  assert(n2.round === 2 && n2.phase === 'arrange' && n2.my.flat().length === 13, 'next round dealt');
  // play a few rounds quickly (suggestion + compare, skipping the animation by tapping)
  for (let k = 0; k < 3; k++) {
    await waitFor(page, () => !window.__tc.info().busy);
    const ii = await info(page);
    if (ii.overlay === 'spov') { await tapSel(cdp, page, '#spNo'); await sleep(300); }
    await tapSel(cdp, page, '#bSug'); await sleep(300);
    await tapSel(cdp, page, '#bGo'); await sleep(800);
    await touch(cdp, 195, 420); // tap to skip the animation
    assert(await waitFor(page, () => window.__tc.info().overlay === 'result', 20000), `round ${ii.round}: finished (skip by tapping)`);
    await tapSel(cdp, page, '#resNext'); await sleep(1500);
  }
  const fin = await info(page);
  assert(fin.round === 5 && fin.scores.reduce((x, y) => x + y, 0) === 0, 'four rounds played, scores still zero-sum');
  // rapid taps: 8 taps per second alternating front/back rows -> every pair is one swap
  await waitFor(page, () => !window.__tc.info().busy);
  const ri = await info(page), t0 = ri.taps, w0 = ri.swaps;
  let expectSwaps = 0;
  let moved = []; // aim at cards at rest: the two cards of the last swap are still sliding into place
  for (let k = 0; k < 24; k++) {
    const c = await info(page);
    const pick = (row, n) => { const r = c.my[row].filter(x => !moved.includes(x)); return r[n % r.length]; };
    const id = k % 2 === 0 ? pick(0, k) : pick(2, k * 3);
    if (k % 2 === 0) moved = [id]; else moved.push(id);
    await tapCard(cdp, page, id); if (k % 2) expectSwaps++;
    await sleep(125 - 50);
  }
  await sleep(400);
  const rf = await info(page);
  console.log('miss', rf.miss, 'drops', rf.drops, 'busy', rf.busy);
  assert(rf.taps - t0 === 24 && rf.swaps - w0 === expectSwaps, `rapid taps: 24 taps at 8/s -> ${rf.taps - t0} taps, ${rf.swaps - w0}/${expectSwaps} swaps (none lost or doubled)`);
  assert(!s.errors.length, 'no page errors while playing ' + s.errors.join(' | '));
  assert(!s.ext.length, 'no external requests');
  await s.ctx.close();

  // ---------- touch edge cases: two thumbs, undo after refresh, taps during the reveal ----------
  {
    const e = await open(browser, base + '?seed=21&notitle=1', { width: 390, height: 844 }, 'light');
    const P = e.page, C = e.cdp;
    await P.evaluate(() => { try { localStorage.setItem('thirteen-cards:v1:settings', JSON.stringify({ coach: 1 })); } catch (x) {} });
    await P.evaluate(() => window.__tc.newGame(4040, 1)); await sleep(500);
    const ready = async () => { await sleep(200); if ((await info(P)).overlay === 'spov') { await tapSel(C, P, '#spNo'); await sleep(300); } await waitFor(P, () => { const i = window.__tc.info(); return !i.busy && i.aiDone && i.overlay === null; }); await sleep(250); };
    await ready();
    // second thumb lands while the first is still down: both count, giving one swap
    let q = await info(P);
    const A = await P.evaluate(id => window.__tc.cardRect(id), q.my[0][0]), B = await P.evaluate(id => window.__tc.cardRect(id), q.my[2][0]);
    const pa = { x: A.x + A.w / 2, y: A.y + A.h / 2, id: 0 }, pb = { x: B.x + B.w / 2, y: B.y + B.h / 2, id: 1 };
    await C.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pa] }); await sleep(80);
    await C.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pa, pb] }); await sleep(60);
    await C.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pa] }); await sleep(40);
    await C.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(400);
    let q2 = await info(P);
    assert(q2.my[0].includes(q.my[2][0]) && q2.my[2].includes(q.my[0][0]) && q2.sel === null, 'two thumbs overlapping (hold one card, tap another) still swap');
    // undo history survives a refresh
    await tapCard(C, P, q2.my[1][0]); await sleep(80); await tapCard(C, P, q2.my[2][1]); await sleep(400);
    const q3 = await info(P);
    await P.goto(base + '?notitle=1'); await sleep(900); // plain refresh (the ?seed= link would start its own session)
    assert(!(await P.evaluate(() => document.getElementById('bUndo').disabled)), 'undo is still available after a refresh');
    await tapSel(C, P, '#bUndo'); await sleep(350);
    assert(rowsOf(await info(P)) === rowsOf(q2), 'undo after a refresh restores the step before');
    await tapSel(C, P, '#bUndo'); await sleep(350);
    assert(rowsOf(await info(P)) === rowsOf(q), '...and the step before that');
    // a tap during the reveal, where 下一局 will appear, only skips: the result sheet stays up
    for (const [delay, label] of [[1000, '1 s'], [2500, '2.5 s'], [40, 'double tap 40 ms'], [150, 'double tap 150 ms']]) {
      await P.evaluate(d => window.__tc.newGame(d, 1), 4040 + delay); await sleep(300); await ready();
      const g = await P.locator('#bGo').boundingBox(), r0 = (await info(P)).round, gx = g.x + g.width / 2, gy = g.y + g.height / 2;
      await touch(C, gx, gy, 50); await sleep(delay); await touch(C, gx, gy, 60); await sleep(900);
      const z = await info(P);
      assert(z.round === r0 && z.phase === 'result' && z.overlay === 'result', `tap on 比牌 during the reveal (${label}) skips to the result sheet, no extra 下一局 (round ${z.round}, ${z.phase}, ${z.overlay})`);
    }
    // a short swipe skips the reveal (no click); a real tap on 下一局 right after must not be eaten
    await P.evaluate(() => window.__tc.newGame(6262, 1)); await sleep(300); await ready();
    { const r0 = (await info(P)).round;
      await tapSel(C, P, '#bGo'); await sleep(900);
      await C.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420 }] });
      for (let k = 1; k <= 6; k++) { await C.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 420 - k * 12 }] }); await sleep(16); }
      await C.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await waitFor(P, () => window.__tc.info().overlay === 'result', 15000); await sleep(300);
      await tapSel(C, P, '#resNext'); await sleep(600);
      assert((await info(P)).round === r0 + 1, 'after a swipe skips the reveal, the next tap on 下一局 works'); }
    // a fresh tap on 下一局 works at once, even while the sheet fades in
    await P.evaluate(() => window.__tc.newGame(5150, 1)); await sleep(300); await ready();
    await tapSel(C, P, '#bGo'); await sleep(600); await touch(C, 195, 420);
    await waitFor(P, () => window.__tc.info().overlay === 'result', 15000); await sleep(30);
    const r0 = (await info(P)).round; await tapSel(C, P, '#resNext'); await sleep(700);
    assert((await info(P)).round === r0 + 1, '下一局 responds to a tap right after the sheet appears');
    // the result table fits with the longest 加倍 labels at every width (小計 must stay readable)
    await ready(); await tapSel(C, P, '#bGo'); await sleep(400);
    if ((await info(P)).overlay === 'confirm') { await tapSel(C, P, '#cfYes'); await sleep(300); }
    await sleep(600); await touch(C, 195, 300);
    await waitFor(P, () => window.__tc.info().overlay === 'result', 15000); await sleep(400);
    const fitBad = [];
    for (const [w, h] of [[320, 568], [360, 640], [375, 667], [390, 844], [844, 390], [667, 375]]) {
      await P.setViewportSize({ width: w, height: h }); await sleep(250);
      for (const lab of ['—', '打槍×2', '被打×2', '全壘打×4', '被全壘打×4']) {
        const m = await P.evaluate(lab => {
          document.querySelectorAll('#resTab td.mul').forEach(td => { td.textContent = lab; });
          const sc = document.querySelector('#result .scroll').getBoundingClientRect(), pn = document.getElementById('resPnl').getBoundingClientRect();
          const tots = [...document.querySelectorAll('#resTab .tot')].map(x => x.getBoundingClientRect());
          return { out: tots.some(r => r.right > Math.min(sc.right, pn.right) + 0.5 || r.left < sc.left - 0.5), wide: document.getElementById('resTab').scrollWidth > Math.ceil(sc.width) + 1, page: document.documentElement.scrollWidth > innerWidth };
        }, lab);
        if (m.out || m.wide || m.page) fitBad.push(`${w}x${h} ${lab}`);
      }
    }
    await P.setViewportSize({ width: 390, height: 844 }); await sleep(250);
    assert(!fitBad.length, 'result table fits with every 加倍 label at 320/360/375/390 px and landscape ' + fitBad.join(', '));
    assert(!e.errors.length, 'edge cases: no page errors ' + e.errors.join(' | '));
    await e.ctx.close();
  }

  // ---------- special hand ----------
  const sp = await open(browser, base + '?seed=108&notitle=1', { width: 390, height: 844 }, 'dark');
  await sleep(600);
  let si = await info(sp.page);
  assert(si.special && si.special.name === '六對半' && si.overlay === 'spov', 'special hand offers 報到');
  await tapSel(sp.cdp, sp.page, '#spYes'); await sleep(300);
  await waitFor(sp.page, () => window.__tc.info().aiDone);
  await tapSel(sp.cdp, sp.page, '#bGo'); await sleep(500); await touch(sp.cdp, 195, 420);
  await waitFor(sp.page, () => window.__tc.info().overlay === 'result', 20000);
  si = await info(sp.page);
  const ns = si.opp.filter(o => !o.special).length;
  assert(si.res.total[0] >= 3 * ns, `報到 collects ${si.res.total[0]} (3 from each of ${ns} non-special hands)`);
  assert(!sp.errors.length, 'special round: no page errors');
  await sp.page.screenshot({ path: path.join(OUT, 'special-390x844.png') });
  await sp.ctx.close();

  await browser.close(); srv.close();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
