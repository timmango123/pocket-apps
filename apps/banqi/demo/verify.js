// Verification for 象棋暗棋 (banqi).
// (1) Node match series: strongest AI (Lv5 暗棋王) vs weakest (Lv1 夜市阿伯), using the game's own core (CORE markers),
//     games run in parallel child processes; alternating who flips first. Prints score + think times.
// (2) A bot plays one complete game against the page's AI in Chromium using real CDP touch input at human pace
//     (>=150 ms between actions), recording demo/game.mp4 (+ a sped-up copy) and demo/game-result.png.
// Usage: node verify.js [--games N] [--par P] [--level L] [--skip-match] [--skip-browser]
const fs = require('fs'), path = require('path'), { execFileSync, fork } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const BQ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BQ;')();
const args = process.argv.slice(2), argv = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

function playMatch(seed, strongIsP0, first, strongLv, weakLv) {
  const g = new BQ.Game({ seed, v: { longChase: true }, first });
  const times = { strong: [], weak: [] }; let ply = 0;
  while (!g.result && ply < 800) {
    const p = g.player(), strong = (p === 0) === strongIsP0, lv = strong ? strongLv : weakLv;
    const o = Object.assign({}, BQ.LEVELS[lv], { seed: seed * 1000 + ply, rep: g.repKeys(), forbid: g.forbidden() });
    const r = BQ.think(g.publicState(), o);
    times[strong ? 'strong' : 'weak'].push(r.ms);
    if (!g.play(r.move)) throw new Error('illegal move from engine');
    ply++;
  }
  let w = 'draw';
  if (g.result && !g.result.draw) { const wp = g.pcol.indexOf(g.result.winner); w = ((wp === 0) === strongIsP0) ? 'strong' : 'weak'; }
  return { seed, w, plies: ply, reason: g.result ? g.result.reason : 'cap', times };
}
if (process.env.BANQI_CHILD) {
  process.on('message', job => { const r = playMatch(job.seed, job.strongIsP0, job.first, job.s, job.w); process.send(r); });
  return;
}
async function series(n, par, strongLv, weakLv) {
  const jobs = []; for (let i = 0; i < n; i++) jobs.push({ seed: 1000 + i * 7919, strongIsP0: i % 2 === 0, first: (i >> 1) % 2, s: strongLv, w: weakLv });
  const res = []; let next = 0;
  await new Promise(done => {
    let live = 0;
    const spawn = () => {
      if (next >= jobs.length) { if (!live) done(); return; }
      const job = jobs[next++]; live++;
      const ch = fork(__filename, [], { env: Object.assign({}, process.env, { BANQI_CHILD: '1' }) });
      ch.on('message', r => { res.push(r); console.log('  game seed', r.seed, '->', r.w, '(' + r.reason + ', ' + r.plies + ' plies)'); ch.kill(); live--; spawn(); });
      ch.send(job);
    };
    for (let i = 0; i < par; i++) spawn();
  });
  const sc = { strong: 0, weak: 0, draw: 0 }, ts = [], tw = [];
  res.forEach(r => { sc[r.w]++; ts.push(...r.times.strong); tw.push(...r.times.weak); });
  const st = a => 'avg ' + Math.round(a.reduce((x, y) => x + y, 0) / a.length) + 'ms, max ' + Math.max(...a) + 'ms over ' + a.length + ' moves';
  console.log('MATCH Lv' + strongLv + ' ' + BQ.LEVELS[strongLv].name + ' vs Lv' + weakLv + ' ' + BQ.LEVELS[weakLv].name + ': ' + sc.strong + ' wins, ' + sc.weak + ' losses, ' + sc.draw + ' draws');
  console.log('  think Lv' + strongLv + ': ' + st(ts) + ' | Lv' + weakLv + ': ' + st(tw));
  return sc;
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
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#segMode button[data-v="ai"]'); await sleep(300);
  await tapSel(cdp, page, '#lvBtns button[data-l="' + level + '"]'); await sleep(300);
  await tapSel(cdp, page, '#segFirst button[data-v="me"]'); await sleep(300);
  await tapSel(cdp, page, '#bStart'); await sleep(600);
  const t0 = Date.now(); let botMoves = 0, aiThinks = [];
  for (let step = 0; step < 1200; step++) {
    const inf = await page.evaluate(() => window.__banqi.info());
    if (inf.result) break;
    if (!inf.human || inf.busy) {
      const lt = await page.evaluate(() => window.__banqi.lastThink());
      if (lt && (!aiThinks.length || JSON.stringify(aiThinks[aiThinks.length - 1]) !== JSON.stringify(lt))) aiThinks.push(lt);
      await sleep(120); continue;
    }
    await sleep(250); // human reaction time
    const r = BQ.think(inf.st, { depth: 5, ms: 1200, fk: 6, seed: step, rep: inf.rep, forbid: inf.forbid });
    const m = r.move, k = m >> 10, f = m & 31, t = (m >> 5) & 31;
    const c1 = await page.evaluate(s => window.__banqi.center(s), f);
    if (k === BQ.END) { await tapSel(cdp, page, '#endChain'); }
    else {
      await touch(cdp, c1.x, c1.y);
      if (k !== BQ.FLIP) { await sleep(220); const c2 = await page.evaluate(s => window.__banqi.center(s), t); await touch(cdp, c2.x, c2.y); }
    }
    botMoves++;
    await sleep(200);
  }
  const final = await page.evaluate(() => window.__banqi.info());
  await sleep(2600);
  const resultVisible = await page.isVisible('#result');
  const title = resultVisible ? await page.textContent('#rTitle') : '(no result screen)';
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = Math.round((Date.now() - t0) / 1000);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  const fast = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/4', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const kb = f => Math.round(fs.statSync(f).size / 1024);
  console.log('BROWSER GAME vs page AI Lv' + level + ': result "' + title + '" (' + JSON.stringify(final.result) + '), ' + final.plies + ' plies, bot made ' + botMoves + ' touch moves, ' + secs + 's real time');
  console.log('  page AI think (incl. worker round trip): ' + aiThinks.map(x => x.ms).join(','));
  console.log('  video game.mp4 ' + kb(mp4) + 'KB, game-4x.mp4 ' + kb(fast) + 'KB; console errors: ' + (errors.length ? errors.join(' | ') : 'none'));
}

(async () => {
  if (!args.includes('--skip-match')) await series(+(argv('--games') || 10), +(argv('--par') || 4), 5, 1);
  if (!args.includes('--skip-browser')) await browserGame(+(argv('--level') || 2));
})();
