// Verification for 西洋棋 (apps/chess). Uses the game's own engine, extracted from index.html between CORE markers.
// 1) perft on the standard positions (start, Kiwipete, positions 3-6) vs published values.
// 2) all 100 puzzles: legal position, side to move, forced mate within N proven exhaustively (every defender reply covered),
//    no shorter mate, unique first move, difficulty recomputed and strictly increasing; proof-tree sizes for 50/75/99/100.
// 3) bot: clears levels 50, 75, 99, 100 in the real page with CDP touch taps at human pace, recording mp4 + result png.
// Usage: node verify.js [--solve-only] [--no-solve] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const mk = () => new Function(coreSrc + '\nreturn {setFen,getFen,perft,legalMoves,make,unmake,inCheck,attacked,moveUci,san,mateAtt,mateDef,mateKeys,bestDefence,handleMsg,clearM:function(){mCache.clear();mNodes=0;},nodesM:function(){return mNodes;},bd:bd,side:function(){return side;},kingSq:kingSq,F_CAS:F_CAS,F_EP:F_EP};')();
const C = mk();
const PUZ = JSON.parse(html.match(/var PUZZLES = (\[[\s\S]*?\n\]);/)[1]);
const args = process.argv.slice(2);

function perftAll() {
  const T = [['start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
    ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
    ['pos3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
    ['pos4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
    ['pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
    ['pos6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890, 3894594]]];
  let all = true;
  for (const [name, fen, exp] of T) {
    C.setFen(fen); const got = exp.map((_, i) => C.perft(i + 1)); const ok = got.join() === exp.join(); all = all && ok;
    console.log('perft', name.padEnd(8), ok ? 'OK ' : 'FAIL', got.join(', '));
  }
  console.log('perft: all standard positions match:', all);
  return all;
}
const VAL = [0, 1, 3, 3, 5, 9, 100];
function legalPosition(fen) {
  const b = fen.split(' ')[0]; let n = 0; const cnt = {};
  for (const c of b) if (/[a-z]/i.test(c)) { n++; cnt[c] = (cnt[c] || 0) + 1; }
  if (cnt.k !== 1 || cnt.K !== 1) return 'kings';
  if (/[pP]/.test(b.split('/')[0]) || /[pP]/.test(b.split('/')[7])) return 'pawn on back rank';
  if (n < 4 || n > 12) return 'piece count ' + n;
  C.setFen(fen); const s = C.side();
  if (C.attacked(C.kingSq[s ^ 1], s)) return 'side not to move is in check';
  return '';
}
function proofSize(n) { // minimal proof tree: one winning attacker move per attacker node, every defender reply
  let best = null;
  for (let d = 1; d <= n && !best; d++) { const ks = C.mateKeys(d); if (ks.length) best = [ks[0], d]; }
  C.make(best[0]); let size = 1;
  const L = C.legalMoves();
  if (L.length) for (const r of L) { C.make(r); size += 1 + proofSize(best[1] - 1); C.unmake(); }
  C.unmake(); return size;
}
function solveAll() {
  let ok = true, prev = -1; const t0 = Date.now(); const counts = {};
  for (let i = 0; i < PUZ.length; i++) {
    const [fen, N, diff, theme, key] = PUZ[i], n = i + 1, t1 = Date.now();
    const bad = legalPosition(fen); C.setFen(fen); C.clearM();
    const shorter = N > 1 && C.mateAtt(N - 1), mate = C.mateAtt(N);
    C.setFen(fen); const keys = C.mateKeys(N).map(C.moveUci);
    // metric (spec formula) from the proven main line with best defence
    C.setFen(fen); const L = C.legalMoves(); const km = L.find(m => C.moveUci(m) === keys[0]);
    let metric = null, line = [], themes = {};
    if (km) {
      const fr = km & 127, to = (km >> 7) & 127, pc = C.bd[fr] & 7, cap = C.bd[to] & 7;
      C.make(km); const chk = C.inCheck(); const sac = C.attacked(to, C.side()) && VAL[pc] > VAL[cap] + 1 && pc !== 6; C.unmake();
      const s0 = C.side(); let left = N; const defCounts = []; let attSum = 0;
      for (let ply = 0; ply < 2 * N; ply++) {
        let m;
        if (C.side() === s0) { attSum += C.legalMoves().length; m = ply === 0 ? km : C.mateKeys(left)[0]; left--; if (m & C.F_CAS) themes.castle = 1; if (m & C.F_EP) themes.ep = 1; if ((m >> 14) & 7) themes.promo = 1; if ((C.bd[m & 127] & 7) === 5 && C.attacked((m >> 7) & 127, C.side() ^ 1)) themes.qsac = 1; }
        else { defCounts.push(C.legalMoves().length); m = C.bestDefence(left); }
        line.push(C.san(m)); C.make(m);
        if (!C.legalMoves().length) { if ((C.bd[(m >> 7) & 127] & 7) === 2) { const ks = C.kingSq[C.side()]; let sm = true; for (const d of [1, -1, 16, -16, 15, 17, -15, -17]) { const t = ks + d; if (t & 0x88) continue; const p = C.bd[t]; if (!p || (p >> 3) !== C.side()) sm = false; } if (sm) themes.smother = 1; } break; }
      }
      const avg = defCounts.length ? defCounts.reduce((a, b) => a + b, 0) / defCounts.length : 0;
      // attacker candidates are summed over every attacker turn of the main line
      metric = N * 15 + (chk ? 0 : 20) + (sac ? 15 : 0) + attSum * 0.5 + avg * 0.3; if (!chk) themes.quiet = 1;
    }
    const themeOk = !theme || !!themes[theme];
    const good = !bad && mate && !shorter && keys.length === 1 && keys[0] === key && Math.round(+metric.toFixed(2)) === diff && diff > prev && themeOk && C.legalMoves && true;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM', { bad, mate, shorter, keys, key, metric, diff, prev, theme, themeOk }); }
    prev = diff; counts[N] = (counts[N] || 0) + 1;
    if ([1, 15, 30, 40, 50, 55, 70, 75, 85, 99, 100].includes(n) || process.env.VERBOSE)
      console.log('level', String(n).padStart(3), MATE(N), 'diff', diff, theme ? '[' + theme + ']' : '', line.join(' '), '(' + (Date.now() - t1) + 'ms)');
  }
  console.log('puzzles by mate length:', JSON.stringify(counts));
  console.log('All', PUZ.length, 'puzzles: legal, forced mate in exactly N with every defence covered, no shorter mate, unique key, difficulty strictly increasing:', ok, '(' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
  for (const n of [50, 75, 99, 100]) { C.setFen(PUZ[n - 1][0]); C.clearM(); console.log('  level', n, 'full solution tree nodes (every defence, one winning reply each):', proofSize(PUZ[n - 1][1])); }
  return ok;
}
function MATE(n) { return 'mate-in-' + n; }

// ---------- bot ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapXY(cdp, b.x + b.width / 2, b.y + b.height / 2); }
function planLine(n) { // what a solver would play, using the same handler the page uses for defence
  const [fen, N, , , key] = PUZ[n - 1]; const H = mk(); const moves = []; let k = 0;
  while (k < N) {
    const hint = H.handleMsg({ id: 1, cmd: 'pz', op: 'hint', fen, moves: moves.slice(), left: N - k, key });
    moves.push(hint.move); k++;
    const r = H.handleMsg({ id: 2, cmd: 'pz', op: 'check', fen, moves: moves.slice(), left: N - k, reset: k === 1, key });
    if (r.mate) break; if (!r.ok) throw new Error('plan failed at level ' + n);
    moves.push(r.reply);
  }
  return moves;
}
async function playLevel(browser, n) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const plan = planLine(n), H = mk();
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); const cdp = await ctx.newCDPSession(page); await sleep(800);
  await tapSel(cdp, page, '#tPuzzle'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(500);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(900);
  if (await page.isVisible('#intro')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(500); }
  const t0 = Date.now(); let my = 0;
  const [fen0, N] = PUZ[n - 1];
  for (let step = 0; step < plan.length; step += 2) {
    // wait until it is our turn and the board is idle
    for (let k = 0; k < 600; k++) { const st = await page.evaluate(() => window.__game.state()); if (!st.busy && !st.anim && st.side === st.attacker && !st.over) break; await sleep(50); }
    await sleep(350 + Math.floor(Math.random() * 250)); // human reaction
    const st = await page.evaluate(() => window.__game.state());
    H.setFen(fen0); for (const u of plan.slice(0, step)) H.make(H.legalMoves().find(m => H.moveUci(m) === u));
    let mv = plan[step];
    if (H.getFen() !== st.fen) { const h = mk().handleMsg({ id: 3, cmd: 'pz', op: 'hint', fen: st.fen, moves: [], left: N - st.k }); mv = h.move; console.log('  (re-planned at step', step, ')'); }
    const a = await page.evaluate(s => window.__game.sqCenter(s), mv.slice(0, 2)), b = await page.evaluate(s => window.__game.sqCenter(s), mv.slice(2, 4));
    await tapXY(cdp, a.x, a.y); await sleep(260 + Math.floor(Math.random() * 120)); await tapXY(cdp, b.x, b.y); my++;
    if (mv.length > 4) { await sleep(500); const idx = 'qrbn'.indexOf(mv[4]); const bb = await page.locator('#promoRow button').nth(idx).boundingBox(); await tapXY(cdp, bb.x + bb.width / 2, bb.y + bb.height / 2); }
    await sleep(200);
  }
  for (let k = 0; k < 100; k++) { if (await page.isVisible('#result')) break; await sleep(100); }
  await sleep(1500);
  const st = await page.evaluate(() => window.__game.state());
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 8e6) { const fast = path.join(OUT, 'level-' + n + '-2x.mp4'); execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-crf', '32', fast]); fs.unlinkSync(mp4); mp4 = fast; }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: !!(st.over && st.over.win) && /將死/.test(st.result), myMoves: my, N, line: st.moves.join(' '), secs, errors, mp4: path.basename(mp4), kb: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  if (!args.includes('--no-solve')) { perftAll(); solveAll(); }
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number), targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', '(' + r.myMoves + ' moves, mate-in-' + r.N + ')', r.line, 'time', r.secs + 's', r.mp4, r.kb + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
