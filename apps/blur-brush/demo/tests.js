// Regression tests for blur-brush (release-review fixes): node demo/tests.js  (~30 s)
// Saving/restore, confirm before replacing work, alpha-correct mosaic, exact cell averages, export buttons,
// big-image brushing cost, open race + busy state, min brush width, settings validation, layout at lobby sizes.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
let fails = 0;
const ok = (c, m) => { if (c) console.log('  ok -', m); else { fails++; console.log('FAIL -', m); } };
const mob = (w, h, o = {}) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...o });
// in-page helpers: make test images as Files, read pixels
const HELPERS = () => {
  window.__mk = async (w, h, kind, type = 'image/png', name) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    if (kind === 'grad') { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2050c0'); g.addColorStop(1, '#f0a020'); x.fillStyle = g; x.fillRect(0, 0, w, h); }
    else if (kind === 'alpha') { for (let i = 0; i < w; i += 4) { x.fillStyle = (i / 4) % 2 ? 'rgba(255,0,0,.5)' : 'rgba(0,0,255,.5)'; x.fillRect(i, 0, 4, h); } x.fillStyle = '#0a0'; x.fillRect(0, 0, w, h / 4); }
    else if (kind === 'checker') { for (let y = 0; y < h; y += 2) for (let xx = 0; xx < w; xx += 2) { x.fillStyle = ((xx + y) / 2) % 2 ? '#fff' : '#000'; x.fillRect(xx, y, 2, 2); } }
    else if (kind === 'big') { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#345'); g.addColorStop(1, '#fd8'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#000'; x.font = '200px sans-serif'; x.fillText('0912-345-678', 200, 1500); }
    else { x.fillStyle = kind; x.fillRect(0, 0, w, h); }
    const b = await new Promise(r => c.toBlob(r, type, .9)); return new File([b], (name || kind) + (type === 'image/jpeg' ? '.jpg' : '.png'), { type });
  };
  document.addEventListener('DOMContentLoaded', () => { const b = document.querySelector('#busy'); if (b) new MutationObserver(() => { if (!b.hidden) window.__busySeen = true; }).observe(b, { attributes: true }); });
  window.__px = (layer, x, y, w = 1, h = 1) => Array.from(window.__bb.layers()[layer].getContext('2d').getImageData(x, y, w, h).data);
  window.__hash = layer => { const L = window.__bb.layers()[layer]; const d = new Uint32Array(L.getContext('2d').getImageData(0, 0, L.width, L.height).data.buffer); let s = 0; for (let i = 0; i < d.length; i++) s = (Math.imul(s, 31) + d[i]) >>> 0; return s; };
};
(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(HTML); });
  await new Promise(r => srv.listen(0, r)); const U = `http://127.0.0.1:${srv.address().port}/`;
  const br = await chromium.launch(); const errors = [];
  const newPage = async (opts, init) => { const ctx = await br.newContext(opts); await ctx.addInitScript(HELPERS); if (init) await ctx.addInitScript(init); const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); return { ctx, p }; };
  const booted = p => p.waitForFunction(() => window.__bb && window.__bb.img && document.querySelector('#zoomTag').textContent).then(() => p.evaluate(() => window.__bb.booted.then(() => window.__bb.histDone())));
  const sp = (p, ix, iy) => p.evaluate(([ix, iy]) => { const r = document.querySelector('#view').getBoundingClientRect(), v = window.__bb.view; return [r.left + v.vtx + ix * v.vs, r.top + v.vty + iy * v.vs]; }, [ix, iy]);
  const rect = async (p, a, b) => { await p.click('#tRect'); const A = await sp(p, ...a), B = await sp(p, ...b); await p.mouse.move(...A); await p.mouse.down(); await p.mouse.move(...B, { steps: 4 }); await p.mouse.up(); await p.evaluate(() => window.__bb.histDone()); };
  const openIn = async (p, kind, w, h, opts = {}) => { await p.evaluate(async ([kind, w, h, o]) => { const f = await window.__mk(w, h, kind, o.type, o.name); await window.__bb.openFile(f, true); }, [kind, w, h, opts]); await p.evaluate(() => window.__bb.histDone()); };

  { // ---- main phone context ----
    const { ctx, p } = await newPage(mob(390, 844));
    await p.goto(U); await booted(p);
    const chip = await p.evaluate(() => { const c = document.querySelector('#chips').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return { t: document.querySelector('#chips').textContent, bottomHalf: c.top > s.top + s.height / 2 }; });
    ok(/開啟/.test(chip.t) && /不會上傳/.test(chip.t) && chip.bottomHalf, 'sample chip says how to open your own image + not uploaded, sits at the bottom of the canvas: ' + chip.t);
    ok(await p.evaluate(() => window.__bb.histLen === 1 && !window.__bb.restored), 'fresh start shows the sample (nothing restored)');

    // open via the real file input (page-made PNG), paint a box
    const b64 = await p.evaluate(async () => { const f = await window.__mk(400, 300, 'grad'); return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(f); }); });
    await p.setInputFiles('#fileIn', { name: 'grad.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
    await p.waitForFunction(() => window.__bb.img.name === 'grad' && !window.__bb.busy); await p.evaluate(() => window.__bb.histDone());
    await rect(p, [100, 50], [260, 170]);
    await p.click('#eBlur'); await p.evaluate(() => window.__bb.histDone());
    const before = await p.evaluate(() => ({ img: [window.__bb.img.name, window.__bb.img.w, window.__bb.img.h], hl: window.__bb.histLen, hi: window.__bb.hi, eff: window.__bb.S.eff, m: window.__hash('mask'), c: window.__hash('comp') }));
    // [veto] reload keeps image, mask, effect and undo history — reloading the moment the step is recorded (no debounce window)
    await p.reload(); await booted(p);
    const after = await p.evaluate(() => ({ img: [window.__bb.img.name, window.__bb.img.w, window.__bb.img.h], hl: window.__bb.histLen, hi: window.__bb.hi, eff: window.__bb.S.eff, m: window.__hash('mask'), c: window.__hash('comp'), restored: window.__bb.restored, toast: document.querySelector('#toast').textContent }));
    ok(after.restored && after.img.join() === before.img.join() && after.hl === before.hl && after.hi === before.hi && after.eff === before.eff, 'reload restores image, effect and undo history: ' + JSON.stringify(after.img) + ' hist ' + after.hl);
    ok(after.m === before.m && after.c === before.c, 'reload restores the mask and the composed result bit-for-bit');
    ok(/已還原/.test(after.toast), 'restore is announced: ' + after.toast);
    await p.click('#undoBtn'); await p.click('#undoBtn'); await p.waitForFunction(() => window.__bb.hi === 0); await p.evaluate(() => window.__bb.histDone());
    ok(await p.evaluate(() => window.__px('mask', 180, 110)[3] === 0), 'undo after reload goes back past the restored box');
    await p.click('#redoBtn'); await p.waitForFunction(() => window.__bb.hi === 1); await p.evaluate(() => window.__bb.histDone());
    ok(await p.evaluate(() => window.__px('mask', 180, 110)[3] === 255), 'redo after reload');
    await p.evaluate(() => window.__bb.saveNow()); await p.reload(); await booted(p);
    ok(await p.evaluate(() => window.__bb.hi === 1 && window.__bb.histLen === 3 && document.querySelector('#redoBtn').disabled === false), 'undo position survives reload (redo still available)');

    // confirm before replacing unexported work
    const b64b = await p.evaluate(async () => { const f = await window.__mk(120, 80, '#3a7'); return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(f); }); });
    const green = { name: 'green.png', mimeType: 'image/png', buffer: Buffer.from(b64b, 'base64') };
    await p.setInputFiles('#fileIn', green); await p.waitForSelector('#ovOk');
    await p.click('#ovClose'); await p.waitForTimeout(300);
    ok(await p.evaluate(() => window.__bb.img.name === 'grad' && document.querySelector('#ov').hidden), 'cancel keeps the current image and its edits');
    let chooser = false; p.once('filechooser', () => { chooser = true; });
    await p.click('#openBtn'); await p.waitForSelector('#ovOk');
    ok(!chooser, '開啟 asks first (no file picker yet) when there is unexported work');
    await p.click('#ovClose');
    await p.setInputFiles('#fileIn', green); await p.waitForSelector('#ovOk'); await p.click('#ovOk');
    await p.waitForFunction(() => window.__bb.img.name === 'green' && !window.__bb.busy);
    ok(await p.evaluate(() => window.__bb.histLen === 1 && !window.__bb.dirty), 'confirmed open replaces the image');

    // export without claude.downloads: real download + close at the top
    await rect(p, [10, 10], [60, 60]);
    const [d1] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]); await p.waitForSelector('#ov:not([hidden]) #ovDl');
    ok(d1.suggestedFilename() === 'green-masked.png' && !(await p.evaluate(() => window.__bb.dirty)), 'one tap on 匯出 downloads the file at once (dialog is secondary)');
    const ys = await p.evaluate(async () => { const y = () => Math.round(document.querySelector('#ovClose').getBoundingClientRect().y), a = y(), im = document.querySelector('#ov img'); const ib = im.getBoundingClientRect().height; await im.decode(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return [a, y(), Math.round(ib), Math.round(im.getBoundingClientRect().height)]; });
    ok(ys[0] === ys[1] && ys[2] === ys[3] && ys[2] > 50, 'export dialog buttons and preview box do not move when the preview loads: ' + ys);
    const ex = await p.evaluate(() => { const a = document.querySelector('#ovDl'), c = document.querySelector('#ovClose').getBoundingClientRect(); return { dl: a.getAttribute('download'), href: a.href.slice(0, 5), text: document.querySelector('#ov').innerText, closeIn: c.bottom <= innerHeight && c.top >= 0 }; });
    ok(ex.dl === 'green-masked.png' && ex.href === 'blob:' && !/無法直接下載/.test(ex.text) && ex.closeIn, 'export offers a 下載 link (download attr, blob URL), no wrong "cannot download" text: ' + JSON.stringify({ dl: ex.dl, href: ex.href }));
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('#ovDl')]);
    ok(download.suggestedFilename() === 'green-masked.png', '再次下載 downloads again');
    await p.click('#ovClose');

    // alpha-correct mosaic: semi-transparent pixels are replaced, not layered over
    await openIn(p, 'alpha', 200, 200);
    await p.evaluate(() => { const L = window.__bb.layers(), m = L.mask.getContext('2d'); m.fillStyle = '#fff'; m.fillRect(0, 0, 200, 200); window.__bb.compose(); });
    const al = await p.evaluate(() => { const cell = window.__bb.effCell(), d = window.__px('comp', 0, 0, 200, 200), b = window.__px('base', 0, 0, 200, 200); let uni = 0, tot = 0, worst = 0;
      for (let cy = 0; cy < 200; cy += cell) for (let cxx = 0; cxx < 200; cxx += cell) { tot++; let u = true; const i0 = (cy * 200 + cxx) * 4; let sa = 0, sr = 0, n = 0;
        for (let y = cy; y < Math.min(200, cy + cell); y++) for (let x = cxx; x < Math.min(200, cxx + cell); x++) { const i = (y * 200 + x) * 4; for (let k = 0; k < 4; k++) if (Math.abs(d[i + k] - d[i0 + k]) > 1) u = false; sa += b[i + 3]; sr += b[i] * b[i + 3]; n++; }
        if (u) uni++; const ea = sa / n, er = sa ? sr / sa : 0; worst = Math.max(worst, Math.abs(d[i0 + 3] - ea), sa ? Math.abs(d[i0] - er) : 0); }
      return { cell, uni, tot, worst: Math.round(worst * 10) / 10, alphaMid: d[(150 * 200 + 100) * 4 + 3] }; });
    ok(al.uni === al.tot && al.worst <= 2 && Math.abs(al.alphaMid - 128) <= 2, 'mosaic over alpha-128 stripes: every cell uniform and equal to its own true average, alpha stays 128: ' + JSON.stringify(al));
    // cell colour = that cell's own average even at the far edge (no drift from rescaling)
    await openIn(p, 'checker', 301, 299);
    await p.evaluate(() => { const m = window.__bb.layers().mask.getContext('2d'); m.fillStyle = '#fff'; m.fillRect(0, 0, 301, 299); window.__bb.compose(); });
    const dr = await p.evaluate(() => { const cell = window.__bb.effCell(); let worst = 0; for (const [cx0, cy0] of [[0, 0], [Math.floor(300 / cell) * cell - cell, Math.floor(298 / cell) * cell - cell], [Math.floor(300 / cell) * cell, Math.floor(298 / cell) * cell]]) {
        const w = Math.min(cell, 301 - cx0), h = Math.min(cell, 299 - cy0), b = window.__px('base', cx0, cy0, w, h); let s = 0; for (let i = 0; i < b.length; i += 4) s += b[i]; worst = Math.max(worst, Math.abs(s / (w * h) - window.__px('comp', cx0, cy0)[0])); } return Math.round(worst * 10) / 10; });
    ok(dr <= 1, 'mosaic cell colours match their own cell average at top-left, near and at bottom-right (max diff ' + dr + ')');
    // minimum brush width: a tap at extreme zoom covers the pixel
    await openIn(p, '#888', 2, 2);
    await p.click('#tBrush'); const t = await sp(p, 0.5, 0.5); await p.mouse.click(...t); await p.evaluate(() => window.__bb.histDone());
    ok(await p.evaluate(() => window.__px('mask', 0, 0)[3] >= 250 && window.__bb.lineW() >= 2), 'tap on a 2×2 image shown ~170× covers the tapped pixel fully (min brush 2 image px)');
    // brush-size preview while sliding
    await p.evaluate(() => { const e = document.querySelector('#brush'); e.value = 90; e.dispatchEvent(new Event('input', { bubbles: true })); });
    ok(await p.evaluate(() => window.__bb.brushPreview && window.__bb.S.brush === 90), 'dragging 筆刷大小 shows a preview circle on the canvas');
    // rotate/resize keeps the user's zoom
    const vb = await p.locator('#view').boundingBox(); await p.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2); await p.mouse.wheel(0, -400); await p.waitForTimeout(100);
    const z1 = await p.evaluate(() => window.__bb.view.vs);
    await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(250); await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(250);
    ok(await p.evaluate(z => Math.abs(window.__bb.view.vs - z) < 1e-9 && !window.__bb.view.fitted, z1), 'rotation keeps the zoom the user chose');

    // big image: busy state, open race, brushing cost
    const big = await p.evaluate(async () => { window.__bigF = await window.__mk(4032, 3024, 'big', 'image/jpeg', 'big'); window.__smallF = await window.__mk(400, 300, 'grad', 'image/png', 'small'); return window.__bigF.size; });
    await p.evaluate(() => { window.__bb.openFile(window.__bigF, true); });
    ok(await p.waitForFunction(() => window.__bb.busy && !document.querySelector('#busy').hidden && document.querySelector('#stage').getAttribute('aria-busy') === 'true' && document.querySelector('#exportBtn').disabled && document.querySelector('#openBtn').disabled && /讀取圖片/.test(document.querySelector('#busy').textContent), null, { timeout: 30000, polling: 5 }).then(() => true, () => false), 'opening a 12 MP photo shows 讀取圖片… and disables 開啟/匯出');
    await p.evaluate(() => window.__bb.openFile(window.__smallF, true));
    await p.waitForFunction(() => !window.__bb.busy, null, { timeout: 60000 }); await p.waitForTimeout(300); await p.evaluate(() => window.__bb.histDone());
    ok(await p.evaluate(() => window.__bb.img.name === 'small' && window.__bb.layers().mask.width === 400 && window.__bb.histLen === 1), 'a slow first image never overwrites the one chosen after it');
    const t0 = Date.now(); const sf = await p.evaluate(async () => { await window.__bb.openFile(window.__bigF, true); return { busy: window.__bb.busy, ready: window.__bb.effReady, shown: document.querySelector('#zoomTag').textContent !== '' }; }); const openMs = Date.now() - t0;
    ok(!sf.busy && !sf.ready, '12 MP: the picture is shown (busy off) before the mosaic is built; the effect is prepared afterwards');
    await p.evaluate(() => window.__bb.histDone());
    ok(await p.evaluate(() => window.__bb.img.w === 4032 && !!window.__bb.layers().lo), '12 MP photo opened (' + openMs + ' ms, ' + Math.round(big / 1024) + ' KB) with a display-size preview layer');
    // brushing cost must follow the brush footprint, not the image area: same footprint in image px (~117 px)
    // on a 1.2 MP and a 12 MP image should cost about the same (old code: ~12x more on 12 MP). Relative, so load-proof.
    const scribble = () => p.evaluate(async () => { const v = document.querySelector('#view'), r = v.getBoundingClientRect(); const ev = (t, x, y) => v.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: true, button: 0 }));
      document.querySelector('#tBrush').click(); const c = []; ev('pointerdown', r.width / 2 - 100, r.height / 2);
      let pend = null; for (let k = 0; k < 30; k++) { const s = performance.now(); ev('pointermove', r.width / 2 - 100 + k * 5, r.height / 2 + Math.sin(k / 3) * 20); c.push(performance.now() - s); if (k === 3) pend = window.__bb.pend; }
      ev('pointerup', r.width / 2 + 100, r.height / 2); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); await window.__bb.histDone(); c.sort((a, b) => a - b);
      return { med: c[c.length >> 1], lw: window.__bb.lineW(), usedLo: window.__bb.usedLo, pend }; });
    const setBrush = v => p.evaluate(v => { const e = document.querySelector('#brush'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await setBrush(10); const bigA = await scribble(), bigB = await scribble();
    ok(bigA.usedLo && await p.evaluate(() => window.__bb.histLen === 3 && window.__px('mask', 2016, 1512)[3] === 255), '12 MP strokes recorded in mask and history; canvas paints from the preview layer');
    ok(bigA.pend === true, 'pointer moves only mark the area; the composite is updated once per frame (fewer long frames)');
    // 12 MP undo/redo: no effect rebuilds, no full-mask PNG decodes, results identical going back and forth
    const H = () => p.evaluate(() => window.__hash('comp'));
    const act = async sel => { await p.click(sel); await p.waitForFunction(() => !window.__bb.busy, null, { timeout: 60000 }); await p.evaluate(() => window.__bb.histDone()); await p.waitForFunction(() => !window.__bb.busy); };
    const h2 = await H(); await act('#eBlur'); const h3 = await H(); await act('#applyBtn'); const h4 = await H(); await act('#eSolid'); const h5 = await H();
    const st0 = await p.evaluate(() => ({ ...window.__bb.stats }));
    const seq = []; for (const [sel, want] of [['#undoBtn', h4], ['#undoBtn', h3], ['#undoBtn', h2], ['#redoBtn', h3], ['#redoBtn', h4], ['#redoBtn', h5]]) {
      await p.evaluate(() => { window.__busySeen = false; }); const t = Date.now(); await act(sel); seq.push({ ms: Date.now() - t, same: (await H()) === want, busy: await p.evaluate(() => !!window.__busySeen) }); }
    const st1 = await p.evaluate(() => ({ ...window.__bb.stats }));
    ok(seq.every(x => x.same) && st1.effBuilds === st0.effBuilds && st1.maskReloads === st0.maskReloads, '12 MP undo/redo across 模糊/套用/純色: identical results, 0 effect rebuilds, 0 full-mask decodes: ' + seq.map(x => x.ms + 'ms').join(' '));
    ok(seq[1].busy && seq[4].busy, 'heavy 12 MP steps (across 套用) show 處理中…');
    // reload: the 12 MP session comes back, with the busy overlay while it is restored
    const hb = await p.evaluate(() => ({ hl: window.__bb.histLen, hi: window.__bb.hi }));
    await p.reload(); await booted(p); await p.waitForFunction(() => !window.__bb.busy);
    const rb = await p.evaluate(() => ({ w: window.__bb.img.w, hl: window.__bb.histLen, hi: window.__bb.hi, seen: !!window.__busySeen }));
    ok(rb.w === 4032 && rb.hl === hb.hl && rb.hi === hb.hi && rb.seen && (await H()) === h5, '12 MP session restored after reload (same result) with 還原上次的編輯… shown meanwhile');
    await p.evaluate(async () => { window.__midF = await window.__mk(1200, 900, 'big', 'image/jpeg', 'mid'); await window.__bb.openFile(window.__midF, true); await window.__bb.histDone(); });
    const lwBig = bigA.lw; await setBrush(Math.round(lwBig * (await p.evaluate(() => window.__bb.view.vs))));
    const midA = await scribble(), midB = await scribble();
    const big_ = Math.min(bigA.med, bigB.med), mid_ = Math.min(midA.med, midB.med);
    ok(big_ <= Math.max(3 * mid_, 12), `brush cost independent of image size: 12 MP ${big_.toFixed(1)} ms vs 1.2 MP ${mid_.toFixed(1)} ms per move (footprint ${Math.round(lwBig)}/${Math.round(midA.lw)} px)`);
    await ctx.close();
  }
  { // ---- lobby SE size: canvas room, 44 px controls, export dialog fits ----
    const { ctx, p } = await newPage(mob(375, 500)); await p.goto(U); await booted(p);
    const g = await p.evaluate(() => { const h = s => document.querySelector(s).getBoundingClientRect().height; return { stage: Math.round(h('#stage')), range: Math.round(h('#brush')), str: Math.round(h('#strength')), sw: document.documentElement.scrollWidth <= innerWidth, sh: document.documentElement.scrollHeight <= innerHeight,
      small: [...document.querySelectorAll('button,input')].filter(e => e.offsetParent && (e.getBoundingClientRect().width < 44 || e.getBoundingClientRect().height < 44)).map(e => e.id || e.textContent) }; });
    ok(g.stage >= 220 && g.range >= 44 && g.str >= 44 && g.sw && g.sh && !g.small.length, '375×500: canvas ' + g.stage + ' px tall (was 160), sliders ' + g.range + ' px, nothing under 44 px: ' + g.small);
    await p.click('#eSolid'); ok(await p.evaluate(() => document.querySelector('#solidColor').getBoundingClientRect().height >= 44), 'colour picker is 44 px tall');
    await p.click('#eMosaic');
    ok(await p.evaluate(() => document.querySelector('#holdBtn').closest('.tools') && document.querySelector('#applyBtn').closest('.tools')), 'short screen: 看原圖/套用 sit in the tool row');
    await p.click('#exportBtn'); await p.waitForSelector('#ov:not([hidden]) #ovClose');
    ok(await p.evaluate(() => { const c = document.querySelector('#ovClose').getBoundingClientRect(), card = document.querySelector('.ov .card'); return c.bottom <= innerHeight && c.top >= 0 && card.scrollTop === 0; }), '375×500 export dialog: 關閉 visible without scrolling');
    await ctx.close();
  }
  { // ---- landscape: sample chips stay inside the picture ----
    const { ctx, p } = await newPage(mob(844, 390)); await p.goto(U); await booted(p); await p.waitForTimeout(100);
    const c = await p.evaluate(() => { const v = document.querySelector('#view').getBoundingClientRect(), w = window.__bb.view, im = window.__bb.img, ch = [...document.querySelectorAll('#chips span')].map(s => s.getBoundingClientRect());
      const L = v.left + w.vtx, R = L + im.w * w.vs; return { n: ch.length, inside: ch.every(r => r.left >= L - 1 && r.right <= R + 1 && r.bottom <= v.top + w.vty + im.h * w.vs + 1) }; });
    ok(c.n >= 1 && c.inside, 'landscape: sample chips sit inside the picture');
    await ctx.close();
  }
  { // ---- 360×640: 開啟 label + full title ----
    const { ctx, p } = await newPage(mob(360, 640)); await p.goto(U); await booted(p);
    const h = await p.evaluate(() => ({ lbl: document.querySelector('#openBtn .lbl-s').offsetWidth > 0, title: document.querySelector('.top h1').scrollWidth <= document.querySelector('.top h1').clientWidth }));
    ok(h.lbl && h.title, '360 wide: 開啟 shows its text and the title is not cut: ' + JSON.stringify(h));
    await ctx.close();
  }
  { // ---- stored settings are validated; old key still loads ----
    const { ctx, p } = await newPage(mob(390, 844), () => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem('blur-brush:v1:settings', JSON.stringify({ eff: 'zzz', mosaic: -5, blur: 'x', brush: 99999, color: 'red' })); } });
    await p.goto(U); await booted(p);
    const w = await p.evaluate(() => ({ S: window.__bb.S, pressed: document.querySelectorAll('.seg button[aria-pressed="true"]').length, str: !document.querySelector('#strRow').hidden }));
    ok(w.S.eff === 'mosaic' && w.S.mosaic === 4 && w.S.blur === 16 && w.S.brush === 120 && w.S.color === '#111111' && w.pressed === 1 && w.str, 'invalid stored settings are clamped/replaced: ' + JSON.stringify(w.S));
    await p.evaluate(() => localStorage.setItem('blur-brush:v1:settings', JSON.stringify({ eff: 'blur', mosaic: 20, blur: 22, color: '#ff0000', brush: 70 }))); await p.reload(); await booted(p);
    ok(await p.evaluate(() => { const S = window.__bb.S; return S.eff === 'blur' && S.blur === 22 && S.brush === 70 && S.color === '#ff0000'; }), 'settings saved under the old key still load');
    await ctx.close();
  }
  await br.close(); srv.close();
  ok(!errors.length, 'no page/console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `FAIL ${fails} check(s)` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
