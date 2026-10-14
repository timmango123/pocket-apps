// Verify html-playground: node demo/verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n) });
(async () => {
  const browser = await chromium.launch(); const errors = [];
  // errors printed by the user's preview code (about:srcdoc) are intended; the tool itself must stay clean
  const watch = p => { p.on('console', m => { if (m.type() === 'error' && !/srcdoc|cdn\.invalid\.example/.test(m.location().url || '')) errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const mob = (w, h, extra = {}) => browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...extra });
  const noHScroll = async (p, label) => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ': no horizontal scroll');
  const ready = p => p.waitForFunction(() => window.__hp && window.__hp.ready);
  const pv = p => p.frames().find(f => f.url() === 'about:srcdoc');
  const logs = p => p.$$eval('#logs .log', ns => ns.map(n => n.className.replace('log ', '') + '|' + n.textContent));
  const waitLog = (p, re, ms = 5000) => p.waitForFunction(src => [...document.querySelectorAll('#logs .log')].some(n => new RegExp(src).test(n.textContent)), re.source, { timeout: ms });
  const setCode = async (p, k, code) => { await p.click('#tab' + k); await p.fill('#ed' + k, code); };

  const ctx = await mob(390, 844); const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await ready(page); await page.waitForTimeout(400);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  await noHScroll(page, '390');
  assert(await page.inputValue('#projName') === '範例：按鈕計數器', 'first run opens labelled example project');
  assert(await page.evaluate(() => window.__hp.useLS) === false, 'IndexedDB storage in use');
  let f = pv(page); await f.waitForSelector('#num');
  assert(await f.textContent('#num') === '0', 'preview renders example HTML');
  assert(await page.getAttribute('#pv', 'sandbox') === 'allow-scripts allow-modals allow-forms', 'sandbox without allow-same-origin');
  await page.click('#conToggle');
  await waitLog(page, /計數器已就緒 \{start: 0\}/);
  await f.click('#plus'); await f.click('#plus');
  await waitLog(page, /目前數字： 2/);
  assert(await f.textContent('#num') === '2', 'clicks inside preview work (count 2)');
  assert(await page.textContent('#cntJs') === String((await page.inputValue('#edJs')).length), 'JS tab shows char count');
  await shot(page, '390x844.png');

  // serialisation: object, depth limit, circular, DOM node
  await setCode(page, 'Js', "console.log({a:1, b:[1,2], c:{d:{e:{f:{g:1}}}}});\nconst o = {name:'x'}; o.self = o; console.log(o);\nconsole.log(document.body, 'txt', null);\nconsole.warn('小心');\n");
  await waitLog(page, /\{a: 1, b: \[1, 2\], c: \{d: \{e: \{f: \{…\}\}\}\}\}/);
  await waitLog(page, /\{name: "x", self: \[循環參照\]\}/);
  await waitLog(page, /^<body> txt null$/);
  assert(await page.textContent('#cntWarn') === '1', 'warn counted');
  console.log('  ok - auto-run after typing: object / depth-4 / circular / DOM node serialised');

  // error with JS line number
  await setCode(page, 'Js', "let x = 1;\nfoo();\n");
  await waitLog(page, /JS 第 2 行.*foo is not defined/);
  console.log('  ok - uncaught error reported with "JS 第 2 行"');
  // promise rejection + offline resource
  await setCode(page, 'Js', "Promise.reject(new Error('nope'));\n");
  await waitLog(page, /未處理的 Promise 拒絕：nope/);
  await setCode(page, 'Html', '<script src="https://cdn.invalid.example/lib.js"><\/script><p id="p">hi</p>\n');
  await waitLog(page, /載入失敗（可能離線）：https:\/\/cdn\.invalid\.example\/lib\.js/, 8000);
  console.log('  ok - unhandled rejection and failed external script reported');

  // sandbox: preview cannot read the tool's localStorage; one-line eval
  await page.fill('#conIn', '1 + 2'); await page.press('#conIn', 'Enter');
  await waitLog(page, /^← 3$/);
  await page.fill('#conIn', "(()=>{try{localStorage.getItem('html-playground:v1:settings');return 'READ-OK'}catch(e){return 'blocked:'+e.name}})()"); await page.press('#conIn', 'Enter');
  await waitLog(page, /← "blocked:SecurityError"/);
  console.log('  ok - console input evaluates in preview; preview localStorage blocked (SecurityError)');

  // infinite loops in safe mode
  for (const loop of ["console.log('start');\nwhile (true) {}\n", "for (let i = 0; ; i++) { }\n", "let n = 0;\ndo { n++; } while (true);\n", "while(true);\n"]) {
    await page.click('#conClear'); const t0 = Date.now(); await setCode(page, 'Js', loop);
    await waitLog(page, /迴圈超過 2 秒，已中止/, 8000);
    const dt = Date.now() - t0;
    const t1 = Date.now(); await page.evaluate(() => 1); const resp = Date.now() - t1;
    assert(dt < 6000 && resp < 500, `safe mode aborts ${JSON.stringify(loop.trim().split('\n').pop())} in ${dt} ms (incl. 0.8 s debounce), page responsive (${resp} ms)`);
  }
  assert(/__g\(\);/.test(await page.evaluate(() => window.__hp.guardLoops('for (const a of [1]) { x(a) }'))) && await page.evaluate(() => window.__hp.guardLoops("const s = 'while(1){}';")) === "const s = 'while(1){}';", 'guard skips strings, instruments real loops');

  // canvas template (loops inside rAF) must not be falsely aborted
  await page.click('#moreBtn'); await page.click('#mTpl'); await page.click('#tpl-canvas'); await page.waitForTimeout(3200);
  assert(!(await logs(page)).some(l => /迴圈超過/.test(l)), 'Canvas animation runs 3 s without false loop abort');
  assert(await page.inputValue('#projName') === 'Canvas 動畫', 'template created as new project');

  // editor helpers
  await setCode(page, 'Html', ''); await page.focus('#edHtml');
  await page.keyboard.type('<div class="a">');
  assert(await page.inputValue('#edHtml') === '<div class="a"></div>', 'auto close tag: <div class="a"></div>');
  await page.keyboard.press('Enter'); await page.keyboard.type('x');
  assert(await page.inputValue('#edHtml') === '<div class="a">\n  x\n</div>', 'Enter between tags expands with indent');
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('<br>');
  assert(await page.inputValue('#edHtml') === '<div class="a">\n  x\n  <br>\n</div>', 'Enter keeps indent; void <br> not closed');
  assert((await page.textContent('#gutter')).trim().split('\n').length === 4, 'line numbers follow (4 lines)');
  await setCode(page, 'Js', ''); await page.focus('#edJs');
  await page.keyboard.type('if (a) {'); await page.keyboard.press('Enter'); await page.keyboard.type("f('x');");
  assert(await page.inputValue('#edJs') === "if (a) {\n  f('x');\n}", 'bracket/quote pairing + overtype + block indent: ' + JSON.stringify(await page.inputValue('#edJs')));
  await page.keyboard.press('Tab');
  assert((await page.inputValue('#edJs')).includes("f('x');  "), 'Tab inserts 2 spaces');
  await page.click('#keys button:has-text("=")');
  assert((await page.inputValue('#edJs')).includes("f('x');  ="), 'quick key inserts "=" at caret');
  await page.click('#moreBtn'); await page.click('#mSet'); await page.uncheck('#sBr'); await page.uncheck('#sTag'); await page.click('#dlgSet [data-close]');
  await setCode(page, 'Js', ''); await page.focus('#edJs'); await page.keyboard.type('a(');
  assert(await page.inputValue('#edJs') === 'a(', 'pairing can be switched off');
  await page.click('#moreBtn'); await page.click('#mSet'); await page.check('#sBr'); await page.check('#sTag'); await page.click('#dlgSet [data-close]');

  // manual run with auto-run off, Ctrl+Enter
  await page.uncheck('#autoChk');
  await setCode(page, 'Js', ''); await setCode(page, 'Css', ''); await setCode(page, 'Html', '<h1 id="h">手動</h1>'); await page.waitForTimeout(1200);
  f = pv(page); assert(await f.$('#h') === null, 'auto-run off: no update while typing');
  await page.focus('#edHtml'); await page.keyboard.press('Control+Enter'); await page.waitForTimeout(300);
  f = pv(page); assert(await f.textContent('#h') === '手動', 'Ctrl+Enter runs');
  await page.fill('#edHtml', ''); await page.click('#runBtn'); await page.waitForTimeout(300);
  assert((await pv(page).textContent('body')).includes('三個分頁都是空的'), 'all tabs empty -> hint in preview');
  await page.check('#autoChk');

  // device width, divider, fullscreen
  await page.selectOption('#pvWidth', '768'); await page.waitForTimeout(100);
  const fr = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('pv')); return { w: s.width, t: s.transform }; });
  assert(fr.w === '768px' && fr.t.startsWith('matrix(0.4'), '768 px preview scaled to fit: ' + fr.t);
  await page.selectOption('#pvWidth', 'auto');
  const dv = await page.locator('#divider').boundingBox(); const sp = await page.locator('#split').boundingBox();
  await page.mouse.move(dv.x + dv.width / 2, dv.y + dv.height / 2); await page.mouse.down(); await page.mouse.move(dv.x + dv.width / 2, sp.y + sp.height * 0.3, { steps: 4 }); await page.mouse.up();
  const r = await page.evaluate(() => window.__hp.S.ratio);
  assert(Math.abs(r - 0.3) < 0.03, 'divider drag sets ratio ~0.30 (' + r.toFixed(3) + ')');
  await page.click('#fullBtn');
  const fb = await page.locator('#pvPane').boundingBox();
  assert(fb.width === 390 && fb.height === 844, 'fullscreen preview covers viewport');
  await page.click('#fullBtn');
  await page.evaluate(() => { window.__hp.S.ratio = 0.5; }); await page.keyboard.press('Escape');

  // project management + persistence
  await page.click('#moreBtn'); await page.click('#mNew'); await page.waitForTimeout(300);
  await page.fill('#projName', '我的測試頁'); await setCode(page, 'Html', '<p id="keep">保留我</p>'); await setCode(page, 'Css', 'p{color:red}');
  await page.waitForTimeout(1300);
  let list = await page.evaluate(() => window.__hp.allProjects().then(l => l.map(p => p.name)));
  assert(list[0] === '我的測試頁' && list.length === 3, 'autosave (1 s) -> 3 projects, newest first: ' + list.join(' / '));
  await page.reload(); await ready(page); await page.waitForTimeout(400);
  assert(await page.inputValue('#projName') === '我的測試頁' && await page.inputValue('#edHtml') === '<p id="keep">保留我</p>' && await page.inputValue('#edCss') === 'p{color:red}', 'reload restores current project content');
  assert(await pv(page).textContent('#keep') === '保留我', 'preview re-rendered after reload');
  await page.click('#worksBtn'); await page.waitForTimeout(150);
  assert(await page.locator('#wlist li').count() === 3, 'works drawer lists 3');
  await page.click('#del2'); assert(await page.isVisible('#dlgConfirm'), 'delete asks for in-page confirmation');
  await page.click('#cfNo'); assert(await page.locator('#wlist li').count() === 3, 'cancel keeps project');
  await page.click('#del2'); await page.click('#cfYes'); await page.waitForTimeout(200);
  assert(await page.locator('#wlist li').count() === 2, 'confirmed delete removes project');
  await page.click('#dlgWorks [data-close]');

  // import .html
  await page.click('#moreBtn');
  await page.setInputFiles('#importFile', { name: 'demo.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><html><head><title>匯入測試</title><style>h2{color:blue}</style></head><body><h2 id="t">Hi</h2><script>console.log("imported")<\/script></body></html>') });
  await page.waitForTimeout(500);
  assert(await page.inputValue('#projName') === '匯入測試' && await page.inputValue('#edCss') === 'h2{color:blue}\n' && await page.inputValue('#edJs') === 'console.log("imported")\n' && (await page.inputValue('#edHtml')).startsWith('<h2 id="t">Hi</h2>'), 'import splits style / script / body');
  await waitLog(page, /^imported$/);
  const exp = await page.evaluate(() => window.__hp.buildDoc(true));
  assert(exp.startsWith('<!doctype html>') && exp.includes('<title>匯入測試</title>') && exp.includes('h2{color:blue}') && !exp.includes('__g') && !exp.includes('postMessage'), 'export = clean single HTML (no bridge)');
  assert(await page.isHidden('#mDl'), 'download hidden without downloads capability (copy offered)');
  await page.keyboard.press('Escape');
  await noHScroll(page, '390 after flows');
  await page.click('#worksBtn'); await page.waitForTimeout(150); await shot(page, '390x844-works.png'); await page.click('#dlgWorks [data-close]');
  await ctx.close();

  const sizes = [[360, 780, '360x780.png'], [844, 390, '844x390.png']];
  for (const [w, h, name] of sizes) {
    const c = await mob(w, h); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await ready(p); await p.waitForTimeout(400);
    assert(await p.evaluate(() => innerWidth) === w, `innerWidth ${w}`);
    await noHScroll(p, name);
    if (w > h) { const e = await p.locator('#edPane').boundingBox(), v = await p.locator('#pvPane').boundingBox(); assert(v.x > e.x + e.width - 1, 'landscape: editor and preview side by side'); }
    await p.click('#conToggle'); await p.waitForTimeout(200);
    await shot(p, name);
    await p.click('#moreBtn'); await p.waitForTimeout(100); await noHScroll(p, name + ' menu'); await shot(p, name.replace('.png', '-menu.png')); await p.keyboard.press('Escape');
    await c.close();
  }
  const cd = await mob(390, 844, { colorScheme: 'dark' }); const pd = await cd.newPage(); watch(pd);
  await pd.goto(URL_); await ready(pd); await pd.waitForTimeout(400);
  assert(await pd.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(15, 17, 20)', 'dark theme background');
  await pd.click('#tabJs'); await shot(pd, '390x844-dark.png'); await cd.close();
  const ck = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const pk = await ck.newPage(); watch(pk);
  await pk.goto(URL_); await ready(pk); await pk.waitForTimeout(400); await noHScroll(pk, '1280');
  assert(await pk.isHidden('#keys'), 'desktop: quick-key strip hidden (fine pointer)');
  await pk.click('#conToggle'); await pk.waitForTimeout(150);
  await shot(pk, '1280x800.png'); await ck.close();

  assert(errors.length === 0, 'no console errors / page errors from the tool' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log('ALL PASSED');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
