// Checks whether the 悔棋 button is ever enabled for the human during play (real touch input).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const html = fs.readFileSync('' + require('path').resolve(__dirname, '../../../apps/aeroplane-chess/index.html') + '', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route('**/*', r => r.request().url() === 'http://aero.test/' ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); await p.goto('http://aero.test/'); await sleep(600);
  const cdp = await ctx.newCDPSession(p); let id = 1;
  const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: id++ }] }); await sleep(50); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const tapSel = async s => { await p.locator(s).scrollIntoViewIfNeeded(); const bb = await p.locator(s).boundingBox(); await tap(bb.x + bb.width / 2, bb.y + bb.height / 2); };
  await tapSel('#mStart'); await sleep(600); if (await p.isVisible('#tut')) { await tapSel('#tutSkip'); await sleep(200); }   // first start opens the tutorial await p.evaluate(() => window.__game.setSpeed(4));
  const seen = { 'await-roll': [0, 0], choose: [0, 0] }; let undone = null;
  for (let k = 0; k < 600; k++) {
    const g = await p.evaluate(() => JSON.parse(JSON.stringify(window.__game.state())));
    if (g.human && !g.busy && seen[g.ui]) {
      const dis = await p.$eval('#bUndo', b => b.disabled); seen[g.ui][dis ? 1 : 0]++;
      if (!dis && !undone) { const k0 = g.st.k, t0 = g.st.turnNo; await tapSel('#bUndo'); await sleep(400); const g2 = await p.evaluate(() => window.__game.state()); undone = { from: [t0, k0], to: [g2.st.turnNo, g2.st.k], toast: await p.textContent('#toast') }; continue; }
      if (g.ui === 'await-roll') await tapSel('#diceBtn');
      else if (g.chooser) await tapSel('#chOne');
      else { const xy = await p.evaluate(() => { const s = window.__game.state().st; for (let i = 0; i < s.pos[0].length; i++) { const xy = window.__game.planeXY(0, i); const el = document.elementFromPoint(xy[0], xy[1]); } return null; }); const L = await p.evaluate(() => { const s = window.__game.state().st; return s.pos[0]; });
        // tap each own plane until something happens
        for (let i = 0; i < L.length; i++) { const [x, y] = await p.evaluate(i => window.__game.planeXY(0, i), i); await tap(x, y); await sleep(150); const u = await p.evaluate(() => window.__game.state()); if (u.ui !== 'choose' || u.chooser) break; } }
      if (seen['await-roll'][0] + seen['await-roll'][1] > 25) break;
    }
    await sleep(80);
  }
  console.log(JSON.stringify({ undoEnabledCounts_enabled_disabled: seen, undone, errs }));
  await b.close();
})();
