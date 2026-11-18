// 投票器：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）
// 觸控一律用 CDP Input.dispatchTouchEvent（真的多指、按住），等條件不等固定時間。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-poll-'));
const WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const K = k => 'quick-poll:v1:' + k;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DRAFT = (o = {}) => ({ question: '晚餐吃什麼？', options: ['火鍋', '拉麵', '披薩', '壽司'], type: 'single', maxN: 2, expected: 0, anon: true, abstain: false, shuffle: false, ...o });

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const at = async sel => { await p.locator(sel).first().evaluate(e => { const r = e.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight - 110) e.scrollIntoView({ block: 'center' }); }); const b = await p.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const settle = () => p.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => r()), 120)));
    const tap = async (sel, hold = 40) => { const c = await at(sel); await T('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await sleep(hold); await T('touchEnd', []); await settle(); };
    // finger 1 rests on the page's left gutter (no control there), finger 2 taps `sel` and lifts (touchEnd lists only finger 2), then finger 1 lifts
    const tap2 = async (rest, sel) => {
      const b = await at(sel), a = { x: 6, y: Math.max(20, b.y - 30) };
      await T('touchStart', [{ x: a.x, y: a.y, id: 1 }]); await sleep(50);
      await T('touchStart', [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); await sleep(50);
      await T('touchEnd', [{ x: b.x, y: b.y, id: 2 }]); await sleep(50);
      await T('touchEnd', []); await settle();
    };
    // press and hold until `until` is true (the hold fired), then release where the finger is
    const holdTouch = async (sel, until) => {
      const c = await at(sel); await T('touchStart', [{ x: c.x, y: c.y, id: 1 }]);
      await p.waitForFunction(until, null, { timeout: 5000 }); await sleep(60);
      await T('touchEnd', []); await settle();
    };
    const seed = async (vals) => { await p.evaluate(([vals, K0]) => { localStorage.clear(); for (const [k, v] of Object.entries(vals)) localStorage.setItem(K0 + k, JSON.stringify(v)); }, [vals, K('')]); await p.reload(); };
    const vis = sel => p.evaluate(s => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);
    return { ctx, p, T, at, tap, tap2, holdTouch, seed, vis, settle };
  }
  // count clicks that reach the page's own handlers (i.e. that the tap layer did not swallow)
  const watchClicks = p => p.evaluate(() => { window.__clicks = []; document.addEventListener('click', e => __clicks.push(e.target.id || e.target.className || e.target.tagName)); });
  const voteVisible = () => !document.getElementById('s-vote').hidden;
  const resultVisible = () => !document.getElementById('s-result').hidden;

  // 1. 幽靈點擊：按住「我準備好了」放開，不會替投票者選擇；4 種尺寸 × 單選／複選／評分；按住「結束並公布」放開不按到結果頁
  for (const [w, h] of [[360, 640], [390, 844], [430, 932], [844, 390]]) {
    const E = await open(w, h);
    for (const type of w === 390 || w === 360 ? ['single', 'multi', 'rating'] : ['single', 'rating']) {
      await E.seed({ draft: DRAFT({ type, options: ['火鍋', '拉麵', '披薩', '壽司', '燒肉', '咖哩'] }) });
      await E.tap('#btn-start');
      await E.holdTouch('#hold-ready', voteVisible);
      const picked = await E.p.evaluate(() => document.querySelectorAll('#ballot [aria-checked="true"], #ballot .star.on').length);
      assert(await E.vis('#s-vote') && picked === 0, `${w}x${h} ${type}：按住「我準備好了」放開後選票沒有被選任何項（${picked}）`);
      if (type === 'single') {
        await E.tap('#vopt-0'); await E.tap('#btn-submit');
        await E.p.waitForFunction(() => !document.getElementById('s-hand').hidden, null, { timeout: 5000 });
        await watchClicks(E.p);
        await E.holdTouch('#hold-end', resultVisible);
        const clicks = await E.p.evaluate(() => __clicks.length);
        assert(clicks === 0 && await E.p.evaluate(() => document.getElementById('tab-chart').getAttribute('aria-selected') === 'true'), `${w}x${h}：按住「結束並公布」放開沒有按到結果頁（${clicks} 個 click）`);
      }
    }
    if (w === 844) {
      await E.seed({ draft: DRAFT() }); await E.tap('#btn-start'); await E.holdTouch('#hold-ready', voteVisible);
      const n = await E.p.evaluate(() => getComputedStyle(document.getElementById('ballot')).gridTemplateColumns.split(' ').length);
      assert(n === 2, `844x390 橫式選票為兩欄（${n}）`);
    }
    if (w === 360) {
      // (r2) 結果頁「新投票」不聚焦手指下的輸入框
      await E.seed({ active: { question: 'q', options: ['甲', '乙'], type: 'single', settings: { maxN: 1, expected: 0, anon: true, abstain: false, shuffle: false }, ballots: [{ choice: [0] }], startedAt: 9, done: true } });
      await E.tap('#btn-new');
      const f = await E.p.evaluate(() => document.activeElement.tagName + '#' + document.activeElement.id);
      assert(await E.vis('#s-setup') && !/^INPUT/.test(f), `360x640 結果頁「新投票」後沒有聚焦輸入框（${f}）`);
      // 開頁時固定的「開始投票」不蓋住「新增選項／清空」
      await E.seed({ draft: DRAFT({ options: ['鼎泰豐', '麻辣火鍋', '日式拉麵', '韓式烤肉', '義大利麵', '夜市小吃'] }) });
      const cover = await E.p.evaluate(() => { const f = document.querySelector('.foot').getBoundingClientRect(); return ['btn-add', 'btn-clear-sample'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return Math.max(0, Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top)); }); });
      assert(cover.every(x => x === 0), `360x640 開頁時開始鈕不蓋住新增／清空（重疊 ${cover}px）`);
      // 排序列 ↑↓ 疊成直排，文字欄夠寬
      await E.seed({ draft: DRAFT({ type: 'rank' }) }); await E.tap('#btn-start'); await E.holdTouch('#hold-ready', voteVisible);
      const nw = await E.p.evaluate(() => document.querySelector('.rank-row .name').getBoundingClientRect().width);
      assert(nw >= 130, `360 寬排序列文字欄 ${Math.round(nw)}px（≥130）`);
    }
    await E.ctx.close();
  }

  // (r2) 360x740、8 個選項：首屏底部露出的「新增選項」不被開始鈕的漸層擋住
  {
    const F = await open(360, 740);
    await F.seed({ draft: DRAFT({ options: [...Array(8)].map((_, i) => '選項' + (i + 1)) }) });
    const r = await F.p.evaluate(() => { const a = document.getElementById('btn-add').getBoundingClientRect(), s = document.getElementById('btn-start').getBoundingClientRect();
      const top = Math.max(a.top, 0) + 1, bot = Math.min(a.bottom, s.top, innerHeight) - 1; if (bot <= top) return { none: true };
      const ys = []; for (let y = top; y <= bot; y += 2) ys.push(y); return { hit: ys.filter(y => document.elementFromPoint(a.left + 20, y)?.closest('#btn-add')).length, of: ys.length }; });
    assert(r.none || r.hit === r.of, `360x740 8 項：露出的新增選項 ${r.none ? '不在首屏' : r.hit + '/' + r.of + ' 點得到'}`);
    await F.ctx.close();
  }

  const E = await open(390, 844);
  const { p, tap, tap2, holdTouch, seed, vis, T, at } = E;
  const S = () => p.evaluate(() => ({ poll: typeof poll === 'object' && poll ? JSON.parse(JSON.stringify(poll)) : null, cur: cur ? { sel: [...cur.sel], rate: cur.rate.slice(), rank: cur.rank.slice() } : null }));

  // 2. 另一指按著時，一般按鈕都要有反應，而且只算一次
  await seed({ draft: DRAFT({ type: 'multi', maxN: 3 }) });
  const opts0 = await p.evaluate(() => optInputs().length);
  await tap2('h1', '#btn-add');
  assert(await p.evaluate(() => optInputs().length) === opts0 + 1, '第二指點「新增選項」：加 1 項');
  const th0 = await p.textContent('#theme-label'); await tap2('h1', '#btn-theme');
  assert(await p.textContent('#theme-label') !== th0, '第二指點主題鈕：切換一次');
  await tap2('h1', 'label:has(#type-rank)'); assert(await p.evaluate(() => getType()) === 'rank', '第二指點「排序」分頁：切換');
  await tap2('h1', 'label:has(#type-multi)');
  const ab0 = await p.isChecked('#abstain'); await tap2('h1', 'label[for=abstain]');
  assert(await p.isChecked('#abstain') === !ab0, '第二指點「允許棄權」開關：切換一次');
  await p.evaluate(() => { const l = optInputs(); l[l.length - 1].value = '咖哩'; onSetupChange(); });
  await tap('#btn-start');
  await holdTouch('#hold-ready', voteVisible);
  await tap2('h2', '#vopt-1'); await tap2('h2', '#vopt-2');
  let st = await S(); assert(JSON.stringify(st.cur.sel.sort()) === '[1,2]', `第二指點選項：各選一次（${st.cur.sel}）`);
  await tap2('h2', '#btn-submit');
  await p.waitForFunction(() => !document.getElementById('s-hand').hidden, null, { timeout: 5000 });
  st = await S(); assert(st.poll.ballots.length === 1, '第二指點「送出」：送出一票');
  // 單點、按住 0.6 秒、1 秒都只算一次
  for (const ms of [40, 600, 1000]) {
    await holdTouch('#hold-ready', voteVisible);
    await tap('#vopt-0', ms);
    st = await S(); assert(JSON.stringify(st.cur.sel) === '[0]', `按住 ${ms}ms 點選項：選一次`);
    await tap('#vopt-0', ms); st = await S(); assert(st.cur.sel.length === 0, `按住 ${ms}ms 再點：取消一次`);
    await tap('#btn-vote-back');
  }
  // 返回：回交接畫面，不記票
  st = await S(); assert(await vis('#s-hand') && st.poll.ballots.length === 1, '選票「返回」回交接畫面，不記票');
  // 鍵盤仍可用
  const th1 = await p.textContent('#theme-label');
  await p.focus('#btn-theme'); await p.keyboard.press('Enter');
  assert(await p.textContent('#theme-label') !== th1, '鍵盤 Enter 仍可啟動按鈕');
  // 只點一下 hold 鈕：提示，不進入
  await tap('#hold-ready');
  assert(await vis('#s-hand') && await p.evaluate(() => !document.getElementById('toast').hidden && /按住/.test(document.getElementById('toast').textContent)), '只點一下按住鈕：提示「請按住 1 秒」不進入');

  // 3. 評分：第二指點星星
  await seed({ draft: DRAFT({ type: 'rating' }) }); await tap('#btn-start'); await holdTouch('#hold-ready', voteVisible);
  await tap2('h2', '#star-1-4'); st = await S(); assert(st.cur.rate[1] === 4, '第二指點星星：4 顆星');

  // 4. 排序：在列上滑動可以捲動；第二指點 ↑↓
  await seed({ draft: DRAFT({ type: 'rank', options: [...Array(12)].map((_, i) => '選項' + (i + 1)) }) });
  await tap('#btn-start'); await holdTouch('#hold-ready', voteVisible);
  await tap2('h2', '.rank-row:nth-child(2) .mv'); st = await S(); assert(st.cur.rank[0] === 1, '第二指點 ↑：上移一次');
  {
    const c = await at('.rank-row:nth-child(6) .name');
    await T('touchStart', [{ x: c.x, y: c.y, id: 1 }]);
    for (let k = 1; k <= 10; k++) { await T('touchMove', [{ x: c.x, y: c.y - k * 25, id: 1 }]); await sleep(16); }
    await T('touchEnd', []);
    await p.waitForFunction(() => scrollY > 50, null, { timeout: 3000 }).catch(() => {});
    const y = await p.evaluate(() => scrollY), ta = await p.evaluate(() => getComputedStyle(document.querySelector('.rank-row')).touchAction);
    assert(y > 50 && ta !== 'none', `排序列名上往上滑可捲動頁面（scrollY=${y}，touch-action=${ta}）`);
  }

  // 5. 排序最後兩項同票 → 平手（不抽籤）；中途抽籤淘汰時不寫「以過半數當選」
  const rank = await p.evaluate(() => {
    const mk = (opts, ballots) => ({ question: 'q', options: opts, type: 'rank', settings: { maxN: 1, expected: 0, anon: true, abstain: false, shuffle: false }, ballots: ballots.map(c => ({ choice: c })) });
    const t = computeResult(mk(['甲', '乙'], [[0, 1], [1, 0]]));
    randInt = () => 0;   // deterministic lottery
    const l = computeResult(mk(['A', 'B', 'C'], [[0, 1, 2], [0, 2, 1], [1, 0, 2], [2, 1, 0]]));
    return { tie: t.winners, tieRounds: t.irv.rounds.length, lotto: l.lotto, lw: l.winners };
  });
  assert(JSON.stringify(rank.tie) === '[0,1]' && rank.tieRounds === 1, `排序 2 選項 1:1 → 平手（${rank.tie}）`);
  await seed({ active: { question: 'q', options: ['甲', '乙'], type: 'rank', settings: { maxN: 1, expected: 0, anon: true, abstain: false, shuffle: false }, ballots: [{ choice: [0, 1] }, { choice: [1, 0] }], startedAt: 1, done: true } });
  assert(await vis('#btn-tie-random') && await p.evaluate(() => !document.querySelector('.bars li.win') && /平手/.test(document.getElementById('irv-brief').textContent) && !/當選/.test(document.getElementById('irv-brief').textContent)), '排序平手：結果頁顯示平手框，沒有「當選」');
  await seed({ active: { question: 'q', options: ['A', 'B', 'C'], type: 'rank', settings: { maxN: 1, expected: 0, anon: true, abstain: false, shuffle: false }, ballots: [[0, 1, 2], [0, 2, 1], [1, 0, 2], [2, 1, 0]].map(c => ({ choice: c })), startedAt: 2, done: true } });
  {
    const brief = await p.textContent('#irv-brief');
    assert(!/以過半數當選/.test(brief) ? /抽籤/.test(brief) : !rank.lotto, `排序中途抽籤淘汰：當選文字標明抽籤（${brief}）`);
  }

  // 6. 評分用未四捨五入的平均比較
  const rt = await p.evaluate(() => {
    const A = [5, ...Array(24).fill(4)], B = [5, ...Array(23).fill(4), 3];
    const poll = { question: 'q', options: ['A', 'B'], type: 'rating', settings: {}, ballots: A.map((a, k) => ({ choice: [a, B[k]] })) };
    const R = computeResult(poll); return { w: R.winners, d: R.rows.map(r => r.disp) };
  });
  assert(JSON.stringify(rt.w) === '[0]' && rt.d.join() === '4.04,4.00', `評分 4.04 vs 4.00：A 勝，不判平手（${JSON.stringify(rt)}）`);
  await seed({ active: { question: 'q', options: ['A', 'B'], type: 'rating', settings: {}, ballots: [{ choice: [5, 4] }, { choice: [0, 4] }], startedAt: 3, done: true } });
  assert(/人數少/.test(await p.textContent('#res-note')), '評分結果註明人數少時平均不穩');

  // 7. 預期人數與複選上限：超出範圍標紅、不能開始
  for (const [sel, v, type] of [['#expected', '-5', 'single'], ['#expected', '100000', 'single'], ['#max-n', '0', 'multi'], ['#max-n', '25', 'multi']]) {
    await seed({ draft: DRAFT({ type }) });
    await p.fill(sel, v);
    await tap('#btn-start');
    assert(await vis('#s-setup') && await p.evaluate(s => document.querySelector(s).classList.contains('bad'), sel) && await vis('#num-err'), `${sel}=${v}：標紅、說明、不能開始`);
  }
  // 全形／半形相同的選項算重複
  await seed({ draft: DRAFT({ options: ['ＡＢ', 'ab', '披薩'] }) }); await tap('#btn-start');
  assert(await vis('#s-setup') && await p.locator('.opt-list input.bad').count() === 2, 'ＡＢ 與 ab 視為重複');

  // 8. 清空與 × 可以復原
  await seed({ draft: DRAFT() });
  await tap('#btn-clear-sample');
  assert(await p.inputValue('#question') === '', '清空：題目清掉');
  await tap('#toast-undo');
  assert(await p.inputValue('#question') === '晚餐吃什麼？' && await p.evaluate(() => optInputs().map(i => i.value).join()) === '火鍋,拉麵,披薩,壽司', '清空後「復原」：題目與選項回來');
  await tap('.opt-list li:nth-child(2) .del');
  assert(await p.evaluate(() => optInputs().map(i => i.value).join()) === '火鍋,披薩,壽司', '× 刪除選項');
  await tap('#toast-undo');
  assert(await p.evaluate(() => optInputs().map(i => i.value).join()) === '火鍋,拉麵,披薩,壽司', '× 刪除後「復原」');
  // 新增選項：按鈕留在原位，連按 8 下加 8 項
  {
    const n0 = await p.evaluate(() => optInputs().length), c = await at('#btn-add');
    for (let k = 0; k < 8; k++) { await T('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await sleep(30); await T('touchEnd', []); await sleep(90); }
    await E.settle();
    const n1 = await p.evaluate(() => optInputs().length);
    assert(n1 === n0 + 8, `同一位置連按 8 下「新增選項」：加 ${n1 - n0} 項`);
  }

  // 9. 結果可回看：重新整理後還在；新投票後從「最近結果」點開；隨機決定存進紀錄與複製文字
  await seed({ draft: DRAFT({ options: ['火鍋', '拉麵'] }) });
  await tap('#btn-start');
  for (const v of [0, 1]) { await holdTouch('#hold-ready', voteVisible); await tap('#vopt-' + v); await tap('#btn-submit'); await p.waitForFunction(() => !document.getElementById('s-hand').hidden, null, { timeout: 5000 }); }
  await holdTouch('#hold-end', resultVisible);
  await tap('#btn-tie-random');
  const hist = await p.evaluate(() => JSON.parse(localStorage.getItem('quick-poll:v1:history')));
  assert(/（平手抽籤）$/.test(hist[0].winner) && /隨機決定/.test(hist[0].text), `隨機決定存進紀錄（${hist[0].winner}）`);
  await p.reload();
  assert(await vis('#s-result') && await vis('#tie-pick'), '公布後重新整理：結果頁與抽籤結果都還在');
  await tap('#btn-copy');
  const txt = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  assert(/隨機決定/.test(txt), '複製文字含隨機決定');
  await tap('#btn-new');
  await tap('#hist summary'); await tap('#hist-0');
  assert(await vis('#s-result') && (await p.textContent('#res-q')) === '晚餐吃什麼？' && await p.locator('.bars li').count() === 2, '「最近結果」點開看到完整結果頁');
  await tap('#btn-new');
  if (!(await p.evaluate(() => document.getElementById('hist').open))) await tap('#hist summary');
  await tap('#btn-hist-clear');
  assert(!(await vis('#hist')), '清空最近結果');
  await tap('#toast-undo'); assert(await vis('#hist-0'), '清空紀錄可復原');

  // 10. 具名投票同名提醒
  await seed({ draft: DRAFT({ anon: false }) }); await tap('#btn-start');
  await p.fill('#voter-name', '小明'); await holdTouch('#hold-ready', voteVisible); await tap('#vopt-0'); await tap('#btn-submit');
  await p.waitForFunction(() => !document.getElementById('s-hand').hidden, null, { timeout: 5000 });
  await p.fill('#voter-name', '小明');
  { const c = await at('#hold-ready'); await T('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await p.waitForFunction(() => /已經投過/.test(document.getElementById('toast').textContent), null, { timeout: 5000 }); await T('touchEnd', []); await E.settle(); }
  assert(await vis('#s-hand'), '同名第二次：先提醒，不直接進入');
  await holdTouch('#hold-ready', voteVisible); assert(await vis('#s-vote'), '同名再按住一次：可以投');

  // 12. (r2) 邊緣外 1–8px 的點按（瀏覽器判給該按鈕）要有反應
  for (const [off, rad] of [[1, 0], [3, 0], [5, 10], [8, 10]]) {
    await seed({ draft: DRAFT() });
    const n0 = await p.evaluate(() => optInputs().length);
    const b = await p.evaluate(() => { const e = document.getElementById('btn-add'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom }; });
    const pt = { x: b.x, y: b.y + off, id: 1, ...(rad ? { radiusX: rad, radiusY: rad } : {}) };
    const pdP = p.evaluate(() => new Promise(r => addEventListener('pointerdown', e => r((e.target.closest('button') || {}).id || ''), { once: true, capture: true })));
    await T('touchStart', [pt]); await sleep(40); await T('touchEnd', [pt]); await E.settle();
    const down = await pdP, n1 = await p.evaluate(() => optInputs().length);
    assert(down !== 'btn-add' || n1 === n0 + 1, `「新增選項」下緣外 ${off}px（半徑 ${rad}）：瀏覽器判給按鈕時就有反應（pointerdown→${down || '其他'}，+${n1 - n0}）`);
  }
  // 13. (r2) 換畫面的點按不會聚焦新畫面手指下的輸入框
  {
    await seed({ draft: DRAFT({ anon: false }) }); await tap('#btn-start');
    await p.fill('#voter-name', 'A'); await p.evaluate(() => document.activeElement.blur());
    await holdTouch('#hold-ready', voteVisible); await tap('#btn-vote-back');
    const f = await p.evaluate(() => document.activeElement.tagName + '#' + document.activeElement.id);
    assert(await vis('#s-hand') && !/^INPUT/.test(f), `選票「返回」後沒有聚焦輸入框（${f}）`);
  }
  // 14. (r2) 復原提示不蓋住「開始投票」
  await seed({ draft: DRAFT() }); await p.evaluate(() => scrollTo(0, 0));
  await tap('.opt-list li:nth-child(2) .del');
  {
    const ov = await p.evaluate(() => { const a = document.getElementById('toast').getBoundingClientRect(), b = document.getElementById('btn-start').getBoundingClientRect(); return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)); });
    assert(await vis('#toast-undo') && ov === 0, `刪除後的復原提示不蓋住開始投票（重疊 ${ov}px）`);
  }
  // 鍵盤 Space 仍可用
  { const n0 = await p.evaluate(() => optInputs().length); await p.focus('#btn-add'); await p.keyboard.press('Space');
    assert(await p.evaluate(() => optInputs().length) === n0 + 1, '鍵盤 Space 仍可啟動按鈕'); }
  // 15. (r2) 中途抽籤淘汰、最後平手：複製文字也註明抽籤
  {
    const txt = await p.evaluate(() => { const old = randInt; randInt = () => 1; const poll = { question: 'q', options: ['A', 'B', 'C'], type: 'rank', settings: {}, ballots: [[0, 1, 2], [0, 2, 1], [1, 0, 2], [2, 1, 0]].map(c => ({ choice: c })) }; const R = computeResult(poll); randInt = old; return R.winners.length > 1 ? resultText(poll, R) : 'not tied'; });
    assert(/抽籤淘汰/.test(txt) && /平手/.test(txt), '抽籤淘汰後平手：複製文字含抽籤註記');
  }

  // 16. (r3) 點一般按鈕後馬上點輸入框，輸入框照常聚焦；文字欄有焦點時點按鈕會離開文字欄
  for (const ms of [150, 300, 700]) {
    await seed({ draft: DRAFT() }); await p.evaluate(() => document.activeElement.blur());
    await tap('#btn-theme'); await sleep(ms); await tap('#question');
    const f1 = await p.evaluate(() => document.activeElement.id);
    await p.evaluate(() => document.activeElement.blur());
    await tap('.opt-list li:nth-child(4) .del'); await sleep(ms); await tap('#opt-1');
    const f2 = await p.evaluate(() => document.activeElement.id);
    assert(f1 === 'question' && f2 === 'opt-1', `點按鈕 ${ms}ms 後點輸入框：聚焦（題目→${f1}，選項 1→${f2}）`);
  }
  {
    await seed({ draft: DRAFT({ anon: false }) }); await tap('#btn-start'); await tap('#voter-name');
    const f = await p.evaluate(() => document.activeElement.id);
    assert(f === 'voter-name', `「開始投票」後馬上點名字欄：聚焦（${f}）`);
    await seed({ draft: DRAFT() }); await tap('#question'); await tap('#btn-theme');
    const g = await p.evaluate(() => document.activeElement.tagName + '#' + document.activeElement.id);
    assert(!/^INPUT/.test(g), `焦點在題目時點「主題」：離開文字欄（${g}）`);
  }

  // 11. storage 形狀錯誤不丟錯
  const before = errors.length;
  await seed({ history: { a: 1 }, active: { question: 'x', done: false } });
  assert(await vis('#s-setup') && !(await vis('#resume')) && errors.length === before, 'history 是物件、active 缺欄位：開頁正常，不顯示繼續投票');

  assert(errors.length === 0, '全程沒有 page/console error' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
