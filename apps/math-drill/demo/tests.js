// 九九乘法練習：上架評分 toFix 的回歸測試（node tests.js，約 30 秒）
// 觸控用真實 CDP Input.dispatchTouchEvent；等待都看條件（畫面、Q 狀態、ghostUntil），不靠固定秒數。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'math-drill-'));
const WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const T = { timeout: 15000 };

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opt });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL_); await p.waitForFunction(() => typeof Q !== 'undefined' && typeof cfg === 'object');
    const cdp = await ctx.newCDPSession(p);
    return { ctx, p, cdp };
  }
  const screen = p => p.evaluate(() => ['s-setup', 's-quiz', 's-result', 's-stats'].find(s => !document.getElementById(s).hidden));
  const center = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); const r0 = e.getBoundingClientRect(); if (r0.top < 0 || r0.bottom > innerHeight) e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q.x, y: q.y, id: q.id || 0, radiusX: 4, radiusY: 4, force: 1 })) });
  async function tap(p, cdp, sel) { const c = await center(p, sel); await touch(cdp, 'touchStart', [c]); await touch(cdp, 'touchEnd', []); }
  const guardOver = p => p.waitForFunction(() => !ghostArm && performance.now() > ghostUntil + 30, null, T);
  const reload = async p => { await p.reload(); await p.waitForFunction(() => typeof Q !== 'undefined' && typeof cfg === 'object'); };
  // answer the current question with the keypad (CDP taps) and wait until the next one is up
  async function answerTap(p, cdp, val) {
    for (const d of String(val)) await tap(p, cdp, `.key[data-k="${d}"]`);
    await tap(p, cdp, '#key-ok');
    await p.waitForFunction(() => Q && (Q.done || !Q.locked), null, T);
  }

  // 1. 出題：加減均勻、0 少；九九不出 ×1；範圍正確
  {
    const { ctx, p } = await open();
    const g = await p.evaluate(() => {
      const r = {}; let zero = 0, bad = 0, big = 0, zero6 = 0; const N = 4000;
      const c10 = { ...DEFAULT_CFG, ops: ['add'], addRange: '10' };
      for (let i = 0; i < N; i++) { const q = genOne(c10); if (q.a === 0 || q.b === 0) zero++; if (q.ans > 10 || q.a < 0 || q.b < 0) bad++; if (q.a >= 6) { big++; if (q.b === 0) zero6++; } }
      r.addZero = zero / N; r.addBad = bad; r.addBig6zero = big ? zero6 / big : 1;
      zero = 0; bad = 0; const cs = { ...DEFAULT_CFG, ops: ['sub'], addRange: '20' };
      for (let i = 0; i < N; i++) { const q = genOne(cs); if (q.b === 0 || q.ans === 0) zero++; if (q.ans < 0 || q.a > 20) bad++; } r.subZero = zero / N; r.subBad = bad;
      let one = 0; const c99 = { ...DEFAULT_CFG, ops: ['mul', 'div'] };
      for (let i = 0; i < N; i++) { const q = genOne(c99); if (q.op === 'mul' ? q.a === 1 || q.b === 1 : q.b === 1 || q.ans === 1) one++; if (q.op === 'div' && (q.a % q.b || q.ans < 2 || q.ans > 9)) bad++; } r.mulOne = one;
      let seven1 = 0; const c7 = { ...DEFAULT_CFG, ops: ['mul'], mulMode: 'tables', tables: [7] };
      for (let i = 0; i < 2000; i++) { const q = genOne(c7); if (Math.min(q.a, q.b) === 1) seven1++; if (q.a !== 7 && q.b !== 7) bad++; } r.seven1 = seven1; r.bad = bad;
      const c1 = { ...DEFAULT_CFG, ops: ['add', 'sub'], addRange: 'custom', addMax: 1 }; let m1 = 0; for (let i = 0; i < 200; i++) { const q = genOne(c1); if (q.ans < 0 || q.ans > 1 || q.a > 1) m1++; } r.m1 = m1;
      return r;
    });
    ok(g.addBad === 0 && g.subBad === 0 && g.bad === 0 && g.m1 === 0, '加減乘除出題都在範圍內（含自訂最大值 1）');
    ok(g.addZero < 0.15, `加法 10 以內含 0 的題目 ${(g.addZero * 100).toFixed(1)}%（< 15%，原本 31.6%）`);
    ok(g.addBig6zero < 0.15, `加法第一個數 ≥ 6 時配 0 的比例 ${(g.addBig6zero * 100).toFixed(1)}%（大數不再幾乎都配 0）`);
    ok(g.subZero < 0.15, `減法 20 以內減 0 或差 0 的題目 ${(g.subZero * 100).toFixed(1)}%`);
    ok(g.mulOne === 0, '九九（2–9）乘除都不出 ×1、÷1');
    ok(g.seven1 > 0, '指定 7 的段仍包含 7×1');

    // 2. 自訂最大值：清空不寫回 0、小數擋下說明、1e3 正規化；名字以字素計
    await p.evaluate(() => { cfg.ops = ['add']; cfg.addRange = 'custom'; cfg.addMax = 50; saveCfg(); syncSetup(); });
    await p.focus('#add-max'); await p.fill('#add-max', '');
    let st = await p.evaluate(() => ({ v: $('add-max').value, saved: cfg.addMax, err: $('setup-err').textContent, dis: $('btn-start').disabled }));
    ok(st.v === '' && st.saved === 50 && st.dis && /請輸入/.test(st.err), `清空自訂最大值：欄位保持空白、設定仍是 50、提示「${st.err}」`);
    await p.fill('#add-max', '3.7');
    st = await p.evaluate(() => ({ saved: cfg.addMax, err: $('setup-err').textContent, dis: $('btn-start').disabled }));
    ok(st.saved === 50 && st.dis && /整數/.test(st.err), `輸入 3.7 → 不存、提示「${st.err}」`);
    await p.fill('#add-max', '1e3'); await p.locator('#add-max').blur();
    st = await p.evaluate(() => ({ v: $('add-max').value, saved: cfg.addMax, dis: $('btn-start').disabled }));
    ok(st.saved === 1000 && st.v === '1000' && !st.dis, '輸入 1e3 → 1000（不是 1）');
    await p.focus('#add-max'); await p.fill('#add-max', ''); await p.locator('#add-max').blur();
    st = await p.evaluate(() => ({ v: $('add-max').value, saved: cfg.addMax, err: $('setup-err').hidden }));
    ok(st.v === '1000' && st.saved === 1000 && st.err, '清空後離開欄位 → 填回 1000，不會變 0');
    await p.evaluate(() => { cfg.ops = ['mul']; cfg.addRange = '10'; saveCfg(); syncSetup(); });
    await p.click('#btn-user-menu'); await p.click('#btn-user-add');
    await p.fill('#user-name', '👨‍👩‍👧‍👦小明👍🏽');
    ok(await p.evaluate(() => graphemes($('user-name').value).length === 4 && $('user-name').value.includes('👨‍👩‍👧‍👦')), '名字以字素計，家庭表情符號不會被截斷');
    await p.fill('#user-name', '一二三四五六七八九十👨‍👩‍👧‍👦');
    ok(await p.evaluate(() => $('user-name').value === '一二三四五六七八九十'), '超過 10 個字時整個字素截掉，不留半個表情');
    await p.click('#btn-user-cancel');
    await ctx.close();
  }

  // 3. 作答中重新整理 → 回到同一題並暫停；結果頁重新整理 → 錯題與「只練錯題」還在；提早結束不算最佳
  {
    const { ctx, p, cdp } = await open();
    await p.evaluate(() => { cfg.mode = 'fixed'; cfg.ops = ['mul']; saveCfg(); syncSetup(); });
    await tap(p, cdp, '#btn-start');
    await p.waitForFunction(() => !$('s-quiz').hidden && Q && Q.cur);
    for (let i = 0; i < 11; i++) { const a = await p.evaluate(() => Q.cur.ans); await answerTap(p, cdp, i === 3 ? a + 1 : a); }
    await tap(p, cdp, '.key[data-k="4"]');
    const before = await p.evaluate(() => ({ q: $('question').textContent, n: Q.items.length, input: Q.input }));
    await reload(p);
    let s = await p.evaluate(() => ({ scr: ['s-setup', 's-quiz', 's-result'].find(s => !$(s).hidden), q: $('question').textContent, n: Q && Q.items.length, paused: Q && Q.paused, ov: !$('paused').hidden, title: $('paused-title').textContent, left: $('q-left-val').textContent, input: Q && Q.input }));
    ok(s.scr === 's-quiz' && s.n === 11 && s.paused && s.ov && s.title.includes('繼續上次') && s.left === '12/20', `重新整理後回到第 12/20 題並暫停（${s.title}）`);
    ok(s.q === before.q && s.input === before.input, `同一題「${s.q}」與已輸入的「${s.input}」都還在`);
    await tap(p, cdp, '#btn-resume');
    await p.waitForFunction(() => !Q.paused);
    await tap(p, cdp, '#key-clear');
    for (let i = 0; i < 9; i++) await answerTap(p, cdp, await p.evaluate(() => Q.cur.ans));
    await p.waitForFunction(() => !$('s-result').hidden, null, T);
    const r1 = await p.evaluate(() => ({ main: $('res-main').textContent, ses: getSessions().length, wrong: $('wrong-body').rows.length, best: store.get(uk('best'), {}) }));
    ok(r1.main === '19/20' && r1.ses === 1 && r1.wrong === 1, `續做完成：${r1.main}，紀錄 1 筆，錯題 1 題`);
    await reload(p);
    s = await p.evaluate(() => ({ scr: ['s-setup', 's-quiz', 's-result'].find(s => !$(s).hidden), wrong: $('wrong-body').rows.length, main: $('res-main').textContent, dis: $('btn-wrong').disabled }));
    ok(s.scr === 's-result' && s.wrong === 1 && s.main === '19/20' && !s.dis, '結果頁重新整理後錯題表與「只練錯題」都還在');
    await guardOver(p);
    await tap(p, cdp, '#btn-wrong');
    await p.waitForFunction(() => !$('s-quiz').hidden && Q.mode === 'wrong' && Q.total === 1);
    ok(true, '重新整理後「只練錯題」可開始（1 題）');
    await answerTap(p, cdp, await p.evaluate(() => Q.cur.ans));
    await p.waitForFunction(() => !$('s-result').hidden, null, T); await guardOver(p);
    await tap(p, cdp, '#btn-home');
    await p.waitForFunction(() => !$('s-setup').hidden);
    // early end: 1/1 must not become best
    const bestBefore = await p.evaluate(() => $('rec-best').textContent);
    await tap(p, cdp, '#btn-start'); await p.waitForFunction(() => !$('s-quiz').hidden && Q.cur);
    await answerTap(p, cdp, await p.evaluate(() => Q.cur.ans));
    await tap(p, cdp, '#btn-end');
    await p.waitForFunction(() => !$('s-result').hidden, null, T);
    const early = await p.evaluate(() => $('res-best').textContent);
    await guardOver(p); await tap(p, cdp, '#btn-home'); await p.waitForFunction(() => !$('s-setup').hidden);
    const bestAfter = await p.evaluate(() => $('rec-best').textContent);
    ok(/提早結束/.test(early) && bestAfter === bestBefore, `提早結束 1/1：「${early}」，最佳紀錄維持「${bestAfter}」`);
    // best/last keyed by range
    await p.evaluate(() => { cfg.mulMode = 'tables'; cfg.tables = [2]; saveCfg(); syncSetup(); });
    const other = await p.evaluate(() => ({ last: $('rec-last').textContent, best: $('rec-best').textContent }));
    ok(other.last === '—' && other.best === '—', '換成只練 2 的段：上次成績與最佳不會拿九九的來比');
    await p.evaluate(() => { cfg.mulMode = '99'; saveCfg(); syncSetup(); });
    ok(await p.evaluate(() => $('rec-best').textContent) === bestAfter, '換回九九：最佳紀錄還在');
    // legacy records (saved before ranges were tracked) still load
    await p.evaluate(() => { const ses = store.get(uk('sessions'), []); ses.push({ ts: 1, mode: 'endless', ops: ['mul'], score: 9, accuracy: 0.9, avgMs: 2000, n: 10, correct: 9 }); store.set(uk('sessions'), ses); const b = store.get(uk('best'), {}); b['endless|mul'] = ses[ses.length - 1]; store.set(uk('best'), b); cfg.mode = 'endless'; saveCfg(); syncSetup(); });
    const leg = await p.evaluate(() => ({ last: $('rec-last').textContent, best: $('rec-best').textContent, old: !$('rec-best-old').hidden }));
    ok(leg.best === '90%・2.0 秒/題' && leg.last === '90%・2.0 秒/題' && leg.old, '舊版存的成績（沒有範圍）照樣顯示，標示為舊紀錄');
    await p.evaluate(() => { cfg.mode = 'fixed'; saveCfg(); syncSetup(); });
    // facts are buffered in memory but flushed by pagehide on reload
    await tap(p, cdp, '#btn-start'); await p.waitForFunction(() => !$('s-quiz').hidden && Q.cur);
    const n0 = await p.evaluate(() => Object.values(getFacts()).reduce((a, f) => a + f.n, 0));
    await answerTap(p, cdp, await p.evaluate(() => Q.cur.ans));
    await reload(p);
    const n1 = await p.evaluate(() => Object.values(store.get(uk('facts'), {})).reduce((a, f) => a + f.n, 0));
    ok(n1 === n0 + 1, `facts 先存在記憶體，重新整理（pagehide）時寫入：${n0} → ${n1}`);
    await ctx.close();
  }

  // 4. 草稿：新增練習者的名字、每日目標（沒離開欄位）重新整理後還在；超出範圍顯示紅字
  {
    const { ctx, p } = await open();
    await p.click('#btn-user-menu'); await p.click('#btn-user-add'); await p.fill('#user-name', '阿明');
    await reload(p);
    let s = await p.evaluate(() => ({ open: !$('user-form').hidden, v: $('user-name').value }));
    ok(s.open && s.v === '阿明', '新增練習者打到一半重新整理：表單與「阿明」還在');
    await p.click('#btn-user-save');
    ok(await p.evaluate(() => users.some(u => u.name === '阿明') && store.get('draft-user', null) === null), '儲存後草稿清除');
    await p.click('#btn-stats'); await p.fill('#goal', '80');
    await reload(p);
    s = await p.evaluate(() => ({ goal: cfg.goal, scr: ['s-setup', 's-stats'].find(s => !$(s).hidden), v: $('goal').value }));
    ok(s.goal === 80 && s.scr === 's-stats' && s.v === '80', '每日目標打 80 沒離開欄位就重新整理：仍是 80，且留在統計頁');
    await p.fill('#goal', '4');
    s = await p.evaluate(() => ({ goal: cfg.goal, err: $('goal-err').hidden ? '' : $('goal-err').textContent }));
    ok(s.goal === 80 && /5–999/.test(s.err), `每日目標輸入 4：紅字「${s.err}」`);
    await p.locator('#goal').blur();
    s = await p.evaluate(() => ({ v: $('goal').value, err: $('goal-err').hidden ? '' : $('goal-err').textContent }));
    ok(s.v === '80' && /改回 80/.test(s.err), `離開欄位：改回並說明「${s.err}」`);
    await ctx.close();
  }

  // 5. ghost click：最後一題按住確認，畫面換到結果頁時才放開 → 不會點到結果頁的按鈕
  for (const [w, h, rm] of [[360, 640, false], [390, 610, true], [844, 390, false]]) {
    const { ctx, p, cdp } = await open(w, h, { reducedMotion: rm ? 'reduce' : 'no-preference' });
    await p.evaluate(() => { window.__c = []; for (const id of ['btn-again', 'btn-wrong', 'btn-to-stats', 'btn-home']) $(id).addEventListener('click', () => __c.push(id)); });
    let ghosts = 0;
    for (const extra of [0, 1]) {
      await p.evaluate(() => { show('s-setup'); cfg.mode = 'fixed'; saveCfg(); startQuiz(); Q.total = 2; Q.locked = false; Q.input = String(Q.cur.ans + 1); press('OK'); nextQ(); Q.input = String(Q.cur.ans); renderInput(); __c = []; });
      const c = await center(p, '#key-ok');
      await touch(cdp, 'touchStart', [c]);
      await p.waitForFunction(() => !$('s-result').hidden, null, T);
      if (extra) await p.waitForFunction(() => { const t = performance.now(); return new Promise(r => setTimeout(() => r(performance.now() - t > 80), 90)); });
      await touch(cdp, 'touchEnd', []);
      await guardOver(p);
      const r = await p.evaluate(() => ({ c: __c.slice(), scr: ['s-setup', 's-quiz', 's-result', 's-stats'].find(s => !$(s).hidden) }));
      if (r.c.length || r.scr !== 's-result') ghosts++;
    }
    // timed: time runs out while a finger is on a key
    await p.evaluate(() => { show('s-setup'); cfg.mode = 'timed'; saveCfg(); startQuiz(); Q.elapsed = 59000; __c = []; });
    const c5 = await center(p, '.key[data-k="5"]');
    await touch(cdp, 'touchStart', [c5]);
    await p.waitForFunction(() => !$('s-result').hidden, null, T);
    await touch(cdp, 'touchEnd', []); await guardOver(p);
    const tr = await p.evaluate(() => ({ c: __c.slice(), scr: ['s-setup', 's-quiz', 's-result', 's-stats'].find(s => !$(s).hidden) }));
    if (tr.c.length || tr.scr !== 's-result') ghosts++;
    // the result buttons still work right after
    await tap(p, cdp, '#btn-home');
    await p.waitForFunction(() => !$('s-setup').hidden, null, T);
    ok(ghosts === 0, `${w}×${h}${rm ? '（減少動態）' : ''}：最後一題／時間到時手指還按著，放開後留在結果頁，0 個誤點`);
    await p.evaluate(() => { cfg.mode = 'fixed'; saveCfg(); });
    await ctx.close();
  }

  // 6. 觸控：按住清除＋另一指點 5 先放開，清除那下照算、不會變全清；按住數字不重複；答錯時可提早下一題
  {
    const { ctx, p, cdp } = await open();
    await p.evaluate(() => { cfg.mode = 'endless'; saveCfg(); startQuiz(); Q.input = '12'; renderInput(); window.__p = []; const o = press; window.press = k => { __p.push(k); return o(k); }; });
    const cc = await center(p, '#key-clear'), c5 = await center(p, '.key[data-k="5"]');
    await touch(cdp, 'touchStart', [{ ...cc, id: 1 }]);
    await touch(cdp, 'touchStart', [{ ...cc, id: 1 }, { ...c5, id: 2 }]);
    await p.waitForFunction(() => Q.input === '125');
    await touch(cdp, 'touchMove', [{ ...cc, id: 1 }]);      // finger 2 (the 5) lifts first
    await touch(cdp, 'touchEnd', []);                       // then 清除 lifts
    const atRel = await p.evaluate(() => Q.input);
    await p.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 700)));
    const after = await p.evaluate(() => ({ input: Q.input, p: __p.join(',') }));
    ok(atRel === '12' && after.input === '12' && after.p === '5,C', `兩指：12 → 125 → ${atRel}，0.7 秒後 ${after.input}（press: ${after.p}）`);
    // long press 清除 still clears all
    await touch(cdp, 'touchStart', [cc]);
    await p.waitForFunction(() => Q.input === '', null, T);
    await touch(cdp, 'touchEnd', []);
    ok(await p.evaluate(() => Q.input === ''), '長按清除 = 全清');
    // holding a digit 700 ms still counts once (click fallback is keyboard-only)
    await p.evaluate(() => { __p = []; });
    const c7 = await center(p, '.key[data-k="7"]');
    await touch(cdp, 'touchStart', [c7]);
    await p.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 700)));
    await touch(cdp, 'touchEnd', []);
    await p.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 50)));
    { const r = await p.evaluate(() => [Q.input, __p.join()]); ok(r[0] === '7' && r[1] === '7', '按住 7 0.7 秒才放開：只輸入一次 ' + r.join(' / ')); }
    // keyboard activation of a key (detail 0 click) still works
    await p.waitForFunction(() => performance.now() - keyUpAt > 450);
    await p.evaluate(() => { Q.input = ''; renderInput(); }); await p.focus('.key[data-k="3"]'); await p.keyboard.press('Space');
    ok(await p.evaluate(() => Q.input === '3'), '鍵盤／輔助技術觸發的 click 仍可輸入');
    // wrong answer: 確認 skips the 1 s pause
    await p.evaluate(() => { Q.input = String(Q.cur.ans + 1); renderInput(); });
    await tap(p, cdp, '#key-ok');
    const n0 = await p.evaluate(() => Q.items.length);
    ok(await p.evaluate(() => Q.locked && /正確答案是/.test($('fix').textContent)), '答錯顯示正確答案');
    await p.waitForFunction(() => performance.now() >= Q.skipAt);
    await tap(p, cdp, '#qbox');
    ok(await p.evaluate(() => !Q.locked && $('fix').textContent === ''), '答錯後點題目框可直接下一題');
    await p.evaluate(() => { Q.input = String(Q.cur.ans + 1); renderInput(); });
    await tap(p, cdp, '#key-ok'); await p.waitForFunction(() => performance.now() >= Q.skipAt);
    await tap(p, cdp, '#key-ok');
    ok(await p.evaluate(n => !Q.locked && Q.items.length === n + 1, n0), '答錯後再按確認可直接下一題（不會重複作答）');
    // correct answer: the next digit is not swallowed by the green flash
    await p.evaluate(() => { Q.input = String(Q.cur.ans); renderInput(); });
    await tap(p, cdp, '#key-ok'); await tap(p, cdp, '.key[data-k="8"]');
    ok(await p.evaluate(() => !Q.locked && Q.input === '8'), '答對後立刻按下一個數字：直接換題並輸入，不會被吞');
    // timed mode: wrong shows the answer; 放棄 asks first
    await p.evaluate(() => { finish(); show('s-setup'); cfg.mode = 'timed'; saveCfg(); startQuiz(); Q.input = String(Q.cur.ans + 1); press('OK'); });
    ok(await p.evaluate(() => /正確答案是/.test($('fix').textContent)), '限時模式答錯也顯示正確答案');
    await p.waitForFunction(() => !Q.locked, null, T);
    await tap(p, cdp, '#btn-end');
    let g = await p.evaluate(() => ({ scr: ['s-setup', 's-quiz'].find(s => !$(s).hidden), ov: !$('paused').hidden, t: $('paused-title').textContent, paused: Q.paused, gu: !$('btn-giveup').hidden }));
    ok(g.scr === 's-quiz' && g.ov && g.paused && g.gu && /放棄/.test(g.t), '限時「放棄」先暫停並詢問，不會直接丟掉這局');
    const gap = await p.evaluate(() => $('btn-end').getBoundingClientRect().left - $('btn-pause').getBoundingClientRect().right);
    ok(gap >= 16, `「放棄」和暫停鈕間距 ${gap}px`);
    await tap(p, cdp, '#btn-resume'); await p.waitForFunction(() => !Q.paused);
    await tap(p, cdp, '#btn-end'); await p.waitForFunction(() => Q.paused);
    await tap(p, cdp, '#btn-giveup');
    await p.waitForFunction(() => !$('s-setup').hidden, null, T);
    ok(await p.evaluate(() => getSessions().filter(s => s.mode === 'timed').length === 0 && store.get('run', null) === null), '確認放棄後回設定，未完成的局不留存檔');
    // touch-only hint
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.kbd-hint')).display === 'none' && /長按全清/.test($('key-clear').textContent)), '觸控裝置不顯示實體鍵盤提示；清除鍵寫出「長按全清」');
    await ctx.close();
  }

  // 7. 刪除練習者可復原；匯出／匯入備份；壞檔擋下；壞掉的 localStorage 不會卡住
  {
    const { ctx, p } = await open(390, 844, { acceptDownloads: true });
    await p.evaluate(() => { store.set(uk('sessions'), [{ ts: 1, mode: 'fixed', ops: ['mul'], rk: 'm99', score: 18, accuracy: .9, avgMs: 2000, n: 20, correct: 18 }]); });
    await p.click('#btn-user-menu'); await p.click('#btn-user-add'); await p.fill('#user-name', '小華'); await p.click('#btn-user-save');
    await p.evaluate(() => store.set(uk('sessions'), [{ ts: 2, mode: 'fixed', ops: ['add'], rk: 'a10', score: 20, accuracy: 1, avgMs: 1000, n: 20, correct: 20 }]));
    await p.click('#btn-user-menu'); await p.click('#btn-user-del'); await p.click('#btn-user-del-yes');
    ok(await p.evaluate(() => users.length === 1 && !$('toast').hidden && $('toast-act').textContent === '復原'), '刪除練習者後出現「復原」');
    await p.click('#toast-act');
    ok(await p.evaluate(() => users.length === 2 && users[1].name === '小華' && uid === users[1].id && getSessions().length === 1), '按「復原」：小華和紀錄都回來了');
    // export
    await p.click('#btn-user-menu');
    const [down] = await Promise.all([p.waitForEvent('download'), p.click('#btn-export')]);
    const fp = path.join(DIR, 'backup.json'); await down.saveAs(fp);
    const bk = JSON.parse(fs.readFileSync(fp, 'utf8'));
    ok(bk.app === 'math-drill' && bk.users.length === 2 && Object.values(bk.data).every(d => Array.isArray(d.sessions)), `匯出備份：${bk.users.length} 位練習者，各自含 sessions`);
    // bad files
    const bad = path.join(DIR, 'bad.json'); fs.writeFileSync(bad, '{"app":"other"}');
    await p.setInputFiles('#import-file', bad);
    await p.waitForFunction(() => !$('backup-err').hidden);
    ok(await p.evaluate(() => /不是九九乘法練習/.test($('backup-err').textContent) && $('import-confirm').hidden), '匯入別的檔案：擋下並說明');
    const bad2 = path.join(DIR, 'bad2.json'); fs.writeFileSync(bad2, 'not json{'); await p.setInputFiles('#import-file', bad2);
    await p.waitForFunction(() => /JSON/.test($('backup-err').textContent));
    ok(true, '匯入壞掉的 JSON：擋下並說明');
    // wipe and import
    await p.evaluate(() => { for (const u of users) for (const k of USER_KEYS) store.del(k + ':' + u.id); store.set('users', [{ id: 'u1', name: 'X' }]); reloadAll(); });
    await p.setInputFiles('#import-file', fp);
    await p.waitForFunction(() => !$('import-confirm').hidden);
    await p.click('#btn-import-yes');
    ok(await p.evaluate(() => users.length === 2 && users.some(u => u.name === '小華') && (() => { const s = []; for (const u of users) s.push(...store.get('sessions:' + u.id, [])); return s.length; })() === 2), '匯入備份後兩位練習者與紀錄還原');
    await ctx.close();
    // corrupt storage values
    const cases = [['sessions:u1', 'null'], ['sessions:u1', '{"a":1}'], ['sessions:u1', '[null,5]'], ['facts:u1', '[1,2]'], ['facts:u1', '{"7x8":null}'], ['best:u1', 'null'], ['best:u1', '{"fixed|mul":7}'], ['daily:u1', '[3]'], ['settings:u1', '{"ops":"x","tables":5,"goal":"abc","mode":"zzz"}'], ['users', '[{"id":1}]'], ['run', '{"uid":"u1","ops":5}'], ['result', '7']];
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p2 = await c2.newPage(); const errs = [];
    p2.on('pageerror', e => errs.push(String(e))); p2.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p2.goto(URL_);
    let stuck = [];
    for (const [k, v] of cases) {
      await p2.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem('math-drill:v1:users', '[{"id":"u1","name":"A"}]'); localStorage.setItem('math-drill:v1:' + k, v); }, [k, v]);
      await p2.reload(); await p2.waitForFunction(() => typeof cfg === 'object');
      const r = await p2.evaluate(() => { try { $('btn-start').click(); for (let i = 0; i < 25 && Q && !Q.done; i++) { Q.input = String(Q.cur.ans); Q.locked = false; press('OK'); if (!Q.done) nextQ(); } openStats(); return Q.done ? 'ok' : 'stuck'; } catch (e) { return String(e); } });
      if (r !== 'ok') stuck.push(k + '=' + v + ': ' + r);
    }
    ok(!stuck.length && !errs.length, `壞掉的 localStorage 值 ${cases.length} 種：都能作答完並開統計頁 ${stuck.join(' | ')} ${errs.join(' | ')}`);
    await c2.close();
  }

  // 8. 版面：長題目不被切；矮螢幕鍵盤完整；開始／再來一次在第一屏；熱力格列 ≥ 44；橫式兩欄
  for (const [w, h] of [[360, 640], [375, 500], [390, 610], [844, 390], [430, 932]]) {
    const { ctx, p } = await open(w, h);
    const st = await p.evaluate(() => { const r = $('btn-start').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    await p.evaluate(() => { cfg.ops = ['add']; cfg.addRange = 'custom'; cfg.addMax = 9999; cfg.mode = 'fixed'; saveCfg(); syncSetup(); startQuiz(); Q.cur = makeQ('add', 4821, 5077); renderQuestion(); Q.input = '9898'; renderInput(); });
    const fit = await p.evaluate(() => { const q = $('question').getBoundingClientRect(), b = $('qbox').getBoundingClientRect(), k = $('key-ok').getBoundingClientRect(), c = $('key-clear').getBoundingClientRect();
      return { qIn: q.left >= b.left + 2 && q.right <= b.right - 2, sw: $('question').scrollWidth <= $('qbox').clientWidth, keys: k.bottom <= innerHeight && c.bottom <= innerHeight && k.right <= innerWidth, keyH: k.height, hscroll: document.documentElement.scrollWidth > innerWidth }; });
    // result page
    await p.evaluate(() => { Q.total = 3; for (let i = 0; i < 3 && !Q.done; i++) { Q.input = String(Q.cur.ans + (i ? 0 : 1)); Q.locked = false; press('OK'); if (!Q.done) nextQ(); } });
    await p.waitForFunction(() => !$('s-result').hidden);
    const res = await p.evaluate(() => { const r = $('btn-again').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    await p.evaluate(() => { for (let i = 0; i < 10; i++) recordFact('7x8', i % 3 === 0, 2000); openStats(); });
    const heat = await p.evaluate(() => Math.min(...[...document.querySelectorAll('#heat button')].map(b => b.getBoundingClientRect().height)));
    ok(fit.qIn && fit.sw && fit.keys && !fit.hscroll && st && res && heat >= 44,
      `${w}×${h}：「4821 + 5077 =」完整 ${fit.qIn && fit.sw}、鍵盤完整 ${fit.keys}（鍵高 ${fit.keyH.toFixed(0)}）、開始在第一屏 ${st}、再來一次在第一屏 ${res}、熱力列高 ${heat.toFixed(0)}`);
    if (w === 844) {
      await p.evaluate(() => show('s-setup'));
      const cols = await p.evaluate(() => getComputedStyle(document.querySelector('.setup-grid')).gridTemplateColumns.split(' ').length);
      ok(cols === 2, '橫式設定頁兩欄');
    }
    if (w === 360) {
      await p.evaluate(() => show('s-setup'));
      const row = await p.evaluate(() => { const s = $('user').getBoundingClientRect(), m = $('btn-user-menu').getBoundingClientRect(); return Math.abs(s.top - m.top) < 4 && $('btn-user-del').offsetParent === null; });
      ok(row, '360 寬練習者列：選單 ⋯ 和下拉同一行，刪除等收在選單裡');
    }
    await ctx.close();
  }

  // 9. 統計：加減錯題列表、秒數刻度整數、弱點加強紀錄不足時記為一般模式
  {
    const { ctx, p } = await open();
    await p.evaluate(() => { for (let i = 0; i < 4; i++) recordFact('7+8', i % 2 === 0, 3000); recordFact('9-4', true, 1000); store.set(uk('sessions'), [{ ts: 1, mode: 'fixed', ops: ['add'], rk: 'a20', score: 18, accuracy: .9, avgMs: 5300, n: 20, correct: 18 }]); openStats(); });
    const s = await p.evaluate(() => ({ other: !$('other-card').hidden, rows: $('other-body').rows.length, txt: $('other-body').textContent, heat: !$('heat-card').hidden, ticks: [...document.querySelectorAll('#chart-ms text')].map(t => t.textContent).filter(t => /s$/.test(t)) }));
    ok(s.other && s.rows === 1 && s.txt.includes('7 + 8 = 15') && !s.heat, `只練加減：顯示「${s.txt.slice(0, 20)}…」錯題列表，不再是一片灰的乘法格`);
    ok(s.ticks.every(t => /^\d+s$/.test(t)), `秒數刻度都是整數：${s.ticks.join(' ')}`);
    await p.evaluate(() => { localStorage.clear(); reloadAll(); cfg.mode = 'weak'; saveCfg(); syncSetup(); startQuiz(); });
    ok(await p.evaluate(() => Q.mode === 'fixed' && /固定 20 題/.test($('toast').textContent)), '弱點加強紀錄不足：改一般出題，成績記為固定 20 題');
    await ctx.close();
  }

  ok(errors.length === 0, 'console / page error：' + (errors.join(' | ') || '無'));
  await browser.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL ' + e.message); process.exit(1); });
