// 雨窗：上架複審 R1 修正的回歸測試（node tests.js，約 60 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http。
// 1) 點按後的 detail 0 click 不重複（按鈕本身、邊緣點、elementFromPoint）；單獨的 detail 0 click 與鍵盤照樣執行一次
// 2) 一指在玻璃上按著或正在寫字時，第二指點按鈕照樣執行一次，寫字也繼續；從玻璃開始的手指不會觸發按鈕
// 3) 按鈕外 1 px 的邊緣點按執行一次；按住 0.6 / 1 秒各執行一次
// 4) 沒有外部網路請求；沒有點過雨聲前不建立 AudioContext
// 5) 窗景切換並保存、今日一字臨摹完成得星並保存、存圖下載 PNG
// 6) WebGL context 遺失後復原；擦玻璃有聲音；霧格 ≤ 3 px；旋轉不拉伸；滑桿 ≥ 44 px；起霧有可見回饋；快速畫圈是曲線
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
let fails = 0;
const T0 = Date.now();
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (process.env.TIMING ? ` [${((Date.now() - T0) / 1000).toFixed(1)}s]` : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [], external = [];

// same skeleton the site build and lobby put around each app (viewport meta, charset)
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const wrap = h => /^\s*<!doctype/i.test(h) ? h : SKELETON + h + '</body></html>';
function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(wrap(fs.readFileSync(APP, 'utf8'))); });
  srv.unref();
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const html = fs.readFileSync(APP, 'utf8');
  assert(!/fonts\.googleapis|fonts\.gstatic|<link[^>]+https?:|<script[^>]+src=/i.test(html) && !/Noto Serif TC"|Noto Sans TC"/.test(html), '沒有 Google Fonts 或任何外部資源，只用系統字型');

  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, storage = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, acceptDownloads: true });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(URL) || u.startsWith('blob:') || u.startsWith('data:')) return r.continue(); external.push(u); return r.abort(); });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(s => {
      if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); }
      window.__acMade = 0; const AC = window.AudioContext;
      if (AC) { const W = function (...a) { window.__acMade++; return new AC(...a); }; W.prototype = AC.prototype; window.AudioContext = W; }
    }, storage);
    await p.goto(URL); await p.waitForFunction(() => window.__rainglass && window.__rainglass.frames > 2);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id || 0 })) });
    const touch = async (x, y, hold = 40) => { await T('touchStart', [[x, y]]); await sleep(hold); await T('touchEnd', [[x, y]]); };
    const box = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
    const S = () => p.evaluate(() => { const g = window.__rainglass; return { c: g.counts, sound: g.sound, scene: g.scene, trace: g.trace }; });
    const waitCount = (k, n) => p.waitForFunction(([k, n]) => window.__rainglass.counts[k] >= n, [k, n], { timeout: 5000 }).catch(() => {});
    return { ctx, p, cdp, T, touch, box, S, waitCount };
  }

  const t = await open();
  const { p, T, touch, box, S } = t;
  await p.evaluate(() => { document.getElementById('rng').value = '0'; document.getElementById('rng').dispatchEvent(new Event('input')); });
  assert(await p.evaluate(() => window.__acMade) === 0, '開頁後還沒有 AudioContext（等使用者點雨聲）');

  // 1. detail 0 click after a tap
  {
    const b = await box('#bSound');
    for (const delay of [0, 50, 300]) {
      const c0 = (await S()).c.sound;
      await touch(b.cx, b.cy);
      await sleep(delay);
      await p.evaluate(([x, y]) => {
        const el = document.getElementById('bSound'), click = n => n && n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
        click(el); click(document.elementFromPoint(x, y)); click(document.elementFromPoint(x, el.getBoundingClientRect().top + 0.5));
      }, [b.cx, b.cy]);
      await sleep(80);
      assert((await S()).c.sound - c0 === 1, `雨聲：點按後 ${delay} ms 再送 detail 0 click（按鈕、點按位置、邊緣）只切換一次`);
    }
    assert(await p.evaluate(() => window.__acMade) === 1, '點雨聲後才建立一個 AudioContext');
    const f = await box('#bFog'), c0 = (await S()).c.fog;
    await touch(f.cx, f.cy); await sleep(30);
    await p.evaluate(() => document.getElementById('bFog').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await sleep(60);
    assert((await S()).c.fog - c0 === 1, '起霧：點按後的 detail 0 click 不重複');
    await sleep(900);
    const c1 = (await S()).c.fog;
    await p.evaluate(() => document.getElementById('bFog').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    assert((await S()).c.fog - c1 === 1, '沒有點按時單獨的 detail 0 click 執行一次');
    await p.focus('#bFog'); await p.keyboard.press('Enter'); await sleep(50);
    assert((await S()).c.fog - c1 === 2, '鍵盤 Enter 執行一次');
    await sleep(850);
  }

  // 2. second finger while one rests / draws
  {
    const s = await box('#bSound'), f = await box('#bFog');
    for (const rest of [[200, 300, 1], [200, 40, 1], [s.cx, s.cy, 1]]) {
      const c0 = (await S()).c.fog;
      await T('touchStart', [rest]); await sleep(60);
      await T('touchStart', [rest, [f.cx, f.cy, 2]]); await sleep(50);
      await T('touchEnd', [[f.cx, f.cy, 2]]); await sleep(60);
      await T('touchEnd', [rest]); await sleep(60);
      const c = (await S()).c;
      assert(c.fog - c0 === 1, `一指按在 (${Math.round(rest[0])},${Math.round(rest[1])}) 時第二指點起霧執行一次`);
    }
    await sleep(850);
    // finger 1 keeps writing while finger 2 taps 雨聲
    const c0 = (await S()).c.sound;
    await T('touchStart', [[80, 250, 1]]); await sleep(30);
    for (let i = 1; i <= 6; i++) { await T('touchMove', [[80 + i * 30, 250, 1]]); await sleep(16); }
    await T('touchMove', [[260, 250, 1], [s.cx, s.cy, 2]]); await sleep(40);
    await T('touchEnd', [[s.cx, s.cy, 2]]); await sleep(20);
    for (let i = 1; i <= 4; i++) { await T('touchMove', [[260, 250 + i * 30, 1]]); await sleep(16); }
    await T('touchEnd', [[260, 370, 1]]); await sleep(60);
    assert((await S()).c.sound - c0 === 1, '一指正在寫字時第二指點雨聲執行一次');
    assert(await p.evaluate(() => window.__rainglass.clearAt(260, 340)) > 0.5, '那一指的筆畫在點按後仍繼續擦開霧');
    // two fingers draw at once, then three
    await T('touchStart', [[60, 450, 1], [300, 450, 2]]); await sleep(30);
    for (let i = 1; i <= 4; i++) { await T('touchMove', [[60, 450 + i * 25, 1], [300, 450 + i * 25, 2]]); await sleep(16); }
    await T('touchStart', [[60, 550, 1], [300, 550, 2], [180, 600, 3]]); await sleep(20);
    await T('touchMove', [[60, 560, 1], [300, 560, 2], [180, 640, 3]]); await sleep(20);
    await T('touchEnd', [[60, 560, 1], [300, 560, 2], [180, 640, 3]]); await sleep(60);
    const ok3 = await p.evaluate(() => { const g = window.__rainglass; return [g.clearAt(60, 520), g.clearAt(300, 520), g.clearAt(180, 625), g.clearAt(180, 500)]; });
    assert(ok3[0] > 0.5 && ok3[1] > 0.5 && ok3[2] > 0.5 && ok3[3] < 0.5, '兩指、三指同時寫各自成線，中間不連線');
    // a finger that starts on the glass and slides onto a button never fires it
    await sleep(850);
    const before = (await S()).c;
    await T('touchStart', [[f.cx, f.cy - 120]]); for (let i = 1; i <= 6; i++) { await T('touchMove', [[f.cx, f.cy - 120 + i * 20]]); await sleep(16); }
    await T('touchEnd', [[f.cx, f.cy]]); await sleep(80);
    const after = (await S()).c;
    assert(after.fog === before.fog && after.sound === before.sound, '從玻璃開始畫、滑到起霧上放開不會觸發按鈕');
  }

  // 3. edge taps 1 px outside, holds
  {
    const s = await box('#bSound'), f = await box('#bFog'), v = await box('#bScene');
    const pts = [['bSound 上緣外', 'sound', s.cx, s.y - 1], ['bFog 左緣外', 'fog', f.x - 1, f.cy], ['bFog 上緣外', 'fog', f.cx, f.y - 1], ['bSound 下緣外', 'sound', s.cx, s.b + 1], ['窗景 左緣外', 'scene', v.x - 1, v.cy]];
    for (const [name, k, x, y] of pts) {
      const c0 = (await S()).c[k];
      await touch(x, y); await sleep(70);
      assert((await S()).c[k] - c0 === 1, `${name} 1 px 點按執行一次`);
      await sleep(820);
    }
    for (const hold of [600, 1000]) {
      const c0 = (await S()).c.fog;
      await touch(f.cx, f.cy, hold); await sleep(60);
      assert((await S()).c.fog - c0 === 1, `按住起霧 ${hold / 1000} 秒執行一次`);
      await sleep(820);
    }
    // eight taps per second alternating
    const c0 = (await S()).c;
    for (let i = 0; i < 8; i++) { const b = i % 2 ? f : s; await touch(b.cx, b.cy, 30); await sleep(95); }
    await sleep(100);
    const c1 = (await S()).c;
    assert(c1.sound - c0.sound === 4 && c1.fog - c0.fog === 4, '每秒 8 次交替點雨聲、起霧：各 4 次，不漏不重複');
    await sleep(850);
  }

  // 4. 起霧 feedback on untouched glass, slider height, fog cell
  {
    const f = await box('#bFog');
    await touch(f.cx, f.cy); await sleep(60);
    const st = await p.evaluate(() => ({ mist: window.__rainglass.mist, toast: getComputedStyle(document.getElementById('toast')).opacity, text: document.getElementById('toast').textContent }));
    assert(st.mist > 0.3 && +st.toast > 0.5 && /起霧/.test(st.text), '按起霧時玻璃明顯變濃並提示「玻璃又起霧了」');
    assert((await box('#rng')).h >= 44, '雨勢滑桿觸控高度 ≥ 44 px');
    assert(await p.evaluate(() => window.__rainglass.cell) <= 3, '霧格 ≤ 3 px（著色器再做平滑取樣）');
    await sleep(1400);
  }

  // 5. wipe sound while sound is on
  {
    if (!(await S()).sound) { const s = await box('#bSound'); await touch(s.cx, s.cy); await sleep(850); }
    await p.waitForFunction(() => window.__rainglass.sound && window.__rainglass.audio === 'running', null, { timeout: 3000 }).catch(() => {});
    await p.evaluate(() => window.__rainglass.takeWipePeak());
    await T('touchStart', [[60, 200]]);
    for (let i = 1; i <= 12; i++) { await T('touchMove', [[60 + i * 22, 200 + (i % 2) * 20]]); await sleep(16); }
    await sleep(60);
    const peak = await p.evaluate(() => window.__rainglass.takeWipePeak());
    await T('touchEnd', [[324, 200]]);
    assert(peak > 0.05, `擦玻璃時有擦拭聲（音量目標 ${peak.toFixed(2)}）`);
    await p.waitForFunction(() => window.__rainglass.wipeTarget === 0, null, { timeout: 3000 }).catch(() => {});
    assert(await p.evaluate(() => window.__rainglass.wipeTarget) === 0, '手指停下擦拭聲就停');
    const s = await box('#bSound'); await touch(s.cx, s.cy); await sleep(1300);
    assert(await p.evaluate(() => window.__rainglass.audio) === 'suspended', '關掉雨聲後 AudioContext 會暫停');
    await sleep(100);
  }

  // 6. fast circle is a smooth curve, not a polygon
  {
    await p.evaluate(() => window.__rainglass.logPath(true));
    const cx = 195, cy = 420, R = 110, N = 10;
    const pt = i => [cx + R * Math.cos(i / N * Math.PI * 2), cy + R * Math.sin(i / N * Math.PI * 2)];
    await T('touchStart', [pt(0)]);
    for (let i = 1; i <= N; i++) { await T('touchMove', [pt(i)]); await sleep(16); }
    await T('touchEnd', [pt(N)]); await sleep(50);
    const path = await p.evaluate(() => window.__rainglass.logPath(false));
    // ignore the first and last sample gap (a stroke's ends have only one neighbour)
    const mid = path.filter(([x, y]) => { const a = (Math.atan2(y - cy, x - cx) + Math.PI * 2) % (Math.PI * 2); return a > Math.PI * 2 / N && a < Math.PI * 2 * (N - 1) / N; });
    const dev = Math.max(...mid.map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - R)));
    assert(mid.length > N * 2 && dev < R * (1 - Math.cos(Math.PI / N)) * 0.5, `快速畫圈（每圈 ${N} 個取樣）用曲線連接：離圓最大 ${dev.toFixed(1)} px（直線會差 ${(R * (1 - Math.cos(Math.PI / N))).toFixed(1)} px）`);
  }

  // 7. scene change is saved
  {
    const s0 = (await S()).scene, v = await box('#bScene');
    await touch(v.cx, v.cy); await sleep(100);
    const s1 = (await S()).scene;
    assert(s1 !== s0 && await p.evaluate(() => localStorage.getItem('rainglass:scene')) === s1 && /霧・玻璃/.test(await p.textContent('#sub')), `窗景會換（${s0} → ${s1}）並保存`);
    await sleep(850);
    const seen = new Set([s0, s1]);
    for (let i = 0; i < 3; i++) { await touch(v.cx, v.cy); await sleep(850); seen.add((await S()).scene); }
    assert(seen.size === 4 && (await S()).scene === s0, '四種窗景（夜、黃昏、清晨、雷雨）輪流出現');
  }

  // 8. daily trace: follow the guide with real touches → stars, saved
  {
    const b = await box('#bTrace');
    await touch(b.cx, b.cy); await sleep(150);
    const st = (await S()).trace;
    assert(st.on && st.ch && await p.isVisible('#goal'), `臨摹開始：今日一字「${st.ch}」，上方顯示提示`);
    const runs = await p.evaluate(() => window.__rainglass.guideRuns(20));
    for (const [x0, x1, y] of runs) {
      const a = x0 + 6, z = Math.max(a + 1, x1 - 6);
      await T('touchStart', [[a, y]]);
      for (let x = a + 40; x < z; x += 40) await T('touchMove', [[x, y]]);
      await T('touchMove', [[z, y]]); await T('touchEnd', [[z, y]]);
    }
    await p.waitForFunction(() => !window.__rainglass.trace.on, null, { timeout: 8000 }).catch(() => {});
    const done = (await S()).trace;
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('rainglass:trace') || '{}'));
    const n = Object.values(saved)[0];
    assert(!done.on && n >= 1 && /寫好了/.test(await p.textContent('#goal')), `沿著字痕寫完得 ${n} 星（覆蓋 ${(done.cov * 100).toFixed(0)}%、多擦 ${done.spill.toFixed(2)}），紀錄保存`);
    await sleep(850);
    await touch(b.cx, b.cy); await sleep(100);
    const t2 = (await S()).trace;
    await touch(b.cx, b.cy); await sleep(100);
    assert(t2.on && !(await S()).trace.on, '再按一次臨摹可以收起字帖');
    await sleep(850);
  }

  // 9. save picture
  {
    const b = await box('#bSave');
    const dl = t.p.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await touch(b.cx, b.cy);
    const d = await dl;
    let size = 0;
    if (d) { const fp = await d.path(); size = fp ? fs.statSync(fp).size : 0; }
    assert(d && /\.png$/.test(d.suggestedFilename()) && size > 5000, `存圖下載 PNG（${d ? d.suggestedFilename() : '沒有下載'}，${size} bytes）`);
    await sleep(850);
  }

  // 10. WebGL context loss and restore
  if (await p.evaluate(() => window.__rainglass.gl)) {
    await p.evaluate(() => { window.__lc = document.getElementById('view').getContext('webgl').getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
    await p.waitForFunction(() => !window.__rainglass.gl, null, { timeout: 3000 }).catch(() => {});
    await sleep(200);
    await p.evaluate(() => window.__lc.restoreContext());
    await p.waitForFunction(() => window.__rainglass.gl, null, { timeout: 5000 }).catch(() => {});
    const d0 = await p.evaluate(() => window.__rainglass.glDraws);
    await p.waitForFunction(d => window.__rainglass.glDraws > d + 3, d0, { timeout: 5000 }).catch(() => {});
    assert(await p.evaluate(d => window.__rainglass.glDraws > d + 3, d0), 'WebGL context 遺失後復原，畫面繼續動');
  } else assert(true, '沒有 WebGL（2D 模式），略過 context 測試');

  // 11. rotation keeps marks 1:1 (no stretch)
  {
    await touch(195, 420, 120); await sleep(30);
    const b0 = await p.evaluate(() => window.__rainglass.clearBox(115, 340, 275, 500, 0.4));
    await p.setViewportSize({ width: 844, height: 390 });
    await p.waitForFunction(() => innerWidth === 844 && window.__rainglass.cell && window.__rainglass.clearAt(422, 195) >= 0, null, { timeout: 5000 });
    await sleep(400);
    const b1 = await p.evaluate(() => window.__rainglass.clearBox(342, 115, 502, 275, 0.3));
    const ar = b => b ? (b.x1 - b.x0) / (b.y1 - b.y0) : 0;
    assert(b0 && b1 && Math.abs(ar(b1) - 1) < 0.35 && Math.abs((b1.x1 - b1.x0) - (b0.x1 - b0.x0)) < 14, `旋轉後擦痕保持原比例、置中（前 ${b0 && (b0.x1 - b0.x0)}×${b0 && (b0.y1 - b0.y0)}，後 ${b1 && (b1.x1 - b1.x0)}×${b1 && (b1.y1 - b1.y0)}）`);
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(400);
  }

  // 12. reload keeps saved values; damaged saves are ignored
  {
    await t.ctx.close();
    const t2 = await open(390, 844, { 'rainglass:intensity': '0.87', 'rainglass:scene': 'dusk', 'rainglass:trace': '{"2026-01-01":3,"bad":2,"2026-01-02":9}' });
    const st = await t2.p.evaluate(() => ({ i: window.__rainglass.intensity, s: window.__rainglass.scene, log: window.__rainglass.trace.log, sub: document.getElementById('sub').textContent }));
    assert(Math.abs(st.i - 0.87) < 1e-9 && st.s === 'dusk' && /黃昏/.test(st.sub) && JSON.stringify(st.log) === '{"2026-01-01":3}', '舊的雨勢存檔照樣讀入；窗景與臨摹紀錄保存，壞資料略過');
    await t2.ctx.close();
    const t3 = await open(390, 844, { 'rainglass:intensity': 'abc', 'rainglass:scene': '{', 'rainglass:trace': '[1' });
    assert(await t3.p.evaluate(() => window.__rainglass.intensity) === 0.5, '壞的存檔回到預設，不出錯');
    await t3.ctx.close();
  }

  assert(external.length === 0, `沒有外部網路請求${external.length ? '：' + external.slice(0, 3).join(', ') : ''}`);
  const real = errors.filter(e => !/GPU stall|ReadPixels/i.test(e));
  assert(real.length === 0, `沒有 page / console error${real.length ? '：' + real.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過（雨窗回歸測試）');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
