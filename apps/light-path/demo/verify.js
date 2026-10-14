// 光路折鏡 verification: (1) solver proves all 100 levels solvable and that par == min taps;
// (2) Playwright auto-player clears levels 50/75/99/100 through real touch input at human pace, recording video.
// Usage: node verify.js [--solver-only] [levels...]
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const DIR = __dirname, HTML = path.join(DIR, '..', 'index.html');
const src = fs.readFileSync(HTML, 'utf8');
const core = src.slice(src.indexOf('// ===CORE-START==='), src.indexOf('// ===CORE-END==='));
const C = new Function(core + '\nreturn LPCore;')();
const LEVELS = JSON.parse(src.match(/var LEVELS = (\[\[.*?\]\]);/)[1]);
const args = process.argv.slice(2);
const solverOnly = args.includes('--solver-only');
const demoLevels = args.filter(a => /^\d+$/.test(a)).map(Number);

function solveLevel(L) {
  const [v, par] = LEVELS[L - 1];
  const lv = C.build(L, v);
  const s = C.solve(lv, lv.scr, 5e8, lv.ub);
  const ok = s.cost >= 0 && !s.aborted && C.isWin(lv, C.trace(lv, s.ori, false)) && !C.isWin(lv, C.trace(lv, lv.scr, false));
  const taps = [];
  for (const i of lv.rot) if (s.ori[i] !== lv.scr[i]) taps.push(i);
  return { L, lv, par, min: s.cost, ok: ok && s.cost === par && taps.length === par, taps, nodes: s.nodes };
}

(async () => {
  if (!demoLevels.length || solverOnly) {
    let all = true; const t0 = Date.now(); const rep = [];
    for (let L = 1; L <= 100; L++) {
      const r = solveLevel(L);
      if (!r.ok) { all = false; console.log('LEVEL', L, 'FAILED', r.min, r.par); }
      rep.push(r.min);
      if ([1, 25, 50, 75, 100].includes(L)) console.log(`L${L}: ${r.lv.W}x${r.lv.H}, min taps (par) = ${r.min}, solver nodes ${r.nodes}`);
    }
    console.log('par curve:', rep.join(','));
    console.log(all ? 'ALL 100 LEVELS SOLVABLE, par verified minimal' : 'SOME LEVELS FAILED', `(${Date.now() - t0} ms)`);
    if (solverOnly) return;
  }
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const levels = demoLevels.length ? demoLevels : [50, 75, 99, 100];
  for (const L of levels) {
    const r = solveLevel(L);
    const vdir = path.join(DIR, '_vid' + L);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
      recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto('file://' + HTML); await page.waitForTimeout(900);
    await page.tap('#tSelect'); await page.waitForTimeout(500);
    const sw = await page.getAttribute('#unlockAll', 'aria-checked');
    if (sw !== 'true') { await page.tap('#unlockAll'); await page.waitForTimeout(400); }
    const tile = page.locator(`.tile[data-l="${L}"]`);
    await tile.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    await tile.tap(); await page.waitForTimeout(1000);
    const st0 = await page.evaluate(() => window.__game.state());
    if (st0.level !== L) throw new Error('wrong level ' + st0.level);
    const t0 = Date.now();
    // tap order: sweep row by row so the video reads naturally
    const taps = r.taps.slice().sort((a, b) => a - b);
    for (const i of taps) {
      const p = await page.evaluate(i => window.__game.cellClient(i), i);
      await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(260 + Math.floor(Math.random() * 140));
    }
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => window.__game.state());
    await page.waitForSelector('#result.show', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1300);
    await page.screenshot({ path: path.join(DIR, `level-${L}-result.png`) });
    const elapsed = Date.now() - t0;
    const video = page.video(); await ctx.close();
    const webm = await video.path();
    const mp4 = path.join(DIR, `level-${L}.mp4`);
    execSync(`/usr/bin/ffmpeg -loglevel error -y -i "${webm}" -c:v libx264 -pix_fmt yuv420p -crf 28 -movflags +faststart "${mp4}"`);
    fs.rmSync(vdir, { recursive: true, force: true });
    const prog = st.won;
    console.log(`Level ${L}: ${prog ? 'CLEARED' : 'NOT CLEARED'} in ${st.moves} taps (par ${r.par}), ${(elapsed / 1000).toFixed(1)} s, errors: ${errs.length ? errs.join(' | ') : 'none'}, video ${(fs.statSync(mp4).size / 1e6).toFixed(2)} MB`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
