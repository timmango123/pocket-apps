// Regression tests for 蜘蛛接龍 (spider-solitaire).
// Part 1 (Node, the game's own core between CORE-START/END): 100 levels with strictly rising difficulty, every embedded
// winning line replays to a win under that level's rules, the hint's generator search matches the core solver.
// Part 2 drives the real page in mobile Chromium with CDP touch, served over http: a finger resting on the table / HUD /
// screen edge while another taps each toolbar button, overlapping taps on two buttons (both lift orders), detail-0 click
// replays after a tap (hint/undo/restart/switches run once), taps that change the screen never fire the control under the
// finger on the new screen, holding a card while tapping the stock or 提示, rapid stock taps, a new game never silently
// replaces an in-progress save, corrupt storage never throws, the hint on level 100 never blocks the page, details
// (best score on tiles, first-clear message, quick mute, landscape 自由模式).
// Usage: node tests.js [--no-browser]
const fs = require('fs'), path = require('path'), http = require('http');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {NCOL, makeGame, initState, cloneState, applyCode, isWon, canMove, canDeal, solve};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[^\n]*\]);/)[1]);
const SOLS = JSON.parse(html.match(/var SOLS = (\[[^\n]*\]);/)[1]);
const RULES = new Function(html.match(/(var STRICT_FROM[^\n]*\n[^\n]*levelRules[^\n]*)/)[1] + '\nreturn levelRules;')();
const ABC = html.match(/var SOL_ABC = '([^']+)'/)[1];
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
function decode(str) { const out = []; str = str || ""; for (let i = 0; i + 1 < str.length; i += 2) { const v = ABC.indexOf(str[i]) * 64 + ABC.indexOf(str[i + 1]); if (v === 4095) out.push(0xFFFF); else { const ft = (v / 13) | 0; out.push(((ft / 10) | 0) | (ft % 10) << 4 | (v % 13 + 1) << 8); } } return out; }

// ---------------- Part 1: levels ----------------
ok(LEVELS.length === 100 && SOLS.length === 100, '100 levels with 100 embedded winning lines');
{
  let rising = true, segs = true;
  for (let n = 2; n <= 100; n++) if (!(LEVELS[n - 1][2] > LEVELS[n - 2][2])) rising = false;
  for (let n = 1; n <= 100; n++) { const su = LEVELS[n - 1][1]; if (su !== (n <= 40 ? 1 : n <= 75 ? 2 : 4)) segs = false; }
  ok(rising, 'difficulty S rises strictly from level 1 to 100'); ok(segs, 'suit segments 1-40 / 41-75 / 76-100');
  const jump = LEVELS[40][2] - LEVELS[39][2], step = (LEVELS[39][2] - LEVELS[29][2]) / 10;
  ok(jump < 4 * Math.max(step, 5), 'no wall at 40 -> 41 (S step ' + jump + ' vs typical ' + step.toFixed(1) + ')');
}
{
  let bad = [], undoOk = true;
  for (let n = 1; n <= 100; n++) {
    const [seed, su] = LEVELS[n - 1], ru = RULES(n), G = C.makeGame(seed, su, ru.strict), s = C.initState(G), mv = decode(SOLS[n - 1]);
    let legal = true;
    for (const m of mv) { if (m === 0xFFFF ? !C.canDeal(G, s) : !C.canMove(G, s, m & 15, m >> 8, (m >> 4) & 15)) { legal = false; break; } C.applyCode(G, s, m); }
    if (!legal || !C.isWon(s) || mv.length !== LEVELS[n - 1][3]) bad.push(n);
    if (ru.undoMax !== Infinity && ru.undoMax < 10) undoOk = false;
  }
  ok(!bad.length, 'every embedded winning line is legal under its level rules and wins' + (bad.length ? ': ' + bad.join(',') : ''));
  ok(undoOk, 'late-level undo allowance is at least 10');
}
{ // the time-sliced hint search is the same search as the core solver
  const gsrc = html.match(/(function\* phaseSearchG[\s\S]*?)\n\/\/ =+ level data/)[1];
  const core = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
  const H = new Function(core + gsrc + '\nreturn {makeGame, initState, solve, solveG};')();
  const G = H.makeGame(LEVELS[44][0], 2, false), s = H.initState(G), o = { width: 3, phaseNodes: 1500, maxNodes: 40000 };
  const a = H.solve(G, s, o), it = H.solveG(G, s, o); let r; while (!(r = it.next()).done); const b = r.value;
  ok(a.nodes === b.nodes && JSON.stringify(a.moves) === JSON.stringify(b.moves), 'sliced hint search gives the same result as solve()');
}
console.log('Part 1:', pass, 'passed,', fail, 'failed');

// ---------------- Part 2: real page ----------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser, server, base, tid = 10;
function serve() {
  return new Promise(res => {
    server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(path.resolve(__dirname, '..', 'index.html'))); });
    server.listen(0, '127.0.0.1', () => { server.unref(); base = 'http://127.0.0.1:' + server.address().port + '/'; res(); });
  });
}
async function at(name, fn) {
  const t0 = Date.now(); let tm;
  try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 60 s')), 60000); })]); clearTimeout(tm); pass++; console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
  catch (e) { clearTimeout(tm); fail++; console.log('FAIL', name, '-', String(e.message || e).split('\n')[0]); }
}
const expect = (c, msg) => { if (!c) throw new Error(msg); };
async function open(vp, ls) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base); await page.waitForFunction(() => window.__spider);
  if (ls) { await page.evaluate(ls => { localStorage.clear(); for (const k in ls) localStorage.setItem('spider:' + k, ls[k]); }, ls); await page.reload(); await page.waitForFunction(() => window.__spider); }
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y, hold = 50) => { const id = ++tid; await touch('touchStart', [{ x, y, id }]); await sleep(hold); await touch('touchEnd', [{ x, y, id }]); };
  const mid = async sel => { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('not visible: ' + sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  // wait for the overlay card's pop-in to end, then tap
  const settle = () => page.waitForFunction(() => [...document.querySelectorAll('.ov:not(.hidden), .ov:not(.hidden) .card')].every(e => e.getAnimations().every(a => a.playState !== 'running')), null, { timeout: 5000 }).catch(() => {});
  const tapSel = async (sel, hold) => { await settle(); const p = await mid(sel); await tap(p.x, p.y, hold); await sleep(120); return p; };
  const ov = () => page.evaluate(() => [...document.querySelectorAll('.ov:not(.hidden)')].map(e => e.id));
  const g = () => page.evaluate(() => { const G = window.__spider.game(); return G && { mode: G.mode, n: G.n, moves: G.moves, k: G.s.k, undoUsed: G.undoUsed, hist: G.hist.length, won: G.won, hint: !!window.hint, cnt: window.__spider.counts() }; });
  const cnt = () => page.evaluate(() => window.__spider.counts());
  const waitFor = (fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms });
  // start level n directly (fresh, no intro card), optionally make k automatic moves
  const level = async (n, k = 0) => {
    await page.evaluate(([n, k]) => {
      progress.seen[n] = 1; sdel('save'); startLevel(n, true); hideAll();
      for (let i = 0; i < k; i++) { const l = movableList(); if (!l.length) break; perform(l[0].col | autoDestQuiet(l[0].col, l[0].n) << 4 | l[0].n << 8); }
      flyers = []; resize(); // skip the deal animation
    }, [n, k]);
    await waitFor(() => !window.__spider.state().anim, null, 10000);
  };
  return { ctx, page, errors, touch, tap, mid, tapSel, ov, g, cnt, level, waitFor, settle, close: () => ctx.close() };
}
const detail0 = (page, sel, pt) => page.evaluate(([sel, pt]) => {
  const fire = el => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: pt.x, clientY: pt.y }));
  fire(document.querySelector(sel)); fire(document.elementFromPoint(pt.x, pt.y)); fire(document.elementFromPoint(pt.ex, pt.ey));
}, [sel, pt]);

async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  await serve(); browser = await chromium.launch();
  console.log('Page (mobile Chromium, touch, http)');
  try {
    await at('a finger resting on the table, the HUD panel or the screen edge never blocks a tap on 悔棋/提示/發牌/重來/選單', async () => {
      const s = await open({ width: 390, height: 844 });
      const VP = { w: 390, h: 844 };
      await s.level(1); const hm = await s.mid('.hmid');
      const rests = { table: { x: VP.w * 0.5, y: VP.h * 0.6 }, hud: { x: hm.x, y: hm.y }, edge: { x: 4, y: VP.h * 0.45 } };
      const bad = [];
      for (const [rn, rp] of Object.entries(rests)) for (const sel of ['#bUndo', '#bHint', '#bDeal', '#bRestart', '#bMenu']) {
        await s.level(1, 2);
        const before = await s.g(), q = await s.mid(sel), a = ++tid, b = ++tid;
        await s.touch('touchStart', [{ x: rp.x, y: rp.y, id: a }]); await sleep(250);
        await s.touch('touchStart', [{ x: rp.x, y: rp.y, id: a }, { x: q.x, y: q.y, id: b }]); await sleep(60);
        await s.touch('touchEnd', [{ x: q.x, y: q.y, id: b }]); await sleep(250);
        const r = await s.g(), o = await s.ov();
        const worked = sel === '#bUndo' ? r.undoUsed === before.undoUsed + 1 : sel === '#bHint' ? r.cnt.hint === before.cnt.hint + 1 : sel === '#bDeal' ? r.k === before.k + 1 : sel === '#bRestart' ? r.cnt.restart === before.cnt.restart + 1 : o.includes('pause');
        await s.touch('touchEnd', [{ x: rp.x, y: rp.y, id: a }]); await sleep(150);
        if (!worked) bad.push(rn + '->' + sel);
        if ((await s.ov()).length) await s.page.evaluate(() => hideAll());
      }
      // title screen: rest on the heading, tap 統計
      await s.page.evaluate(() => goTitle());
      const h1 = await s.mid('.ttl h1'), st = await s.mid('#tStats');
      await s.settle();
      await s.touch('touchStart', [{ x: h1.x, y: h1.y, id: 1 }]); await sleep(250);
      await s.touch('touchStart', [{ x: h1.x, y: h1.y, id: 1 }, { x: st.x, y: st.y, id: 2 }]); await sleep(60);
      await s.touch('touchEnd', [{ x: st.x, y: st.y, id: 2 }]); await sleep(250);
      if (!(await s.ov()).includes('stats')) bad.push('title h1 -> 統計');
      await s.touch('touchEnd', [{ x: h1.x, y: h1.y, id: 1 }]);
      expect(!bad.length, 'no effect: ' + bad.join(', ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('overlapping taps on two buttons (second 50 ms later, either lifts first) both act', async () => {
      const s = await open({ width: 390, height: 844 }), bad = [];
      for (const [A, B] of [['#bUndo', '#bHint'], ['#bHint', '#bDeal'], ['#bUndo', '#bDeal']]) for (const firstUp of ['a', 'b']) {
        await s.level(1, 3);
        const before = await s.g(), pa = await s.mid(A), pb = await s.mid(B), a = ++tid, b = ++tid;
        await s.touch('touchStart', [{ x: pa.x, y: pa.y, id: a }]); await sleep(50);
        await s.touch('touchStart', [{ x: pa.x, y: pa.y, id: a }, { x: pb.x, y: pb.y, id: b }]); await sleep(60);
        if (firstUp === 'a') { await s.touch('touchEnd', [{ x: pa.x, y: pa.y, id: a }]); await sleep(40); await s.touch('touchEnd', [{ x: pb.x, y: pb.y, id: b }]); }
        else { await s.touch('touchEnd', [{ x: pb.x, y: pb.y, id: b }]); await sleep(40); await s.touch('touchEnd', [{ x: pa.x, y: pa.y, id: a }]); }
        await sleep(400);
        const r = await s.g();
        const did = sel => sel === '#bUndo' ? r.undoUsed > before.undoUsed : sel === '#bHint' ? r.cnt.hint > before.cnt.hint : r.cnt.deal > before.cnt.deal;
        if (!did(A) || !did(B)) bad.push(A + '+' + B + ' (' + firstUp + ' up first)');
      }
      expect(!bad.length, 'lost: ' + bad.join(', ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('a detail-0 click replayed after a tap (on the button, its edge, elementFromPoint) runs nothing twice', async () => {
      const s = await open({ width: 390, height: 844 }), bad = [];
      for (const sel of ['#bHint', '#bUndo', '#bRestart']) {
        await s.level(1, 3);
        const before = await s.g(), p = await s.tapSel(sel);
        await detail0(s.page, sel, { x: p.x, y: p.y, ex: p.b.x + 2, ey: p.b.y + 2 }); await sleep(300);
        const r = await s.g(), key = sel === '#bHint' ? 'hint' : sel === '#bUndo' ? 'undo' : 'restart';
        if (r.cnt[key] !== before.cnt[key] + 1) bad.push(sel + ' ran ' + (r.cnt[key] - before.cnt[key]) + 'x');
      }
      // switches flip exactly once
      await s.page.evaluate(() => { goTitle(); returnTo = 'title'; syncSettingsUI(); show('settings'); });
      for (const sel of ['#sSnd', '#sVib', '#sCb']) {
        const was = await s.page.$eval(sel, e => e.getAttribute('aria-checked'));
        const p = await s.tapSel(sel); await detail0(s.page, sel, { x: p.x, y: p.y, ex: p.b.x + 2, ey: p.b.y + 2 }); await sleep(200);
        const now = await s.page.$eval(sel, e => e.getAttribute('aria-checked'));
        if (now === was) bad.push(sel + ' flipped back');
      }
      await s.page.evaluate(() => openSelect()); await sleep(200);
      { const was = await s.page.evaluate(() => unlockAll); const p = await s.tapSel('#unlockSw'); await detail0(s.page, '#unlockSw', { x: p.x, y: p.y, ex: p.b.x + 2, ey: p.b.y + 2 }); await sleep(200);
        if (await s.page.evaluate(() => unlockAll) === was) bad.push('unlock switch flipped back'); }
      // keyboard still works: Enter then click on a focused control acts once
      await s.page.evaluate(() => { hideAll(); goTitle(); }); await sleep(900);
      await s.page.focus('#tStats'); await s.page.keyboard.press('Enter'); await sleep(200);
      if (!(await s.ov()).includes('stats')) bad.push('keyboard Enter on 統計');
      expect(!bad.length, bad.join(', ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('a tap that changes the screen never fires the control under the finger on the new screen (360x640)', async () => {
      const s = await open({ width: 360, height: 640 }, { unlockAll: 'true' }), bad = [];
      const ghost = async (sel, check) => {
        const p = await s.tapSel(sel); await sleep(30);
        await detail0(s.page, sel, { x: p.x, y: p.y, ex: p.x, ey: p.y }); await sleep(350);
        const why = await check(); if (why) bad.push(sel + ': ' + why);
      };
      await ghost('#tSelect', async () => { const o = await s.ov(), G = await s.g(); return G ? 'started level ' + G.n : !o.includes('select') ? 'select not open: ' + o : ''; });
      await s.page.evaluate(() => { refreshTitle(); show('title'); });
      await s.tapSel('#tHelp'); await sleep(300);
      await ghost('#hOk', async () => { const o = await s.ov(); return o.join() !== 'title' ? 'now on ' + o : ''; });
      await s.tapSel('#tStats'); await sleep(300);
      await ghost('#stOk', async () => { const o = await s.ov(); return o.join() !== 'title' ? 'now on ' + o : ''; });
      await s.level(3, 4); await s.tapSel('#bMenu'); await sleep(300);
      await ghost('#pHome', async () => { const o = await s.ov(), G = await s.g(); return G ? 'resumed a game' : o.join() !== 'title' ? 'now on ' + o : ''; });
      // a real CDP tap on 選擇關卡 opens the grid but starts no level
      await s.tapSel('#tSelect'); await sleep(500);
      if (await s.g()) bad.push('real tap on 選擇關卡 started a level');
      expect(!bad.length, bad.join(', ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('holding a card while another finger taps the stock or 提示: both act', async () => {
      const s = await open({ width: 390, height: 844 }), bad = [];
      for (const other of ['stock', '#bHint']) for (const firstUp of ['card', 'other']) {
        await s.level(1);
        const pc = await s.page.evaluate(() => { const l = movableList()[0], c = game.s.c[l.col]; return window.__spider.cardPoint(l.col, c.length - l.n); });
        const po = other === 'stock' ? await s.page.evaluate(() => window.__spider.stock()) : await s.mid(other);
        const before = await s.g(), a = ++tid, b = ++tid;
        await s.touch('touchStart', [{ x: pc.x, y: pc.y, id: a }]); await sleep(300); // a held card (lifted after 100 ms)
        await s.touch('touchStart', [{ x: pc.x, y: pc.y, id: a }, { x: po.x, y: po.y, id: b }]); await sleep(60);
        if (firstUp === 'other') { await s.touch('touchEnd', [{ x: po.x, y: po.y, id: b }]); await sleep(80); await s.touch('touchEnd', [{ x: pc.x, y: pc.y, id: a }]); }
        else { await s.touch('touchEnd', [{ x: pc.x, y: pc.y, id: a }]); await sleep(80); await s.touch('touchEnd', [{ x: po.x, y: po.y, id: b }]); }
        await sleep(500);
        const r = await s.g(), cardMoved = r.moves - before.moves - (r.k - before.k) === 1;
        const otherDid = other === 'stock' ? r.k === before.k + 1 : r.cnt.hint === before.cnt.hint + 1;
        if (!cardMoved || !otherDid) bad.push(other + ' (' + firstUp + ' up first): card ' + cardMoved + ', other ' + otherDid);
      }
      // a second card tapped while the first is held moves too
      await s.level(1);
      const two = await s.page.evaluate(() => { const l = movableList(); return l.length > 1 ? l.slice(0, 2).map(m => window.__spider.cardPoint(m.col, game.s.c[m.col].length - m.n)) : null; });
      if (two) {
        const before = await s.g();
        await s.touch('touchStart', [{ x: two[0].x, y: two[0].y, id: 1 }]); await sleep(250);
        await s.touch('touchStart', [{ x: two[0].x, y: two[0].y, id: 1 }, { x: two[1].x, y: two[1].y, id: 2 }]); await sleep(60);
        await s.touch('touchEnd', [{ x: two[1].x, y: two[1].y, id: 2 }]); await sleep(80); await s.touch('touchEnd', [{ x: two[0].x, y: two[0].y, id: 1 }]); await sleep(500);
        const r = await s.g(); if (r.moves - before.moves < 1) bad.push('second card tap lost');
      }
      expect(!bad.length, bad.join('; ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('rapid stock taps (8/s) are queued, not dropped, and the stock pulses meanwhile', async () => {
      const s = await open({ width: 390, height: 844 });
      await s.level(1);
      const p = await s.page.evaluate(() => window.__spider.stock());
      for (let i = 0; i < 5; i++) { await s.tap(p.x, p.y, 40); await sleep(85); }
      const pulsing = await s.page.evaluate(() => pendingDeals > 0 || performance.now() - stockPulse < 300);
      await s.waitFor(() => window.__spider.state().k === 5, null, 6000);
      expect(pulsing, 'no feedback while taps were queued'); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('starting another game asks first; 取消 / 繼續原本那局 keep the save, 開新局 replaces it', async () => {
      const s = await open({ width: 390, height: 844 }, { unlockAll: 'true' });
      await s.level(3, 6); await s.page.evaluate(() => goTitle()); await sleep(300);
      const label = await s.page.$eval('#tPlay', e => e.textContent);
      expect(/第 3 關/.test(label), 'title does not offer to continue level 3: ' + label);
      await s.tapSel('#tDaily'); await sleep(300);
      expect((await s.ov()).includes('confirm'), '每日蜘蛛 started without asking');
      expect(/第 3 關/.test(await s.page.$eval('#cBody', e => e.textContent)), 'confirm does not name the game it replaces');
      await s.tapSel('#cNo'); await sleep(300);
      expect((await s.ov()).join() === 'title' && /第 3 關/.test(await s.page.$eval('#tPlay', e => e.textContent)), 'cancel lost the save');
      await s.tapSel('#tFree'); await sleep(300); await s.tapSel('#fGo'); await sleep(300);
      expect((await s.ov()).includes('confirm'), '自由模式 發牌開始 started without asking');
      await s.tapSel('#cResume'); await sleep(400);
      let G = await s.g(); expect(G && G.mode === 'level' && G.n === 3 && G.moves === 6, 'resume did not bring back level 3: ' + JSON.stringify(G));
      await s.page.evaluate(() => { goTitle(); openSelect(); }); await sleep(300);
      await s.page.evaluate(() => document.getElementById('lt7').scrollIntoView({ block: 'center' })); await sleep(200);
      await s.tapSel('#lt7'); await sleep(300);
      expect((await s.ov()).includes('confirm'), 'another level tile started without asking');
      await s.tapSel('#cYes'); await sleep(500);
      G = await s.g(); expect(G && G.n === 7 && G.moves === 0, '開新局 did not start level 7');
      expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('damaged storage values are dropped, never thrown on (boot, 開始, 統計, 選擇關卡)', async () => {
      const cases = [{ progress: '{"best":null}' }, { progress: '[]' }, { progress: '{"best":{"1":"x","2":1100},"seen":5}' }, { stats: '{"s1":null}' }, { stats: '{"lv":{"p":"x"},"daily":[1]}' },
        { settings: '{"skin":"zzz","fsuits":7,"snd":"no"}' }, { save: '{"mode":"level","n":500,"seed":1,"suits":1,"log":[]}' }, { save: '{"mode":"level","n":3,"seed":797135287,"suits":1,"log":[99999]}' },
        { save: '{"mode":"free","seed":5,"suits":2,"log":"abc"}' }, { save: '{"mode":"free","seed":5,"suits":2,"log":[0,1,2]}' }, { save: '7' }, { unlockAll: '"yes"' }];
      const bad = [], s = await open({ width: 390, height: 844 });
      for (const ls of cases) {
        s.errors.length = 0;
        await s.page.evaluate(ls => { localStorage.clear(); for (const k in ls) localStorage.setItem('spider:' + k, ls[k]); }, ls);
        await s.page.reload(); await s.page.waitForFunction(() => window.__spider);
        await s.page.evaluate(() => { openStats(); show('title'); openSelect(); show('title'); });
        await s.tapSel('#tPlay'); await sleep(250);
        const G = await s.g(); if (!G) bad.push(JSON.stringify(ls) + ': 開始 did nothing');
        if (s.errors.length) bad.push(JSON.stringify(ls) + ': ' + s.errors[0]);
      }
      await s.close();
      expect(!bad.length, bad.join(' | '));
    });

    await at('提示 on level 100: on the winning line it is instant; off it the search runs in slices (no long task > 120 ms)', async () => {
      const s = await open({ width: 390, height: 844 }, { unlockAll: 'true' });
      await s.level(100);
      await s.page.evaluate(() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); });
      const t0 = await s.page.evaluate(() => { const t = performance.now(); doHint(); return { ms: performance.now() - t, hint: !!hint }; });
      expect(t0.hint && t0.ms < 50, 'hint on the line not instant: ' + JSON.stringify(t0));
      // step off the line: a legal move the winning line does not take
      const off = await s.page.evaluate(() => {
        const G = game.G, st = game.s;
        for (let i = 0; i < NCOL; i++) for (let j = 0; j < NCOL; j++) { if (!canMove(G, st, i, 1, j)) continue; const c = cloneState(st); applyCode(G, c, i | j << 4 | 1 << 8); if (!game.line.map.has(stateHash(G, c))) { perform(i | j << 4 | 1 << 8); return true; } }
        return false;
      });
      if (off) {
        await sleep(400);
        await s.page.evaluate(() => { window.__lt = []; hint = null; doHint(); });
        await s.waitFor(() => !hintJob && window.hint, null, 15000);
        const lt = await s.page.evaluate(() => window.__lt), toast = await s.page.$eval('#toast', e => e.textContent);
        expect(!lt.some(d => d > 120), 'long tasks during the hint search: ' + lt.map(Math.round).join(','));
        expect(/必勝路線|建議/.test(toast), 'hint did not say whether it found a winning line: ' + toast);
      }
      // follow the winning line from the start of level 90 by pressing 提示 only: it wins without undo
      await s.level(90);
      const res = await s.page.evaluate(async () => {
        for (let i = 0; i < 400 && !game.won; i++) { const m = lineMove(); if (m == null) return 'off line at ' + i; perform(m); }
        return game.won ? 'won ' + game.undoUsed : 'not won';
      });
      expect(res === 'won 0', 'following hints on level 90: ' + res); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('details: best score on level tiles, first-clear message, quick mute, landscape 自由模式 fits', async () => {
      const s = await open({ width: 390, height: 844 }, { progress: '{"best":{"1":1185},"seen":{"1":1}}' });
      await s.page.evaluate(() => openSelect()); await sleep(200);
      expect(/最佳 1185/.test(await s.page.$eval('#lt1', e => e.textContent)), 'tile 1 does not show its best score');
      await s.level(2);
      await s.page.evaluate(() => { for (let i = 0; i < 400 && !game.won; i++) { const m = lineMove(); if (m == null) break; perform(m); } });
      await s.waitFor(() => !document.getElementById('win').classList.contains('hidden'), null, 15000);
      expect(/首次過關/.test(await s.page.$eval('#wMsg', e => e.textContent)), 'no first-clear message');
      await s.page.evaluate(() => { hideAll(); startLevel(3, true); hideAll(); }); await sleep(400);
      const snd0 = await s.page.evaluate(() => settings.snd); await s.tapSel('#bSnd'); await sleep(150);
      const after = await s.page.evaluate(() => [settings.snd, JSON.parse(localStorage.getItem('spider:settings')).snd]);
      expect(after[0] === !snd0 && after[1] === !snd0, 'quick mute did not toggle sound');
      await s.close();
      for (const vp of [{ width: 844, height: 390 }, { width: 667, height: 375 }]) {
        const t = await open(vp);
        await t.page.evaluate(() => { syncSettingsUI(); show('free'); }); await t.settle();
        const b = await t.mid('#fBack'), go = await t.mid('#fGo');
        expect(b.b.y + b.b.height <= vp.height && go.b.y + go.b.height <= vp.height, '自由模式 buttons below the fold at ' + vp.width + 'x' + vp.height);
        await t.close();
      }
    });
  } finally { await browser.close(); }
}

(async () => {
  if (!process.argv.includes('--no-browser')) await browserTests();
  console.log(fail ? 'FAILED' : 'ALL PASSED', pass, 'passed,', fail, 'failed');
  process.exit(fail ? 1 : 0);
})();
