// Verify werewolf-host in Chromium: run with `node verify.js`
// Checks the lobby iframe sizes plus 360×640, 390×844, 430×932, landscape and desktop, light and dark: no page errors,
// no horizontal overflow, touch targets >= 44px. Drives both flows (誰是臥底 deal → speak → vote → result;
// 狼人殺 deal → night → day → result), the secrecy of the pass-the-phone deal (hold to reveal, double taps never
// open the next card, a reload never reopens a card), undo, refresh persistence, pasting a name list and rapid taps.
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
const wait = ms => new Promise(r => setTimeout(r, ms));

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
    const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input, textarea, summary')].filter(e => e.offsetParent && e.type !== 'checkbox' && !e.closest('[hidden]')).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, w: r.width, h: r.height }; }).filter(r => r.w < 44 || r.h < 44));
    ok(small.length === 0, `${label} touch targets >= 44px ${JSON.stringify(small)}`);
    // the dock never hides the end of the page: the last content box can scroll fully above it
    const hid = await page.evaluate(() => { const d = document.getElementById('dock'); if (d.hidden) return 0; const screen = [...document.querySelectorAll('.screen')].find(s => !s.hidden); const last = screen.lastElementChild; if (!last) return 0; window.scrollTo(0, document.documentElement.scrollHeight); const r = last.getBoundingClientRect(), dr = d.getBoundingClientRect(); window.scrollTo(0, 0); return Math.max(0, r.bottom - dr.top); });
    ok(hid <= 1, `${label} bottom bar leaves the last content visible (overlap ${hid.toFixed(1)}px)`);
  };
  // hold-to-reveal: press, keep the finger down for 0.6 s, release
  const hold = async (page, sel) => { const b = await page.locator(sel).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await wait(600); await page.mouse.up(); await wait(40); };
  const cover = async page => { await wait(620); await page.click('#deal-hide'); };
  // real touch through CDP: finger down on the hold button, keep it there, lift it. The lift must not close the card.
  const touchHold = async (page, sel, ms) => {
    const cdp = await page.context().newCDPSession(page);
    const b = await page.locator(sel).boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await wait(ms);
    const open = await page.isVisible('.reveal');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(150);
    const still = await page.isVisible('.reveal'); await cdp.detach();
    return { open, still };
  };
  const touchTap = async (page, sel) => {
    const cdp = await page.context().newCDPSession(page);
    const b = await page.locator(sel).boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await wait(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(120); await cdp.detach();
  };
  const dealAll = async (page, n, each) => { for (let i = 0; i < n; i++) { await wait(520); await hold(page, '#deal-show'); if (each) await each(i); await cover(page); } };

  // --- sizes, light & dark, both setup modes ---
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 } },
    { name: '375x500', viewport: { width: 375, height: 500 } },
    { name: '390x610', viewport: { width: 390, height: 610 } },
    { name: '430x740', viewport: { width: 430, height: 740 } },
    { name: '360x640', viewport: { width: 360, height: 640 } },
    { name: '430x932', viewport: { width: 430, height: 932 } },
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
    await page.click('#start-btn'); await page.waitForTimeout(50);
    await checkLayout(page, label + ' pass');
    await hold(page, '#deal-show');
    await checkLayout(page, label + ' reveal');
    if (s.name === '360x640' || s.name === '844x390') await page.screenshot({ path: `${OUT}/${label}-reveal.png` });
    ok(errors.length === 0, `${label} no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- 誰是臥底 flow at 375x500 (smallest iframe) ---
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 375, height: 500 } });
    ok(await page.isVisible('#sample-badge'), 'sample badge shown on first open');
    // rapid taps on a stepper: every tap counts once
    for (let i = 0; i < 5; i++) await page.click('#cnt-plus');
    ok((await txt(page, '#cnt-out')) === '13', 'five quick taps on + take 8 players to 13');
    for (let i = 0; i < 5; i++) await page.click('#cnt-minus');
    ok((await txt(page, '#cnt-out')) === '8', '…and five taps on − bring it back to 8');
    await page.click('#start-btn'); await page.waitForTimeout(50);
    ok(await page.isVisible('#s-deal'), 'start opens the dealing screen');
    // secrecy: a plain tap or a double tap never shows a word
    await page.click('#deal-show'); await page.waitForTimeout(80);
    ok(!(await page.isVisible('.reveal')), 'a quick tap on the reveal button does not show the card (must hold)');
    await page.dblclick('#deal-show'); await page.waitForTimeout(80);
    ok(!(await page.isVisible('.reveal')), 'a double tap does not show the card');
    const n = 8; const words = [];
    for (let i = 0; i < n; i++) {
      await wait(520);
      const pass = await txt(page, '#deal-box');
      ok(!(await page.isVisible('.reveal')) && !/白板（沒有詞）/.test(pass) && !words.some(w => pass.includes(w)), `player ${i + 1}: pass screen shows no word`);
      await hold(page, '#deal-show');
      const w = await txt(page, '.reveal .word');
      words.push(w);
      if (i === 0) { await page.screenshot({ path: `${OUT}/375x500-reveal.png` }); await checkLayout(page, '375x500 reveal'); }
      if (i === 2) {
        // the last player double-taps "cover": the second tap must not open the next player's card
        await wait(620); await page.dblclick('#deal-hide'); await page.waitForTimeout(80);
        ok(!(await page.isVisible('.reveal')) && (await txt(page, '#deal-meta')).startsWith('4'), 'double tap on "cover" goes to player 4 and keeps the card closed');
        continue;
      }
      await cover(page);
    }
    ok(new Set(words).size === 2 && words.every(w => w), `8 players saw exactly two different words: ${[...new Set(words)].join(' / ')}`);
    await page.click('#deal-done'); await page.waitForTimeout(50);
    ok(await page.isVisible('#s-uc'), 'round screen after dealing');
    await checkLayout(page, '375x500 speaking');
    await page.screenshot({ path: `${OUT}/375x500-speak.png` });
    await page.click('#t-toggle'); await page.waitForTimeout(1100); const t = await txt(page, '#uc-timer'); ok(/0:5[0-9]/.test(t), `timer counts down (${t})`);
    await page.click('#uc-next'); await page.waitForTimeout(1100);
    ok(/0:5[0-9]/.test(await txt(page, '#uc-timer')), 'the next speaker\'s timer starts by itself');
    await page.click('#undo-btn'); await page.waitForTimeout(50);
    ok(await page.evaluate(() => window.__wh.G.speaker) === 0, 'undo goes back to the first speaker');
    for (let i = 0; i < n; i++) await page.click('#uc-next');
    await page.waitForTimeout(50);
    ok(/投票/.test(await txt(page, '#uc-phase')), 'after all speakers: vote phase');
    ok(await page.isDisabled('#uc-out'), 'eliminate button waits for a pick');
    await checkLayout(page, '375x500 vote');
    await page.screenshot({ path: `${OUT}/375x500-vote.png` });
    // pick a civilian, eliminate, then undo
    const civ = await page.evaluate(() => window.__wh.G.players.find(p => p.role === 'civ').i);
    await page.click(`.pbtn[data-i="${civ}"]`); await page.click('#uc-out'); await page.waitForTimeout(50);
    ok(/是平民/.test(await txt(page, '.sheet')), 'elimination reveals the identity');
    await page.click('[data-x="ok"]');
    await page.click('#undo-btn'); await page.waitForTimeout(50);
    ok(await page.evaluate(c => window.__wh.G.players[c].alive && window.__wh.G.phase === 'vote', civ), 'undo brings the eliminated player back');
    // refresh keeps the game
    await page.reload(); await page.waitForTimeout(200);
    ok(await page.isVisible('#s-uc') && /投票/.test(await txt(page, '#uc-phase')), 'reload resumes the game on the vote');
    let rounds = 0;
    while (!(await page.isVisible('#s-result')) && rounds < 12) {
      if (await page.isVisible('#g-no')) { await page.click('#g-no'); await page.waitForTimeout(30); continue; }
      if (await page.isVisible('#uc-next')) { await page.click('#uc-next'); continue; }
      const b = page.locator('#uc-box .pbtn[data-i]:not([disabled])').first(); await b.click();
      await page.click('#uc-out'); await page.waitForTimeout(30);
      if (await page.isVisible('[data-x="ok"]')) await page.click('[data-x="ok"]');
      rounds++;
    }
    ok(await page.isVisible('#s-result'), `誰是臥底 reaches a result after ${rounds} votes: ` + (await txt(page, '.banner .w')).trim());
    await checkLayout(page, '375x500 result');
    await page.screenshot({ path: `${OUT}/375x500-result.png` });
    await page.click('#back'); await page.click('[data-x="ok"]'); ok(await page.isVisible('#s-setup'), 'back to setup (after confirm)');
    ok(errors.length === 0, `誰是臥底 flow no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- reload during the deal never reopens a card ---
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 390, height: 844 } });
    await page.click('#start-btn'); await hold(page, '#deal-show');
    ok(await page.isVisible('.reveal'), 'card open before reload');
    await page.reload(); await page.waitForTimeout(200);
    ok(await page.isVisible('#s-deal') && !(await page.isVisible('.reveal')) && (await txt(page, '#deal-meta')).startsWith('1'), 'after reload the deal resumes on the closed pass screen');
    // paste a name list into the first box after quitting
    await page.click('#menu-btn'); await page.click('[data-m="quit"]'); await page.click('[data-x="ok"]');
    await page.evaluate(() => { const inp = document.querySelector('#names input'); const dt = new DataTransfer(); dt.setData('text/plain', '1. 小王\n2. 小李\n3、小陳\n阿明, 阿芳，阿傑、美美\n大雄\n靜香\n胖虎'); inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await page.waitForTimeout(50);
    const got = await page.evaluate(() => [...document.querySelectorAll('#names input')].map(i => i.value));
    ok(got.length === 10 && got[0] === '小王' && got[2] === '小陳' && got[6] === '美美' && got[9] === '胖虎', 'pasting a 10-name list fills the seats and grows the count: ' + got.join(','));
    await page.fill('#names input >> nth=1', '小王');
    ok(await page.isVisible('#dup-warn'), 'duplicate names are flagged');
    ok(errors.length === 0, `reload/paste no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- real touch: lifting the finger after the hold never counts as a tap on 蓋起來 (deal and 重看) ---
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 390, height: 844 } });
    await page.click('#mode-ww'); await page.click('#start-btn');
    let bad = 0, runs = 0;
    for (const ms of [520, 800, 1500, 2500, 650, 1000]) {
      await wait(560);
      const seat = await txt(page, '#deal-meta');
      const r = await touchHold(page, '#deal-show', ms); runs++;
      if (!r.open || !r.still) { bad++; console.log('  touch hold', ms, 'ms at', seat, JSON.stringify(r)); }
      await wait(650); await touchTap(page, '#deal-hide'); // a fresh tap covers once the card has been open > 600 ms
    }
    ok(bad === 0, `deal: ${runs} real-touch holds, card stays open after the finger lifts (failures ${bad})`);
    const meta = await txt(page, '#deal-meta');
    ok(meta.startsWith('7'), 'deal: each touch tap on 蓋起來 moved exactly one seat (now at ' + meta + ')');
    await wait(560); await touchHold(page, '#deal-show', 700); await wait(500); await touchTap(page, '#deal-hide');
    await wait(560); await touchHold(page, '#deal-show', 700); await wait(500); await touchTap(page, '#deal-hide');
    await page.click('#deal-done'); await page.waitForTimeout(50);
    bad = 0;
    for (const ms of [520, 1200, 2500]) {
      await page.click('#menu-btn'); await page.click('[data-m="peek"]'); await page.click('.sheet .pbtn[data-i="2"]');
      await wait(560);
      const r = await touchHold(page, '#deal-show', ms);
      if (!r.open || !r.still) bad++;
      await wait(650); await touchTap(page, '#deal-hide');
      ok(await page.evaluate(() => window.__wh.view === 'ww'), '重看 ' + ms + ' ms: a later tap on 蓋起來 returns to the game');
    }
    ok(bad === 0, `重看身分: real-touch holds keep the card open after release (failures ${bad})`);
    ok(errors.length === 0, `touch test no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- 誰是臥底 PK and custom words ---
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 375, height: 500 } });
    await page.click('#custom-box summary');
    await page.fill('#custom', 'Taylor Swift／Lady Gaga\n貓 狗 兔\nAC/DC／Queen');
    ok(/第 2 行/.test(await txt(page, '#custom-hint')) && /自訂 ?2/.test((await txt(page, '#cats')).replace(/\s+/g, ' ')), 'custom words: 2 pairs read, line 2 flagged: ' + await txt(page, '#custom-hint'));
    await page.evaluate(() => { const inp = document.querySelector('#names input'); const dt = new DataTransfer(); dt.setData('text/plain', 'Mary Jane'); inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    ok((await txt(page, '#cnt-out')) === '8', 'pasting one name with a space does not split it');
    await page.click('#start-btn'); await dealAll(page, 8); await page.click('#deal-done');
    for (let i = 0; i < 8; i++) await page.click('#uc-next');
    await page.click('#uc-revote');
    ok(await page.isDisabled('.sheet [data-x="ok"]'), 'PK needs at least two players');
    await page.click('.sheet .pbtn[data-i="1"]'); await page.click('.sheet .pbtn[data-i="4"]'); await page.click('.sheet [data-x="ok"]');
    ok(/PK/.test(await txt(page, '#uc-phase')) && await page.evaluate(() => window.__wh.G.order.length === 2), 'tie → PK: only the two tied players speak');
    await page.click('#uc-next'); await page.click('#uc-next');
    ok(await page.isDisabled('#uc-box .pbtn[data-i="0"]') && !(await page.isDisabled('#uc-box .pbtn[data-i="1"]')), 'PK vote: only the tied players can be voted');
    await page.click('#uc-box .pbtn[data-i="4"]'); await page.click('#uc-out'); await page.click('[data-x="ok"]');
    if (await page.isVisible('#s-result')) { await page.click('#back'); ok(await page.isVisible('.sheet') && await page.isVisible('#s-result'), 'leaving the result asks first'); await page.click('[data-x="ok"]'); }
    else ok(await page.evaluate(() => !window.__wh.G.pk), 'after the PK the next round is normal');
    ok(errors.length === 0, `PK test no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- 狼人殺 flow at 390x610 ---
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 390, height: 610 } });
    await page.click('#mode-ww'); await page.waitForTimeout(50);
    ok((await txt(page, '#role-sum')).includes('共 8 ／ 8'), 'preset for 8 players sums to 8');
    await page.click('#start-btn'); await page.waitForTimeout(50);
    const roles = [];
    await dealAll(page, 8, async i => {
      roles.push(await txt(page, '.reveal .role'));
      if (roles[i] === '狼人') ok((await txt(page, '.reveal')).includes('同伴'), 'wolf sees teammates');
    });
    ok(roles.filter(r => r === '狼人').length === 2 && roles.includes('預言家') && roles.includes('女巫') && roles.includes('獵人'), 'dealt roles match preset: ' + roles.join(','));
    await page.click('#deal-done'); await page.waitForTimeout(50);
    ok(await page.isVisible('#s-ww') && /天黑請閉眼/.test(await txt(page, '.script .line')), 'night 1 opens with 天黑請閉眼');
    ok(await page.evaluate(() => document.body.classList.contains('night')), 'night screens switch to the dark night look');
    await checkLayout(page, '390x610 night');
    await page.screenshot({ path: `${OUT}/390x610-night.png` });
    await page.click('#n-next'); // wolf
    ok(await page.isDisabled('#n-next'), 'wolf step needs a target before continuing');
    const G = () => page.evaluate(() => { const g = window.__wh.G; return { players: g.players.map(p => ({ role: p.role, alive: p.alive })), act: g.act, phase: g.phase, night: g.night, result: g.result }; });
    let g = await G();
    const seerIdx = g.players.findIndex(p => p.role === 'seer'), villIdx = g.players.findIndex(p => p.role === 'villager'), wolfIdx = g.players.findIndex(p => p.role === 'wolf');
    await page.click(`.pbtn[data-i="${villIdx}"]`); await page.waitForTimeout(30);
    ok((await txt(page, '#n-next')).includes('殺'), 'next button names the wolves\' target');
    await checkLayout(page, '390x610 wolf pick');
    await page.screenshot({ path: `${OUT}/390x610-wolf.png` });
    await page.click('#n-next'); // witch
    ok((await txt(page, '.secret')).includes('今晚被殺'), 'witch step shows the host who was killed');
    await page.click('#w-save'); await page.waitForTimeout(30);
    ok(await page.$('#w-save[aria-pressed="true"]') !== null, 'witch save selected');
    await page.click('#n-next'); // seer
    ok(await page.isDisabled(`.pbtn[data-i="${seerIdx}"]`), 'seer cannot check himself');
    await page.click(`.pbtn[data-i="${wolfIdx}"]`); await page.waitForTimeout(30);
    ok((await txt(page, '.secret')).includes('是狼人'), 'seer result shown to host');
    await page.click('#undo-btn'); await page.waitForTimeout(30);
    ok(/女巫/.test(await txt(page, '#ww-phase')) && await page.$('#w-save[aria-pressed="true"]') !== null, 'undo steps back to the witch with her choice kept');
    await page.click('#n-next');
    await page.click(`.pbtn[data-i="${wolfIdx}"]`);
    await page.click('#n-next'); // dawn
    ok((await txt(page, '.notice')).includes('平安夜'), 'dawn preview: saved target means a peaceful night');
    await page.click('#n-next'); await page.waitForTimeout(50); // resolve
    g = await G();
    ok(g.phase === 'day' && g.players.every(p => p.alive), 'day 1: everyone alive after the save');
    ok(!(await txt(page, '#ww-meta')).includes('狼'), 'day screen shows only the survivor count, not team counts');
    await checkLayout(page, '390x610 day');
    await page.screenshot({ path: `${OUT}/390x610-day.png` });
    await page.click('#to-vote'); await page.waitForTimeout(30);
    await page.click(`.pbtn[data-i="${wolfIdx}"]`); await page.click('#vote-ok'); await page.waitForTimeout(50);
    g = await G();
    ok(!g.players[wolfIdx].alive && g.phase === 'night' && g.night === 2, 'voted wolf out, night 2 starts');
    await page.reload(); await page.waitForTimeout(200);
    ok(await page.isVisible('#s-ww') && /第 2 夜/.test(await txt(page, '#ww-phase')), 'reload resumes on night 2');
    await page.click('#n-next'); await page.click(`.pbtn[data-i="${seerIdx}"]`); await page.click('#n-next');
    ok((await txt(page, '#ww-box')).includes('解藥已經用過'), 'witch cannot save twice');
    await page.click('#n-next'); await page.click('#n-next'); // seer (skip), dawn
    ok((await txt(page, '.notice')).includes('昨晚死亡'), 'dawn preview lists the death');
    await page.click('#n-next'); await page.waitForTimeout(50);
    g = await G(); ok(!g.players[seerIdx].alive, 'seer died on night 2');
    ok(/沒有遺言/.test(await txt(page, '.script .sub')), 'night-2 deaths get no last words');
    await page.click('#to-vote');
    const wolf2 = g.players.findIndex((p, i) => p.role === 'wolf' && p.alive);
    await page.click(`.pbtn[data-i="${wolf2}"]`); await page.click('#vote-ok'); await page.waitForTimeout(80);
    ok(await page.isVisible('#s-result') && (await txt(page, '.banner .w')) === '好人獲勝', '狼人殺 ends with 好人獲勝 when both wolves are out');
    await checkLayout(page, '390x610 ww result');
    await page.screenshot({ path: `${OUT}/390x610-ww-result.png` });
    ok((await txt(page, '.log')).includes('預言家查驗'), 'log records the seer check');
    ok(await page.isVisible('#copy-log'), 'result has a copy button');
    ok(errors.length === 0, `狼人殺 flow no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- sheriff + hunter shot + explode at 430x740 ---
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 430, height: 740 }, dark: true });
    await page.click('#mode-ww'); await page.click('label.switch:has(#sheriff)');
    await page.click('#start-btn'); await dealAll(page, 8);
    await page.click('#deal-done'); await page.click('#n-next');
    const P = await page.evaluate(() => window.__wh.G.players.map(p => p.role));
    const hunter = P.indexOf('hunter'), wolf = P.indexOf('wolf');
    await page.click(`.pbtn[data-i="${hunter}"]`); await page.click('#n-next'); await page.click('#n-next'); await page.click('#n-next');
    ok(/競選警長/.test(await txt(page, '.script .line')), 'with 警長 on, dawn announces the election instead of the deaths');
    await page.click('#n-next');
    ok(/警長競選/.test(await txt(page, '#ww-phase')), 'sheriff election comes first on day 1');
    await page.screenshot({ path: `${OUT}/430x740-sheriff.png` });
    await page.click(`.pbtn[data-i="${hunter}"]`); await page.click('#sheriff-ok');
    ok(/獵人開槍/.test(await txt(page, '#ww-phase')), 'the killed hunter shoots');
    await page.click('.pbtn[data-i="none"]'); await page.click('#shoot-ok');
    ok(/移交警徽/.test(await txt(page, '#ww-phase')), '…then hands over the badge he just won');
    const other = P.findIndex((r, i) => i !== hunter && r === 'villager');
    await page.click(`.pbtn[data-i="${other}"]`); await page.click('#badge-ok');
    ok(await page.evaluate(() => window.__wh.G.phase === 'day' && window.__wh.G.sheriff !== null), 'day discussion with the new sheriff');
    await page.click('#explode-btn'); await page.click(`.sheet .pbtn[data-i="${wolf}"]`); await page.waitForTimeout(50);
    ok(await page.evaluate(() => window.__wh.G.phase === 'night' && window.__wh.G.night === 2), 'a wolf exploding ends the day at once');
    await checkLayout(page, '430x740-dark night 2');
    ok(errors.length === 0, `sheriff flow no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // --- cover: night script screen with the sample names ---
  {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 520 } });
    await page.click('#mode-ww'); await page.click('#start-btn');
    await dealAll(page, 8);
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
