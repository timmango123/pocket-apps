// End-to-end check of 虛擬鋼琴與和弦表 in Chromium: 390×844 plus the three lobby iframe sizes, light and dark,
// chord / scale / identification flows, real multi-touch through CDP touch events, no page errors.
// Run: node verify.js   (writes demo/*.png incl. cover-390x520.png, all gitignored)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>\n' + SRC + '\n</body></html>';
const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SIZES = [[390, 844], [375, 500], [390, 610], [430, 740]];
let URL = '';
function serve() { const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); }); return new Promise(r => srv.listen(0, () => r(srv))); }

async function open(browser, w, h, scheme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL); await sleep(250);
  return { ctx, page, errors };
}
const text = (page, sel) => page.locator(sel).textContent();
const keyPoint = (page, m) => page.evaluate(m => { const r = __pc.keysWrap.querySelector(`[data-m="${m}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * (r.height > 100 ? 0.85 : 0.4), vis: r.left >= 0 && r.right <= innerWidth }; }, m);

(async () => {
  const srv = await serve(); URL = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const [w, h] of SIZES) for (const scheme of ['light', 'dark']) {
      const { ctx, page, errors } = await open(browser, w, h, scheme);
      const ow = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(ow[0] <= ow[1], `${w}×${h} ${scheme}: no horizontal overflow (${ow})`);
      // first open: sample chord C highlighted, 範例 progression visible
      assert((await text(page, '#chName')) === 'C' && /大三和弦/.test(await text(page, '#chZh')), `${w}×${h} ${scheme}: first open shows C 大三和弦`);
      assert(await page.locator('#progChips .chip').count() === 4 && /範例/.test(await text(page, '.prog .tag')), 'sample progression C–G–Am–F marked 範例');
      const hl = await page.evaluate(() => Object.keys(__pc.HL).map(Number).sort((a, b) => a - b));
      assert(hl.join() === '60,64,67', 'C4 E4 G4 highlighted on the keyboard');
      assert((await keyPoint(page, 60)).vis && (await keyPoint(page, 83)).vis, 'C4…B5 (two octaves) visible without scrolling');
      const kb = await page.locator('#keysWrap').boundingBox();
      assert(kb.y + kb.height <= h + 1 && kb.height >= 100, `keyboard fully inside the ${w}×${h} viewport (bottom ${Math.round(kb.y + kb.height)})`);
      const small = await page.evaluate(() => [...document.querySelectorAll('button, select')].filter(e => e.offsetParent && !e.closest('[hidden]')).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 6), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      assert(small.length === 0, 'all tap targets >= 44px ' + JSON.stringify(small));
      if (w === 390 && h === 844 && scheme === 'light') await page.screenshot({ path: OUT + '/390x844.png' });
      if (w === 390 && h === 844 && scheme === 'dark') await page.screenshot({ path: OUT + '/390x844-dark.png' });
      if (h === 500 && scheme === 'light') await page.screenshot({ path: OUT + '/375x500.png' });
      assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
      await ctx.close();
    }

    // flows at 390×844
    {
      const { ctx, page, errors } = await open(browser, 390, 844, 'light');
      // chord lookup: F♯maj7 with first inversion
      await page.locator('#chLetters [data-l="3"]').click();
      await page.locator('#chAcc [data-a="1"]').click();
      await page.locator('#chQual [data-q="maj7"]').click();
      assert((await text(page, '#chName')) === 'F♯maj7', 'F♯maj7 selected');
      assert((await page.locator('#chNotes .note b').allTextContents()).join(' ') === 'F♯ A♯ C♯ E♯', 'notes spelled F♯ A♯ C♯ E♯');
      assert((await page.locator('#chNotes .note small').allTextContents()).join(' ') === 'R 3 5 7', 'intervals R 3 5 7');
      await page.locator('#chInv [data-i="1"]').click();
      assert((await text(page, '#chName')) === 'F♯maj7/A♯' && /第一轉位/.test(await text(page, '#chZh')), 'first inversion → F♯maj7/A♯');
      assert(await page.evaluate(() => Object.keys(__pc.HL).length) === 4, 'four keys highlighted');
      const lbl = await page.evaluate(() => __pc.keysWrap.querySelector('[data-m="78"] .lb').textContent);
      assert(lbl === 'F♯', 'highlighted black key labelled F♯');
      // sound: block and arpeggio
      await page.locator('#playBlock').click(); await sleep(120);
      let v = await page.evaluate(() => __pc.Piano.voices.filter(v => !v.released).map(v => v.m));
      assert(v.length === 4 && await page.evaluate(() => __pc.Piano.ctx.state) === 'running', 'block chord sounds 4 voices, context running');
      await page.locator('#playArp').click(); await sleep(120);
      v = await page.evaluate(() => __pc.Piano.voices.filter(v => !v.released).length);
      assert(v === 1, 'arpeggio starts one note at a time');
      await sleep(600);
      v = await page.evaluate(() => __pc.PRESSED.size);
      assert(v >= 3, 'arpeggio keys light up on the keyboard (' + v + ')');
      await sleep(1400);
      assert(await page.evaluate(() => __pc.PRESSED.size) === 0, 'arpeggio keys released after playback');
      // progression tap + play all
      await page.locator('#progChips .chip').nth(2).click();
      assert((await text(page, '#chName')) === 'Am', 'tapping the progression chip loads Am');
      await page.locator('#playProg').click(); await sleep(150);
      assert(/停止/.test(await text(page, '#playProg')) && await page.evaluate(() => Object.keys(__pc.HL).join()) === '60,64,67', 'play all: first chord C highlighted');
      await page.locator('#playProg').click();
      assert(/全部/.test(await text(page, '#playProg')), 'stop returns the button');
      // Gb spelling
      await page.locator('#chLetters [data-l="4"]').click(); await page.locator('#chAcc [data-a="-1"]').click(); await page.locator('#chQual [data-q="maj7"]').click(); await page.locator('#chInv [data-i="0"]').click();
      assert((await page.locator('#chNotes .note b').allTextContents()).join(' ') === 'G♭ B♭ D♭ F', 'G♭maj7 spelled with F');
      // note name modes
      await page.locator('#nameSel').selectOption('solfege');
      assert(await page.evaluate(() => __pc.keysWrap.querySelector('[data-m="60"] .lb').textContent) === 'Do', 'solfège labels on keys');
      await page.locator('#nameSel').selectOption('num');
      assert(await page.evaluate(() => __pc.keysWrap.querySelector('[data-m="62"] .lb').textContent) === '2', '簡譜 labels on keys');
      await page.locator('#nameSel').selectOption('none');
      assert(await page.evaluate(() => __pc.keysWrap.querySelector('[data-m="62"] .lb').textContent) === '', 'no labels');
      await page.locator('#nameSel').selectOption('letter');
      // persistence
      await page.reload(); await sleep(250);
      assert((await text(page, '#chName')) === 'G♭maj7', 'chord restored from localStorage');
      assert(JSON.parse(await page.evaluate(() => localStorage.getItem('piano-chords:v1:state'))).q === 'maj7', 'state saved under piano-chords:v1:state');

      // scale practice
      await page.locator('.tabs [data-tab="scale"]').click();
      await page.locator('#scLetters [data-l="5"]').click();
      await page.locator('#scType [data-s="harm"]').click();
      assert((await text(page, '#scName')) === 'A 和聲小調', 'A harmonic minor selected');
      assert((await page.locator('#scNotes .note b').allTextContents()).join(' ') === 'A B C D E F G♯', 'harmonic minor spelled with G♯');
      const scHl = await page.evaluate(() => Object.values(__pc.HL).filter(h => h.role === 'root').length);
      assert(scHl === 5, 'every A on the keyboard marked as the tonic (' + scHl + ')');
      await page.locator('#playUp').click(); await sleep(100);
      assert(await page.evaluate(() => __pc.Piano.voices.filter(v => !v.released).map(v => v.m)[0]) === 69, 'scale run starts on A4');
      await sleep(400);
      assert(await page.evaluate(() => __pc.PRESSED.size) >= 1, 'scale keys light up while running');
      await page.locator('#playDown').click(); await sleep(100);
      assert(await page.evaluate(() => __pc.Piano.voices.filter(v => !v.released).map(v => v.m)[0]) === 81, 'descending run starts on A5');
      await page.locator('#scType [data-s="melo"]').click();
      assert(/下行用自然小調/.test(await text(page, '#scZh')), 'melodic minor explains the descending form');
      await page.screenshot({ path: OUT + '/scale-390x844.png' });

      // identification by tapping keys
      await page.locator('.tabs [data-tab="ident"]').click();
      assert(await page.evaluate(() => Object.keys(__pc.HL).length) === 0, 'identification starts empty');
      for (const m of [64, 67, 72]) { const p = await keyPoint(page, m); await page.touchscreen.tap(p.x, p.y); await sleep(60); }
      assert((await text(page, '#identName')) === 'C/E', 'E4 G4 C5 identified as C/E');
      assert(/轉位/.test(await text(page, '#identZh')), 'marked as an inversion');
      const p64 = await keyPoint(page, 64); await page.touchscreen.tap(p64.x, p64.y); await sleep(60);
      assert((await text(page, '#identName')) === 'G – C' && (await text(page, '#identZh')) === '完全四度', 'tapping E again removes it → G4 C5 = 完全四度');
      await page.evaluate(() => { __pc.keysWrap.scrollLeft -= 7 * __pc.KW; }); await sleep(100);
      assert((await keyPoint(page, 57)).vis, 'scrolled down an octave: A3 visible');
      for (const m of [57, 64]) { const p = await keyPoint(page, m); await page.touchscreen.tap(p.x, p.y); await sleep(60); }
      assert((await text(page, '#identName')) === 'Am7', 'A3 G4 C5 E4 → Am7');
      assert(await page.locator('#identAlts .chip').count() >= 1 && /C6\/A/.test(await text(page, '#identAlts')), 'C6/A offered as an alternative');
      await page.screenshot({ path: OUT + '/ident-390x844.png' });
      await page.locator('#identClear').click();
      assert((await text(page, '#identName')) === '—' && await page.evaluate(() => __pc.HELD.size) === 0, 'clear empties the set');

      // multi-touch: three fingers on the keyboard at once, glissando, release
      const cdp = await ctx.newCDPSession(page);
      await page.locator('.tabs [data-tab="chord"]').click(); await sleep(700);   // let the smooth scroll to the chord settle
      const pts = []; for (const m of [69, 73, 76]) { const p = await keyPoint(page, m); assert(p.vis, `key ${m} visible for the multi-touch test`); pts.push(p); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
      await sleep(80);
      assert((await page.evaluate(() => [...__pc.fingers.values()].sort().join())) === '69,73,76', 'three simultaneous touches play A4 C♯5 E5');
      assert(await page.evaluate(() => __pc.Piano.voices.filter(v => !v.released).length) === 3, 'three voices sounding');
      const to = await keyPoint(page, 71);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x, y: to.y, id: 0 }, ...pts.slice(1).map((p, i) => ({ x: p.x, y: p.y, id: i + 1 }))] });
      await sleep(60);
      const gl = await page.evaluate(() => [...__pc.fingers.entries()].map(e => e.join(':')).join());
      assert((await page.evaluate(() => [...__pc.fingers.values()].sort().join())) === '71,73,76', 'sliding a finger from A4 to B4 (glissando) ' + gl);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(60);
      assert(await page.evaluate(() => __pc.fingers.size === 0 && __pc.PRESSED.size === 0) === true, 'all fingers released');
      // octave shift and sustain pedal
      const before = await page.evaluate(() => __pc.keysWrap.scrollLeft);
      await page.locator('#octUp').click(); await sleep(500);
      assert(await page.evaluate(() => __pc.keysWrap.scrollLeft) > before + 100, 'octave button scrolls the keyboard');
      await page.locator('#octDown').click(); await sleep(500);
      await page.locator('#pedalBtn').click();
      assert(await page.locator('#pedalBtn').getAttribute('aria-pressed') === 'true' && await page.evaluate(() => __pc.Piano.pedal), 'sustain pedal on');
      const p72 = await keyPoint(page, 72); assert(p72.vis, 'C5 visible'); await page.touchscreen.tap(p72.x, p72.y); await sleep(80);
      assert(await page.evaluate(() => __pc.Piano.voices.some(v => v.m === 72 && !v.released)), 'note keeps ringing with the pedal down');
      await page.locator('#pedalBtn').click(); await sleep(50);
      assert(!(await page.evaluate(() => __pc.Piano.voices.some(v => v.m === 72 && !v.released))), 'pedal up releases it');
      // volume
      await page.locator('#volBtn').click();
      await page.locator('#vol').fill('40');
      assert((await text(page, '#volOut')) === '40%', 'volume slider updates');
      await page.locator('#panicBtn').click();
      assert(/已停止/.test(await text(page, '#toast')), '全部停止 toast');
      assert(!(await page.evaluate(() => /NaN|undefined/.test(document.body.innerText))), 'no NaN/undefined on screen');
      assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
      await ctx.close();
    }
    // landscape phone shows more keys
    {
      const { ctx, page, errors } = await open(browser, 844, 390, 'light');
      const vis = await page.evaluate(() => Math.floor(__pc.keysWrap.clientWidth / __pc.KW));
      assert(vis >= 20, `landscape shows ${vis} white keys (≥ 20)`);
      const kb = await page.locator('#keysWrap').boundingBox();
      assert(kb.y + kb.height <= 391, 'keyboard inside the landscape viewport');
      await page.screenshot({ path: OUT + '/landscape-844x390.png' });
      assert(errors.length === 0, 'no console errors in landscape');
      await ctx.close();
    }
    // cover 390×520: E major from the sample flow, keys highlighted
    {
      const { ctx, page } = await open(browser, 390, 520, 'light');
      await page.locator('#progSel').selectOption('1');
      await page.locator('#progChips .chip').nth(0).click(); await sleep(300);
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); const pn = document.getElementById('panel'); pn.scrollTop += document.querySelector('#tab-chord .card').getBoundingClientRect().top - pn.getBoundingClientRect().top - 2; });
      await sleep(1300);
      await page.screenshot({ path: OUT + '/cover-390x520.png' });
      await ctx.close();
    }
    console.log('all checks passed');
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
