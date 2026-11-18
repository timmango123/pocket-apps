// 分組與抽人：上架重審 r1 toFix 的回歸測試（node tests.js，約 40–60 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent（touchEnd 只放開它列出的手指）。頁面由本機 http 伺服器提供，重新整理後 localStorage 還在。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + SRC + '</body></html>';
const K = 'team-picker:v1:';

let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = http.createServer((q, s) => {
  if (q.url.split('?')[0] !== '/app.html') { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(PAGE);
});

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ORIGIN = 'http://127.0.0.1:' + srv.address().port, APP = ORIGIN + '/app.html';
  const browser = await chromium.launch();
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, isMobile: o.mobile !== false, hasTouch: o.mobile !== false, deviceScaleFactor: 2, reducedMotion: o.reduce ? 'reduce' : 'no-preference', acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN }).catch(() => {});
    if (o.seed) await ctx.addInitScript(([K, seed]) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); for (const k in seed) localStorage.setItem(K + k, seed[k]); }, [K, o.seed]);
    const p = await ctx.newPage(); const pe = [];
    p.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); pe.push(m.text()); } }); p.on('pageerror', e => { errors.push(e.message); pe.push(e.message); });
    await p.goto(APP); await p.waitForFunction(() => window.__tp, null, { timeout: 5000 }).catch(() => {});
    const cdp = await ctx.newCDPSession(p);
    return { ctx, p, cdp, pe };
  }
  const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const box = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); await sleep(40); return p.locator(sel).first().boundingBox(); };
  async function tap(cdp, p, sel, o = {}) {
    const b = await box(p, sel), x = b.x + b.width / 2 + (o.dx || 0), y = b.y + b.height / 2 + (o.dy || 0), id = o.id || 1;
    await T(cdp, 'touchStart', [{ x, y, id }]); await sleep(o.hold || 40); await T(cdp, 'touchEnd', [{ x, y, id }]);
    return { x, y, b };
  }
  const replay = (p, sel, t) => p.evaluate(({ sel, x, y, b }) => {
    const el = document.querySelector(sel);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: b.x + 1, clientY: b.y + 1 }));
    const hit = document.elementFromPoint(x, y); hit && hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y }));
  }, { sel, ...t });
  const kv = p => p.evaluate(() => __tp.k);
  const themeI = p => p.evaluate(() => ['auto', 'light', 'dark'].indexOf(__tp.theme));
  const absentOf = (p, i) => p.evaluate(i => __tp.absent.includes(__tp.people[i].name), i);
  const waitFor = (p, fn, arg, ms = 4000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

  // ---------- 1. 觸控：pointerup 動作、按住、detail 0 重播、另一指放著、兩指重疊 ----------
  {
    const { ctx, p, cdp } = await open();
    for (const hold of [40, 600, 1000]) {
      const a = await kv(p); await tap(cdp, p, '#k-plus', { hold }); await sleep(120);
      assert(await kv(p) === a + 1, `1 點＋（按住 ${hold} ms）只加 1`); await sleep(200);
    }
    let a = await kv(p), t = await tap(cdp, p, '#k-plus'); await sleep(120); await replay(p, '#k-plus', t); await sleep(80);
    assert(await kv(p) === a + 1, '1 點＋後補送 detail 0 click（本體、邊緣、elementFromPoint）仍只加 1');
    await sleep(200);
    a = await themeI(p); t = await tap(cdp, p, '#theme-btn'); await sleep(120); await replay(p, '#theme-btn', t); await sleep(80);
    assert((await themeI(p) - a + 3) % 3 === 1, '1 點主題後補送 detail 0 click，主題只前進一格');
    await sleep(200);
    const c0 = await absentOf(p, 0); t = await tap(cdp, p, '#chips .chip[data-i="0"]'); await sleep(120); await replay(p, '#chips .chip[data-i="0"]', t); await sleep(80);
    assert(await absentOf(p, 0) === !c0, '1 點晶片後補送 detail 0 click，出席只切換一次');
    await sleep(900);
    a = await themeI(p); await p.evaluate(() => document.getElementById('theme-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    assert((await themeI(p) - a + 3) % 3 === 1, '1 單獨的 detail 0 click（鍵盤／讀屏）仍動作一次');
    await p.focus('#k-plus'); a = await kv(p); await p.keyboard.press('Enter'); await sleep(50);
    assert(await kv(p) === a + 1, '1 Enter 鍵按＋一次');
    // tab change: the new screen's control under the finger does not run
    await sleep(200); t = await tap(cdp, p, '#tab-draw'); await sleep(60);
    await p.evaluate(({ x, y }) => { const h = document.elementFromPoint(x, y); h && h.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); document.getElementById('tab-group').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, t);
    assert(await p.evaluate(() => !document.getElementById('pane-draw').hidden), '1 點「抽人」後補送 detail 0 click 不會切回分組');
    await sleep(200); await tap(cdp, p, '#tab-group'); await sleep(200);
    // resting finger on the title
    const restTap = async (sel) => {
      // the resting finger sits on the page gutter beside the control (not on any control)
      const b = await box(p, sel), q = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 8 }, rest = { x: 5, y: q.y + 30, id: 7 };
      await T(cdp, 'touchStart', [rest]); await sleep(150);
      await T(cdp, 'touchStart', [rest, q]); await sleep(60); await T(cdp, 'touchEnd', [q]); await sleep(60);
      await T(cdp, 'touchEnd', [rest]); await sleep(200);
    };
    let s0 = await absentOf(p, 1); await restTap('#chips .chip[data-i="1"]');
    assert(await absentOf(p, 1) === !s0, '1 一指放著（不在控制項上），另一指點晶片會切換出席');
    a = await kv(p); await restTap('#k-plus'); assert(await kv(p) === a + 1, '1 一指放著時點＋加 1');
    await restTap('#by-size'); assert(await p.evaluate(() => document.getElementById('by-size').getAttribute('aria-pressed')) === 'true', '1 一指放著時點「每組幾人」會切換');
    await restTap('#by-count');
    await restTap('#opt-tag'); assert(await p.evaluate(() => document.getElementById('opt-tag').checked), '1 一指放著時點「依標籤平衡」勾選一次');
    // two overlapping taps on two chips, 50 ms apart, both release orders
    for (const firstUp of [1, 2]) {
      const b1 = await box(p, '#chips .chip[data-i="2"]'), b2 = await box(p, '#chips .chip[data-i="3"]');
      const f1 = { x: b1.x + b1.width / 2, y: b1.y + b1.height / 2, id: 11 }, f2 = { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2, id: 12 };
      const s2 = await absentOf(p, 2), s3 = await absentOf(p, 3);
      await T(cdp, 'touchStart', [f1]); await sleep(50); await T(cdp, 'touchStart', [f1, f2]); await sleep(60);
      if (firstUp === 1) { await T(cdp, 'touchEnd', [f1]); await sleep(30); await T(cdp, 'touchEnd', [f2]); }
      else { await T(cdp, 'touchEnd', [f2]); await sleep(30); await T(cdp, 'touchEnd', [f1]); }
      await sleep(120);
      assert(await absentOf(p, 2) === !s2 && await absentOf(p, 3) === !s3, `1 兩指相隔 50 ms 點兩個晶片（先放開第 ${firstUp} 指）兩個都切換`);
      await sleep(200);
    }
    await ctx.close();
  }

  // ---------- 2. 清空／重置：detail 0 click 不算第二次確認；真的第二下才清；可復原 ----------
  {
    const { ctx, p, cdp } = await open({ reduce: true });
    const text0 = await p.inputValue('#roster-text');
    let t = await tap(cdp, p, '#roster-clear'); await sleep(120); await replay(p, '#roster-clear', t); await sleep(80);
    assert(await p.inputValue('#roster-text') === text0, '2 點「清空」後補送 detail 0 click 不會清掉名單');
    await sleep(500); await tap(cdp, p, '#roster-clear'); await sleep(100);
    assert(await p.inputValue('#roster-text') === '', '2 第二次真的點「確定清空？」才清空');
    assert(await p.evaluate(() => !document.getElementById('toast-act').hidden), '8 清空後出現「復原」');
    await sleep(200); await tap(cdp, p, '#toast-act'); await sleep(100);
    assert(await p.inputValue('#roster-text') === text0, '8 按「復原」名單回來');
    await sleep(200); await tap(cdp, p, '#tab-draw'); await sleep(200);
    await tap(cdp, p, '#draw-next'); await sleep(200); await tap(cdp, p, '#draw-next'); await sleep(200);
    assert(await p.evaluate(() => __tp.draw.order.length) === 2, '2 抽了 2 人');
    t = await tap(cdp, p, '#draw-reset'); await sleep(120); await replay(p, '#draw-reset', t); await sleep(80);
    assert(await p.evaluate(() => __tp.draw.order.length) === 2, '2 點「重置」後補送 detail 0 click 不會清掉抽人順序');
    await sleep(500); await tap(cdp, p, '#draw-reset'); await sleep(100);
    assert(await p.evaluate(() => __tp.draw.order.length) === 0, '2 第二次真的點才重置');
    await ctx.close();
  }

  // ---------- 3. 長按晶片：觸控 0.6／1 秒後放開，標籤面板保持開啟；下一次點晶片照常 ----------
  for (const hold of [600, 1000]) {
    const { ctx, p, cdp } = await open();
    const b = await box(p, '#chips .chip[data-i="0"]'), x = b.x + b.width / 2, y = b.y + b.height / 2;
    await T(cdp, 'touchStart', [{ x, y, id: 1 }]); await sleep(hold); await T(cdp, 'touchEnd', [{ x, y, id: 1 }]); await sleep(500);
    assert(await p.evaluate(() => !document.getElementById('tag-sheet').hidden), `3 觸控長按 ${hold} ms 放開後標籤面板仍開著`);
    assert(!(await absentOf(p, 0)), `3 長按 ${hold} ms 不會順便切換出席`);
    await tap(cdp, p, '#tag-cancel'); await sleep(200);
    await tap(cdp, p, '#chips .chip[data-i="0"]'); await sleep(100);
    assert(await absentOf(p, 0), `3 長按後下一次點晶片照常切換`);
    // the backdrop still closes the sheet from a fresh tap on it
    await sleep(200); const b2 = await box(p, '#chips .chip[data-i="1"]'), x2 = b2.x + b2.width / 2, y2 = b2.y + b2.height / 2;
    await T(cdp, 'touchStart', [{ x: x2, y: y2, id: 2 }]); await sleep(700); await T(cdp, 'touchEnd', [{ x: x2, y: y2, id: 2 }]); await sleep(900);
    assert(await p.evaluate(() => !document.getElementById('tag-sheet').hidden), `3 再次長按打開面板`);
    await T(cdp, 'touchStart', [{ x: 20, y: 30, id: 3 }]); await sleep(40); await T(cdp, 'touchEnd', [{ x: 20, y: 30, id: 3 }]); await sleep(100);
    assert(await p.evaluate(() => document.getElementById('tag-sheet').hidden), `3 之後點遮罩可以關閉面板`);
    await ctx.close();
  }
  {
    const { ctx, p } = await open({ mobile: false });
    const b = await box(p, '#chips .chip[data-i="0"]');
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await sleep(700); await p.mouse.up(); await sleep(400);
    assert(await p.evaluate(() => !document.getElementById('tag-sheet').hidden) && !(await absentOf(p, 0)), '3 滑鼠長按打開標籤面板且不切換出席');
    await ctx.close();
  }

  // ---------- 4. 壞存檔：每種型別或形狀錯誤都退回預設，0 個錯誤，app 照常可用 ----------
  {
    const bad = [
      ['current', '"x"'], ['current', '5'], ['current', 'null'], ['current', '[1]'], ['current', '{"absent":5}'], ['current', '{"text":5,"absent":[1,null],"kCount":"x","mode":7}'],
      ['result', '{}'], ['result', '{"groups":5}'], ['result', '{"groups":[[null]]}'], ['result', '"s"'], ['result', '{"groups":[[{"name":5}],"x"]}'], ['result', '{"groups":[[{"name":"a"}]],"names":5}'],
      ['rosters', '[{}]'], ['rosters', '[null]'], ['rosters', '5'], ['rosters', '[{"name":"x","people":[null,5]}]'],
      ['rules', '{"together":[5],"apart":[null]}'], ['rules', '5'], ['rules', '{"together":[["a"]],"apart":[[1,2]]}'],
      ['drawState', '5'], ['drawState', '"s"'], ['drawState', '{"order":5}'], ['drawState', '{"order":[1,null,"x"]}'],
      ['lastGroups', '5'], ['lastGroups', '[5]'], ['lastGroups', '{"a":1}'], ['theme', '5'], ['theme', '"neon"'], ['current', '{not json']
    ];
    let bads = 0, broken = []; const e0 = errors.length;
    // one page; each case: clear storage, write the bad value, reload (page served over http, so storage survives the reload)
    {
    const { ctx, p, pe } = await open({ reduce: true });
    // the page saves on pagehide, so the bad value is written by an init script at the start of the next load
    await ctx.addInitScript(K => { const s = sessionStorage.getItem('__seed'); if (!s) return; sessionStorage.removeItem('__seed'); localStorage.clear(); const seed = JSON.parse(s); for (const x in seed) localStorage.setItem(K + x, seed[x]); }, K);
    for (const [k, v] of bad) {
      const seed = { [k]: v }; if (k === 'lastGroups') seed.current = JSON.stringify({ text: '甲\n乙\n丙\n丁', absent: [], optAvoid: true });
      await p.evaluate(seed => sessionStorage.setItem('__seed', JSON.stringify(seed)), seed);
      pe.length = 0;
      await p.reload(); await p.waitForFunction(() => window.__tp, null, { timeout: 3000 }).catch(() => {});
      let ok = await p.evaluate(() => !!window.__tp);
      if (ok) {
        await p.evaluate(() => { document.getElementById('go').click(); });
        await p.evaluate(() => { document.getElementById('tab-draw').click(); });
        await p.evaluate(() => { document.getElementById('draw-next').click(); });
        await p.evaluate(() => { document.getElementById('tab-group').click(); document.getElementById('roster-manage').click(); });
        ok = await p.evaluate(() => !!__tp.result && __tp.draw.order.length >= 1 && __tp.draw.order.every(x => typeof x === 'string'));
      }
      if (!ok || pe.length) { bads++; broken.push(k + '=' + v + ' ' + pe.slice(0, 1).join()); }
    }
    await ctx.close();
    }
    errors.length = e0; // counted above per case
    assert(!bads, `4 ${bad.length} 種壞存檔都不會出錯，分組與抽人照常` + (bads ? '：' + broken.slice(0, 3).join(' | ') : ''));
    // existing keys still load unchanged
    const seed = {
      current: JSON.stringify({ text: '小明,男\n小華,女\n小美,女\n小強,男', absent: ['小美'], mode: 'size', kCount: 3, kSize: 2, optTag: true, optAvoid: false, nameTheme: 'animal', tab: 'group' }),
      result: JSON.stringify({ groups: [[{ name: '小明', tag: '男' }], [{ name: '小華', tag: '女' }]], names: ['甲隊', '乙隊'] }),
      rosters: JSON.stringify([{ id: 'abc', name: '舊名單', people: [{ name: '甲', tag: '', absent: false }] }]),
      rules: JSON.stringify({ together: [['小明', '小華']], apart: [] }), drawState: JSON.stringify({ order: ['小華'], norepeat: true }), theme: '"dark"'
    };
    const { ctx, p } = await open({ seed });
    const r = await p.evaluate(() => ({ text: document.getElementById('roster-text').value, absent: __tp.absent, k: __tp.k, size: document.getElementById('by-size').getAttribute('aria-pressed'), tag: document.getElementById('opt-tag').checked, theme: __tp.theme, names: __tp.result.names, ros: __tp.rosters.map(r => r.name + r.id), rules: __tp.rules.together.length, order: __tp.draw.order, sel: document.getElementById('name-theme').value }));
    assert(r.text.startsWith('小明,男') && r.absent.join() === '小美' && r.k === 2 && r.size === 'true' && r.tag && r.theme === 'dark' && r.names.join() === '甲隊,乙隊' && r.ros.join() === '舊名單abc' && r.rules === 1 && r.order.join() === '小華' && r.sel === 'animal', '4 舊版存的名單、設定、結果、名單、規則、抽人順序、主題照常載入');
    await ctx.close();
  }

  // ---------- 5. 同名尾碼不和真的名字撞名 ----------
  {
    const { ctx, p, cdp } = await open({ reduce: true });
    await p.fill('#roster-text', '甲\n甲(2)\n甲\n乙'); await p.evaluate(() => document.getElementById('roster-text').dispatchEvent(new Event('input'))); await sleep(250);
    const names = await p.evaluate(() => __tp.people.map(x => x.name));
    assert(new Set(names).size === 4 && names.join() === '甲,甲(2),甲(3),乙', '5 「甲／甲(2)／甲／乙」變成 4 個不同名字：' + names.join('、'));
    await tap(cdp, p, '#tab-draw'); await sleep(200);
    for (let i = 0; i < 4; i++) { await tap(cdp, p, '#draw-next'); await sleep(200); }
    const d = await p.evaluate(() => [__tp.draw.order.length, new Set(__tp.draw.order).size, document.getElementById('draw-sub').textContent]);
    assert(d[0] === 4 && d[1] === 4 && d[2].includes('全部抽完（4 人）'), '5 不重複抽人抽出 4 人才顯示全部抽完：' + d.join(' '));
    await tap(cdp, p, '#tab-group'); await sleep(200);
    await tap(cdp, p, '#chips .chip[data-i="2"]'); await sleep(100);
    assert((await p.evaluate(() => __tp.absent)).join() === '甲(3)', '5 點一個晶片只切換一個人');
    await ctx.close();
  }

  // ---------- 6. 開始分組不用捲動就看得到、點得到 ----------
  for (const [w, h] of [[360, 640], [390, 844], [430, 932], [844, 390]]) {
    const { ctx, p, cdp } = await open({ w, h, reduce: true });
    const r = await p.evaluate(() => { const b = document.getElementById('go').getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { top: b.top, bottom: b.bottom, ih: innerHeight, hit: hit && hit.id, sy: scrollY }; });
    assert(r.sy === 0 && r.top >= 0 && r.bottom <= r.ih && r.hit === 'go', `6 ${w}x${h} 第一屏就看得到「開始分組」（top ${Math.round(r.top)}）`);
    const b = await p.locator('#go').boundingBox();
    await T(cdp, 'touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }]); await sleep(40); await T(cdp, 'touchEnd', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }]); await sleep(100);
    assert(await p.evaluate(() => !!__tp.result), `6 ${w}x${h} 不捲動直接點「開始分組」就分好組`);
    await ctx.close();
  }

  // ---------- 7. 打字後 50 ms 內重新整理，最後的字還在 ----------
  {
    const { ctx, p } = await open();
    await p.click('#roster-text'); await p.keyboard.press('End'); await p.keyboard.press('Control+End'); await p.keyboard.type('\n小華');
    await sleep(30); await p.reload(); await p.waitForFunction(() => window.__tp);
    assert((await p.inputValue('#roster-text')).endsWith('小華'), '7 打字後 30 ms 內重新整理，「小華」還在');
    await ctx.close();
  }

  // ---------- 8. 復原：刪除規則、重新分組；已儲存名單上限會說明 ----------
  {
    const { ctx, p, cdp } = await open({ reduce: true });
    await p.evaluate(() => { document.getElementById('rules').open = true; });
    await tap(cdp, p, '#rule-add'); await sleep(200);
    assert(await p.evaluate(() => __tp.rules.together.length) === 1, '8 加入一條規則');
    await tap(cdp, p, '#rule-del-0'); await sleep(100);
    assert(await p.evaluate(() => __tp.rules.together.length) === 0, '8 刪除規則');
    await sleep(200); await tap(cdp, p, '#toast-act'); await sleep(100);
    assert(await p.evaluate(() => __tp.rules.together.length) === 1 && (await p.evaluate(() => JSON.parse(localStorage.getItem('team-picker:v1:rules')).together.length)) === 1, '8 按「復原」規則回來並存檔');
    await sleep(200); await tap(cdp, p, '#go'); await sleep(200);
    const first = await p.evaluate(() => JSON.stringify(__tp.result.groups));
    await tap(cdp, p, '#regroup'); await sleep(200);
    await tap(cdp, p, '#toast-act'); await sleep(100);
    assert(await p.evaluate(() => JSON.stringify(__tp.result.groups)) === first && await p.evaluate(() => localStorage.getItem('team-picker:v1:result')).then(s => JSON.stringify(JSON.parse(s).groups) === first), '8 重新分組後按「復原」回到上一次結果');
    await ctx.close();
    const many = Array.from({ length: 100 }, (_, i) => ({ id: 'r' + i, name: '名單' + i, people: [{ name: 'a', tag: '', absent: false }] }));
    const o2 = await open({ seed: { rosters: JSON.stringify(many) } });
    assert(await o2.p.evaluate(() => __tp.rosters.length) === 100, '8 100 份已儲存名單全部載入，沒有被丟掉');
    await tap(o2.cdp, o2.p, '#roster-save'); await sleep(200); await o2.p.fill('#roster-name', '新的'); await tap(o2.cdp, o2.p, '#roster-save-ok'); await sleep(100);
    const tt = await o2.p.evaluate(() => document.getElementById('toast-text').textContent);
    assert(tt.includes('上限') && await o2.p.evaluate(() => __tp.rosters.length) === 100, '8 超過上限時明確提示，不會無聲丟掉舊名單：' + tt);
    await o2.ctx.close();
  }

  // ---------- 9／10. 刪除已儲存名單（可復原）、匯出與匯入備份 ----------
  {
    const { ctx, p, cdp } = await open();
    await tap(cdp, p, '#roster-save'); await sleep(200); await p.fill('#roster-name', '三年二班'); await tap(cdp, p, '#roster-save-ok'); await sleep(200);
    await tap(cdp, p, '#roster-manage'); await sleep(200);
    const id = await p.evaluate(() => __tp.rosters[0].id);
    await tap(cdp, p, '#mdel-' + id); await sleep(100);
    assert(await p.evaluate(() => __tp.rosters.length === 0 && JSON.parse(localStorage.getItem('team-picker:v1:rosters')).length === 0), '9 已儲存名單可以刪除');
    await sleep(200); await tap(cdp, p, '#toast-act'); await sleep(100);
    assert(await p.evaluate(() => __tp.rosters.length) === 1, '9 刪除後可以復原');
    await p.evaluate(() => { document.getElementById('rules').open = true; }); await tap(cdp, p, '#manage-close'); await sleep(200);
    await tap(cdp, p, '#rule-add'); await sleep(200); await tap(cdp, p, '#go'); await sleep(200);
    await tap(cdp, p, '#roster-manage'); await sleep(200);
    const dl = p.waitForEvent('download', { timeout: 5000 });
    await tap(cdp, p, '#backup-export');
    const buf = fs.readFileSync(await (await dl).path()), file = { name: 'team-picker.json', mimeType: 'application/json', buffer: buf };
    const j = JSON.parse(buf.toString('utf8'));
    assert(j.app === 'team-picker' && j.current.text.includes('王小明') && j.rosters.length === 1 && j.rules.together.length === 1 && j.result.groups.length === 3, '10 匯出備份檔包含名單、已儲存名單、規則與結果');
    await ctx.close();
    const o2 = await open();
    await o2.p.fill('#roster-text', '別的'); await o2.p.evaluate(() => document.getElementById('roster-text').dispatchEvent(new Event('input'))); await sleep(250);
    await o2.p.setInputFiles('#backup-file', file); await sleep(300);
    const r = await o2.p.evaluate(() => ({ t: document.getElementById('roster-text').value, ros: __tp.rosters.length, rules: __tp.rules.together.length, g: __tp.result && __tp.result.groups.length }));
    assert(r.t === j.current.text && r.ros === 1 && r.rules === 1 && r.g === 3, '10 在另一個瀏覽器匯入備份，資料完整還原');
    await o2.p.reload(); await o2.p.waitForFunction(() => window.__tp);
    assert(await o2.p.evaluate(() => __tp.rosters.length === 1 && !!__tp.result), '10 匯入後重新整理仍在');
    await o2.p.setInputFiles('#backup-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"bad":1}') }); await sleep(200);
    assert((await o2.p.evaluate(() => document.getElementById('toast-text').textContent)).includes('不是'), '10 匯入錯的檔案會說明，不改資料');
    await o2.ctx.close();
  }

  // ---------- 11／12／13／14. 效能、餘數排前面、CSV 公式、組名可編輯外觀 ----------
  {
    const { ctx, p } = await open();
    const ms = await p.evaluate(() => {
      const ppl = Array.from({ length: 1000 }, (_, i) => ({ name: 'p' + i, tag: '' }));
      const last = Array.from({ length: 40 }, (_, g) => ppl.filter((_, i) => i % 40 === g).map(x => x.name));
      const t0 = performance.now(); const r = __tp.makeGroups(ppl, { K: 40, apart: [['p0', 'p1']], last }); return [performance.now() - t0, r.groups.length, r.conflicts];
    });
    assert(ms[0] < 60 && ms[1] === 40 && ms[2] === 0, `11 1000 人＋不可同組＋避開上次同組分組 ${ms[0].toFixed(1)} ms（< 60）`);
    const order = await p.evaluate(() => { let ok = 0; for (let i = 0; i < 50; i++) { const ppl = Array.from({ length: 13 }, (_, j) => ({ name: 'n' + j })); const g = __tp.makeGroups(ppl, { K: 4 }).groups.map(x => x.length); if (g[0] === 4 && g.slice(1).every(s => s === 3)) ok++; } return ok; });
    assert(order === 50, `12 13 人分 4 組，多 1 人的組 50/50 次在第 1 組`);
    const sizeOrder = await p.evaluate(() => { let ok = 0; for (let i = 0; i < 30; i++) { const ppl = Array.from({ length: 14 }, (_, j) => ({ name: 'n' + j, tag: j % 2 ? '男' : '女' })); const g = __tp.makeGroups(ppl, { K: 4, tag: true, together: [['n0', 'n1']] }).groups.map(x => x.length); if (g.every((s, k) => k === 0 || s <= g[k - 1])) ok++; } return ok; });
    assert(sizeOrder === 30, '12 有固定同組規則時也是大組在前');
    const csv = await p.evaluate(() => ['=1+1', '+886', '-5', '@a', 'a,b', '王小明'].map(__tp.csvCell));
    assert(csv.join('|') === "'=1+1|'+886|'-5|'@a|\"a,b\"|王小明", '13 CSV 以 = + - @ 開頭的名字加上單引號：' + csv.join('|'));
    await p.evaluate(() => document.getElementById('go').click()); await sleep(100);
    const st = await p.evaluate(() => { const i = document.getElementById('gname-0'); const cs = getComputedStyle(i); return [cs.borderBottomStyle, !!i.parentElement.querySelector('.pen'), i.title]; });
    assert(st[0] === 'dashed' && st[1] && st[2].includes('改'), '14 組名輸入框有虛線底線與鉛筆圖示，看得出可以改');
    const msg = await p.evaluate(() => { document.getElementById('by-size').click(); return true; });
    await p.evaluate(() => { const k = document.getElementById('k-input'); k.value = '3'; k.dispatchEvent(new Event('change')); });
    await p.fill('#roster-text', Array.from({ length: 13 }, (_, i) => '人' + i).join('\n')); await p.evaluate(() => document.getElementById('roster-text').dispatchEvent(new Event('input'))); await sleep(250);
    await sleep(900); await p.evaluate(() => document.getElementById('go').click()); await sleep(50);
    const m = await p.evaluate(() => [document.getElementById('go-msg').textContent, __tp.result.groups.map(g => g.length).join('/')]);
    assert(msg && m[1] === '4/3/3/3' && m[0].includes('前面'), '12 每組 3 人、13 人：訊息說多出的人在前面，實際第 1 組 4 人：' + m.join(' '));
    await ctx.close();
  }

  // ---------- r2-1. 提示（toast）不會蓋住任何控制項 ----------
  const toastCovers = p => p.evaluate(() => {
    const t = document.getElementById('toast'); if (t.hidden) return [];
    const tr = t.getBoundingClientRect(), sheet = [...document.querySelectorAll('.scrim')].find(x => !x.hidden);
    const pool = sheet ? sheet.querySelectorAll('button, input, select, textarea') : document.querySelectorAll('button, input:not([type=file]), select, textarea, summary, label.check, .member, #draw-order li[data-i]');
    return [...pool].filter(el => !t.contains(el)).filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height && r.left < tr.right && r.right > tr.left && r.top < tr.bottom && r.bottom > tr.top && r.bottom > 0 && r.top < innerHeight; }).map(el => el.id || el.className);
  });
  for (const [w, h] of [[360, 640], [390, 844], [430, 932], [844, 390]]) {
    const { ctx, p, cdp } = await open({ w, h, reduce: true });
    await tap(cdp, p, '#roster-save'); await sleep(200); await p.fill('#roster-name', 'A班'); await tap(cdp, p, '#roster-save-ok'); await sleep(200);
    await tap(cdp, p, '#roster-manage'); await sleep(200);
    const id = await p.evaluate(() => __tp.rosters[0].id);
    await tap(cdp, p, '#mdel-' + id); await sleep(150);
    const cov = await toastCovers(p);
    assert(!cov.length && await p.evaluate(() => !document.getElementById('toast-act').hidden), `r2-1 ${w}x${h} 刪除名單後的「復原」提示不蓋住面板按鈕` + (cov.length ? '：' + cov.join(',') : ''));
    await sleep(200); await tap(cdp, p, '#manage-close'); await sleep(150);
    assert(await p.evaluate(() => document.getElementById('manage-sheet').hidden && __tp.rosters.length === 0), `r2-1 ${w}x${h} 提示顯示中點「關閉」會關閉面板，不會變成復原`);
    // import error toast
    await sleep(200); await tap(cdp, p, '#roster-manage'); await sleep(200);
    await p.setInputFiles('#backup-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{x') }); await sleep(150);
    const cov2 = await toastCovers(p);
    assert(!cov2.length && (await p.evaluate(() => document.getElementById('toast-text').textContent)).includes('不是'), `r2-1 ${w}x${h} 匯入錯誤的提示不蓋住「匯入備份」` + (cov2.length ? '：' + cov2.join(',') : ''));
    await sleep(200); await tap(cdp, p, '#manage-close'); await sleep(200);
    // result page scrolled to the bottom, 已重新分組 + 復原
    await tap(cdp, p, '#go'); await sleep(200); await tap(cdp, p, '#regroup'); await sleep(200);
    await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await sleep(200);
    const cov3 = await toastCovers(p);
    assert(!cov3.length && await p.evaluate(() => !document.getElementById('toast').hidden), `r2-1 ${w}x${h} 結果頁捲到底時「已重新分組」提示不蓋住按鈕` + (cov3.length ? '：' + cov3.join(',') : ''));
    for (let y = 0; y < 3; y++) { await p.evaluate(y => scrollTo(0, document.documentElement.scrollHeight * y / 3), y); await sleep(120); }
    const cov4 = await toastCovers(p);
    assert(!cov4.length, `r2-1 ${w}x${h} 捲動途中提示也避開控制項` + (cov4.length ? '：' + cov4.join(',') : ''));
    await ctx.close();
  }

  // ---------- r2-2. 不可同組：有解就找到；真的無解才說「無法同時滿足」 ----------
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => {
      const P = n => Array.from({ length: n }, (_, i) => ({ name: 'p' + i, tag: i % 2 ? '男' : '女' }));
      const clique = (ids) => { const a = []; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) a.push(['p' + ids[i], 'p' + ids[j]]); return a; };
      const fails = (ppl, o, N) => { let f = 0; for (let t = 0; t < N; t++) if (__tp.makeGroups(ppl, o).conflicts) f++; return f; };
      let tri = []; for (let t = 0; t < 6; t++) tri = tri.concat(clique([3 * t, 3 * t + 1, 3 * t + 2]));
      const out = {};
      out.tri = fails(P(18), { K: 3, apart: tri }, 200);
      out.triTag = fails(P(18), { K: 3, apart: tri, tag: true }, 100);
      out.cliques = fails(P(16), { K: 4, apart: clique([0, 1, 2, 3]).concat(clique([4, 5, 6, 7])) }, 300);
      out.together = fails(P(12), { K: 3, apart: tri.slice(0, 12), together: [['p12', 'p13']] }, 100);
      const imp = __tp.makeGroups(P(12), { K: 3, apart: clique([0, 1, 2, 3]) }); out.imp = [imp.conflicts, imp.proven];
      const imp2 = __tp.makeGroups(P(6), { K: 2, apart: [['p0', 'p1']], together: [['p0', 'p1']] }); out.imp2 = [!!imp2.error || imp2.proven];
      return out;
    });
    assert(r.tri === 0 && r.triTag === 0, `r2-2 18 人 3 組、6 個三人互斥：200+100 次全部找到解（失敗 ${r.tri}/${r.triTag}）`);
    assert(r.cliques === 0, `r2-2 16 人 4 組、兩個 4 人互斥：300 次全部找到解（失敗 ${r.cliques}）`);
    assert(r.together === 0, `r2-2 有固定同組時也找到解（失敗 ${r.together}）`);
    assert(r.imp[0] > 0 && r.imp[1] === true, 'r2-2 4 人互斥分 3 組：證明無解（proven）');
    await ctx.close();
    const o2 = await open({ reduce: true, seed: { current: JSON.stringify({ text: '甲\n乙\n丙\n丁\n戊\n己', absent: [], kCount: 2 }), rules: JSON.stringify({ together: [], apart: [['甲', '乙'], ['乙', '丙'], ['甲', '丙']] }) } });
    await o2.p.evaluate(() => document.getElementById('go').click()); await sleep(100);
    assert((await o2.p.textContent('#go-msg')).includes('條件無法同時滿足'), 'r2-2 真的無解（三人互斥分 2 組）才說「無法同時滿足」');
    await o2.ctx.close();
  }

  // ---------- r2-3. 橫式不固定「開始分組」；直式固定時有分隔陰影 ----------
  {
    const { ctx, p } = await open({ w: 844, h: 390 });
    const r = await p.evaluate(() => { const g = getComputedStyle(document.getElementById('go-row')); const b = document.getElementById('go').getBoundingClientRect(); return [g.position, b.top, b.bottom, innerHeight]; });
    await p.evaluate(() => scrollTo(0, 600)); await sleep(100);
    const after = await p.evaluate(() => document.getElementById('go').getBoundingClientRect().top);
    assert(r[0] === 'static' && r[2] <= r[3] && after < 0, `r2-3 844x390 開始分組在第一屏（${Math.round(r[1])}）但不固定，捲動後不佔畫面`);
    await ctx.close();
    const o2 = await open({ w: 390, h: 844 });
    const g2 = await o2.p.evaluate(() => { const g = getComputedStyle(document.getElementById('go-row')); return [g.position, g.boxShadow]; });
    assert(g2[0] === 'sticky' && g2[1] !== 'none', 'r2-3 390x844 固定列有分隔陰影');
    await o2.ctx.close();
  }

  // ---------- r2-4. 匯入時列出被覆蓋的同名名單 ----------
  {
    const backup = { app: 'team-picker', version: 1, current: { text: '甲\n乙', absent: [] }, rosters: [{ id: 'x1', name: '三年二班', people: [{ name: '甲', tag: '', absent: false }] }, { id: 'x2', name: '新的', people: [{ name: '乙', tag: '', absent: false }] }], rules: { together: [], apart: [] }, result: null, drawState: { order: [], norepeat: true } };
    const { ctx, p } = await open({ seed: { rosters: JSON.stringify([{ id: 'old', name: '三年二班', people: [{ name: '丙', tag: '', absent: false }] }]) } });
    await p.setInputFiles('#backup-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await sleep(200);
    const t = await p.evaluate(() => document.getElementById('toast-text').textContent);
    assert(t.includes('覆蓋') && t.includes('三年二班') && !t.includes('「新的」'), 'r2-4 匯入提示列出被覆蓋的同名名單：' + t);
    await ctx.close();
  }

  // ---------- r3-1. 版面在原地改變時提示也會移開；提示本體不擋點擊（只有「復原」可點） ----------
  for (const [w, h, mobile] of [[390, 844, true], [360, 640, true], [1024, 768, false]]) {
    for (const shift of ['rules', 'save-form', 'roster-grows']) {
      const { ctx, p, cdp } = await open({ w, h, mobile, reduce: true });
      const click = sel => mobile ? tap(cdp, p, sel) : p.click(sel);
      await click('#go'); await sleep(200); await click('#go'); await sleep(300);
      if (shift === 'rules') await click('#rules-sum');
      else if (shift === 'save-form') await click('#roster-save');
      else await p.evaluate(() => { const t = document.getElementById('roster-text'); t.value += '\n' + Array.from({ length: 40 }, (_, i) => '新人' + i).join('\n'); t.dispatchEvent(new Event('input')); });
      await sleep(400);
      const vis = await p.evaluate(() => !document.getElementById('toast').hidden);
      const cov = await toastCovers(p);
      // with no clear spot left the toast goes to its fixed top spot; its body lets taps through, so only 復原 must stay clear
      const actCov = await p.evaluate(() => { const a = document.getElementById('toast-act'); if (a.hidden) return []; const tr = a.getBoundingClientRect(); return [...document.querySelectorAll('button, input:not([type=file]), select, textarea, summary, label.check, .member, .chip')].filter(el => el !== a).filter(el => { const r = el.getBoundingClientRect(); return r.width && r.left < tr.right && r.right > tr.left && r.top < tr.bottom && r.bottom > tr.top; }).map(el => el.id || el.className); });
      const top = await p.evaluate(() => document.getElementById('toast').getBoundingClientRect().top);
      assert(vis && (!cov.length || !actCov.length), `r3-1 ${w}x${h} ${shift}：版面改變後提示移開（沒有空位時至少「復原」不壓控制項，提示本體可點穿）` + (cov.length ? `：top ${Math.round(top)} 蓋 ${cov.join(',')}／復原 ${actCov.join(',')}` : ''));
      await ctx.close();
    }
  }
  {
    const { ctx, p, cdp } = await open({ reduce: true });
    await tap(cdp, p, '#go'); await sleep(200); await tap(cdp, p, '#go'); await sleep(300);
    await p.evaluate(() => scrollTo(0, 0)); await sleep(150);
    // force the toast body over ＋ (as a stale position would be) and tap through it
    const b = await box(p, '#k-plus');
    await p.evaluate(b => { const t = document.getElementById('toast'); t.style.left = (b.x - 10) + 'px'; t.style.top = (b.y - 4) + 'px'; }, b);
    const at = await p.evaluate(b => { const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return e && (e.id || e.className); }, b);
    const k0 = await kv(p);
    await T(cdp, 'touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }]); await sleep(40); await T(cdp, 'touchEnd', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }]); await sleep(100);
    assert(at === 'k-plus' && await kv(p) === k0 + 1, `r3-1 提示本體不攔點擊：蓋在＋上時點下去仍是＋（${at}）`);
    assert(await p.evaluate(() => getComputedStyle(document.getElementById('toast-act')).pointerEvents) === 'auto', 'r3-1 「復原」本身仍可點');
    await ctx.close();
  }

  // ---------- r3-2. 沒有空位時（抽人順序很長）提示固定在頂部 ----------
  {
    const names = Array.from({ length: 80 }, (_, i) => '同學' + i);
    const { ctx, p, cdp } = await open({ seed: { current: JSON.stringify({ text: names.join('\n'), absent: [], tab: 'draw' }), drawState: JSON.stringify({ order: names.slice(0, 70), norepeat: true }) } });
    await tap(cdp, p, '#draw-copy'); await sleep(150);
    await p.evaluate(() => { const li = document.querySelectorAll('#draw-order li')[30]; li.scrollIntoView({ block: 'center' }); }); await sleep(200);
    const r = await p.evaluate(() => { const t = document.getElementById('toast'); return { hidden: t.hidden, top: t.getBoundingClientRect().top }; });
    const cov = await toastCovers(p);
    assert(!r.hidden && (cov.length === 0 || r.top <= 20), `r3-2 抽人順序很長時提示在頂部固定位置（top ${Math.round(r.top)}，蓋到 ${cov.length} 個）`);
    await ctx.close();
  }

  // ---------- r3-3. 為了不可同組而放寬標籤平衡時，訊息會說明 ----------
  {
    const { ctx, p } = await open({ reduce: true, seed: { current: JSON.stringify({ text: '甲,男\n乙,男\n丙,女\n丁,女', absent: [], kCount: 2, optTag: true }), rules: JSON.stringify({ together: [], apart: [['甲', '丙'], ['甲', '丁']] }) } });
    const f = await p.evaluate(() => { let bad = 0, relaxed = 0; for (let t = 0; t < 50; t++) { const r = __tp.makeGroups([{ name: '甲', tag: '男' }, { name: '乙', tag: '男' }, { name: '丙', tag: '女' }, { name: '丁', tag: '女' }], { K: 2, tag: true, apart: [['甲', '丙'], ['甲', '丁']] }); if (r.conflicts) bad++; if (r.tagRelaxed) relaxed++; } return [bad, relaxed]; });
    assert(f[0] === 0 && f[1] === 50, `r3-3 標籤平衡與不可同組衝突時仍找到解並標示放寬（${f.join('/')}）`);
    await p.evaluate(() => document.getElementById('go').click()); await sleep(100);
    const m = await p.textContent('#go-msg');
    assert(m.includes('標籤平衡已放寬'), 'r3-3 結果訊息說明標籤平衡已放寬：' + m);
    const plain = await p.evaluate(() => __tp.makeGroups([{ name: '甲', tag: '男' }, { name: '乙', tag: '男' }, { name: '丙', tag: '女' }, { name: '丁', tag: '女' }], { K: 2, tag: true, apart: [['甲', '乙']] }).tagRelaxed);
    assert(plain === false, 'r3-3 標籤平衡沒被放寬時不會多說');
    await ctx.close();
  }

  await browser.close(); srv.close();
  assert(!errors.length, '沒有頁面錯誤' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); srv.close(); process.exit(1); });
