// 注音標註：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）
// 讀音資料修正、三聲連讀、輕聲、即時保存、清空復原、空白狀態、讀音選單（位置、旋轉、外點關閉、幽靈點擊）、
// pointerup 觸控（單點、慢按 0.6 s / 1 s、另一指按著、連打）、觸控目標、橫式兩欄、增量重繪、PNG 下載連結。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phonetic-tag-'));
const WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const KEY = 'phonetic-tag:v1:';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const SAMPLE = '我們去銀行，再走一段路回家。\n長大以後，我想當一位老師，幫助更多孩子快樂地成長。';

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opt });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await ready(p);
    const cdp = await ctx.newCDPSession(p);
    return { ctx, p, cdp };
  }
  const ready = p => p.waitForFunction(() => window.__ph && !__ph.busy, null, { timeout: 30000 });
  const T = (cdp, type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  async function tap(p, cdp, x, y, hold = 40, id = 0) { await T(cdp, 'touchStart', [{ x, y, id }]); await p.waitForTimeout(hold); await T(cdp, 'touchEnd', [{ x, y, id }]); }
  const ctr = (p, sel) => p.evaluate(s => { const e = typeof s === 'string' ? document.querySelector(s) : null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  const popOpen = p => p.evaluate(() => !document.getElementById('pop').hidden);
  const setInput = async (p, v) => { await p.evaluate(v => { const i = document.getElementById('input'); i.value = v; i.dispatchEvent(new Event('input')); __ph.render(); }, v); await ready(p); };
  const zOf = (p, s, sandhi) => p.evaluate(([s, sandhi]) => __ph.tag(s, { sandhi }).toks.filter(t => !t.plain).map(t => __ph.zDisp(t.z)).join(' '), [s, sandhi]);

  // 1. 讀音：什麼／怎麼 等常用詞、單字預設、輕聲詞、簡繁混打、著急
  {
    const { ctx, p } = await open();
    const W = { '什麼': 'ㄕㄜˊ ˙ㄇㄜ', '怎麼': 'ㄗㄣˇ ˙ㄇㄜ', '怎樣': 'ㄗㄣˇ ㄧㄤˋ', '怎麼樣': 'ㄗㄣˇ ˙ㄇㄜ ㄧㄤˋ', '為什麼': 'ㄨㄟˋ ㄕㄜˊ ˙ㄇㄜ', '沒什麼': 'ㄇㄟˊ ㄕㄜˊ ˙ㄇㄜ',
      '什麼樣': 'ㄕㄜˊ ˙ㄇㄜ ㄧㄤˋ', '多麼': 'ㄉㄨㄛ ˙ㄇㄜ', '要麼': 'ㄧㄠˋ ˙ㄇㄜ', '怎麼辦': 'ㄗㄣˇ ˙ㄇㄜ ㄅㄢˋ', '這麼': 'ㄓㄜˋ ˙ㄇㄜ', '那麼': 'ㄋㄚˋ ˙ㄇㄜ', '怎': 'ㄗㄣˇ', '麼': '˙ㄇㄜ',
      '你在做什麼？你怎麼還不睡覺？': 'ㄋㄧˇ ㄗㄞˋ ㄗㄨㄛˋ ㄕㄜˊ ˙ㄇㄜ ㄋㄧˇ ㄗㄣˇ ˙ㄇㄜ ㄏㄞˊ ㄅㄨˋ ㄕㄨㄟˋ ㄐㄧㄠˋ', '著急': 'ㄓㄠˊ ㄐㄧˊ',
      '頭发很长': 'ㄊㄡˊ ㄈㄚˇ ㄏㄣˇ ㄔㄤˊ', '头发很长': 'ㄊㄡˊ ㄈㄚˇ ㄏㄣˇ ㄔㄤˊ', '他說的話我都聽得懂。': 'ㄊㄚ ㄕㄨㄛ ˙ㄉㄜ ㄏㄨㄚˋ ㄨㄛˇ ㄉㄡ ㄊㄧㄥ ˙ㄉㄜ ㄉㄨㄥˇ',
      '下雨了，記得帶傘。': 'ㄒㄧㄚˋ ㄩˇ ˙ㄌㄜ ㄐㄧˋ ˙ㄉㄜ ㄉㄞˋ ㄙㄢˇ', '我們去銀行': 'ㄨㄛˇ ˙ㄇㄣ ㄑㄩˋ ㄧㄣˊ ㄏㄤˊ' };
    const NEU = '朋友 ㄆㄥˊ ˙ㄧㄡ|媽媽 ㄇㄚ ˙ㄇㄚ|爸爸 ㄅㄚˋ ˙ㄅㄚ|哥哥 ㄍㄜ ˙ㄍㄜ|姐姐 ㄐㄧㄝˇ ˙ㄐㄧㄝ|弟弟 ㄉㄧˋ ˙ㄉㄧ|妹妹 ㄇㄟˋ ˙ㄇㄟ|奶奶 ㄋㄞˇ ˙ㄋㄞ|爺爺 ㄧㄝˊ ˙ㄧㄝ|謝謝 ㄒㄧㄝˋ ˙ㄒㄧㄝ|東西 ㄉㄨㄥ ˙ㄒㄧ|衣服 ㄧ ˙ㄈㄨ|喜歡 ㄒㄧˇ ˙ㄏㄨㄢ|時候 ㄕˊ ˙ㄏㄡ|認識 ㄖㄣˋ ˙ㄕ|意思 ㄧˋ ˙ㄙ|先生 ㄒㄧㄢ ˙ㄕㄥ|告訴 ㄍㄠˋ ˙ㄙㄨ|舒服 ㄕㄨ ˙ㄈㄨ|漂亮 ㄆㄧㄠˋ ˙ㄌㄧㄤ|清楚 ㄑㄧㄥ ˙ㄔㄨ|明白 ㄇㄧㄥˊ ˙ㄅㄞ|眼睛 ㄧㄢˇ ˙ㄐㄧㄥ|耳朵 ㄦˇ ˙ㄉㄨㄛ|石頭 ㄕˊ ˙ㄊㄡ|木頭 ㄇㄨˋ ˙ㄊㄡ|麻煩 ㄇㄚˊ ˙ㄈㄢ|葡萄 ㄆㄨˊ ˙ㄊㄠ|玻璃 ㄅㄛ ˙ㄌㄧ|月亮 ㄩㄝˋ ˙ㄌㄧㄤ|熱鬧 ㄖㄜˋ ˙ㄋㄠ|客氣 ㄎㄜˋ ˙ㄑㄧ|聰明 ㄘㄨㄥ ˙ㄇㄧㄥ|豆腐 ㄉㄡˋ ˙ㄈㄨ|嘴巴 ㄗㄨㄟˇ ˙ㄅㄚ|尾巴 ㄨㄟˇ ˙ㄅㄚ|兒子 ㄦˊ ˙ㄗ|桌子 ㄓㄨㄛ ˙ㄗ|孩子 ㄏㄞˊ ˙ㄗ|我們 ㄨㄛˇ ˙ㄇㄣ';
    NEU.split('|').forEach(e => { const [w, ...z] = e.split(' '); W[w] = z.join(' '); });
    const got = await p.evaluate(ws => Object.fromEntries(ws.map(w => [w, __ph.tag(w).toks.filter(t => !t.plain).map(t => __ph.zDisp(t.z)).join(' ')])), Object.keys(W));
    const bad = Object.keys(W).filter(w => got[w] !== W[w]).map(w => `${w}→${got[w]}（應 ${W[w]}）`);
    assert(bad.length === 0, `常用詞與輕聲詞讀音 ${Object.keys(W).length - bad.length}/${Object.keys(W).length} ` + bad.join('；'));
    // 2. 三聲連讀：相鄰漢字都三聲就變調，三字由右往左；有標點就不變
    const S = { '水果': 'ㄕㄨㄟˊ ㄍㄨㄛˇ', '你好': 'ㄋㄧˊ ㄏㄠˇ', '可以': 'ㄎㄜˊ ㄧˇ', '很好': 'ㄏㄣˊ ㄏㄠˇ', '老鼠': 'ㄌㄠˊ ㄕㄨˇ', '展覽': 'ㄓㄢˊ ㄌㄢˇ', '雨傘': 'ㄩˊ ㄙㄢˇ', '洗澡': 'ㄒㄧˊ ㄗㄠˇ', '手錶': 'ㄕㄡˊ ㄅㄧㄠˇ', '小鳥': 'ㄒㄧㄠˊ ㄋㄧㄠˇ', '理想': 'ㄌㄧˊ ㄒㄧㄤˇ', '所以': 'ㄙㄨㄛˊ ㄧˇ',
      '展覽館': 'ㄓㄢˊ ㄌㄢˊ ㄍㄨㄢˇ', '好，好': 'ㄏㄠˇ ㄏㄠˇ', '一個': 'ㄧˊ ˙ㄍㄜ', '一定': 'ㄧˊ ㄉㄧㄥˋ', '一起': 'ㄧˋ ㄑㄧˇ', '不要': 'ㄅㄨˊ ㄧㄠˋ', '姐姐': 'ㄐㄧㄝˇ ˙ㄐㄧㄝ' };
    const gs = {}; for (const w of Object.keys(S)) gs[w] = await zOf(p, w, true);
    const bs = Object.keys(S).filter(w => gs[w] !== S[w]).map(w => `${w}→${gs[w]}`);
    assert(bs.length === 0, `標示變調：三聲連讀 12 詞＋展覽館、標點隔開不變、一個 ㄧˊ ` + bs.join('；'));
    assert(await zOf(p, '你好', false) === 'ㄋㄧˇ ㄏㄠˇ', '不勾「標示變調」時仍標本調');
    await ctx.close();
  }

  // 3. 即時保存：打字後立刻重新整理不掉字；超過上限時保留上一次的內容並提示
  {
    const { ctx, p } = await open();
    await p.evaluate(() => localStorage.clear()); await p.reload(); await ready(p);
    await p.click('#input'); await p.evaluate(() => document.getElementById('input').select());
    await p.keyboard.insertText('今天天氣很好'); await p.waitForTimeout(500); await p.keyboard.insertText('，我們去公園');
    await p.reload(); await ready(p);
    assert(await p.inputValue('#input') === '今天天氣很好，我們去公園', '打字後立刻重新整理：最後打的字還在 ' + await p.inputValue('#input'));
    await p.evaluate(() => { const i = document.getElementById('input'); i.value = '短的保留內容'; i.dispatchEvent(new Event('input')); });
    const big = '今天天氣很好，我和媽媽一起去公園散步。\n'.repeat(10600);
    await p.evaluate(b => { const i = document.getElementById('input'); i.value = b; i.dispatchEvent(new Event('input')); }, big);
    const warn = await p.evaluate(() => !document.getElementById('saveWarn').hidden && document.getElementById('saveWarn').textContent);
    assert(!!warn && /不會保存/.test(warn), '超過 20 萬字：輸入框下方顯示「不會保存」 ' + warn);
    await p.reload(); await ready(p);
    assert(await p.inputValue('#input') === '短的保留內容', '超過上限後重新整理：保留上一次保存的內容，不是空白');
    // pagehide 也會寫入（例如程式化變更後關頁）
    await p.evaluate(() => { document.getElementById('input').value = 'pagehide 寫入'; dispatchEvent(new Event('pagehide')); });
    assert(await p.evaluate(k => JSON.parse(localStorage.getItem(k + 'input')), KEY) === 'pagehide 寫入', 'pagehide 時立即寫入');
    // 4. 清空 → 復原（按鈕與 toast），重新整理後也能復原
    await setInput(p, '要清空的文字');
    await p.click('#clearIn'); await ready(p);
    const st = await p.evaluate(() => ({ v: document.getElementById('input').value, btn: document.getElementById('clearIn').textContent, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent,
      pv: document.querySelector('#pv .empty')?.textContent || '', dis: ['copyText', 'copyHtml', 'showPng'].map(id => document.getElementById(id).disabled), out: __ph.plainOut() }));
    assert(st.v === '' && st.btn === '復原' && /已清空/.test(st.toast) && /復原/.test(st.toast), '清空後：按鈕變「復原」、toast「已清空・復原」');
    assert(/輸入/.test(st.pv) && st.dis.every(Boolean) && st.out === '', '清空後預覽顯示空白提示（不是範例），複製／產生圖片停用 ' + st.pv);
    const cw = await p.evaluate(() => { const r = document.getElementById('clearIn').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    await p.reload(); await ready(p);
    assert(await p.inputValue('#input') === '' && (await p.textContent('#clearIn')) === '復原', '重新整理後仍可復原');
    await p.click('#clearIn'); await ready(p);
    assert(await p.inputValue('#input') === '要清空的文字' && (await p.textContent('#clearIn')) === '清空', '按「復原」找回清空前的文字');
    assert(cw[1] >= 44 && cw[0] >= 44, '清空按鈕 ≥ 44×44 ' + cw);
    await ctx.close();
  }

  // 舊資料：既有 key（input / prefs / overrides）照常讀入
  {
    const { ctx, p } = await open(390, 844, {}, `localStorage.setItem('${KEY}input', JSON.stringify('快樂')); localStorage.setItem('${KEY}prefs', JSON.stringify({ type: 'pinyin', fs: 28 })); localStorage.setItem('${KEY}overrides', JSON.stringify({ '快樂': ['ㄎㄨㄞˋ', 'ㄩㄝˋ'] }));`);
    const oldOut = await p.evaluate(() => __ph.plainOut()); assert(oldOut === '快(kuài)樂(yuè)' && await p.inputValue('#fontSize') === '28', '舊版存檔（輸入、偏好 28px、讀音修正）照常載入 ' + oldOut);
    await ctx.close();
  }

  // 5. 新使用者預設 32px；聚焦範例時全選（直接貼上就取代）
  {
    const { ctx, p } = await open();
    assert(await p.inputValue('#fontSize') === '32' && await p.evaluate(() => getComputedStyle(document.querySelector('#pv .zy')).fontSize) === (32 * 0.34).toFixed(2).replace(/0$/, '') + 'px', '預設字級 32px');
    await p.focus('#input'); await p.waitForFunction(() => { const i = document.getElementById('input'); return i.selectionStart === 0 && i.selectionEnd === i.value.length; }, null, { timeout: 3000 }).catch(() => null);
    assert(await p.evaluate(() => { const i = document.getElementById('input'); return i.value.length > 0 && i.selectionStart === 0 && i.selectionEnd === i.value.length; }), '第一次點範例文字會全選，貼上就取代');
    await ctx.close();
  }

  // 6. 讀音選單：放在字上方、箭頭與高亮、影響範圍、觸控目標、外點關閉並吃掉、開啟後立刻點選單無效、選後沒有幽靈點擊
  {
    const { ctx, p, cdp } = await open();
    await setInput(p, SAMPLE);
    await p.evaluate(() => { const r = document.getElementById('preview').getBoundingClientRect(); scrollBy(0, r.top - 300); });
    const polys = () => p.evaluate(() => [...document.querySelectorAll('#pv .poly')].map(e => { const r = e.getBoundingClientRect(); return { ch: e.querySelector('.h').textContent, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }));
    let P = await polys(); const yue = P.find(q => q.ch === '樂');
    await tap(p, cdp, yue.x, yue.y); await p.waitForFunction(() => !document.getElementById('pop').hidden);
    const g = await p.evaluate(() => { const pop = document.getElementById('pop').getBoundingClientRect(); const sel = document.querySelector('#pv .poly.sel'); const s = sel.getBoundingClientRect(); const a = document.getElementById('popArw').getBoundingClientRect();
      return { above: pop.bottom <= s.top, sel: sel.querySelector('.h').textContent, arrowX: Math.abs((a.left + a.width / 2) - (s.left + s.width / 2)), scope: document.getElementById('popScope').textContent,
        foot: [...document.querySelectorAll('#pop .foot button')].map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }) }; });
    assert(g.above && g.sel === '樂' && g.arrowX < 4, '選單放在字的上方（不蓋住下一行），箭頭指向被點的字並高亮');
    assert(/會套用到/.test(g.scope) && /樂/.test(g.scope), '選單說明影響範圍：' + g.scope);
    assert(g.foot.every(v => v >= 44), '「還原預設」「關閉」≥ 44 ' + g.foot.map(Math.round));
    // 多音字點擊區 ≥ 44：在字中心上下左右 21px 仍點得到
    const hit = await p.evaluate(() => [...document.querySelectorAll('#pv .poly')].every(e => { const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return [[cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]].every(([x, y]) => { const h = document.elementFromPoint(x, y); return h && (h.closest('.poly') === e || h.closest('#pop')); }); }));
    assert(hit, '多音字點擊區擴到 44×44');
    // 選單外點一般字：關閉選單，那一下不會做別的事
    const np = await p.evaluate(() => { const pr = document.getElementById('pop').getBoundingClientRect(); const e = [...document.querySelectorAll('#pv [data-k]')].find(x => { const r = x.getBoundingClientRect(); return !x.classList.contains('poly') && (r.top > pr.bottom + 10 || r.bottom < pr.top - 10 || r.right < pr.left - 10 || r.left > pr.right + 10); }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tap(p, cdp, np[0], np[1]); await p.waitForTimeout(150);
    assert(!(await popOpen(p)) && await p.evaluate(() => !document.querySelector('#pv .sel')), '點預覽裡的一般字會關閉選單');
    // 選單開著時點按鈕：只關閉選單，不觸發按鈕
    await tap(p, cdp, yue.x, yue.y); await p.waitForFunction(() => !document.getElementById('pop').hidden);
    const typeBefore = await p.evaluate(() => __ph.P.type);
    const tb = await ctr(p, '#tPinyin'); await tap(p, cdp, tb[0], tb[1]); await p.waitForTimeout(200);
    assert(!(await popOpen(p)) && await p.evaluate(() => __ph.P.type) === typeBefore, '選單開著時點外面的按鈕：只關閉選單（吃掉那一下）');
    // 開啟後立刻（< 0.2 s）點到選單裡：不會選到讀音
    await tap(p, cdp, yue.x, yue.y); await p.waitForFunction(() => !document.getElementById('pop').hidden);
    const c0 = await ctr(p, '#popCands button:last-child'); await p.evaluate(() => document.getElementById('popClose').click());
    await p.evaluate(() => { const pop = document.getElementById('pop'); window.__dt = null; new MutationObserver(() => { if (!pop.hidden) window.__open = performance.now(); }).observe(pop, { attributes: true });
      document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('#pop') && window.__dt == null) window.__dt = performance.now() - window.__open; }, true); });
    await T(cdp, 'touchStart', [{ x: yue.x, y: yue.y, id: 0 }]); await T(cdp, 'touchEnd', [{ x: yue.x, y: yue.y, id: 0 }]);
    await T(cdp, 'touchStart', [{ x: c0[0], y: c0[1], id: 0 }]); await T(cdp, 'touchEnd', [{ x: c0[0], y: c0[1], id: 0 }]); await p.waitForTimeout(100);
    const ovFast = await p.evaluate(k => localStorage.getItem(k + 'overrides'), KEY); const dt = await p.evaluate(() => window.__dt);
    if (dt != null && dt < 200) assert(!ovFast || ovFast === '{}', `開啟後 ${Math.round(dt)} ms 就點到選單：不會誤選讀音`);
    else console.log('skip 開啟後立刻點選單（機器太慢，第二下在 ' + dt + ' ms 才到）');
    if (ovFast && ovFast !== '{}') { await p.evaluate(k => localStorage.removeItem(k + 'overrides'), KEY); }
    if (await popOpen(p)) await p.evaluate(() => document.getElementById('popClose').click());
    await tap(p, cdp, yue.x, yue.y); await p.waitForFunction(() => !document.getElementById('pop').hidden);
    // 正常選讀音，之後不會有幽靈點擊打開下面的字
    await p.waitForTimeout(300); const c1 = await ctr(p, '#popCands button:last-child'); await tap(p, cdp, c1[0], c1[1]); await p.waitForTimeout(400);
    const after = await p.evaluate(() => ({ out: __ph.plainOut(), open: !document.getElementById('pop').hidden }));
    assert(after.out.includes('樂(ㄩㄝˋ)') && !after.open, '觸控選讀音：套用一次，選單關閉，沒有幽靈點擊再打開選單');
    // 另一個多音字：選單開著時點另一個多音字直接切換
    P = await polys(); let a, b; for (const x of P) { const y = P.find(q => q !== x && q.ch !== x.ch && Math.abs(q.y - x.y) < 4); if (y) { a = x; b = y; break; } }
    await tap(p, cdp, b.x, b.y); await p.waitForFunction(() => !document.getElementById('pop').hidden);
    await p.waitForTimeout(250); await tap(p, cdp, a.x, a.y); await p.waitForTimeout(150);
    const ttl = await p.textContent('#popTitle'); assert(await popOpen(p) && ttl.includes(a.ch), '選單開著時點另一個多音字直接切換 ' + ttl);
    await ctx.close();
  }

  // 7. 選單開著時旋轉：844×390 → 360×640，版面寬度不變大、選單在畫面內
  {
    const { ctx, p, cdp } = await open(844, 390);
    await setInput(p, SAMPLE);
    await p.evaluate(() => document.getElementById('preview').scrollIntoView({ block: 'start' }));
    const far = await p.evaluate(() => { const e = [...document.querySelectorAll('#pv .poly')].sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0]; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tap(p, cdp, far[0], far[1]); await p.waitForFunction(() => !document.getElementById('pop').hidden);
    const land = await p.evaluate(() => ({ preview: Math.round(document.getElementById('preview').getBoundingClientRect().top + scrollY), cols: getComputedStyle(document.querySelector('.cols')).gridTemplateColumns.split(' ').length }));
    await p.setViewportSize({ width: 360, height: 640 });
    await p.waitForFunction(() => { const r = document.getElementById('pop').getBoundingClientRect(); return document.getElementById('pop').hidden || r.right <= innerWidth; }, null, { timeout: 3000 }).catch(() => null);
    const port = await p.evaluate(() => { const r = document.getElementById('pop').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, right: Math.round(r.right), left: Math.round(r.left), scale: visualViewport.scale }; });
    assert(port.sw <= port.iw && port.right <= port.iw && port.left >= 0 && port.scale === 1, `旋轉後選單重新定位，沒有橫向捲動 ${JSON.stringify(port)}`);
    // 8. 橫式 ≥ 700px 兩欄，預覽在第一屏
    assert(land.cols === 2 && land.preview < 390, `844×390 橫式兩欄，預覽從 y=${land.preview} 開始`);
    await ctx.close();
  }

  // 9. 觸控：按鈕在 pointerup 觸發，單點／慢按 0.6 s、1 s／另一指按著／連打都恰好一次，沒有 click 重複
  {
    const { ctx, p, cdp } = await open();
    await p.evaluate(() => { document.getElementById('tZhuyin').scrollIntoView({ block: 'center' }); });
    const zh = await ctr(p, '#tZhuyin'), py = await ctr(p, '#tPinyin'), gr = await ctr(p, 'label.tg:has(#sandhi)');
    const type = () => p.evaluate(() => __ph.P.type);
    for (const hold of [40, 600, 1000]) {
      await tap(p, cdp, py[0], py[1], hold); await p.waitForTimeout(60); const a = await type();
      await tap(p, cdp, zh[0], zh[1], hold); await p.waitForTimeout(60); const b = await type();
      assert(a === 'pinyin' && b === 'zhuyin', `按住 ${hold} ms 再放開：按鈕各觸發一次`);
    }
    const s0 = await p.evaluate(() => __ph.P.sandhi);
    await tap(p, cdp, gr[0], gr[1], 600); await p.waitForTimeout(80);
    assert(await p.evaluate(() => __ph.P.sandhi) === !s0, '慢按勾選框：切換一次');
    await tap(p, cdp, gr[0], gr[1]); await p.waitForTimeout(80);
    // 另一指按在頁首，再用第二指點按鈕（touchEnd 只放開第二指）
    await T(cdp, 'touchStart', [{ x: 20, y: 600, id: 0 }]); await p.waitForTimeout(80);
    await T(cdp, 'touchStart', [{ x: 20, y: 600, id: 0 }, { x: py[0], y: py[1], id: 1 }]); await p.waitForTimeout(60);
    await T(cdp, 'touchEnd', [{ x: py[0], y: py[1], id: 1 }]); await p.waitForTimeout(150); const mid = await type();
    await T(cdp, 'touchEnd', [{ x: 20, y: 600, id: 0 }]); await p.waitForTimeout(100);
    assert(mid === 'pinyin' && await type() === 'pinyin', '另一指已按著時點按鈕：照樣觸發一次');
    // 另一指按著時點多音字
    await setInput(p, SAMPLE); await p.evaluate(() => document.getElementById('preview').scrollIntoView({ block: 'center' }));
    const q = await p.evaluate(() => { const r = document.querySelector('#pv .poly').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await T(cdp, 'touchStart', [{ x: 8, y: 20, id: 0 }]); await p.waitForTimeout(80);
    await T(cdp, 'touchStart', [{ x: 8, y: 20, id: 0 }, { x: q[0], y: q[1], id: 1 }]); await p.waitForTimeout(60);
    await T(cdp, 'touchEnd', [{ x: q[0], y: q[1], id: 1 }]); await p.waitForTimeout(150);
    assert(await popOpen(p), '另一指已按著時點多音字：選單照樣打開');
    await T(cdp, 'touchEnd', [{ x: 8, y: 20, id: 0 }]); await p.evaluate(() => document.getElementById('popClose').click());
    // 連打 16 下（約每秒 8 下）在兩個按鈕間交替：每一下都恰好觸發一次
    await p.evaluate(() => { document.getElementById('tZhuyin').scrollIntoView({ block: 'center' }); window.__n = 0; document.getElementById('tBoth').addEventListener('click', () => __n++); document.getElementById('tZhuyin').addEventListener('click', () => __n++); });
    const bo = await ctr(p, '#tBoth'), z2 = await ctr(p, '#tZhuyin');
    for (let i = 0; i < 16; i++) { const [x, y] = i % 2 ? z2 : bo; await tap(p, cdp, x, y, 30); await p.waitForTimeout(90); }
    await p.waitForTimeout(100);
    assert(await p.evaluate(() => __n) === 16 && await type() === 'zhuyin', '連打 16 下：16 次、0 遺漏 0 重複 ' + await p.evaluate(() => __n));
    // 鍵盤 Enter 仍可操作按鈕
    await p.focus('#tPinyin'); await p.keyboard.press('Enter'); assert(await type() === 'pinyin', '鍵盤 Enter 仍可操作');
    await ctx.close();
  }

  // 10. 效能：2 萬字（分段）在中間打一個字，只重建改到的段落；只重算改到的段落
  {
    const { ctx, p } = await open();
    const unit = '今天天氣很好，我和媽媽一起去公園散步。我們去銀行，再走一段路回家。\n';
    await setInput(p, unit.repeat(Math.ceil(20000 / unit.length)).slice(0, 20000));
    const r = await p.evaluate(async () => {
      const pv = document.getElementById('pv'); const paras = [...pv.children]; const i = document.getElementById('input'); const v = i.value; const m = v.indexOf('\n', v.length >> 1);
      const sameBefore = new Set(paras); i.value = v.slice(0, m) + '好' + v.slice(m);
      const t0 = performance.now(); __ph.render(); const sync = performance.now() - t0;
      await new Promise(r => { const f = () => __ph.busy ? setTimeout(f, 0) : r(); f(); });
      const now = [...pv.children]; const kept = now.filter(x => sameBefore.has(x)).length;
      return { sync, kept, n: now.length, out: __ph.plainOut().length > 20000 };
    });
    assert(r.kept >= r.n - 1 && r.out, `在中間打一個字：${r.n} 段中 ${r.kept} 段原封不動（只重建 1 段）`);
    assert(r.sync < 400, `增量重繪同步時間 ${Math.round(r.sync)} ms`);
    await ctx.close();
  }

  // 11. 產生圖片後有「下載 PNG」連結（沒有 downloads 能力時）
  {
    const { ctx, p } = await open();
    await setInput(p, '你好');
    await p.click('#showPng'); await p.waitForFunction(() => !document.getElementById('imgDlg').hidden, null, { timeout: 10000 });
    const a = await p.evaluate(() => { const a = document.getElementById('imgSave'); return [a.getAttribute('download'), a.href.startsWith('blob:'), a.getBoundingClientRect().height]; });
    assert(a[0] === '注音標註.png' && a[1] && a[2] >= 44, '圖片對話框有 a[download] 下載 PNG（blob URL）');
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('#imgSave')]);
    assert(!!d, '點「下載 PNG」會下載檔案（file:// 下檔名由瀏覽器決定）');
    await ctx.close();
  }

  assert(errors.length === 0, '沒有 console／page error ' + errors.join(' | '));
  await browser.close(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL ' + e.message); process.exit(1); });
