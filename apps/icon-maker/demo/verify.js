// Verify icon-maker: node demo/verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => {
  const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data; let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); window.__saved.push({ filename, b64: btoa(s), size: buf.length }); } } : null }; };
const py = (code, file) => execFileSync('python3', ['-I', '-c', code, file]).toString().trim();
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(mockDl); await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(400);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.isVisible('#sampleTag') && (await page.inputValue('#txt')) === 'A', 'sample "A" icon shown with 範例 tag');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });
  // pixel checks
  const px = await page.evaluate(() => { const a = (c, x, y) => c.getContext('2d').getImageData(x, y, 1, 1).data[3];
    const S = window.__im.S; const m = window.__im.renderMaster(); const mk = window.__im.renderMaster({ maskable: true });
    S.shape = 'squircle'; const sq = window.__im.renderMaster(); S.shape = 'circle'; const ci = window.__im.renderMaster(); S.shape = 'rounded';
    return { roundCorner: a(m, 2, 2), roundCenter: a(m, 512, 120), maskCorner: a(mk, 2, 2), sqCorner: a(sq, 80, 80), sqEdge: a(sq, 512, 3), circCorner: a(ci, 80, 80), circEdge: a(ci, 512, 3) }; });
  assert(px.roundCorner === 0 && px.roundCenter === 255 && px.maskCorner === 255, 'rounded corners transparent; maskable fills full square ' + JSON.stringify(px));
  assert(px.sqCorner === 255 && px.circCorner === 0 && px.sqEdge === 255, 'superellipse fuller than circle at (80,80)');
  // 16px small optimisation legible: count foreground pixels
  const sm = await page.evaluate(() => { const S = window.__im.S; S.text = 'AB'; const cnt = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++; return n; };
    S.smallOpt = true; const on = cnt(window.__im.iconCanvas('16')); S.smallOpt = false; const off = cnt(window.__im.iconCanvas('16')); S.smallOpt = true; S.text = 'A'; return [on, off]; });
  assert(sm[0] >= 12, '16px icon has visible glyph pixels with small optimisation (on ' + sm[0] + ', off ' + sm[1] + ')');
  // grapheme limit
  await page.fill('#txt', 'ABCD'); assert((await page.inputValue('#txt')) === 'ABC', '4 chars truncated to 3');
  await page.fill('#txt', '👨‍👩‍👧AB'); assert((await page.inputValue('#txt')) === '👨‍👩‍👧AB', 'family emoji counted as 1 grapheme (3 total kept)');
  await page.fill('#txt', '👨‍👩‍👧ABC'); assert((await page.inputValue('#txt')) === '👨‍👩‍👧AB', 'ZWJ emoji + 3 letters truncated to 3 graphemes');
  await page.fill('#txt', '工具');
  // emoji tab search
  await page.click('#tabEmoji'); await page.fill('#emojiQ', '貓');
  const found = await page.$$eval('#emojis button', bs => bs.map(b => b.dataset.e));
  assert(found.includes('🐱') && found.length <= 4, 'search 貓 -> ' + found.join(''));
  await page.fill('#emojiQ', 'coffee'); assert((await page.$$eval('#emojis button', bs => bs.map(b => b.dataset.e))).join('') === '☕', 'search coffee -> ☕');
  await page.fill('#emojiQ', ''); assert(await page.evaluate(() => window.__im.EMOJIS.length) >= 200, 'emoji list >= 200: ' + await page.evaluate(() => window.__im.EMOJIS.length));
  await page.click('#emojis button[data-e="🚀"]'); await page.click('#tabText');
  // shapes / gradient
  await page.click('#shape-squircle'); await page.selectOption('#bgMode', 'solid');
  assert(await page.evaluate(() => window.__im.S.shape === 'squircle' && window.__im.S.bgMode === 'solid'), 'shape & bg mode set');
  await page.selectOption('#bgMode', 'grad');
  // drag content
  await page.evaluate(() => scrollTo(0, 0)); const mb = await page.locator('#mainpv').boundingBox();
  await page.mouse.move(mb.x + 120, mb.y + 120); await page.mouse.down(); await page.mouse.move(mb.x + 150, mb.y + 100, { steps: 4 }); await page.mouse.up();
  const o = await page.evaluate(() => [window.__im.S.ox, window.__im.S.oy]);
  assert(o[0] > 0.1 && o[1] < -0.05, 'drag moves content ' + o.map(v => v.toFixed(3)));
  await page.click('#resetPos');
  await page.screenshot({ path: path.join(OUT, '390x844-edited.png') });
  // HTML snippet copy
  await page.click('#htmlBtn'); await page.waitForTimeout(150);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => window.__im.snippet()));
  assert(clip.includes('<link rel="icon" href="/favicon.ico" sizes="any">') && clip.includes('apple-touch-icon') && clip.includes('site.webmanifest'), 'HTML snippet copied');
  // ICO
  await page.click('#icoBtn'); await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 20000 });
  const icoB64 = await page.evaluate(() => { const u = window.__lastIco; let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
  const icoPath = path.join(OUT, 'test.ico'); fs.writeFileSync(icoPath, Buffer.from(icoB64, 'base64'));
  const icoInfo = py("import sys,struct\nfrom PIL import Image\nd=open(sys.argv[1],'rb').read()\nr,t,n=struct.unpack('<HHH',d[:6])\nents=[struct.unpack('<BBBBHHII',d[6+16*i:22+16*i]) for i in range(n)]\nok=all(d[e[7]:e[7]+8]==b'\\x89PNG\\r\\n\\x1a\\n' and e[7]+e[6]<=len(d) for e in ents)\nim=Image.open(sys.argv[1])\nprint(r,t,n,[e[0] for e in ents],ok,sorted(im.info.get('sizes',[])))", icoPath);
  fs.unlinkSync(icoPath);
  assert(icoInfo === '0 1 3 [16, 32, 48] True [(16, 16), (32, 32), (48, 48)]', 'favicon.ico valid (PIL reads 16/32/48 PNG entries): ' + icoInfo);
  const sv0 = await page.evaluate(() => window.__saved[0].filename); assert(sv0 === 'favicon.zip', 'ico delivered as favicon.zip (downloads allow-list)');
  // ZIP
  await page.click('#sz64'); await page.click('#zipBtn'); await page.waitForFunction(() => window.__saved.length === 2, null, { timeout: 30000 });
  const z = await page.evaluate(() => window.__saved[1]); const zp = path.join(OUT, 'test.zip'); fs.writeFileSync(zp, Buffer.from(z.b64, 'base64'));
  const zi = py("import sys,zipfile,io\nfrom PIL import Image\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nout=[]\nfor n in z.namelist():\n  if n.endswith('.png'):\n    im=Image.open(io.BytesIO(z.read(n))); out.append(n+'='+str(im.size[0]))\n  else: out.append(n)\nprint(' '.join(out))", zp);
  fs.unlinkSync(zp);
  assert(z.filename === 'icons.zip' && ['icon-16.png=16', 'icon-32.png=32', 'icon-48.png=48', 'icon-64.png=64', 'apple-touch-icon.png=180', 'icon-192.png=192', 'icon-512.png=512', 'icon-maskable-512.png=512', 'favicon.ico', 'site.webmanifest', 'snippet.html'].every(n => zi.split(' ').includes(n)) && !zi.includes('icon-128'), 'ZIP contents: ' + zi);
  const man = JSON.parse(await page.evaluate(() => window.__im.manifest()));
  assert(man.icons.length === 3 && man.icons[2].purpose === 'maskable', 'manifest icons incl. maskable');
  // my icons
  await page.click('#savedBtn'); await page.click('#saveCur'); assert(await page.locator('#savedList .it').count() === 1, 'saved icon listed');
  await page.screenshot({ path: path.join(OUT, '390x844-saved.png') });
  await page.click('#ovClose'); await page.fill('#txt', 'Z'); await page.click('#savedBtn'); await page.click('#savedList .it');
  assert((await page.inputValue('#txt')) === '工具', 'load saved icon restores settings');
  // zoom view of 16px
  await page.click('#mini16'); await page.waitForSelector('#ov:not([hidden]) .zoomcv'); await page.screenshot({ path: path.join(OUT, '390x844-zoom16.png') }); await page.click('#ovClose');
  // persistence
  await page.waitForTimeout(400); await page.reload(); await page.waitForTimeout(300);
  assert((await page.inputValue('#txt')) === '工具' && await page.isHidden('#sampleTag'), 'state restored after reload');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no h-scroll 390');
  await ctx.close();
  for (const [w, h, name, extra] of [[360, 780, '360x780.png', { isMobile: true, hasTouch: true }], [844, 390, '844x390.png', { isMobile: true, hasTouch: true }], [390, 844, '390x844-dark.png', { isMobile: true, hasTouch: true, colorScheme: 'dark' }], [1280, 800, '1280x800.png', {}]]) {
    const c2 = await browser.newContext(Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }, extra)); const p = await c2.newPage(); watch(p);
    await p.goto(URL_); await p.waitForTimeout(400);
    assert(await p.evaluate(() => innerWidth) === w, 'innerWidth ' + w);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth <= innerWidth, small: [...document.querySelectorAll('button')].filter(b => b.offsetParent && (b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44)).map(b => b.id || b.textContent) }));
    assert(m.sw && m.small.length === 0, name + ' no h-scroll; small buttons: ' + m.small);
    if (name === '360x780.png') { assert(await p.isHidden('#icoBtn') && (await p.textContent('#zipBtn')) === '顯示 512px 圖示', 'no downloads -> image fallback'); await p.click('#zipBtn'); await p.waitForSelector('#ov:not([hidden]) img'); await p.screenshot({ path: path.join(OUT, '360x780-fallback.png') }); await p.click('#ovClose'); }
    await p.screenshot({ path: path.join(OUT, name) }); await c2.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  if (errors.length) { console.log('ERRORS', errors); process.exit(1); }
  console.log('ALL PASS');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
