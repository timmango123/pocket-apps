// 對焦實驗室：上架評分 toFix 的回歸測試（node tests.js，約 30 秒）
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-lab-')), 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + SRC + '</body></html>');
const URL = 'file://' + WRAP;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [], external = [];
const OBJU = [3000, 45, 22, 15, 10, 7, 3.2, 1.6, 0.55];

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opt });
    await ctx.route(u => !u.href.startsWith('file:'), r => { external.push(r.request().url()); r.abort(); });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await ready(p); await fresh(p);
    const cdp = await ctx.newCDPSession(p);
    const touch = {
      start: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }),
      move: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }),
      end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    };
    touch.tap = async (x, y) => { await touch.start(x, y); await touch.end(); };
    return { ctx, p, touch };
  }
  const ready = p => p.waitForFunction(() => window.__focuslab && window.__focuslab.hit.length > 0 && !window.__focuslab.anim && !window.__focuslab.lowRes);
  const settle = p => p.waitForFunction(() => !window.__focuslab.anim);
  // the app saves on pagehide, so stored data is planted from a pagehide listener registered after the app's
  const plant = async (p, v) => { await p.evaluate(v => { const put = () => { if (v === null) localStorage.clear(); else localStorage.setItem('focuslab.v1', v); }; addEventListener('pagehide', put); document.addEventListener('visibilitychange', put); }, v); await p.reload(); await ready(p); };
  const fresh = p => plant(p, null);
  // page coords of a scene point (X, Y metres) on the object at index i
  const proj = (p, X, Y, i) => p.evaluate(([X, Y, u]) => { const o = window.__focuslab.optics(); const r = document.getElementById('scene').getBoundingClientRect(); const k = (o.vs / (u * 1000)) * 1000 * (r.width / o.sn.w); return { x: r.left + r.width / 2 + X * k, y: r.top + r.height * 0.45 - (Y - 1.2) * k }; }, [X, Y, OBJU[i]]);
  const center = (p, sel) => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, w: r.width, t: r.top, b: r.bottom, h: r.height }; }, sel);

  // 1. no Google Fonts / external requests
  assert(!/googleapis|gstatic|<link[^>]+https?:/i.test(SRC) && !/Barlow|IBM Plex/.test(SRC), '沒有外部字型 <link>，canvas 也不再指定網路字型');

  // 2. pixel-accurate tap picking (390x844 and 360x640, default settings)
  for (const [w, h] of [[390, 844], [360, 640]]) {
    const { ctx, p, touch } = await open(w, h);
    const cases = [['人物臉', -0.6, 1.6, 6, 6], ['人物外套', -0.6, 1.15, 6, 6], ['人物腿', -0.6, 0.5, 6, 6], ['鐘塔右半', 9.5, 8, 1, 1], ['鐘塔左半', 6.5, 8, 1, 1],
      ['燈串燈泡中', 0, 2.85, 2, 2], ['燈串燈泡右', 6.4, 3.85 - 0.9 * (1 - 0.4096) - 0.1, 2, 2], ['貓', 0.32, 1.2, 7, 7], ['花', -0.05, 1.2, 8, 8]];
    for (const [name, X, Y, i, want] of cases) {
      const pt = await proj(p, X, Y, i);
      const got = await p.evaluate(([x, y]) => { const r = document.getElementById('scene').getBoundingClientRect(); return window.__focuslab.pickAt(x - r.left, y - r.top); }, [pt.x, pt.y]);
      assert(got === want, `${w}x${h} 點${name} → 物體 ${got}（應為 ${want}）`);
    }
    // real CDP tap on the face focuses the person, not the 55 cm flower
    const face = await proj(p, -0.6, 1.6, 6);
    await touch.tap(face.x, face.y); await settle(p);
    const r = await p.evaluate(() => ({ sel: window.__focuslab.st.sel, s: window.__focuslab.optics().s, hud: document.getElementById('hudSel').textContent }));
    assert(r.sel === 6 && Math.abs(r.s - 3200) < 5 && /人物/.test(r.hud), `${w}x${h} 真實觸控點人物臉 → ${r.hud} ${(r.s / 1000).toFixed(2)} m`);
    // sky top-right → ∞
    const sc = await center(p, '#scene');
    await touch.tap(sc.l + sc.w - 12, sc.t + 10); await settle(p);
    const s2 = await p.evaluate(() => window.__focuslab.optics().s);
    assert(s2 === Infinity, `${w}x${h} 點右上天空 → ∞（得到 ${s2}）`);
    await ctx.close();
  }

  // 3. ground tap: HUD and readout describe the ground point; reload keeps it
  {
    const { ctx, p, touch } = await open(390, 844);
    const sc = await center(p, '#scene');
    await touch.tap(sc.l + sc.w * 0.04, sc.t + sc.h * 0.95); await settle(p);
    const r = await p.evaluate(() => ({ hud: document.getElementById('hudSel').textContent, sel: document.getElementById('rSel').textContent, s: window.__focuslab.optics().s, ray: document.getElementById('rayTitle').textContent }));
    const m = (r.s / 1000).toFixed(2);
    assert(r.hud === `選取：地面 ${m} m` && r.sel.startsWith('地面') && /清晰/.test(r.sel) && r.ray.startsWith('地面'), `點地面：HUD「${r.hud}」，讀數「${r.sel.slice(0, 14)}…」`);
    await p.reload(); await ready(p);
    assert((await p.textContent('#hudSel')) === r.hud, '重新整理後仍選取地面點');
    await ctx.close();
  }

  // 4. sliders: vertical swipe scrolls without changing the value; sideways drag and a tap do change it
  {
    const { ctx, p, touch } = await open(390, 844);
    await p.evaluate(() => document.getElementById('sSl').scrollIntoView({ block: 'center' }));
    let sl = await center(p, '#sSl');
    const v0 = await p.$eval('#sSl', e => +e.value), y0 = await p.evaluate(() => scrollY);
    await touch.start(sl.x - 100, sl.y); for (let i = 1; i <= 10; i++) await touch.move(sl.x - 100 + i, sl.y - i * 15); await touch.end();
    await p.waitForFunction(y => scrollY !== y, y0, { timeout: 5000 }).catch(() => {});
    const v1 = await p.$eval('#sSl', e => +e.value), y1 = await p.evaluate(() => scrollY);
    assert(v1 === v0 && y1 > y0, `從對焦滑桿往上滑：頁面捲動 ${y1 - y0}px，數值 ${v0} → ${v1}`);
    await p.evaluate(() => document.getElementById('sSl').scrollIntoView({ block: 'end' }));
    await p.waitForFunction(() => { const y = scrollY; return new Promise(r => setTimeout(() => r(scrollY === y), 100)); });
    sl = await center(p, '#sSl');
    const tx = sl.l + 5 + (sl.w - 10) * v0 / 1000;
    await touch.start(tx, sl.y); for (let i = 1; i <= 8; i++) await touch.move(tx - i * 12, sl.y + (i % 2)); await touch.end();
    const v2 = await p.$eval('#sSl', e => +e.value);
    assert(v2 < v0 - 150, `水平拖動對焦滑桿會改值：${v0} → ${v2}`);
    await touch.tap(sl.l + 5 + (sl.w - 10) * 0.9, sl.y);
    const v3 = await p.$eval('#sSl', e => +e.value);
    assert(Math.abs(v3 - 900) <= 3, `點滑桿軌道跳到該位置：${v3}`);
    // drag renders the scene at reduced resolution, then returns to full resolution
    await p.waitForFunction(() => !window.__focuslab.lowRes);
    const full = await p.evaluate(() => window.__focuslab.sceneScale), lf0 = await p.evaluate(() => window.__focuslab.lowFrames);
    await touch.start(sl.l + 50, sl.y); await touch.move(sl.l + 70, sl.y); await touch.move(sl.l + 90, sl.y); await touch.end();
    await p.waitForFunction(n => window.__focuslab.lowFrames > n, lf0, { timeout: 5000 }).catch(() => {});
    const low = (await p.evaluate(() => window.__focuslab.lowFrames)) > lf0 ? 0 : full;
    await p.waitForFunction(f => !window.__focuslab.lowRes && window.__focuslab.sceneScale === f, full, { timeout: 10000 }).catch(() => {});
    const back = await p.evaluate(() => window.__focuslab.sceneScale);
    assert(low < full && back === full, `拖動時先畫低解析度，停手後回到完整解析度（${back.toFixed(2)}）`);
    await ctx.close();
  }

  // 5. landscape 844x390: two columns, whole viewfinder on screen, pixel budget
  {
    const { ctx, p } = await open(844, 390);
    const v = await center(p, '.viewer'), c = await center(p, '.controls');
    const px = await p.evaluate(() => { const s = document.getElementById('scene'); return s.width * s.height; });
    assert(v.b <= 390 && c.l >= v.l + v.w && c.t < 390, `橫式：觀景窗完整在畫面內（底 ${Math.round(v.b)}），控制項在右欄（左 ${Math.round(c.l)}，頂 ${Math.round(c.t)}）`);
    assert(px <= 520000, `場景 canvas 裝置像素 ${px} ≤ 0.5 MP`);
    await p.evaluate(() => document.getElementById('sSl').scrollIntoView({ block: 'center' }));
    const v2 = await center(p, '#scene'), s2 = await center(p, '#sSl');
    assert(v2.t >= 0 && v2.b <= 390 && s2.t > 0 && s2.b < 390, '橫式捲到對焦滑桿時觀景窗仍完整可見');
    await ctx.close();
  }

  // 6. small portrait screens: viewfinder stays visible while the focus slider is on screen
  for (const [w, h] of [[360, 640], [390, 610], [375, 500]]) {
    const { ctx, p } = await open(w, h);
    await p.evaluate(() => document.getElementById('sSl').scrollIntoView({ block: 'end' }));
    const v = await center(p, '#scene'), s = await center(p, '#sSl'), vw = await center(p, '.viewer');
    assert(v.t >= 0 && vw.b <= s.t + 0.5 && s.b <= h + 0.5, `${w}x${h}：拖對焦滑桿時看得到整個畫面（畫面 ${Math.round(v.t)}–${Math.round(v.b)}，滑桿 ${Math.round(s.t)}）`);
    await ctx.close();
  }

  // 7. sensor change doesn't move the controls; tap targets ≥ 44; readouts not truncated; subtitle one line
  {
    const { ctx, p, touch } = await open(360, 640);
    const before = await center(p, '#fSl');
    const chip = await center(p, '.chip[data-key="m43"]');
    await touch.tap(chip.x, chip.y);
    await p.waitForFunction(() => window.__focuslab.st.sensor === 'm43' && document.querySelector('.chip[data-key="m43"]').getAttribute('aria-pressed') === 'true');
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const after = await center(p, '#fSl');
    assert(Math.abs(after.t - before.t) < 1, `換片幅後控制項不位移（${before.t.toFixed(1)} → ${after.t.toFixed(1)}）`);
    const small = await p.evaluate(() => [...document.querySelectorAll('.chip, input[type=range], .toggles label, .qbtn, .hbtn')].map(e => e.getBoundingClientRect()).filter(r => r.height < 44 || r.width < 44).length);
    assert(small === 0, `片幅鈕、滑桿、勾選標籤都 ≥ 44px（${small} 個不足）`);
    const trunc = await p.evaluate(() => ['rEq', 'rFov'].filter(id => { const e = document.getElementById(id); return e.scrollWidth > e.clientWidth + 1; }));
    const eq = await p.textContent('#rEq');
    assert(trunc.length === 0 && /×2\.00/.test(eq), `360 寬等效焦距讀數完整：${eq}`);
    const subH = await p.$eval('.ttl .sub', e => e.getBoundingClientRect().height);
    assert(subH < 22, `360 寬副標只有一行（${subH}px）`);
    await ctx.close();
  }

  // 8. distance tags: none sits on the subject; the clock-tower tag stays by the tower (360x640)
  for (const [w, h] of [[360, 640], [390, 844], [844, 390]]) {
    const { ctx, p } = await open(w, h, { colorScheme: 'dark' });
    const r = await p.evaluate(() => {
      const F = window.__focuslab, M = F.masks, sel = F.st.sel, out = { onSubject: [], tower: null, n: F.labels.length };
      const cov = (m, L) => { let on = 0, n = 0; for (let y = L.y; y < L.y + L.h; y += 3) for (let x = L.x; x < L.x + L.w; x += 3) { n++; const mx = Math.floor(x / 3), my = Math.floor(y / 3); const S = m.sat, W1 = m.mw + 1; if (mx >= 0 && my >= 0 && mx < m.mw && my < m.mh && S[(my + 1) * W1 + mx + 1] - S[my * W1 + mx + 1] - S[(my + 1) * W1 + mx] + S[my * W1 + mx] > 0) on++; } return on / n; };
      for (const L of F.labels) {
        if (L.i !== sel && cov(M[sel], L) > 0.05) out.onSubject.push(L.i);
        if (L.i === 1) { const bb = M[1].bb; out.tower = Math.max(bb.x0 - (L.x + L.w), L.x - bb.x1, bb.y0 - (L.y + L.h), L.y - bb.y1, 0) + (L.leader ? 0 : 0); out.towerLeader = L.leader; }
      }
      return out;
    });
    assert(r.n >= 6 && r.onSubject.length === 0, `${w}x${h}：${r.n} 個距離標籤，沒有壓在選取的人物上（${r.onSubject}）`);
    assert(r.tower !== null && (r.tower <= 30 || r.towerLeader), `${w}x${h}：鐘塔標籤離鐘塔 ${Math.round(r.tower)}px${r.towerLeader ? '（有引線）' : ''}`);
    await ctx.close();
  }

  // 9. saving: immediate on pagehide, animation target saved; invalid saved data falls back; reset can be undone
  {
    const { ctx, p, touch } = await open(390, 844);
    await p.click('.chip[data-key="1in"]'); await p.reload(); await ready(p);
    assert((await p.evaluate(() => window.__focuslab.st.sensor)) === '1in', '選 1 吋後立刻重新整理，片幅保留');
    await p.click('#infBtn'); await p.reload(); await ready(p);
    assert((await p.evaluate(() => window.__focuslab.optics().s)) === Infinity, '按「對焦 ∞」後動畫中重新整理，存的是 ∞');
    await p.evaluate(() => 0); await plant(p, JSON.stringify({ f: 'abc', n: 99, s: -5, sensor: 'x', sel: 50, tags: 'yes', peak: 1 }));
    let st = await p.evaluate(() => ({ ...window.__focuslab.st, hud: document.getElementById('hud').textContent, selTxt: document.getElementById('rSel').textContent }));
    assert(st.f === 50 && st.n === 24 && st.sensor === 'ff' && st.sel === 8 && st.tags === true && !/NaN|-\d/.test(st.hud + st.selTxt), `壞存檔：不合法欄位用預設值、超出範圍的夾到邊界（n→24、sel→8）：${st.hud}`);
    await p.evaluate(() => 0); await plant(p, JSON.stringify({ f: 5000, n: 24, s: 1200, sensor: 'apsc', sel: 7, tags: false, peak: true }));
    st = await p.evaluate(() => ({ ...window.__focuslab.st, selTxt: document.getElementById('rSel').textContent }));
    assert(st.f === 300 && st.n === 24 && st.sensor === 'apsc' && st.sel === 7 && st.tags === false && !/-\d/.test(st.selTxt), `超出範圍的焦距夾到 300 mm，其他合法欄位保留`);
    // old saves (no gu field) still load
    await p.evaluate(() => 0); await plant(p, JSON.stringify({ f: 85, n: 0, s: 3200, sensor: 'ff', sel: 6, tags: true, peak: false }));
    assert((await p.textContent('#hud')).startsWith('85 mm · f/1.4 · 3.20 m'), '舊格式存檔照常載入');
    await p.evaluate(() => scrollTo(0, 0));
    const rb = await center(p, '#resetBtn'); await touch.tap(rb.x, rb.y);
    await p.waitForSelector('#toast:not([hidden])');
    await p.waitForFunction(() => document.getElementById('hud').textContent.startsWith('50 mm · f/2.8'), null, { timeout: 5000 }).catch(() => {});
    assert((await p.textContent('#hud')).startsWith('50 mm · f/2.8'), '重設生效並出現「復原」提示');
    const ub = await center(p, '#undoBtn'); await touch.tap(ub.x, ub.y);
    await p.waitForFunction(() => document.getElementById('toast').hidden && window.__focuslab.st.f === 85);
    await p.reload(); await ready(p);
    assert((await p.textContent('#hud')).startsWith('85 mm · f/1.4 · 3.20 m'), '按「復原」恢復設定，重新整理後也還在');
    await ctx.close();
  }

  // 10. light theme follows the system preference; viewfinder stays dark
  {
    const { ctx, p } = await open(390, 844, { colorScheme: 'light' });
    const c = await p.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.viewer')).backgroundColor]);
    assert(c[0] === 'rgb(232, 230, 224)' && c[1] === 'rgb(8, 9, 10)', `淺色主題：頁面 ${c[0]}，觀景窗 ${c[1]}`);
    await ctx.close();
  }

  assert(errors.length === 0, '沒有 console／page error' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  assert(external.length === 0, '沒有對外網路請求' + (external.length ? '：' + external[0] : ''));
  await browser.close();
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
