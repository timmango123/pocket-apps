// 節拍器：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）
// 觸控一律用真的 CDP Input.dispatchTouchEvent；時間判斷用 AudioContext 排程時間，不用畫面幀差。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'metronome-'));
const WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const KEY = 'metronome:v1:state';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = { bpm: 96, sig: [4, 4], sub: 1, sound: 'wood', volume: 80, accents: [2, 1, 1, 1], theme: 'auto', ramp: { on: false, from: 80, to: 120, every: 4, step: 4 } };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  async function open(w = 390, h = 844, state, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opt });
    if (state) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(state)]);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__metro);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const at = async sel => { const b = await p.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tap = async (sel, hold = 40) => { const c = await at(sel); await T('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await sleep(hold); await T('touchEnd', []); };
    // finger 1 rests on `rest`, finger 2 taps `sel`, finger 1 lifts last (or first when liftRestFirst)
    const tap2 = async (rest, sel, liftRestFirst) => {
      const a = await at(rest), b = await at(sel);
      await T('touchStart', [{ x: a.x, y: a.y, id: 1 }]); await sleep(80);
      await T('touchStart', [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); await sleep(60);
      if (liftRestFirst) await T('touchEnd', [{ x: b.x, y: b.y, id: 2 }]); else await T('touchEnd', [{ x: a.x, y: a.y, id: 1 }]);
      await sleep(60); await T('touchEnd', []);
    };
    const settle = () => p.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => r()), 250))); // let any follow-up click arrive
    return { ctx, p, T, at, tap, tap2, settle };
  }
  const S = p => p.evaluate(() => JSON.parse(JSON.stringify(__metro.S)));
  const waitNotes = (p, n) => p.waitForFunction(n => __metro.scheduled.length >= n, n, { timeout: 30000 });

  // 1. 播放中調少細分（十六分→無細分、三連音→八分）：不重拍、不偏移
  for (const [from, to, grid] of [[4, 1, 4], [3, 2, 6], [4, 2, 4]]) {
    const { ctx, p, tap, settle } = await open(390, 844, { ...BASE, bpm: 120, sub: from });
    await tap('#play'); await waitNotes(p, 6);
    await p.waitForFunction(() => { const s = __metro.scheduled; return s[s.length - 1].sub >= 1; }, null, { timeout: 30000 }); // next unscheduled note is mid-beat
    await tap('#sub' + to); await settle();
    const n0 = await p.evaluate(() => __metro.scheduled.length);
    await waitNotes(p, n0 + 4 * to + 2);
    const log = await p.evaluate(() => __metro.scheduled.map(x => ({ t: x.time, beat: x.beat, sub: x.sub })));
    const t0 = log[0].t, mains = log.filter(x => x.sub === 0);
    // main beats exactly whole beats apart and the beat index advancing by the same count
    // (a heavily loaded machine can make the scheduler skip late notes on purpose: that skips whole grid steps, never repeats or shifts a beat)
    const okMains = mains.every((x, i) => { if (!i) return true; const k = (x.t - mains[i - 1].t) / 0.5; return k > 0.999 && Math.abs(k - Math.round(k)) < 1e-6 && x.beat === (mains[i - 1].beat + Math.round(k)) % 4; });
    const onGrid = log.every(x => { const k = (x.t - t0) / (0.5 / grid); return Math.abs(k - Math.round(k)) < 1e-4; });
    const uniq = new Set(log.map(x => x.t.toFixed(6))).size === log.length;
    const pass = okMains && uniq && onGrid && (await S(p)).sub === to;
    assert(pass, `播放中細分 ${from}→${to}：主拍整拍對齊、拍序連續、無重複、全在格線上（${mains.length} 主拍）` + (pass ? '' : ' ' + JSON.stringify(log.map(x => [+(x.t - t0).toFixed(4), x.beat, x.sub]))));
    await tap('#play'); await ctx.close();
  }
  // 1b. 播放中 4/4→3/4：下一拍不存在時改成新小節第 1 拍（重音）
  {
    const { ctx, p, tap } = await open(390, 844, { ...BASE, bpm: 150 });
    await tap('#play'); await p.waitForFunction(() => { const s = __metro.scheduled; return s.length > 1 && s[s.length - 1].beat === 3; }, null, { timeout: 30000 });
    await p.selectOption('#sigNum', '2');
    const n0 = await p.evaluate(() => __metro.scheduled.length); await waitNotes(p, n0 + 6);
    const log = await p.evaluate(() => __metro.scheduled.map(x => ({ t: x.time, beat: x.beat, kind: x.kind })));
    const gaps = log.slice(1).map((x, i) => x.t - log[i].t);
    assert(gaps.every(g => Math.abs(g - 0.4) < 1e-6) && log.slice(n0).every(x => x.beat < 2 && (x.beat === 0) === (x.kind === 'a')), '播放中拍號 4→2：節奏不斷，重音落在新小節第 1 拍');
    await tap('#play'); await ctx.close();
  }
  // 1c. 漸快：舊小節最後一拍維持舊速度，新速度從新小節開始
  {
    const { ctx, p, tap } = await open(390, 844, { ...BASE, bpm: 200, sig: [2, 4], accents: [2, 1], ramp: { on: true, from: 200, to: 240, every: 1, step: 20 } });
    await tap('#play'); await waitNotes(p, 7);
    const log = await p.evaluate(() => __metro.scheduled.map(x => ({ t: x.time, bpm: x.bpm, beat: x.beat })));
    const ok = log.slice(0, 6).every((x, i) => Math.abs(log[i + 1].t - x.t - 60 / x.bpm) < 1e-6);
    assert(ok && log[0].bpm === 200 && log[2].bpm === 220 && log[4].bpm === 240, '漸快每一拍的間隔都等於該拍的速度（200, 200 | 220, 220 | 240）');
    await tap('#play'); await ctx.close();
  }

  // 2. 手指點大數字：單點、按住 0.6 s、1 s、另一指已按住 → 輸入框打開且保持聚焦；下方內容不位移
  {
    const { ctx, p, T, at, tap, settle } = await open();
    for (const [label, hold, other] of [['單點', 40], ['按住 0.6 s', 600], ['按住 1 s', 1000], ['另一指按住標題', 40, true]]) {
      const termY = (await p.locator('#term').boundingBox()).y, dialY = (await p.locator('#knob').boundingBox()).y;
      if (other) { const h = await at('.top h1'), c = await at('#bpm'); await T('touchStart', [{ x: h.x, y: h.y, id: 1 }]); await sleep(80); await T('touchStart', [{ x: h.x, y: h.y, id: 1 }, { x: c.x, y: c.y, id: 2 }]); await sleep(hold); await T('touchEnd', [{ x: h.x, y: h.y, id: 1 }]); await sleep(40); await T('touchEnd', []); }
      else await tap('#bpm', hold);
      await settle();
      const st = await p.evaluate(() => ({ field: !!document.getElementById('bpmInput'), focus: document.activeElement && document.activeElement.id }));
      const termY2 = (await p.locator('#term').boundingBox()).y, dialY2 = (await p.locator('#knob').boundingBox()).y;
      assert(st.field && st.focus === 'bpmInput', `${label}：BPM 輸入框打開且保持聚焦（${JSON.stringify(st)}）`);
      assert(Math.abs(termY2 - termY) < 0.5 && Math.abs(dialY2 - dialY) < 0.5, `${label}：打開輸入框時速度術語與旋鈕不位移（${termY}→${termY2}）`);
      if (st.field) { await p.keyboard.press('Control+A'); await p.keyboard.type('150'); await p.keyboard.press('Enter'); }
      assert((await S(p)).bpm === 150, `${label}：輸入 150 + Enter 生效`);
      await p.evaluate(() => __metro.setBpm(120));
    }
    // 上下滑動仍可調整，不會打開輸入框
    const c = await at('#bpm'); await T('touchStart', [{ x: c.x, y: c.y, id: 1 }]);
    for (let i = 1; i <= 12; i++) { await T('touchMove', [{ x: c.x, y: c.y - i * 5, id: 1 }]); }
    await T('touchEnd', []); await settle();
    assert((await S(p)).bpm === 125 && !(await p.$('#bpmInput')), '數字上滑 60 px → +5，不打開輸入框');
    await ctx.close();
  }

  // 3. 另一指按住時點按鈕、兩指交疊、轉旋鈕時按停止
  {
    const { ctx, p, T, tap, tap2, settle } = await open();
    await p.evaluate(() => __metro.setBpm(100));
    await tap2('.top h1', '#plus1'); await settle(); assert((await S(p)).bpm === 101, '另一指按住標題，點 +1 → +1');
    await tap2('.stats', '#plus5'); await settle(); assert((await S(p)).bpm === 106, '另一指按住小節統計，點 +5 → +5');
    await tap2('.top h1', '#minus1', true); await settle(); assert((await S(p)).bpm === 105, '另一指按住，點 −1（先放開 −1）→ −1');
    await tap2('.top h1', '#sub2'); await settle(); assert((await S(p)).sub === 2, '另一指按住，點八分 → 細分改為八分');
    const lv = (await S(p)).accents[2];
    await tap2('.top h1', '#beat-3'); await settle(); assert((await S(p)).accents[2] === (lv + 2) % 3, '另一指按住，點第 3 拍 → 切換一次');
    await tap2('.top h1', '#themeBtn'); await settle(); assert((await S(p)).theme === 'light', '另一指按住，點主題 → 切換一次');
    const b0 = (await S(p)).bpm;
    await tap2('#plus1', '#plus5'); await settle(); assert((await S(p)).bpm === b0 + 6, '+1 與 +5 兩指交疊：兩下都算（+6）');
    // knob drag with finger 1, finger 2 taps play
    const k = await p.locator('#knob').boundingBox(), pl = await p.locator('#play').boundingBox();
    const cx = k.x + k.width / 2, cy = k.y + k.height / 2, R = k.width * 0.42, P = a => ({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), id: 1 });
    const play = { x: pl.x + pl.width / 2, y: pl.y + pl.height / 2, id: 2 };
    for (const want of [true, false]) {
      await T('touchStart', [P(-1.57)]); for (let i = 1; i <= 4; i++) await T('touchMove', [P(-1.57 + i * 0.1)]);
      await T('touchStart', [P(-1.17), play]); await sleep(50); await T('touchEnd', [P(-1.17)]); await sleep(40); await T('touchEnd', []); await settle();
      assert(await p.evaluate(() => __metro.playing) === want, `轉旋鈕時另一指點播放鈕 → ${want ? '開始' : '停止'}`);
    }
    // 8 taps/s alternating, long presses: exact counts
    await p.evaluate(() => __metro.setBpm(60));
    for (let i = 0; i < 16; i++) { await tap(i % 2 ? '#plus5' : '#plus1', 30); await sleep(85); }
    await settle(); assert((await S(p)).bpm === 108, '每秒約 8 下交替點 +1／+5（16 下）→ 剛好 +48');
    for (const hold of [600, 1000]) { const b = (await S(p)).bpm; await tap('#plus1', hold); await settle(); assert((await S(p)).bpm === b + 1, `按住 +1 ${hold} ms 放開 → 只 +1`); }
    // keyboard activation still works once
    await p.focus('#minus1'); await p.keyboard.press('Enter'); await settle();
    assert((await S(p)).bpm === 109, '鍵盤 Enter 按 −1 → −1（只一次）');
    await p.locator('#rampPanel').evaluate(d => { d.open = false; });
    await p.focus('#rampPanel > summary'); await p.keyboard.press('Enter'); await settle();
    assert(await p.evaluate(() => document.getElementById('rampPanel').open), '鍵盤 Enter 展開漸快面板');
    const on0 = await p.evaluate(() => document.getElementById('rampOn').checked);
    await p.focus('#rampOn'); await p.keyboard.press('Space'); await settle();
    assert(await p.evaluate(on0 => document.getElementById('rampOn').checked !== on0 && __metro.S.ramp.on !== on0, on0), '鍵盤空白鍵切換漸快開關一次');
    await tap('#rampOn'); await settle();
    assert(await p.evaluate(on0 => document.getElementById('rampOn').checked === on0 && __metro.S.ramp.on === on0, on0), '手指點漸快開關切換一次');
    await tap('#rampRow label'); await settle();
    assert(await p.evaluate(on0 => __metro.S.ramp.on !== on0, on0), '手指點開關文字也切換一次');
    await ctx.close();
  }
  // 3b. 桌面滑鼠點一下 = 一次
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } }); const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message)); await p.goto(URL);
    await p.evaluate(() => __metro.setBpm(100)); await p.click('#plus5'); await p.click('#plus1'); await p.click('#bpm');
    assert((await S(p)).bpm === 106 && await p.evaluate(() => document.activeElement.id === 'bpmInput'), '滑鼠：+5、+1 各一次，點數字打開輸入框');
    await p.keyboard.press('Escape'); await p.click('#presetBtn'); await p.waitForTimeout(300);
    assert(await p.evaluate(() => !document.getElementById('presetScrim').hidden), '滑鼠點「組合」打開面板');
    await p.mouse.click(5, 5); await p.waitForTimeout(100);
    assert(await p.evaluate(() => document.getElementById('presetScrim').hidden), '滑鼠點背景關閉面板');
    await ctx.close();
  }

  // 4. 組合：打開不跳鍵盤、刪除／覆蓋可復原、匯出／匯入、背景點擊不穿透
  {
    const { ctx, p, T, tap, settle } = await open();
    await tap('#presetBtn'); await settle();
    assert(await p.evaluate(() => !document.getElementById('presetScrim').hidden && document.activeElement.id === 'presetTitle'), '手指點「組合」：面板打開，焦點在標題（不聚焦名稱欄、不跳鍵盤）');
    await tap('#preset-rm-0'); await settle();
    let st = await S(p);
    const toastBtn = await p.locator('#toastAct').boundingBox();
    assert(st.presets.length === 2 && await p.isVisible('#toastAct') && toastBtn.width >= 44 && toastBtn.height >= 44, '刪除組合後出現「復原」按鈕（≥44 px）');
    await tap('#toastAct'); await settle();
    st = await S(p); assert(st.presets.length === 3 && st.presets[0].name === '範例：慢練 4/4', '按「復原」救回刪除的組合（位置不變）');
    await p.evaluate(() => __metro.setBpm(77)); await p.fill('#presetName', '範例：華爾滋 3/4'); await tap('#presetSave'); await settle();
    st = await S(p); assert(st.presets[1].bpm === 77 && (await p.textContent('#presetMsg')).includes('覆蓋') && await p.isVisible('#toastAct'), '同名儲存：提示「已覆蓋」並可復原');
    await tap('#toastAct'); await settle(); st = await S(p); assert(st.presets[1].bpm === 90, '覆蓋後按「復原」還原舊組合');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), tap('#presetExport')]);
    let exported = null; if (dl) { try { exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); } catch { exported = null; } }
    assert(dl && /^metronome-presets-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()) && exported && exported.presets.length === 3, '匯出備份：下載 .json，內含 3 組 ' + (dl && dl.suggestedFilename()));
    const f = path.join(DIR, 'in.json');
    fs.writeFileSync(f, JSON.stringify({ presets: [{ name: '新的', bpm: 140, sig: [5, 4], sub: 3, accents: [2, 1, 1, 2, 1] }, null, { name: '壞', bpm: 100 }, { name: '範例：慢練 4/4', bpm: 66, sig: [4, 4] }] }));
    await p.setInputFiles('#presetFile', f); await p.waitForFunction(() => /匯入/.test(document.getElementById('presetMsg').textContent));
    st = await S(p); const msg = await p.textContent('#presetMsg');
    assert(st.presets.length === 4 && st.presets[3].name === '新的' && st.presets[0].bpm === 66 && /匯入 1 組/.test(msg) && /覆蓋同名 1 組/.test(msg) && /略過 2 筆/.test(msg), '匯入：驗證格式、同名覆蓋、略過壞資料：' + msg);
    const f2 = path.join(DIR, 'bad.json'); fs.writeFileSync(f2, '{"presets": [ 截斷'); await p.setInputFiles('#presetFile', f2);
    await p.waitForFunction(() => /格式不正確/.test(document.getElementById('presetMsg').textContent));
    assert((await S(p)).presets.length === 4, '匯入壞檔：顯示格式不正確，組合不變');
    // tap a preset: loads and closes; the follow-up click must not hit what is now under the finger
    const before = await S(p);
    await tap('#preset-1'); await settle(); st = await S(p);
    assert(await p.evaluate(() => document.getElementById('presetScrim').hidden) && st.bpm === 90 && st.sig[0] === 3 && st.theme === before.theme && !(await p.evaluate(() => __metro.playing)), '手指點組合：載入並關閉，底下的控制項不被誤觸');
    // backdrop tap closes, nothing underneath fires
    await tap('#presetBtn'); await settle();
    const bpm0 = (await S(p)).bpm; const pl = await p.locator('#plus1').boundingBox();
    await T('touchStart', [{ x: pl.x + 20, y: 30, id: 1 }]); await sleep(40); await T('touchEnd', []); await settle();
    assert(await p.evaluate(() => document.getElementById('presetScrim').hidden) && (await S(p)).bpm === bpm0, '手指點背景關閉面板，不觸發底下按鈕');
    const pre = await S(p); if (pre.presets.length !== 4) console.log('DIAG before reload', JSON.stringify(pre.presets.map(x => x.name)), await p.textContent('#presetMsg'), await p.textContent('#toastMsg'));
    await p.waitForFunction(k => { try { return JSON.parse(localStorage.getItem(k)).presets.length === 4; } catch { return false; } }, KEY, { timeout: 10000 }).catch(() => console.log('DIAG storage', 'not 4 presets'));
    await p.reload(); await p.waitForFunction(() => window.__metro);
    const after = await S(p);
    assert(after.presets.length === 4, '組合重新整理後仍在' + (after.presets.length === 4 ? '' : '：' + JSON.stringify(after.presets.map(x => x.name + '@' + x.bpm))));
    await ctx.close();
  }

  // 5. 存檔：改完立刻重新整理、漸快欄位打字未離開、壞資料不當機
  {
    const { ctx, p, tap, settle } = await open();
    await p.evaluate(() => __metro.setBpm(201)); await p.reload(); await p.waitForFunction(() => window.__metro);
    assert((await S(p)).bpm === 201, '改速度後立刻重新整理仍保留（pagehide 立即存）');
    await p.evaluate(() => { document.getElementById('rampPanel').open = true; });
    await p.fill('#rampTo', '222'); await p.fill('#rampEvery', '3'); await p.reload(); await p.waitForFunction(() => window.__metro);
    let r = (await S(p)).ramp; assert(r.to === 222 && r.every === 3, '漸快欄位打完數字未離開就重新整理 → 仍保留（222、3）');
    // invalid ramp value: corrected and explained
    await p.evaluate(() => { document.getElementById('rampPanel').open = true; });
    await p.fill('#rampFrom', '0'); await p.locator('#rampFrom').dispatchEvent('change');
    assert((await p.textContent('#toastMsg')).includes('起始 BPM範圍 20～300，已改為 20') && await p.inputValue('#rampFrom') === '20', '漸快欄位不合法值：改為 20 並說明範圍');
    await p.fill('#rampStep', ''); await p.locator('#rampStep').dispatchEvent('change');
    assert((await p.textContent('#toastMsg')).includes('不能空白'), '漸快欄位空白：還原並說明');
    // ramp on: manual tempo becomes the ramp start, for ±, typed and tap tempo alike
    await p.evaluate(() => { const c = document.getElementById('rampOn'); if (!c.checked) c.click(); });
    await tap('#plus5'); await settle(); let st = await S(p);
    assert(st.ramp.on && st.ramp.from === st.bpm && await p.inputValue('#rampFrom') === String(st.bpm), '漸快開啟時按 +5：起始 BPM 跟著改成目前速度');
    await p.evaluate(() => { for (let i = 0; i < 4; i++) __metro.tapAt(5e6 + i * 500); });
    st = await S(p); assert(st.ramp.on && st.bpm === 120 && st.ramp.from === 120, '漸快開啟時測速：不再默默關掉漸快，起始 BPM 改為 120');
    await tap('#play'); await waitNotes(p, 1);
    assert(await p.evaluate(() => __metro.scheduled[0].bpm) === 120, '按播放從剛設定的 120 開始');
    await tap('#play'); await ctx.close();
  }
  for (const [label, raw] of [['presets 含 null／缺 sig／字串', JSON.stringify({ ...BASE, presets: [null, { name: 'x', bpm: 100 }, 'str', { name: '好', bpm: 70, sig: [3, 4], sub: 9, accents: [5] }] })], ['ramp 字串與 0', JSON.stringify({ ...BASE, ramp: { on: 'yes', from: 'a', to: 120, every: 0, step: -3 } })]]) {
    const { ctx, p, tap, settle } = await open(390, 844, JSON.parse(raw));
    const n0 = errors.length;
    await tap('#presetBtn'); await settle();
    const st = await S(p);
    const ok = await p.evaluate(() => !document.getElementById('presetScrim').hidden);
    if (label.startsWith('presets')) assert(ok && st.presets.length === 1 && st.presets[0].sub === 1 && st.presets[0].accents.length === 3 && await p.locator('#presetList li').count() === 1, `壞資料（${label}）：面板照常打開，只留 1 筆有效組合`);
    else assert(ok && st.ramp.on === false && st.ramp.from === 80 && st.ramp.to === 120 && st.ramp.every === 1 && st.ramp.step === 1, `壞資料（${label}）：非數字回預設、超出範圍夾到 1`);
    assert(errors.length === n0, `壞資料（${label}）：沒有 page error`);
    await ctx.close();
  }

  // 6. 清楚度：提示文字、移除開發者用語、測速說明、鍵盤快捷鍵只在有滑鼠時顯示
  {
    const { ctx, p } = await open();
    const txt = await p.evaluate(() => document.body.innerText);
    assert(await p.isVisible('#beatHint') && (await p.textContent('#beatHint')).includes('重音') && await p.isVisible('#bpmHint') && (await p.textContent('#bpmHint')).includes('點數字輸入'), '拍點與大數字下方有操作提示');
    assert(!/精準預排程|25ms|100ms|Web Audio/.test(txt), '頁首／頁尾沒有開發者用語');
    assert(!(await p.isVisible('.kbd-tips')), '觸控手機不顯示鍵盤快捷鍵');
    assert((await p.textContent('#tapInfo')) === '連點 2 下以上，4 下更準', '測速提示與實際行為一致');
    await ctx.close();
    const d = await browser.newContext({ viewport: { width: 1100, height: 800 } }); const q = await d.newPage(); await q.goto(URL);
    assert(await q.isVisible('.kbd-tips'), '桌面（有滑鼠）顯示鍵盤快捷鍵'); await d.close();
  }

  // 7. 版面：12 拍兩排各 6 且每點 ≥44 px；7 拍 4+3；844×390 第一屏含 ±、旋鈕、測速；深色未亮重音有外框
  {
    const { ctx, p } = await open(360, 640);
    for (const [n, rows] of [[12, [6, 6]], [7, [4, 3]], [9, [5, 4]], [6, [6]]]) {
      await p.selectOption('#sigNum', String(n));
      const g = await p.evaluate(() => { const m = new Map(); let minW = 1e9; for (const d of document.querySelectorAll('#beats .dot')) { const r = d.getBoundingClientRect(); minW = Math.min(minW, r.width, r.height); const y = Math.round(r.top); m.set(y, (m.get(y) || 0) + 1); } return { rows: [...m.values()], minW }; });
      assert(JSON.stringify(g.rows) === JSON.stringify(rows) && g.minW >= 44, `360 寬 ${n} 拍：每排 ${g.rows.join('+')}，最小 ${g.minW} px`);
    }
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '360×640 無橫向捲動');
    await ctx.close();
  }
  for (const scheme of ['light', 'dark']) {
    const { ctx, p } = await open(844, 390, null, { colorScheme: scheme });
    const vis = await p.evaluate(() => ['#plus1', '#minus1', '#plus5', '#minus5', '#play', '#tap', '#knob'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.bottom), Math.round(r.right)]; }));
    assert(vis.every(([, b, r]) => b <= 390 && r <= 844), `844×390 ${scheme}：±、旋鈕、播放、測速都在第一屏 ${JSON.stringify(vis.map(v => v[1]))}`);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `844×390 ${scheme}：無橫向捲動`);
    if (scheme === 'dark') assert(await p.evaluate(() => getComputedStyle(document.querySelector('#beat-1 i')).boxShadow !== 'none'), '深色模式未亮的重音點有黃銅外框（提高對比）');
    await ctx.close();
  }

  await browser.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  assert(errors.length === 0, '全程沒有 console／page error' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `FAIL ${fails} 項失敗` : 'ok 全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
