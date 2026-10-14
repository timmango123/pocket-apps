// 窯變 2048 (kiln-2048) skill-tier bot. Usage: node bot.js [tiers...] [--classic=N] [--timed=N]
// No test hook in this game: the bot reads the board from the DOM (tile elements' --r0/--c and labels, like a
// player looking at the screen) and acts only through CDP touch swipes on #board and taps on overlay buttons.
const fs = require('fs'), path = require('path');
const { Worker } = require('worker_threads');
const H = require('./harness');
const AI = require('./ai.js');
const APP = path.resolve(__dirname, '../../../apps/kiln-2048/index.html');

const args = process.argv.slice(2);
const tiers = args.filter(a => H.TIERS[a]);
const TIER_LIST = tiers.length ? tiers : H.TIER_IDS;
const argN = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? +a.split('=')[1] : d; };
const CLASSIC_RUNS = { clumsy: 5, casual: 5, skilled: 4, world: 2, superhuman: 2 };
const TIMED_RUNS = argN('timed', 2);
const MOVE_CAP = argN("cap", 2000);
// decision model per tier
const BRAIN = { clumsy: { mode: 'greedy', depth: 1, random: 0.5 }, casual: { mode: 'greedy', depth: 1, random: 0.15 },
  skilled: { mode: 'em', depth: 1, random: 0 }, world: { mode: 'em', depth: 2, random: 0 }, superhuman: { mode: 'em', depth: 3, random: 0 } };

function makeWorker() {
  const w = new Worker(path.join(__dirname, 'ai.js')); let id = 0; const pend = new Map();
  w.on('message', m => { pend.get(m.id)(m); pend.delete(m.id); });
  return { ask: (board, mode, depth) => new Promise(res => { const i = ++id; pend.set(i, res); w.postMessage({ id: i, board, mode, depth }); }), close: () => w.terminate() };
}

async function readBoard(page) {
  return page.evaluate(() => {
    const board = document.getElementById('board');
    const n = +getComputedStyle(board).getPropertyValue('--n') || 4;
    const cells = Array(n * n).fill(0), dy = Array(n * n).fill(false);
    for (const t of board.querySelectorAll('.tile')) {
      if (t.classList.contains('stone')) continue;
      const r = +t.style.getPropertyValue('--r0'), c = +t.style.getPropertyValue('--c'), v = +t.querySelector('b').textContent;
      if (t.classList.contains('dying')) dy[r * n + c] = true; else cells[r * n + c] = v;
    }
    // a merge animation is in flight: the surviving tile still shows the old value for ~115 ms
    for (let i = 0; i < n * n; i++) if (dy[i] && cells[i]) cells[i] *= 2;
    const ov = board.querySelector('.overlay');
    const b = board.getBoundingClientRect();
    return { n, cells, score: +document.getElementById('score').textContent, overlay: ov ? { title: ov.querySelector('h2').textContent, actions: [...ov.querySelectorAll('button')].map(x => x.dataset.a) } : null,
      goal: document.getElementById('goal').textContent, rect: { x: b.left, y: b.top, w: b.width, h: b.height } };
  });
}
const lg = v => v ? Math.round(Math.log2(v)) : 0;
const DIRV = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up right down left
function simMove(cells, dir) { // exact, on value grid (4x4)
  const n = 4, b = cells.slice(); let moved = false;
  for (let i = 0; i < n; i++) {
    const idx = [0, 1, 2, 3].map(k => dir === 3 ? i * 4 + k : dir === 1 ? i * 4 + 3 - k : dir === 0 ? k * 4 + i : (3 - k) * 4 + i);
    const t = idx.map(j => b[j]).filter(v => v), o = [];
    for (let k = 0; k < t.length; k++) { if (t[k + 1] === t[k]) { o.push(t[k] * 2); k++; } else o.push(t[k]); }
    while (o.length < 4) o.push(0);
    idx.forEach((j, k) => { if (b[j] !== o[k]) moved = true; b[j] = o[k]; });
  }
  return { b, moved };
}

async function playRun(P, brain, kind, runNo, log) {
  const page = P.page, paced = kind === 'timed';
  let st = await readBoard(page);
  const t0 = Date.now(); let moves = 0, swipes = 0, mis = 0, dropped = 0, anomalies = [], wins = 0, firstWinMove = null;
  const scale = paced ? 1 : 0; // classic is untimed: human pacing changes nothing, so it is compressed
  for (;;) {
    if (st.overlay) {
      if (st.overlay.actions.includes('go')) { wins++; if (firstWinMove == null) firstWinMove = moves; await H.sleep(paced ? P.reactMs() : 30); await P.tapSelector('#board .overlay button[data-a="go"]'); await H.sleep(80); st = await readBoard(page); continue; }
      break; // game over / time up
    }
    if (!paced && moves >= MOVE_CAP) break;
    if (paced) await H.sleep(P.reactMs() + P.thinkMs(0.35)); else await H.sleep(P.superhuman ? 16 : 20);
    const board = st.cells.map(lg);
    const res = await P.ai.ask(board, brain.mode, brain.depth);
    if (!res.legal.length) { await H.sleep(500); st = await readBoard(page); if (!st.overlay) anomalies.push({ t: 'no-legal-move-but-no-overlay', moves }); if (anomalies.length > 3) break; continue; }
    let dir = res.legal[0]; for (const d of res.legal) if (res.scores[d] > res.scores[dir]) dir = d;
    if (brain.random && P.rng() < brain.random) dir = P.rng.pick(res.legal);
    if (P.mistake()) { dir = P.rng.pick([0, 1, 2, 3].filter(d => d !== dir)); mis++; }
    const cx = st.rect.x + st.rect.w / 2, cy = st.rect.y + st.rect.h / 2, L = 100;
    const [vx, vy] = await P.swipe(cx, cy, DIRV[dir][0] * L, DIRV[dir][1] * L, { steps: paced ? 6 : 3 });
    swipes++;
    const phys = Math.max(Math.abs(vx), Math.abs(vy)) < 24 ? -1 : Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 1 : 3) : (vy > 0 ? 2 : 0);
    const before = st.cells;
    await H.sleep(paced ? 30 : 15);
    st = await readBoard(page);
    // verify the board reflects exactly one move in the physical swipe direction plus one spawn
    if (st.overlay && kind === 'timed') { /* time ran out during this swipe */ }
    else if (st.n !== 4) { anomalies.push({ t: 'not-4x4 (wrong mode?)', n: st.n }); break; }
    else if (phys >= 0) {
      const exp = simMove(before, phys);
      const diff = st.cells.map((v, i) => v !== exp.b[i] ? i : -1).filter(i => i >= 0);
      if (!exp.moved) { if (diff.length) anomalies.push({ t: 'board-changed-on-illegal-swipe', moves, phys }); }
      else if (diff.length === 0 && !st.overlay) { dropped++; if (anomalies.length < 20) anomalies.push({ t: 'dropped', moves, phys }); }
      else if (!(diff.length === 1 && exp.b[diff[0]] === 0 && (st.cells[diff[0]] === 2 || st.cells[diff[0]] === 4))) { if (anomalies.length < 20) anomalies.push({ t: 'unexpected-board', moves, phys, before, after: st.cells }); }
      else moves++;
    }
  }
  const top = Math.max(...st.cells);
  const r = { tier: P.tierId, kind, run: runNo, score: st.score, topTile: top, moves, swipes, misSwipes: mis, dropped, wins, firstWinAtMove: firstWinMove,
    end: st.overlay ? st.overlay.title : (moves >= MOVE_CAP ? 'move-cap' : 'stopped'), ms: Date.now() - t0, anomalies };
  try { fs.appendFileSync(path.join(__dirname, 'partial-runs.jsonl'), JSON.stringify(r) + '\n'); } catch (e) {}
  log(`[${P.tierId}] ${kind}#${runNo} score=${r.score} top=${top} moves=${moves} end=${r.end} drop=${dropped} anom=${anomalies.length} ${(r.ms / 1000).toFixed(0)}s`);
  return r;
}

// menu navigation is not what the tiers measure: retry until the intended mode tab is really selected
async function selectMode(P, id) {
  for (let i = 0; i < 6; i++) {
    const cur = await P.page.evaluate(() => (document.querySelector('#modes [aria-selected="true"]') || {}).dataset?.mode);
    if (cur === id) return;
    if (i) P.menuMisTaps = (P.menuMisTaps || 0) + 1;
    await P.tapSelector(`[data-mode="${id}"]`); await H.sleep(500);
  }
  throw new Error('could not select mode ' + id);
}
async function newGame(P) {
  for (let i = 0; i < 4; i++) {
    await H.sleep(i ? 500 : 900); // let the result card finish appearing, like a player reading it
    const st = await readBoard(P.page);
    if (i && !st.overlay && st.score === 0) return;
    if (st.overlay && st.overlay.actions.includes('new')) await P.tapSelector('#board .overlay button[data-a="new"]');
    else await P.tapSelector('#newGame');
    await H.sleep(300);
    const st2 = await readBoard(P.page);
    if (!st2.overlay && st2.score === 0) return;
    P.newGameRetries = (P.newGameRetries || 0) + 1;
  }
}

async function runTier(browser, tierId, idx, log) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, tierId, 5000 + idx * 7919);
  P.ai = makeWorker();
  await H.sleep(800);
  const brain = BRAIN[tierId];
  const runs = [];
  // timed mode (急火 2 min) with real human pacing
  await selectMode(P, 'timed');
  for (let i = 1; i <= TIMED_RUNS; i++) { if (i > 1) await newGame(P); runs.push(await playRun(P, brain, 'timed', i, log)); }
  // classic 4x4 (pacing compressed)
  await selectMode(P, 'classic');
  for (let i = 1; i <= CLASSIC_RUNS[tierId]; i++) { await newGame(P); runs.push(await playRun(P, brain, 'classic', i, log)); }
  const errors = sess.errors.slice();
  await sess.ctx.close(); P.ai.close();
  const C = runs.filter(r => r.kind === 'classic'), T = runs.filter(r => r.kind === 'timed');
  const tiles = {}; C.forEach(r => { tiles[r.topTile] = (tiles[r.topTile] || 0) + 1; });
  return { brain, runs, errors, stats: { ...P.stats, newGameRetries: P.newGameRetries || 0, menuMisTaps: P.menuMisTaps || 0 }, summary: {
    classic: { score: H.summarize(C.map(r => r.score)), topTileDist: tiles, reached2048: C.filter(r => r.topTile >= 2048).length + '/' + C.length, moves: H.summarize(C.map(r => r.moves)), ends: C.map(r => r.end) },
    timed: { score: H.summarize(T.map(r => r.score)), topTiles: T.map(r => r.topTile), moves: T.map(r => r.moves) },
    droppedSwipes: runs.reduce((a, r) => a + r.dropped, 0), anomalies: runs.reduce((a, r) => a + r.anomalies.length, 0) } };
}

(async () => {
  const browser = await H.launch();
  const out = { game: 'kiln-2048', moveCapClassic: MOVE_CAP, tiers: {} };
  const t0 = Date.now();
  const res = await Promise.all(TIER_LIST.map((t, i) => runTier(browser, t, i, s => console.log(s))));
  TIER_LIST.forEach((t, i) => { out.tiers[t] = res[i]; });
  out.wallMs = Date.now() - t0;
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'raw-results.json'), JSON.stringify(out, null, 1));
  console.log('wall', (out.wallMs / 1000).toFixed(0) + 's');
})().catch(e => { console.error(e); process.exit(1); });
