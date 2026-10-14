// Verification for 德州撲克 (texas-holdem).
// (1) Node match series: strongest AI level (高手桌) vs weakest (新手桌), heads-up freeze-outs (2,000 each, blinds up every
//     10 hands) using the game's own core (CORE markers), same personality on both sides, seats alternate, games run in
//     parallel child processes. Prints win rate with a 95% Wilson interval and measured think times.
// (2) A bot plays one complete 6-max game against the page's AI in Chromium using real CDP touch input at human pace
//     (>=150 ms between actions), recording demo/game.mp4 (+ game-4x.mp4) and demo/game-result.png.
// Usage: node verify.js [--games N] [--par P] [--strong L] [--weak L] [--level L] [--skip-match] [--skip-browser]
const fs = require('fs'), path = require('path'), { execFileSync, fork } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const HE = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return HE;')();
const args = process.argv.slice(2), argv = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

function playMatch(g, sl, wl, fixed) {
  const pl = [{ name: 'S', lv: sl, pers: 4 }, { name: 'W', lv: wl, pers: 4 }];
  if (g % 2) pl.reverse();
  const T = HE.newTable({ seed: 1000 + (g >> 1) * 7919, players: pl, chips: 2000, fixed });
  const times = { s: [], w: [] }; let k = 0;
  while (!T.over) {
    HE.startHand(T);
    while (!T.done) { const i = T.toAct, p = T.p[i]; const d = HE.decide(HE.view(T, i), { lv: p.lv, pers: p.pers, seed: g * 100000 + k++ }); times[p.name === 'S' ? 's' : 'w'].push(d.ms); HE.act(T, i, d.a, d.to); }
  }
  return { win: T.p.find(p => p.name === 'S').place === 1, hands: T.hand, times };
}
if (process.env.HOLDEM_CHILD) { process.on('message', j => { const out = j.games.map(g => playMatch(g, j.s, j.w, j.fixed)); process.send(out); }); return; }

async function series(n, par, sl, wl, fixed) {
  const chunks = []; for (let p = 0; p < par; p++) chunks.push([]);
  for (let g = 0; g < n; g++) chunks[g % par].push(g);
  const t0 = Date.now();
  const res = (await Promise.all(chunks.map(games => new Promise(done => {
    const ch = fork(__filename, [], { env: Object.assign({}, process.env, { HOLDEM_CHILD: '1' }) });
    ch.on('message', r => { ch.kill(); done(r); }); ch.send({ games, s: sl, w: wl, fixed });
  })))).flat();
  const w = res.filter(r => r.win).length, p = w / n, z = 1.96, den = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  const all = k => res.flatMap(r => r.times[k]), st = a => 'avg ' + (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) + 'ms, max ' + Math.max(...a) + 'ms over ' + a.length + ' decisions';
  console.log(`MATCH ${HE.LV[sl].n} vs ${HE.LV[wl].n} (${fixed ? 'fixed blinds' : 'blinds up every 10 hands'}), heads-up freeze-outs: ${w}/${n} wins = ${(p * 100).toFixed(1)}% (95% CI ${((c - h) * 100).toFixed(1)}–${((c + h) * 100).toFixed(1)}%), avg ${(res.reduce((a, r) => a + r.hands, 0) / n).toFixed(1)} hands/game, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  think ${HE.LV[sl].n}: ${st(all('s'))} | ${HE.LV[wl].n}: ${st(all('w'))}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function browserGame(level) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(require('os').tmpdir(), 'holdem-vid-' + process.pid); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => window.__holdem.setFast(true));
  await sleep(900);
  await tapSel(cdp, page, '#segLv button[data-v="' + level + '"]'); await sleep(300);
  await tapSel(cdp, page, '#mStart'); await sleep(600);
  const t0 = Date.now(); let acts = 0, k = 0; const counts = {};
  const thinks = [];
  for (let step = 0; step < 20000; step++) {
    const inf = await page.evaluate(() => window.__holdem.info());
    if (inf.result) break;
    if (!inf.myTurn || !inf.view) { await sleep(150); continue; }
    await sleep(250); // human reaction time
    const d = HE.decide(inf.view, { lv: 2, pers: 4, seed: 777 + k++ });
    counts[d.a] = (counts[d.a] || 0) + 1;
    if (d.a === 'fold') { await tapSel(cdp, page, '#bFold'); await sleep(250); if ((await page.evaluate(() => window.__holdem.info())).foldAsk) await tapSel(cdp, page, '#fCheck'); }
    else if (d.a === 'check' || d.a === 'call') await tapSel(cdp, page, '#bCall');
    else {
      await tapSel(cdp, page, '#bRaise'); await sleep(250);
      const v = inf.view, opts = [['min', v.minTo]].concat([['.5', .5], ['.75', .75], ['1', 1]].map(([f, x]) => [f, v.cur + (v.pot + v.toCall) * x]), [['all', v.maxTo]]);
      let best = opts[0]; for (const o of opts) if (Math.abs(o[1] - d.to) < Math.abs(best[1] - d.to)) best = o;
      if (best[0] !== 'min') { await tapSel(cdp, page, '#raise [data-f="' + best[0] + '"]'); await sleep(200); }
      await tapSel(cdp, page, '#rGo'); await sleep(250);
      const r = (await page.evaluate(() => window.__holdem.info()));
      if (r.raise && r.raise.armed) await tapSel(cdp, page, '#rGo');
    }
    acts++;
    await sleep(200);
  }
  const final = await page.evaluate(() => window.__holdem.info());
  await sleep(2200);
  const title = (await page.isVisible('#ovResult')) ? (await page.textContent('#rT')) + ' ' + (await page.textContent('#rPlace')) : '(no result screen)';
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = Math.round((Date.now() - t0) / 1000);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), fast = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-r', '25', '-movflags', '+faststart', mp4]);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/4', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-r', '25', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const kb = f => Math.round(fs.statSync(f).size / 1024);
  const th = final.thinks || [];
  console.log(`BROWSER GAME vs page AI (${HE.LV[level].n}): result "${title}", ${final.hand} hands, bot made ${acts} touch decisions ${JSON.stringify(counts)}, ${secs}s real time`);
  console.log(`  page AI think in worker (last ${th.length}): avg ${(th.reduce((a, b) => a + b, 0) / Math.max(1, th.length)).toFixed(1)}ms, max ${Math.max(0, ...th)}ms`);
  console.log(`  video game.mp4 ${kb(mp4)}KB, game-4x.mp4 ${kb(fast)}KB; console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}
(async () => {
  if (!args.includes('--skip-match')) {
    const n = +(argv('--games') || 1000), par = +(argv('--par') || 3);
    await series(n, par, +(argv('--strong') || 2), +(argv('--weak') || 0), false);
    if (args.includes('--all')) { await series(n, par, 2, 1, false); await series(n, par, 1, 0, false); }
  }
  if (!args.includes('--skip-browser')) await browserGame(+(argv('--level') || 0));
})();
