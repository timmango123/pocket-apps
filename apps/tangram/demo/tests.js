// Regression tests for 剪紙七巧 (tangram), real page in mobile Chromium with CDP touch, served over http.
// Covers: a finger resting on the board / HUD title / a tray piece while another taps 提示・翻面・重置・音效・選單, 繼續 on the
// pause card, 選擇關卡 on the title, the settings switches and 解鎖全部; overlapping taps (button+button, piece+button,
// piece+piece while the first finger holds a tray piece); detail-0 click replays after a tap run nothing twice; 0.6 s / 1 s
// holds; corrupt tangram.last / progress / cur.<n> never throw or show junk while valid saves load unchanged; low landscape
// settings card and tray vs 重置; best time and 新紀錄; dragging a placed piece keeps the grab offset; a long press on a
// piece still turns it; the level-100 win animation uses the cached window-flower bitmaps and at most 60 confetti.
// Usage: node tests.js
const fs = require('fs'), path = require('path'), http = require('http');
const FILE = path.resolve(__dirname, '..', 'index.html');
let pass = 0, fail = 0, browser, server, base, tid = 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const expect = (c, msg) => { if (!c) throw new Error(msg); };
function serve() {
  return new Promise(res => {
    server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(FILE)); });
    server.listen(0, '127.0.0.1', () => { server.unref(); base = 'http://127.0.0.1:' + server.address().port + '/'; res(); });
  });
}
async function at(name, fn) {
  const t0 = Date.now(); let tm;
  try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 60 s')), 60000); })]); clearTimeout(tm); pass++; console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
  catch (e) { clearTimeout(tm); fail++; console.log('FAIL', name, '-', String(e.message || e).split('\n')[0]); }
}
async function open(vp, ls) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base); await page.waitForFunction(() => window.__game && window.__tap);
  await page.evaluate(ls => { localStorage.clear(); localStorage.setItem('tangram.seenHelp', 'true'); for (const k in ls || {}) localStorage.setItem('tangram.' + k, ls[k]); }, ls);
  await page.reload(); await page.waitForFunction(() => window.__game && window.__tap);
  await page.evaluate(() => { window.__cnt = { hint: 0, flipBtn: 0, resetLevel: 0 }; for (const k in window.__cnt) { const f = window[k]; window[k] = function () { window.__cnt[k]++; return f.apply(this, arguments); }; } });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y, hold = 50) => { const id = ++tid; await touch('touchStart', [{ x, y, id }]); await sleep(hold); await touch('touchEnd', [{ x, y, id }]); };
  const mid = async sel => { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('not visible: ' + sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  const settle = () => page.waitForFunction(() => [...document.querySelectorAll('.ov:not(.hidden), .ov:not(.hidden) .card')].every(e => e.getAnimations().every(a => a.playState !== 'running')), null, { timeout: 5000 }).catch(() => {});
  const tapSel = async (sel, hold) => { await settle(); const p = await mid(sel); await tap(p.x, p.y, hold); await sleep(120); return p; };
  const ov = () => page.evaluate(() => ['title', 'select', 'gallery', 'pause', 'win', 'help', 'settings', 'share'].filter(i => !document.getElementById(i).classList.contains('hidden')));
  const st = () => page.evaluate(() => Object.assign(window.__game.state(), { cnt: Object.assign({}, window.__cnt), sound: settings.sound, paused: !!(G && G.paused) }));
  // start level n fresh (no saved position), wait for the tray pieces to settle into their slots
  const level = async n => {
    await page.evaluate(n => { localStorage.removeItem('tangram.cur.' + n); startLevel(n); showOnly(null); }, n);
    await page.waitForFunction(() => G.pieces.every(p => Math.hypot(p.d.cx - LAY.slots[p.i].x, p.d.cy - LAY.slots[p.i].y) < 1.5), null, { timeout: 8000 });
  };
  // put piece i on the board at its solution spot (or anywhere given) without input
  const place = (i, sol) => page.evaluate(([i, sol]) => {
    const p = G.pieces[i], sp = G.sol.find(s => TYPES[s[0]] === p.t), a = xy([sp[3], sp[4], sp[5], sp[6]]);
    p.k = sp[1]; p.f = sp[2]; p.x = a[0]; p.y = a[1]; p.tray = false; if (!sol) { p.x += 0.3; p.y += 0.2; }
  }, [i, sol]);
  return { ctx, page, errors, touch, tap, mid, tapSel, ov, st, level, place, settle, close: () => ctx.close() };
}
const detail0 = (page, sel, pt) => page.evaluate(([sel, pt]) => {
  const fire = el => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: pt.x, clientY: pt.y }));
  fire(document.querySelector(sel)); fire(document.elementFromPoint(pt.x, pt.y)); fire(document.elementFromPoint(pt.ex, pt.ey));
}, [sel, pt]);
// what each in-game button changed between two snapshots
const acted = (sel, a, b, ov) => sel === '#bHint' ? b.cnt.hint === a.cnt.hint + 1 && b.hints === a.hints + 1
  : sel === '#bFlip' ? b.cnt.flipBtn === a.cnt.flipBtn + 1 : sel === '#bReset' ? b.cnt.resetLevel === a.cnt.resetLevel + 1
  : sel === '#bMute' ? b.sound === !a.sound : ov.includes('pause');

(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  await serve(); browser = await chromium.launch();
  console.log('剪紙七巧 (mobile Chromium, touch, http)');
  try {
    await at('a finger resting on the board, the HUD title or a tray piece never blocks 提示/翻面/重置/音效/選單', async () => {
      const s = await open({ width: 390, height: 844 }), bad = [];
      await s.level(5);
      const hm = await s.mid('.hmid'), st0 = await s.st(), tp = st0.pieces[0].slot;
      const rests = { board: { x: 30, y: 295 }, hud: { x: hm.x, y: hm.y }, tray: { x: tp[0], y: tp[1] } };
      for (const [rn, rp] of Object.entries(rests)) for (const sel of ['#bHint', '#bFlip', '#bReset', '#bMute', '#bMenu']) {
        await s.level(5);
        const before = await s.st(), q = await s.mid(sel), a = ++tid, b = ++tid;
        await s.touch('touchStart', [{ x: rp.x, y: rp.y, id: a }]); await sleep(200);
        await s.touch('touchStart', [{ x: rp.x, y: rp.y, id: a }, { x: q.x, y: q.y, id: b }]); await sleep(60);
        await s.touch('touchEnd', [{ x: q.x, y: q.y, id: b }]); await sleep(200);
        const after = await s.st(), o = await s.ov();
        if (!acted(sel, before, after, o)) bad.push(rn + '->' + sel);
        await s.touch('touchEnd', [{ x: rp.x, y: rp.y, id: a }]); await sleep(120);
        if (sel === '#bMute' && !(await s.st()).sound) await s.page.evaluate(() => { settings.sound = true; saveSettings(); });
      }
      // pause card 繼續 with a finger resting on the card's title
      await s.level(5); await s.tapSel('#bMenu'); await s.settle();
      const ph = await s.mid('#pause h2'), pr = await s.mid('#pResume');
      await s.touch('touchStart', [{ x: ph.x, y: ph.y, id: 1 }]); await sleep(200);
      await s.touch('touchStart', [{ x: ph.x, y: ph.y, id: 1 }, { x: pr.x, y: pr.y, id: 2 }]); await sleep(60);
      await s.touch('touchEnd', [{ x: pr.x, y: pr.y, id: 2 }]); await sleep(200);
      if ((await s.ov()).includes('pause') || (await s.st()).paused) bad.push('pause h2 -> 繼續');
      await s.touch('touchEnd', [{ x: ph.x, y: ph.y, id: 1 }]); await sleep(120);
      // title 選擇關卡 with a finger on the heading
      await s.page.evaluate(() => goTitle()); await s.settle();
      const h1 = await s.mid('.ttl h1'), ts = await s.mid('#tSelect');
      await s.touch('touchStart', [{ x: h1.x, y: h1.y, id: 3 }]); await sleep(200);
      await s.touch('touchStart', [{ x: h1.x, y: h1.y, id: 3 }, { x: ts.x, y: ts.y, id: 4 }]); await sleep(60);
      await s.touch('touchEnd', [{ x: ts.x, y: ts.y, id: 4 }]); await sleep(200);
      if (!(await s.ov()).includes('select')) bad.push('title h1 -> 選擇關卡');
      await s.touch('touchEnd', [{ x: h1.x, y: h1.y, id: 3 }]); await sleep(150);
      // 解鎖全部 with a finger on the select heading
      await s.settle();
      const sh = await s.mid('#select h2'), us = await s.mid('#unlockSw'), u0 = await s.page.evaluate(() => unlockAll);
      await s.touch('touchStart', [{ x: sh.x, y: sh.y, id: 5 }]); await sleep(200);
      await s.touch('touchStart', [{ x: sh.x, y: sh.y, id: 5 }, { x: us.x, y: us.y, id: 6 }]); await sleep(60);
      await s.touch('touchEnd', [{ x: us.x, y: us.y, id: 6 }]); await sleep(200);
      if ((await s.page.evaluate(() => unlockAll)) === u0) bad.push('select h2 -> 解鎖全部');
      await s.touch('touchEnd', [{ x: sh.x, y: sh.y, id: 5 }]); await sleep(150);
      // settings switches with a finger on the card title
      await s.page.evaluate(() => openSettings(null)); await s.settle();
      const sth = await s.mid('#settings h2');
      for (const k of ['sound', 'vib', 'lift', 'timer']) {
        const sw = await s.mid('#settings .sw[data-k="' + k + '"]'), v0 = await s.page.evaluate(k => settings[k], k);
        await s.touch('touchStart', [{ x: sth.x, y: sth.y, id: 7 }]); await sleep(200);
        await s.touch('touchStart', [{ x: sth.x, y: sth.y, id: 7 }, { x: sw.x, y: sw.y, id: 8 }]); await sleep(60);
        await s.touch('touchEnd', [{ x: sw.x, y: sw.y, id: 8 }]); await sleep(150);
        if ((await s.page.evaluate(k => settings[k], k)) === v0) bad.push('settings h2 -> ' + k);
        await s.touch('touchEnd', [{ x: sth.x, y: sth.y, id: 7 }]); await sleep(900);
      }
      expect(!bad.length, 'no effect: ' + bad.join(', ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('overlapping taps (second 50 ms later, either lifts first): button+button, piece+button, piece+piece all act', async () => {
      const s = await open({ width: 390, height: 844 }), bad = [];
      for (const [A, B] of [['#bHint', '#bFlip'], ['#bReset', '#bMute'], ['#bFlip', '#bMenu']]) for (const firstUp of ['a', 'b']) {
        await s.level(5); await s.page.evaluate(() => { settings.sound = true; });
        const before = await s.st(), qa = await s.mid(A), qb = await s.mid(B), a = ++tid, b = ++tid;
        await s.touch('touchStart', [{ x: qa.x, y: qa.y, id: a }]); await sleep(50);
        await s.touch('touchStart', [{ x: qa.x, y: qa.y, id: a }, { x: qb.x, y: qb.y, id: b }]); await sleep(60);
        if (firstUp === 'a') { await s.touch('touchEnd', [{ x: qa.x, y: qa.y, id: a }]); await sleep(40); await s.touch('touchEnd', [{ x: qb.x, y: qb.y, id: b }]); }
        else { await s.touch('touchEnd', [{ x: qb.x, y: qb.y, id: b }]); await sleep(40); await s.touch('touchEnd', [{ x: qa.x, y: qa.y, id: a }]); }
        await sleep(200);
        const after = await s.st(), o = await s.ov();
        if (!acted(A, before, after, o)) bad.push(A + ' (with ' + B + ', ' + firstUp + ' up first)');
        if (!acted(B, before, after, o)) bad.push(B + ' (with ' + A + ', ' + firstUp + ' up first)');
      }
      // piece + button
      for (const firstUp of ['a', 'b']) {
        await s.level(5); await s.page.evaluate(() => { settings.sound = true; });
        const before = await s.st(), pc = before.pieces[0].slot, qb = await s.mid('#bMute'), a = ++tid, b = ++tid;
        await s.touch('touchStart', [{ x: pc[0], y: pc[1], id: a }]); await sleep(50);
        await s.touch('touchStart', [{ x: pc[0], y: pc[1], id: a }, { x: qb.x, y: qb.y, id: b }]); await sleep(60);
        if (firstUp === 'a') { await s.touch('touchEnd', [{ x: pc[0], y: pc[1], id: a }]); await sleep(40); await s.touch('touchEnd', [{ x: qb.x, y: qb.y, id: b }]); }
        else { await s.touch('touchEnd', [{ x: qb.x, y: qb.y, id: b }]); await sleep(40); await s.touch('touchEnd', [{ x: pc[0], y: pc[1], id: a }]); }
        await sleep(200);
        const after = await s.st();
        if (after.pieces[0].k === before.pieces[0].k) bad.push('piece (with 音效, ' + firstUp + ' up first)');
        if (after.sound === before.sound) bad.push('音效 (with piece, ' + firstUp + ' up first)');
      }
      // hold tray piece 2, tap tray piece 1 (and a placed piece held while tapping a tray piece)
      for (const held of ['tray', 'board']) {
        await s.level(5); if (held === 'board') { await s.place(1, false); await sleep(500); }
        const before = await s.st(), p2 = held === 'tray' ? before.pieces[1].slot : [before.pieces[1].cx, before.pieces[1].cy], p1 = before.pieces[0].slot, a = ++tid, b = ++tid;
        await s.touch('touchStart', [{ x: p2[0], y: p2[1], id: a }]); await sleep(200);
        await s.touch('touchStart', [{ x: p2[0], y: p2[1], id: a }, { x: p1[0], y: p1[1], id: b }]); await sleep(60);
        await s.touch('touchEnd', [{ x: p1[0], y: p1[1], id: b }]); await sleep(200);
        const mid = await s.st();
        if (mid.pieces[0].k !== (before.pieces[0].k + 1) % 8) bad.push('piece 1 while holding ' + held + ' piece 2: k ' + before.pieces[0].k + '->' + mid.pieces[0].k);
        if (mid.pieces[1].k !== before.pieces[1].k) bad.push('held piece 2 turned by the second finger');
        await s.touch('touchEnd', [{ x: p2[0], y: p2[1], id: a }]); await sleep(150);
      }
      expect(!bad.length, bad.join('; ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('detail-0 click replay after a tap runs nothing twice; screen changes never fire the new control; keys still work', async () => {
      const s = await open({ width: 390, height: 844 }), bad = [];
      for (const sel of ['#bHint', '#bFlip', '#bReset', '#bMute']) {
        await s.level(5); await s.page.evaluate(() => { settings.sound = true; });
        const before = await s.st(), q = await s.mid(sel);
        await s.tap(q.x, q.y); await detail0(s.page, sel, { x: q.x, y: q.y, ex: q.b.x + 2, ey: q.b.y + 2 }); await sleep(250);
        const after = await s.st();
        const once = sel === '#bHint' ? after.hints === 1 && after.cnt.hint === 1 : sel === '#bFlip' ? after.cnt.flipBtn === 1 : sel === '#bReset' ? after.cnt.resetLevel === 1 : after.sound === !before.sound;
        if (!once) bad.push(sel + ' ran ' + JSON.stringify(after.cnt) + ' hints ' + after.hints);
      }
      // settings switch and 解鎖全部
      await s.page.evaluate(() => openSettings(null)); await s.settle();
      const sw = await s.mid('#settings .sw[data-k="vib"]'), v0 = await s.page.evaluate(() => settings.vib);
      await s.tap(sw.x, sw.y); await detail0(s.page, '#settings .sw[data-k="vib"]', { x: sw.x, y: sw.y, ex: sw.b.x + 2, ey: sw.b.y + 2 }); await sleep(200);
      if ((await s.page.evaluate(() => settings.vib)) === v0) bad.push('vib switch toggled twice');
      await s.page.evaluate(() => goSelect(5)); await s.settle();
      const us = await s.mid('#unlockSw'), u0 = await s.page.evaluate(() => unlockAll);
      await s.tap(us.x, us.y); await detail0(s.page, '#unlockSw', { x: us.x, y: us.y, ex: us.b.x + 2, ey: us.b.y + 2 }); await sleep(200);
      if ((await s.page.evaluate(() => unlockAll)) === u0) bad.push('解鎖全部 toggled twice');
      // screen-changing taps: 選單 -> pause card; 繼續 -> board; the replayed click lands on the new screen and must do nothing
      await s.level(5); const c0 = (await s.st()).cnt;
      const m = await s.mid('#bMenu'); await s.tap(m.x, m.y); await detail0(s.page, '#bMenu', { x: m.x, y: m.y, ex: m.x, ey: m.y }); await sleep(250);
      if (JSON.stringify(await s.ov()) !== '["pause"]') bad.push('選單 then replay: ' + (await s.ov()).join(','));
      await s.settle(); const r = await s.mid('#pResume'); await s.tap(r.x, r.y); await detail0(s.page, '#pResume', { x: r.x, y: r.y, ex: r.x, ey: r.y }); await sleep(250);
      const st1 = await s.st();
      if ((await s.ov()).length || st1.paused || st1.hints || JSON.stringify(st1.cnt) !== JSON.stringify(c0)) bad.push('繼續 then replay: ' + JSON.stringify({ ov: await s.ov(), paused: st1.paused, cnt: st1.cnt }));
      // a press that started before the pause card appeared does not fire the card's button
      await s.page.evaluate(() => document.getElementById('bMenu').click()); await sleep(900);
      await s.page.evaluate(() => document.getElementById('pResume').click()); await sleep(100);
      if ((await s.ov()).length) bad.push('lone detail-0 click (keyboard/script) did not act');
      const pr = await s.mid('#bMenu'); const id = ++tid;
      await s.touch('touchStart', [{ x: pr.x, y: pr.y, id }]); await sleep(30);
      await s.page.evaluate(() => { G.paused = true; showOnly('pause'); }); await sleep(60);
      await s.touch('touchEnd', [{ x: pr.x, y: pr.y, id }]); await sleep(200);
      if (!(await s.ov()).includes('pause')) bad.push('stale press fired on the new card');
      await s.page.evaluate(() => { G.paused = false; showOnly(null); });
      // keyboard: Enter on a focused button acts right after a tap
      await s.level(5); const h = await s.mid('#bHint'); await s.tap(h.x, h.y); await sleep(100);
      await s.page.focus('#bHint'); await s.page.keyboard.press('Enter'); await sleep(200);
      if ((await s.st()).hints !== 2) bad.push('Enter after a tap: hints ' + (await s.st()).hints);
      // 0.6 s and 1 s holds fire exactly once
      for (const hold of [600, 1000]) { await s.level(6); await s.tapSel('#bHint', hold); await sleep(150); const x = await s.st(); if (x.hints !== 1) bad.push('hold ' + hold + ' ms: hints ' + x.hints); }
      expect(!bad.length, bad.join('; ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('corrupt tangram.last / progress / cur.<n> never throw or show junk; valid saves load unchanged', async () => {
      const bad = [];
      for (const v of ['999', '"abc"', '-5', '1.5', '{"n":3}', 'null', '[3]']) {
        const s = await open({ width: 390, height: 844 }, { last: v });
        await s.settle(); await s.tapSel('#tPlay'); await sleep(300);
        const x = await s.st();
        if (x.n !== 1 || x.status !== 'play' || s.errors.length) bad.push('last=' + v + ': ' + (s.errors[0] || JSON.stringify({ n: x.n, st: x.status })));
        await s.close();
      }
      { // 選擇關卡 with a bad last
        const s = await open({ width: 390, height: 844 }, { last: '999' }); await s.settle(); await s.tapSel('#tSelect'); await sleep(200);
        if (!(await s.ov()).includes('select') || s.errors.length) bad.push('選擇關卡 with last=999'); await s.close();
      }
      { // junk progress entries
        const s = await open({ width: 390, height: 844 }, { progress: '{"3":{"s":"a"},"4":{"s":-1,"t":"x"},"5":{"s":9},"abc":{"s":3},"6":null,"7":{"s":2.5}}' });
        await s.page.evaluate(() => goSelect(1)); await sleep(150);
        const sum = await s.page.$eval('#selSum', e => e.textContent);
        if (!/星星 0 \/ 300/.test(sum) || !/已完成 0 \//.test(sum)) bad.push('selSum: ' + sum);
        expect(!s.errors.length, s.errors[0]); await s.close();
      }
      { // junk cur.<n> fields
        const s = await open({ width: 390, height: 844 }, { 'cur.5': '{"p":"x","h":-5,"e":"abc"}', 'cur.6': '{"h":"9","e":-40}', 'cur.7': '{"h":99,"e":1e999}' });
        for (const n of [5, 6, 7]) {
          await s.page.evaluate(n => { startLevel(n); showOnly(null); }, n); await sleep(100);
          const r = await s.page.evaluate(() => ({ h: G.hintsUsed, e: G.elapsed, badge: document.getElementById('hintN').textContent, t: performance.now() - G.t0 }));
          if (!(r.h >= 0 && r.h <= 3) || !isFinite(r.e) || r.e < 0 || !isFinite(r.t) || +r.badge > 3 || +r.badge < 0) bad.push('cur.' + n + ': ' + JSON.stringify(r));
          await s.page.evaluate(() => document.getElementById('bMenu').click()); await sleep(50);
          const info = await s.page.$eval('#pInfo', e => e.textContent);
          if (/-\d/.test(info)) bad.push('pause info ' + info);
          await s.page.evaluate(() => { G.paused = false; showOnly(null); }); await sleep(900);
        }
        expect(!s.errors.length, s.errors[0]); await s.close();
      }
      { // valid saves load as before
        const cur = { p: [['L', 3, 0, 1.5, 2.25, 0], ['L', 0, 0, 0, 0, 1], ['M', 1, 0, 0, 0, 1], ['S', 0, 0, 0, 0, 1], ['S', 0, 0, 0, 0, 1], ['Q', 0, 0, 0, 0, 1], ['P', 2, 1, 0, 0, 1]], h: 2, e: 61000 };
        const s = await open({ width: 390, height: 844 }, { last: '9', progress: '{"1":{"s":3,"nh":1,"t":42000},"2":{"s":1,"nh":0}}', 'cur.9': JSON.stringify(cur), settings: '{"sound":false,"vib":true,"lift":true,"timer":true,"theme":"dark"}', unlockAll: 'true' });
        const r = await s.page.evaluate(() => ({ p: progress, last: lastLevel(), set: settings, ua: unlockAll }));
        if (JSON.stringify(r.p) !== '{"1":{"s":3,"nh":1,"t":42000},"2":{"s":1,"nh":0}}' || r.last !== 9 || r.set.sound !== false || r.set.theme !== 'dark' || !r.ua) bad.push('valid save changed: ' + JSON.stringify(r));
        await s.settle(); await s.tapSel('#tPlay'); await sleep(200);
        const g = await s.page.evaluate(() => ({ n: G.n, h: G.hintsUsed, e: G.elapsed, p0: [G.pieces[0].k, G.pieces[0].x, G.pieces[0].y, G.pieces[0].tray], p6: [G.pieces[6].k, G.pieces[6].f] }));
        if (g.n !== 9 || g.h !== 2 || !(g.e >= 61000 && g.e < 70000) || JSON.stringify(g.p0) !== '[3,1.5,2.25,false]' || JSON.stringify(g.p6) !== '[2,1]') bad.push('valid cur.9 changed: ' + JSON.stringify(g));
        expect(!s.errors.length, s.errors[0]); await s.close();
      }
      expect(!bad.length, bad.join('; '));
    });

    await at('low landscape: settings 完成 visible without scrolling; tray slots clear of the button bar', async () => {
      const bad = [];
      for (const vp of [{ width: 640, height: 360 }, { width: 667, height: 375 }, { width: 844, height: 390 }]) {
        const s = await open(vp);
        await s.page.evaluate(() => openSettings('title')); await s.settle();
        const ok = await s.mid('#setOk'), scrolled = await s.page.$eval('#settings', e => e.scrollTop + e.querySelector('.card').scrollTop);
        if (ok.b.y + ok.b.height > vp.height - 4 || scrolled) bad.push('完成 at ' + vp.width + 'x' + vp.height + ' bottom ' + Math.round(ok.b.y + ok.b.height));
        const hit = await s.page.evaluate(() => { const e = document.elementFromPoint(...(() => { const r = document.getElementById('setOk').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()); return e && e.id; });
        if (hit !== 'setOk') bad.push('完成 centre is ' + hit);
        for (const n of [5, 99]) {
          await s.level(n);
          const cover = await s.page.evaluate(() => {
            const btns = ['bHint', 'bFlip', 'bReset'].map(id => document.getElementById(id).getBoundingClientRect()), out = [];
            LAY.slots.forEach((sl, i) => btns.forEach((r, j) => { if (sl.x + sl.w / 2 > r.left && sl.x - sl.w / 2 < r.right && sl.y + sl.h / 2 > r.top && sl.y - sl.h / 2 < r.bottom) out.push(i + ':' + j); }));
            const T = LAY.tray; btns.forEach((r, j) => { if (T.x < r.right && T.x + T.w > r.left && T.y < r.bottom && T.y + T.h > r.top) out.push('tray:' + j); });
            return out;
          });
          if (cover.length) bad.push('level ' + n + ' at ' + vp.width + 'x' + vp.height + ' covered ' + cover.join(','));
        }
        expect(!s.errors.length, s.errors[0]); await s.close();
      }
      expect(!bad.length, bad.join('; '));
    });

    await at('best time shows on the win card, level tile and pause card; 新紀錄 only when beaten', async () => {
      const s = await open({ width: 390, height: 844 }, { progress: '{"5":{"s":2,"nh":0,"t":999000}}' }), bad = [];
      const solve = async () => {
        await s.page.evaluate(() => { const used = {}; G.sol.forEach(sp => { const t = TYPES[sp[0]], q = G.pieces.find(p => p.t === t && !used[p.i]); used[q.i] = 1; q.k = sp[1]; q.f = sp[2]; const a = xy([sp[3], sp[4], sp[5], sp[6]]); q.x = a[0]; q.y = a[1]; q.tray = false; }); checkWin(); });
        await s.page.waitForFunction(() => !document.getElementById('win').classList.contains('hidden'), null, { timeout: 8000 });
        return s.page.$eval('#wBest', e => e.textContent);
      };
      await s.level(5); let t = await solve();
      if (!/新紀錄/.test(t) || !/最佳用時/.test(t) || !/16:39/.test(t)) bad.push('beaten: ' + t);
      await s.level(5); await s.page.evaluate(() => { progress[5].t = 1000; G.t0 -= 5000; }); t = await solve();
      if (/新紀錄/.test(t) || !/最佳用時 0:01/.test(t)) bad.push('not beaten: ' + t);
      await s.level(8); t = await solve();
      if (/新紀錄/.test(t) || !/首次完成/.test(t)) bad.push('first clear: ' + t);
      await s.page.evaluate(() => goSelect(5)); await sleep(100);
      if ((await s.page.$eval('#lt5 .bt', e => e.textContent)) !== '0:01') bad.push('tile best time missing');
      await s.level(5); await s.page.evaluate(() => document.getElementById('bMenu').click());
      if (!/最佳 0:01/.test(await s.page.$eval('#pInfo', e => e.textContent))) bad.push('pause card best time missing');
      expect(!bad.length, bad.join('; ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('dragging a placed piece keeps the grab offset (no 30 px jump); a tray piece still floats above the finger', async () => {
      const s = await open({ width: 390, height: 844 }), bad = [];
      await s.level(5); await s.place(0, true); await sleep(500);
      let p = (await s.st()).pieces[0];
      const gx = p.cx + 15, gy = p.cy + 10, id = ++tid; // grab off-centre
      await s.touch('touchStart', [{ x: gx, y: gy, id }]); await sleep(60);
      for (let i = 1; i <= 8; i++) { await s.touch('touchMove', [{ x: gx + i * 2.5, y: gy + i * 1.5, id }]); await sleep(30); }
      await sleep(300);
      const q = (await s.st()).pieces[0];
      if (Math.abs(q.cx - (p.cx + 20)) > 1.5 || Math.abs(q.cy - (p.cy + 12)) > 1.5) bad.push('placed piece moved by ' + (q.cx - p.cx).toFixed(1) + ',' + (q.cy - p.cy).toFixed(1) + ' for a 20,12 finger move');
      await s.touch('touchEnd', [{ x: gx + 20, y: gy + 12, id }]); await sleep(200);
      p = (await s.st()).pieces[2]; const id2 = ++tid, sx = p.slot[0], sy = p.slot[1];
      await s.touch('touchStart', [{ x: sx, y: sy, id: id2 }]); await sleep(60);
      for (let i = 1; i <= 10; i++) { await s.touch('touchMove', [{ x: sx, y: sy - i * 25, id: id2 }]); await sleep(30); }
      await sleep(400);
      const r = (await s.st()).pieces[2];
      if (Math.abs(r.cy - (sy - 250 - 30)) > 2) bad.push('tray piece lift ' + (sy - 250 - r.cy).toFixed(1));
      await s.touch('touchEnd', [{ x: sx, y: sy - 250, id: id2 }]);
      expect(!bad.length, bad.join('; ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('a long press (0.6 s, 1 s) on a piece without moving still turns it once', async () => {
      const s = await open({ width: 390, height: 844 }), bad = [];
      await s.level(5); await s.place(1, true); await sleep(400);
      for (const [i, hold] of [[0, 600], [0, 1000], [1, 600]]) {
        const b = (await s.st()).pieces[i], x = b.tray ? b.slot[0] : b.cx, y = b.tray ? b.slot[1] : b.cy;
        await s.tap(x, y, hold); await sleep(150);
        const a = (await s.st()).pieces[i];
        if (a.k !== (b.k + 1) % 8) bad.push('piece ' + i + ' hold ' + hold + ': k ' + b.k + '->' + a.k);
      }
      expect(!bad.length, bad.join('; ')); expect(!s.errors.length, s.errors[0]);
      await s.close();
    });

    await at('level-100 win animation: window flower drawn from a cached bitmap, at most 60 confetti, no errors', async () => {
      const s = await open({ width: 390, height: 844 });
      await s.level(100);
      await s.page.evaluate(() => {
        window.__wfBuilds = 0; const mk = document.createElement.bind(document);
        document.createElement = function (t) { if (t === 'canvas' && G && G.status === 'win') window.__wfBuilds++; return mk(t); };
        window.__peak = 0; const f = () => { window.__peak = Math.max(window.__peak, parts.length); if (G && G.status === 'win') requestAnimationFrame(f); };
        const used = {}; G.sol.forEach(sp => { const t = TYPES[sp[0]], q = G.pieces.find(p => p.t === t && !used[p.i]); used[q.i] = 1; q.k = sp[1]; q.f = sp[2]; const a = xy([sp[3], sp[4], sp[5], sp[6]]); q.x = a[0]; q.y = a[1]; q.tray = false; });
        checkWin(); requestAnimationFrame(f);
      });
      await s.page.waitForFunction(() => !document.getElementById('win').classList.contains('hidden'), null, { timeout: 10000 });
      const r = await s.page.evaluate(() => ({ builds: window.__wfBuilds, peak: window.__peak, wf: !!G.wf }));
      expect(r.wf && r.builds <= 2, 'window flower bitmaps built ' + r.builds + ' times');
      expect(r.peak <= 70, 'confetti peak ' + r.peak);
      expect(!s.errors.length, s.errors[0]);
      await s.close();
    });
  } finally { await browser.close(); }
  console.log(fail ? 'FAILED' : 'ALL PASSED', pass, 'passed,', fail, 'failed');
  process.exit(fail ? 1 : 0);
})();
