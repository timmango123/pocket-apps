// Playwright check for 格式互轉 (yaml-json). Run: node verify.js
// Sizes: 390x844, the lobby iframes 375x500 / 390x610 / 430x740, 360x640, 430x932, 844x390 landscape, desktop; light + dark.
// Flows: sample conversion, target switch, error card + jump, dropNull fix, swap + undo, clear + undo, options, copy, download,
// file open, persistence after reload (also an instant reload and a cleared editor), rapid real-touch taps, no network requests,
// 44 px for state-only controls, big files (1-10 MB, one-line and multi-line, emoji/CJK/ASCII) never block the main thread
// for 1 s, typing latency in a 5000-line YAML. Writes cover-390x520.png.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const OUT = __dirname;
const WRAP = path.join(OUT, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(path.resolve(OUT, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const errors = [];
let passN = 0;
const assert = (c, m) => { if (!c) { errors.push(m); console.log('FAIL', m); } else { passN++; console.log('ok  ', m); } };
const touch = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

(async () => {
  const browser = await chromium.launch();
  const watch = (p, tag) => {
    p.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    p.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) errors.push(`${tag} network request: ${r.url()}`); });
  };
  const ready = p => p.waitForFunction(() => window.__yjReady && window.__yj.res);

  // ---------- sizes x themes ----------
  const sizes = [['390x844', 390, 844], ['375x500', 375, 500], ['390x610', 390, 610], ['430x740', 430, 740], ['360x640', 360, 640], ['430x932', 430, 932], ['844x390', 844, 390]];
  for (const scheme of ['light', 'dark']) for (const [name, w, h] of sizes) {
    const ctx = await browser.newContext({ ...touch(w, h), colorScheme: scheme }); const p = await ctx.newPage(); watch(p, `${name}-${scheme}`);
    await p.goto(URL); await ready(p); await p.waitForTimeout(250);
    const m = await p.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width > 0; };
      const small = [...document.querySelectorAll('button')].filter(vis).filter(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(b => b.id || b.textContent.trim());
      const cut = [...document.querySelectorAll('button')].filter(vis).filter(b => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).map(b => b.id || b.textContent);
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, small, cut, out: document.querySelectorAll('#rows .r').length };
    });
    assert(m.sw <= m.iw, `${name} ${scheme}: no horizontal scroll (${m.sw}<=${m.iw})`);
    assert(!m.small.length, `${name} ${scheme}: all buttons >= 44px ${m.small.join(',')}`);
    assert(!m.cut.length, `${name} ${scheme}: no button cut off ${m.cut.join(',')}`);
    assert(m.out > 20, `${name} ${scheme}: sample converted on first open (${m.out} lines)`);
    await p.screenshot({ path: `${OUT}/shot-${name}-${scheme}.png` });
    await ctx.close();
  }
  { // desktop
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); watch(p, 'desktop');
    await p.goto(URL); await ready(p); await p.waitForTimeout(200);
    const side = await p.evaluate(() => { const a = document.getElementById('inCard').getBoundingClientRect(), b = document.getElementById('outCard').getBoundingClientRect(); return b.left > a.right && Math.abs(a.top - b.top) < 2; });
    assert(side, 'desktop: input and output side by side');
    await p.screenshot({ path: `${OUT}/shot-1280x800.png` }); await ctx.close();
  }

  // ---------- flows ----------
  const ctx = await browser.newContext({ ...touch(390, 844), permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL); await ready(p);
  const res = () => p.evaluate(() => { const r = window.__yj.res; return { ok: r.ok, from: r.from, out: r.out, err: r.error, notes: r.notes, warns: r.warns }; });
  const setSrc = async t => { await p.fill('#src', t); await p.waitForTimeout(350); };
  let r = await res();
  assert(r.ok && r.from === 'yaml' && JSON.parse(r.out).servers[1].retries === 5 && JSON.parse(r.out).servers[0].timeout === 30, 'sample YAML → JSON with merge keys');
  assert(await p.isVisible('#sampleChip'), 'sample is marked 範例');
  const t0 = Date.now(); await p.click('#toSeg [data-f="toml"]'); await p.waitForFunction(() => window.__yj.res.out.includes('[[servers]]')); const dt = Date.now() - t0;
  assert(dt < 400, `switching to TOML updates output immediately (${dt} ms)`);
  assert((await p.textContent('#outTag')) === 'TOML', 'output tag shows TOML');
  // error flow
  await setSrc('name: 小明\nskills:\n  - 料理\n  - 攝影\n age: 18\n');
  r = await res();
  assert(!r.ok && r.err.line === 5 && r.err.col === 2, 'indentation error reported at line 5 col 2');
  assert(await p.isVisible('.st.bad .ctx'), 'error card shows the offending lines with a caret');
  assert(await p.isVisible('#band'), 'error line highlighted in the editor');
  await p.screenshot({ path: `${OUT}/flow-error.png` });
  await p.click('.st.bad .ab:has-text("跳到第 5 行")');
  const sel = await p.evaluate(() => [document.activeElement.id, document.getElementById('src').selectionStart]);
  assert(sel[0] === 'src' && sel[1] === 'name: 小明\nskills:\n  - 料理\n  - 攝影\n '.length, 'jump button selects the error position');
  // dropNull fix
  await setSrc('a: 1\nb: null\nc: [x, ~]\n');
  r = await res();
  assert(!r.ok && r.err.fix === 'dropNull', 'null to TOML explained with a fix');
  await p.click('.st.bad .ab:has-text("略過所有 null")'); await p.waitForTimeout(200);
  r = await res();
  assert(r.ok && r.out === 'a = 1\nc = ["x"]\n', 'dropping nulls gives valid TOML');
  // wrong pinned format suggestion
  await p.click('#srcBtn'); await p.click('.mi.f-json'); await p.waitForTimeout(150);
  r = await res();
  assert(!r.ok && r.err.suggest === 'yaml', 'YAML pinned as JSON suggests YAML');
  await p.click('.st.bad .ab:has-text("改用 YAML 解析")'); await p.waitForTimeout(150);
  assert((await res()).ok, 'one tap switches the source format');
  await p.click('#srcBtn'); await p.click('.mi.f-auto'); await p.waitForTimeout(150);
  // swap + undo
  await setSrc('{"k": [1, 2], "n": "中文"}');
  await p.click('#toSeg [data-f="yaml"]'); await p.waitForTimeout(150);
  await p.click('#swapBtn'); await p.waitForTimeout(250);
  assert((await p.inputValue('#src')) === "k:\n  - 1\n  - 2\n'n': 中文\n" && (await res()).out === '{\n  "k": [\n    1,\n    2\n  ],\n  "n": "中文"\n}', 'swap puts the YAML in and converts back to JSON');
  await p.click('#toastHost button'); await p.waitForTimeout(150);
  assert((await p.inputValue('#src')) === '{"k": [1, 2], "n": "中文"}', 'swap can be undone');
  // clear + undo
  await p.click('#clearBtn'); await p.waitForTimeout(150);
  assert((await p.inputValue('#src')) === '' && await p.isVisible('.st.idle'), 'clear empties input and shows guidance');
  await p.click('#toastHost button'); await p.waitForTimeout(150);
  assert((await p.inputValue('#src')).startsWith('{"k"'), 'clear can be undone');
  // options
  await p.click('#optBtn'); await p.click('.orow:has-text("鍵依字母排序") .sw'); await p.click('.orow:has-text("單行") .sw'); await p.click('.close');
  await p.waitForTimeout(150);
  assert((await res()).out === "{k: [1, 2], 'n': 中文}\n", 'options: sorted single-line YAML');
  await p.click('#optBtn'); await p.click('.orow:has-text("鍵依字母排序") .sw'); await p.click('.orow:has-text("單行") .sw'); await p.click('.close');
  // copy
  await p.click('#copyBtn'); await p.waitForTimeout(150);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  assert(clip === (await res()).out, 'copy puts the full result on the clipboard');
  // download
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dlBtn')]);
  assert(dl.suggestedFilename() === 'converted.yaml', 'download offers converted.yaml');
  // file open
  const fpath = path.join(OUT, 'sample-upload.toml'); fs.writeFileSync(fpath, 'title = "上傳"\n[db]\nport = 5432\n');
  await p.setInputFiles('#fileIn', fpath); await p.waitForTimeout(300); fs.unlinkSync(fpath);
  r = await res();
  assert(r.from === 'toml' && r.ok && r.out === 'title: 上傳\ndb:\n  port: 5432\n', 'opening a .toml file converts it');
  // persistence
  await setSrc('persist: [1, 2]\n');
  await p.click('#toSeg [data-f="json"]'); await p.click('#optBtn'); await p.click('.mseg button:has-text("4")'); await p.click('.close');
  await p.waitForTimeout(500);
  await p.reload(); await ready(p); await p.waitForTimeout(200);
  r = await res();
  assert((await p.inputValue('#src')) === 'persist: [1, 2]\n' && r.out === '{\n    "persist": [\n        1,\n        2\n    ]\n}', 'input, target format and indent survive a reload');
  assert(!(await p.isVisible('#sampleChip')), 'user text is not marked as sample after reload');
  // rapid real touch taps (8/s, alternating targets) via CDP
  const cdp = await ctx.newCDPSession(p);
  const centers = await p.evaluate(() => ['yaml', 'json', 'toml'].map(f => { const r = document.querySelector(`#toSeg [data-f="${f}"]`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  const seq = []; let okTaps = 0;
  for (let k = 0; k < 24; k++) {
    const f = k % 3, [x, y] = centers[f];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(125);
    const on = await p.evaluate(() => document.querySelector('#toSeg [aria-pressed="true"]').dataset.f);
    seq.push(on); if (on === ['yaml', 'json', 'toml'][f]) okTaps++;
  }
  assert(okTaps === 24, `24 rapid touch taps at 8/s all registered exactly (${okTaps}/24)`);
  await p.waitForTimeout(300);
  assert((await res()).ok && (await res()).out.includes('persist = [1, 2]'), 'after rapid taps the output matches the last target');
  // large input stays responsive (worker)
  const big = await p.evaluate(() => { const o = { items: [] }; for (let k = 0; k < 20000; k++) o.items.push({ id: k, name: '品項' + k, price: k * 1.5, tags: ['a', 'b'] }); return JSON.stringify(o, null, 2); });
  await p.evaluate(t => { const ta = document.getElementById('src'); ta.value = t; ta.dispatchEvent(new Event('input')); }, big);
  const tb = Date.now(); await p.waitForFunction(() => window.__yj.res && window.__yj.res.out && window.__yj.res.out.startsWith('[[items]]'), null, { timeout: 15000 }); const bt = Date.now() - tb;
  assert(bt < 6000, `20,000-record (${(big.length / 1048576).toFixed(1)} MB) JSON → TOML in ${bt} ms`);
  const vr = await p.evaluate(async () => { const o = document.getElementById('out'); const n0 = document.querySelectorAll('#rows .r').length; o.scrollTop = o.scrollHeight; await new Promise(r => setTimeout(r, 120)); const last = [...document.querySelectorAll('#rows .r .n')].pop().textContent; return { n0, last, total: window.__yj.res.out.replace(/\n$/, '').split('\n').length }; });
  assert(vr.n0 < 300 && +vr.last === vr.total, `huge output is virtualised (${vr.n0} rows in the DOM) and scrolls to the last line ${vr.last}/${vr.total}`);
  assert(await p.evaluate(() => window.__yj.big && !document.getElementById('bigv').hidden && getComputedStyle(document.getElementById('src')).display === 'none'), 'typing past the size limit switches to the read-only preview');
  // quick reload keeps the last keystroke; a cleared editor stays empty after reload
  await p.click('#clearBtn'); await p.waitForTimeout(100);
  await p.click('#src'); await p.keyboard.type('quick: 1');
  await p.reload(); await ready(p); await p.waitForTimeout(150);
  assert((await p.inputValue('#src')) === 'quick: 1', 'typing then reloading at once keeps every character');
  await p.click('#clearBtn'); await p.waitForTimeout(50);
  await p.reload(); await ready(p); await p.waitForTimeout(150);
  assert((await p.inputValue('#src')) === '' && await p.isVisible('.st.idle') && !(await p.isVisible('#sampleChip')), 'a cleared editor stays empty after reload (no sample)');
  // small controls that only appear in some states are still 44 px
  await setSrc('a: yes\nb: 017\n');
  const sz = await p.evaluate(() => [...document.querySelectorAll('.st.warn summary, .st.warn li button')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  assert(sz.length === 3 && sz.every(([w, h]) => w >= 44 && h >= 44), `warning summary and L1/L2 jump buttons are >= 44 px (${JSON.stringify(sz)})`);
  await p.click('.st.warn li button >> nth=1'); await p.waitForTimeout(100);
  assert(await p.evaluate(() => document.getElementById('src').value.length > 0), 'warning jump button works');
  await p.click('#clearBtn'); await p.waitForTimeout(100);
  const tb2 = await p.evaluate(() => { const r = document.querySelector('#toastHost button').getBoundingClientRect(); return [r.width, r.height]; });
  assert(tb2[0] >= 44 && tb2[1] >= 44, `toast undo button is >= 44 px (${tb2.map(Math.round)})`);
  await p.click('#toastHost button'); await p.waitForTimeout(100);
  await p.click('#optBtn');
  const ms = await p.evaluate(() => [...document.querySelectorAll('.mseg button')].map(b => b.getBoundingClientRect().height));
  assert(ms.length && ms.every(h => h >= 44), `indent buttons are >= 44 px (${ms})`);
  await p.click('.close');
  // y/n are quoted in YAML output; one-line duplicate keys name columns
  await p.click('#toSeg [data-f="yaml"]'); await setSrc('{"a":"y","b":"N","a":1}');
  r = await res();
  assert(r.out === "a: 1\nb: 'N'\n" && r.warns[0].msg.includes('第 1 行的第 2 欄和第 18 欄'), 'YAML quotes y/n; one-line duplicate key warning gives columns');
  await ctx.close();

  // ---------- big files: never block the main thread for long ----------
  {
    const c3 = await browser.newContext({ ...touch(360, 640), permissions: ['clipboard-read', 'clipboard-write'] }); const p3 = await c3.newPage(); watch(p3, 'big');
    await p3.addInitScript(() => { window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* no longtask API */ } });
    await p3.goto(URL); await ready(p3); await p3.waitForTimeout(300);
    const mk = (n, kind, pretty) => { const o = { items: Array.from({ length: n }, (_, i) => ({ id: i, name: (kind === 'emoji' ? '項目 😀 ' : kind === 'cjk' ? '項目中文 ' : 'item ') + i, price: i * 1.25, tags: ['a', 'b'], ok: i % 2 === 0, note: 'x'.repeat(80) })) }; return pretty ? JSON.stringify(o, null, 2) : JSON.stringify(o); };
    const cases = [['emoji', 7000, false], ['emoji', 70000, false], ['cjk', 70000, false], ['ascii', 70000, false], ['emoji', 50000, true]];
    for (const [kind, n, pretty] of cases) {
      const f = path.join(OUT, `big-${kind}.json`); const txt = mk(n, kind, pretty); fs.writeFileSync(f, txt);
      await p3.evaluate(() => { window.__lt.length = 0; window.__prev = window.__yj.res; });
      const t1 = Date.now();
      await p3.setInputFiles('#fileIn', f);
      await p3.waitForFunction(L => window.__yj.res !== window.__prev && window.__yj.res.ok && window.__yj.text().length === L && !document.getElementById('busy'), txt.length, { timeout: 120000, polling: 100 });
      await p3.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
      const wall = Date.now() - t1; fs.unlinkSync(f);
      await p3.evaluate(() => { const v = document.getElementById('bigv'); v.scrollTop = v.scrollHeight; const o = document.getElementById('out'); o.scrollTop = o.scrollHeight; });
      await p3.waitForTimeout(250);
      const m = await p3.evaluate(() => ({ lt: Math.max(0, ...window.__lt), big: window.__yj.big, rows: document.querySelectorAll('#bigRows .r').length, bar: !document.getElementById('bigBar').hidden, sw: document.documentElement.scrollWidth, iw: innerWidth, last: [...document.querySelectorAll('#bigRows .r .n')].map(e => e.textContent).filter(t => /\d/.test(t)).pop() }));
      const mb = (Buffer.byteLength(txt) / 1048576).toFixed(1);
      assert(m.big && m.bar && m.rows >= 3 && m.rows < 400, `${mb} MB ${pretty ? 'multi-line' : 'one-line'} ${kind} JSON opens as a read-only preview (${m.rows} rows in the DOM)`);
      assert(m.lt < 1000, `${mb} MB ${pretty ? 'multi-line' : 'one-line'} ${kind}: longest main-thread task ${m.lt} ms (< 1000), ready in ${wall} ms`);
      assert(m.sw <= m.iw, `${mb} MB ${kind}: no horizontal page scroll at 360 px`);
      if (pretty) assert(+m.last === txt.split('\n').length, `preview scrolls to the last line (${m.last})`);
    }
    // one-line JSON can be expanded into lines; small enough results become editable again
    const small = mk(400, 'emoji', false); const f2 = path.join(OUT, 'mid-emoji.json'); fs.writeFileSync(f2, small);
    await p3.setInputFiles('#fileIn', f2); fs.unlinkSync(f2);
    await p3.waitForFunction(() => window.__yj.big && !document.getElementById('fmtBtn').hidden, null, { timeout: 20000 });
    const fb = await p3.evaluate(() => { const r = document.getElementById('fmtBtn').getBoundingClientRect(); return [r.width, r.height]; });
    assert(fb[0] >= 44 && fb[1] >= 44, 'expand button is >= 44 px');
    await p3.click('#fmtBtn');
    await p3.waitForFunction(() => !window.__yj.big, null, { timeout: 20000 });
    assert((await p3.inputValue('#src')).startsWith('{\n  "items": [\n    {\n      "id": 0,'), 'one-line JSON expands into editable lines');
    // error far into a big one-line file: card shows the spot and the jump marks the row in the preview
    await p3.evaluate(() => { window.__lt.length = 0; });
    const bad = mk(20000, 'emoji', false).replace(/}\]}$/, '},]}'); const f3 = path.join(OUT, 'bad-big.json'); fs.writeFileSync(f3, bad);
    await p3.setInputFiles('#fileIn', f3); fs.unlinkSync(f3);
    await p3.waitForFunction(() => window.__yj.res && window.__yj.res.error && !document.getElementById('busy'), null, { timeout: 150000 });
    const ec = await p3.evaluate(() => document.querySelector('.st.bad .ctx .cur').textContent);
    assert(/\},\]\}$/.test(ec.trim()) && ec.length < 250, `error context in a one-line 3 MB file shows the spot, not the whole line (${ec.length} chars)`);
    await p3.click('.st.bad .ab:has-text("跳到第 1 行")'); await p3.waitForTimeout(300);
    assert(await p3.evaluate(() => { const c = document.querySelector('#bigRows .r.cur'); if (!c) return false; const a = c.getBoundingClientRect(), b = document.getElementById('bigv').getBoundingClientRect(); return a.top >= b.top && a.bottom <= b.bottom + 1; }), 'jump to the error marks the row in the preview and scrolls it into view');
    assert(Math.max(0, ...(await p3.evaluate(() => window.__lt))) < 1000, 'big error file: no main-thread task over 1 s');
    // pasting a huge text never goes through the textarea
    await p3.click('#clearBtn'); await p3.waitForTimeout(100);
    await p3.evaluate(t => { const ta = document.getElementById('src'); ta.focus(); const dt = new DataTransfer(); dt.setData('text/plain', t); window.__ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); }, mk(30000, 'emoji', false));
    await p3.waitForTimeout(300); await p3.evaluate(() => { window.__lt.length = 0; });
    await p3.evaluate(() => document.getElementById('src').dispatchEvent(window.__ev));
    await p3.waitForFunction(() => window.__yj.res && window.__yj.res.ok && !document.getElementById('busy'), null, { timeout: 60000 });
    assert(await p3.evaluate(() => window.__yj.big && Math.max(0, ...window.__lt) < 1000), 'pasting 4 MB of one-line JSON opens the preview without a long task');
    // loading the error sample at 360x640: nothing covers the jump button
    await p3.click('#sampleBtn'); await p3.click('.mi:has-text("有錯誤的 YAML")'); await p3.waitForTimeout(100);
    const hit = await p3.evaluate(() => { const b = [...document.querySelectorAll('.st.bad .ab')].find(x => x.textContent.includes('跳到第 5 行')); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b; });
    assert(hit, 'after loading the error sample the jump button is not covered by a toast');
    const al = await p3.evaluate(() => { const t = document.querySelector('.st.bad .et > span:last-child'); const rs = [...t.getClientRects()].map(r => Math.round(r.left)); return rs; });
    assert(new Set(al).size === 1, `error title lines are aligned (${al})`);
    await c3.close();
  }
  { // typing in a 1000-item YAML stays quick
    const c4 = await browser.newContext(touch(390, 844)); const p4 = await c4.newPage(); watch(p4, 'typing');
    await p4.goto(URL); await ready(p4);
    const y = Array.from({ length: 1000 }, (_, i) => `- id: ${i}\n  name: "n${i}"\n  sub:\n    a: [1, 2, 3]\n    b: text ${i}`).join('\n');
    // (Playwright's fill() types multi-line text slowly even into a bare textarea, so the text is set directly.)
    await p4.evaluate(t => { const ta = document.getElementById('src'); ta.value = t; ta.dispatchEvent(new Event('input')); }, y);
    await p4.waitForFunction(() => window.__yj.res.out.includes('"n999"'));
    await p4.click('#src'); await p4.keyboard.press('Control+End');
    const lat = []; let typed = '';
    for (const ch of 'abcde') {
      typed += ch; const t = Date.now(); await p4.keyboard.type(ch);
      await p4.waitForFunction(c => window.__yj.res.out.includes('"text 999' + c + '"'), typed, { polling: 'raf' }); lat.push(Date.now() - t);
    }
    lat.sort((a, b) => a - b);
    assert(lat[2] < 400, `keystroke → output in a 5000-line YAML: median ${lat[2]} ms (${lat})`);
    await c4.close();
  }

  // ---------- cover ----------
  for (const scheme of ['light', 'dark']) {
    const c2 = await browser.newContext({ ...touch(390, 520), colorScheme: scheme }); const p2 = await c2.newPage(); watch(p2, 'cover');
    await p2.goto(URL); await ready(p2); await p2.waitForTimeout(400);
    await p2.screenshot({ path: `${OUT}/${scheme === 'light' ? 'cover-390x520' : 'cover-390x520-dark'}.png` });
    await c2.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  if (errors.length) { console.log('\nERRORS:\n' + errors.join('\n')); console.log(`${passN} passed, ${errors.length} failed`); process.exit(1); }
  console.log(`${passN} passed, 0 failed`);
})();
