// 成語猜字 (idiom-guess) skill-tier bot. Usage: node bot.js [tiers...] [--levels=1,10,...] [--out=raw-results.json]
// Reads state via window.__ig.get() (what a player sees: tray, past guesses and their colours, whether the meaning is shown);
// acts only via CDP touch taps on the character keys, 刪除/確定, hint and retry buttons. Levels are started with __ig.start (level select).
// Tiers differ in (1) idiom knowledge: the share of idioms per rarity tier the player recognises, and how often the shown meaning
// jogs their memory, (2) guessing strategy: random fill → greedy constraint keeping → full consistent-candidate solver,
// (3) motor: tap position noise (keys are ~48×44 px) and mistake rate; sloppy players sometimes do not notice a mis-tap.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const APP = path.resolve(__dirname, '../../../apps/idiom-guess/index.html');
const html = fs.readFileSync(APP, 'utf8');
const IG = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return IG;')();

const args = process.argv.slice(2);
const tiers = args.filter(a => H.TIERS[a]);
const TIER_LIST = tiers.length ? tiers : H.TIER_IDS;
const lvArg = args.find(a => a.startsWith('--levels='));
const TEST_LEVELS = lvArg ? lvArg.slice(9).split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
const outArg = args.find(a => a.startsWith('--out='));
const OUT = path.join(__dirname, outArg ? outArg.slice(6) : 'raw-results.json');
const TIME_CAP = 120000;

// knowledge: P(recognise an idiom of rarity tier t) and P(the meaning jogs the memory of an idiom not recognised)
const KNOW = {
  clumsy:     { 1: 0.40, 2: 0.15, 3: 0.05, clue: 0.30, notice: 0.6, hint: 0.5 },
  casual:     { 1: 0.70, 2: 0.40, 3: 0.15, clue: 0.50, notice: 0.9, hint: 0.6 },
  skilled:    { 1: 0.90, 2: 0.70, 3: 0.40, clue: 0.70, notice: 1,   hint: 0.3 },
  world:      { 1: 1.00, 2: 0.95, 3: 0.85, clue: 0.90, notice: 1,   hint: 0 },
  superhuman: { 1: 1, 2: 1, 3: 1, clue: 1, notice: 1, hint: 0 },
};
const consistent = (w, st) => st.guesses.every((g, i) => IG.judge(g, w).join('') === st.results[i].join(''));
const inTray = (w, tray) => w.split('').every(c => tray.includes(c));

// Build a guess from constraints only (the player does not recognise the idiom): keep known hits, place "near" chars in
// untested positions, fill the rest with untested tray chars. depth: 0 = sloppy (may reuse greys), 1 = careful.
function constraintGuess(P, st, careful) {
  const fixed = ['', '', '', ''], near = {}, miss = new Set(), hitChars = new Set();
  st.guesses.forEach((g, gi) => g.split('').forEach((c, i) => {
    const v = st.results[gi][i];
    if (v === 'h') { fixed[i] = c; hitChars.add(c); }
    else if (v === 'n') { near[c] = near[c] || new Set(); near[c].add(i); }
    else miss.add(c);
  }));
  const out = fixed.slice(), used = new Set(out.filter(Boolean));
  const nearChars = Object.keys(near).filter(c => !used.has(c));
  // place near chars where they have not been tried
  for (const c of P.rng.pick([nearChars]) || []) {
    const spots = [0, 1, 2, 3].filter(i => !out[i] && !near[c].has(i));
    if (spots.length) { out[P.rng.pick(spots)] = c; used.add(c); }
  }
  let pool = st.tray.filter(c => !used.has(c) && !(careful && miss.has(c)));
  if (!careful) pool = pool.filter(c => P.rng() < 0.85 || !miss.has(c)); // sloppy: mostly avoids greys
  const untested = pool.filter(c => !miss.has(c) && !near[c]);
  for (let i = 0; i < 4; i++) if (!out[i]) {
    const from = untested.length ? untested : pool.length ? pool : st.tray.filter(c => !used.has(c));
    const c = P.rng.pick(from); out[i] = c; used.add(c);
    let k = untested.indexOf(c); if (k >= 0) untested.splice(k, 1); k = pool.indexOf(c); if (k >= 0) pool.splice(k, 1);
  }
  return out.join('');
}
// A full solver: among candidates consistent with all feedback, pick the one whose feedback partitions the rest best.
function solverGuess(cands, all) {
  if (cands.length <= 2) return cands[0];
  let best = null, bs = 1e9;
  for (const g of all) {
    const buckets = {}; let worst = 0;
    for (const w of cands) { const k = IG.judge(g, w).join(''); buckets[k] = (buckets[k] || 0) + 1; if (buckets[k] > worst) worst = buckets[k]; }
    const s = worst - (cands.includes(g) ? 0.5 : 0);
    if (s < bs) { bs = s; best = g; }
  }
  return best;
}

function decide(P, st, mem) {
  const K = KNOW[P.tierId];
  // which idioms this player "knows": decided once per idiom per run (seeded)
  const knows = w => { if (!(w in mem.known)) { const t = IG.BY_WORD[w].t; mem.known[w] = P.rng() < K[t]; } return mem.known[w]; };
  const possible = IG.LIST.map(x => x.w).filter(w => inTray(w, st.tray) && consistent(w, st));
  if (P.superhuman) return { g: solverGuess(possible, possible.length > 40 ? possible : IG.LIST.map(x => x.w).filter(w => inTray(w, st.tray))), how: 'solver' };
  let recalled = possible.filter(knows);
  // the shown meaning may jog the memory of the true answer
  if (st.clue && possible.includes(st.answer) && !recalled.includes(st.answer)) {
    if (!('clueTry' in mem)) mem.clueTry = P.rng() < K.clue;
    if (mem.clueTry) recalled = [st.answer];
  } else if (st.clue && recalled.length > 1 && recalled.includes(st.answer) && P.rng() < K.clue) recalled = [st.answer]; // meaning disambiguates
  if (recalled.length) {
    if (P.tierId === 'clumsy' && P.rng() < 0.35) return { g: constraintGuess(P, st, false), how: 'random' };
    if (P.tierId === 'world') return { g: solverGuess(recalled, recalled), how: 'recall-solver' };
    return { g: P.rng.pick(recalled), how: 'recall' };
  }
  if (P.tierId === 'clumsy') return { g: constraintGuess(P, st, false), how: 'random' };
  if (P.tierId === 'casual') return { g: constraintGuess(P, st, P.rng() > 0.15), how: 'greedy' };
  return { g: constraintGuess(P, st, true), how: 'constraint' };
}

const getState = page => page.evaluate(() => window.__ig.get());
async function keyBox(page, c) { return page.locator(`#tray .key[data-c="${c}"]`).boundingBox(); }

async function playAttempt(P, n, mem, finding) {
  const page = P.page; const K = KNOW[P.tierId];
  let st = await getState(page);
  const t0 = Date.now(); let taps = 0, misTaps = 0, unnoticed = 0, dropped = 0, hints = 0; const hows = [];
  while (!st.over && Date.now() - t0 < TIME_CAP) {
    await H.sleep(P.thinkMs(2.5));
    // weaker players buy the meaning when stuck after 2 guesses
    if (!st.clue && st.guesses.length >= 2 && K.hint && P.rng() < K.hint && st.coins >= IG.COST.clue && !mem.hinted) {
      mem.hinted = true;
      await P.tapSelector('#bHint'); await H.sleep(P.reactMs() + 250);
      if (await page.isVisible('#hintOv')) { await P.tapSelector('#h1'); hints++; await H.sleep(P.reactMs() + 200); if (await page.isVisible('#hintOv')) await P.tapSelector('#hClose'); }
      st = await getState(page);
    }
    const { g, how } = decide(P, st, mem); hows.push(how);
    // type the four characters, slot by slot, fixing mis-taps the player notices
    for (let i = 0; i < 4; i++) {
      st = await getState(page);
      if (st.cur[i] && st.cur[i] === g[i]) continue;
      if (st.cur[i]) { await P.tapSelector('#bDel'); taps++; await H.sleep(P.reactMs()); i--; continue; }
      let want = g[i];
      if (P.mistake()) want = P.rng.pick(st.tray.filter(c => !st.cur.includes(c)));
      const b = await keyBox(page, want); if (!b) break;
      await H.sleep(P.reactMs());
      await P.tap(b.x + b.width / 2, b.y + b.height / 2); taps++;
      await H.sleep(40);
      const st2 = await getState(page);
      const got = st2.cur[i];
      if (!got) { if (st2.cur.join('') === st.cur.join('')) dropped++; continue; }
      if (got !== g[i]) { misTaps++; if (P.rng() < K.notice) { await H.sleep(P.reactMs()); await P.tapSelector('#bDel'); taps++; await H.sleep(60); i--; } else unnoticed++; }
    }
    st = await getState(page);
    if (st.cur.filter(Boolean).length < 4) { // could not fill the row (dropped taps): clear and retry
      for (let k = 0; k < 4; k++) { await P.tapSelector('#bDel'); await H.sleep(50); }
      continue;
    }
    await H.sleep(P.reactMs());
    const before = st.guesses.length;
    await P.tapSelector('#bGo'); taps++;
    await H.sleep(100);
    st = await getState(page);
    if (st.guesses.length === before) { dropped++; await H.sleep(300); st = await getState(page); if (st.guesses.length === before) continue; }
    // watch the tiles flip
    await H.sleep(1300);
    st = await getState(page);
  }
  const won = st.over && st.guesses[st.guesses.length - 1] === st.answer;
  await H.sleep(900);
  const overlay = won ? await page.isVisible('#win') : await page.isVisible('#lose');
  if (st.over && !overlay) finding('no-overlay', { level: n, tier: P.tierId, won });
  return { cleared: won, tries: st.guesses.length, taps, misTaps, unnoticed, dropped, hints, hows, answer: st.answer, guesses: st.guesses, ms: Date.now() - t0, overlay,
    stars: won ? IG.stars(st.guesses.length) : 0, clueShown: st.clue };
}

async function runTier(browser, tierId, idx, findings) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, tierId, 1000 + idx * 7919);
  await H.sleep(800);
  const runs = [];
  for (const n of TEST_LEVELS) {
    const cfg = IG.levelConfig(n), item = IG.levelIdiom(n);
    const run = { level: n, answer: item.w, rarity: item.t, keys: cfg.tray, clueAfter: cfg.clueAfter, attempts: [], cleared: false };
    const mem = { known: {} };
    await sess.page.evaluate(n => window.__ig.start('level', { level: n }), n); await H.sleep(400);
    for (let a = 1; a <= P.t.attempts; a++) {
      if (a > 1) { await P.tapSelector('#lRetry'); await H.sleep(500); }
      delete mem.hinted; delete mem.clueTry;
      const r = await playAttempt(P, n, mem, (k, v) => findings.push({ k, v }));
      run.attempts.push(r);
      if (r.cleared) { run.cleared = true; break; }
      if (!(await sess.page.isVisible('#lose'))) { await sess.page.evaluate(n => window.__ig.start('level', { level: n }), n); await H.sleep(400); run.attempts[run.attempts.length - 1].restartedByHook = true; }
    }
    const last = run.attempts[run.attempts.length - 1];
    Object.assign(run, { tries: run.attempts.length, guesses: last.tries, stars: last.stars, ms: run.attempts.reduce((a, b) => a + b.ms, 0) });
    runs.push(run);
    try { fs.writeFileSync(path.join(__dirname, 'partial-' + tierId + '.json'), JSON.stringify({ runs, errors: sess.errors }, null, 1)); } catch (e) { }
    console.log(`[${tierId}] L${n} ${item.w} ${run.cleared ? 'CLEAR' : 'fail'} attempts=${run.tries} guesses=${run.guesses} stars=${run.stars} ${(run.ms / 1000).toFixed(1)}s`);
    if (run.cleared) { await P.tapSelector('#wMenu'); await H.sleep(300); }
  }
  const errors = sess.errors.slice();
  await sess.ctx.close();
  const cl = runs.filter(r => r.cleared), allA = runs.flatMap(r => r.attempts);
  return { runs, errors, stats: P.stats, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: runs.reduce((a, r) => a + r.tries, 0),
    avgGuessesCleared: cl.length ? +(cl.reduce((a, r) => a + r.guesses, 0) / cl.length).toFixed(2) : 0, avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0,
    taps: allA.reduce((a, x) => a + x.taps, 0), misTaps: allA.reduce((a, x) => a + x.misTaps, 0), unnoticed: allA.reduce((a, x) => a + x.unnoticed, 0), dropped: allA.reduce((a, x) => a + x.dropped, 0), hints: allA.reduce((a, x) => a + x.hints, 0) } };
}

// Probe: four key taps and 確定 in quick succession (one frame apart) must all register.
async function rapidInputProbe(browser) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, 'superhuman', 42);
  await H.sleep(800);
  await sess.page.evaluate(() => window.__ig.start('level', { level: 50 })); await H.sleep(300);
  const st = await getState(sess.page);
  for (const c of st.answer) { const b = await keyBox(sess.page, c); await P.tap(b.x + b.width / 2, b.y + b.height / 2, { exact: true }); }
  await P.tapSelector('#bGo'); await H.sleep(1600);
  const st2 = await getState(sess.page);
  await sess.ctx.close();
  return { level: 50, tapsSent: 5, guessRegistered: st2.guesses.length === 1 && st2.guesses[0] === st.answer, won: st2.over };
}

(async () => {
  const browser = await H.launch();
  const findings = [];
  const out = { game: 'idiom-guess', testedLevels: TEST_LEVELS, timeCap: '120 s per attempt; attempts: clumsy 5, others 3', knowledge: KNOW, tiers: {}, findings: [] };
  const t0 = Date.now();
  const res = await Promise.all(TIER_LIST.map((t, i) => runTier(browser, t, i, findings)));
  TIER_LIST.forEach((t, i) => { out.tiers[t] = res[i]; });
  out.probe = await rapidInputProbe(browser);
  out.wallMs = Date.now() - t0;
  out.rawFindings = findings;
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('probe', JSON.stringify(out.probe), 'wall', (out.wallMs / 1000).toFixed(0) + 's');
})().catch(e => { console.error(e); process.exit(1); });
