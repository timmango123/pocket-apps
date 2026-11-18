// 合成波節拍：上架複審 R1 修正的回歸測試（node tests.js，約 60 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http。
// 1) check.js：100 關譜面可玩（同軌 ≥120ms、單手 ≥90ms 且每秒 ≤12 下）且逐關變難
// 2) 核心模擬（遊戲自己的譜面與判定規則）：手殘能過第 1 關、卡在後段；世界級能過 91–100 關；曲風變化
// 3) 頁面：另一指按著時按鈕照樣有反應（設定、暫停）、軌道判定不受影響、單擊／長按只動作一次、點按後的 detail 0
//    click 不重複、換畫面時手指下的新按鈕不動作、鍵盤 Enter、壞掉的存檔、倒數中切到背景、靜音、第 1 關失敗提示、
//    觸控時按鍵不顯示 DFJK、橫式音符不蓋住按鍵
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), { spawnSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

// ---------- core simulation (same rules as the page: windows × ws, miss −pen, neighbour-lane assist) ----------
const html = fs.readFileSync(APP, 'utf8');
const RT = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn RT;')();
const TIERS = { clumsy: { posS: 40, tS: 0.12, mis: 0.15, hand: 0.22, rel: 0.12 }, world: { posS: 4, tS: 0.012, mis: 0.003, hand: 0.09, rel: 0.012 } };
const LANES = { cx: 195, lw: 183.3 / 2 };
function simLevel(L, tier, seed) {
  const C = RT.build(L), P = C.P, T = TIERS[tier], r = RT.rng(seed), nrm = () => { let a = 0; for (let i = 0; i < 6; i++) a += r(); return (a - 3) * Math.SQRT2; };
  const ns = C.notes.map(n => ({ ...n })), acts = [], hl = [-9, -9];
  for (const n of ns) {
    const h = n.lane < 2 ? 0 : 1, x0 = LANES.cx + (n.lane - 1.5) * LANES.lw;
    if (r() < T.mis) { const k = r(); if (k < 0.4) continue; const t = n.t + (r() < 0.5 ? -1 : 1) * (0.16 + r() * 0.15); acts.push({ t, x: x0, up: t + 0.05, n }); hl[h] = t; continue; }
    let t = n.t + nrm() * T.tS; if (t < hl[h] + T.hand) t = hl[h] + T.hand;
    const up = n.type === 1 ? Math.max(t + 0.05, n.end + 0.03 + nrm() * T.rel) : t + 0.05;
    acts.push({ t, x: x0 + nrm() * T.posS, up, n }); hl[h] = n.type === 1 ? Math.max(t, up - T.hand) : t;
  }
  acts.sort((a, b) => a.t - b.t);
  const cnt = [0, 0, 0, 0]; let life = 100, dead = false;
  const apply = (n, j) => { n.j = j; cnt[j]++; life = j < 3 ? Math.min(100, life + [1, 0, -1][j]) : life - P.pen; if (life <= 0) dead = true; };
  const ev = acts.map(a => ({ t: a.t, a })).concat(ns.map(n => ({ t: n.t + RT.WIN.gd * P.ws + 0.2, n }))).sort((a, b) => a.t - b.t);
  const W = RT.WIN.gd * P.ws, find = (ln, t) => ns.find(n => n.j == null && n.lane === ln && Math.abs(n.t - t) <= W);
  for (const e of ev) {
    if (dead) break;
    if (e.n) { if (e.n.j == null) apply(e.n, 3); continue; }
    const a = e.a, x = a.x, lane = x < LANES.cx - LANES.lw ? 0 : x < LANES.cx ? 1 : x < LANES.cx + LANES.lw ? 2 : 3;
    let c = find(lane, a.t);
    if (!c && P.assist > 0) { const bs = [LANES.cx - LANES.lw, LANES.cx, LANES.cx + LANES.lw]; let bi = 0; for (let i = 1; i < 3; i++) if (Math.abs(x - bs[i]) < Math.abs(x - bs[bi])) bi = i; const o = x < bs[bi] ? bi + 1 : bi; if (o !== lane && Math.abs(x - bs[bi]) <= P.assist * LANES.lw * 0.5) c = find(o, a.t); }
    if (!c) continue;
    apply(c, RT.judgeOf(a.t - c.t, P.ws));
    if (c.type === 1 && c.j < 2 && a.up < c.end - 0.12) { cnt[c.j]--; cnt[2]++; c.j = 2; }
  }
  const acc = RT.accOf(cnt); return !dead && acc >= P.need;
}
const passes = (L, tier, n = 5) => { let p = 0; for (let s = 1; s <= n; s++) p += simLevel(L, tier, s * 1000 + L) ? 1 : 0; return p; };

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(APP)); });
  srv.unref();
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const t0 = Date.now();
  const chk = spawnSync(process.execPath, [path.join(__dirname, 'check.js')], { encoding: 'utf8', timeout: 120000 });
  assert(chk.status === 0 && /ALL 100 LEVELS PASS/.test(chk.stdout), '100 關譜面可玩且逐關變難（check.js）');
  if (chk.status !== 0) console.log(chk.stdout.split('\n').filter(l => !/│|┌|├|└/.test(l)).join('\n'));

  // ---- 難度：前段寬鬆、手殘能過第 1 關、世界級能過最後 10 關、單手每秒 ≤ 12 下
  const P1 = RT.params(1), P23 = RT.params(23);
  assert(P1.need <= 55 && P1.ws >= 1.5 && P1.pen <= 4, `第 1 關：門檻 ${P1.need}%、判定窗 ×${P1.ws}、失誤扣 ${P1.pen}`);
  eq([P23.need, P23.ws, P23.pen, P23.assist], [74, 1, 8, 0], '第 23 關起恢復標準判定');
  let ramp = true; for (let L = 2; L <= 23; L++) { const a = RT.params(L - 1), b = RT.params(L); if (b.need < a.need || b.need - a.need > 3 || b.ws > a.ws || a.ws - b.ws > 0.12) ramp = false; }
  assert(ramp, '暖身逐關慢慢收緊（門檻每關最多 +3%、判定窗每關最多 −0.12）');
  const cl = [1, 2, 3].map(L => passes(L, 'clumsy'));
  assert(cl[0] >= 4 && cl[1] >= 3 && cl[2] >= 3, `手殘（σ120ms、瞄準 σ40px、15% 失手）能過第 1–3 關（5 次中 ${cl.join('/')} 次）`);
  const clr = []; for (let L = 1; L <= 14; L++) clr.push(passes(L, 'clumsy'));
  let maxDrop = 0; for (let i = 1; i < clr.length; i++) maxDrop = Math.max(maxDrop, clr[i - 1] - clr[i]);
  assert(maxDrop <= 2 && clr.slice(0, 8).every(p => p >= 3), `手殘第 1–14 關（各 5 次）：${clr.join(' ')}，相鄰關最多少 ${maxDrop} 次`);
  const cl20 = [20, 30].map(L => passes(L, 'clumsy'));
  assert(cl20.every(p => p === 0), `手殘卡在後段（第 20、30 關 ${cl20.join('/')}/5）`);
  const top = []; for (let L = 91; L <= 100; L++) top.push(passes(L, 'world', 3));
  assert(top.every(p => p >= 2), `世界級（每拇指最快 90ms）能過第 91–100 關（${top.join(' ')}，各 3 次）`);
  let thumb = 0; for (let L = 85; L <= 100; L++) thumb = Math.max(thumb, RT.check(RT.build(L)).maxThumbRate);
  assert(thumb <= 12, `第 85–100 關單手最多每秒 ${thumb} 下`);
  // ---- 曲子變化
  const combos = new Set(), styles = new Set();
  for (let L = 1; L <= 100; L++) { const C = RT.build(L); combos.add([C.style, C.prog, C.drum].join('/')); styles.add(C.styleName); }
  assert(combos.size >= 60 && styles.size >= 6, `100 關有 ${combos.size} 種曲風×和弦×鼓組組合、${styles.size} 種曲風`);
  const kinds = new Set(RT.build(40).mus.map(e => e.k).concat(RT.build(41).mus.map(e => e.k), RT.build(42).mus.map(e => e.k), RT.build(43).mus.map(e => e.k)));
  assert(kinds.has('pluck') || kinds.has('stab'), '有琶音／和弦切音聲部');

  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, storage = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); for (const k in s) localStorage.setItem(k, s[k]); } }, storage);
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    // CDP touchStart/touchMove list every finger that is down; touchEnd releases only the ones it lists
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const box = sel => p.evaluate(s => { const e = document.querySelector(s); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
    const scr = () => p.evaluate(() => ['title', 'select', 'start', 'pause', 'result', 'settings', 'calib', 'help'].filter(k => !document.getElementById(k).hidden).join(',') || 'play');
    const settled = sel => p.waitForFunction(s => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return false; const c = e.closest('.card'); return !(c && c.getAnimations().some(a => a.playState === 'running')); }, sel);
    const tap = async (sel, hold = 50, id = 1) => { await settled(sel); const b = await box(sel); await T('touchStart', [[b.cx, b.cy, id]]); await sleep(hold); await T('touchEnd', [[b.cx, b.cy, id]]); };
    const st = () => p.evaluate(() => window.__game.state());
    const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('rhythm.' + k)), k);
    const waitScr = (s, timeout = 5000) => p.waitForFunction(s => (['title', 'select', 'start', 'pause', 'result', 'settings', 'calib', 'help'].filter(k => !document.getElementById(k).hidden).join(',') || 'play') === s, s, { timeout });
    return { ctx, p, cdp, T, box, scr, tap, st, ls, waitScr, settled };
  }
  const startLevel = async (t, n) => {
    await t.tap('#tSelect'); await t.waitScr('select');
    if ((await t.p.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await t.tap('#unlockSw'); await t.p.waitForSelector('#unlockSw[aria-checked="true"]'); }
    await t.tap(`.lt[data-n="${n}"]`); await t.waitScr('start'); await t.tap('#sGo'); await t.waitScr('play');
  };

  // 1. 壞掉的存檔：不丟錯，退回預設；合法的舊存檔照常載入
  {
    const t = await open(390, 844, { 'rhythm.daily': 'null', 'rhythm.best': '[1,2]', 'rhythm.settings': '{"hs":9,"prate":3,"vol":"loud","theme":"neon","vib":"y"}', 'rhythm.progress': '{"max":"x"}', 'rhythm.offset': '"abc"' });
    await t.tap('#tDaily'); await t.waitScr('start');
    eq(await t.p.textContent('#sBest'), '今日最佳：尚無紀錄', 'rhythm.daily = null 時每日一曲照常打開');
    await t.tap('#sBack2'); await t.waitScr('title');
    await t.tap('#tPlay'); await t.waitScr('start');
    eq([await t.p.textContent('#sTitle'), await t.p.textContent('#sBest')], ['第 1 關', '尚未通關'], 'rhythm.best = [1,2] 時「開始」照常打開');
    await t.tap('#sBack2'); await t.waitScr('select'); await t.tap('#sBack'); await t.waitScr('title');
    await t.tap('#tSet'); await t.waitScr('settings');
    eq(await t.p.$$eval('#segHs button[aria-pressed="true"], #segRate button[aria-pressed="true"], #segTheme button[aria-pressed="true"]', b => b.map(x => x.textContent)), ['3', '0.75×', '跟隨系統'], '設定超出範圍時用預設值（HiSpeed 3、0.75×、跟隨系統）');
    eq(await t.p.inputValue('#vol'), '80', '音量不是數字時用預設 80');
    await t.ctx.close();
    const u = await open(390, 844, { 'rhythm.best': '{"1":{"g":"S","acc":99.1,"sc":12000,"fc":true,"ap":false,"mc":36},"7":{"acc":"x"}}', 'rhythm.progress': '{"max":2}', 'rhythm.daily': '{"20261115":[{"sc":5000,"acc":91.5,"g":"A","ts":1}],"bad":3}', 'rhythm.settings': '{"hs":2,"prate":0.5,"vol":40,"theme":"dark","vib":false}' });
    eq(await u.p.textContent('#tLv'), '2', '舊存檔的進度照常載入');
    await u.tap('#tSelect'); await u.waitScr('select');
    eq([await u.p.textContent('.lt[data-n="1"] .gr'), await u.p.textContent('.lt[data-n="7"] .gr')], ['S·FC', ''], '舊存檔的最佳紀錄照常顯示，壞的那筆略過');
    await u.tap('#sBack'); await u.waitScr('title'); await u.tap('#tSet'); await u.waitScr('settings');
    eq(await u.p.$$eval('#segHs button[aria-pressed="true"], #segRate button[aria-pressed="true"]', b => b.map(x => x.textContent)), ['2', '0.5×'], '舊設定照常載入');
    await u.ctx.close();
  }

  // 2. 另一指按著時，第二指點按鈕照樣動作（每下只動作一次）；按住 0.6／1 秒也只動作一次
  {
    const t = await open();
    for (const ms of [50, 600, 1000]) { await t.tap('#tHelp', ms); await t.waitScr('help'); await t.tap('#helpOk'); await t.waitScr('title'); }
    assert(true, '單擊、按住 0.6 秒、1 秒都切換畫面一次');
    await t.tap('#tSet'); await t.waitScr('settings'); await t.settled('#vibSw');
    const vb = await t.box('#vibSw'); let flips = 0, prev = await t.p.getAttribute('#vibSw', 'aria-checked');
    await t.T('touchStart', [[20, 20, 7]]);
    for (let i = 0; i < 6; i++) {
      await t.T('touchStart', [[20, 20, 7], [vb.cx, vb.cy, 20 + i]]); await sleep(50); await t.T('touchEnd', [[vb.cx, vb.cy, 20 + i]]); await sleep(120);
      const v = await t.p.getAttribute('#vibSw', 'aria-checked'); if (v !== prev) flips++; prev = v;
    }
    const h5 = await t.box('#segHs button[data-v="4"]');
    await t.T('touchStart', [[20, 20, 7], [h5.cx, h5.cy, 20]]); await sleep(50); await t.T('touchEnd', [[h5.cx, h5.cy, 20]]); await sleep(150);
    await t.T('touchEnd', [[20, 20, 7]]);
    eq([flips, (await t.ls('settings')).hs], [6, 5], '一指放在左上角時，震動開關點 6 下切 6 次、HiSpeed 點到 5');
    // tap then the browser's own detail-0 click on the same control, its edge and whatever is under the finger: acts once
    const before = await t.p.getAttribute('#vibSw', 'aria-checked');
    await t.T('touchStart', [[vb.cx, vb.cy, 30]]); await sleep(40); await t.T('touchEnd', [[vb.cx, vb.cy, 30]]);
    await t.p.evaluate(b => { const c = (el, x, y) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); const v = document.getElementById('vibSw'); c(v, b.cx, b.cy); c(v, b.x + 1, b.y + 1); c(document.elementFromPoint(b.cx, b.cy), b.cx, b.cy); }, vb);
    await sleep(150);
    assert((await t.p.getAttribute('#vibSw', 'aria-checked')) !== before && (await t.ls('settings')).vib === (before !== 'true'), '點按後補上的 detail 0 click（本身、邊緣、手指下）不會再切一次');
    // a lone detail-0 click (assistive tech) long after the tap acts once
    await sleep(850);
    const b2 = await t.p.getAttribute('#vibSw', 'aria-checked');
    await t.p.evaluate(() => document.getElementById('vibSw').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    assert((await t.p.getAttribute('#vibSw', 'aria-checked')) !== b2, '沒有點按時，單獨的 detail 0 click 照常動作一次');
    // screen change: tap 完成, then a detail-0 click lands on whatever is now under the finger (title buttons): nothing runs
    await t.settled('#setOk'); const ok = await t.box('#setOk');
    await t.T('touchStart', [[ok.cx, ok.cy, 40]]); await sleep(40); await t.T('touchEnd', [[ok.cx, ok.cy, 40]]);
    await t.p.evaluate(b => { const e = document.elementFromPoint(b.cx, b.cy); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, ok);
    await sleep(200); eq(await t.scr(), 'title', '換畫面後補上的 click 不會按到新畫面的按鈕');
    // keyboard: Enter on a focused button acts once, even right after a tap
    await t.tap('#tHelp'); await t.waitScr('help');
    await t.p.focus('#helpOk'); await t.p.keyboard.press('Enter'); await sleep(150);
    eq(await t.scr(), 'title', '鍵盤 Enter 在點按後 800ms 內也照常動作');
    // the title mute button: one tap, saved
    await t.tap('#tMute'); await sleep(100);
    eq([await t.p.getAttribute('#tMute', 'aria-pressed'), (await t.ls('settings')).mute], ['true', true], '標題的靜音鈕一下就靜音並保存');
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    eq(await t.p.getAttribute('#tMute', 'aria-pressed'), 'true', '重新整理後仍是靜音');
    await t.tap('#tMute'); await sleep(100);
    eq((await t.ls('settings')).mute, false, '再點一下恢復聲音');
    await t.ctx.close();
  }

  // 2b. 只用 click（輔助工具、滑鼠鍵盤以外）：點按後 900 ms，換到的新畫面上單獨的 click 照常動作
  {
    const t = await open();
    for (const [go, back, mid] of [['#tHelp', '#helpOk', 'help'], ['#tSelect', '#sBack', 'select'], ['#tSet', '#setOk', 'settings']]) {
      await t.tap(go); await t.waitScr(mid); await sleep(900);
      await t.p.evaluate(b => document.querySelector(b).click(), back); await sleep(100);
      eq(await t.scr(), 'title', `點 ${go} 後 900 ms，${back} 的單獨 click 會回標題`);
    }
    // whole flow by click only: 選擇關卡 -> 第 1 關 -> 返回 -> 返回
    for (const [sel, want] of [['#tSelect', 'select'], ['.lt[data-n="1"]', 'start'], ['#sBack2', 'select'], ['#sBack', 'title']]) {
      await t.p.evaluate(s => document.querySelector(s).click(), sel); await sleep(80);
      eq(await t.scr(), want, `只用 click：${sel} → ${want}`);
    }
    await t.ctx.close();
  }

  // 3. 遊戲中：一指壓著軌道時按暫停；軌道判定照常；暫停卡出現在手指下時放開不會繼續；倒數中切到背景會留在暫停
  {
    const t = await open();
    await startLevel(t, 1);
    eq((await t.p.evaluate(() => window.__game.lanes())).keyLabels, false, '只用觸控時軌道按鍵不顯示 D F J K');
    const ln = await t.p.evaluate(() => window.__game.lanes()), chart = await t.p.evaluate(() => window.__game.chart());
    // first note: tap its lane at its time (wall clock from the game's epoch)
    const n0 = chart[0], epoch = await t.p.evaluate(() => window.__game.epoch()), x0 = ln.cx + (n0.lane - 1.5) * ln.lw;
    while (Date.now() < epoch + n0.t * 1000 - 3) await sleep(1);
    await t.T('touchStart', [[x0, ln.padY, 50]]); await sleep(30); await t.T('touchEnd', [[x0, ln.padY, 50]]);
    await t.p.waitForFunction(() => window.__game.state().cnt.reduce((a, b) => a + b, 0) >= 1);
    const c1 = (await t.st()).cnt; assert(c1[0] + c1[1] === 1 && c1[3] === 0, `準時點軌道：判定 ${JSON.stringify(c1)}`);
    // finger held on lane D, second finger taps pause
    await t.T('touchStart', [[ln.cx - 1.5 * ln.lw, ln.padY, 60]]); await sleep(80);
    await t.settled('#bPause'); const pb = await t.box('#bPause');
    await t.T('touchStart', [[ln.cx - 1.5 * ln.lw, ln.padY, 60], [pb.cx, pb.cy, 61]]); await sleep(50); await t.T('touchEnd', [[pb.cx, pb.cy, 61]]);
    await t.waitScr('pause', 2000).catch(() => {});
    eq(await t.scr(), 'pause', '一指壓著 D 軌時另一指按暫停，遊戲會暫停');
    await t.T('touchEnd', [[ln.cx - 1.5 * ln.lw, ln.padY, 60]]);
    await sleep(200);
    eq(await t.scr(), 'pause', '放開壓著軌道的手指後仍停在暫停畫面');
    // resume with a second finger while one rests
    await t.settled('#pResume'); const rb = await t.box('#pResume');
    await t.T('touchStart', [[20, 20, 70]]); await sleep(40);
    await t.T('touchStart', [[20, 20, 70], [rb.cx, rb.cy, 71]]); await sleep(50); await t.T('touchEnd', [[rb.cx, rb.cy, 71]]); await t.T('touchEnd', [[20, 20, 70]]);
    await t.p.waitForFunction(() => window.__game.state().playing, null, { timeout: 5000 });
    assert(true, '另一指放著時按「繼續」也會倒數後繼續');
    // finger already down where 繼續 will appear; pause by keyboard; lifting it must not resume
    await t.T('touchStart', [[rb.cx, rb.cy, 80]]); await sleep(60);
    await t.p.keyboard.press('Escape'); await t.waitScr('pause');
    await t.T('touchEnd', [[rb.cx, rb.cy, 80]]); await sleep(250);
    eq(await t.scr(), 'pause', '暫停卡出現前就按下的手指，放開時不會按到「繼續」');
    // countdown, then the tab goes to the background: stays paused
    await t.tap('#pResume');
    await sleep(150);
    await t.p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const a = await t.st(); await sleep(3200); const b = await t.st();
    eq([await t.scr(), b.playing, +b.songT.toFixed(3) === +a.songT.toFixed(3)], ['pause', false, true], '倒數中切到背景：倒數結束後仍停在暫停、歌曲不動');
    await t.p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    // the pause card has a mute toggle
    await t.tap('#pMute'); await sleep(100);
    eq([(await t.ls('settings')).mute, await t.p.textContent('#pMuteTx')], [true, '開啟聲音'], '暫停畫面一下就能靜音');
    await t.tap('#pMute'); await sleep(100);
    // lost level 1 -> practice hint; keyboard use shows the key letters
    await t.tap('#pResume'); await t.p.waitForFunction(() => window.__game.state().playing, null, { timeout: 5000 });
    await t.p.keyboard.press('KeyD'); await sleep(50);
    eq((await t.p.evaluate(() => window.__game.lanes())).keyLabels, true, '用過實體鍵盤後才顯示 D F J K');
    await t.p.evaluate(() => window.__game.failNow()); await t.waitScr('result');
    assert(await t.p.isVisible('#rHint'), '第 1 關失敗時提示練習模式與 HiSpeed');
    // the result card shows its buttons only to a finger that went down after it appeared: tap 練習模式 works
    await t.tap('#rPrac'); await t.waitScr('play');
    eq((await t.st()).screen, 'play', '結算畫面的「練習模式」可以點');
    await t.ctx.close();
  }

  // 4. 橫式：判定線上的音符不會蓋到按鍵框；標題畫面不畫軌道按鍵
  {
    const t = await open(844, 390);
    eq((await t.p.evaluate(() => window.__game.lanes())).padsDrawn, false, '標題畫面不畫軌道按鍵（不會從按鈕後面透出來）');
    await startLevel(t, 56);
    const l = await t.p.evaluate(() => window.__game.lanes());
    assert(l.noteW <= 100, `橫式判定線上的音符寬 ${Math.round(l.noteW)}px（軌道寬 ${Math.round(l.lw)}px）`);
    assert(l.yJ + l.noteH / 2 + 4 < l.padTop, `橫式音符下緣 ${Math.round(l.yJ + l.noteH / 2 + 4)} 在按鍵上緣 ${Math.round(l.padTop)} 之上`);
    await t.ctx.close();
  }

  await browser.close();
  eq(errors, [], '沒有 page error／console error');
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
