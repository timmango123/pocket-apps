// Verify werewolf-host in Chromium: run with `node verify.js`
// Checks 390×844 plus the three lobby iframe sizes, light and dark: no page errors, no horizontal overflow,
// touch targets >= 44px, and drives both flows (誰是臥底 deal → speak → vote → result; 狼人殺 deal → night → day → result).
// Writes demo/cover-390x520.png and a few screenshots.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(os.tmpdir(), 'werewolf-host-wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const txt = (page, sel) => page.textContent(sel).then(s => s.trim());

(async () => {
  const browser = await chromium.launch();
  const mk = async (opt = {}) => {
    const ctx = await browser.newContext({ viewport: opt.viewport || { width: 390, height: 844 }, isMobile: opt.mobile !== false, hasTouch: opt.mobile !== false, deviceScaleFactor: 2, colorScheme: opt.dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    const page = await ctx.newPage(), errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(200);
    return { ctx, page, errors };
  };
  const checkLayout = async (page, label) => {
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${label} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input, textarea, summary')].filter(e => e.offsetParent && e.type !== 'checkbox').map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, w: r.width, h: r.height }; }).filter(r => r.w < 44 || r.h < 44));
    ok(small.length === 0, `${label} touch targets >= 44px ${JSON.stringify(small)}`);
  };

  // --- sizes, light & dark, both setup modes ---
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 } },
    { name: '375x500', viewport: { width: 375, height: 500 } },
    { name: '390x610', viewport: { width: 390, height: 610 } },
    { name: '430x740', viewport: { width: 430, height: 740 } },
    { name: '844x390', viewport: { width: 844, height: 390 } },
    { name: '1280x800', viewport: { width: 1280, height: 800 }, mobile: false },
  ];
  for (const dark of [false, true]) for (const s of sizes) {
    const label = s.name + (dark ? '-dark' : '');
    const { ctx, page, errors } = await mk({ ...s, dark });
    await checkLayout(page, label + ' setup-uc');
    if (!dark || s.name === '375x500') await page.screenshot({ path: `${OUT}/${label}-setup.png` });
    await page.click('#mode-ww'); await page.waitForTimeout(50);
    await checkLayout(page, label + ' setup-ww');
    ok(errors.length === 0, `${label} no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- 誰是臥底 flow at 375x500 (smallest iframe) ---
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 375, height: 500 } });
    ok(!(await page.isVisible('#sample-badge')) === false, 'sample badge shown on first open');
    await page.click('#start-btn'); await page.waitForTimeout(50);
    ok(await page.isVisible('#s-deal'), 'start opens the dealing screen');
    const n = 8; const words = [];
    for (let i = 0; i < n; i++) {
      const pass = await txt(page, '#deal-box');
      ok(!/你的詞|白板（沒有詞）/.test(pass), `player ${i + 1}: pass screen shows no word`);
      await page.click('#deal-show'); await page.waitForTimeout(30);
      const w = await txt(page, '.reveal .word');
      words.push(w);
      if (i === 0) { await page.screenshot({ path: `${OUT}/375x500-reveal.png` }); await checkLayout(page, '375x500 reveal'); }
      await page.click('#deal-hide'); await page.waitForTimeout(30);
    }
    ok(new Set(words).size === 2 && words.every(w => w), `8 players saw exactly two different words: ${[...new Set(words)].join(' / ')}`);
    await page.click('#deal-done'); await page.waitForTimeout(50);
    ok(await page.isVisible('#s-uc'), 'round screen after dealing');
    await checkLayout(page, '375x500 speaking');
    await page.screenshot({ path: `${OUT}/375x500-speak.png` });
    if (await page.isVisible('#t-toggle')) { await page.click('#t-toggle'); await page.waitForTimeout(1100); const t = await txt(page, '#uc-timer'); ok(/0:5[0-9]/.test(t), `timer counts down (${t})`); }
    for (let i = 0; i < n; i++) await page.click('#uc-next');
    await page.waitForTimeout(50);
    ok(/投票/.test(await txt(page, '#uc-phase')), 'after all speakers: vote phase');
    await checkLayout(page, '375x500 vote');
    await page.screenshot({ path: `${OUT}/375x500-vote.png` });
    // eliminate players until the game ends (max 7 votes)
    let rounds = 0;
    while (!(await page.isVisible('#s-result')) && rounds < 8) {
      if (await page.isVisible('#g-yes')) { await page.click('#g-no'); await page.waitForTimeout(50); continue; }
      if (/發言/.test(await txt(page, '#uc-phase'))) { for (let i = 0; i < 8; i++) if (await page.isVisible('#uc-next')) await page.click('#uc-next'); await page.waitForTimeout(30); continue; }
      const b = page.locator('.pbtn[data-i]:not([disabled])').first(); await b.click();
      await page.click('[data-x="ok"]'); await page.waitForTimeout(50);
      if (await page.isVisible('[data-x="ok"]')) await page.click('[data-x="ok"]');
      await page.waitForTimeout(50); rounds++;
    }
    ok(await page.isVisible('#s-result'), `誰是臥底 reaches a result after ${rounds} votes: ` + (await txt(page, '.banner .w')).trim());
    await checkLayout(page, '375x500 result');
    await page.screenshot({ path: `${OUT}/375x500-result.png` });
    await page.click('#back'); ok(await page.isVisible('#s-setup'), 'back to setup');
    ok(errors.length === 0, `誰是臥底 flow no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- 狼人殺 flow at 390x610 ---
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 390, height: 610 } });
    await page.click('#mode-ww'); await page.waitForTimeout(50);
    ok((await txt(page, '#role-sum')).includes('共 8 ／ 8'), 'preset for 8 players sums to 8');
    await page.click('#start-btn'); await page.waitForTimeout(50);
    const roles = [];
    for (let i = 0; i < 8; i++) {
      ok(!(await txt(page, '#deal-box')).includes('你的身分'), `ww player ${i + 1}: pass screen hides the role`);
      await page.click('#deal-show'); await page.waitForTimeout(30);
      roles.push(await txt(page, '.reveal .role'));
      if (roles[i] === '狼人') ok((await txt(page, '.reveal')).includes('同伴'), 'wolf sees teammates');
      await page.click('#deal-hide'); await page.waitForTimeout(30);
    }
    ok(roles.filter(r => r === '狼人').length === 2 && roles.includes('預言家') && roles.includes('女巫') && roles.includes('獵人'), 'dealt roles match preset: ' + roles.join(','));
    await page.click('#deal-done'); await page.waitForTimeout(50);
    ok(await page.isVisible('#s-ww') && /天黑請閉眼/.test(await txt(page, '.script .line')), 'night 1 opens with 天黑請閉眼');
    await checkLayout(page, '390x610 night');
    await page.screenshot({ path: `${OUT}/390x610-night.png` });
    await page.click('#n-next'); // wolf
    ok(await page.isDisabled('#n-next'), 'wolf step needs a target before continuing');
    const G = () => page.evaluate(() => { const g = window.__wh.G; return { players: g.players.map(p => ({ role: p.role, alive: p.alive })), act: g.act, phase: g.phase, night: g.night, result: g.result }; });
    let g = await G();
    const seerIdx = g.players.findIndex(p => p.role === 'seer'), villIdx = g.players.findIndex(p => p.role === 'villager'), wolfIdx = g.players.findIndex(p => p.role === 'wolf');
    await page.click(`.pbtn[data-i="${villIdx}"]`); await page.waitForTimeout(30);
    await checkLayout(page, '390x610 wolf pick');
    await page.screenshot({ path: `${OUT}/390x610-wolf.png` });
    await page.click('#n-next'); // witch
    ok((await txt(page, '.secret')).includes('今晚被殺'), 'witch step shows the host who was killed');
    await page.click('#w-save'); await page.waitForTimeout(30);
    ok(await page.$('#w-save[aria-pressed="true"]') !== null, 'witch save selected');
    await page.click('#n-next'); // seer
    await page.click(`.pbtn[data-i="${wolfIdx}"]`); await page.waitForTimeout(30);
    ok((await txt(page, '.secret')).includes('是狼人'), 'seer result shown to host');
    await page.click('#n-next'); // dawn
    ok((await txt(page, '.notice')).includes('平安夜'), 'dawn preview: saved target means a peaceful night');
    await page.click('#n-next'); await page.waitForTimeout(50); // resolve
    g = await G();
    ok(g.phase === 'day' && g.players.every(p => p.alive), 'day 1: everyone alive after the save');
    await checkLayout(page, '390x610 day');
    await page.screenshot({ path: `${OUT}/390x610-day.png` });
    await page.click('#to-vote'); await page.waitForTimeout(30);
    await page.click(`.pbtn[data-i="${wolfIdx}"]`); await page.click('[data-x="ok"]'); await page.waitForTimeout(50);
    g = await G();
    ok(!g.players[wolfIdx].alive && g.phase === 'night' && g.night === 2, 'voted wolf out, night 2 starts');
    // night 2: kill the seer, witch has no save left -> dies; then hunter? no. Then day vote the other wolf -> good wins
    await page.click('#n-next'); await page.click(`.pbtn[data-i="${seerIdx}"]`); await page.click('#n-next');
    ok((await txt(page, '#ww-box')).includes('解藥已經用過'), 'witch cannot save twice');
    await page.click('#n-next'); await page.click('#n-next'); // seer (skip), dawn
    ok((await txt(page, '.notice')).includes('昨晚死亡'), 'dawn preview lists the death');
    await page.click('#n-next'); await page.waitForTimeout(50);
    g = await G(); ok(!g.players[seerIdx].alive, 'seer died on night 2');
    await page.click('#to-vote');
    const wolf2 = g.players.findIndex((p, i) => p.role === 'wolf' && p.alive);
    await page.click(`.pbtn[data-i="${wolf2}"]`); await page.click('[data-x="ok"]'); await page.waitForTimeout(80);
    ok(await page.isVisible('#s-result') && (await txt(page, '.banner .w')) === '好人獲勝', '狼人殺 ends with 好人獲勝 when both wolves are out');
    await checkLayout(page, '390x610 ww result');
    await page.screenshot({ path: `${OUT}/390x610-ww-result.png` });
    ok((await txt(page, '.log')).includes('預言家查驗'), 'log records the seer check');
    ok(errors.length === 0, `狼人殺 flow no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- cover: night script screen with the sample names ---
  {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 520 } });
    await page.click('#mode-ww'); await page.click('#start-btn');
    for (let i = 0; i < 8; i++) { await page.click('#deal-show'); await page.click('#deal-hide'); }
    await page.click('#deal-done'); await page.click('#n-next'); await page.waitForTimeout(50);
    const tgt = await page.evaluate(() => window.__wh.G.players.find(p => p.role === 'villager').i);
    await page.click(`.pbtn[data-i="${tgt}"]`); await page.waitForTimeout(50);
    await page.screenshot({ path: `${OUT}/cover-390x520.png` });
    ok(fs.existsSync(`${OUT}/cover-390x520.png`), 'cover-390x520.png written');
    await ctx.close();
  }

  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
