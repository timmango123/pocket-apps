// 調色盤工作室：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）
// Real CDP touch for taps; long-press timers are driven by Playwright's fake clock so the run is load-independent.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'palette-lab-')), 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const KEY = 'palette-lab:v1:';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, text: await data.text() }); } } : null }; };

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}, init, initArg) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, ...opt });
    await ctx.addInitScript(mockDl); if (init) await ctx.addInitScript(init, initArg);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__pl && window.__pl.strip.length);
    return { ctx, p };
  }
  const stripOf = p => p.evaluate(() => window.__pl.strip.map(s => window.__pl.toHex(s.c) + (s.locked ? '*' : '')).join(' '));
  const reload = async p => { await p.reload(); await p.waitForFunction(() => window.__pl && window.__pl.strip.length); };
  const toastText = p => p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent);

  // ---------- 1. colour maths: parse units / oklch / junk; generate for greys; extraction; floored ratio ----------
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => { const P = window.__pl, T = c => c ? P.toHex(c) : null, pc = P.parseColor;
      const gen = {}; for (const b of ['#808080', '#000000', '#FFFFFF', '#FAFAFF', '#050510']) for (const rule of ['comp', 'analog', 'triad', 'split', 'tetrad', 'mono', 'material']) { const s = P.generate(pc(b), rule).map(T); gen[b + ' ' + rule] = { n: s.length, distinct: new Set(s).size, base: s.includes(b) }; }
      const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); draw(x, w, h); return P.extract(x.getImageData(0, 0, w, h).data, 5).map(T); };
      const ramp = mk(200, 25, (x, w, h) => { const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); x.fillStyle = g; x.fillRect(0, 0, w, h); });
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const noise = mk(200, 100, (x, w, h) => { const d = x.createImageData(w, h); for (let i = 0; i < d.data.length; i++) d.data[i] = (i & 3) === 3 ? 255 : (rnd() * 256) | 0; x.putImageData(d, 0, 0); });
      return { turn: T(pc('hsl(0.5turn 100% 50%)')), rad: T(pc('hsl(3.1416rad 100% 50%)')), grad: T(pc('hsl(200grad 100% 50%)')), deg: T(pc('hsl(180deg 100% 50%)')),
        badUnit: pc('hsl(180px 100% 50%)'), junk: pc('rgb(10,20,30x)'), mix: pc('rgb(255, 0 0)'), legacyMix: pc('rgb(100%, 0, 0)'), slashComma: pc('rgb(1,2,3/0.5)'),
        none: T(pc('hsl(none 100% 50%)')), noneLegacy: pc('hsl(none, 100%, 50%)'), ok1: T(pc('oklch(60% 0.2 30)')), ok2: T(pc('oklch(0.6 0.2 30 / 50%)')), ok3: T(pc('oklch(62.8% 0.2577 29.23)')),
        sci: T(pc('rgb(1e2, 0, 0)')), modern: T(pc('rgb(30 58 95 / 50%)')), legacy: T(pc('rgba(255,0,0,0.5)')), bare: T(pc('1e3a5f')),
        r1: P.ratioStr(4.4994), r2: P.ratioStr(21), r3: P.ratioStr(4.5), gen, ramp, noise };
    });
    assert(r.turn === '#00FFFF' && r.rad === '#00FFFF' && r.grad === '#00FFFF' && r.deg === '#00FFFF', `hsl hue units turn/rad/grad/deg → #00FFFF (${r.turn} ${r.rad} ${r.grad} ${r.deg})`);
    assert(r.badUnit === null && r.junk === null && r.mix === null && r.legacyMix === null && r.slashComma === null && r.noneLegacy === null, 'unknown unit, trailing junk, comma/space mix, legacy %/number mix, none in legacy syntax → rejected');
    assert(r.none === '#FF0000', 'hsl(none 100% 50%) → #FF0000');
    assert(r.ok1 === '#DE3E2D' && r.ok2 === '#DE3E2D80' && r.ok3 === '#FF0000', `oklch() accepted (${r.ok1}, ${r.ok2}, ${r.ok3})`);
    assert(r.sci === '#640000' && r.modern === '#1E3A5F80' && r.legacy === '#FF000080' && r.bare === '#1E3A5F', 'existing syntaxes still parse');
    assert(r.r1 === '4.49' && r.r2 === '21.00' && r.r3 === '4.50', 'ratio display floors to 2 places (4.4994 → 4.49)');
    const bad = Object.entries(r.gen).filter(([k, v]) => v.distinct !== v.n || !v.base);
    assert(!bad.length, 'grey / black / white / near-white bases: every rule gives distinct swatches that include the base ' + JSON.stringify(bad));
    assert(r.ramp.some(h => parseInt(h.slice(1, 3), 16) >= 0xF0) && r.ramp.some(h => parseInt(h.slice(1, 3), 16) <= 0x20) && r.ramp.length === 5, 'black→white gradient: 5 colours spanning both ends ' + r.ramp.join(' '));
    assert(r.noise.length >= 3, 'random-noise image gives ≥3 colours (' + r.noise.length + ')');
    // UI ratio for the 4.4994 pair
    await p.fill('#fgHex', '#158A00'); await p.fill('#bgHex', '#FFFFFF'); await p.click('h1');
    const ui = await p.evaluate(() => [document.querySelector('#ratio').textContent, document.querySelector('#badges .bd').className.includes('fail')]);
    assert(ui[0] === '4.49:1' && ui[1], '#158A00 on white shows 4.49:1 with AA fail (no “4.50 + fail”)');
    // grey note
    await p.fill('#hexIn', '#808080'); await p.click('h1');
    assert(await p.isVisible('#stripNote'), 'grey base shows the “no hue, lightness ramp” note');
    await p.fill('#hexIn', '#1E6091'); await p.click('h1');
    assert(!(await p.isVisible('#stripNote')), 'note hidden for a coloured base');
    await ctx.close();
  }

  // ---------- 2. working state survives reload (strip, locks, order, fg/bg, photo session, loaded palette); old format loads ----------
  {
    const { ctx, p } = await open();
    await p.fill('#hexIn', '#2E8B57'); await p.selectOption('#rule', 'triad'); await p.click('h1');
    await p.locator('#strip .sw').nth(4).click(); await p.click('#dLock'); await p.click('#dClose');
    await p.locator('#strip .sw').nth(0).focus(); await p.keyboard.press('Alt+ArrowRight');
    await p.fill('#fgHex', '#123456'); await p.fill('#bgHex', '#FFEECC'); await p.click('h1');
    const before = [await stripOf(p), await p.evaluate(() => window.__pl.toHex(window.__pl.fg) + window.__pl.toHex(window.__pl.bg))];
    await reload(p);
    const after = [await stripOf(p), await p.evaluate(() => window.__pl.toHex(window.__pl.fg) + window.__pl.toHex(window.__pl.bg))];
    assert(before.join() === after.join() && /\*/.test(after[0]), 'reload keeps strip order, lock and contrast colours: ' + after.join(' | '));
    // photo session
    await p.click('#tab-photo'); await p.waitForFunction(() => window.__pl.source === 'photo' && !document.querySelector('#photoBadge').hidden);
    const cb = await p.locator('#photoCv').boundingBox(); await p.mouse.click(cb.x + cb.width * 0.15, cb.y + cb.height * 0.2);
    await p.click('#pickAdd');
    const ph = await stripOf(p);
    await reload(p);
    assert(await p.$eval('#tab-photo', e => e.getAttribute('aria-selected')) === 'true' && await stripOf(p) === ph, 'reload keeps the photo tab and the picked colour in the strip');
    assert(await p.evaluate(() => !document.querySelector('#photoBadge').hidden && document.querySelector('#photoCv').width > 10), 'sample photo is back for picking after reload');
    // user photo thumbnail
    const b64 = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 300; const x = c.getContext('2d'); ['#2A9D8F', '#E9C46A', '#E76F51'].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * 200, 0, 200, 300); }); const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const v of u) s += String.fromCharCode(v); return btoa(s); });
    await p.setInputFiles('#photoIn', { name: 'blocks.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
    await p.waitForFunction(() => document.querySelector('#photoBadge').hidden && window.__pl.strip.some(s => window.__pl.toHex(s.c) === '#E9C46A'));
    const up = await stripOf(p); await reload(p);
    assert(await stripOf(p) === up, 'user photo palette survives reload: ' + up);
    await p.waitForFunction(() => document.querySelector('#photoCv').width > 10 && document.querySelector('#photoBadge').hidden);
    const cb2 = await p.locator('#photoCv').boundingBox(); await p.mouse.click(cb2.x + cb2.width * 0.5, cb2.y + cb2.height * 0.5);
    { const h = await p.textContent('#pickedHex'); const d = [1, 3, 5].map(i => Math.abs(parseInt(h.slice(i, i + 2), 16) - parseInt('#E9C46A'.slice(i, i + 2), 16))); assert(Math.max(...d) <= 4, 'restored photo thumbnail can still be picked from (' + h + ' ≈ #E9C46A)'); }
    // loaded saved palette
    await p.click('#tab-base'); await p.fill('#hexIn', '#AA3311'); await p.click('h1'); await p.click('#saveBtn');
    await p.fill('#hexIn', '#1E6091'); await p.click('h1');
    await p.click('#drawerBtn'); await p.click('#dlist [data-act=load] >> nth=0');
    const ld = await stripOf(p); await reload(p);
    assert(await stripOf(p) === ld, 'loaded saved palette survives reload');
    await ctx.close();
    const o = await open(390, 844, {}, () => { if (!sessionStorage.x) { sessionStorage.x = 1; localStorage.setItem('palette-lab:v1:last', JSON.stringify({ base: '#2E8B57', rule: 'analog' })); } });
    assert(await o.p.inputValue('#hexIn') === '#2E8B57' && await o.p.inputValue('#rule') === 'analog' && (await stripOf(o.p)).includes('#2E8B57'), 'old {base, rule} format still loads');
    await o.ctx.close();
  }

  // ---------- 3. undo: rule change, saved-palette load (toast 復原), photo replace, Ctrl+Z, 10-step cap ----------
  {
    const { ctx, p } = await open();
    const s0 = await stripOf(p);
    await p.selectOption('#rule', 'tetrad');
    assert(await stripOf(p) !== s0 && !(await p.$eval('#undoBtn', e => e.disabled)), 'rule change enables 復原');
    await p.click('#undoBtn');
    assert(await stripOf(p) === s0 && await p.inputValue('#rule') === 'split', 'header 復原 restores strip and rule');
    await p.click('#saveBtn'); await p.fill('#hexIn', '#FF6347'); await p.click('h1');
    const s1 = await stripOf(p);
    await p.click('#drawerBtn'); await p.click('#dlist [data-act=load] >> nth=0');
    assert(await p.isVisible('#toast button'), 'load toast offers 復原');
    await p.click('#toast button');
    assert(await stripOf(p) === s1 && await p.inputValue('#hexIn') === '#FF6347', 'toast 復原 undoes the palette load');
    await p.fill('#hexIn', '#00AA55'); await p.click('h1');
    await p.keyboard.press('Control+z');
    assert(await p.inputValue('#hexIn') === '#FF6347', 'Ctrl+Z undoes a base change');
    for (const r of ['comp', 'analog', 'triad', 'split', 'tetrad', 'mono', 'material', 'comp', 'analog', 'triad', 'split', 'tetrad']) await p.selectOption('#rule', r);
    assert(await p.evaluate(() => window.__pl.undoDepth) === 10, 'undo stack capped at 10');
    // photo pick never replaces the selected swatch silently; explicit button does
    await p.click('#tab-photo'); await p.waitForFunction(() => window.__pl.source === 'photo');
    await p.locator('#strip .sw').nth(1).click();
    const s2 = await stripOf(p);
    const cb = await p.locator('#photoCv').boundingBox(); await p.mouse.click(cb.x + cb.width * 0.15, cb.y + cb.height * 0.2);
    assert(await stripOf(p) === s2, 'picking from the photo with a swatch selected leaves the strip unchanged');
    assert(await p.textContent('#pickRep') === '替換第 2 色' && !(await p.$eval('#pickRep', e => e.disabled)), '“替換第 2 色” offered');
    await p.click('#pickRep');
    const s3 = await stripOf(p);
    assert(s3 !== s2 && s3.split(' ')[1] === await p.textContent('#pickedHex'), 'replace button swaps swatch 2 for the picked colour');
    await p.click('#undoBtn');
    assert(await stripOf(p) === s2, 'replacement can be undone');
    // 5/8 note re-evaluated
    const six = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 120; c.height = 40; const x = c.getContext('2d'); ['#E63946', '#F1FAEE', '#A8DADC', '#457B9D', '#1D3557', '#F4A261'].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * 20, 0, 20, 40); }); const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const v of u) s += String.fromCharCode(v); return btoa(s); });
    await p.click('#n5'); await p.setInputFiles('#photoIn', { name: 'six.png', mimeType: 'image/png', buffer: Buffer.from(six, 'base64') });
    await p.waitForFunction(() => document.querySelector('#photoBadge').hidden);
    const n5 = await p.textContent('#photoErr'); await p.click('#n8'); const n8 = await p.textContent('#photoErr');
    assert(n5 === '' && /只找到 6 種/.test(n8), `5/8 toggle updates the “only N colours” note ("${n5}" → "${n8}")`);
    // 8-colour mode keeps swatches ≥44px wide at 360 (two rows)
    await p.setViewportSize({ width: 360, height: 640 });
    { const b = await p.locator('#photoCv').boundingBox(); await p.mouse.click(b.x + b.width * 0.1, b.y + b.height / 2); }
    await p.click('#pickAdd'); await p.click('#pickAdd');
    const w = await p.$$eval('#strip .sw', a => [a.length, Math.min(...a.map(e => e.getBoundingClientRect().width))]);
    assert(w[0] === 8 && w[1] >= 44, `8 swatches at 360: min width ${w[1].toFixed(1)}px`);
    await p.locator('#strip .sw').nth(1).click(); await p.locator('#strip .sw').nth(1).click();
    const dd = await p.$$eval('.dl dd', a => a.map(e => e.scrollWidth <= e.clientWidth + 1 && e.textContent.length > 5));
    assert(dd.length === 4 && dd.every(Boolean), 'detail values (incl. OKLCH) fully visible at 360');
    await ctx.close();
  }

  // ---------- 4. mini strip visible while using the sliders at 360×640 ----------
  {
    const { ctx, p } = await open(360, 640);
    const top0 = await p.evaluate(() => document.querySelector('#strip').getBoundingClientRect().top);
    assert(top0 > 640, 'at 360×640 the result strip starts below the fold (' + Math.round(top0) + ')');
    await p.$eval('#hS', e => scrollTo(0, scrollY + e.getBoundingClientRect().top - 120));
    const m = await p.evaluate(() => { const r = document.querySelector('#mini').getBoundingClientRect(), h = document.querySelector('#hS').getBoundingClientRect(); return { top: r.top, h: r.height, n: document.querySelectorAll('#mini i').length, sliderBelow: h.top >= r.bottom - 1, scrolled: scrollY > 0 }; });
    assert(m.scrolled && m.top >= -1 && m.top < 10 && m.h >= 44 && m.n === 5 && m.sliderBelow, 'sticky mini strip stays pinned on top while the sliders are in use: ' + JSON.stringify(m));
    await p.evaluate(() => document.querySelectorAll('#strip .sw').forEach((e, i) => e.__tag = i));
    await p.$eval('#hS', e => { e.value = 120; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForFunction(() => window.__pl.toHex(window.__pl.strip[1].c) === document.querySelector('#heroHex').textContent);
    const same = await p.evaluate(() => [...document.querySelectorAll('#strip .sw')].every((e, i) => e.__tag === i));
    const mini = await p.$$eval('#mini i', a => a.map(e => e.style.background));
    assert(same, 'slider step recolours swatches in place (no rebuild)');
    assert(mini.length === 5 && new Set(mini).size === 5, 'mini strip follows the slider');
    await ctx.close();
  }

  // ---------- 5. corrupt storage, quota failure, rename blank, export / import backup ----------
  {
    for (const [k, v] of [['saved', '[null,{"id":"a","name":"x","colors":"nope"},{"id":"b<x>","name":"ok","colors":["#112233","zz"]}]'], ['theme', '"purple"'], ['last', '42'], ['last', '{"base":"#zzzzzz","rule":"nope","strip":[1,{"h":"bad"}]}']]) {
      const n0 = errors.length;
      const { ctx, p } = await open(390, 844, {}, ([k, v]) => { if (!sessionStorage.x) { sessionStorage.x = 1; localStorage.setItem('palette-lab:v1:' + k, v); } }, [k, v]);
      await p.click('#drawerBtn'); const open1 = await p.isVisible('#drawer'); const cnt = await p.locator('.sv').count(); await p.click('#drawerClose');
      await p.click('#saveBtn'); await p.click('#themeBtn');
      const lbl = await p.$eval('#themeBtn', e => e.getAttribute('aria-label'));
      assert(open1 && errors.length === n0 && !/undefined/.test(lbl) && (k !== 'saved' || cnt === 1), `corrupt ${k}=${v.slice(0, 30)}… → no error, drawer opens (${cnt} valid), theme label "${lbl}"`);
      await ctx.close();
    }
    const { ctx, p } = await open(390, 844, {}, () => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (window.__quota && /saved$/.test(k)) throw new DOMException('full', 'QuotaExceededError'); return o.call(this, k, v); }; });
    await p.evaluate(() => window.__quota = true); await p.click('#saveBtn');
    const qt = await toastText(p);
    await p.click('#drawerBtn');
    assert(!/已存入/.test(qt) && /失敗/.test(qt) && await p.locator('.sv').count() === 0, 'quota error: no “已存入”, entry not kept: ' + qt);
    await p.click('#drawerClose'); await p.evaluate(() => window.__quota = false);
    await p.click('#saveBtn'); await p.click('#drawerBtn');
    await p.fill('.sv input', '   '); await p.press('.sv input', 'Tab');
    assert(await p.inputValue('.sv input') !== '' && /調色盤/.test(await p.inputValue('.sv input')), 'blank rename restores the old name in the box');
    await p.click('#expSaved');
    await p.waitForFunction(() => window.__saved.length === 1);
    const exp = await p.evaluate(() => window.__saved[0]);
    const j = JSON.parse(exp.text);
    assert(/^palette-lab-\d{8}-\d{4}\.json$/.test(exp.filename) && j.saved.length === 1 && j.saved[0].colors.length === 5, 'export backup → ' + exp.filename);
    await p.click('.sv [data-act="del"]'); await p.click('.sv [data-act="del"]');
    assert(await p.locator('.sv').count() === 0, 'deleted');
    await p.setInputFiles('#impIn', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(exp.text) });
    await p.waitForFunction(() => document.querySelectorAll('.sv').length === 1);
    assert(/已匯入 1 組/.test(await toastText(p)), 'import restores the backup');
    const n0 = errors.length;
    await p.setInputFiles('#impIn', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
    await p.waitForFunction(() => /無法匯入/.test(document.querySelector('#toast').textContent));
    await p.setInputFiles('#impIn', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"saved":[{"colors":42}]}') });
    await p.waitForFunction(() => /無法匯入/.test(document.querySelector('#toast').textContent));
    assert(errors.length === n0 && await p.locator('.sv').count() === 1, 'broken / wrong backup files → message, no crash, nothing changed');
    await p.setInputFiles('#impIn', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(exp.text) });
    await p.waitForFunction(() => /略過重複/.test(document.querySelector('#toast').textContent));
    assert(await p.locator('.sv').count() === 1, 're-import skips duplicates');
    await ctx.close();
  }

  // ---------- 6. real touch: taps fire on pointerup per finger, slow taps, other finger down, no ghost clicks ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { window.__clicks = 0; addEventListener('click', () => window.__clicks++, true); });
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.clock.install(); await p.goto(URL); await p.clock.pauseAt(Date.now() + 60000); await p.clock.runFor(50); // timers only move when the test says so
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const P = (x, y, id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
    const at = async sel => p.$eval(sel, e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const tap = async (sel, hold = 0) => { const [x, y] = await at(sel); await T('touchStart', [P(x, y, 1)]); if (hold) await p.clock.runFor(hold); await T('touchEnd', [P(x, y, 1)]); await p.clock.runFor(20); };
    const tapWithOther = async (sel, other, hold = 0) => { const [ox, oy] = await at(other); const [x, y] = await at(sel); const A = P(ox, oy, 7); await T('touchStart', [A]); await p.clock.runFor(100); await T('touchStart', [A, P(x, y, 1)]); if (hold) await p.clock.runFor(hold); await T('touchEnd', [P(x, y, 1)]); await p.clock.runFor(20); const mid = await p.evaluate(() => [window.__pl.sel, window.__pl.strip.map(s => s.locked ? 1 : 0).join('')]); await T('touchEnd', [A]); await p.clock.runFor(20); return mid; };
    const theme = () => p.evaluate(() => document.documentElement.getAttribute('data-theme') || 'auto');
    const order = ['auto', 'light', 'dark'];
    for (const hold of [0, 600, 1000]) {
      const t0 = await theme(); await tap('#themeBtn', hold); const t1 = await theme();
      assert(order[(order.indexOf(t0) + 1) % 3] === t1, `theme button, hold ${hold} ms: exactly one step (${t0} → ${t1})`);
    }
    const t0 = await theme(); await tapWithOther('#themeBtn', '#hero'); const t1 = await theme();
    assert(order[(order.indexOf(t0) + 1) % 3] === t1, 'theme button with another finger down: exactly one step');
    for (const hold of [0, 600, 1000]) {
      const want = await p.$eval('#fgChips .cc:nth-child(3)', e => e.dataset.hex);
      await p.evaluate(() => document.querySelector('#fgChips .cc:nth-child(1)').click());
      await tap('#fgChips .cc:nth-child(3)', hold);
      assert(await p.evaluate(() => window.__pl.toHex(window.__pl.fg)) === want, `contrast chip, hold ${hold} ms`);
    }
    { await p.evaluate(() => document.querySelector('#fgChips .cc:nth-child(1)').click()); const want = await p.$eval('#fgChips .cc:nth-child(4)', e => e.dataset.hex);
      await tapWithOther('#fgChips .cc:nth-child(4)', 'h1');
      assert(await p.evaluate(() => window.__pl.toHex(window.__pl.fg)) === want, 'contrast chip with another finger down'); }
    await tapWithOther('#tab-photo', '#hero');
    assert(await p.evaluate(() => window.__pl.source) === 'photo', 'tab with another finger down');
    await tapWithOther('#n8', 'h1', 600);
    assert(await p.$eval('#n8', e => e.getAttribute('aria-pressed')) === 'true', '8-colour toggle, held 0.6 s with another finger down');
    await tap('#n5', 1000);
    assert(await p.$eval('#n5', e => e.getAttribute('aria-pressed')) === 'true', '5-colour toggle, held 1 s');
    await tap('#tab-base');
    // undo toast button by touch: count stays exact
    const d0 = await p.evaluate(() => window.__pl.undoDepth);
    await tap('#undoBtn');
    assert(await p.evaluate(() => window.__pl.undoDepth) === d0 - 1, 'undo button: one tap = one step');
    // strip: each finger keeps its own press state
    await p.evaluate(() => { window.__pl.strip.forEach(s => s.locked = false); });
    const sw = i => `#strip .sw:nth-child(${i + 1}) .chip`;
    await tap(sw(2));
    assert(await p.evaluate(() => window.__pl.sel) === 2, 'swatch tap opens detail');
    await tap(sw(2));
    let m = await tapWithOther(sw(2), sw(0), 350);
    assert(m[0] === 2 && m[1] === '00000', 'finger A resting on swatch 1, B taps swatch 3 for 350 ms → B selects, nothing locked (' + m + ')');
    await p.clock.runFor(600);
    assert(await p.evaluate(() => window.__pl.strip.map(s => s.locked ? 1 : 0).join('')) === '00000', 'A released before 0.5 s → no stray lock');
    const [ax, ay] = await at(sw(0)); const [bx, by] = await at(sw(2));
    await T('touchStart', [P(ax, ay, 7)]); await p.clock.runFor(100); await T('touchStart', [P(ax, ay, 7), P(bx, by, 1)]); await p.clock.runFor(700);
    const locksMid = await p.evaluate(() => window.__pl.strip.map(s => s.locked ? 1 : 0).join(''));
    await T('touchEnd', [P(bx, by, 1)]); await p.clock.runFor(20); await T('touchEnd', [P(ax, ay, 7)]); await p.clock.runFor(20);
    const locksEnd = await p.evaluate(() => window.__pl.strip.map(s => s.locked ? 1 : 0).join(''));
    assert(locksMid === '10100' && locksEnd === '10100', `two long presses lock their own swatches (${locksMid} → ${locksEnd})`);
    // keyboard activation still works (Enter on a button)
    await p.focus('#copyCss'); const c0 = await p.textContent('#codeOut'); await p.evaluate(() => { document.querySelector('#codeOut').textContent = ''; }); await p.keyboard.press('Enter'); await p.clock.runFor(20);
    assert((await p.textContent('#codeOut')).startsWith(':root{'), 'Enter on a button still activates it');
    await ctx.close();
  }

  await browser.close();
  assert(!errors.length, 'no page / console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
