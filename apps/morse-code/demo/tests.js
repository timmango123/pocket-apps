// Regression tests for morse-code (run by qa/smoke/run.js): real CDP touch for tap handling, plus each release-review fix.
// node apps/morse-code/demo/tests.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const HTML = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + SRC + '</body></html>';
const K = 'morse-code:v1:';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok - ' + m); } else { fails.push(m); console.log('FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/apps/morse-code/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const open = async (w = 390, h = 844, extra = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...extra });
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('request', q => { if (!q.url().startsWith('http://127.0.0.1')) errors.push('external request ' + q.url()); });
    return { ctx, page, cdp };
  };
  const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const center = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const tap = async (cdp, p, hold = 40) => { await touch(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(hold); await touch(cdp, 'touchEnd', []); };
  // finger 1 rests on `rest`, finger 2 taps `p`, finger 2 lifts first
  const tapWithOther = async (cdp, rest, p, hold = 40) => {
    await touch(cdp, 'touchStart', [{ x: rest.x, y: rest.y, id: 1 }]); await sleep(60);
    await touch(cdp, 'touchStart', [{ x: rest.x, y: rest.y, id: 1 }, { x: p.x, y: p.y, id: 2 }]); await sleep(hold);
    await touch(cdp, 'touchMove', [{ x: rest.x, y: rest.y, id: 1 }]); await sleep(60); await touch(cdp, 'touchEnd', []);
  };
  const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 120))));
  const set = (page, v) => page.evaluate(v => { const t = document.getElementById('inText'); t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  const out = page => page.evaluate(() => document.getElementById('outBox').textContent);

  try {
    // ---------- 1. flash overlay: stopping it never lets the tap reach what is underneath ----------
    {
      const { ctx, page, cdp } = await open();
      await page.addInitScript(k => { if (!sessionStorage.x) { sessionStorage.x = 1; localStorage.setItem(k + 'settings', JSON.stringify({ outputs: ['flash'], flashAck: true, wpm: 5, farnsworth: 5 })); } }, K);
      await page.goto(url); await set(page, 'PARIS PARIS PARIS PARIS PARIS');
      const st = () => page.evaluate(() => ({ on: __mc.P.on, flash: !document.getElementById('flash').hidden, snd: outSound.checked, fl: outFlash.checked, vib: outVibe.checked }));
      const start = async () => {
        await page.evaluate(() => { __mc.stopPlay(); document.getElementById('playBtn').scrollIntoView({ block: 'center' }); }); await settle(page);
        await tap(cdp, await center(page, '#playBtn'));
        await page.waitForFunction(() => __mc.P.on && !document.getElementById('flash').hidden, null, { timeout: 5000 });
      };
      for (const [name, sel] of [['play', '#playBtn'], ['chip sound', 'label.chip:has(#outSound)'], ['chip flash', 'label.chip:has(#outFlash)']]) {
        for (const hold of [40, 600, 1000]) {
          await start(); const before = await st();
          const p = await page.evaluate(sel => { const f = document.getElementById('flash'); f.hidden = true; const r = document.querySelector(sel).getBoundingClientRect(); f.hidden = false; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
          await touch(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(hold);
          const mid = await st(); await touch(cdp, 'touchEnd', []); await settle(page); await sleep(150);
          const a = await st();
          ok(!mid.on && mid.flash && !a.on && !a.flash && a.snd === before.snd && a.fl === before.fl && a.vib === before.vib,
            `flash stop over ${name}, hold ${hold}ms: stops on press, stays covered until lift, nothing underneath changes ${JSON.stringify({ mid, a })}`);
        }
      }
      for (const hold of [40, 600]) {
        await start(); const p = await page.evaluate(() => { const f = document.getElementById('flash'); f.hidden = true; const r = document.getElementById('playBtn').getBoundingClientRect(); f.hidden = false; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await tapWithOther(cdp, { x: 60, y: 40 }, p, hold); await settle(page); await sleep(150);
        const a = await st(); ok(!a.on && !a.flash, `flash stop with another finger down (hold ${hold}): stopped, not restarted ${JSON.stringify(a)}`);
      }
      // keyboard can stop it too
      await start(); await page.keyboard.press('Escape'); ok(!(await st()).on && !(await st()).flash, 'Escape stops and closes flash');
      await ctx.close();
    }

    // ---------- 2. taps: one action per tap (pointerup + click never double), slow taps, other finger down ----------
    {
      const { ctx, page, cdp } = await open();
      await page.goto(url);
      const theme = () => page.textContent('#themeBtn');
      const order = ['自動', '淺色', '深色'];
      for (const hold of [40, 600, 1000]) {
        const t0 = await theme(); await tap(cdp, await center(page, '#themeBtn'), hold); await settle(page);
        ok(await theme() === order[(order.indexOf(t0) + 1) % 3], `theme tap hold ${hold}ms advances exactly once`);
      }
      { const t0 = await theme(); await page.focus('#themeBtn'); await page.keyboard.press('Enter'); await settle(page); ok(await theme() === order[(order.indexOf(t0) + 1) % 3], 'keyboard Enter on a button acts once'); }
      const h1 = await center(page, 'h1');
      { const t0 = await theme(); await tapWithOther(cdp, h1, await center(page, '#themeBtn')); await settle(page); ok(await theme() === order[(order.indexOf(t0) + 1) % 3], 'theme button works with another finger down'); }
      { await tapWithOther(cdp, h1, await center(page, '#tab-table'), 600); await settle(page); ok(await page.getAttribute('#tab-table', 'aria-selected') === 'true', 'tab works with another finger down (slow)'); }
      { await tapWithOther(cdp, h1, await center(page, '#tLetters button')); await page.waitForFunction(() => document.querySelectorAll('#tLetters button.playing').length === 1, null, { timeout: 3000 }).catch(() => {});
        ok(await page.locator('#tLetters button.playing').count() === 1, 'table button works with another finger down'); }
      // 8 taps/s alternating between two tabs, then between two chips: every tap counted once
      { await tap(cdp, await center(page, '#tab-conv')); await settle(page);
        await page.evaluate(() => { window.__sel = []; new MutationObserver(m => m.forEach(r => { if (r.target.getAttribute('aria-selected') === 'true') __sel.push(r.target.id); })).observe(document.querySelector('nav.tabs'), { subtree: true, attributes: true, attributeFilter: ['aria-selected'] }); });
        const A = await center(page, '#tab-table'), B = await center(page, '#tab-conv');
        for (let i = 0; i < 24; i++) { await tap(cdp, i % 2 ? B : A, 30); await sleep(95); }
        await settle(page); const seq = await page.evaluate(() => __sel.join(','));
        ok(seq === Array.from({ length: 24 }, (_, i) => i % 2 ? 'tab-conv' : 'tab-table').join(','), 'rapid alternating tab taps: 24/24, no misses or doubles');
        await page.evaluate(() => { window.__chg = 0; ['outSound', 'outFlash'].forEach(id => document.getElementById(id).addEventListener('change', () => __chg++)); });
        const s0 = await page.evaluate(() => [outSound.checked, outFlash.checked]);
        const C1 = await center(page, 'label.chip:has(#outSound)'), C2 = await center(page, 'label.chip:has(#outFlash)');
        for (let i = 0; i < 16; i++) { await tap(cdp, i % 2 ? C2 : C1, 30); await sleep(95); }
        await settle(page);
        ok(await page.evaluate(() => __chg) === 16 && JSON.stringify(await page.evaluate(() => [outSound.checked, outFlash.checked])) === JSON.stringify(s0), 'rapid alternating chip taps: 16 changes, states back to start');
      }
      await tap(cdp, await center(page, '#tab-key')); await settle(page);
      { await tapWithOther(cdp, h1, await center(page, '#mSend')); await settle(page); ok(await page.getAttribute('#mSend', 'aria-pressed') === 'true', 'mode button works with another finger down'); }
      await tap(cdp, await center(page, '#mFree')); await settle(page);
      ok(await page.getAttribute('#mFree', 'aria-pressed') === 'true', 'mode tap (single finger)');
      // key held by finger 1, finger 2 taps 清除
      await page.evaluate(() => { __mc.kd.text = 'ABC'; document.getElementById('keyText').textContent = 'ABC'; });
      const kc = await center(page, '#key'), cl = await center(page, '#keyClear');
      await tapWithOther(cdp, kc, cl); await settle(page);
      ok(await page.textContent('#keyText') === '' || !/ABC/.test(await page.textContent('#keyText')), 'clear works while the key is held');
      // undo toast restores the cleared text
      await page.waitForFunction(() => __mc.kd.sym === '' && !__mc.kd.down, null, { timeout: 5000 });
      await page.evaluate(() => { clearTimeout(__mc.kd.wtimer); __mc.kd.text = 'HELLO'; document.getElementById('keyText').textContent = 'HELLO'; });
      await tap(cdp, cl); await settle(page);
      ok(await page.isVisible('#toast button'), 'clear shows an undo toast');
      await tap(cdp, await center(page, '#toast button')); await settle(page);
      ok(await page.textContent('#keyText') === 'HELLO', 'undo restores the cleared result');
      // conv tab: dirBtn tap once
      await tap(cdp, await center(page, '#tab-conv')); await settle(page);
      const d0 = await page.evaluate(() => __mc.S.direction);
      await tap(cdp, await center(page, '#dirBtn'), 600); await settle(page);
      ok(await page.evaluate(() => __mc.S.direction) !== d0, 'direction button: slow tap toggles once');
      await tapWithOther(cdp, h1, await center(page, '#dirBtn')); await settle(page);
      ok(await page.evaluate(() => __mc.S.direction) === d0, 'direction button works with another finger down');
      // chips toggle once per tap, also with another finger down
      for (const [hold, other] of [[40, false], [1000, false], [40, true]]) {
        const c = await center(page, 'label.chip:has(#outVibe)'); const s = await center(page, 'label.chip:has(#outSound)');
        const v0 = await page.evaluate(() => outSound.checked);
        if (other) await tapWithOther(cdp, h1, s, hold); else await tap(cdp, s, hold); await settle(page);
        ok(await page.evaluate(() => outSound.checked) === !v0, `sound chip toggles exactly once (hold ${hold}${other ? ', other finger' : ''})`);
      }
      ok(await page.evaluate(() => JSON.parse(localStorage.getItem('morse-code:v1:settings')).outputs.includes('sound') === outSound.checked), 'chip state saved');
      await ctx.close();
    }

    // ---------- 3. conversion fixes ----------
    {
      const { ctx, page, cdp } = await open();
      await page.goto(url);
      const dir = () => page.evaluate(() => __mc.S.direction);
      // swap carries the result even when it contains a real "?"
      await page.evaluate(() => { if (__mc.S.direction !== 'm2t') document.getElementById('dirBtn').click(); });
      await set(page, '--.- ..--..'); ok(await out(page) === 'Q?', 'm2t: --.- ..--.. = Q?');
      await page.click('#dirBtn');
      ok(await dir() === 't2m' && await page.inputValue('#inText') === 'Q?' && await out(page) === '−−·− ··−−··', 'swap with "?" carries Q? (no garbage)');
      await set(page, 'A.B,C? <SOS> hi'); const enc = await out(page);
      await page.click('#dirBtn'); ok(await dir() === 'm2t' && await page.inputValue('#inText') === '.- .-.-.- -... --..-- -.-. ..--.. / ...---... / .... ..', 'swap t2m->m2t carries ASCII morse');
      await page.click('#dirBtn'); ok(await dir() === 't2m' && await page.inputValue('#inText') === 'A.B,C? <SOS> HI' && await out(page) === enc, 'swap back round-trips (prosign kept)');
      // unencodable chars get a bracket marker, never "?"; swap is refused and direction kept
      await set(page, 'A中B😀');
      ok(await out(page) === '·− [中] −··· [😀]', 'unencodable chars shown as [中] not ? : ' + await out(page));
      await page.click('#dirBtn'); ok(await dir() === 't2m' && await page.inputValue('#inText') === 'A中B😀' && await page.isVisible('#toast'), 'swap with unconvertible output keeps direction and explains');
      await page.click('#dirBtn'); // still t2m
      await page.evaluate(() => document.getElementById('dirBtn').click()); // keyboard-style click: still refused
      ok(await dir() === 't2m', 'refused swap leaves direction unchanged');
      // m2t invalid sequence also refused
      await set(page, 'SOS'); await page.click('#dirBtn'); await set(page, '... ........ ---'); await page.click('#dirBtn');
      ok(await dir() === 'm2t' && await page.inputValue('#inText') === '... ........ ---', 'm2t with invalid sequence: swap refused');
      // "/" kept with the next letter (no lonely "/" at a line edge)
      const toT2m = async () => { await page.evaluate(k => localStorage.setItem(k + 'settings', JSON.stringify({ direction: 't2m' })), K); await page.reload(); };
      await toT2m();
      await set(page, 'CQ CQ DE BV2ABC '.repeat(10));
      ok(await page.evaluate(() => { const w = [...document.querySelectorAll('#outBox .wb')]; return w.length > 0 && w.every(x => getComputedStyle(x).whiteSpace === 'nowrap' && x.querySelector('.sep').textContent === '/'); }), 'word-gap "/" bound to the next letter with nowrap');
      // morse quick keys (only in m2t)
      ok(await page.isHidden('#mKeys'), 'quick keys hidden in text→morse');
      await set(page, ''); await page.click('#dirBtn'); // empty -> sample in m2t
      ok(await dir() === 'm2t' && await page.isVisible('#mKeys'), 'quick keys shown in morse→text');
      await set(page, '');
      for (const k of ['.', '.', '.', ' ', '-', '-', '-', '/', '.', '.', '.', 'bs', '-']) await tap(cdp, await center(page, `#mKeys [data-k="${k}"]`));
      await settle(page);
      ok(await page.inputValue('#inText') === '... --- / ..-' && await out(page) === 'SO U', 'quick keys type . − space / ⌫: ' + JSON.stringify(await page.inputValue('#inText')));
      for (const b of await page.locator('#mKeys button').all()) { const bb = await b.boundingBox(); if (bb.width < 44 || bb.height < 44) ok(false, 'quick key >= 44px'); }
      ok(true, 'quick keys >= 44×44');
      // long text renders without thousands of tape nodes; ticks touch only the current mark
      await toT2m();
      await set(page, 'CQ CQ DE BV2ABC PARIS TEST 73 '.repeat(70).slice(0, 2000));
      ok(await page.evaluate(() => new Promise(r => { const t = document.getElementById('inText'); for (const c of 'XYZ') { t.value = t.value.slice(0, 1990) + c; t.dispatchEvent(new Event('input')); } requestAnimationFrame(() => requestAnimationFrame(() => r(document.getElementById('outBox').lastElementChild.textContent.endsWith('−−··')))); })), 'burst of input on long text merged and the last edit rendered');
      ok(await page.evaluate(() => document.querySelectorAll('#tape *').length) <= 4, 'tape uses one path, not a node per mark');
      ok(await page.evaluate(() => document.querySelectorAll('#outBox .mc').length) === await page.evaluate(() => __mc.encode(document.getElementById('inText').value).toks.length), 'long text: one span per token');
      await ctx.close();
    }

    // ---------- 4. layout: play reachable, no shift while playing, 44px, dark tab ----------
    for (const [w, h] of [[360, 640], [390, 844]]) {
      const { ctx, page, cdp } = await open(w, h);
      await page.goto(url);
      const pb = await page.locator('#playBtn').boundingBox();
      ok(pb.y + pb.height <= h, `${w}×${h}: 播放 visible without scrolling (bottom ${Math.round(pb.y + pb.height)})`);
      const db = await page.locator('#dirBtn').boundingBox(); ok(db.height >= 44, `${w}: dirBtn height ${db.height} >= 44`);
      await tap(cdp, { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 });
      await page.waitForFunction(() => __mc.P.on && document.querySelector('#outBox .hl'), null, { timeout: 5000 });
      const sb = await page.locator('#stopBtn').boundingBox(); const pb2 = await page.locator('#playBtn').boundingBox();
      ok(Math.abs(sb.y - pb.y) < 1 && Math.abs(pb2.y - pb.y) < 1, `${w}: play/stop do not move when playback starts`);
      ok(await page.locator('#srcView .hl').count() === 1, `${w}: source highlight overlay`);
      await tap(cdp, { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 }); await settle(page);
      ok(!(await page.evaluate(() => __mc.P.on)) && !(await page.evaluate(() => __mc.P.on)), `${w}: stop tap stops (and does not restart)`);
      await ctx.close();
    }
    {
      const { ctx, page } = await open(390, 844, { colorScheme: 'dark' }); await page.goto(url);
      const lum = c => { const m = c.match(/\d+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const [sel, bar] = await page.evaluate(() => [getComputedStyle(document.querySelector('nav.tabs [aria-selected=true]')).backgroundColor, getComputedStyle(document.querySelector('nav.tabs')).backgroundColor]);
      ok(lum(sel) > lum(bar), `dark: selected tab lighter than tab bar (${sel} on ${bar})`);
      await ctx.close();
    }

    // ---------- 5. saving and bad saved data ----------
    {
      const { ctx, page, cdp } = await open(); await page.goto(url);
      await page.evaluate(() => { const t = document.getElementById('inText'); t.value = 'TYPED THEN RELOAD'; t.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.reload(); ok(await page.inputValue('#inText') === 'TYPED THEN RELOAD', 'text typed right before reload is kept (pagehide save)');
      await set(page, ''); await page.reload(); ok(await page.inputValue('#inText') === '', 'cleared input stays cleared after reload');
      // free keying result and stats survive reload
      await page.evaluate(() => { document.getElementById('tab-key').click(); }); await settle(page);
      for (const k of '...') await page.keyboard.press(k);
      await page.waitForFunction(() => document.getElementById('keyText').textContent === 'S', null, { timeout: 5000 }).catch(() => {});
      ok(await page.textContent('#keyText') === 'S', 'typed . . . with focus on a button decodes S (not E E E)');
      await page.evaluate(() => document.getElementById('mSend').click());
      await page.evaluate(() => document.getElementById('sendTarget').textContent = 'E');
      const kb0 = await page.locator('#key').boundingBox();
      ok((await page.textContent('#sendResult')).length > 0, 'send mode: result line reserved with a hint');
      await page.keyboard.press('.');
      await page.waitForFunction(() => /正確/.test(document.getElementById('sendResult').textContent), null, { timeout: 5000 }).catch(() => {});
      const kb1 = await page.locator('#key').boundingBox();
      ok(/正確/.test(await page.textContent('#sendResult')) && Math.abs(kb1.y - kb0.y) < 1, 'send mode judged and the key did not move');
      const stN = await page.textContent('#stN');
      await page.reload(); await page.evaluate(() => document.getElementById('tab-key').click());
      ok(await page.textContent('#keyText') === 'S' && await page.textContent('#stN') === stN && stN !== '0', 'free keying result and stats kept after reload');
      // leaving the key tab leaves nothing running
      await page.evaluate(() => { __mc.kd.sym = '.'; }); const kc = await center(page, '#key'); await tap(cdp, kc);
      await page.evaluate(() => document.getElementById('tab-conv').click());
      ok(await page.evaluate(() => __mc.kd.osc === null && __mc.kd.sym === ''), 'leaving the key tab stops the key tone and pending letter');
      await ctx.close();
    }
    for (const [name, data] of [
      ['outputs not array', { settings: '{"outputs":"sound","wpm":"x","direction":7}', koch: '{"perChar":null,"recent":"abc","level":"q"}' }],
      ['garbage types', { settings: '[1,2]', koch: '5', theme: '{"a":1}', lastText: '{"x":1}', keyer: '"str"' }],
      ['bad entries', { settings: '{"outputs":["sound",null,"torch"]}', koch: '{"perChar":{"K":null,"M":{"n":"3","correct":9}},"recent":[1,0,"x",5,1]}', keyer: '{"text":42,"n":-3}' }],
    ]) {
      const { ctx, page } = await open(); const e0 = errors.length;
      await page.addInitScript(([k, d]) => { if (!sessionStorage.y) { sessionStorage.y = 1; for (const [a, v] of Object.entries(d)) localStorage.setItem(k + a, v); } }, [K, data]);
      await page.goto(url); await settle(page);
      await page.evaluate(() => { document.getElementById('tab-key').click(); document.getElementById('mCopy').click(); document.getElementById('kochPlay').click(); document.getElementById('kochAns').value = 'KM'; document.getElementById('kochCheck').click(); __mc.stopPlay(); document.getElementById('tab-conv').click(); document.getElementById('playBtn').click(); __mc.stopPlay(); });
      const s = await page.evaluate(() => ({ out: Array.isArray(__mc.S.outputs), rec: __mc.kochS.recent.every(v => v === 0 || v === 1), theme: document.getElementById('themeBtn').textContent }));
      ok(errors.length === e0 && s.out && s.rec && ['自動', '淺色', '深色'].includes(s.theme), `bad saved data (${name}) falls back to defaults without errors`);
      await ctx.close();
    }

    // ---------- 6. small UI fixes ----------
    {
      const { ctx, page } = await open(); await page.goto(url);
      ok(await page.locator('#outTorch').count() === 0, 'always-disabled torch option removed');
      await page.evaluate(() => { const w = document.getElementById('wpm'); w.value = 12; w.dispatchEvent(new Event('input')); });
      ok(await page.getAttribute('#fwpm', 'max') === '12', 'effective-speed slider max follows character speed');
      ok(/Farnsworth/.test(await page.textContent('#fwNote')), 'effective speed explained');
      ok(/最近 20 個字元/.test(await page.textContent('#copyBox')), 'Koch text says characters, not answers');
      ok(/不在 ITU 標準內/.test(await page.textContent('footer')), 'footer notes non-ITU extensions');
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
      await ctx.close();
    }
    ok(errors.length === 0, 'no page/console errors or external requests: ' + errors.slice(0, 5).join(' | '));
  } catch (e) { fails.push('exception: ' + e.message); console.log('FAIL - exception: ' + e.stack); }
  await browser.close(); srv.close();
  console.log(fails.length ? `FAIL ${fails.length} of ${pass + fails.length}: ${fails.slice(0, 3).join('; ')}` : `PASS ${pass} checks`);
  process.exit(fails.length ? 1 : 0);
})();
