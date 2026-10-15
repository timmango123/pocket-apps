// Edge-case probes for kiln-2048 (seeds a saved 3x3 "small" game in localStorage, then plays via touch only).
const path = require('path'), fs = require('fs');
const H = require('./harness');
const APP = 'file://' + path.resolve(__dirname, '../../../apps/kiln-2048/index.html');
const seed = cells => `localStorage.setItem('kiln2048-mode','small');localStorage.setItem('kiln2048-game-small',JSON.stringify({mode:'small',skin:'kiln',cells:${JSON.stringify(cells)},stones:[],seed:0,day:0,score:1000,undosLeft:3,history:[],won:false,keepGoing:false,timeLeft:0,stepsLeft:0,started:true,over:false}));`;
async function state(page) { return page.evaluate(() => ({ cells: [...document.querySelectorAll('#board .tile:not(.dying) b')].map(b => +b.textContent), overlay: (document.querySelector('#board .overlay h2') || {}).textContent || null, goal: document.getElementById('goal').textContent, undo: document.getElementById('undo').textContent })); }
async function swipeLeft(P, page) { const b = await page.locator('#board').boundingBox(); await P.swipe(b.x + b.width * 0.7, b.y + b.height / 2, -120, 0, { exact: true }); }
async function swipeAll(P, page) { const b = await page.locator('#board').boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2; for (const [dx, dy] of [[0, -120], [120, 0], [0, 120], [-120, 0]]) { await P.swipe(cx, cy, dx, dy, { exact: true }); await H.sleep(250); } }
(async () => {
  const browser = await H.launch(); const out = {};
  // Probe A: tap 回爐 (undo) while the win card is up
  { const s = await H.newSession(browser, APP, seed([[128, 128, 0], [2, 4, 8], [16, 32, 64]])); const P = new H.Player(s, 'superhuman', 1); await H.sleep(800);
    await swipeLeft(P, s.page); await H.sleep(700); const a = await state(s.page);
    await P.tapSelector('#undo'); await H.sleep(400); const b = await state(s.page);
    await swipeAll(P, s.page); await H.sleep(300); const c = await state(s.page);
    out.undoOnWinCard = { afterWinningSwipe: a, afterUndoTap: b, afterFourSwipes: c, softlock: !b.overlay && JSON.stringify(b.cells) === JSON.stringify(c.cells), errors: s.errors };
    await s.ctx.close(); }
  // Probe B: winning merge that leaves no legal move (90% when the spawn is a 2)
  { const res = [];
    for (let i = 0; i < 4; i++) {
      const s = await H.newSession(browser, APP, seed([[128, 128, 4], [8, 16, 32], [64, 2, 8]])); const P = new H.Player(s, 'superhuman', 1); await H.sleep(800);
      await swipeLeft(P, s.page); await H.sleep(800); const a = await state(s.page);
      await P.tapSelector('#board .overlay button[data-a="go"]'); await H.sleep(300);
      await swipeAll(P, s.page); await H.sleep(500); const c = await state(s.page);
      res.push({ afterWin: a, afterContinueAndFourSwipes: c, noOverOverlay: !c.overlay });
      await s.ctx.close(); }
    out.winWithNoMovesLeft = res; }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'probe-results.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1).slice(0, 3000));
})();
