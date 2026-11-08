// Regression tests for 白噪音 (noise-mixer): real CDP touch (second finger, overlapping fingers, slow taps, ghost clicks),
// slider vs. scroll, no layout shift on toggle, status text not clipped, presets (overwrite confirm, export/import),
// timer sheet close, sizes. Usage: node tests.js   (waits on conditions, no fixed timing assumptions)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + HTML + '</body></html>';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function open(w, h, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}x${h} pageerror ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console ${m.text()}`); });
    page.on('request', r => { if (!r.url().startsWith(URL) && !/^(data|blob):/.test(r.url())) errors.push('request ' + r.url()); });
    if (opts.seed) await page.addInitScript(s => { if (!sessionStorage.seeded) { localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.seeded = 1; } }, opts.seed);
    await page.goto(URL);
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const at = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tap = async (sel, hold = 40) => { const p = typeof sel === 'string' ? await at(sel) : sel; await T('touchStart', [{ ...p, id: 1 }]); await sleep(hold); await T('touchEnd', []); };
    // counts every action the app runs (synthetic clicks from the tap layer) and every native click that reaches a handler
    await page.evaluate(() => { window.__acts = []; document.addEventListener('click', e => { const b = e.target.closest && (e.target.closest('button') || (e.target.classList.contains('scrim') && e.target)); if (b) __acts.push(b.id || b.dataset.p || b.dataset.del || b.className); }, false); });
    const acts = () => page.evaluate(() => __acts.splice(0));
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
    return { ctx, page, T, at, tap, acts, settle };
  }

  // ---------- 390x844: touch ----------
  {
    const { ctx, page, T, at, tap, acts, settle } = await open(390, 844);
    const pressed = id => page.evaluate(id => document.querySelector('#tog-' + id).getAttribute('aria-pressed'), id);
    // second finger: finger 1 rests on blank space, finger 2 taps play, then a track
    const f1 = { x: 380, y: 830, id: 9 };
    await T('touchStart', [f1]); await sleep(60);
    const pp = await at('#play-btn'); await T('touchStart', [f1, { ...pp, id: 2 }]); await sleep(50); await T('touchEnd', [{ ...pp, id: 2 }]);
    await page.waitForFunction(() => __nm.playing, null, { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate(() => __nm.playing), 'second finger: play works while another finger is down');
    const tw = await at('#tog-white'); await T('touchStart', [f1, { ...tw, id: 3 }]); await sleep(50); await T('touchEnd', [{ ...tw, id: 3 }]); await settle();
    ok(await pressed('white') === 'true', 'second finger: track toggle works while another finger is down');
    await T('touchEnd', [f1]); await settle(); await acts();
    // overlapping fingers 8/s alternating fan/fire: each lands while the previous is still down
    await page.evaluate(() => { document.querySelector('#card-fan').scrollIntoView({ block: 'center' }); window.__tg = 0; new MutationObserver(ms => { for (const m of ms) if (m.target.classList && m.target.classList.contains('card')) __tg++; }).observe(document.querySelector('#grid'), { attributes: true, subtree: true, attributeFilter: ['class'] }); });
    await settle();
    const A = await at('#tog-fan'), B = await at('#tog-fire'); let cur = null;
    for (let i = 0; i < 16; i++) {
      const p = { ...(i % 2 ? B : A), id: 10 + i };
      if (!cur) { await T('touchStart', [p]); } else { await T('touchStart', [cur, p]); await sleep(50); await T('touchEnd', [cur]); }
      cur = p; await sleep(70);
    }
    await T('touchEnd', [cur]); await settle();
    const a16 = await acts();
    ok(a16.length === 16 && a16.filter(x => x === 'tog-fan').length === 8, `overlapping 2-finger taps: 16 sent, ${a16.length} acted (${a16.filter(x => x === 'tog-fan').length} fan)`);
    ok(await page.evaluate(() => __tg) === 16 && await pressed('fan') === 'false' && await pressed('fire') === 'false', 'overlapping taps: every toggle counted once, state back to off');
    // no layout shift: turning a track on keeps the card below in place
    const y0 = (await page.locator('#card-stream').boundingBox()).y;
    await tap('#tog-fan'); await settle();
    const y1 = (await page.locator('#card-stream').boundingBox()).y;
    ok(Math.abs(y1 - y0) < 1, `toggle fan on: card below stays put (${y0.toFixed(1)} -> ${y1.toFixed(1)})`);
    const fanH = (await page.locator('#card-fan').boundingBox()).height, fireH = (await page.locator('#card-fire').boundingBox()).height;
    ok(Math.abs(fanH - fireH) < 1, 'on and off cards have the same height');
    // immediately tapping the next card (where it was) hits it
    await acts(); await tap(B); await settle();
    ok(await pressed('fire') === 'true' && (await acts()).join() === 'tog-fire', 'tap on the next card right after a toggle hits that card');
    // the "more" button stays under the finger when the advanced rows open
    const m0 = (await page.locator('#more-fan').boundingBox()).y; await tap('#more-fan'); await settle();
    const m1 = (await page.locator('#more-fan').boundingBox()).y;
    ok(await page.locator('#param-fan').count() === 1 && Math.abs(m1 - m0) < 1, '音色與強度 opens the rows below without moving the button');
    const fanC = await page.locator('#card-fan').boundingBox(), fireC = await page.locator('#card-wind').boundingBox();
    ok(Math.abs(fanC.height - fireC.height) < 1 && Math.abs(fanC.y - fireC.y) < 1, 'neighbour card stretches to the expanded row (no hole)');
    await tap('#more-fan'); await settle();
    // ghost probes: slow and quick taps on controls that open/close things act exactly once and nothing reacts to the follow-up click
    for (const hold of [40, 600, 1000]) {
      await page.evaluate(() => { scrollTo(0, 0); document.querySelectorAll('.scrim').forEach(s => s.hidden = true); }); await settle(); await acts();
      await tap('#timer-btn', hold); await settle(); await sleep(150);
      const a = await acts();
      ok(a.join() === 'timer-btn' && await page.locator('#timer-sheet').isVisible(), `hold ${hold} ms on 睡眠定時: opens once and stays open (${a.join()})`);
      await tap({ x: 195, y: 60 }, hold); await settle(); await sleep(150);
      const b = await acts();
      ok(b.join() === 'timer-sheet' && !(await page.locator('#timer-sheet').isVisible()), `hold ${hold} ms on backdrop: closes once, nothing under it reacts (${b.join()})`);
      const v0 = await page.evaluate(() => __nm.playing); await tap('#play-btn', hold); await settle();
      const c = await acts(); ok(await page.evaluate(() => __nm.playing) === !v0 && c.join() === 'play-btn', `hold ${hold} ms on play: toggles once (${v0} ${c.join()})`);
    }
    // keyboard still works (click with detail 0)
    await page.focus('#theme-btn'); const th0 = await page.locator('#theme-btn').innerText(); await page.keyboard.press('Enter');
    ok(await page.locator('#theme-btn').innerText() !== th0, 'Enter on a button still works');
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    // vertical swipe starting on a volume slider scrolls the page, value unchanged; a sideways drag changes it
    await page.evaluate(() => { if (!__nm.mix().wind.on) document.querySelector('#tog-wind').click(); document.querySelector('#card-wind').scrollIntoView({ block: 'center' }); }); await settle();
    for (const fx of [0.15, 0.85]) {
      const bb = await page.locator('#vol-wind').boundingBox(); const x = bb.x + bb.width * fx, y = bb.y + bb.height / 2;
      const v0 = await page.inputValue('#vol-wind'), s0 = await page.evaluate(() => scrollY);
      await T('touchStart', [{ x, y, id: 1 }]); for (let k = 1; k <= 10; k++) { await sleep(16); await T('touchMove', [{ x: x + k * 1.5, y: y - k * 20, id: 1 }]); } await T('touchEnd', []);
      await page.waitForFunction(s0 => scrollY !== s0, s0, { timeout: 3000 }).catch(() => {});
      ok(await page.inputValue('#vol-wind') === v0 && await page.evaluate(() => scrollY) !== s0, `vertical swipe from slider at ${fx}: page scrolls, volume stays ${v0}`);
      await page.evaluate(() => document.querySelector('#card-wind').scrollIntoView({ block: 'center' })); await settle();
    }
    {
      const bb = await page.locator('#vol-wind').boundingBox(); const y = bb.y + bb.height / 2, x0 = bb.x + bb.width * 0.5;
      await T('touchStart', [{ x: x0, y, id: 1 }]); for (let k = 1; k <= 8; k++) { await sleep(16); await T('touchMove', [{ x: x0 - k * 12, y, id: 1 }]); } await T('touchEnd', []); await settle();
      const v = await page.evaluate(() => __nm.mix().wind.vol);
      ok(v < 30, `sideways drag lowers the volume (${v})`);
      ok(await page.evaluate(() => JSON.parse(localStorage.getItem('noise-mixer:v1:mix')).tracks.wind.vol) === v, 'drag result saved');
      await tap({ x: bb.x + bb.width - 14, y }); await settle();
      ok(await page.evaluate(() => __nm.mix().wind.vol) > 90, 'tap on the track jumps there');
    }
    ok(await page.locator('#vol-white').isDisabled() === false && await page.locator('#vol-ocean').isDisabled(), 'off track slider disabled, on track enabled');
    await ctx.close();
  }

  // ---------- 360x640: status text, sizes, presets, timer sheet ----------
  {
    const { ctx, page, at, tap, acts, settle } = await open(360, 640);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '360: no horizontal scroll');
    const clipped = () => page.evaluate(() => { const s = document.querySelector('#status'); return s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1; });
    ok(!(await clipped()), '360: first-run hint fully visible');
    const deckH0 = (await page.locator('.deck').boundingBox()).height;
    await tap('#play-btn'); await page.waitForFunction(() => __nm.playing);
    await tap('#timer-btn'); await settle();
    ok(await page.locator('#timer-close').isVisible() && !(await page.locator('#timer-cancel').isVisible()), 'timer sheet without a timer shows 關閉');
    await tap('#timer-start'); await settle();
    const st = await page.locator('#status').innerText();
    ok(st.includes('最後 2 分鐘淡出') && !(await clipped()), `360: timer status complete (${st})`);
    await page.evaluate(() => { for (const b of document.querySelectorAll('.tog[aria-pressed=false]')) b.click(); scrollTo(0, 0); });
    await settle();
    const st2 = await page.locator('#status').innerText();
    ok(/等 11 軌/.test(st2) && !(await clipped()), `360: all tracks on status fits (${st2})`);
    ok(Math.abs((await page.locator('.deck').boundingBox()).height - deckH0) < 1, 'deck height unchanged by status text');
    await tap('#timer-btn'); await settle();
    ok(await page.locator('#timer-cancel').isVisible() && !(await page.locator('#timer-close').isVisible()), 'timer sheet with a timer shows 取消定時 ' + await page.evaluate(() => JSON.stringify([!!__nm.timer, document.querySelector('#timer-sheet').hidden, document.querySelector('#timer-cancel').hidden])));
    await tap('#timer-cancel'); await settle();
    await tap('#timer-btn'); await settle(); await tap('#timer-close'); await settle();
    ok(!(await page.locator('#timer-sheet').isVisible()), '關閉 closes the timer sheet');
    // custom minutes with a fraction: rounded and told
    await tap('#timer-btn'); await settle(); await page.fill('#timer-custom', '1.5'); await tap('#fade-30'); await tap('#timer-start'); await settle();
    ok((await page.locator('#toast-text').innerText()).includes('取整為 2 分鐘') && await page.evaluate(() => __nm.timer && Math.round((__nm.timer.endAt - Date.now()) / 60000)) === 2, 'custom 1.5 min -> 2 min with notice');
    // save button visible without scrolling the preset row
    const sb = await page.locator('#save-preset').boundingBox();
    ok(sb.x >= 0 && sb.x + sb.width <= 360 && sb.height >= 44, 'save-preset button on screen at 360 and >= 44 px');
    // save, then same name asks before replacing, with undo
    await page.evaluate(() => { scrollTo(0, 0); }); await tap('#save-preset'); await settle();
    await page.fill('#preset-name', '睡前'); await tap('#save-ok'); await settle();
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('noise-mixer:v1:presets')).length) === 1, 'preset saved');
    await page.evaluate(() => document.querySelector('#tog-white').click()); await settle();
    await tap('#save-preset'); await settle(); await page.fill('#preset-name', '睡前'); await tap('#save-ok'); await settle();
    ok(await page.locator('#save-sheet').isVisible() && (await page.locator('#save-msg').innerText()).includes('同名') && (await page.locator('#save-ok').innerText()) === '取代', 'same name asks first (button reads 取代)');
    ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem('noise-mixer:v1:presets'))[0].tracks.white), 'nothing overwritten before confirming');
    await tap('#save-ok'); await settle();
    ok(await page.evaluate(() => !JSON.parse(localStorage.getItem('noise-mixer:v1:presets'))[0].tracks.white), 'confirm replaces');
    const ub = await page.locator('#toast-undo').boundingBox();
    ok(ub && ub.height >= 44 && ub.width >= 44, 'toast 復原 >= 44 px');
    await tap('#toast-undo'); await settle();
    ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem('noise-mixer:v1:presets'))[0].tracks.white), 'undo restores the replaced preset');
    const xb = await page.locator('#presets .x').boundingBox();
    ok(xb.width >= 44 && xb.height >= 44, 'delete × >= 44 px');
    // toast does not cover the footer buttons when scrolled to the bottom
    await page.evaluate(() => scrollTo(0, 1e6)); await page.evaluate(() => document.querySelector('#export-btn').click()); await settle();
    const tb = await page.locator('#toast').boundingBox(), ab = await page.locator('#anim-btn').boundingBox(), ib = await page.locator('#import-btn').boundingBox();
    ok(tb.y >= Math.max(ab.y + ab.height, ib.y + ib.height), 'toast sits below the footer buttons at the page bottom');
    // export -> import round trip and a bad file
    await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
    const [dl] = await Promise.all([page.waitForEvent('download'), tap('#export-btn')]);
    const file = path.join(os.tmpdir(), `nm-export-${process.pid}.json`); await dl.saveAs(file);
    const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok(exp.presets && exp.presets.length === 1 && exp.presets[0].name === '睡前', 'export writes the custom presets');
    await page.evaluate(() => { document.querySelector('[data-del="0"]').click(); }); await settle();
    ok(await page.locator('#presets .uchip').count() === 0, 'preset deleted');
    await page.setInputFiles('#import-file', file); await page.waitForFunction(() => document.querySelectorAll('#presets .uchip').length === 1, null, { timeout: 5000 }).catch(() => {});
    ok(await page.locator('#presets .uchip').count() === 1 && (await page.locator('#toast-text').innerText()).includes('已匯入 1 組'), 'import restores it');
    const file2 = file.replace('.json', '-bad.json'), file3 = file.replace('.json', '-mixed.json');
    fs.writeFileSync(file2, '{not json'); await page.setInputFiles('#import-file', file2);
    await page.waitForFunction(() => document.querySelector('#toast-text').textContent.includes('格式不正確'), null, { timeout: 5000 }).catch(() => {});
    ok((await page.locator('#toast-text').innerText()).includes('格式不正確') && await page.locator('#presets .uchip').count() === 1, 'bad file rejected, presets kept');
    fs.writeFileSync(file3, JSON.stringify({ presets: [{ name: '雨夜', tracks: { rain: { on: true } } }, { name: '<b>x', tracks: { fan: { on: true, vol: 999 } } }, { name: '', tracks: {} }] }));
    await page.setInputFiles('#import-file', file3);
    await page.waitForFunction(() => document.querySelectorAll('#presets .uchip').length === 2, null, { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('noise-mixer:v1:presets')); return p.length === 2 && p[1].name === '<b>x' && p[1].tracks.fan.vol === 100; }), 'import skips built-in names / empty entries, clamps values');
    for (const f of [file, file2, file3]) fs.unlinkSync(f);
    await ctx.close();
  }

  // ---------- old saved data still loads ----------
  {
    const seed = { 'noise-mixer:v1:mix': JSON.stringify({ tracks: { ocean: { on: true, vol: 33, tone: 1, param: .5 } }, master: 55, preset: null }), 'noise-mixer:v1:presets': JSON.stringify([{ name: '舊的', tracks: { fan: { on: true, vol: 40 } }, master: 60 }]), 'noise-mixer:v1:theme': '"dark"' };
    const { ctx, page } = await open(430, 932, { seed });
    ok(await page.evaluate(() => __nm.mix().ocean.on && __nm.mix().ocean.vol === 33 && document.querySelector('#master-vol').value === '55'), 'old mix restored');
    ok(await page.locator('#presets .chip', { hasText: '舊的' }).count() === 1 && await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'old presets and theme restored');
    await ctx.close();
  }
  for (const [w, h] of [[844, 390], [1280, 800]]) {
    const { ctx, page } = await open(w, h, w > 1000 ? { isMobile: false, hasTouch: false, deviceScaleFactor: 1 } : {});
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}x${h}: no horizontal scroll`);
    if (w > 1000) { // desktop mouse: click acts once, slider drags
      await page.click('#theme-btn'); ok(await page.locator('#theme-btn').innerText() === '淺色', 'mouse click acts once');
      const bb = await page.locator('#master-vol').boundingBox(); await page.mouse.move(bb.x + 20, bb.y + 22); await page.mouse.down(); await page.mouse.move(bb.x + bb.width - 10, bb.y + 22, { steps: 4 }); await page.mouse.up();
      ok(await page.evaluate(() => +document.querySelector('#master-vol').value) > 90, 'mouse drag on master volume');
    }
    await ctx.close();
  }
  ok(errors.length === 0, 'no page/console errors or requests: ' + errors.join(' | '));
  await browser.close(); srv.close();
  console.log(`${fail ? 'FAIL' : 'PASS'} noise-mixer: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e.stack || e)); process.exit(1); });
