// Verification for 抽鬼牌 (old-maid).
// (1) Node match series with the game's own core (CORE markers): one AI seat (rotating) against three of another level,
//     5-round matches. Old Maid is mostly luck, so we report match win rate, joker-loss rate per round and points per round,
//     each with a 95% interval, and run enough games for the interval to be tight.
//     Plus a "habitual human" model (always prefers the right side, takes raised cards 70%) playing against each AI level,
//     which is what the levels are designed to exploit.
// (2) A bot plays one complete match against the page's 高手 AI in Chromium with real CDP touch input at human pace
//     (>=150 ms between actions): slide-to-draw, long-press to raise the joker as bait, drag to reorder, the 洗混 button.
//     Records demo/game.mp4 (+ sped-up copy) and demo/game-result.png.
// Usage: node verify.js [--games N] [--skip-match] [--skip-browser]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const OM = new Function(fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return OM;')();
const args = process.argv.slice(2), argv = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const N = OM.LEVELS.map(l => l.name);
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = x => (x * 100).toFixed(1) + '%';
function series(n, sLv, wLv) {
  let wins = 0, ties = 0, rounds = 0, jl = 0, pts = 0, wpts = 0, sq = 0; const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const seat = i % 4, M = OM.newMatch(OM.hash('series', sLv, wLv, i), {}, 5), lv = [0, 1, 2, 3].map(p => p === seat ? sLv : wLv);
    while (!M.over) { const S = OM.simRound(M, lv), pt = OM.points(S)[seat]; rounds++; pts += pt; sq += pt * pt; wpts += (6 - pt) / 3; if (S.losers.includes(seat)) jl++; }
    if (M.winners.includes(seat)) { wins++; if (M.winners.length > 1) ties++; }
  }
  const [lo, hi] = wilson(wins, n), [jlo, jhi] = wilson(jl, rounds), mp = pts / rounds, sd = Math.sqrt(sq / rounds - mp * mp), se = 1.96 * sd / Math.sqrt(rounds);
  console.log(`MATCH ${N[sLv]} (1 seat, rotating) vs 3× ${N[wLv]}: ${n} matches × 5 rounds = ${rounds} rounds, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  match wins ${wins}/${n} = ${pct(wins / n)} (95% CI ${pct(lo)}–${pct(hi)}; shared titles count as wins, so the fair reference is the 新手 vs 新手 line; ${ties} were shared)`);
  console.log(`  holds the joker at the end: ${pct(jl / rounds)} of rounds (95% CI ${pct(jlo)}–${pct(jhi)}; fair 25%)`);
  console.log(`  points per round: ${mp.toFixed(3)} ± ${se.toFixed(3)}  vs  opponents ${(wpts / rounds).toFixed(3)} (fair 1.5)`);
}
// a habitual human: likes the right end, takes raised cards 70% of the time, never arranges or raises
const human = { arrange: m => ({ order: m.hand.slice(), raised: -1, how: 'human' }),
  pick: m => { const r = OM.rng(m.seed); if (m.ri >= 0 && r() < 0.7) return { idx: m.ri }; let i = r() < 0.6 ? m.n - 1 - ((r() * Math.max(1, m.n / 5)) | 0) : (r() * m.n) | 0; if (i === m.ri) i = (i + 1) % m.n; return { idx: Math.max(0, i) }; } };
function humanSeries(n, lv) {
  let rounds = 0, jl = 0, drewJ = 0, opp = 0;
  for (let i = 0; i < n; i++) {
    const M = OM.newMatch(OM.hash('human', lv, i), {}, 5), L = [human, lv, lv, lv];
    while (!M.over) {
      const S = OM.startRound(M); let steps = 0;
      while (!S.over) {
        if (++steps > 4000) throw new Error('stuck');
        const p = S.turn, t = OM.nextActive(S, p), sd = OM.hash(S.seed, 'd', S.n);
        const am = { hand: S.hands[t], lvl: L[t], seed: sd ^ 0x51, prof: M.prof[p] }, A = t === 0 ? human.arrange(am) : OM.arrange(am);
        S.hands[t] = A.order; S.raised[t] = A.raised;
        const pm = { n: S.hands[t].length, ri: A.raised >= 0 ? S.hands[t].indexOf(A.raised) : -1, lvl: L[p], seed: sd ^ 0xa7, own: M.prof[p], hp: M.prof[t], mem: M.mem[p][t] };
        const K = p === 0 ? human.pick(pm) : OM.pick(pm);
        if (p === 0 && S.hands[t].includes(52)) opp++;
        const ev = OM.draw(S, K.idx); OM.observe(M, ev);
        if (p === 0 && OM.isJ(ev.card)) drewJ++;
      }
      OM.finishRound(M, S); rounds++; if (S.losers.includes(0)) jl++;
    }
  }
  const [lo, hi] = wilson(jl, rounds), [dlo, dhi] = wilson(drewJ, opp);
  console.log(`  vs 3× ${N[lv]}: habitual player draws the joker on ${pct(drewJ / opp)} of chances (95% CI ${pct(dlo)}–${pct(dhi)}), ends holding it in ${pct(jl / rounds)} of ${rounds} rounds (CI ${pct(lo)}–${pct(hi)})`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserGame() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} window.__seed = 20261014; });
  const cdp = await ctx.newCDPSession(page);
  let lastAct = 0; const gaps = [];
  const mark = () => { const now = Date.now(); if (lastAct) gaps.push(now - lastAct); lastAct = now; };
  const ts = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  async function tap(x, y) { mark(); await ts('touchStart', x, y); await sleep(80); await ts('touchEnd'); await sleep(170); }
  async function tapSel(sel) { const b = await page.locator(sel).boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); }
  async function slide(x0, y0, x1, y1) { mark(); await ts('touchStart', x0, y0); for (let i = 1; i <= 8; i++) { await sleep(40); await ts('touchMove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); } await sleep(220); await ts('touchEnd'); await sleep(160); }
  async function longPress(x, y) { mark(); await ts('touchStart', x, y); await sleep(650); await ts('touchEnd'); await sleep(200); }
  await sleep(1000);
  await tapSel('#segLv button[data-v="2"]'); await tapSel('#segRounds button[data-v="3"]');
  await tapSel('#bSet'); await tapSel('#segSpeed button[data-v="1.8"]'); await tapSel('#bSetBack');
  await tapSel('#bStart');
  const t0 = Date.now(); let draws = 0, slides = 0, baits = 0, drags = 0, shuffles = 0, rounds = 0, raisedFor = -1, step = 0;
  const rnd = OM.rng(99);
  for (; step < 30000; step++) {
    const inf = await page.evaluate(() => window.__om.info());
    if (inf.ov.includes('ovEnd')) break;
    if (inf.ov.includes('ovRound')) { await sleep(2600); await tapSel('#bNext'); rounds++; await sleep(400); continue; }
    if (inf.phase === 'pick') {
      await sleep(250 + rnd() * 300);
      const n = inf.n, target = (rnd() * n) | 0, start = Math.max(0, Math.min(n - 1, target + (rnd() < 0.5 ? -2 : 2)));
      const a = await page.evaluate(i => window.__om.fanPt(i), start), b = await page.evaluate(i => window.__om.fanPt(i), target);
      await slide(a.x, a.y + 6, b.x, b.y + 6); slides++; draws++;
      await sleep(300); continue;
    }
    if ((inf.phase === 'idle' || inf.phase === 'ai') && inf.hand >= 2) {
      const hand = await page.evaluate(() => window.__om.hand());
      const j = hand.indexOf(52);
      if (j >= 0 && inf.raised !== 52 && raisedFor !== draws) {          // bait: raise the joker so the AI sees it
        const p = await page.evaluate(i => window.__om.handPt(i), j); await longPress(p.x, p.y); baits++; raisedFor = draws; continue;
      }
      if (step % 37 === 5 && hand.length >= 3) {                          // drag the leftmost card to the right
        const a = await page.evaluate(() => window.__om.handPt(0)), b = await page.evaluate(n => window.__om.handPt(n - 1), hand.length);
        await slide(a.x - 6, a.y, b.x, b.y); drags++; continue;
      }
      if (step % 53 === 11) { await tapSel('#bShuffle'); shuffles++; continue; }
    }
    if (inf.out && inf.out.includes(0) && !inf.over) { const sk = await page.locator('#bSkip').isVisible(); if (sk && !(await page.evaluate(() => document.getElementById('bSkip').style.background))) { await tapSel('#bSkip'); } }
    await sleep(120);
  }
  await sleep(2500);
  const title = await page.textContent('#eTitle').catch(() => '(none)');
  const ranks = await page.$$eval('#eRank .rk', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const thinks = await page.evaluate(() => window.__om.thinks()), worker = await page.evaluate(() => window.__om.worker()), ovf = await page.evaluate(() => window.__om.overflow());
  const secs = Math.round((Date.now() - t0) / 1000);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), fast = path.join(OUT, 'game-4x.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-r', '25', '-movflags', '+faststart', mp4]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/4', '-an', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  if (fs.statSync(mp4).size > 8 * 1024 * 1024) fs.rmSync(mp4);
  const kb = f => fs.existsSync(f) ? Math.round(fs.statSync(f).size / 1024) + 'KB' : '(removed, >8MB)';
  const ms = thinks.map(t => t.ms).sort((a, b) => a - b), wall = thinks.map(t => t.wall).sort((a, b) => a - b), q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2);
  console.log(`BROWSER MATCH vs page AI (高手, 3 rounds, worker=${worker}): result "${title}" after ${rounds} rounds; ranking ${ranks.join(' | ')}`);
  console.log(`  bot: ${draws} draws by touch slide, ${baits} long-press baits (joker raised), ${drags} drag reorders, ${shuffles} 洗混 taps; min gap between touch actions ${Math.min(...gaps)}ms; ${secs}s real time`);
  console.log(`  AI think in worker: median ${q(ms, 0.5)}ms, p95 ${q(ms, 0.95)}ms, max ${q(ms, 1)}ms; incl. round trip median ${q(wall, 0.5)}ms, max ${q(wall, 1)}ms (${thinks.length} decisions)`);
  console.log(`  horizontal overflow ${ovf}px; video game.mp4 ${kb(mp4)}, game-4x.mp4 ${kb(fast)}; console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}

(async () => {
  if (!args.includes('--skip-match')) {
    const n = +(argv('--games') || 20000);
    series(n, 2, 0); series(n, 0, 2); series(n, 2, 1); series(n, 1, 0); series(n, 0, 0);
    console.log(`HABITUAL PLAYER MODEL (likes the right end 60%, takes raised cards 70%), ${n / 4} matches each:`);
    [0, 1, 2].forEach(l => humanSeries(n / 4, l));
  }
  if (!args.includes('--skip-browser')) await browserGame();
})();
