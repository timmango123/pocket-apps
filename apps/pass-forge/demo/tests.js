// Regression tests for 密碼產生器 (pass-forge): emoji symbol sets, long strength checks, real CDP touch (second finger,
// slow taps, ghost clicks), pull-to-regenerate vs. scrolling, history, number boxes, time formatting, Chinese common passwords.
// Usage: node tests.js   (waits on conditions, no fixed timing assumptions; nothing is written to disk)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + HTML + '</body></html>';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STORE = 'pass-forge:v1:opts';

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  async function open(w, h, opts = {}) {
    const { seed, ...ctxOpts } = opts;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...ctxOpts });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL }).catch(() => {});
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}x${h} pageerror ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console ${m.text()}`); });
    page.on('request', r => { if (!r.url().startsWith(URL) && !/^(data|blob):/.test(r.url())) errors.push('request ' + r.url()); });
    if (seed) await page.addInitScript(([k, v]) => { if (!sessionStorage.seeded) { localStorage.clear(); localStorage.setItem(k, v); sessionStorage.seeded = 1; } }, [STORE, JSON.stringify(seed)]);
    await page.goto(URL);
    await page.waitForFunction(() => document.querySelector('#pw') && typeof regen === 'function');
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const at = async sel => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    let nid = 100;
    // CDP touchEnd releases exactly the points it lists
    const tap = async (sel, hold = 40, others = []) => { const p = { ...(typeof sel === 'string' ? await at(sel) : sel), id: nid++ }; await T('touchStart', [...others, p]); await sleep(hold); await T('touchEnd', [p]); };
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
    // counts app actions: regen calls and copies
    await page.evaluate(() => {
      window.__n = { regen: 0, copy: 0 };
      const r0 = regen; regen = function (...a) { __n.regen++; return r0.apply(this, a); };
      const c0 = copyText; copyText = function (...a) { __n.copy++; return c0.apply(this, a); };
    });
    const counts = () => page.evaluate(() => { const c = { ...__n }; __n.regen = 0; __n.copy = 0; return c; });
    return { ctx, page, T, at, tap, settle, counts };
  }

  // ---------- pure logic ----------
  {
    const { ctx, page } = await open(390, 844);
    const r = await page.evaluate(() => {
      const out = {};
      const surrogate = s => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
      Object.assign(opts, { tab: 'random', len: 20, upper: false, lower: false, digit: false, sym: true, ambig: false, each: true, unique: false, symset: '😀🎉' });
      let bad = 0, n = 0; for (let i = 0; i < 200; i++) { const g = genRandom(); n = g.pool; if (surrogate(g.pw) || [...g.pw].some(c => !'😀🎉'.includes(c))) bad++; }
      out.emojiBad = bad; out.emojiPool = n; out.emojiBits = genRandom().bits;
      Object.assign(opts, { upper: true, lower: true, digit: true, symset: '😀🎉👍🏽' });
      { const g = genRandom(); out.mixPool = g.pool; out.mixSur = surrogate(g.pw); }
      Object.assign(opts, { upper: false, lower: false, digit: false, unique: true, symset: '😀🎉' });
      try { const g = genRandom(); out.uniq = g.pw; out.uniqNote = g.note; } catch (e) { out.uniqErr = e.message; }
      // custom symbols all filtered out
      Object.assign(opts, { unique: false, symset: '|', ambig: true }); out.ambigOnly = genRandom().error;
      Object.assign(opts, { upper: true, lower: true, digit: true, symset: 'abc', ambig: false }); { const g = genRandom(); out.overlapNote = g.note; out.overlapPool = g.pool; }
      Object.assign(opts, { upper: false, digit: false }); out.overlapErrLowerOnly = genRandom().error;
      Object.assign(opts, { ...DEFAULTS });
      // time formatting rounds before choosing the unit
      out.fmt = [59.96, 3599, 86399, 31557599, 30, 90, 31557600 * 1.5].map(fmtTime);
      // strength
      out.cn = ['woaini1314', 'woaini', '5201314', 'Woaini1314!', 'qq123456'].map(p => { const c = checkStrength(p); return GRADES[c.common ? 0 : gradeOf(c.bits)]; });
      out.cnBits = Math.round(checkStrength('woaini1314').bits);
      out.strongStill = GRADES[gradeOf(checkStrength('xK9#mQ2$vL8!pR4&').bits)];
      out.weak = ['password123', 'P@ssw0rd', 'qwerty2024'].map(p => { const c = checkStrength(p); return GRADES[c.common ? 0 : gradeOf(c.bits)]; });
      const rnd = n => { let s = ''; const A = 'abcdefghijklmnopqrstuvwxyz0123456789!@#'; for (let i = 0; i < n; i++) s += A[randInt(A.length)]; return s; };
      for (const n of [100, 500, 1000, 5000]) { const s = rnd(n), t0 = performance.now(); const c = checkStrength(s); out['t' + n] = performance.now() - t0; out['cut' + n] = c.cut; }
      { const s = '1'.repeat(1000), t0 = performance.now(); checkStrength(s); out.tRep = performance.now() - t0; }
      { const s = '1234567890'.repeat(13), t0 = performance.now(); checkStrength(s); out.tDigits = performance.now() - t0; }
      { const s = 'ab'.repeat(64), t0 = performance.now(); out.repBits = checkStrength(s).bits; out.tAb = performance.now() - t0; }
      return out;
    });
    ok(r.emojiBad === 0 && r.emojiPool === 2, `emoji symbols: no half emoji, pool 2 (${r.emojiBad} bad, pool ${r.emojiPool})`);
    ok(Math.abs(r.emojiBits - 20) < 1e-9, 'emoji symbols: 20 chars × log2(2) = 20 bits, got ' + r.emojiBits);
    ok(r.mixPool === 65 && !r.mixSur, `mixed emoji (incl. skin tone) pool 62+3 = ${r.mixPool}`);
    ok(!r.uniqErr && [...r.uniq].length === 2 && /2 個字元/.test(r.uniqNote), `unique + emoji only: no error, 2 chars (${r.uniqErr || r.uniq} / ${r.uniqNote})`);
    ok(/自訂符號都與/.test(r.ambigOnly || ''), 'custom symbol removed by ambiguous filter explains why: ' + r.ambigOnly);
    ok(/自訂符號都與/.test(r.overlapNote) && r.overlapPool === 62, 'custom symbols overlapping letters explain they are unused: ' + r.overlapNote);
    ok(r.fmt.join('|') === '1 分鐘|1 小時|1 天|1 年|30 秒|1.5 分鐘|1.5 年', 'fmtTime rounds before unit: ' + r.fmt.join('|'));
    ok(r.cn.every(g => g === '很弱' || g === '弱'), 'Chinese common passwords weak: ' + r.cn.join(','));
    ok(r.cnBits < 20, 'woaini1314 bits ' + r.cnBits);
    ok(['強', '很強'].includes(r.strongStill), '16 random chars still strong: ' + r.strongStill);
    ok(r.weak.every(g => g === '很弱' || g === '弱'), 'English weak passwords still weak: ' + r.weak.join(','));
    ok(r.t100 < 1500 && r.t500 < 1500 && r.t1000 < 1500 && r.t5000 < 2500, `long check fast: 100=${r.t100.toFixed(0)} 500=${r.t500.toFixed(0)} 1000=${r.t1000.toFixed(0)} 5000=${r.t5000.toFixed(0)} ms`);
    ok(!r.cut100 && r.cut500 && r.cut1000, 'over 128 chars is marked as cut');
    ok(r.tRep < 1500 && r.tDigits < 1500 && r.tAb < 1500 && r.repBits < 30, `repeats/digits fast (${r.tRep.toFixed(0)}, ${r.tDigits.toFixed(0)}, ${r.tAb.toFixed(0)} ms), abab… weak (${r.repBits.toFixed(1)} bits)`);
    await ctx.close();
  }

  // ---------- saved emoji + unique setting loads without error ----------
  {
    const before = errors.length;
    const { ctx, page } = await open(390, 844, { seed: { tab: 'random', len: 20, upper: false, lower: false, digit: false, sym: true, unique: true, each: true, symset: '😀🎉' } });
    await page.reload(); await page.waitForFunction(() => document.querySelector('#pw').textContent.length > 0);
    const s = await page.evaluate(() => ({ pw: $('pw').textContent, dis: $('btn-copy').disabled }));
    ok(errors.length === before && [...s.pw].length === 2 && !s.dis, `saved emoji+unique setting loads (${s.pw})`);
    await ctx.close();
  }

  // ---------- 390x844 touch ----------
  {
    const { page, ctx, T, at, tap, settle, counts } = await open(390, 844);
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload(); await page.waitForFunction(() => typeof regen === 'function');
    await page.evaluate(() => {
      window.__n = { regen: 0, copy: 0 };
      const r0 = regen; regen = function (...a) { __n.regen++; return r0.apply(this, a); };
      const c0 = copyText; copyText = function (...a) { __n.copy++; return c0.apply(this, a); };
    });
    const state = () => page.evaluate(() => ({ tab: opts.tab, upper: opts.upper, sep: opts.sep, hist: history.length, batch: document.querySelectorAll('#batch-list li').length, active: document.activeElement && document.activeElement.id }));
    // single taps, slow taps
    for (const hold of [40, 600, 1000]) {
      await counts();
      await tap('#btn-regen', hold); await settle(); await sleep(80);
      let c = await counts(); ok(c.regen === 1, `regen tap held ${hold}ms fires once (${c.regen})`);
      const u0 = (await state()).upper;
      await tap('label:has(#opt-upper)', hold); await settle(); await sleep(80);
      ok((await state()).upper === !u0, `toggle tap held ${hold}ms flips once`);
      await page.evaluate(() => { $('opt-upper').checked = opts.upper = true; save(); });
      await counts();
      await tap('#btn-copy', hold); await settle(); await sleep(80);
      c = await counts(); ok(c.copy === 1, `copy tap held ${hold}ms fires once (${c.copy})`);
    }
    // toggle switch itself (input element inside label)
    await tap('#opt-digit'); await settle(); await sleep(80);
    ok((await state()) && await page.evaluate(() => opts.digit === false && !$('opt-digit').checked), 'tap on the switch flips it once');
    await tap('#opt-digit'); await settle(); await sleep(80);
    // second finger: finger 1 rests on the "長度" title
    const title = await at('#panel-random .sect-title');
    const f1 = { ...title, id: 1 };
    await T('touchStart', [f1]); await sleep(40);
    await counts();
    await tap('#btn-regen', 40, [f1]); await settle();
    ok((await counts()).regen === 1, 'second finger: regen works while another finger is down');
    await tap('#btn-copy', 40, [f1]); await settle();
    ok((await counts()).copy === 1, 'second finger: copy works');
    await tap('#pw', 40, [f1]); await settle();
    ok((await counts()).copy === 1, 'second finger: tap password copies');
    const u1 = (await state()).upper;
    await tap('label:has(#opt-upper)', 40, [f1]); await settle();
    ok((await state()).upper === !u1, 'second finger: toggle works');
    await tap('label:has(#opt-upper)', 40, [f1]); await settle();
    await tap('#btn-batch', 40, [f1]); await settle();
    ok((await state()).batch === 5, 'second finger: batch works');
    await tap('#batch-list .mini', 40, [f1]); await settle();
    ok((await counts()).copy === 1, 'second finger: list copy works');
    await tap('#len-num', 40, [f1]); await settle();
    ok((await state()).active === 'len-num', 'second finger: length box gets focus');
    await page.evaluate(() => document.activeElement.blur());
    await tap('#tab-phrase', 40, [f1]); await settle();
    ok((await state()).tab === 'phrase', 'second finger: tab works');
    await T('touchEnd', [f1]); await settle();
    const hideToast = () => page.evaluate(() => { $('toast').hidden = true; }); // the copy toast sits over the bottom controls
    await hideToast();
    // finger 1 on title for phrase panel
    const f2 = { ...(await at('#panel-phrase .sect-title')), id: 2 };
    await T('touchStart', [f2]); await sleep(40);
    await tap('#sep-dot', 40, [f2]); await settle();
    ok((await state()).sep === '.', 'second finger: separator works');
    // release the resting finger first, then the tapping finger (other release order)
    const p = { ...(await at('#sep-under')), id: nid() };
    await T('touchStart', [f2, p]); await sleep(40); await T('touchEnd', [f2]); await sleep(30); await T('touchEnd', [p]); await settle();
    ok((await state()).sep === '_', 'second finger released last still works');
    await tap('#tab-random'); await settle();
    ok((await state()).tab === 'random', 'tab back');
    // fast alternating taps: regen vs toggle, overlapping fingers
    await settle(); await sleep(100); await counts();
    const hist0 = (await state()).hist;
    await page.evaluate(() => scrollTo(0, 0)); await hideToast(); await settle();
    const box = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const A = await box('#btn-regen'), B = await box('label:has(#opt-sym)'); let cur = null, nA = 0, nB = 0;
    await page.evaluate(() => { window.__sym = 0; $('opt-sym').addEventListener('change', () => __sym++); });
    const sym0 = await page.evaluate(() => opts.sym);
    for (let i = 0; i < 12; i++) {
      const q = { ...(i % 2 ? B : A), id: 300 + i }; if (i % 2) nB++; else nA++;
      if (!cur) await T('touchStart', [q]); else { await T('touchStart', [cur, q]); await sleep(40); await T('touchEnd', [cur]); }
      cur = q; await sleep(60);
    }
    await T('touchEnd', [cur]); await settle(); await sleep(150);
    const c12 = await counts(), sym1 = await page.evaluate(() => opts.sym), ns = await page.evaluate(() => __sym);
    ok(c12.regen === nA + nB && ns === nB && sym1 === sym0, `12 overlapping alternating taps: ${c12.regen} regen calls (want ${nA + nB}), ${ns} toggles (want ${nB})`);
    // no ghost click after layout change: tab switch moves controls under the finger
    await tap('#tab-check'); await settle(); await sleep(450);
    ok((await state()).tab === 'check', 'check tab via tap');
    await tap('#tab-random'); await settle();
    // toast button size
    await tap('#btn-copy'); await page.waitForSelector('#toast-act:not([hidden])');
    const tb = await page.locator('#toast-act').boundingBox();
    ok(tb.height >= 44 && tb.width >= 44, `toast button ${tb.width.toFixed(0)}x${tb.height.toFixed(0)} >= 44`);
    // slider drag: history gets one entry, not one per input event
    await page.evaluate(() => { history.length = 0; headDraft = false; renderHistory(); });
    await tap('#btn-regen'); await settle();
    await page.evaluate(() => { const r = $('len-range'); for (let v = 21; v <= 60; v++) { r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); } for (const k of ['opt-sym', 'opt-sym', 'opt-ambig', 'opt-ambig']) $(k).click(); });
    let h = await page.evaluate(() => history.map(x => x.pw.length));
    ok(h.length === 2 && h[0] === 60 && h[1] === 20, 'slider/toggle tweaks replace one history entry: ' + h.join(','));
    await tap('#btn-regen'); await settle();
    h = await page.evaluate(() => history.length); ok(h === 3, 'regen adds to history: ' + h);
    // history colours random symbols as symbols, phrase separators as separators
    await page.evaluate(() => { history.length = 0; history.push({ pw: 'a-b.c', phrase: false }, { pw: 'one-two', phrase: true }); renderHistory(); });
    const cls = await page.evaluate(() => [...document.querySelectorAll('#history li')].map(li => [...li.querySelectorAll('.pw span')].find(s => s.textContent === '-').className));
    ok(cls[0] === 's' && cls[1] === 'sep', 'history separator colouring by type: ' + cls.join(','));
    // number boxes
    const nb = await page.evaluate(() => {
      const o = {}, n = $('len-num');
      const len0 = opts.len;
      n.focus(); n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); n.blur(); o.empty = [n.value, opts.len, len0];
      n.focus(); n.value = '1e2'; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); n.blur(); o.exp = [n.value, opts.len];
      n.value = '20'; n.dispatchEvent(new Event('change', { bubbles: true }));
      const b = $('batch-n');
      b.value = '1e3'; runBatch(); o.b1 = [b.value, document.querySelectorAll('#batch-list li').length, $('toast-text').textContent];
      b.value = '2.5'; runBatch(); o.b2 = [b.value, document.querySelectorAll('#batch-list li').length];
      b.value = ''; runBatch(); o.b3 = [b.value, document.querySelectorAll('#batch-list li').length];
      b.value = '5'; runBatch();
      return o;
    });
    ok(nb.empty[0] === String(nb.empty[2]) && nb.empty[1] === nb.empty[2], 'empty length box restores on blur: ' + nb.empty);
    ok(nb.exp[0] === '100' && nb.exp[1] === 100, '1e2 → 100: ' + nb.exp);
    ok(nb.b1[0] === '50' && nb.b1[1] === 50 && /50/.test(nb.b1[2]), 'batch 1e3 → 50 with notice: ' + nb.b1);
    ok(nb.b2[0] === '3' && nb.b2[1] === 3, 'batch 2.5 → 3: ' + nb.b2);
    ok(nb.b3[1] === 3, 'batch empty keeps last count: ' + nb.b3);
    // long paste in strength check stays responsive
    await tap('#tab-check'); await settle();
    const long = 'x9#Kq'.repeat(200);
    const t0 = Date.now();
    await page.fill('#check-input', long);
    await page.waitForFunction(() => /只分析前 128/.test($('meter-note').textContent), null, { timeout: 15000 }).catch(() => {});
    const dt = Date.now() - t0, note = await page.textContent('#meter-note');
    ok(/只分析前 128/.test(note) && dt < 5000, `1000-char paste analysed in ${dt}ms: ${note}`);
    await page.fill('#check-input', 'woaini1314'); await page.waitForFunction(() => $('grade').textContent === '很弱', null, { timeout: 5000 }).catch(() => {});
    ok(await page.textContent('#grade') === '很弱', 'UI: woaini1314 → 很弱');
    await page.fill('#check-input', '');
    await tap('#tab-random'); await settle();
    await ctx.close();
  }

  // ---------- pull to regenerate vs. scrolling back up ----------
  {
    const { page, ctx, T, at, settle, counts } = await open(390, 640);
    const drag = async (from, dy) => { const id = nid(); await T('touchStart', [{ ...from, id }]); for (let k = 1; k <= 8; k++) { await T('touchMove', [{ x: from.x, y: from.y + dy * k / 8, id }]); await sleep(16); } await T('touchEnd', [{ x: from.x, y: from.y + dy, id }]); await settle(); };
    await counts();
    // at the top: pulling down regenerates once
    const legend = await at('#legend');
    await drag(legend, 120);
    ok((await counts()).regen === 1, 'pull down at top regenerates');
    await page.evaluate(() => scrollTo(0, 260)); await settle();
    const sy = await page.evaluate(() => scrollY);
    const lg2 = await at('#legend');
    if (lg2.y < 20) await page.evaluate(() => scrollTo(0, 120)), await settle();
    const from = await at('#legend');
    await counts();
    await drag(from, 120);
    await sleep(300);
    const after = await page.evaluate(() => scrollY), c = await counts();
    ok(sy > 0 && c.regen === 0, `dragging down after scrolling (scrollY ${sy} → ${after}) does not regenerate (${c.regen})`);
    await ctx.close();
  }

  ok(errors.length === 0, 'no page/console errors or requests: ' + errors.slice(0, 5).join(' | '));
  await browser.close(); srv.close();
  console.log(`${fail ? 'FAIL' : 'PASS'} pass-forge ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
let _nid = 1000; function nid() { return _nid++; }
