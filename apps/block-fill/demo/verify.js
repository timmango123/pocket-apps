// Verification for 榫卯木格 (block-fill), an endless puzzle.
//   node verify.js shots   -> loads the page at 390x844, 360x780, 844x390 (touch, DPR 2), checks console errors + horizontal overflow, saves screenshots to $SHOTS (default /tmp)
//   node verify.js run     -> auto-player drags pieces with real CDP touch input at human pace (150 ms reaction + 250 ms drag)
//                             through one full game, records demo/run.mp4 (sped up) + demo/run-result.png and logs the difficulty ramp.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mode = process.argv[2] || 'run';

async function touchTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touchTap(cdp, b.x + b.width / 2, b.y + b.height / 2); }
// press on the tray slot, wait like a human, then drag over 250 ms to the drop point and lift
async function touchDrag(cdp, a, b) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await sleep(250 / steps);
    const k = i / steps, e = 1 - Math.pow(1 - k, 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }] });
  }
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
function newCtx(browser, w, h, video) {
  const o = { viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  if (video) o.recordVideo = { dir: video, size: { width: w, height: h } };
  return browser.newContext(o);
}
function watch(page) { const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); return errors; }

async function shots() {
  const dir = process.env.SHOTS || '/tmp'; fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  for (const [w, h] of [[390, 844], [360, 780], [844, 390]]) {
    for (const theme of ['dark', 'light']) {
      const ctx = await newCtx(browser, w, h); const page = await ctx.newPage(); const errors = watch(page);
      await page.addInitScript(t => { try { localStorage.setItem('blockfill.settings', JSON.stringify({ theme: t, sound: false })); localStorage.setItem('blockfill.best', '1520'); } catch (e) {} }, theme);
      await page.goto('file://' + APP + '?seed=42'); await sleep(600);
      const cdp = await ctx.newCDPSession(page);
      const tag = `${w}x${h}-${theme}`;
      await page.screenshot({ path: `${dir}/bf-${tag}-title.png` });
      await tapSel(cdp, page, '#tNew'); await sleep(700);
      for (let i = 0; i < 13; i++) {
        const m = await page.evaluate(() => window.__game.aiMove()); if (!m) break;
        await touchDrag(cdp, m.from, m.to); await sleep(260);
        for (let k = 0; k < 40 && (await page.evaluate(() => window.__game.state().busy)); k++) await sleep(30);
      }
      // mid-drag screenshot (piece floating above the finger with preview)
      const m = await page.evaluate(() => window.__game.aiMove());
      if (m) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [m.from] });
        for (let i = 1; i <= 8; i++) { await sleep(25); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: m.from.x + (m.to.x - m.from.x) * i / 8, y: m.from.y + (m.to.y - m.from.y) * i / 8 }] }); }
        await sleep(200); await page.screenshot({ path: `${dir}/bf-${tag}-drag.png` });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await tapSel(cdp, page, '#bMenu'); await sleep(400); await page.screenshot({ path: `${dir}/bf-${tag}-pause.png` });
      await tapSel(cdp, page, '#pSet'); await sleep(400); await page.screenshot({ path: `${dir}/bf-${tag}-settings.png` });
      await tapSel(cdp, page, '#sOk'); await sleep(300); await tapSel(cdp, page, '#pHome'); await sleep(400);
      await tapSel(cdp, page, '#tStats'); await sleep(400); await page.screenshot({ path: `${dir}/bf-${tag}-stats.png` });
      await tapSel(cdp, page, '#stOk'); await sleep(300);
      // force a game over to view the result card
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('blockfill.save')); s.b = s.b.map((v, i) => (i % 9 === ((i / 9) | 0)) ? 0 : (v || 3)); s.hand = [{ id: 10, col: 2, used: false }, { id: 8, col: 4, used: false }, { id: 7, col: 5, used: false }]; localStorage.setItem('blockfill.save', JSON.stringify(s)); });
      await tapSel(cdp, page, '#tCont'); await sleep(2200); await page.screenshot({ path: `${dir}/bf-${tag}-over.png` });
      console.log(tag, 'overflow', overflow, 'errors', errors.length ? errors.join(' | ') : 'none', 'layout', JSON.stringify(await page.evaluate(() => window.__game.layout())));
      await ctx.close();
    }
  }
  await browser.close();
}

async function run() {
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await newCtx(browser, 390, 844, vdir); const page = await ctx.newPage(); const errors = watch(page);
  await page.addInitScript(() => { try { localStorage.setItem('blockfill.best', '2400'); localStorage.setItem('blockfill.settings', JSON.stringify({ theme: 'dark' })); } catch (e) {} });
  const seed = +process.env.SEED || 7;
  await page.goto('file://' + APP + '?seed=' + seed); await sleep(900);
  const cdp = await ctx.newCDPSession(page);
  await tapSel(cdp, page, '#tNew'); await sleep(800);
  const t0 = Date.now(); const ramp = []; let lastDiff = 0, n = 0;
  const CAP = +process.env.CAP || 700;
  while (n < CAP) {
    const st = await page.evaluate(() => window.__game.state());
    if (st.mode !== 'play') break;
    if (st.diff !== lastDiff) { lastDiff = st.diff; ramp.push({ placed: st.placed, score: st.score, diff: st.diff, hardW: (st.hardW * 100).toFixed(1) + '%', t: ((Date.now() - t0) / 1000).toFixed(0) + 's' }); }
    const m = await page.evaluate(() => window.__game.aiMove()); if (!m) break;
    await sleep(150);                       // reaction time
    await touchDrag(cdp, m.from, m.to);     // 250 ms drag
    n++;
    for (let k = 0; k < 60; k++) { const s = await page.evaluate(() => window.__game.state()); if (!s.busy) break; await sleep(25); }
    await sleep(60);
    if (n % 50 === 0) { const s = await page.evaluate(() => window.__game.state()); console.log(`  placed ${s.placed} score ${s.score} diff ${s.diff} hard ${(s.hardW * 100).toFixed(1)}%`); }
  }
  for (let k = 0; k < 40; k++) { if (await page.isVisible('#over')) break; await sleep(100); }
  await sleep(1200);
  const st = await page.evaluate(() => window.__game.state());
  await page.screenshot({ path: path.join(OUT, 'run-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const speed = secs > 150 ? 4 : (secs > 60 ? 2 : 1);
  const name = speed > 1 ? `run-${speed}x.mp4` : 'run.mp4';
  for (const f of fs.readdirSync(OUT)) if (/^run(-\dx)?\.mp4$/.test(f)) fs.rmSync(path.join(OUT, f));
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', `setpts=PTS/${speed},fps=30`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', path.join(OUT, name)]);
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log('difficulty ramp:'); ramp.forEach(r => console.log('  ', JSON.stringify(r)));
  console.log(`RUN result: mode ${st.mode} score ${st.score} placements ${st.placed} lines ${st.lines} maxCombo ${st.maxCombo} final diff ${st.diff} hard ${(st.hardW * 100).toFixed(1)}% time ${secs.toFixed(0)}s video ${name} ${Math.round(fs.statSync(path.join(OUT, name)).size / 1024)}KB errors ${errors.length ? errors.join(' | ') : 'none'}`);
}

(mode === 'shots' ? shots() : run()).catch(e => { console.error(e); process.exit(1); });
