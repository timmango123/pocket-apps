// In-browser auto-player for 菇菇守城 (tower-defense).
// The build plan comes from the game's own core (extracted between CORE-START/CORE-END) and the same greedy + local-search
// bot as demo/simulate.js. The plan is then played on the REAL page in Chromium with real touch input
// (CDP Input.dispatchTouchEvent): tap a moss cell -> tap a tower in the radial menu (or tap a tower -> tap 升級 -> tap the
// tower again to close), at human pace (>= 200 ms between taps), then tap 下一波 and the speed button (3x) for the wave,
// and back to 1x for the next build phase. Records level-NN.mp4 (sped up when long) + level-NN-result.png.
// Usage: node verify.js [levels...]   (default 50 75 99 100)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const Core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn Core;')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PACE = 220;

async function touch(cdp, x, y){
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x, y}]});
  await sleep(50);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
}
async function tapSel(cdp, page, sel){
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error('no element ' + sel);
  await touch(cdp, b.x + b.width/2, b.y + b.height/2);
}
const st = page => page.evaluate(() => window.__game.state());

async function playLevel(browser, n){
  const L = Core.genAll()[n-1];
  const bot = Core.botSolve(L, 12);
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, {recursive:true});
  const ctx = await browser.newContext({viewport:{width:390, height:844}, deviceScaleFactor:2, hasTouch:true, isMobile:true, recordVideo:{dir:vdir, size:{width:390, height:844}}});
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true'){ await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')){ await sleep(1200); await tapSel(cdp, page, '#iOk'); await sleep(400); }
  const t0 = Date.now(); let taps = 0, late = 0;
  for (let w = 0; ; w++){
    let s = await st(page);
    for (let i = 0; i < 2400 && s.phase === 'wave'; i++){ await sleep(100); s = await st(page); }
    if (s.phase !== 'build') break;
    while ((await st(page)).speed !== 1){ await tapSel(cdp, page, '#bSpeed'); taps++; await sleep(PACE); }
    for (const a of bot.plan[s.wave] || []){
      const p = await page.evaluate(c => window.__game.cellPoint(c), a.c);
      const want = a.a === 'build' ? 'build' : 'tower';
      // never tap a new cell while a menu is open (its buttons could sit over that cell): close it by tapping its own cell
      for (let k = 0; k < 3; k++){ const m0 = await st(page); if (!m0.menu) break; const q = await page.evaluate(c => window.__game.cellPoint(c), m0.menuCell); await touch(cdp, q.x, q.y); taps++; await sleep(PACE); }
      for (let k = 0; k < 4; k++){ await touch(cdp, p.x, p.y); taps++; await sleep(PACE); const m = await st(page); if (m.menu === want && m.menuCell === a.c) break; }
      { const m = await st(page); if (!(m.menu === want && m.menuCell === a.c)){ await page.screenshot({path:path.join(OUT, '_fail-' + n + '.png')}); throw new Error('menu did not open: level ' + n + ' wave ' + s.wave + ' action ' + JSON.stringify(a) + ' state ' + JSON.stringify(m) + ' info ' + JSON.stringify(await page.evaluate(c => window.__game.cell(c), a.c))); } }
      if (a.a === 'build') await tapSel(cdp, page, '.rb[data-t="' + a.t + '"]');
      else { await tapSel(cdp, page, '.rb[data-a="up"]'); await sleep(PACE); taps++; await touch(cdp, p.x, p.y); }
      taps++; await sleep(PACE);
      if ((await st(page)).phase !== 'build') late++;
    }
    for (let k = 0; k < 5 && (await st(page)).phase === 'build'; k++){ await tapSel(cdp, page, '#bNext'); taps++; await sleep(PACE); }
    while ((await st(page)).speed !== 3){ await tapSel(cdp, page, '#bSpeed'); taps++; await sleep(PACE); }
  }
  await sleep(2600);
  const fin = await st(page);
  const winVisible = await page.isVisible('#win');
  await page.screenshot({path:path.join(OUT, 'level-' + n + '-result.png')});
  const secs = (Date.now() - t0)/1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const factor = secs > 240 ? 4 : secs > 100 ? 2 : 1;
  const mp4 = path.join(OUT, 'level-' + n + (factor > 1 ? '-' + factor + 'x' : '') + '.mp4');
  for (const f of fs.readdirSync(OUT)) if (f.startsWith('level-' + n + '.') && f.endsWith('.mp4') || f.startsWith('level-' + n + '-') && f.endsWith('x.mp4')) fs.rmSync(path.join(OUT, f));
  const vf = (factor > 1 ? 'setpts=PTS/' + factor + ',' : '') + 'fps=30';
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', '-an', mp4]);
  fs.rmSync(vdir, {recursive:true, force:true});
  return {n, D:L.D, cleared: fin.phase === 'won' && winVisible, lives: fin.lives, predicted: bot.lives, waves: fin.wave + '/' + fin.nW, towers: fin.towers, kills: fin.kills, taps, late, secs: secs.toFixed(0), mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size/1024), errors};
}

(async () => {
  const lv = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets){
    const r = await playLevel(browser, n);
    console.log('BOT level', n, '(難度 ' + r.D + ')', r.cleared ? 'CLEARED' : 'NOT CLEARED', 'lives', r.lives, '(node sim predicted ' + r.predicted + ')', 'waves', r.waves, 'towers', r.towers, 'kills', r.kills,
      'touch taps', r.taps, 'late actions', r.late, 'real time', r.secs + 's', 'video', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
