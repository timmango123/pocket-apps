// Clean re-measure of swallowed presses (review.js tap parts C/A could place pieces by accident and use up slots).
// Every press is checked against the live hand: a press on an unused tray slot that does not start a drag = swallowed.
// node probe-tap.js -> probe-tap.json
const fs = require('fs'), path = require('path');
const { serve, launch, newPage, Hands, center, st, sleep } = require('./common');
const instrument = () => { window.__cap = 0; addEventListener('DOMContentLoaded', () => { const cv = document.getElementById('cv'); const o = cv.setPointerCapture.bind(cv); cv.setPointerCapture = id => { window.__cap++; return o(id); }; }); };
(async () => {
  const S = await serve(), browser = await launch(), out = {};
  const { ctx, page, errors } = await newPage(browser, 390, 844); const H = new Hands(await ctx.newCDPSession(page));
  await page.addInitScript(instrument);
  await page.goto(S.url + '?seed=42'); await sleep(700);
  const tap = async sel => { const b = await center(page, sel); await H.tap(b.x, b.y); await sleep(350); };
  await tap('#tNew'); await sleep(500);
  const L = await page.evaluate(() => window.__game.layout());
  const slot = i => ({ x: L.tray.x + L.tray.w / 3 * (i + 0.5), y: L.tray.y + L.tray.h / 2 });
  const OFF = { x: L.W - 4, y: L.H - 3 }; // dropping here is never a legal spot -> piece flies back (180 ms)
  const cap = () => page.evaluate(() => window.__cap);
  const fresh = async () => { await tap('#bMenu'); await tap('#pRestart'); await tap('#cBtns .btn'); await sleep(500); }; // restart now asks to confirm
  // P1: 8 presses/s alternating slot 0 / slot 2; each press = touch down, 50 ms, touch up at the bottom-right edge (never placed)
  for (const [name, gap] of [['P1_8ps', 125], ['P1b_5ps', 200], ['P1c_4ps', 250], ['P1d_3ps', 333]]) {
    await fresh(); const r = { sent: 0, picked: 0, placedByAccident: 0 };
    for (let i = 0; i < 24; i++) {
      const t = Date.now(), p = slot(i % 2 ? 2 : 0), c0 = await cap(), s0 = await st(page);
      await H.down(1, p.x, p.y); await sleep(40); await H.move(1, OFF.x, OFF.y); await sleep(10); await H.up(1); r.sent++;
      if ((await cap()) > c0) r.picked++;
      if ((await st(page)).placed !== s0.placed) r.placedByAccident++;
      await sleep(Math.max(0, gap - (Date.now() - t)));
    }
    out[name] = { gapMs: gap, ...r, swallowed: r.sent - r.picked }; await sleep(400);
  }
  // P2: after a fly-back, press another piece d ms after the release and keep holding (a real drag start)
  out.P2_afterBounce = [];
  for (const d of [60, 120, 180, 240, 300]) for (let rep = 0; rep < 3; rep++) {
    await fresh(); const a = slot(0), b = slot(2);
    await H.down(1, a.x, a.y); await sleep(120); await H.move(1, OFF.x, OFF.y); await sleep(30); await H.up(1);
    const c0 = await cap(); await sleep(d);
    await H.down(2, b.x, b.y); await sleep(80); await H.move(2, b.x, b.y - 30); await sleep(80);
    const ok = (await cap()) > c0; await H.move(2, OFF.x, OFF.y); await sleep(20); await H.up(2); await sleep(350);
    out.P2_afterBounce.push({ gapMs: d, picked: ok });
  }
  // P3: after a valid drop (90 ms place fly), press another unused piece d ms after the release
  out.P3_afterPlace = [];
  for (const d of [30, 60, 90, 120, 150]) for (let rep = 0; rep < 2; rep++) {
    await fresh();
    const m = await page.evaluate(() => window.__game.aiMove()), s0 = await st(page);
    const other = [0, 1, 2].find(i => i !== m.slot && s0.hand[i]);
    await H.down(1, m.from.x, m.from.y); for (let i = 1; i <= 8; i++) { await sleep(20); await H.move(1, m.from.x + (m.to.x - m.from.x) * i / 8, m.from.y + (m.to.y - m.from.y) * i / 8); } await sleep(30); await H.up(1);
    const c0 = await cap(); await sleep(d); const b = slot(other);
    await H.down(2, b.x, b.y); await sleep(80); await H.move(2, b.x, b.y - 30); await sleep(80);
    const ok = (await cap()) > c0; await H.move(2, OFF.x, OFF.y); await sleep(20); await H.up(2); await sleep(350);
    out.P3_afterPlace.push({ gapMs: d, picked: ok });
  }
  out.errors = errors.slice(); fs.writeFileSync(path.join(__dirname, 'probe-tap.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out)); await browser.close(); S.srv.close();
})();
