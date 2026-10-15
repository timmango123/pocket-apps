// Verify team-picker: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const mk = async (o = {}) => {
    const vp = o.viewport || { width: 390, height: 844 };
    const ctx = await browser.newContext({ viewport: vp, isMobile: o.mobile !== false, hasTouch: o.mobile !== false, deviceScaleFactor: 2, colorScheme: o.dark ? 'dark' : 'light', reducedMotion: o.reduce ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage(); const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(200);
    ok(await page.evaluate(() => innerWidth) === vp.width, `innerWidth == ${vp.width}`);
    return { ctx, page, errors };
  };
  ok(!fs.readFileSync(SRC, 'utf8').includes('�'), 'no U+FFFD in source');

  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 } },
    { name: '360x780', viewport: { width: 360, height: 780 } },
    { name: '844x390', viewport: { width: 844, height: 390 } },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, dark: true },
    { name: '1280x800', viewport: { width: 1280, height: 800 }, mobile: false },
  ];
  for (const s of sizes) {
    const { ctx, page, errors } = await mk(s);
    await page.click('#go'); await page.waitForTimeout(900);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(100);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input:not([type=checkbox]), .member, .chip')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, w: Math.round(r.width), h: Math.round(r.height) }; }).filter(r => r.w < 44 || r.h < 44));
    ok(small.length === 0, `${s.name} touch targets >= 44px ${JSON.stringify(small.slice(0, 5))}`);
    const tiny = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11).length);
    ok(tiny === 0, `${s.name} text >= 11px`);
    await page.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: s.name === '390x844' });
    if (s.name === '390x844') {
      await page.click('#tab-draw'); await page.click('#draw-next'); await page.waitForTimeout(1600); await page.click('#draw-next'); await page.waitForTimeout(1600); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: `${OUT}/390x844-draw.png` });
    }
    ok(errors.length === 0, `${s.name} no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // ---- logic with spec numbers ----
  {
    const { ctx, page, errors } = await mk({ reduce: true });
    const r = await page.evaluate(() => {
      const T = window.__tp;
      const ppl = n => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, tag: '' }));
      const sizes = g => g.groups.map(x => x.length).sort((a, b) => b - a).join('/');
      const out = {};
      out.k3 = sizes(T.makeGroups(ppl(10), { K: 3 }));
      const pk = T.planK(10, 'size', 4); out.m4 = pk.K + ':' + sizes(T.makeGroups(ppl(10), { K: pk.K }));
      const pk9 = T.planK(9, 'size', 4); out.m4n9 = pk9.K + ':' + pk9.extra + ':' + sizes(T.makeGroups(ppl(9), { K: pk9.K }));
      // tag balance with 3 tags, 4 groups, 100 trials
      let worst = 0;
      const tp = []; for (let i = 0; i < 7; i++) tp.push({ name: 'a' + i, tag: 'A' }); for (let i = 0; i < 5; i++) tp.push({ name: 'b' + i, tag: 'B' }); for (let i = 0; i < 6; i++) tp.push({ name: 'c' + i, tag: 'C' });
      for (let t = 0; t < 100; t++) {
        const g = T.makeGroups(tp, { K: 4, tag: true });
        for (const tag of ['A', 'B', 'C']) { const c = g.groups.map(x => x.filter(p => p.tag === tag).length); worst = Math.max(worst, Math.max(...c) - Math.min(...c)); }
        const s = g.groups.map(x => x.length); worst = Math.max(worst, Math.max(...s) - Math.min(...s));
      }
      out.tagWorst = worst;
      // impossible apart: 3 people all pairwise apart into 2 groups
      const t0 = performance.now();
      const imp = T.makeGroups(ppl(3), { K: 2, apart: [['P0', 'P1'], ['P1', 'P2'], ['P0', 'P2']] });
      out.imp = { conflicts: imp.conflicts, attempts: imp.attempts, ms: performance.now() - t0 };
      // together + apart satisfiable
      let good = 0;
      for (let t = 0; t < 50; t++) {
        const g = T.makeGroups(ppl(10), { K: 3, together: [['P0', 'P1'], ['P1', 'P2']], apart: [['P0', 'P5']] });
        const w = new Map(); g.groups.forEach((x, i) => x.forEach(p => w.set(p.name, i)));
        if (w.get('P0') === w.get('P1') && w.get('P1') === w.get('P2') && w.get('P0') !== w.get('P5') && !g.conflicts) good++;
      }
      out.rules = good;
      out.tooBig = T.makeGroups(ppl(6), { K: 3, together: [['P0', 'P1'], ['P1', 'P2']] }).error || '';
      // 1000 people
      const t1 = performance.now(); const big = T.makeGroups(ppl(1000), { K: 37 }); out.big = { ms: performance.now() - t1, s: sizes(big).split('/').map(Number) };
      // dedupe
      out.dup = T.parse('王小明\n王小明\n 李大華 , 女\n\n王小明').list.map(p => p.name + '|' + p.tag).join(',');
      return out;
    });
    ok(r.k3 === '4/3/3', `10 people into 3 groups -> ${r.k3}`);
    ok(r.m4 === '3:4/3/3', `10 people, 4 per group -> K:sizes ${r.m4}`);
    ok(r.m4n9 === '2:true:5/4', `9 people, 4 per group -> remainder spread (${r.m4n9})`);
    ok(r.tagWorst <= 1, `tag balance (7A/5B/6C into 4) worst per-tag and size spread over 100 runs = ${r.tagWorst}`);
    ok(r.imp.conflicts > 0 && r.imp.attempts === 200 && r.imp.ms < 500, `impossible apart rules stop after ${r.imp.attempts} tries (${r.imp.ms.toFixed(1)}ms), best conflicts ${r.imp.conflicts}`);
    ok(r.rules === 50, `together+apart honoured in ${r.rules}/50 runs`);
    ok(/超過每組上限/.test(r.tooBig), `oversized together unit -> "${r.tooBig}"`);
    ok(r.big.ms < 50 && Math.max(...r.big.s) - Math.min(...r.big.s) <= 1, `1000 people into 37 groups in ${r.big.ms.toFixed(1)}ms, spread ${Math.max(...r.big.s) - Math.min(...r.big.s)}`);
    ok(r.dup === '王小明|,王小明(2)|,李大華|女,王小明(3)|', `parse dedupe/tag -> ${r.dup}`);

    // UI flow: size mode 10 people 4/group
    await page.fill('#roster-text', Array.from({ length: 10 }, (_, i) => '學生' + (i + 1)).join('\n')); await page.waitForTimeout(250);
    ok((await page.textContent('#count')).includes('10'), 'count shows 10');
    await page.click('#by-size'); await page.fill('#k-input', '4'); await page.dispatchEvent('#k-input', 'change');
    await page.click('#go');
    const msg = await page.textContent('#go-msg');
    const cards = await page.$$eval('.group .n', e => e.map(x => x.textContent));
    ok(cards.join(',') .match(/人/g).length === 3 && /部分組別少 1 人/.test(msg), `UI 10/4 -> ${cards.join(' ')} | ${msg}`);
    // absent toggle
    await page.click('.chip >> nth=0'); await page.click('.chip >> nth=1');
    ok((await page.textContent('#count')).includes('出席 8'), 'absent chips reduce attendance to 8');
    await page.click('#by-count'); await page.fill('#k-input', '9'); await page.dispatchEvent('#k-input', 'change');
    ok(await page.isDisabled('#go') && /不能超過出席人數/.test(await page.textContent('#go-msg')), 'K > attendees disables button');
    await page.fill('#k-input', '1'); await page.dispatchEvent('#k-input', 'change');
    ok(await page.isDisabled('#go'), 'K < 2 disables button');
    await page.fill('#k-input', '2'); await page.dispatchEvent('#k-input', 'change'); await page.click('#go');
    const total = await page.$$eval('.member', e => e.length);
    ok(total === 8, `absent excluded from groups (${total} members)`);
    // drag a member between groups using touch-like long press
    const m = await page.$('.group[data-g="0"] .member'); const tgt = await page.$('.group[data-g="1"] .members');
    const a = await m.boundingBox(), b = await tgt.boundingBox();
    await page.mouse.move(a.x + 10, a.y + 10); await page.mouse.down(); await page.waitForTimeout(400);
    await page.mouse.move(b.x + 20, b.y + 20, { steps: 5 }); await page.mouse.up();
    const after = await page.$$eval('.group .n', e => e.map(x => x.textContent));
    ok(after.join(',') === '3 人,5 人', `drag moved member: ${after.join(',')}`);
    // rename group
    await page.fill('#gname-0', '火箭隊'); await page.dispatchEvent('#gname-0', 'change');
    // empty roster
    await page.click('#roster-clear'); await page.click('#roster-clear'); await page.waitForTimeout(250);
    ok(await page.isDisabled('#go') && /請先/.test(await page.textContent('#go-msg')), 'empty roster -> hint & disabled');

    // draw: no repeat through all 3, persist after reload
    await page.fill('#roster-text', '甲\n乙\n丙'); await page.waitForTimeout(250);
    await page.click('#tab-draw');
    for (let i = 0; i < 3; i++) await page.click('#draw-next');
    const order = await page.$$eval('#draw-order li', e => e.map(x => x.textContent));
    ok(new Set(order).size === 3 && await page.isDisabled('#draw-next') && (await page.textContent('#draw-big')) === '全部抽完', `draw without repeat: ${order.join(',')}, button disabled`);
    await page.reload(); await page.waitForTimeout(250);
    ok(await page.isDisabled('#draw-next') && (await page.$$eval('#draw-order li', e => e.length)) === 3 && !(await page.isHidden('#pane-draw')), 'draw state & tab survive reload');
    await page.click('#draw-reset'); await page.click('#draw-reset');
    ok(!(await page.isDisabled('#draw-next')), 'reset re-enables draw');
    // 1000 people via UI
    await page.click('#tab-group');
    await page.fill('#roster-text', Array.from({ length: 1005 }, (_, i) => '人' + i).join('\n')); await page.waitForTimeout(400);
    ok(/略過 5 行/.test(await page.textContent('#roster-note')), '1000-person cap noted');
    await page.fill('#k-input', '40'); await page.dispatchEvent('#k-input', 'change'); await page.click('#go');
    ok((await page.$$eval('.group', e => e.length)) === 40, '1000 people into 40 groups rendered');
    // 1 person
    await page.fill('#roster-text', '獨行俠'); await page.waitForTimeout(250);
    ok(await page.isDisabled('#go'), '1 person cannot be grouped');
    ok(errors.length === 0, `flow no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
