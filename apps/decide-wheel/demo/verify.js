// Verify decide-wheel: run with `node verify.js`
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
// The artifact host wraps the page in a document with a viewport meta; reproduce that for testing.
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(os.tmpdir(), 'decide-wheel-wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const txt = (page, sel) => page.textContent(sel).then(s => s.trim());

(async () => {
  const browser = await chromium.launch();
  const mk = async (opt = {}) => {
    const ctx = await browser.newContext({ viewport: opt.viewport || { width: 390, height: 844 }, isMobile: opt.mobile !== false, hasTouch: opt.mobile !== false, deviceScaleFactor: 2, colorScheme: opt.dark ? 'dark' : 'light', reducedMotion: opt.reduce ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(250);
    return { ctx, page, errors };
  };

  // --- screenshots at all sizes ---
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 } },
    { name: '360x780', viewport: { width: 360, height: 780 } },
    { name: '844x390', viewport: { width: 844, height: 390 } },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, dark: true },
    { name: '1280x800', viewport: { width: 1280, height: 800 }, mobile: false },
  ];
  for (const s of sizes) {
    const { ctx, page, errors } = await mk(s);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input')].filter(e => e.offsetParent && !e.closest('.editor:not(.open)')).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, w: r.width, h: r.height, type: e.type }; }).filter(r => r.type !== 'checkbox' && (r.w < 44 || r.h < 44)));
    ok(small.length === 0, `${s.name} touch targets >= 44px ${JSON.stringify(small)}`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.dark) {
      const cr = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const lum = hex => { const v = hex.trim().replace('#', ''); const c = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
        const t = lum(cs.getPropertyValue('--wtext'));
        return Math.min(...Array.from({ length: 12 }, (_, i) => { const l = lum(cs.getPropertyValue('--w' + i)); return (Math.max(l, t) + 0.05) / (Math.min(l, t) + 0.05); }));
      });
      ok(cr >= 4.5, `dark wheel label contrast min ${cr.toFixed(2)} >= 4.5`);
    }
    if (s.name === '1280x800') {
      await page.click('#mode-dice'); await page.screenshot({ path: `${OUT}/1280x800-dice.png` });
    }
    ok(errors.length === 0, `${s.name} no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- functional flow (reduced motion so spins resolve instantly) ---
  {
    const { ctx, page, errors } = await mk({ reduce: true });
    // fairness of the weighted picker
    const dist = await page.evaluate(() => {
      const w = [1, 2, 3, 4], run = n => { const c = [0, 0, 0, 0]; for (let i = 0; i < n; i++) c[window.__dw.pickWeighted(w)]++; return c.map(x => x / n); };
      return { k1: run(1000), k100: run(100000) };
    });
    const exp = [0.1, 0.2, 0.3, 0.4];
    const maxErr = a => Math.max(...a.map((x, i) => Math.abs(x - exp[i])));
    console.log('INFO ' + (maxErr(dist.k1) < 0.03 ? 'within 3%' : 'outside 3% (sampling noise at n=1000, sd ~1.5%)') + `: 1000 picks weights 1:2:3:4 -> ${dist.k1.map(x => x.toFixed(3)).join('/')} (max err ${maxErr(dist.k1).toFixed(3)})`);
    ok(maxErr(dist.k100) < 0.005, `100000 picks -> ${dist.k100.map(x => x.toFixed(4)).join('/')}`);
    const ri = await page.evaluate(() => { const c = new Array(7).fill(0); for (let i = 0; i < 70000; i++) c[window.__dw.randInt(7)]++; return Math.max(...c.map(x => Math.abs(x / 70000 - 1 / 7))); });
    ok(ri < 0.006, `randInt(7) uniform (max dev ${ri.toFixed(4)})`);

    // pointer stop matches announced result, 20 spins
    let match = 0;
    for (let k = 0; k < 20; k++) {
      await page.click('#spin');
      const big = await txt(page, '#res-big');
      const under = await page.evaluate(() => window.__dw.sectorAtPointer());
      if (big === under) match++;
    }
    ok(match === 20, `20 spins: pointer sector == result text (${match}/20)`);
    ok((await page.locator('#hist span').count()) === 10, 'history shows 10 chips');

    // elimination down to final decision on 飲料 (6 items)
    await page.selectOption('#list-select', 'drink');
    for (let k = 0; k < 5; k++) { await page.click('#spin'); await page.click('#remove'); }
    const fin = await txt(page, '#res-big');
    ok(/^最終決定：/.test(fin) && await page.isDisabled('#spin'), `elimination ends with "${fin}", spin disabled`);
    await page.click('#restore');
    ok(!(await page.isDisabled('#spin')), 'restore re-enables spin');

    // editor: paste multiline with separators + dedupe
    await page.click('#edit-btn'); await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/390x844-editor.png` });
    await page.click('#paste-toggle');
    await page.fill('#paste-text', '果汁、珍珠奶茶,豆漿\n果汁\n 紅茶拿鐵 ，抹茶');
    await page.click('#paste-add');
    const msg = await txt(page, '#ed-msg');
    const count = await page.locator('#items .item').count();
    ok(count === 10 && /已加入 4 項/.test(msg), `paste: ${msg}, list now ${count} items (6 + 果汁/豆漿/紅茶拿鐵/抹茶)`);
    // over 60
    const many = Array.from({ length: 60 }, (_, i) => '選項' + (i + 1)).join('\n');
    await page.fill('#paste-text', many); await page.click('#paste-add');
    const msg2 = await txt(page, '#ed-msg');
    ok((await page.locator('#items .item').count()) === 60 && /上限/.test(msg2) && await page.isDisabled('#add-item'), `61+ items rejected: ${msg2}`);
    // long text + emoji
    await page.fill('#item-0', '🍜超級無敵好吃的豚骨叉燒拉麵加大份量再加一顆溏心蛋與海苔');
    ok(Array.from(await page.inputValue('#item-0')).length <= 30, '30-char limit on item');
    await page.click('#ed-close'); await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/390x844-60items.png` });
    await page.click('#spin');
    ok((await txt(page, '#res-big')) === await page.evaluate(() => window.__dw.sectorAtPointer()), '60-item spin result matches pointer');

    // fewer than 2 items -> disabled + hint
    await page.selectOption('#list-select', 'pay');
    await page.click('#edit-btn'); await page.waitForTimeout(350);
    for (let k = 0; k < 3; k++) await page.click('#item-0-del');
    await page.click('#ed-close'); await page.waitForTimeout(350);
    ok(await page.isDisabled('#spin') && (await txt(page, '#hint')) === '至少需要 2 個選項', '1 item: spin disabled with hint');
    await page.click('#edit-btn'); await page.waitForTimeout(350);
    await page.click('#add-item'); await page.fill('#item-1', '小明');
    await page.click('#item-1-wplus');
    await page.click('#ed-close'); await page.waitForTimeout(350);

    // deck: 我自己(w2) + 小明(w2) = 4 cards, no replacement
    await page.click('#mode-deck');
    ok((await txt(page, '#deck-left')) === '4', 'deck has 4 cards (weights as card count)');
    const drawn = [];
    for (let k = 0; k < 4; k++) { await page.click('#deck'); drawn.push(await txt(page, '#card-text')); }
    drawn.sort();
    ok(JSON.stringify(drawn) === JSON.stringify(['小明', '小明', '我自己', '我自己']) && (await txt(page, '#deck-left')) === '0' && await page.isVisible('#deck-empty'), `drew all: ${drawn.join(',')}; shows 全部抽完`);
    await page.screenshot({ path: `${OUT}/390x844-deck.png` });
    await page.click('#reshuffle');
    ok((await txt(page, '#deck-left')) === '4', 'reshuffle restores 4');

    // dice: 3 x d20 with +2 modifier
    await page.click('#mode-dice');
    await page.click('#dc-plus');
    await page.click('#sides-20');
    await page.check('#mod-on'); await page.click('#mod-plus'); await page.click('#mod-plus');
    for (let k = 0; k < 5; k++) {
      await page.click('#roll'); await page.waitForTimeout(400);
      const total = +(await txt(page, '#res-big'));
      const det = await txt(page, '#res-detail');
      const nums = det.split('=')[0].match(/\d+/g).map(Number);
      const dice = nums.slice(0, 3);
      ok(nums.length === 4 && nums[3] === 2 && dice.every(v => v >= 1 && v <= 20) && total === dice[0] + dice[1] + dice[2] + 2, `roll ${k + 1}: ${det}`);
    }
    await page.screenshot({ path: `${OUT}/390x844-dice.png` });

    // persistence
    await page.waitForTimeout(400);
    await page.reload(); await page.waitForTimeout(250);
    ok((await page.getAttribute('#mode-dice', 'aria-selected')) === 'true' && (await txt(page, '#dc-count')) === '3' && (await page.locator('#hist span').count()) === 10, 'mode, dice settings and history persist');
    await page.click('#mode-wheel');
    ok((await page.inputValue('#list-select')) === 'pay', 'current list persists');
    ok(errors.length === 0, `functional run no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- real animated spin (no reduced motion) ---
  {
    const { ctx, page, errors } = await mk();
    await page.click('#spin');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/390x844-spinning.png` });
    ok(await page.isDisabled('#spin'), 'spin button disabled while spinning');
    await page.waitForTimeout(5000);
    const big = await txt(page, '#res-big');
    ok(big === await page.evaluate(() => window.__dw.sectorAtPointer()) && big !== '？', `animated spin landed on "${big}" matching pointer`);
    // fling gesture
    const box = await page.locator('#wheel').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx + 120, cy - 60); await page.mouse.down();
    for (let k = 1; k <= 6; k++) { await page.mouse.move(cx + 120 - k * 4, cy - 60 + k * 25); await page.waitForTimeout(10); }
    await page.mouse.up();
    await page.waitForTimeout(200);
    ok(await page.isDisabled('#spin'), 'fling starts a spin');
    await page.waitForTimeout(6200);
    const big2 = await txt(page, '#res-big');
    ok(big2 === await page.evaluate(() => window.__dw.sectorAtPointer()), `fling spin landed on "${big2}" matching pointer`);
    ok(errors.length === 0, `animated run no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
