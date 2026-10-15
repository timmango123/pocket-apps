// Layout check for 天機齒輪 on phones: nothing on the board may pile up.
// Usage: node apps/antikythera/demo/verify.js [--shots <dir>] [--levels 1,6,25,100]
// For each phone size, standalone and inside a hub-like frame (52 px bar above a full-height iframe),
// loads several levels, places the intended solution (and one gear by tapping, like a player), then asserts:
//  - the whole plate fits inside the board stage and the stage doesn't run under the dial cards or gear box;
//  - the stage keeps a usable height;
//  - every drawn gear sprite has exactly its geometric size, and same-layer gears overlap only by their mesh;
//  - no tooth-count label overlaps another label or another gear's hub, and every label stays on the stage;
//  - no label or gear hub sits under the status pill or the zoom button;
//  - a hub never covers more than its gear's root circle allows (smallest gear still visible around its hub).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const args = process.argv.slice(2), arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const SHOTS = arg('--shots');
const LEVELS = (arg('--levels') || '1,4,6,10,25,50,75,100').split(',').map(Number);
const SIZES = [[360, 780], [375, 667], [390, 844], [412, 915], [390, 664], [375, 553]];
const SKEL = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>';
const HUB = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;height:100%}#p{position:fixed;inset:0;display:grid;grid-template-rows:auto 1fr}.bar{height:52px;background:#fff}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><div id=p><div class=bar></div><iframe src="/app/"></iframe></div></body></html>';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };

(async () => {
  const srv = await new Promise(r => { const s = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url.startsWith('/app/') ? SKEL + HTML + '</body></html>' : HUB);
  }); s.listen(0, () => r(s)); });
  const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of SIZES) for (const mode of ['app', 'hub']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('antikythera.unlockAll', 'true'); } catch (e) {} });
    const p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(base + (mode === 'app' ? '/app/' : '/hub'));
    let fr = mode === 'app' ? p.mainFrame() : null;
    for (let i = 0; i < 50 && !fr; i++) { await p.waitForTimeout(100); fr = p.frames().find(f => f !== p.mainFrame() && f.url().includes('/app/')); }
    await fr.waitForFunction(() => window.__antikythera && window.__antikythera.level, null, { timeout: 30000 });
    await fr.addStyleTag({ content: '#winOv, #toast { display: none !important; }' });
    for (const n of LEVELS) {
      const tag = `${w}x${h} ${mode} L${n}`;
      await fr.evaluate(n => window.__antikythera.loadLevel(n), n);
      await fr.waitForFunction(n => document.getElementById('lvNum').textContent.includes(' ' + n + ' '), n, { timeout: 90000 });
      // a player's move: tap the first tray gear, then tap the first free peg
      await p.waitForTimeout(100);
      const tok = await fr.evaluate(() => { const r = document.querySelector('.token').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      const fo = mode === 'app' ? [0, 52 * 0] : [0, 52];
      await p.touchscreen.tap(tok[0] + fo[0], tok[1] + fo[1]);
      const peg = await fr.evaluate(() => { const A = window.__antikythera; const i = A.level.pegs.findIndex(q => q.kind !== 'crank'); return [i, ...A.pegScreen(i)]; });
      await p.touchscreen.tap(peg[1] + fo[0], peg[2] + fo[1]);
      await fr.waitForFunction(i => window.__antikythera.placement.has(i), peg[0], { timeout: 3000 }).catch(() => {});
      ok(await fr.evaluate(i => window.__antikythera.placement.has(i), peg[0]), `${tag}: tapping a tray gear then a peg places it`);
      // the intended solution
      await fr.evaluate(() => { const A = window.__antikythera; A.placement.clear(); A.solve(); });
      await fr.waitForFunction(() => { const A = window.__antikythera; return A.layout && A.layout.items.length === A.placement.size + 1 && A.layout.sc === A.view.sc && A.layout.ch === A.view.ch; }, null, { timeout: 10000 });
      const r = await fr.evaluate(() => {
        const A = window.__antikythera, L = A.level, lay = A.layout, v = lay; // judge the frame as it was drawn
        const rect = el => el.getBoundingClientRect();
        const st = rect(document.getElementById('stage')), tg = rect(document.getElementById('targets')), tr = rect(document.querySelector('.trayWrap'));
        const ADD = 1.8, DED = 2.4, out = { win: A.ev.win, stageH: st.height, sc: v.sc, problems: [] };
        const P = s => out.problems.push(s);
        if (st.top < tg.bottom - 0.5) P(`stage top ${st.top.toFixed(1)} under dial cards ${tg.bottom.toFixed(1)}`);
        if (st.bottom > tr.top + 0.5) P(`stage bottom ${st.bottom.toFixed(1)} under gear box ${tr.top.toFixed(1)}`);
        const px0 = v.ox - 10 * v.sc, py0 = v.oy - 10 * v.sc, px1 = px0 + (L.W + 20) * v.sc, py1 = py0 + (L.H + 20) * v.sc;
        if (px0 < -0.5 || py0 < -0.5 || px1 > v.cw + 0.5 || py1 > v.ch + 0.5) P(`plate ${[px0, py0, px1, py1].map(x => x.toFixed(0))} outside stage ${v.cw.toFixed(0)}x${v.ch.toFixed(0)}`);
        // gears as drawn: centre from pegScreen, radius from the sprite geometry (T + ADD) * sc
        const wheels = [];
        for (const it of lay.items) for (const layer of ['A', 'B']) if (it.w[layer]) wheels.push({ peg: it.i, layer, T: it.w[layer], x: it.x, y: it.y, r: (it.w[layer] + ADD) * v.sc });
        for (let a = 0; a < wheels.length; a++) for (let b = a + 1; b < wheels.length; b++) {
          const g1 = wheels[a], g2 = wheels[b];
          if (g1.peg === g2.peg || g1.layer !== g2.layer) continue;
          const d = Math.hypot(g1.x - g2.x, g1.y - g2.y), overlap = g1.r + g2.r - d;
          if (overlap > 2 * ADD * v.sc + 0.6 * v.sc + 0.5) P(`gears on pegs ${g1.peg}/${g2.peg} (${g1.T},${g2.T} layer ${g1.layer}) overlap ${overlap.toFixed(1)}px, mesh allows ${(2 * ADD * v.sc).toFixed(1)}`);
        }
        const hits = (a, b) => a[0] < b[2] - 0.01 && b[0] < a[2] - 0.01 && a[1] < b[3] - 0.01 && b[1] < a[3] - 0.01;
        lay.labels.forEach((l, i) => {
          const b = l.box;
          if (b[0] < 0 || b[1] < 0 || b[2] > v.cw || b[3] > v.ch) P(`label ${l.txt} off the stage`);
          lay.labels.forEach((m, j) => { if (j > i && hits(b, m.box)) P(`labels ${l.txt} and ${m.txt} overlap`); });
          lay.items.forEach(it => { if (it !== l.it && hits(b, [it.x - it.hr, it.y - it.hr, it.x + it.hr, it.y + it.hr])) P(`label ${l.txt} covers the hub on peg ${it.i}`); });
        });
        const sr = st, ui = [['status pill', document.getElementById('status')], ['zoom button', document.getElementById('zoomBtn')]].filter(([, el]) => !el.hidden)
          .map(([name, el]) => { const r = el.getBoundingClientRect(); return [name, [r.left - sr.left, r.top - sr.top, r.right - sr.left, r.bottom - sr.top]]; });
        for (const [name, u] of ui) {
          lay.labels.forEach(l => { if (hits(l.box, u)) P(`label ${l.txt} under the ${name}`); });
          lay.items.forEach(it => { if (hits([it.x - it.hr, it.y - it.hr, it.x + it.hr, it.y + it.hr], u)) P(`gear hub on peg ${it.i} under the ${name}`); });
        }
        for (const it of lay.items) {
          const minT = Math.min(...[it.w.A, it.w.B].filter(Boolean));
          if (it.hr > (minT - DED) * v.sc + 0.01 && it.hr > 3) P(`hub on peg ${it.i} (r ${it.hr.toFixed(1)}) covers its ${minT}-tooth gear (root ${((minT - DED) * v.sc).toFixed(1)})`);
        }
        out.labels = lay.labels.length; out.items = lay.items.filter(it => it.p.kind !== 'crank').length; out.crowded = lay.crowded;
        out.zoomBtn = !document.getElementById('zoomBtn').hidden;
        return out;
      });
      ok(r.win, `${tag}: solution wins`);
      ok(r.stageH >= 120, `${tag}: board stage ${r.stageH.toFixed(0)}px tall`);
      for (const pr of r.problems) ok(false, `${tag}: ${pr}`);
      if (!r.problems.length) pass++;
      ok(!r.crowded || r.zoomBtn, `${tag}: labels left out but no zoom button`);
      console.log(`  ${tag}: stage ${r.stageH.toFixed(0)}px, scale ${r.sc.toFixed(2)}, labels ${r.labels}/${r.items}${r.problems.length ? ', ' + r.problems.length + ' problems' : ''}`);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${w}x${h}-${mode}-L${n}.png`) });
    }
    // zooming in on a crowded board shows every label again
    if (LEVELS.includes(100)) {
      const z = await fr.evaluate(async () => {
        const A = window.__antikythera; if (!A.layout.crowded) return null;
        document.getElementById('zoomBtn').click();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { sc: A.view.sc };
      });
      if (z) ok(z.sc >= 0.84, `${w}x${h} ${mode}: zoom button magnifies a crowded board to a readable scale (${z.sc.toFixed(2)})`);
    }
    ok(!errs.length, `${w}x${h} ${mode}: no page errors ${errs.join('; ')}`);
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(`${fail ? 'FAIL' : 'OK'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
