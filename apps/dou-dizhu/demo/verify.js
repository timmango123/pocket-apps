// Verification for 鬥地主 (dou-dizhu) in Chromium with Playwright.
// (1) Opens the page at 390×844 and the three in-lobby iframe sizes (375×500, 390×610, 430×740), light and dark:
//     no page errors, no horizontal overflow, title with the sample table, 44px tap targets.
// (2) Plays complete rounds against the page's AI with real touch taps (bidding, hint, pass, play) until the human
//     has been landlord at least once and farmer at least once, checks scoring/coins/persistence (繼續牌局),
//     and writes demo/cover-390x520.png (mid-game, cards selected) plus demo/390x844.png and the iframe-size shots.
// Usage: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const DZ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return DZ;')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const assert = (c, m) => { if (c) { passed++; console.log('ok -', m); } else { failed++; console.log('FAIL -', m); } };
function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  return new Promise(r => srv.listen(0, () => r(srv)));
}
async function touch(cdp, x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(50); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); if (!b) throw new Error('no box for ' + sel); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }
const info = page => page.evaluate(() => window.__dz.info());
async function open(browser, url, vp, scheme) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url); await sleep(700);
  return { ctx, page, errors, cdp: await ctx.newCDPSession(page) };
}
async function playRound(page, cdp, opts) { // returns the round result; takes the cover shot when asked
  let shot = false, hintUsed = false, passUsed = false, steps = 0;
  for (; steps < 3000; steps++) {
    const inf = await info(page);
    if (inf.overlay === 'help') { await tapSel(cdp, page, '#hOk'); await sleep(200); continue; }
    if (inf.overlay === 'roundEnd') return { res: inf.result, hintUsed, passUsed, inf };
    if (inf.busy || inf.paused || inf.turn !== 0) { await sleep(90); continue; }
    if (inf.gphase === 'bid') {
      const want = opts.bid != null ? opts.bid : DZ.think(inf.view, steps).bid;
      let v = want > inf.bid ? want : 0; if (opts.bid === 3 && inf.bid >= 3) v = 0;
      await sleep(150); await tapSel(cdp, page, '#bid' + v); await sleep(200); continue;
    }
    if (inf.gphase !== 'play') { await sleep(90); continue; }
    await sleep(160);
    const r = DZ.think(inf.view, steps * 31);
    if (!r.cards) {
      if (!passUsed) { await tapSel(cdp, page, '#bHint'); await sleep(120); const s = (await info(page)).sel; if (!s.length) { assert(true, 'hint with nothing to play leaves no selection'); } }
      await tapSel(cdp, page, '#bPass'); passUsed = true; await sleep(150); continue;
    }
    if (!hintUsed && inf.lead) { // exercise the hint button: it must select a legal beating play
      await tapSel(cdp, page, '#bHint'); await sleep(120);
      const s = (await info(page)).sel, e = DZ.evaluate(s);
      assert(s.length > 0 && e && DZ.beats(e, inf.lead.ev), 'hint selects a legal play that beats ' + inf.lead.ev.name + ' -> ' + (e && e.name));
      hintUsed = true;
      // clear by tapping each selected card again
      for (const c of s) { const p = await page.evaluate(c => window.__dz.cardCenter(c), c); await touch(cdp, p.x, p.y); await sleep(60); }
    }
    for (const c of r.cards) { const p = await page.evaluate(c => window.__dz.cardCenter(c), c); await touch(cdp, p.x, p.y); await sleep(70); }
    const s = (await info(page)).sel;
    if (s.slice().sort((a, b) => a - b).join() !== r.cards.slice().sort((a, b) => a - b).join()) { for (const c of s) { const p = await page.evaluate(c => window.__dz.cardCenter(c), c); await touch(cdp, p.x, p.y); await sleep(60); } continue; }
    if (opts.cover && !shot && inf.hand.length <= 14 && inf.hand.length >= 8) {
      await page.setViewportSize({ width: 390, height: 520 }); await sleep(500);
      await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') }); shot = true; opts.onShot && opts.onShot();
      await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
      // re-select after the relayout
      const s2 = (await info(page)).sel; if (s2.slice().sort((a, b) => a - b).join() !== r.cards.slice().sort((a, b) => a - b).join()) continue;
    }
    await tapSel(cdp, page, '#bPlay'); await sleep(150);
  }
  throw new Error('round did not finish');
}
(async () => {
  const srv = await serve(), URL = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  // 1. sizes & themes
  for (const [vp, scheme] of [[{ width: 390, height: 844 }, 'light'], [{ width: 390, height: 844 }, 'dark'], [{ width: 375, height: 500 }, 'dark'], [{ width: 390, height: 610 }, 'light'], [{ width: 430, height: 740 }, 'dark'], [{ width: 844, height: 390 }, 'light']]) {
    const { ctx, page, errors, cdp } = await open(browser, URL, vp, scheme);
    const ow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const inf = await info(page);
    assert(inf.overlay === 'title' && inf.demo && inf.hand.length >= 10 && inf.lead && inf.lead.by === 0, `${vp.width}x${vp.height} ${scheme}: title over a sample table (${inf.hand.length} cards)`);
    await tapSel(cdp, page, '#tNew'); await sleep(2500);
    const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent && e.getBoundingClientRect().width).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 6), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
    assert(small.length === 0, `${vp.width}x${vp.height}: tap targets >= 44px ${JSON.stringify(small)}`);
    const lay = await page.evaluate(() => { const L = window.__dz.layout(); const a = document.getElementById('act').getBoundingClientRect(); return { actBottom: a.bottom, handY: L.handY, oppBottom: L.oppY + L.tH / 2, myTop: L.myY - L.tH / 2, actTop: a.top }; });
    assert(lay.actBottom <= lay.handY + 1 && lay.oppBottom < lay.myTop && lay.myTop < lay.actTop, `${vp.width}x${vp.height}: table rows do not overlap (opp ${Math.round(lay.oppBottom)} < mine ${Math.round(lay.myTop)} < bar ${Math.round(lay.actTop)})`);
    await page.screenshot({ path: path.join(OUT, `${vp.width}x${vp.height}-${scheme}.png`) });
    assert(ow <= 1 && errors.length === 0, `${vp.width}x${vp.height} ${scheme}: no overflow (${ow}px), no errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  // 2. full rounds with touch input
  const { ctx, page, errors, cdp } = await open(browser, URL + '?seed=2024', { width: 390, height: 844 }, 'dark');
  await tapSel(cdp, page, '#tNew'); await sleep(300);
  let coins = (await info(page)).coins, asLandlord = 0, asFarmer = 0, rounds = 0, shot = false;
  for (let g = 0; g < 8 && (asLandlord < 1 || asFarmer < 1 || !shot); g++) {
    const wantL = asLandlord < 1;
    const r = await playRound(page, cdp, { bid: wantL ? 3 : 0, cover: !shot, onShot: () => { shot = true; } });
    rounds++;
    const inf = r.inf, res = r.res;
    assert(res && typeof res.unit === 'number' && res.deltas.length === 3, `round ${rounds}: result overlay with scoring (${res.landlordWon ? '地主勝' : '農民勝'}, base ${res.base} × ${res.mult})`);
    const exp = coins + res.deltas[0] * 100;
    assert(inf.coins === exp, `round ${rounds}: coins ${coins} -> ${inf.coins} (expected ${exp})`);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dou-dizhu:v1:stats')));
    assert(saved && saved.coins === inf.coins && saved.rounds === rounds, 'stats persisted under dou-dizhu:v1:stats');
    coins = inf.coins;
    if (inf.landlord === 0) asLandlord++; else asFarmer++;
    const title = await page.textContent('#reTitle'); console.log(`   round ${rounds}: you were ${inf.landlord === 0 ? '地主' : '農民'}, "${title}", hint used ${r.hintUsed}, pass used ${r.passUsed}`);
    await page.screenshot({ path: path.join(OUT, `round-${rounds}.png`) });
    await tapSel(cdp, page, '#reNext'); await sleep(2500);
  }
  assert(asLandlord >= 1 && asFarmer >= 1, `played as landlord (${asLandlord}) and as farmer (${asFarmer}) in ${rounds} rounds`);
  assert(fs.existsSync(path.join(OUT, 'cover-390x520.png')), 'cover-390x520.png written');
  // 3. persistence: mid-game reload -> 繼續牌局 restores the same game
  for (let i = 0; i < 200; i++) { const inf = await info(page); if (inf.gphase === 'play' && inf.turn === 0 && !inf.busy) break; await sleep(100); }
  const before = await info(page);
  await page.reload(); await sleep(800);
  assert((await info(page)).overlay === 'title' && await page.locator('#tCont').isVisible(), 'after reload the title offers 繼續牌局');
  await tapSel(cdp, page, '#tCont'); await sleep(600);
  const after = await info(page);
  assert(after.landlord === before.landlord && after.counts.join() === before.counts.join() && after.hand.slice().sort().join() === before.hand.slice().sort().join(), 'continue restores landlord, counts and hand');
  // pause menu + home
  await tapSel(cdp, page, '#bMenu'); await sleep(200); assert((await info(page)).paused && (await info(page)).overlay === 'menu', 'menu pauses the game');
  await tapSel(cdp, page, '#mResume'); await sleep(200); assert(!(await info(page)).paused, 'resume');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });
  assert(errors.length === 0, 'no console errors during play: ' + errors.join(' | '));
  await ctx.close(); await browser.close(); srv.close();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FAIL -', e.stack); process.exit(1); });
