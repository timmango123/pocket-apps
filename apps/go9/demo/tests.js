// Rule unit tests for 九路圍棋. Extracts the engine between the CORE markers of ../index.html (or a given file) and checks
// capture, suicide, simple ko, positional superko, Japanese basic ko + triple-ko no-result, handicap, double pass,
// Chinese area / Japanese territory counting against hand-counted positions, automatic dead-stone marking, SGF.
const fs = require('fs'), path = require('path');
const file = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const src = fs.readFileSync(file, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const GO = new Function(src + ';return GO;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const C = 'ABCDEFGHJKLMN';
function P(g, s) { return g.b.pt(C.indexOf(s[0]), g.size - +s.slice(1)); }
function play(g, list) { list.split(' ').forEach(m => { const p = m === 'pass' ? 0 : P(g, m); const why = g.check(p); if (why) throw new Error('illegal ' + m + ' ' + why); g.play(p); }); return g; }
/* set up a position from rows (top row first): X black, O white, . empty */
function setup(rows, o) {
  const g = new GO.Game(Object.assign({ size: rows.length }, o || {}));
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'X') g.b.place(g.b.pt(x, y), 1); else if (ch === 'O') g.b.place(g.b.pt(x, y), 2); }));
  g.b.caps[1] = g.b.caps[2] = 0; g.b.ko = 0; g.seen = {}; g.seen[g.b.key()] = 1;
  return g;
}

/* ---- move counts ---- */
ok(new GO.Game({ size: 9 }).legalMoves().length === 81, 'empty 9x9 has 81 legal moves');
ok(new GO.Game({ size: 13 }).legalMoves().length === 169, 'empty 13x13 has 169 legal moves');
console.log('legal moves on empty board: 9x9 =', new GO.Game({ size: 9 }).legalMoves().length, ', 13x13 =', new GO.Game({ size: 13 }).legalMoves().length);

/* ---- capture ---- */
{ const g = play(new GO.Game(), 'E5 E6 A1 D5 A2 F5 A3 E4'); ok(g.b.c[P(g, 'E5')] === 0 && g.b.caps[2] === 1, 'centre stone captured by four white stones'); }
{ const g = play(new GO.Game(), 'A1 A2 E5 B1'); ok(g.b.c[P(g, 'A1')] === 0 && g.b.caps[2] === 1, 'corner stone captured with two stones'); }
{ const g = play(new GO.Game(), 'A5 A6 E5 A4 E6 B5'); ok(g.b.c[P(g, 'A5')] === 0, 'edge stone captured with three stones'); }
{ const g = play(new GO.Game(), 'D5 D6 E5 E6 J9 F5 J8 C5 J7 D4 J6 E4'); ok(g.b.c[P(g, 'D5')] === 0 && g.b.c[P(g, 'E5')] === 0 && g.b.caps[2] === 2, 'two-stone group captured'); }
{ /* one move capturing two separate groups */
  const g = setup(['.........', '.........', '.........', '...O.O...', '..OX.XO..', '...O.O...', '.........', '.........', '.........']);
  g.b.toPlay = 2; const cap = g.play(P(g, 'E5')); ok(cap === 2 && g.b.c[P(g, 'D5')] === 0 && g.b.c[P(g, 'F5')] === 0, 'one move captures two groups');
}
{ /* capturing move that would otherwise be suicide is legal */
  const g = setup(['.XO......', 'XO.......', 'O........', '.........', '.........', '.........', '.........', '.........', '.........']);
  g.b.toPlay = 2; ok(g.check(P(g, 'A9')) === '', 'filling own last liberty is legal when it captures'); g.play(P(g, 'A9'));
  ok(g.b.c[P(g, 'B9')] === 0 && g.b.c[P(g, 'A8')] === 0, 'self-atari capture removes the two black stones');
}
/* ---- suicide ---- */
{ const g = play(new GO.Game(), 'B9 pass A8'); ok(g.check(P(g, 'A9')) === 'suicide', 'single-point suicide in the corner is forbidden'); }
{ const h = setup(['.XO......', 'XXO......', 'OO.......', '.........', '.........', '.........', '.........', '.........', '.........']);
  h.b.toPlay = 1; ok(h.check(P(h, 'A9')) === 'suicide', 'multi-stone suicide (black group would be left with no liberties) is forbidden');
  const g = setup(['.X.X.....', 'XXXX.....', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  g.b.toPlay = 1; ok(g.check(P(g, 'A9')) === '', 'filling one of two own eyes is legal (group keeps liberties)');
  ok(g.check(P(g, 'A9'), 2) === 'suicide', 'white may not play into a black eye');
}
/* ---- simple ko ---- */
{ const g = setup(['.........', '.........', '.........', '...XO....', '..X.XO...', '...XO....', '.........', '.........', '.........']);
  g.b.toPlay = 2; g.play(P(g, 'D5'));                         // white captures E5 -> ko
  ok(g.b.c[P(g, 'E5')] === 0 && g.b.ko === P(g, 'E5'), 'ko point recorded after single-stone capture');
  ok(g.check(P(g, 'E5')) === 'ko', 'immediate recapture is forbidden (ko)');
  g.play(P(g, 'A1')); g.play(P(g, 'J9'));
  ok(g.check(P(g, 'E5')) === '', 'recapture allowed after an exchange elsewhere');
  const j = setup(['.........', '.........', '.........', '...XO....', '..X.XO...', '...XO....', '.........', '.........', '.........'], { rules: 'jp' });
  j.b.toPlay = 2; j.play(P(j, 'D5')); ok(j.check(P(j, 'E5')) === 'ko', 'Japanese rules also forbid the immediate recapture');
}
/* ---- positional superko & Japanese triple-ko no-result: search random tiny-board games for a cycle ---- */
{
  let found = null;
  for (let s = 1; s < 4000 && !found; s++) {
    GO.setSeed(s * 7919);
    const g = new GO.Game({ size: 4 }), snaps = [g.b.c.slice()];
    for (let k = 0; k < 120 && !found; k++) {
      const legal = g.legalMoves(); const sk = [];
      for (const p of g.b.pts) { if (!g.b.c[p] && g.b.legal(p, g.b.toPlay) && g.check(p) === 'superko') sk.push(p); }
      if (sk.length) { found = { g, p: sk[0], snaps }; break; }
      if (!legal.length) break;
      g.play(legal[Math.floor(GO.rand() * legal.length)]); snaps.push(g.b.c.slice());
    }
  }
  ok(!!found, 'random search found a positional-superko situation');
  if (found) {
    const { g, p, snaps } = found;
    const t = g.b.clone(); t.place(p, g.b.toPlay);
    const same = snaps.some(s => s.every((v, i) => v === t.c[i]));
    ok(same, 'superko move really recreates an earlier whole-board position (verified by array comparison, not hash)');
    ok(p !== g.b.ko, 'the superko move is not a simple ko recapture');
    const j = GO.Game.replay(Object.assign(g.opts(), { rules: 'jp' }), g.moves);
    ok(j.check(p) === '', 'same move is legal under Japanese rules (basic ko only)');
    console.log('superko example on 4x4 after', g.moves.length, 'moves: move', GO.coord(g.b, p), 'recreates an earlier position');
  }
  /* Japanese: a long cycle repeated three times -> no result */
  let nr = null;
  for (let s = 1; s < 6000 && !nr; s++) {
    GO.setSeed(s * 104729);
    const g = new GO.Game({ size: 4, rules: 'jp' }), keys = [g.b.key() + ':' + g.b.toPlay];
    for (let k = 0; k < 150; k++) {
      const legal = g.legalMoves(); if (!legal.length) break;
      g.play(legal[Math.floor(GO.rand() * legal.length)]);
      const key = g.b.key() + ':' + g.b.toPlay, i0 = keys.indexOf(key); keys.push(key);
      if (i0 >= 0 && g.moves.length - i0 > 2) {
        const cyc = g.moves.slice(i0); let okc = true;
        for (let r = 0; r < 2 && okc && !g.noResult; r++) for (const m of cyc) { if (m && g.check(m)) { okc = false; break; } g.play(m); if (g.noResult) break; }
        if (okc && g.noResult) { nr = { g, len: cyc.length }; }
        break;
      }
    }
  }
  ok(!!nr, 'Japanese rules: repeating a ko cycle three times ends the game with no result (三劫循環無勝負)');
  if (nr) console.log('triple-repetition example: cycle of', nr.len, 'moves repeated -> noResult =', nr.g.noResult);
}
/* ---- incremental group structures vs brute force (fuzz) ---- */
{
  let bad = 0, games = 0;
  for (let s = 1; s <= 60; s++) {
    GO.setSeed(s); const g = new GO.Game({ size: s % 2 ? 9 : 13 }); games++;
    for (let k = 0; k < 160; k++) {
      const legal = g.legalMoves(); if (!legal.length) break; g.play(legal[Math.floor(GO.rand() * legal.length)]);
      const b = g.b;
      for (const p of b.pts) if (b.c[p] === 1 || b.c[p] === 2) {
        const r = b.g[p], libs = b.libCount(r);
        if ((libs === 1) !== b.atari(r) || libs === 0) bad++;
      }
      if (k % 40 === 0) { const t = new GO.Board(b.n); for (const p of b.pts) if (b.c[p]) t.place(p, b.c[p]); if (t.key() !== b.key()) bad++; }
    }
  }
  ok(bad === 0, 'atari detection by pseudo-liberty sums and Zobrist hash agree with brute force over ' + games + ' random games');
}
/* ---- handicap ---- */
{ const g = new GO.Game({ size: 9, handicap: 5 }); const st = ['G7', 'C3', 'G3', 'C7', 'E5'].every(s => g.b.c[P(g, s)] === 1);
  ok(st && g.b.toPlay === 2 && g.komi === 0.5, 'five handicap stones on the star points, white to move, komi 0.5');
  const h = new GO.Game({ size: 9, handicap: 2 }); ok(h.b.c[P(h, 'G7')] === 1 && h.b.c[P(h, 'C3')] === 1 && h.b.c[P(h, 'E5')] === 0, 'two-stone handicap on G7 and C3'); }
/* ---- double pass ---- */
{ const g = play(new GO.Game(), 'E5 pass'); ok(!g.over(), 'single pass does not end'); g.play(0); ok(g.over(), 'two consecutive passes end the game');
  const h = play(new GO.Game(), 'E5 pass D4 pass'); ok(!h.over(), 'non-consecutive passes do not end'); }
/* ---- scoring: 10 hand-counted positions ---- */
const split = (bx, wx) => Array.from({ length: 9 }, () => Array.from({ length: 9 }, (_, x) => x === bx ? 'X' : x === wx ? 'O' : '.').join(''));
const cases = [
  { n: 'walls E/F: black 45 v white 36', rows: split(4, 5), cn: [45, 43.5], jp: [36, 33.5] },
  { n: 'walls D/E: black 36 v white 45', rows: split(3, 4), cn: [36, 52.5], jp: [27, 42.5] },
  { n: 'komi edge: black 44 v white 37 (white wins by 0.5)', rows: ['....XO...', '....XO...', '....XO...', '....XO...', '....XO...', '....XO...', '....XO...', '....XO...', '...XOO...'], cn: [44, 44.5], jp: [35, 33.5] },
  { n: 'one dead stone each side marked', rows: (() => { const r = split(4, 5); r[1] = '.O..XO...'; r[7] = '....XO.X.'; return r; })(), dead: ['B8', 'H2'], cn: [45, 43.5], jp: [37, 34.5] },
  { n: 'one column of dame', rows: split(3, 5), cn: [36, 43.5], jp: [27, 33.5] },
  { n: 'seki in the corner (shared liberties neutral)', rows: ['X.OX.....', 'X.OX.....', 'XXOX.....', 'OOXX.....', '.OX......', '.OX......', '.OX......', '.OX......', '.OX......'], cn: [64, 22.5], jp: [50, 11.5] },
  { n: 'handicap game komi 0.5', rows: split(4, 5), opt: { handicap: 2 }, cn: [45, 36.5], jp: [36, 27.5], nohc: true },
  { n: 'prisoners matter only in territory scoring', rows: split(3, 5), caps: [4, 1], cn: [36, 43.5], jp: [31, 34.5] },
  { n: 'empty board', rows: Array(9).fill('.........'), cn: [0, 7.5], jp: [0, 6.5] },
  { n: 'black wall surrounded by white territory, dead black stones', rows: (() => { const r = split(6, 7); r[4] = '.....XXO.'; r[2] = '...O..XO.'; r[5] = '..X...XO.'; return r; })(), dead: [], cn: null }
];
/* case 10 counted by hand: black stones 11 (column G + F5 + C4), white 10 (column H + D7). D7 is dead inside black's area:
   black area = 54 points of columns A-F (2 stones + 52 empty after removing D7); white = 9 stones + 9 points of column J */
cases[9].dead = ['D7']; cases[9].cn = [11 + 52, 9 + 9 + 7.5]; cases[9].jp = [52 + 1, 9 + 6.5];
let sc = 0;
for (const cs of cases) {
  for (const rules of ['cn', 'jp']) {
    const o = Object.assign({ rules }, cs.opt || {});
    const g = setup(cs.rows, cs.nohc ? { rules, komi: 0.5 } : o);
    if (cs.caps) { g.b.caps[1] = cs.caps[0]; g.b.caps[2] = cs.caps[1]; }
    const dead = (cs.dead || []).map(s => P(g, s));
    const r = GO.finalScore(g, dead, rules), exp = cs[rules];
    const good = Math.abs(r.B - exp[0]) < 1e-9 && Math.abs(r.W - exp[1]) < 1e-9;
    ok(good, 'score ' + rules + ' ' + cs.n + ': got B ' + r.B + ' W ' + r.W + ' expected ' + exp);
    if (good) sc++;
  }
}
console.log('scoring: ' + sc + ' / ' + cases.length * 2 + ' hand-counted results match (' + cases.length + ' positions x Chinese+Japanese)');
{ const g = new GO.Game({ size: 9, handicap: 2 }); ok(g.komi === 0.5, 'handicap komi 0.5 by default'); ok(new GO.Game({ rules: 'jp' }).komi === 6.5 && new GO.Game().komi === 7.5, 'default komi 7.5 Chinese / 6.5 Japanese'); }
/* ---- automatic dead stones by ownership (2,000 playouts) ---- */
{
  /* final position of a real 8級 vs 18級 game: five white stones lower left are dead */
  const g = setup(['.OOOOOOOO', 'OOXXXOXX.', 'XX..XOX.X', '.X.XXOXXX', 'XX..XOOOX', 'X.X.XXXOO', '.XXXXOOXO', 'OOOOXO.XX', '.O..XOOO.']);
  const own = GO.ownership(g, 2000), dead = GO.deadFromOwn(g, own, 0.7).map(p => GO.coord(g.b, p)).sort();
  ok(dead.join(' ') === 'A2 B1 B2 C2 D2', 'ownership (2,000 playouts, >70%) marks exactly the five dead stones: ' + dead.join(' '));
  const s = setup(cases[5].rows); const own2 = GO.ownership(s, 2000), d2 = GO.deadFromOwn(s, own2, 0.7);
  ok(d2.length === 0, 'seki groups are not marked dead (' + d2.length + ')');
}
/* ---- SGF round trip ---- */
{ const g = play(new GO.Game({ handicap: 3 }), 'E5 D4 pass F6'); const t = GO.toSGF(g, 'W+R'); const h = GO.fromSGF(t);
  ok(h.moves.join() === g.moves.join() && h.handicap === 3 && h.komi === g.komi && h.b.key() === g.b.key(), 'SGF export/import round trip'); }
console.log('rule tests:', pass, 'passed,', fail, 'failed');

/* ---- engine: early stop keeps the chosen move; progress callback reports the candidate ---- */
{
  const g = play(new GO.Game({ size: 9 }), 'E5 C3 G7');
  let progs = 0, last = null;
  GO.setSeed(5); GO.resetTree();
  const r = GO.search(g, GO.LEVELS[3], { time: 1200, prog: p => { progs++; last = p; } });
  ok(progs > 0 && last && last.f > 0 && last.f <= 1 && last.m > 0, 'search reports progress with a candidate move (' + progs + ' updates)');
  ok(r.move === r.all[0].m, 'early-stopped search still returns the most visited move');
}

/* ---- browser checks for the release-review fixes (real CDP touch, fake https origin, no network) ---- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const html = fs.readFileSync(file, 'utf8'), ORIGIN = 'https://go9.test';
  const browser = await chromium.launch();
  try { return await browserBody(browser); } finally { await browser.close().catch(() => {}); }
}
async function browserBody(browser) {
  const html = fs.readFileSync(file, 'utf8'), ORIGIN = 'https://go9.test';
  const T0 = Date.now(); let bp = 0, bf = 0;
  const bok = (c, m) => { if (c) bp++; else { bf++; console.log('FAIL', m); } };
  async function open(vp, init, raw) {
    const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const errors = [], external = [];
    await ctx.route('**/*', r => { const u = r.request().url(); if (u === ORIGIN + '/') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); if (u.startsWith('blob:') || u.startsWith('data:')) return r.continue(); external.push(u); return r.abort(); });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /vibrate|Blocked|AudioContext/i.test(m.text()))) errors.push('console: ' + m.text()); });
    page.on('worker', w => w.on('console', m => { if (m.type() === 'error') errors.push('worker: ' + m.text()); }));
    await page.goto(ORIGIN + '/'); if (!raw) await page.waitForFunction(() => window.__go9);
    const cdp = await ctx.newCDPSession(page);
    let tid = 1;
    const s = { ctx, page, cdp, errors, external };
    s.touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    s.tap = async (x, y) => { const id = tid++; await s.touch('touchStart', [{ x, y, id }]); await sleep(40); await s.touch('touchEnd', []); };
    s.tapEl = async sel => { const b = await page.locator(sel).first().boundingBox(); await s.tap(b.x + b.width / 2, b.y + b.height / 2); };
    s.st = () => page.evaluate(() => window.__go9.state());
    s.pt = (x, y) => page.evaluate(([x, y]) => window.__go9.ptClient(x, y), [x, y]);
    s.cell = () => page.evaluate(() => { const a = window.__go9.ptClient(0, 0), b = window.__go9.ptClient(1, 0); return b[0] - a[0]; });
    s.wait = (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 20000, polling: 50 });
    s.seed = (k, v) => page.evaluate(([k, v]) => localStorage.setItem('go9.' + k, JSON.stringify(v)), [k, v]);
    return s;
  }
  const W = 11; const pt = (x, y) => (y + 1) * W + x + 1;     // 9x9 board point index
  /* black wall on column E, white wall on column F: both alive, black wins 45 : 43.5 (Chinese) */
  const walls = []; for (let y = 0; y < 9; y++) walls.push(pt(4, y), pt(5, y)); walls.push(0, 0);
  const O9 = { size: 9, rules: 'cn', handicap: 0, komi: 7.5 };
  const scoringSave = extra => Object.assign({ o: O9, moves: walls, mode: 'ai', ai: 2, level: 1, daily: null, wr: [0.5], low: 0, bigCap: 0, scoring: true }, extra || {});

  /* 1. vibrate before any user tap: the computer moves right after a reload that resumed its turn -> no console error */
  { const s = await open(null, `if (!localStorage.getItem('go9.game')) localStorage.setItem('go9.game', JSON.stringify({ o: ${JSON.stringify(O9)}, moves: [${pt(4, 4)}], mode: 'ai', ai: 2, level: 0, daily: null, wr: [0.5], low: 0, bigCap: 0, scoring: false }));`, true);
    /* poll through raw CDP without a user gesture (Playwright's evaluate would count as one and hide the bug) */
    const t1 = Date.now(); let n = 0, act = null;
    while (Date.now() - t1 < 20000) {
      const r = await s.cdp.send('Runtime.evaluate', { expression: 'JSON.stringify([window.__go9 ? window.__go9.state().moves.length : 0, navigator.userActivation.hasBeenActive])', userGesture: false, returnByValue: true });
      [n, act] = JSON.parse(r.result.value); if (n >= 2) break; await sleep(100);
    }
    await sleep(300);
    bok(n >= 2 && act === false, 'computer moved after the resume reload with no user activation (moves ' + n + ', active ' + act + ')');
    bok(!s.errors.length, 'no console error when the computer moves (with vibrate) before the first tap: ' + s.errors.join(' | '));
    await s.ctx.close(); }

  /* 2. two overlapping fingers (A down, B down, A up, B up) both count, in single-tap mode */
  { const s = await open();
    await s.seed('settings', { mode: 'pvp', confirm: false }); await s.page.reload(); await s.page.waitForFunction(() => window.__go9);
    await s.tapEl('#bStart'); await s.wait(() => window.__go9.state().phase === 'play');
    let placed = 0;
    for (let k = 0; k < 4; k++) {
      const a = await s.pt(1 + k, 2), b = await s.pt(1 + k, 6), n0 = (await s.st()).moves.length;
      await s.touch('touchStart', [{ x: a[0], y: a[1], id: 100 + k * 2 }]); await sleep(30);
      await s.touch('touchStart', [{ x: a[0], y: a[1], id: 100 + k * 2 }, { x: b[0], y: b[1], id: 101 + k * 2 }]); await sleep(30);
      await s.touch('touchEnd', [{ x: b[0], y: b[1], id: 101 + k * 2 }]); await sleep(30);
      await s.touch('touchEnd', []);
      await s.wait(n => window.__go9.state().moves.length >= n + 2, n0, 5000).catch(() => {});
      placed += (await s.st()).moves.length - n0;
    }
    bok(placed === 8, 'two-finger overlap: 8 touches -> ' + placed + ' stones (expected 8)');

    /* 3. forgiving confirm: preview, then a second tap 0.6 grid steps away still places the previewed stone; 落子 button; slide adjusts */
    await s.page.evaluate(() => { localStorage.setItem('go9.settings', JSON.stringify({ mode: 'pvp', confirm: true })); localStorage.removeItem('go9.game'); localStorage.removeItem('go9.tips'); });
    await s.page.reload(); await s.page.waitForFunction(() => window.__go9);
    await s.tapEl('#bStart'); await s.wait(() => window.__go9.state().phase === 'play');
    const c = await s.cell(), p1 = await s.pt(4, 4);
    await s.tap(p1[0], p1[1]); await s.wait(() => window.__go9.state().preview > 0);
    bok(await s.page.evaluate(() => document.getElementById('toast').classList.contains('show') && /再點一次/.test(document.getElementById('toast').textContent)), 'first preview shows the "tap again" tip');
    bok(await s.page.evaluate(() => !document.getElementById('bPlace').hidden && document.getElementById('bResign').hidden), '落子 button replaces 認輸 while a preview stone waits');
    await s.tap(p1[0] + c * 0.45, p1[1] + c * 0.4);
    await s.wait(() => window.__go9.state().moves.length === 1, null, 5000).catch(() => {});
    let st = await s.st();
    bok(st.moves.length === 1 && st.moves[0] === pt(4, 4), 'second tap 0.6 steps off the preview places it (moves ' + st.moves + ')');
    bok(await s.page.evaluate(() => document.getElementById('bPlace').hidden && !document.getElementById('bResign').hidden), '認輸 is back after placing');
    const p2 = await s.pt(2, 2); await s.tap(p2[0], p2[1]); await s.wait(() => window.__go9.state().preview > 0);
    await s.tapEl('#bPlace'); await s.wait(() => window.__go9.state().moves.length === 2, null, 5000).catch(() => {});
    st = await s.st(); bok(st.moves[1] === pt(2, 2), '落子 button places the preview stone');
    /* slide: touch at C7, drag to D7 -> preview follows, lift does not place */
    const a = await s.pt(2, 6), b = await s.pt(3, 6);
    await s.touch('touchStart', [{ x: a[0], y: a[1], id: 900 }]);
    for (let i = 1; i <= 6; i++) { await s.touch('touchMove', [{ x: a[0] + (b[0] - a[0]) * i / 6, y: a[1], id: 900 }]); await sleep(20); }
    await s.touch('touchEnd', []); await sleep(100);
    st = await s.st(); bok(st.preview === pt(3, 6) && st.moves.length === 2, 'sliding a finger moves the preview without placing (preview ' + st.preview + ')');
    /* far second tap moves the preview instead of placing */
    const f = await s.pt(7, 7); await s.tap(f[0], f[1]); await sleep(100);
    st = await s.st(); bok(st.preview === pt(7, 7) && st.moves.length === 2, 'a tap far from the preview moves it');
    /* reviewer case: preview B2, then tap B1 9 px short towards B2 -> preview moves to B1, nothing is placed */
    for (const off of [8, 9, 10]) {
      const b2 = await s.pt(1, 7), b1 = await s.pt(1, 8), n0 = (await s.st()).moves.length;
      await s.tap(b2[0], b2[1]); await s.wait(q => window.__go9.state().preview === q, pt(1, 7), 5000).catch(() => {});
      await s.tap(b1[0], b1[1] - off); await sleep(120);
      st = await s.st();
      bok(st.preview === pt(1, 8) && st.moves.length === n0, 'adjacent tap ' + off + 'px short of B1 moves the preview to B1 (preview ' + st.preview + ', moves ' + (st.moves.length - n0) + ')');
    }
    /* a tap just off the board edge next to the preview (no playable point hit) still confirms it */
    { const n0 = (await s.st()).moves.length, b1 = await s.pt(1, 8);
      await s.tap(b1[0], b1[1] + c * 0.62); await s.wait(n => window.__go9.state().moves.length === n + 1, n0, 5000).catch(() => {});
      st = await s.st(); bok(st.moves.length === n0 + 1 && st.moves[n0] === pt(1, 8), 'a tap off the edge 0.62 steps from the preview places it'); }

    /* 11. starting a new game while one is in progress asks first */
    const nKeep = (await s.st()).moves.length;
    await s.tapEl('#bMenu'); await s.wait(() => !document.getElementById('menu').hidden);
    await s.tapEl('#bStart'); await sleep(150);
    bok(await s.page.evaluate(() => !document.getElementById('confirm').hidden && /放棄/.test(document.getElementById('cfTitle').textContent)), 'new game during a game asks for confirmation');
    await s.tapEl('#cfNo'); await sleep(150);
    st = await s.st(); bok(st.moves.length === nKeep && st.phase === 'play', 'cancel keeps the game in progress');
    bok(!s.errors.length, 'no errors in touch tests: ' + s.errors.join(' | '));
    await s.ctx.close(); }

  /* 4/8/14. scoring vs computer: marking a living computer group dead -> computer disagrees; bar shows the count; toast off the board */
  { const s = await open(null, `if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.setItem('go9.game', ${JSON.stringify(JSON.stringify(scoringSave()))}); }`);
    await s.wait(() => window.__go9.state().phase === 'scoring' && /黑 \d/.test(document.getElementById('scLive').textContent));
    const bar = await s.page.evaluate(() => [document.getElementById('wrB').textContent, document.getElementById('wrW').textContent]);
    bok(/^黑 45$/.test(bar[0]) && /^白 43\.5$/.test(bar[1]), 'during scoring the bar shows the count, not 50% (' + bar + ')');
    const w = await s.pt(5, 4); await s.tap(w[0], w[1]); await sleep(150);
    bok(await s.page.evaluate(() => document.getElementById('toast').classList.contains('edge') || !document.getElementById('toast').classList.contains('show')), 'scoring toasts are shown off the board');
    await s.tapEl('#bConfirm'); await sleep(150);
    bok(await s.page.evaluate(() => !document.getElementById('confirm').hidden && /不同意/.test(document.getElementById('cfTitle').textContent)), 'computer disagrees when its living group is marked dead');
    await s.tapEl('#cfYes');
    await s.wait(() => window.__go9.state().phase === 'over');
    let st = await s.st();
    bok(st.result.winner === 1 && Math.abs(st.result.diff - 1.5) < 1e-9, 'counted with the computer judgement: black +1.5 (' + st.result.diff + ')');
    bok(st.wr[st.moves.length] === 1, 'win-rate chart ends at the result (1.0), not 0.5');
    /* 10. reload keeps the finished game: result, then review */
    await s.page.reload(); await s.page.waitForFunction(() => window.__go9);
    st = await s.st();
    bok(st.phase === 'over' && st.resultVisible && st.result && st.result.winner === 1 && st.moves.length === walls.length, 'after reload the result is still shown (' + st.phase + ')');
    await s.tapEl('#rReview'); await sleep(100);
    bok((await s.st()).phase === 'review', 'review works after reload');
    bok(!s.errors.length && !s.external.length, 'no errors / network in scoring tests: ' + s.errors.concat(s.external).join(' | '));
    await s.ctx.close(); }

  /* 5. a win with undo/hint is recorded but not counted for wins or achievements */
  { const s = await open(null, `if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.setItem('go9.game', ${JSON.stringify(JSON.stringify(scoringSave({ undos: 1 })))}); }`);
    await s.wait(() => window.__go9.state().phase === 'scoring' && /黑 \d/.test(document.getElementById('scLive').textContent));
    await s.tapEl('#bConfirm');
    await s.wait(() => window.__go9.state().resultVisible);
    const r = await s.page.evaluate(() => ({ st: JSON.parse(localStorage.getItem('go9.stats')), ach: JSON.parse(localStorage.getItem('go9.ach') || '{}'), row: (document.getElementById('rAssist') || {}).textContent }));
    bok(r.st.lv[1].p === 1 && r.st.lv[1].w === 0 && r.st.lv[1].wa === 1 && !r.ach.first, 'assisted win: played 1, wins 0, assisted 1, no achievement');
    bok(/1 次/.test(r.row || '') && /不計/.test(r.row || ''), 'result shows undo/hint counts (' + r.row + ')');
    await s.ctx.close(); }

  /* 6. losing streak -> handicap suggestion with a one-tap restart */
  { const s = await open();
    await s.seed('stats', { lv: [0, 1, 2, 3, 4].map(i => ({ p: 2, w: 0, m: 0, mc: 0, ls: i === 1 ? 1 : 0 })), pvp: 0, daily: {}, streak: 0 });
    await s.seed('settings', { mode: 'ai', level: 1, color: 'black', handicap: 0 });
    await s.page.reload(); await s.page.waitForFunction(() => window.__go9);
    await s.tapEl('#bStart'); await s.wait(() => window.__go9.state().phase === 'play');
    await s.tapEl('#bResign'); await sleep(150); await s.tapEl('#cfYes');
    await s.wait(() => window.__go9.state().resultVisible);
    const sg = await s.page.evaluate(() => [document.getElementById('rSugg').textContent, !document.getElementById('rEasier').hidden]);
    bok(/讓 2 子/.test(sg[0]) && sg[1], 'two losses in a row suggest a handicap (' + sg[0] + ')');
    await s.tapEl('#rEasier'); await s.wait(() => window.__go9.state().phase === 'play' || window.__go9.state().phase === 'think');
    bok((await s.st()).opts.handicap === 2, 'suggested restart uses 2 handicap stones');
    await s.ctx.close(); }

  /* 7. menu: 開始對局 visible without scrolling at 360x640 on first open */
  { const s = await open({ width: 360, height: 640 });
    const r = await s.page.evaluate(() => { const b = document.getElementById('bStart').getBoundingClientRect(); return [b.bottom, innerHeight]; });
    bok(r[0] <= r[1] - 8, '開始對局 visible without scrolling at 360x640 (bottom ' + Math.round(r[0]) + ' of ' + r[1] + ')');
    bok(await s.page.evaluate(() => getComputedStyle(document.getElementById('bar')).backgroundColor.indexOf('rgba') < 0), 'player bar is opaque (maple branch not showing through)');
    await s.ctx.close(); }

  /* 9. computer thinking shows progress (percentage + candidate) */
  { const s = await open();
    await s.seed('settings', { mode: 'ai', level: 2, color: 'white', handicap: 0, size: 13 });
    await s.page.reload(); await s.page.waitForFunction(() => window.__go9);
    await s.tapEl('#bStart');
    await s.wait(() => { const st = window.__go9.state(); return st.phase === 'think' && st.prog && st.prog.m > 0; }, null, 30000);
    bok(/\d+%/.test(await s.page.textContent('#sbB')), 'thinking label shows progress percentage');
    await s.wait(() => window.__go9.state().moves.length >= 1, null, 30000);
    bok(!s.errors.length, 'no errors in thinking test: ' + s.errors.join(' | '));
    await s.ctx.close(); }

  console.log('browser checks:', bp, 'passed,', bf, 'failed (' + ((Date.now() - T0) / 1000).toFixed(1) + ' s)');
  return bf;
}
(async () => {
  let bf = 0;
  try { bf = await browserTests(); } catch (e) { bf = 1; console.log('FAIL browser tests:', e.message); }
  console.log('go9 tests:', pass, 'rule +', 'browser done,', fail + bf, 'failed');
  process.exitCode = fail || bf ? 1 : 0;
})();
