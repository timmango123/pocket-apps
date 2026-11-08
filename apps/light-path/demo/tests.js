// 光路折鏡 regression tests (run by qa/smoke/run.js). Real Chromium, mobile context, CDP touch input.
// Each block is a check for one release-review finding; waits are on conditions, not wall-clock deltas.
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const HTML = path.join(__dirname, '..', 'index.html'), URL = 'file://' + HTML;
const src = fs.readFileSync(HTML, 'utf8');
const C = new Function(src.slice(src.indexOf('// ===CORE-START==='), src.indexOf('// ===CORE-END===')) + '\nreturn LPCore;')();
const LEVELS = JSON.parse(src.match(/var LEVELS = (\[\[.*?\]\]);/)[1]);
const OPT = JSON.parse(src.match(/var OPT = (\[\[.*?\]\]);/)[1]);

let fails = 0, passes = 0; const START = Date.now();
const at = () => ' [' + ((Date.now() - START) / 1000).toFixed(1) + 's]';
function check(name, ok, info) {
  if (ok) { passes++; console.log('ok   ' + name + at()); }
  else { fails++; console.log('FAIL ' + name + (info !== undefined ? ' ' + JSON.stringify(info).slice(0, 300) : '')); }
}

// ---- data: the stored shortest solutions really solve every level in exactly par taps ----
{
  let bad = [];
  for (let L = 1; L <= 100; L++) {
    const [v, par] = LEVELS[L - 1], lv = C.build(L, v), o = new Uint8Array(lv.scr);
    for (const i of OPT[L - 1]) { if (!lv.rot.includes(i)) bad.push(L); o[i] ^= 1; }
    if (OPT[L - 1].length !== par || !C.isWin(lv, C.trace(lv, o, false)) || C.isWin(lv, C.trace(lv, lv.scr, false))) bad.push(L);
  }
  check('OPT: 100 levels solved in par taps', !bad.length, bad);
}

(async () => {
  const browser = await chromium.launch();
  const T0 = Date.now();
  async function open(w = 390, h = 844, storage) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    if (storage) await ctx.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); } }, storage);
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
    await page.goto(URL);
    await page.waitForFunction(() => window.__game && document.getElementById('title').classList.contains('show'));
    const cdp = await ctx.newCDPSession(page);
    const T = { ctx, page, cdp, errors };
    T.state = () => page.evaluate(() => window.__game.state());
    T.tapXY = async (x, y, hold) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      if (hold) await new Promise(r => setTimeout(r, hold));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    // tap cell i and wait until the game has registered it (moves change or, for a non-turnable cell, one frame)
    T.tapCell = async i => {
      const before = (await T.state()).moves;
      const c = await page.evaluate(i => window.__game.cellClient(i), i);
      await T.tapXY(c.x, c.y);
      await page.waitForFunction(m => { const s = window.__game.state(); return s.moves !== m || s.won; }, before, { timeout: 5000 }).catch(() => {});
    };
    T.tapSel = async (sel, hold) => { const b = await page.locator(sel).first().boundingBox(); await T.tapXY(b.x + b.width / 2, b.y + b.height / 2, hold); };
    T.start = async (L, resume) => { await page.evaluate(([L, r]) => window.__game.start(L, r), [L, !!resume]); await page.waitForFunction(L => window.__game.state().level === L, L); };
    return T;
  }

  // ---- [項1] an unfinished board survives a reload and the title offers to continue it ----
  {
    const T = await open();
    await T.start(40);
    for (const i of (await T.state()).rot.slice(0, 2)) await T.tapCell(i);
    await T.start(30);
    const s0 = await T.state();
    for (const i of s0.rot.slice(0, 4)) await T.tapCell(i);
    const before = await T.state();
    await T.page.reload();
    await T.page.waitForFunction(() => window.__game && document.getElementById('title').classList.contains('show'));
    const label = await T.page.textContent('#tPlay');
    await T.tapSel('#tPlay');
    await T.page.waitForFunction(() => window.__game.state().screen === 'game');
    const after = await T.state();
    check('mid: title says 繼續第 30 關（4 步）', label === '繼續第 30 關（4 步）', label);
    check('mid: reload resumes L30 with 4 moves and the same board', after.level === 30 && after.moves === 4 && after.ori.join() === before.ori.join(), { after: after.moves, lvl: after.level });
    // undo still works on the restored history
    await T.tapSel('#bUndo'); await T.page.waitForFunction(() => window.__game.state().moves === 3);
    check('mid: undo works after resume', (await T.state()).moves === 3);
    // win clears the saved board
    const s = await T.state(), lv = C.build(30, LEVELS[29][0]);
    const sol = C.solve(lv, Uint8Array.from(s.ori), 5e7, null);
    for (const i of lv.rot.filter(i => sol.ori[i] !== s.ori[i])) await T.tapCell(i);
    await T.page.waitForSelector('#result.show');
    const mid = await T.page.evaluate(() => JSON.parse(localStorage.getItem('light-path:mid') || '{}'));
    check('mid: cleared after the level is won', !mid[30], mid);
    // the title now offers the other saved board (the most recent one still unfinished)
    await T.page.reload();
    await T.page.waitForFunction(() => window.__game && document.getElementById('title').classList.contains('show'));
    const label2 = await T.page.textContent('#tPlay');
    check('mid: after winning L30 the title offers 繼續第 40 關（2 步）', label2 === '繼續第 40 關（2 步）', label2);
    check('mid: no errors', !T.errors.length, T.errors);
    await T.ctx.close();
  }

  // ---- [項1 細節] corrupt storage loads without errors and the game still finishes ----
  {
    const T = await open(390, 844, { 'light-path:progress': '{"stars":"x","best":5}', 'light-path:mid': '{"1":{"o":"zz","h":[999],"m":-3},"30":{"o":"0","h":[],"m":-1,"t":9e15}}', 'light-path:last': '999', 'light-path:seen': '[1]' });
    const label = await T.page.textContent('#tPlay');
    check('corrupt storage: a bad saved board is not offered on the title', label === '開始遊戲', label);
    await T.tapSel('#tPlay');
    await T.page.waitForFunction(() => window.__game.state().screen === 'game');
    const s = await T.state(), lv = C.build(s.level, LEVELS[s.level - 1][0]);
    const sol = C.solve(lv, Uint8Array.from(s.ori), 5e7, null);
    for (const i of lv.rot.filter(i => sol.ori[i] !== s.ori[i])) await T.tapCell(i);
    const shown = await T.page.waitForSelector('#result.show', { timeout: 8000 }).then(() => true, () => false);
    check('corrupt storage: level 1 starts fresh and the result card appears', s.level === 1 && s.moves === 0 && shown, { s: s.level, m: s.moves, shown });
    check('corrupt storage: no errors', !T.errors.length, T.errors);
    await T.ctx.close();
  }

  // ---- [項2/項7] cell sizes, rotated landscape board, taps land on the right mirror; help card on short screens ----
  for (const group of [[[390, 844, { 100: 44 }], [360, 640, { 75: 44, 100: 44 }], [375, 500, { 100: 40 }]], [[844, 390, { 75: 44, 100: 44 }], [640, 360, { 100: 38 }]]]) {
    const T = await open(group[0][0], group[0][1]);
    for (const [w, h, want] of group) {
      await T.page.setViewportSize({ width: w, height: h });
      await T.page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [w, h]);
      // help card: 知道了 visible without scrolling
      await T.tapSel('#tHelp'); await T.page.waitForSelector('#help.show');
      const q = await T.page.evaluate(() => { const r = document.getElementById('hClose').getBoundingClientRect(); return { t: r.top, b: r.bottom, h: r.height }; });
      check(`help ${w}x${h}: 知道了 on screen`, q.t >= 0 && q.b <= h && q.h >= 44, q);
      await T.tapSel('#hClose'); await T.page.waitForSelector('#title.show');
      for (const L of Object.keys(want).map(Number)) {
        await T.start(L);
        await T.page.waitForFunction(([w, h]) => { const r = document.getElementById('cv').getBoundingClientRect(); return r.width > 0 && innerWidth === w; }, [w, h]);
        const s = await T.state();
        check(`cells ${w}x${h} L${L} >= ${want[L]} px`, s.cs >= want[L], s.cs);
        const box = await T.page.evaluate(() => { const r = document.getElementById('cv').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
        const corners = await T.page.evaluate(n => [0, n - 1].map(i => window.__game.cellClient(i)), s.W * s.H);
        const inside = corners.every(p => p.x - s.cs / 2 >= box.l - 0.5 && p.x + s.cs / 2 <= box.r + 0.5 && p.y - s.cs / 2 >= box.t - 0.5 && p.y + s.cs / 2 <= box.b + 0.5);
        check(`board ${w}x${h} L${L} inside the stage`, inside, { corners, box });
        // tap mirrors at both ends of the board and in the middle; exactly that mirror turns
        let okTaps = 0;
        const pick = [s.rot[0], s.rot[s.rot.length - 1], s.rot[s.rot.length >> 1], s.rot[1]];
        for (const i of pick) {
          const b = await T.state(); await T.tapCell(i); const a = await T.state();
          const ch = a.ori.map((v, k) => v !== b.ori[k] ? k : -1).filter(k => k >= 0);
          if (ch.length === 1 && ch[0] === i && a.moves === b.moves + 1) okTaps++;
        }
        check(`taps ${w}x${h} L${L} turn the touched mirror (${pick.length})`, okTaps === pick.length, okTaps);
      }
      if (w > h) {
        const s = await T.state();
        check(`${w}x${h}: tall board is turned to fit the landscape screen`, s.rotated === true);
        const r = await T.page.evaluate(() => { const hud = document.getElementById('hud').getBoundingClientRect(), bar = document.getElementById('bar').getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect(); return { hudR: hud.right, barL: bar.left, stL: st.left, stR: st.right, stH: st.height }; });
        check(`${w}x${h}: HUD left, tools right, board full height`, r.hudR <= r.stL + 0.5 && r.barL >= r.stR - 0.5 && r.stH >= h - 1, r);
        await T.tapSel('#bPause'); await T.page.waitForSelector('#pause.show');
        const pc = await T.page.evaluate(() => [...document.querySelectorAll('#pause .btn')].map(b => { const q = b.getBoundingClientRect(); return { b: q.bottom, t: q.top, h: q.height, w: q.width }; }));
        check(`${w}x${h}: pause buttons on screen and >= 44 px`, pc.every(q => q.t >= 0 && q.b <= h && q.h >= 44 && q.w >= 44), pc);
      }
      await T.page.evaluate(() => document.getElementById('pTitle').click());
      await T.page.waitForSelector('#title.show');
    }
    check(`${group.map(g => g[0] + 'x' + g[1]).join(', ')}: no errors`, !T.errors.length, T.errors);
    await T.ctx.close();
  }

  const T = await open();
  // ---- [項2 小] 重來 can be undone (board button and pause menu) ----
  {
    await T.start(40);
    const s0 = await T.state();
    for (const i of s0.rot.slice(0, 5)) await T.tapCell(i);
    const s5 = await T.state();
    await T.tapSel('#bReset'); await T.page.waitForFunction(() => window.__game.state().moves === 0);
    const r = await T.state();
    check('reset: back to the start board', r.ori.join() === s0.ori.join() && r.moves === 0);
    await T.tapSel('#bUndo'); await T.page.waitForFunction(() => window.__game.state().moves === 5);
    const u = await T.state();
    check('reset: 復原 brings back the 5-move board', u.ori.join() === s5.ori.join() && u.moves === 5, u.moves);
    await T.tapSel('#bPause'); await T.page.waitForSelector('#pause.show');
    await T.tapSel('#pRestart'); await T.page.waitForFunction(() => window.__game.state().moves === 0 && window.__game.state().screen === 'game');
    await T.tapSel('#bUndo'); await T.page.waitForFunction(() => window.__game.state().moves === 5);
    check('reset: pause 重新開始 is undoable too', (await T.state()).ori.join() === s5.ori.join());
    // a reset that was undone survives a reload as well
    await T.tapSel('#bReset'); await T.page.waitForFunction(() => window.__game.state().moves === 0);
    await T.page.reload(); await T.page.waitForFunction(() => window.__game && document.getElementById('title').classList.contains('show'));
    await T.tapSel('#tPlay'); await T.page.waitForFunction(() => window.__game.state().screen === 'game');
    await T.tapSel('#bUndo'); await T.page.waitForFunction(() => window.__game.state().moves === 5, null, { timeout: 5000 }).catch(() => {});
    check('reset: undo of a reset works after reload', (await T.state()).ori.join() === s5.ori.join());
  }

  // ---- [項3/項5] hints follow a shortest path, but a board where a hint was used wins at most 2★ ----
  const winInfo = () => T.page.evaluate(() => ({ on: document.querySelectorAll('#rStars span.on').length, txt: document.getElementById('rInfo').textContent }));
  const hintLoop = async (max = 60) => { // press 提示 (real touch), wait for the highlight, turn that mirror
    let n = 0;
    while (!(await T.state()).won && n < max) {
      await T.tapSel('#bHint');
      await T.page.waitForFunction(() => window.__game.state().hint >= 0 || window.__game.state().won, null, { timeout: 60000 });
      const h = (await T.state()).hint; if (h < 0) break;
      await T.tapCell(h); n++;
    }
    return n;
  };
  for (const L of [50, 99]) {
    await T.start(L);
    if (L === 99) // same loop in-page for the 19-step level (on the stored path the hint is immediate)
      await T.page.evaluate(() => { let n = 0; while (!window.__game.state().won && n < 80) { document.getElementById('bHint').click(); const h = window.__game.state().hint; if (h < 0) break; window.__game.tap(h); n++; } });
    else await hintLoop();
    const s = await T.state();
    await T.page.waitForSelector('#result.show');
    const r = await winInfo();
    check(`hint-only L${L}: ${s.moves} moves = par ${s.par}, capped at 2★ with the reason shown`, s.won && s.moves === s.par && r.on === 2 && r.txt.includes('用了提示，最多兩星'), { moves: s.moves, par: s.par, r });
  }
  {
    await T.start(51);
    for (const i of OPT[50]) await T.tapCell(i);
    await T.page.waitForSelector('#result.show');
    const r = await winInfo();
    check('no hint: L51 in par moves gives 3★', r.on === 3 && !r.txt.includes('提示'), r);
  }
  // the cap survives 重來, 復原 and a reload; 再挑戰一次 clears it
  {
    await T.start(20);
    await T.tapSel('#bHint'); await T.page.waitForFunction(() => window.__game.state().hint >= 0);
    await T.tapCell((await T.state()).hint);
    await T.tapSel('#bReset'); await T.page.waitForFunction(() => window.__game.state().moves === 0);
    await T.tapSel('#bUndo'); await T.page.waitForFunction(() => window.__game.state().moves === 1);
    await T.tapSel('#bUndo'); await T.page.waitForFunction(() => window.__game.state().moves === 0);
    await T.page.reload(); await T.page.waitForFunction(() => window.__game && document.getElementById('title').classList.contains('show'));
    await T.tapSel('#tPlay'); await T.page.waitForFunction(() => window.__game.state().screen === 'game');
    const s = await T.state();
    check('hint cap: kept through 重來/復原/reload (0-move board still offered)', s.level === 20 && s.hintUsed === true, s);
    for (const i of OPT[19]) await T.tapCell(i);
    await T.page.waitForSelector('#result.show');
    let r = await winInfo();
    check('hint cap: par moves after a hint gives 2★', r.on === 2 && r.txt.includes('用了提示，最多兩星'), r);
    await T.tapSel('#rRetry'); await T.page.waitForFunction(() => ['game', 'intro'].includes(window.__game.state().screen) && window.__game.state().moves === 0);
    if ((await T.state()).screen === 'intro') { await T.tapSel('#iGo'); await T.page.waitForFunction(() => window.__game.state().screen === 'game'); }
    const sr = await T.state();
    check('hint cap: 再挑戰一次 the same day keeps the 2★ cap', sr.hintUsed === false && sr.hintCapped === true, sr);
    for (const i of OPT[19]) await T.tapCell(i);
    await T.page.waitForSelector('#result.show');
    r = await winInfo();
    check('hint cap: par on the retry still 2★ with the reason', r.on === 2 && r.txt.includes('提示'), r);
    // the day flag is dated: an entry from another day does not cap
    await T.page.evaluate(() => { localStorage.setItem('light-path:hinted', JSON.stringify({ 20: '2000-1-1' })); });
    await T.page.reload(); await T.page.waitForFunction(() => window.__game && document.getElementById('title').classList.contains('show'));
    await T.start(20);
    for (const i of OPT[19]) await T.tapCell(i);
    await T.page.waitForSelector('#result.show');
    r = await winInfo();
    check('hint cap: a hint from an earlier day no longer caps (3★)', r.on === 3, r);
  }
  // off the stored path the hint is computed in a Worker and is still a shortest solution
  {
    const L = 62;
    await T.start(L);
    const s0 = await T.state(), lv = C.build(L, LEVELS[L - 1][0]);
    for (const i of s0.rot.filter(i => !OPT[L - 1].includes(i)).slice(0, 3)) await T.tapCell(i);
    const s1 = await T.state();
    const min = C.solve(lv, Uint8Array.from(s1.ori), 5e8, null).cost;
    // in-page loop: press 提示, wait (the search may run in a Worker), turn the hinted mirror
    const n = await T.page.evaluate(async () => {
      let n = 0; const g = window.__game;
      while (!g.state().won && n < 80) {
        document.getElementById('bHint').click();
        // a quick hint shows at once; wait for the Worker's refinement before following it
        for (let w = 0; w < 1200 && (g.state().hint < 0 || g.state().hintBusy); w++) await new Promise(r => setTimeout(r, 50));
        const h = g.state().hint; if (h < 0) break; g.tap(h); n++;
      }
      return n;
    });
    check(`hint after a 3-move detour on L${L}: ${n} hinted moves = shortest ${min}`, (await T.state()).won && n === min, { n, min });
    await T.page.waitForSelector('#result.show');
  }

  // ---- [項4] stars: 2★ up to 2× par, result says how many moves short of 3★ ----
  {
    await T.start(12);
    const s0 = await T.state(), lv = C.build(12, LEVELS[11][0]);
    const extra = s0.rot.find(i => !OPT[11].includes(i));
    await T.tapCell(extra); await T.tapCell(extra); // +2 wasted moves
    for (const i of OPT[11]) await T.tapCell(i);
    await T.page.waitForSelector('#result.show');
    const st = await T.state();
    const r = await T.page.evaluate(() => ({ on: document.querySelectorAll('#rStars span.on').length, txt: document.getElementById('rInfo').textContent }));
    check(`stars: ${st.moves} moves on par ${lv.par ?? st.par} gives 2★`, st.moves === st.par + 2 && st.moves <= st.par * 2 && r.on === 2, r);
    check('stars: result says 差 2 步三星', r.txt.includes('差 2 步三星'), r.txt);
  }

  // ---- [項5/項6] new pieces: one card listing every piece met for the first time; toasts stay off the board ----
  {
    const pieces = L => { const lv = C.build(L, LEVELS[L - 1][0]), out = new Set();
      for (let i = 0; i < lv.N; i++) { const t = lv.type[i]; if (t === C.TARGET && (lv.mask[i] & (lv.mask[i] - 1))) out.add('混色目標');
        const nm = { [C.BLOCK]: '石塊', [C.FMIRROR]: '鉚釘固定鏡', [C.CRYSTAL]: '禁觸晶體', [C.SPLIT]: '分光鏡', [C.FILTER]: '濾色片', [C.PRISM]: '稜鏡' }[t]; if (nm) out.add(nm); }
      return out; };
    const reset = async (st, unlock) => {
      // the game saves an in-progress board on pagehide, so the storage is rewritten after that, as the page unloads
      await T.page.evaluate(([st, unlock]) => { const f = () => { for (const k of ['seen', 'progress', 'mid', 'unlockAll']) localStorage.removeItem('light-path:' + k);
        if (st) localStorage.setItem('light-path:progress', JSON.stringify(st)); if (unlock) localStorage.setItem('light-path:unlockAll', 'true'); };
        addEventListener('pagehide', f); document.addEventListener('visibilitychange', f); }, [st, unlock]);
      await T.page.reload(); await T.page.waitForFunction(() => window.__game && document.getElementById('title').classList.contains('show'));
    };
    const openTile = async (L, hold) => { // like a player: title or pause -> 選擇關卡 -> tile
      const sc = (await T.state()).screen;
      if (sc === 'game') { await T.tapSel('#bPause'); await T.page.waitForSelector('#pause.show'); await T.tapSel('#pSelect'); }
      else if (sc === 'result') await T.tapSel('#rSelect');
      else await T.tapSel('#tSelect');
      await T.page.waitForSelector('#select.show');
      await T.page.locator(`.tile[data-l="${L}"]`).scrollIntoViewIfNeeded();
      await T.tapSel(`.tile[data-l="${L}"]`, hold);
      await T.page.waitForFunction(L => window.__game.state().level === L && ['game', 'intro'].includes(window.__game.state().screen), L);
    };
    const card = () => T.page.evaluate(() => document.getElementById('intro').classList.contains('show') ? [...document.querySelectorAll('#introList b')].map(b => b.textContent) : null);
    // cleared L1-L74 already: every piece was met, so no card on L75
    const stars = {}; for (let L = 1; L <= 74; L++) stars[L] = 1;
    await reset({ stars, best: {} });
    await openTile(75);
    check('intro: L75 after clearing L1-74 shows no new-piece card', (await card()) === null && (await T.state()).screen === 'game');
    // a new player jumping to L40 gets one card with every piece of L40 (prism included); slow 0.6 s / 1 s presses
    await reset(null, true);
    await openTile(40, 600);
    const c40 = await card(), want40 = [...pieces(40)].sort();
    check('intro: L40 card lists every piece of L40 at once', c40 && c40.slice().sort().join() === want40.join() && c40.includes('稜鏡'), { c40, want40 });
    await T.tapSel('#iGo', 1000);
    await T.page.waitForFunction(() => window.__game.state().screen === 'game');
    const sg = await T.state();
    check('intro: 開始 (held 1 s) starts L40 once, board untouched', sg.level === 40 && sg.moves === 0, sg);
    await openTile(75);
    const c75 = await card(), want75 = [...pieces(75)].filter(x => !pieces(40).has(x)).sort();
    check('intro: L75 then lists only the pieces not shown on L40', want75.length ? c75 && c75.slice().sort().join() === want75.join() : c75 === null, { c75, want75 });
    if (c75) { await T.tapSel('#iGo'); await T.page.waitForFunction(() => window.__game.state().screen === 'game'); }
    await openTile(75);
    check('intro: no card the second time', (await card()) === null);
    // L1 hint toast sits over the HUD, not the board, and hides when the game is paused
    await reset(null);
    await T.tapSel('#tPlay');
    await T.page.waitForFunction(() => document.getElementById('toast').classList.contains('show'), null, { timeout: 5000 });
    const ov = await T.page.evaluate(() => { const t = document.getElementById('toast').getBoundingClientRect(), s = window.__game.state();
      const a = window.__game.cellClient(0), z = window.__game.cellClient(s.W * s.H - 1), h = s.cs / 2;
      const bx = { l: Math.min(a.x, z.x) - h, r: Math.max(a.x, z.x) + h, t: Math.min(a.y, z.y) - h, b: Math.max(a.y, z.y) + h };
      return { t: { l: t.left, r: t.right, t: t.top, b: t.bottom }, bx, overlap: !(t.right <= bx.l || t.left >= bx.r || t.bottom <= bx.t || t.top >= bx.b) }; });
    check('toast: level-start toast does not cover the board', !ov.overlap, ov);
    await T.tapSel('#bPause'); await T.page.waitForSelector('#pause.show');
    check('toast: hidden while paused', !(await T.page.evaluate(() => document.getElementById('toast').classList.contains('show'))));
    await T.tapSel('#pResume'); await T.page.waitForFunction(() => window.__game.state().screen === 'game');
  }

  // ---- [操控] one touch = one turn: 16 alternating taps between two far mirrors ----
  {
    await T.start(50);
    const s = await T.state(), a = s.rot[0], b = s.rot[s.rot.length - 1];
    const ca = await T.page.evaluate(i => window.__game.cellClient(i), a), cb = await T.page.evaluate(i => window.__game.cellClient(i), b);
    for (let k = 0; k < 16; k++) { const c = k & 1 ? cb : ca; await T.tapXY(c.x, c.y); }
    await T.page.waitForFunction(m => window.__game.state().moves >= m, s.moves + 16, { timeout: 5000 }).catch(() => {});
    const e = await T.state();
    check('touch: 16 taps = 16 moves, board back to start', e.moves === s.moves + 16 && e.ori.join() === s.ori.join(), e.moves - s.moves);
  }
  // slow presses (0.6 s and 1 s) turn once; a second finger landing while the first is still down also counts once
  {
    const s = await T.state(), a = s.rot[1], b = s.rot[s.rot.length - 2];
    const ca = await T.page.evaluate(i => window.__game.cellClient(i), a), cb = await T.page.evaluate(i => window.__game.cellClient(i), b);
    await T.tapXY(ca.x, ca.y, 600); await T.tapXY(cb.x, cb.y, 1000);
    await T.page.waitForFunction(m => window.__game.state().moves >= m, s.moves + 2, { timeout: 5000 }).catch(() => {});
    const m2 = (await T.state()).moves;
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ca.x, y: ca.y, id: 1 }] });
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ca.x, y: ca.y, id: 1 }, { x: cb.x, y: cb.y, id: 2 }] });
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: ca.x, y: ca.y, id: 1 }] });
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await T.page.waitForFunction(m => window.__game.state().moves >= m, m2 + 2, { timeout: 5000 }).catch(() => {});
    const e = await T.state();
    check('touch: 0.6 s and 1 s presses = 1 move each', m2 === s.moves + 2, m2 - s.moves);
    check('touch: two overlapping fingers = 2 moves', e.moves === m2 + 2 && e.ori.join() === s.ori.join(), e.moves - m2);
  }
  // [否決] buttons work while another finger is down (on the board or on the HUD); holds still act once
  {
    const send = (type, pts) => T.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const ctr = async sel => { const b = await T.page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    for (const [where, holdSel] of [['board', null], ['HUD', '#lvinfo']]) {
      await T.start(60);
      const s0 = await T.state();
      for (const i of s0.rot.slice(0, 8)) await T.tapCell(i);
      const cvb = await T.page.locator('#cv').boundingBox();
      const A = holdSel ? await ctr(holdSel) : { x: cvb.x + 3, y: cvb.y + 3 }, U = await ctr('#bUndo');
      const m0 = (await T.state()).moves;
      await send('touchStart', [{ ...A, id: 1 }]);
      for (let k = 0; k < 8; k++) { // finger B taps 復原 while A stays down
        await send('touchStart', [{ ...A, id: 1 }, { ...U, id: 2 }]);
        await send('touchEnd', [{ ...U, id: 2 }]);
      }
      await T.page.waitForFunction(m => window.__game.state().moves <= m - 8, m0, { timeout: 5000 }).catch(() => {});
      await send('touchEnd', []);
      const e = await T.state();
      check(`second finger (A on the ${where}): 8 taps on 復原 undo 8 moves`, e.moves === m0 - 8 && e.ori.join() === s0.ori.join(), { m0, m: e.moves });
    }
    // with A down, B on 重來 and 提示 also work
    const s1 = await T.state(); await T.tapCell(s1.rot[0]); await T.tapCell(s1.rot[1]);
    const cvb = await T.page.locator('#cv').boundingBox(), A = { x: cvb.x + 3, y: cvb.y + 3 };
    await send('touchStart', [{ ...A, id: 1 }]);
    const R = await ctr('#bReset'); await send('touchStart', [{ ...A, id: 1 }, { ...R, id: 2 }]); await send('touchEnd', [{ ...R, id: 2 }]);
    await T.page.waitForFunction(() => window.__game.state().moves === 0, null, { timeout: 5000 }).catch(() => {});
    const Hn = await ctr('#bHint'); await send('touchStart', [{ ...A, id: 1 }, { ...Hn, id: 3 }]); await send('touchEnd', [{ ...Hn, id: 3 }]);
    await T.page.waitForFunction(() => window.__game.state().hint >= 0, null, { timeout: 5000 }).catch(() => {});
    await send('touchEnd', []);
    const s2 = await T.state();
    check('second finger: 重來 and 提示 work too', s2.moves === 0 && s2.hint >= 0, s2);
    // single taps and 0.6 s / 1 s holds on 復原 each run exactly once (no doubled click)
    for (const i of s2.rot.slice(0, 3)) await T.tapCell(i);
    const m3 = (await T.state()).moves;
    await T.tapSel('#bUndo'); await T.tapSel('#bUndo', 600); await T.tapSel('#bUndo', 1000);
    await T.page.waitForFunction(m => window.__game.state().moves <= m - 3, m3, { timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300)); // any late duplicate would show up here
    check('復原: tap, 0.6 s and 1 s holds = 3 undos', (await T.state()).moves === m3 - 3, (await T.state()).moves - m3);
  }
  // reset is ignored once the level is won (the win is kept)
  {
    await T.start(21);
    const s = await T.state();
    for (const i of OPT[20]) await T.tapCell(i);
    await T.tapSel('#bReset');
    await T.page.waitForSelector('#result.show');
    const p = await T.page.evaluate(() => window.__game.progress());
    check('win: 重來 during the win delay does not undo the win', p.stars[21] === 3, p.stars[21]);
  }
  check('main session: no errors', !T.errors.length, T.errors);
  await T.ctx.close();
  await browser.close();
  console.log(`${fails ? 'FAIL' : 'PASS'}: ${passes} passed, ${fails} failed (${((Date.now() - T0) / 1000).toFixed(1)} s)`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
