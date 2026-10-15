// Run: node verify.js  (uses globally installed playwright + chromium)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'); const fs = require('fs');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + SRC + '\n</body></html>');
const URL = 'file://' + WRAP; const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const mk = async (opts) => { const ctx = await browser.newContext(opts); const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e))); return { ctx, page }; };
  const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    assert(!/�/.test(SRC), 'no literal U+FFFD');
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
    await page.goto(URL); await page.waitForTimeout(200);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === 390 && sw <= iw, 'innerWidth 390, no horizontal scroll');
    const g = await page.evaluate(() => { const w = document.getElementById('wrap'); const t = document.getElementById('ptable'); return { ww: w.clientWidth, tw: t.scrollWidth, cell: parseFloat(getComputedStyle(t).getPropertyValue('--cell')), n: t.querySelectorAll('.el').length }; });
    assert(g.n === 118 && g.tw <= g.ww, `118 cells, all 18 columns fit (${g.tw} <= ${g.ww}, cell ${g.cell.toFixed(1)}px)`);
    const r = await page.evaluate(() => { const p = __pt; return {
      cr: p.cfgShort(24), cu: p.cfgShort(29), fe: p.cfgShort(26), gd: p.cfgShort(64), u: p.cfgShort(92), pd: p.cfgShort(46), fefull: p.cfgFull(26), ne: p.cfgShort(10), h: p.cfgShort(1), lr: p.cfgShort(103),
      shFe: p.shells(26).join(','), shAu: p.shells(79).join(','),
      hg300: p.phaseAt(p.E[79], 300), hg230: p.phaseAt(p.E[79], 230), hg250: p.phaseAt(p.E[79], 250), br298: p.phaseAt(p.E[34], 298),
      s: ['8', 'O', '氧', 'oxygen', 'OXYGEN'].map(q => p.search(q).map(e => e.sym).join('|')),
      masses: [p.E[0].mass, p.E[5].mass, p.E[16].mass, p.E[25].mass, p.E[78].mass, p.E[117].mass] }; });
    console.log(JSON.stringify(r));
    assert(r.cr === '[Ar] 3d⁵ 4s¹' && r.cu === '[Ar] 3d¹⁰ 4s¹', 'Cr/Cu exceptions');
    assert(r.fe === '[Ar] 3d⁶ 4s²' && r.fefull === '1s² 2s² 2p⁶ 3s² 3p⁶ 3d⁶ 4s²', 'Fe config');
    assert(r.gd === '[Xe] 4f⁷ 5d¹ 6s²' && r.u === '[Rn] 5f³ 6d¹ 7s²' && r.pd === '[Kr] 4d¹⁰' && r.lr === '[Rn] 5f¹⁴ 7s² 7p¹', 'Gd/U/Pd/Lr configs');
    assert(r.ne === '[He] 2s² 2p⁶' && r.h === '1s¹', 'Ne/H configs');
    assert(r.shFe === '2,8,14,2' && r.shAu === '2,8,18,32,18,1', 'shell counts');
    assert(r.hg300 === 'l' && r.hg230 === 's' && r.br298 === 'l', 'Hg liquid at 300 K, solid at 230 K (mp 234.3 K); Br liquid');
    assert(r.s.slice(0, 5).every(x => x === 'O'), 'search 8 / O / 氧 / oxygen all -> O');
    assert(JSON.stringify(r.masses) === JSON.stringify(['1.008', '12.011', '35.45', '55.845', '196.97', '[294]']), 'IUPAC masses');
    // open all 118 details, check no undefined/NaN
    const bad = await page.evaluate(() => { const out = []; for (let z = 1; z <= 118; z++) { __pt.openDetail(z); const t = document.getElementById('detInner').textContent; if (/undefined|NaN|null/.test(t)) out.push(z); } return out; });
    assert(bad.length === 0, 'all 118 details render without undefined/NaN/null ' + bad.join(','));
    await page.evaluate(() => __pt.openDetail(8));
    await page.screenshot({ path: OUT + '/390x844.png' });
    // search UI
    await page.fill('#q', 'oxygen'); await page.waitForTimeout(250);
    assert(await page.locator('.el.dim').count() === 117, 'search dims others');
    assert((await page.locator('#detInner h2').textContent()) === '氧', 'single result opens 氧');
    await page.fill('#q', ''); await page.waitForTimeout(200);
    // tap a cell
    await page.locator('.el[data-z="29"]').tap(); await page.waitForTimeout(100);
    assert((await page.locator('#detInner .cfg b').textContent()) === '[Ar] 3d¹⁰ 4s¹', 'tap Cu shows config');
    await page.locator('#nextEl').click(); assert((await page.locator('#detInner h2').textContent()) === '鋅', 'next element');
    await page.locator('#unitT').click(); assert((await page.locator('table.props').textContent()).includes('692.68 K'), 'unit K toggle (Zn mp 692.68 K)');
    await page.locator('#unitT').click();
    await page.locator('#expandDet').click(); await page.waitForTimeout(250);
    await page.screenshot({ path: OUT + '/390x844-detail-full.png' });
    await page.locator('#expandDet').click(); await page.locator('#closeDet').click();
    // zoom
    await page.locator('#zoomIn').click(); await page.locator('#zoomIn').click(); await page.locator('#zoomIn').click();
    const zc = await page.evaluate(() => [parseFloat(getComputedStyle(document.getElementById('ptable')).getPropertyValue('--cell')), document.getElementById('ptable').className]);
    assert(zc[0] >= 48 && zc[1].includes('z3'), 'zoomed cell >= 48px shows names: ' + zc[0].toFixed(1));
    await page.screenshot({ path: OUT + '/390x844-zoom.png' });
    const [sw3] = await page.evaluate(() => [document.documentElement.scrollWidth <= innerWidth]); assert(sw3, 'no page h-scroll when zoomed');
    // color by phase + temperature
    await page.selectOption('#colorBy', 'phase');
    await page.locator('#tempK').fill('300'); await page.waitForTimeout(50);
    assert(await page.locator('.el[data-z="80"]').getAttribute('data-key') === 'pl', 'Hg liquid at 300 K on table');
    await page.locator('#tempK').fill('230');
    assert(await page.locator('.el[data-z="80"]').getAttribute('data-key') === 'ps', 'Hg solid at 230 K on table');
    await page.locator('#zoomOut').click(); await page.locator('#zoomOut').click(); await page.locator('#zoomOut').click();
    await page.screenshot({ path: OUT + '/390x844-phase.png' });
    await page.selectOption('#colorBy', 'en');
    await page.locator('#legend button').nth(4).click();
    assert(await page.locator('.el.dim').count() > 90, 'legend click highlights one bucket');
    await page.locator('#legend button').nth(4).click();
    await page.selectOption('#colorBy', 'cat');
    // list
    await page.locator('#mList').click(); assert(await page.locator('#list .row').count() === 118, 'list mode 118 rows');
    await page.screenshot({ path: OUT + '/390x844-list.png' });
    // quiz
    await page.locator('#mQuiz').click(); await page.locator('#qOpts button').first().click();
    assert((await page.locator('#qScore').textContent()).includes('/1'), 'quiz answer recorded');
    await page.screenshot({ path: OUT + '/390x844-quiz.png' });
    await page.reload(); await page.waitForTimeout(150);
    assert(await page.locator('#vQuizView').isVisible() && (await page.locator('#qScore').textContent()).includes('/1'), 'view + quiz stats persisted');
    await page.locator('#mTable').click();
    await ctx.close();
    for (const [w, h, name, opt] of [[360, 780, '360x780', mobile], [844, 390, '844x390', mobile], [1280, 800, 'desktop', {}]]) {
      const { ctx, page } = await mk({ viewport: { width: w, height: h }, ...opt });
      await page.goto(URL); await page.waitForTimeout(200);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(iw === w && sw <= iw, `${name}: innerWidth ${w}, no h-scroll`);
      if (name === 'desktop') { await page.locator('.el[data-z="26"]').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
        assert((await page.locator('#detInner h2').textContent()) === '鈷', 'keyboard arrow + Enter opens Co'); }
      await page.screenshot({ path: `${OUT}/${name}.png` }); await ctx.close();
    }
    { const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...mobile });
      await page.goto(URL); await page.waitForTimeout(200); await page.screenshot({ path: OUT + '/390x844-dark.png' });
      await page.selectOption('#colorBy', 'en'); await page.screenshot({ path: OUT + '/390x844-dark-en.png' }); await ctx.close(); }
    assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await browser.close(); fs.unlinkSync(WRAP); }
})();
