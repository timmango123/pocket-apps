// 投票器驗證：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '../index.html'), WRAP = path.join(__dirname, 'preview.html'), OUT = __dirname;
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function open(browser, opt, reduced = true) {
  const ctx = await browser.newContext({ ...opt, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL_); await page.waitForTimeout(200);
  return { ctx, page, errors };
}
async function hold(page, sel, ms = 1150) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
  await page.waitForTimeout(80);
}
async function voteSingle(page, idx) {
  await hold(page, '#hold-ready');
  await page.click('#vopt-' + idx); await page.click('#btn-submit');
  await page.waitForSelector('#s-hand:not([hidden])', { timeout: 3000 });
}
(async () => {
  const browser = await chromium.launch();
  const mob = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  let { ctx, page, errors } = await open(browser, mob);
  ok(await page.evaluate(() => innerWidth) === 390, 'innerWidth = 390');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // 1. IRV 手算案例
  const irvCases = await page.evaluate(() => {
    const A = 0, B = 1, C = 2, D = 3, out = {};
    // 案例 1：5 票 3 候選，需 2 輪
    let r = irv(3, [[A, B, C], [A, C, B], [B, C, A], [C, B, A], [C, B, A]]);
    out.c1 = { winner: r.winner, rounds: r.rounds.length, r1: r.rounds[0].counts, elim: r.rounds[0].eliminated, r2: r.rounds[1].counts };
    // 案例 2：同票時依上一輪淘汰；含用盡選票
    const b = [...Array(5)].map(() => [A]).concat([[B], [B], [B], [C, B], [C, B], [D, C]]);
    r = irv(4, b);
    out.c2 = { winner: r.winner, rounds: r.rounds.map(x => ({ c: x.counts, e: x.eliminated, prev: x.byPrev, ex: x.exhausted })) };
    // 案例 3：首輪即過半
    r = irv(3, [[A], [A], [A], [B], [C]]); out.c3 = { winner: r.winner, rounds: r.rounds.length };
    // 案例 4：完全同票 → 抽籤淘汰
    r = irv(2, [[A], [B]]); out.c4 = { winner: r.winner, lotto: r.rounds[0].lotto };
    // 效能：100 票 × 20 項
    const big = [...Array(100)].map(() => shuffled([...Array(20).keys()]));
    const t0 = performance.now(); irv(20, big); out.ms = performance.now() - t0;
    return out;
  });
  const c1 = irvCases.c1;
  ok(c1.winner === 2 && c1.rounds === 2 && c1.r1[0] === 2 && c1.r1[1] === 1 && c1.r1[2] === 2 && c1.elim === 1 && c1.r2[2] === 3, `IRV 案例 1：首輪 A2/B1/C2 → 淘汰 B → C 3 票過半當選（2 輪）`);
  const c2 = irvCases.c2.rounds;
  ok(irvCases.c2.winner === 0 && c2.length === 4 && c2[0].e === 3 && c2[1].e === 2 && c2[1].prev && c2[2].ex === 1 && c2[2].c[0] === 5 && c2[2].c[1] === 5 && c2[2].e === 1,
    'IRV 案例 2：A5/B3/C2/D1 → 淘汰 D → B、C 同 3 票依上一輪淘汰 C → A5:B5（1 張用盡）依上一輪淘汰 B → A 當選（4 輪）');
  ok(irvCases.c3.winner === 0 && irvCases.c3.rounds === 1, 'IRV 案例 3：首輪 3/5 過半直接當選');
  ok(irvCases.c4.lotto && irvCases.c4.winner >= 0, 'IRV 案例 4：1:1 無上一輪 → 抽籤淘汰並註明');
  ok(irvCases.ms < 10, `IRV 100 票 × 20 項耗時 ${irvCases.ms.toFixed(2)}ms`);

  // 2. 建立驗證：空白與重複
  await page.fill('#opt-2', '火鍋');
  await page.click('#btn-start');
  ok(await page.isVisible('#setup-err') && (await page.locator('.opt-list input.bad').count()) === 2, '重複選項開始時被拒並標紅');
  await page.fill('#opt-2', '拉麵');
  ok(await page.locator('#sample-tag').isVisible(), '預設範例題目標示「範例」');

  // 3. 單選 8 票流程（含中途重新整理恢復）
  await page.click('#btn-start');
  ok(await page.isVisible('#s-hand') && await page.isDisabled('#hold-end'), '交接畫面；0 票時無法公布');
  await page.click('#hold-ready'); // 只點不按住
  ok(await page.isVisible('#s-hand'), '只點一下不會進入投票（需按住 1 秒）');
  for (const v of [0, 1, 0, 2]) await voteSingle(page, v);
  ok((await page.textContent('#hand-count')) === '4', '已投 4 票');
  await page.reload(); await page.waitForTimeout(200);
  ok(await page.isVisible('#resume') && (await page.textContent('#resume-text')).includes('已 4 票'), '重新整理後詢問「繼續上次投票（已 4 票）」');
  await page.click('#btn-resume');
  ok((await page.textContent('#hand-k')) === '5', '恢復後從第 5 位繼續，票數不重複不遺失');
  for (const v of [1, 0, 1, 0]) await voteSingle(page, v);
  await hold(page, '#hold-end');
  await page.waitForSelector('#s-result:not([hidden])');
  await page.click('#btn-copy');
  const txt = await page.evaluate(() => navigator.clipboard.readText());
  ok(txt === '📊 晚餐吃什麼？（共 8 票）\n1. 火鍋 4 票 50%\n2. 拉麵 3 票 38%\n3. 披薩 1 票 13%', '複製結果與規格範例完全一致：\n' + txt);
  ok((await page.textContent('#res-note')).includes('101%'), '註明四捨五入總和 101%');
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => document.querySelector('.bars li.win .lab span').textContent) === '火鍋', '勝出項強調');
  await page.screenshot({ path: path.join(OUT, '390x844-result.png') });

  // 4. 平手 + 隨機決定
  await page.click('#btn-new');
  await page.fill('#question', '週末去哪？'); await page.fill('#opt-1', '海邊'); await page.fill('#opt-2', '山上'); await page.fill('#opt-3', '動物園');
  await page.check('#abstain'); await page.fill('#expected', '3');
  await page.click('#btn-start');
  await voteSingle(page, 0); await voteSingle(page, 1);
  await hold(page, '#hold-ready'); await page.click('#btn-abstain-vote'); await page.waitForSelector('#s-hand:not([hidden])');
  ok(await page.isVisible('#all-done'), '達到預期人數 → 「全員已投，公布結果？」');
  await page.click('#btn-publish-now');
  ok(await page.isVisible('#btn-tie-random') && (await page.textContent('#tie-box')).includes('平手'), '最高票同票顯示平手');
  ok((await page.textContent('#res-summary')).includes('1棄權'), '棄權計入投票人數');
  await page.click('#btn-tie-random');
  ok(/隨機選中：(海邊|山上)/.test(await page.textContent('#tie-pick')), '交給隨機決定 → ' + await page.textContent('#tie-pick'));

  // 5. 排序投票（UI）重現案例 1
  await page.click('#btn-new');
  await page.fill('#question', '社團旅遊地點'); await page.fill('#opt-1', '台南'); await page.fill('#opt-2', '花蓮'); await page.fill('#opt-3', '澎湖');
  await page.uncheck('#abstain'); await page.fill('#expected', '');
  await page.check('#type-rank');
  await page.click('#btn-start');
  const orders = [[0, 1, 2], [0, 2, 1], [1, 2, 0], [2, 1, 0], [2, 1, 0]];
  for (const ord of orders) {
    await hold(page, '#hold-ready');
    // 以 ↑ 按鈕排出 ord
    for (let pos = 0; pos < ord.length; pos++) {
      for (let g = 0; g < 5; g++) {
        const curOrd = await page.evaluate(() => cur.rank.slice());
        const at = curOrd.indexOf(ord[pos]); if (at === pos) break;
        await page.locator(`.rank-row[data-i="${ord[pos]}"] .mv >> nth=0`).click();
      }
    }
    ok(JSON.stringify(await page.evaluate(() => cur.rank)) === JSON.stringify(ord), '排序 ' + ord.join('>'));
    await page.click('#btn-submit'); await page.waitForSelector('#s-hand:not([hidden])');
  }
  await hold(page, '#hold-end'); await page.waitForSelector('#s-result:not([hidden])');
  await page.click('#tab-table');
  const irvTbl = await page.evaluate(() => [...document.querySelectorAll('#irv-table tbody tr')].map(tr => [...tr.cells].map(c => c.textContent.trim())));
  ok(irvTbl[2][2].startsWith('3') && irvTbl[1][1].includes('✕') && irvTbl.length === 4, 'UI 排序投票逐輪表：花蓮第 1 輪淘汰，澎湖第 2 輪 3 票當選 ' + JSON.stringify(irvTbl));
  await page.screenshot({ path: path.join(OUT, '390x844-irv.png') });

  // 6. 評分 + 非匿名 + 複選上限
  await page.click('#btn-new');
  await page.check('#type-rating'); await page.uncheck('#anon');
  await page.click('#btn-start');
  const rates = [[5, 3, 4], [4, 5, 0], [5, 2, 3]];
  for (const [k, rr] of rates.entries()) {
    await page.fill('#voter-name', ['小美', '阿傑', '小華'][k]);
    await hold(page, '#hold-ready');
    for (let i = 0; i < 3; i++) if (rr[i]) await page.click(`#star-${i}-${rr[i]}`);
    await page.click('#btn-submit'); await page.waitForSelector('#s-hand:not([hidden])');
  }
  await hold(page, '#hold-end'); await page.waitForSelector('#s-result:not([hidden])');
  await page.click('#btn-copy');
  const rt = await page.evaluate(() => navigator.clipboard.readText());
  ok(rt.includes('1. 台南 平均 4.7 分（3 人評分）') && rt.includes('2. 澎湖 平均 3.5 分（2 人評分）') && rt.includes('3. 花蓮 平均 3.3 分（3 人評分）'), '評分平均：台南 4.7、澎湖 3.5（2 人）、花蓮 3.3\n' + rt);
  await page.click('#tab-table');
  ok((await page.textContent('#pane-table')).includes('阿傑'), '非匿名明細顯示投票者');
  await page.click('#btn-new');
  await page.check('#type-multi'); await page.check('#anon'); await page.fill('#max-n', '2');
  await page.click('#btn-start'); await hold(page, '#hold-ready');
  await page.click('#vopt-0'); await page.click('#vopt-1');
  ok(await page.isDisabled('#vopt-2'), '複選上限 2：其餘選項停用');

  // 7. 20 選項
  await page.evaluate(() => { store.del('active'); poll = null; backToSetup(); });
  for (let i = 4; i <= 25; i++) await page.click('#btn-add').catch(() => {});
  ok(await page.locator('.opt-list li').count() === 20 && await page.isDisabled('#btn-add'), '最多 20 個選項');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 無水平捲動');
  ok(errors.length === 0, 'console/pageerror 無錯誤 ' + errors.join(' | '));
  await ctx.close();

  // 8. 截圖
  const shots = [
    ['360x780.png', { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ['844x390.png', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ['390x844-dark.png', { ...mob, colorScheme: 'dark' }],
    ['1100x800-desktop.png', { viewport: { width: 1100, height: 800 } }],
  ];
  for (const [name, opt] of shots) {
    const { ctx: c, page: p, errors: e } = await open(browser, opt);
    ok(await p.evaluate(w => innerWidth === w, opt.viewport.width), `${name} innerWidth`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} 無水平捲動`);
    await p.screenshot({ path: path.join(OUT, name) });
    if (name.includes('dark')) {
      await p.click('#btn-start'); await hold(p, '#hold-ready'); await p.click('#vopt-0');
      await p.screenshot({ path: path.join(OUT, '390x844-dark-vote.png') });
      await p.click('#btn-submit'); await p.waitForSelector('#s-hand:not([hidden])');
      await p.screenshot({ path: path.join(OUT, '390x844-dark-hand.png') });
      await hold(p, '#hold-end'); await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(OUT, '390x844-dark-result.png') });
    }
    if (name.startsWith('844')) { await p.click('#btn-start'); await p.screenshot({ path: path.join(OUT, '844x390-hand.png') }); }
    const small = await p.evaluate(() => [...document.querySelectorAll('button, input, summary, .types label')].filter(b => b.offsetParent && b.type !== 'radio' && b.type !== 'checkbox' && b.getBoundingClientRect().height < 40).map(b => b.id || b.textContent.trim()).slice(0, 5));
    ok(small.length === 0, `${name} 觸控目標高度 ≥40 ${small}`);
    ok(e.length === 0, `${name} 無錯誤 ${e}`);
    await c.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過'); process.exit(fails ? 1 : 0);
})();
