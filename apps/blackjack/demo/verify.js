// Verification for 二十一點 (blackjack). The dealer has no AI (fixed rules), so instead of an AI-vs-AI
// match series this script:
// 1) Node: plays basic strategy vs the dealer with the game's own core (CORE-START..CORE-END in index.html)
//    for millions of hands per rule set and reports the player's expected return (= minus the house edge)
//    with a 95% confidence interval. Flat 10-point bets, never insurance.
// 2) Chromium: a bot plays one complete 每日挑戰 (50 hands, standard rules) in the real page using real touch
//    input (CDP Input.dispatchTouchEvent) at human pace (>= 150 ms between actions), following the coach's
//    basic-strategy advice, and finishes on the result screen. Recorded to demo/game-4x.mp4 + game-result.png.
// Usage: node verify.js [--sim-only] [--bot-only] [--hands N]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {simulate,RULES};')();
const args = process.argv.slice(2);
const hi = args.indexOf('--hands'), NH = hi >= 0 ? +args[hi + 1] : 0;

function sim() {
  const plan = [['std', 1000000, 'spec check: 1M hands'], ['std', NH || 30000000], ['easy', NH || 20000000], ['strict', NH || 20000000]];
  console.log('Basic strategy vs dealer (flat bet, no insurance). Return per initial bet, 95% CI = mean ± 1.96·sd/√n');
  const out = {};
  for (const [rk, n, note] of plan) {
    const R = C.RULES[rk], t0 = Date.now();
    const r = C.simulate(rk, n, 20261014 + n);
    const ci = 1.96 * r.sd / Math.sqrt(n);
    const desc = `${R.decks}D ${R.h17 ? 'H17' : 'S17'} ${R.das ? 'DAS' : 'noDAS'} ${R.maxH === 2 ? 'split once' : 'split to 4'}${R.rsa ? ' RSA' : ''}${R.sur ? ' late-surrender' : ''}`;
    console.log(`  ${R.name}(${rk}) ${desc.padEnd(42)} n=${n.toLocaleString().padStart(10)}  return ${(r.mean * 100).toFixed(3)}%  ± ${(ci * 100).toFixed(3)}%  [${((r.mean - ci) * 100).toFixed(3)}%, ${((r.mean + ci) * 100).toFixed(3)}%]  sd/hand ${r.sd.toFixed(3)}  ${((Date.now() - t0) / 1000).toFixed(1)}s${note ? '  (' + note + ')' : ''}`);
    out[rk + (note ? '1M' : '')] = { mean: r.mean, ci };
  }
  const s = out.std;
  console.log(`Standard rules: house edge ${(-s.mean * 100).toFixed(2)}% ± ${(s.ci * 100).toFixed(2)}%. Spec says "about −0.5%"; published 6-deck S17 DAS no-surrender tables give ≈ 0.40–0.45%.`);
  console.log(`Ordering easy > std > strict for the player: ${out.easy.mean > s.mean && s.mean > out.strict.mean}`);
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) {
  const bb = await page.locator(sel).first().boundingBox();
  if (!bb) throw new Error('not visible: ' + sel);
  await tap(cdp, bb.x + bb.width * (0.35 + Math.random() * 0.3), bb.y + bb.height * (0.35 + Math.random() * 0.3));
}
const human = () => sleep(170 + Math.floor(Math.random() * 180));

async function bot() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#tDaily'); await sleep(900);
  const st = () => page.evaluate(() => window.__game.state());
  const t0 = Date.now(); let taps = 0, acts = 0, coachMatch = 0, lastPlayed = -1, peak = 1000;
  for (let guard = 0; guard < 4000; guard++) {
    const s = await st();
    if (s.end) break;
    if (s.busy) { await sleep(90); continue; }
    if (s.played !== lastPlayed && (s.phase === 'done' || s.phase === 'bet')) {
      lastPlayed = s.played; peak = Math.max(peak, s.bank);
    }
    if (s.phase === 'bet' || s.phase === 'done') {
      await human();
      if (!s.betAmt) {
        // vary the bet like a player: mostly repeat, sometimes rebuild from chips
        const want = s.played % 10 === 0 || !s.lastBet || s.lastBet > s.bank ? null : 'rep';
        if (want === 'rep') { await tapSel(cdp, page, '#bRep'); taps++; }
        else {
          const plan = s.bank >= 600 ? [100, 25, 25] : s.bank >= 150 ? [25, 25] : s.bank >= 25 ? [10, 10] : [10];
          for (const v of plan) { await tapSel(cdp, page, `.chip[data-v="${v}"]`); taps++; await human(); }
        }
        await human();
        continue;
      }
      await tapSel(cdp, page, '#bDeal'); taps++; await sleep(200); continue;
    }
    if (s.phase === 'ins') { await human(); await tapSel(cdp, page, '#bInsN'); taps++; await sleep(200); continue; }
    if (s.phase === 'play') {
      await sleep(150 + Math.floor(Math.random() * 250)); // think
      const a = s.advice; const before = JSON.stringify(s.hands);
      await tapSel(cdp, page, `#pAct .btn[data-a="${a}"]`); taps++; acts++;
      await sleep(120);
      const s2 = await st();
      if (JSON.stringify(s2.hands) === before && s2.phase === 'play' && !s2.busy) throw new Error('action did not register: ' + a);
      coachMatch++;
      continue;
    }
    await sleep(100);
  }
  await sleep(2200);
  const fin = await st();
  const endVisible = await page.isVisible('#ovEnd');
  const endText = await page.textContent('#ovEnd');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  for (const f of fs.readdirSync(OUT)) if (/^game(-\dx)?\.mp4$/.test(f)) fs.rmSync(path.join(OUT, f));
  const mp4 = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-filter:v', 'setpts=PTS/4,fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '31', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log(`BOT 每日挑戰: ${endVisible && fin.played === 50 ? 'COMPLETED' : 'NOT COMPLETED'}  hands ${fin.played}/50  final points ${fin.bank} (start 1000, peak ${peak})  touch taps ${taps} (player actions ${acts}, all = coach advice)  play time ${secs}s  result screen "${endText.replace(/\s+/g, ' ').trim().slice(0, 80)}"  video game-4x.mp4 ${Math.round(fs.statSync(mp4).size / 1024)}KB  ${errors.length ? 'ERRORS ' + errors.join(' | ') : 'no console errors'}`);
}

(async () => {
  if (!args.includes('--bot-only')) sim();
  if (!args.includes('--sim-only')) await bot();
})();
