// Verification for 五子棋 (apps/gomoku). Uses the game's own engine extracted between CORE markers.
// 1) Node match series: strongest AI (專家, level 5) vs weakest (初學, level 1), alternating colours, renju rules, real time budgets.
//    Also measures think times for every level.
// 2) Browser game: a bot plays one complete game against the page's AI (中級) in Chromium with real CDP touch input at human
//    pace (tap = preview, second tap = confirm, >= 250 ms apart), recorded to game.mp4 (+ game-result.png).
// 3) Browser puzzles: the bot clears 殘局 levels 50, 75, 99, 100 with real touch input, recording level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--match-only] [--browser-only] [--no-puzzles] [--games N]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const mk = () => new Function(src + ';return {fivePts,setup,clearBoard,play,unplay,B,isFive,isForbidden,winLine,aiThink,tsFind,get STONES(){return STONES},get NN(){return NN}};')();
const C = mk();
const args = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nm = p => String.fromCharCode(97 + p % 15) + (15 - Math.floor(p / 15));

function playGame(lvB, lvW, rule, times) {
  C.setup(15, rule); let c = 1; const mv = [];
  C.play(112, 1); mv.push(112); c = 2; // 天元 opening as in the game default
  while (C.STONES < C.NN) {
    const lv = c === 1 ? lvB : lvW, r = C.aiThink(c, lv);
    (times[lv] = times[lv] || []).push(r.ms);
    const p = r.move;
    if (p < 0 || C.B[p]) return { winner: 3 - c, reason: 'illegal', plies: mv.length };
    if (rule === 2 && c === 1 && !C.isFive(p, 1) && C.isForbidden(p)) return { winner: 2, reason: 'forbidden', plies: mv.length + 1 };
    C.play(p, c); mv.push(p);
    if (C.winLine(p)) return { winner: c, reason: 'five', plies: mv.length };
    c = 3 - c;
  }
  return { winner: 0, reason: 'draw', plies: mv.length };
}
function matchSeries(games) {
  const times = {}; let s5 = 0, s1 = 0, d = 0; const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const strongBlack = g % 2 === 0; const r = playGame(strongBlack ? 5 : 1, strongBlack ? 1 : 5, 2, times);
    const strongWon = r.winner && ((r.winner === 1) === strongBlack);
    if (!r.winner) d++; else if (strongWon) s5++; else s1++;
    console.log(' game', g + 1, '專家 as', strongBlack ? 'black' : 'white', '->', r.winner ? (strongWon ? '專家 wins' : '初學 wins') : 'draw', '(' + r.reason + ', ' + r.plies + ' plies)');
  }
  console.log('MATCH 專家(L5) vs 初學(L1), renju:', s5 + '-' + s1 + (d ? ' (' + d + ' draws)' : ''), '(' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
  // other levels: one game L4 vs L2 and one L3 vs L3 to sample think times
  playGame(4, 2, 2, times); playGame(3, 3, 2, times);
  const budget = [0, 100, 300, 800, 1500, 3000];
  for (let lv = 1; lv <= 5; lv++) { const t = times[lv] || []; if (!t.length) continue; const avg = t.reduce((a, b) => a + b, 0) / t.length; console.log('think time level', lv, 'budget', budget[lv] + 'ms', 'avg', avg.toFixed(0) + 'ms', 'max', Math.max(...t) + 'ms', 'moves', t.length); }
  return s5 > s1;
}
// 專家 must not miss a VCF: positions are collected from 入門-vs-入門 self-play (free rule) where the side to move faces an
// opponent VCF (opponent has no four yet, side to move has no four / VCF of its own) and at least one defence exists.
// The level-5 move must leave the opponent without any VCF.
function vcfDefence(target) {
  const near = q => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = q % 15 + dx, y = Math.floor(q / 15) + dy; if (x >= 0 && y >= 0 && x < 15 && y < 15 && C.B[y * 15 + x]) return true; } return false; };
  let tested = 0, held = 0, games = 0; const times = [], seenPos = new Set();
  while (tested < target && games < 200) {
    games++; C.setup(15, 0); C.play(112, 1); let c = 2; const hist = [112];
    for (let ply = 0; ply < 60 && tested < target; ply++) {
      const o = 3 - c;
      if (hist.length >= 8 && !C.fivePts(c).length && !C.fivePts(o).length && C.tsFind(c, 12, true, 200000, 0) < 0) {
        const v = C.tsFind(o, 8, true, 200000, 0);
        if (v >= 0 && !seenPos.has(hist.join())) {
          seenPos.add(hist.join());
          const stop = [];
          for (let q = 0; q < 225; q++) { if (C.B[q] || !near(q)) continue; C.play(q, c); if (C.tsFind(o, 12, true, 300000, 0) === -1) stop.push(q); C.unplay(q); }
          if (stop.length) {
            const t = C.aiThink(c, 5); times.push(t.ms); tested++;
            if (stop.includes(t.move)) held++; else console.log('  專家 missed a VCF defence: played', nm(t.move), 'stoppers', stop.map(nm).join(' '));
            break; // one position per game
          }
        }
      }
      const r = C.aiThink(c, 2); if (r.move < 0 || C.B[r.move]) break;
      C.play(r.move, c); hist.push(r.move); if (C.winLine(r.move)) break; c = o;
    }
  }
  console.log('VCF DEFENCE 專家: stopped the opponent VCF in', held + '/' + tested, 'self-play positions (' + games + ' games); think avg', (times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)).toFixed(0) + 'ms max', Math.max(0, ...times) + 'ms');
  return held === tested && tested > 0;
}

/* ---------------- browser ---------------- */
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapXY(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function tapCell(cdp, page, p) { // preview tap, human pause, confirm tap on the same intersection
  const xy = await page.evaluate(q => window.__gomoku.cellXY(q), p);
  await tapXY(cdp, xy.x, xy.y); await sleep(260 + Math.random() * 140);
  await tapXY(cdp, xy.x, xy.y);
}
async function newCtx(browser, vdir) {
  fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); await sleep(700);
  return { ctx, page, errors, cdp: await ctx.newCDPSession(page) };
}
function toMp4(vdir, name, maxSec) {
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm')); const inp = path.join(vdir, webm);
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inp]).toString()) || 0;
  let speed = 1; while (dur / speed > maxSec) speed *= 2;
  const file = path.join(OUT, name + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
  const vf = (speed > 1 ? 'setpts=PTS/' + speed + ',' : '') + 'fps=30';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', inp, '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', '-an', file]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { file: path.basename(file), sec: dur.toFixed(0), KB: Math.round(fs.statSync(file).size / 1024) };
}
async function browserGame(browser) {
  // clear older recordings with a speed suffix
  fs.readdirSync(OUT).filter(f => /^game(-\d+x)?\.mp4$/.test(f)).forEach(f => fs.unlinkSync(path.join(OUT, f)));
  const vdir = path.join(OUT, '_vgame'), { ctx, page, errors, cdp } = await newCtx(browser, vdir);
  await tapSel(cdp, page, '#tAI'); await sleep(500);
  await tapSel(cdp, page, '#segLv button[data-v="3"]'); await sleep(300);
  await tapSel(cdp, page, '#segCol button[data-v="1"]'); await sleep(300);
  await tapSel(cdp, page, '#segRule button[data-v="2"]'); await sleep(300);
  await tapSel(cdp, page, '#segSize button[data-v="15"]'); await sleep(300);
  await tapSel(cdp, page, '#nGo'); await sleep(700);
  const t0 = Date.now(); let my = 0;
  for (let k = 0; k < 400; k++) {
    const st = await page.evaluate(() => window.__gomoku.state());
    if (st.over) break;
    if (st.thinking || st.toMove !== st.human) { await sleep(120); continue; }
    C.setup(st.size, st.rule); st.moves.forEach(m => C.play(m[0], m[1]));
    const r = C.aiThink(st.human, 5, 1200); await sleep(150);
    await tapCell(cdp, page, r.move); my++;
    await sleep(350);
  }
  await sleep(1000); await page.screenshot({ path: path.join(OUT, '_win-frame.png') }); // raw frame for the hub cover (win line glowing)
  await page.waitForSelector('#ovResult:not(.hidden)', { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const st = await page.evaluate(() => window.__gomoku.state()); const log = await page.evaluate(() => window.__gomoku.thinkLog());
  const resVisible = await page.isVisible('#ovResult');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  await ctx.close();
  const v = toMp4(vdir, 'game', 75);
  const ai = log.filter(x => x.ms != null).map(x => x.ms);
  console.log('BROWSER GAME vs page AI 中級 (renju, bot black):', st.result ? (st.result.winner === st.human ? 'bot wins' : st.result.winner ? 'page AI wins' : 'draw') + ' by ' + st.result.reason : 'unfinished',
    '| plies', st.moves.length, '| bot taps', my * 2, '| result screen', resVisible, '| page AI think avg', (ai.reduce((a, b) => a + b, 0) / Math.max(1, ai.length)).toFixed(0) + 'ms max', Math.max(0, ...ai) + 'ms',
    '|', ((Date.now() - t0) / 1000).toFixed(0) + 's | video', v.file, v.sec + 's', v.KB + 'KB |', errors.length ? 'ERRORS ' + errors.join(' | ') : 'no console errors');
  return st.over && resVisible && !errors.length;
}
async function browserPuzzle(browser, n) {
  fs.readdirSync(OUT).filter(f => new RegExp('^level-' + n + '(-\\d+x)?\\.mp4$').test(f)).forEach(f => fs.unlinkSync(path.join(OUT, f)));
  const vdir = path.join(OUT, '_vpz' + n), { ctx, page, errors, cdp } = await newCtx(browser, vdir);
  await tapSel(cdp, page, '#tPz'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(400); }
  const t0 = Date.now(); let moves = 0;
  for (let k = 0; k < 100; k++) {
    const st = await page.evaluate(() => window.__gomoku.state());
    if (st.over) break;
    if (st.thinking || st.toMove !== st.pz.att) { await sleep(120); continue; }
    C.setup(15, st.rule); st.base.concat(st.moves).forEach(m => C.play(m[0], m[1]));
    let mv = -1; for (let q = 1; q <= st.pz.left && mv < 0; q++) mv = C.tsFind(st.pz.att, q, false, 0, 0);
    if (mv < 0) { console.log('  bot found no winning move at level', n); break; }
    await sleep(500); await tapCell(cdp, page, mv); moves++; await sleep(400);
  }
  await page.waitForSelector('#ovPzWin:not(.hidden)', { timeout: 12000 }).catch(() => {});
  await sleep(1200);
  const st = await page.evaluate(() => window.__gomoku.state()), win = await page.isVisible('#ovPzWin');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  await ctx.close();
  const v = toMp4(vdir, 'level-' + n, 60);
  const cleared = st.over && st.result && st.result.winner === st.pz.att && win;
  console.log('BOT level', n, cleared ? 'CLEARED' : 'NOT CLEARED', 'in', moves, 'moves (limit', st.pz.N + ')', ((Date.now() - t0) / 1000).toFixed(0) + 's', 'video', v.file, v.KB + 'KB', errors.length ? 'ERRORS ' + errors.join(' | ') : 'no console errors');
  return cleared && !errors.length;
}

(async () => {
  let ok = true;
  const gi = args.indexOf('--games'), games = gi >= 0 ? +args[gi + 1] : 6;
  if (!args.includes('--browser-only')) { ok = vcfDefence(12) && ok; ok = matchSeries(games) && ok; }
  if (args.includes('--match-only')) process.exit(ok ? 0 : 1);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  ok = (await browserGame(browser)) && ok;
  if (!args.includes('--no-puzzles')) for (const n of [50, 75, 99, 100]) ok = (await browserPuzzle(browser, n)) && ok;
  await browser.close();
  console.log(ok ? 'VERIFY OK' : 'VERIFY FAILED');
  process.exit(ok ? 0 : 1);
})();
