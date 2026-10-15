// 密碼產生器驗證：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '../index.html'), WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function open(browser, opt) {
  const ctx = await browser.newContext(opt);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL_); await page.waitForTimeout(300);
  return { ctx, page, errors };
}
(async () => {
  const browser = await chromium.launch();
  const mob = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const { ctx, page, errors } = await open(browser, mob);
  ok(await page.evaluate(() => innerWidth) === 390, 'innerWidth = 390');

  // 1. 統計：10 萬字元頻率偏差
  const stat = await page.evaluate(() => {
    const n = 62, cnt = new Array(n).fill(0), N = 3000000;
    for (let i = 0; i < N; i++) cnt[randInt(n)]++;
    const exp = N / n; let chi = 0; for (const c of cnt) chi += (c - exp) ** 2 / exp;
    return { max: Math.max(...cnt.map(c => Math.abs(c - exp) / exp)), chi };
  });
  ok(stat.max < 0.02 && stat.chi < 100, `randInt(62) 300 萬次：最大偏差 ${(stat.max * 100).toFixed(2)}% < 2%，卡方 ${stat.chi.toFixed(1)}（自由度 61，臨界 ≈ 100）`);
  const stat2 = await page.evaluate(() => {
    opts.len = 100; opts.each = false; opts.ambig = false; opts.unique = false; opts.upper = opts.lower = opts.digit = true; opts.sym = false;
    const cnt = {}; let tot = 0;
    for (let i = 0; i < 1000; i++) for (const c of genRandom().pw) { cnt[c] = (cnt[c] || 0) + 1; tot++; }
    const exp = tot / 62; return { keys: Object.keys(cnt).length, dev: Math.max(...Object.values(cnt).map(c => Math.abs(c - exp) / exp)) };
  });
  ok(stat2.keys === 62 && stat2.dev < 0.06, `產生 10 萬字元：62 種字元全出現，最大偏差 ${(stat2.dev * 100).toFixed(2)}%`);
  const statBig = await page.evaluate(() => { const cnt = [0, 0, 0]; for (let i = 0; i < 300000; i++) cnt[randInt(3)]++; return Math.max(...cnt.map(c => Math.abs(c - 100000) / 100000)); });
  ok(statBig < 0.02, `30 萬次三分類偏差 ${(statBig * 100).toFixed(2)}% < 2%`);

  // 2. 規則
  const rules = await page.evaluate(() => {
    const r = {};
    Object.assign(opts, { len: 20, upper: true, lower: true, digit: true, sym: true, each: true, ambig: true, unique: false, symset: '' });
    let allEach = true, noAmb = true;
    for (let i = 0; i < 300; i++) { const p = genRandom().pw; if (!(/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p))) allEach = false; if (/[0O1lI|]/.test(p)) noAmb = false; }
    r.allEach = allEach; r.noAmb = noAmb;
    Object.assign(opts, { ambig: false, unique: true, len: 100, sym: false, digit: true });
    const u = genRandom(); r.uniqueLen = u.pw.length; r.uniqueOK = new Set(u.pw).size === u.pw.length; r.note = u.note;
    Object.assign(opts, { upper: false, lower: false, digit: false, sym: false });
    r.empty = genRandom().error;
    Object.assign(opts, { upper: true, lower: true, digit: true, sym: true, unique: false, len: 20, each: true });
    { const g = genRandom(); r.bits20 = g.bits.toFixed(1); r.pool = g.pool; r.exp = (20 * Math.log2(g.pool)).toFixed(1); }
    Object.assign(opts, { tab: 'phrase', words: 5, list: 'eff', sep: '-', cap: false, adddigit: false });
    const ph = genPhrase(); r.phrase = ph.pw; r.phraseBits = ph.bits.toFixed(2);
    opts.list = 'py'; r.py = genPhrase(); r.pyBits = r.py.bits;
    r.effLen = EFF.length; r.pyLen = PINYIN.length; r.commonLen = COMMON.length;
    const t0 = performance.now();
    Object.assign(opts, { tab: 'random', len: 128 }); for (let i = 0; i < 50; i++) genRandom();
    r.ms = performance.now() - t0;
    return r;
  });
  ok(rules.allEach, '每類至少一個：300 組皆含四類');
  ok(rules.noAmb, '排除易混淆：300 組皆無 0O1lI|');
  ok(rules.uniqueLen === 62 && rules.uniqueOK, `不重複 + 長度 100 → 自動降為 ${rules.uniqueLen}（${rules.note}）`);
  ok(rules.empty === '至少選一種字元', '全不勾 → 至少選一種字元');
  ok(rules.pool === 89 && rules.bits20 === rules.exp, `20 字元、字元集 ${rules.pool}（26+26+10+27 符號）→ 熵 ${rules.bits20} 位元（20×log2 89 = ${rules.exp}）`);
  ok(rules.phrase.split('-').length === 5 && rules.phraseBits === '64.62', `EFF 5 詞：${rules.phrase}，熵 ${rules.phraseBits}（5×log2 7776 = 64.62）`);
  ok(rules.pyBits === 55, `拼音 5 詞熵 = 55 位元：${rules.py.pw}`);
  ok(rules.effLen === 7776 && rules.pyLen === 2048 && rules.commonLen >= 10000, `詞庫 EFF ${rules.effLen}、拼音 ${rules.pyLen}、常見密碼 ${rules.commonLen}`);
  ok(rules.ms < 50, `長度 128 × 50 組耗時 ${rules.ms.toFixed(1)}ms`);

  // 3. 強度檢查
  const chk = await page.evaluate(() => ['password123', 'P@ssw0rd', 'qwerty2024', 'Tr0ub4dor&3', 'correct horse battery staple', 'xK9#mQ2$vL8!pR4&', '19900101', 'abcabcabc'].map(p => { const r = checkStrength(p); return [p, Math.round(r.bits), GRADES[r.common ? 0 : gradeOf(r.bits)], r.seq.map(m => m.label).join('+')]; }));
  for (const c of chk) console.log('     ', c.join(' | '));
  for (const p of ['password123', 'P@ssw0rd', 'qwerty2024']) { const c = chk.find(x => x[0] === p); ok(c[2] === '很弱' || c[2] === '弱', `${p} → ${c[2]}（${c[1]} 位元）`); }
  ok(['強', '很強'].includes(chk.find(x => x[0] === 'xK9#mQ2$vL8!pR4&')[2]), '16 字隨機 → 強/很強');
  ok(chk.find(x => x[0] === 'correct horse battery staple')[1] > 40, '四詞片語 > 40 位元');

  // 4. 操作流程：UI
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForTimeout(300);
  const pw1 = await page.textContent('#pw');
  await page.click('#btn-regen'); const pw2 = await page.textContent('#pw');
  ok(pw1.length === 20 && pw1 !== pw2, `預設 20 字元並可重新產生：${pw1}`);
  await page.fill('#len-num', '128'); await page.dispatchEvent('#len-num', 'change');
  const w = await page.evaluate(() => ({ len: document.getElementById('pw').textContent.length, sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok(w.len === 128 && w.sw <= w.iw, `128 字元換行不溢出（scrollWidth ${w.sw}）`);
  await page.click('#btn-copy'); await page.waitForTimeout(100);
  ok(await page.isVisible('#toast-act'), '複製後出現「清除剪貼簿」');
  await page.fill('#len-num', '20'); await page.dispatchEvent('#len-num', 'change');
  await page.click('#btn-batch'); ok(await page.locator('#batch-list li').count() === 5, '批次 5 組');
  for (let i = 0; i < 12; i++) await page.click('#btn-regen');
  ok(await page.locator('#history li').count() === 10, '歷史最多 10 組');
  await page.click('#tab-phrase'); await page.waitForTimeout(100);
  ok((await page.textContent('#pw')).split('-').length === 5, '詞組分頁產生 5 詞');
  await page.click('#tab-check'); await page.fill('#check-input', 'P@ssw0rd'); await page.waitForTimeout(100);
  ok(['很弱', '弱'].includes(await page.textContent('#grade')), 'UI 檢查 P@ssw0rd：' + await page.textContent('#grade'));
  const ls = await page.evaluate(() => JSON.stringify(localStorage));
  ok(!/P@ssw0rd/.test(ls) && !ls.includes(pw1) && ls.includes('pass-forge:v1:opts'), 'localStorage 只有設定，無任何密碼');
  await page.fill('#check-input', '');
  await page.click('#tab-random'); await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, '390x844.png') });
  await page.click('#tab-check'); await page.fill('#check-input', 'qwerty2024'); await page.click('#btn-show');
  await page.screenshot({ path: path.join(OUT, '390x844-check.png'), fullPage: true });
  await page.click('#tab-random');
  ok(errors.length === 0, 'no console errors ' + errors.join(' | '));
  await ctx.close();

  for (const [name, o] of [['360x780', { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['844x390', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['390x844-dark', { ...mob, colorScheme: 'dark' }]]) {
    const r = await open(browser, o);
    if (name.includes('dark')) await r.page.click('#tab-phrase');
    const m = await r.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(m.sw <= m.iw && m.iw === o.viewport.width, `${name} 無水平捲動（${m.sw}/${m.iw}）`);
    ok(r.errors.length === 0, `${name} 無錯誤`);
    await r.page.screenshot({ path: path.join(OUT, name + '.png') });
    if (name.includes('dark')) {
      const cr = await r.page.evaluate(() => {
        const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
        const bg = getComputedStyle(document.querySelector('.result')).backgroundColor;
        return ['u', 'l', 'd', 's'].map(k => { const el = document.createElement('span'); el.className = k; document.getElementById('pw').appendChild(el); const c = getComputedStyle(el).color; el.remove(); const a = lum(c), b = lum(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); });
      });
      ok(cr.every(c => c >= 4.5), '深色字元著色對比 ' + cr.map(c => c.toFixed(1)).join(', '));
    }
    await r.ctx.close();
  }
  { // 淺色對比
    const r = await open(browser, mob);
    const cr = await r.page.evaluate(() => {
      const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
      const bg = getComputedStyle(document.querySelector('.result')).backgroundColor;
      return [...document.querySelectorAll('#pw span')].slice(0, 1).length ? ['u', 'l', 'd', 's'].map(k => { const el = document.createElement('span'); el.className = k; document.getElementById('pw').appendChild(el); const c = getComputedStyle(el).color; el.remove(); const a = lum(c), b = lum(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }) : [];
    });
    ok(cr.every(c => c >= 4.5), '淺色字元著色對比 ' + cr.map(c => c.toFixed(1)).join(', '));
    await r.ctx.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
