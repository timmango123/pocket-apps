// Precise double-tap checks with real CDP touch: dice (count #cube spins within 400 ms of the first tap; the next possible
// legit roll is >= 690 ms later) and plane (count human plays: own planes changed + G.last) at 1x speed.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const html = fs.readFileSync('' + require('path').resolve(__dirname, '../../../apps/aeroplane-chess/index.html') + '', 'utf8');
const AP = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return AP;')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route('**/*', r => r.request().url() === 'http://aero.test/' ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); await p.goto('http://aero.test/'); await sleep(600);
  const cdp = await ctx.newCDPSession(p); let id = 1;
  const tap = async (x, y, h = 30) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: id++ }] }); await sleep(h); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const tapSel = async s => { await p.locator(s).scrollIntoViewIfNeeded(); const bb = await p.locator(s).boundingBox(); await tap(bb.x + bb.width / 2, bb.y + bb.height / 2); };
  await tapSel('#mStart'); await sleep(600); if (await p.isVisible('#tut')) { await tapSel('#tutSkip'); await sleep(200); }
  await p.evaluate(() => { window.__game.setSpeed(4); window.__spins = []; new MutationObserver(() => window.__spins.push(performance.now())).observe(document.getElementById('cube'), { attributes: true }); });
  const gs = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__game.state())));
  const d = await p.locator('#diceBtn').boundingBox(), dx = d.x + d.width / 2, dy = d.y + d.height / 2;
  const dice = [], plane = [];
  for (let n = 0; n < 400 && (dice.length < 12 || plane.length < 8); n++) {
    const g = await gs();
    if (g.human && !g.busy && g.ui === 'await-roll') {
      const t = await p.evaluate(() => performance.now()); await tap(dx, dy); await sleep(60); await tap(dx, dy); await sleep(450);
      dice.push(await p.evaluate(t => window.__spins.filter(x => x > t && x < t + 420).length, t)); continue;
    }
    if (g.human && !g.busy && g.ui === 'choose' && !g.chooser) {
      const L = AP.legal(g.st, 0, g.st.d), m = L.find(x => !L.some(o => o !== x && o.from === x.from));
      if (m) { const [x, y] = await p.evaluate(i => window.__game.planeXY(0, i), m.pl[0]); const pos0 = g.st.pos[0].slice(); await tap(x, y); await sleep(60); await tap(x, y); await sleep(1200);
        const g2 = await gs(); const exp = AP.clone(g.st); AP.play(exp, m); plane.push({ d: g.st.d, matchesOneMove: JSON.stringify(exp.pos[0]) === JSON.stringify(g2.st.pos[0]) || g2.st.k > g.st.k, changed: g2.st.pos[0].filter((v, i) => v !== pos0[i]).length }); continue; }
      const [x, y] = await p.evaluate(i => window.__game.planeXY(0, i), L[0].pl[0]); await tap(x, y); await sleep(300); if ((await gs()).chooser) await tapSel('#chOne'); continue;
    }
    if (g.chooser) await tapSel('#chOne');
    await sleep(60);
  }
  console.log(JSON.stringify({ diceSpinsPerDoubleTap: dice, plane, errs }));
  await b.close();
})();
