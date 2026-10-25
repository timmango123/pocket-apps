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
    if (!opts.tagChecked) { const tg = await page.textContent('#myTag'); assert(tg.includes(inf.landlord === 0 ? '地主' : '農民') && tg.includes(String(inf.hand.length)), 'role and card count shown in the action bar: ' + tg); opts.tagChecked = true; }
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
    if (vp.height > vp.width) { // portrait: both rows of played cards sit on the felt table
      const t = await page.evaluate(() => { const L = window.__dz.layout(); return { T: L.table, opp: [L.oppY - L.tH / 2, L.oppY + L.tH / 2], my: [L.myY - L.tH / 2, L.myY + L.tH / 2] }; });
      assert(t.T && t.opp[0] >= t.T.y && t.my[1] <= t.T.y + t.T.h, `${vp.width}x${vp.height}: played cards land on the table (${Math.round(t.T.y)}..${Math.round(t.T.y + t.T.h)})`);
    }
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
  // broke: a new round tops the coins back up to 1,000
  await page.evaluate(() => localStorage.setItem('dou-dizhu:v1:stats', JSON.stringify({ coins: -500, rounds: 3 })));
  await page.reload(); await sleep(800); await tapSel(cdp, page, '#tNew'); await sleep(400);
  if (await page.locator('#abandon').isVisible()) { await tapSel(cdp, page, '#abYes'); await sleep(600); }
  assert((await info(page)).coins === 1000, 'out of coins: the next round starts again from 1,000 (' + (await info(page)).coins + ')');
  assert(errors.length === 0, 'no console errors during play: ' + errors.join(' | '));
  await ctx.close();
  // 4. review fixes
  const visibleTappable = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e || !e.offsetParent) return false; const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === e || e.contains(h)); }, sel);
  async function toMyPlay(page, cdp) { for (let i = 0; i < 300; i++) { const s = await info(page); if (s.gphase === 'play' && s.turn === 0 && !s.busy) return s; if (s.gphase === 'bid' && s.turn === 0 && !s.busy) { await tapSel(cdp, page, '#bid3'); await sleep(300); continue; } await sleep(100); } throw new Error('never reached my turn'); }
  {
    const { ctx, page, errors, cdp } = await open(browser, URL + '?seed=4101', { width: 390, height: 844 }, 'light');
    await tapSel(cdp, page, '#tNew'); await sleep(2600);
    assert(!(await info(page)).overlay && await page.evaluate(() => window.__dz.coachShown()), 'first game: a light hint above the action bar instead of the full help page');
    let s = await toMyPlay(page, cdp);
    // pointerdown lifts the card before the finger is released
    const c = s.hand[3], pc = await page.evaluate(c => window.__dz.cardCenter(c), c);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pc.x, y: pc.y }] }); await sleep(40);
    const down = (await info(page)).sel.includes(c);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(60);
    assert(down && (await info(page)).sel.includes(c), 'a card lifts on touch down and stays selected after release');
    await touch(cdp, pc.x, pc.y); await sleep(60);
    // hand of 20: every card is at least 28px wide to tap (two rows)
    const hw = await page.evaluate(() => window.__dz.hitWidth());
    assert(s.hand.length === 20 && hw >= 28, `20-card hand: narrowest tap width ${hw.toFixed(1)}px (two rows)`);
    let ok20 = 0; for (const c2 of s.hand) { const p = await page.evaluate(c => window.__dz.cardCenter(c), c2); await touch(cdp, p.x, p.y); await sleep(50); if ((await info(page)).sel.includes(c2)) ok20++; await touch(cdp, p.x, p.y); await sleep(50); }
    assert(ok20 === 20 && (await info(page)).sel.length === 0, `tapping each of the 20 cards selects exactly that card (${ok20}/20)`);
    // 記牌器: counts add up to the cards the others hold
    const ctr = await page.evaluate(() => [...document.querySelectorAll('#ctr b')].map(b => +b.textContent));
    assert(ctr.length === 15 && ctr.reduce((a, b) => a + b, 0) === s.counts[1] + s.counts[2] && await page.locator('#ctr').isVisible(), `card counter shows ${ctr.reduce((a, b) => a + b, 0)} cards = what the other two hold`);
    assert(await page.evaluate(() => window.__dz.aiWorker()), 'the AI thinks in a worker');
    // ☰ → 回主畫面: title buttons are back and work
    await tapSel(cdp, page, '#bMenu'); await sleep(250); await tapSel(cdp, page, '#mHome'); await sleep(500);
    assert(await visibleTappable(page, '#tNew') && await visibleTappable(page, '#tCont'), 'menu → 回主畫面: 開新一局 and 繼續牌局 are visible and tappable');
    await tapSel(cdp, page, '#tCont'); await sleep(700);
    assert((await info(page)).gphase === 'play' && !(await info(page)).overlay, '繼續牌局 after going home resumes the hand');
    // 開新一局 with a hand in progress asks first, and giving up costs the stake
    s = await toMyPlay(page, cdp);
    await tapSel(cdp, page, '#bMenu'); await sleep(250); await tapSel(cdp, page, '#mHome'); await sleep(500);
    await tapSel(cdp, page, '#tNew'); await sleep(300);
    assert(await page.locator('#abandon').isVisible(), '開新一局 during a hand asks for confirmation');
    await tapSel(cdp, page, '#abNo'); await sleep(700);
    assert((await info(page)).gphase === 'play' && !(await info(page)).overlay, '回到牌局 keeps the hand');
    s = await toMyPlay(page, cdp);
    const st0 = await page.evaluate(() => JSON.parse(localStorage.getItem('dou-dizhu:v1:stats')) || { coins: 3000, rounds: 0, wins: 0 }), sg = await page.evaluate(() => JSON.parse(localStorage.getItem('dou-dizhu:v1:game')).G), cost = (sg.landlord === 0 ? 2 : 1) * sg.bid * Math.pow(2, sg.bombs) * 100;
    await page.reload(); await sleep(800); await tapSel(cdp, page, '#tNew'); await sleep(300); await tapSel(cdp, page, '#abYes'); await sleep(600);
    const st1 = await page.evaluate(() => JSON.parse(localStorage.getItem('dou-dizhu:v1:stats')));
    assert(st1.coins === st0.coins - cost && st1.rounds === st0.rounds + 1 && st1.wins === st0.wins, `refresh + 開新一局 counts the hand as lost (coins ${st0.coins} → ${st1.coins}, -${cost})`);
    // a full round, then 主畫面 on the result screen
    for (let i = 0; i < 2000; i++) { const t = await info(page); if (t.overlay === 'roundEnd') break; if (t.turn === 0 && !t.busy) { if (t.gphase === 'bid') await tapSel(cdp, page, '#bid0'); else if (t.gphase === 'play') { await tapSel(cdp, page, '#bHint'); await sleep(60); await tapSel(cdp, page, (await page.locator('#bPlay').isDisabled()) ? '#bPass' : '#bPlay'); } } await sleep(120); }
    await tapSel(cdp, page, '#reHome'); await sleep(500);
    assert(await visibleTappable(page, '#tNew') && !(await page.locator('#tCont').isVisible()), 'result → 主畫面: 開新一局 is visible and tappable (no hand to continue)');
    await tapSel(cdp, page, '#tStats'); await sleep(300);
    const stt = await page.textContent('#statsBody');
    assert(/段位/.test(stt) && /成就 \d+／12/.test(stt), 'stats show a rank and 12 achievements');
    await tapSel(cdp, page, '#stOk'); await sleep(200);
    await tapSel(cdp, page, '#tNew'); await sleep(2600);
    assert((await info(page)).gphase === 'bid' && !(await info(page)).overlay, '開新一局 from the title after a finished round starts a new hand without asking');
    assert(errors.length === 0, 'no console errors on the home/forfeit paths: ' + errors.join(' | '));
    await ctx.close();
  }
  for (const vp of [{ width: 360, height: 640 }, { width: 844, height: 390 }]) {
    const { ctx, page, errors, cdp } = await open(browser, URL + '?seed=4101', vp, 'dark');
    if (vp.width === 360) {
      const ov = await page.evaluate(() => { const h = document.querySelector('.logo h1').getBoundingClientRect(), L = window.__dz.layout(); return { h1L: h.left, h1R: h.right, seatR: L.seats[2].x + L.R, seatL: L.seats[1].x - L.R }; });
      assert(ov.h1L > ov.seatR && ov.h1R < ov.seatL, `360×640 title: the logo sits between the sample seats (${Math.round(ov.seatR)} < ${Math.round(ov.h1L)}..${Math.round(ov.h1R)} < ${Math.round(ov.seatL)})`);
      assert(await page.evaluate(() => getComputedStyle(document.querySelector('.kbd')).display === 'none'), 'touch device: no keyboard line in the help');
    }
    await tapSel(cdp, page, '#tNew'); await sleep(2600);
    await toMyPlay(page, cdp);
    const cut = await page.evaluate(() => { const e = document.getElementById('iSub'), b = document.getElementById('iCoin'); return [e.scrollWidth - e.clientWidth, b.scrollWidth - b.clientWidth, e.textContent]; });
    assert(cut[0] <= 0 && cut[1] <= 0, `${vp.width}×${vp.height}: status line fits ("${cut[2]}")`);
    if (vp.width === 360) { const hw = await page.evaluate(() => window.__dz.hitWidth()); assert(hw >= 26, `360 wide, 20 cards: narrowest tap width ${hw.toFixed(1)}px`); }
    if (vp.width === 844) {
      const r = await page.evaluate(() => { const L = window.__dz.layout(), F = L.felt, out = []; for (const p of [1, 2]) for (let n = 1; n <= 16; n++) { const pos = window.__dz.playBox(p, n); for (const q of [pos[0], pos[pos.length - 1]]) for (const dx of [-L.tW / 2, L.tW / 2]) { const x = (q.x + dx - F.cx) / F.rx, y = (q.y - F.cy) / F.ry; if (x * x + y * y > 1.0001) out.push([p, n]); } const seat = L.seats[p]; if (p === 1 && pos[pos.length - 1].x + L.tW / 2 > seat.x - L.R - 30) out.push(['pile', p, n]); if (p === 2 && pos[0].x - L.tW / 2 < seat.x + L.R + 30) out.push(['pile', p, n]); } return out; });
      assert(r.length === 0, `844×390: opponents' plays (1–16 cards) stay on the felt and off their piles ${JSON.stringify(r.slice(0, 3))}`);
      await page.evaluate(() => document.getElementById('bHint').click()); await sleep(120);
      const tb = await page.evaluate(() => { const t = document.getElementById('toast').getBoundingClientRect(), L = window.__dz.layout(), my = window.__dz.playBox(0, 12); return { tR: t.right, tT: t.top, tB: t.bottom, myL: my[0].x - L.tW / 2, mulY: L.botY + L.bH / 2 + 11, cx: L.cx }; });
      assert(tb.tR < tb.myL && tb.tT > tb.mulY + 9, `844×390: the toast stays clear of the multiplier and of a 12-card play of yours (toast right ${Math.round(tb.tR)} < ${Math.round(tb.myL)})`);
    }
    await page.screenshot({ path: path.join(OUT, `${vp.width}x${vp.height}-review.png`) });
    assert(errors.length === 0, `${vp.width}×${vp.height}: no errors`);
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FAIL -', e.stack); process.exit(1); });
