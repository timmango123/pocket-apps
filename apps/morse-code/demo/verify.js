// Run: node verify.js  (uses globally installed playwright + chromium)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'); const fs = require('fs');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + SRC + '\n</body></html>');
const URL = 'file://' + WRAP; const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const mk = async (opts) => { const ctx = await browser.newContext(opts); const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e))); return { ctx, page }; };
  const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    assert(!SRC.includes('\uFFFD'), 'no literal U+FFFD in source');
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
    await page.goto(URL); await page.waitForTimeout(150);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === 390 && sw <= iw, 'innerWidth 390, no horizontal scroll');
    assert((await page.locator('#inNote').textContent()).includes('範例'), 'sample marked as 範例');
    assert((await page.locator('#outBox').textContent()) === '··· −−− ··· / ···· · ·−·· ·−·· −−− / ·−− −−− ·−· ·−·· −··', 'SOS HELLO WORLD encoded');
    const r = await page.evaluate(() => {
      const m = __mc; const e = m.encode('SOS'); const s = e.toks.map(t => m.pretty(t.code)).join(' ');
      const d = m.decode('··· −−− ···').out.map(o => o.ch).join('');
      const bad = m.decode('... ........ ---').out.map(o => o.ch).join('');
      const t20 = m.timing(20, 20); const f = m.timing(18, 5);
      const sch = m.schedule([{ code: '.-', wb: false, idx: 0 }, { code: '.', wb: true, idx: 1 }], 20, 20);
      const paris = m.schedule('PARIS'.split('').map((c, i) => ({ code: m.encode(c).toks[0].code, wb: false, idx: i })), 20, 20).total + 7 * 0.06;
      return { s, d, bad, u: t20.u, lg: f.lg, sch: sch.marks.map(x => [x.s, x.e].map(v => +v.toFixed(3))), paris };
    });
    assert(r.s === '··· −−− ···' && r.d === 'SOS', 'SOS <-> ··· −−− ···');
    assert(r.bad === 'S\uFFFDO', 'invalid sequence decoded as replacement char');
    assert(Math.abs(r.u - 0.06) < 1e-9, '20 WPM dot length 60 ms');
    assert(Math.abs(r.paris - 3.0) < 1e-6, 'PARIS + word gap = 50 units = 3.0 s at 20 WPM');
    assert(JSON.stringify(r.sch) === JSON.stringify([[0, 0.06], [0.12, 0.3], [0.72, 0.78]]), 'A then word gap then E timing: ' + JSON.stringify(r.sch));
    assert(Math.abs(r.lg - 3 * ((60 * 18 - 37.2 * 5) / (5 * 18)) / 19) < 1e-9, 'Farnsworth letter gap formula');
    await page.screenshot({ path: OUT + '/390x844.png' });
    // chinese
    await page.fill('#inText', 'SOS 救命');
    assert((await page.locator('#outNote').textContent()).includes('無法編碼：救 命'), 'Chinese flagged as unencodable');
    await page.fill('#inText', 'SOS');
    // play sound
    await page.locator('#playBtn').click(); await page.waitForTimeout(250);
    assert(!(await page.locator('#stopBtn').isDisabled()), 'playing: stop enabled');
    assert(await page.locator('#outBox .hl').count() === 1, 'current letter highlighted');
    await page.screenshot({ path: OUT + '/390x844-playing.png' });
    await page.locator('#stopBtn').click(); await page.waitForTimeout(50);
    assert(await page.locator('#stopBtn').isDisabled(), 'stopped');
    // flash with warning
    await page.locator('label.chip:has(#outFlash)').click();
    await page.locator('#playBtn').click();
    assert(await page.locator('#warnDlg').isVisible(), 'photosensitivity warning shown');
    await page.locator('#warnYes').click(); await page.waitForTimeout(120);
    assert(await page.locator('#flash').isVisible(), 'fullscreen flash layer visible');
    let sawOn = false; for (let i = 0; i < 30; i++) { if (await page.evaluate(() => document.getElementById('flash').classList.contains('on'))) { sawOn = true; break; } await page.waitForTimeout(15); }
    assert(sawOn, 'flash toggles to white during marks');
    await page.screenshot({ path: OUT + '/390x844-flash.png' });
    await page.locator('#flash').click();
    assert(await page.locator('#flash').isHidden(), 'tap stops flash');
    await page.locator('label.chip:has(#outFlash)').click();
    // direction
    await page.locator('#dirBtn').click();
    assert((await page.locator('#inText').inputValue()) === '... --- ...' && (await page.locator('#outBox').textContent()) === 'SOS', 'direction swap: morse -> text');
    await page.locator('#dirBtn').click();
    // keyer
    await page.locator('#tab-key').click();
    const box = await page.locator('#key').boundingBox();
    assert(box.width >= 120, 'key >= 120px');
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const tap = async (ms) => { await page.mouse.move(cx, cy); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); await page.waitForTimeout(70); };
    for (const ms of [60, 60, 60]) await tap(ms); await page.waitForTimeout(400);
    for (const ms of [260, 260, 260]) await tap(ms); await page.waitForTimeout(500);
    const kt = await page.locator('#keyText').textContent();
    assert(/^S ?O/.test(kt), 'keyer decodes S O: ' + JSON.stringify(kt));
    await page.screenshot({ path: OUT + '/390x844-key.png' });
    await page.locator('#mCopy').click();
    await page.locator('#kochPlay').click(); await page.waitForTimeout(100);
    const q = await page.evaluate(() => 1); await page.fill('#kochAns', 'K'); await page.locator('#kochCheck').click();
    assert((await page.locator('#kochResult').textContent()).includes('答案'), 'koch answer checked');
    await page.screenshot({ path: OUT + '/390x844-koch.png' });
    await page.locator('#tab-table').click(); await page.locator('#tLetters button').first().click(); await page.waitForTimeout(50);
    assert(await page.locator('#tLetters button.playing').count() === 1, 'table click plays');
    await page.screenshot({ path: OUT + '/390x844-table.png', fullPage: false });
    // persistence
    await page.locator('#tab-conv').click();
    await page.locator('#wpm').fill('22'); await page.reload(); await page.waitForTimeout(100);
    assert((await page.locator('#wpmOut').textContent()) === '22 WPM' && (await page.locator('#inText').inputValue()) === 'SOS', 'settings + text persisted');
    const sw2 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth); assert(sw2, 'no h-scroll after use');
    await ctx.close();
    for (const [w, h, name] of [[360, 780, '360x780'], [844, 390, '844x390']]) {
      const { ctx, page } = await mk({ viewport: { width: w, height: h }, ...mobile });
      await page.goto(URL); await page.waitForTimeout(150);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(iw === w && sw <= iw, `${name}: innerWidth ${w}, no h-scroll`);
      await page.screenshot({ path: `${OUT}/${name}.png` }); await ctx.close();
    }
    { const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...mobile });
      await page.goto(URL); await page.waitForTimeout(150); await page.screenshot({ path: OUT + '/390x844-dark.png' });
      await page.locator('#tab-key').click(); await page.screenshot({ path: OUT + '/390x844-dark-key.png' }); await ctx.close(); }
    assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await browser.close(); fs.unlinkSync(WRAP); }
})();
