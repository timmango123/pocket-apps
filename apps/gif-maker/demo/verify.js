// Verify gif-maker: node verify.js   (needs ffmpeg for the test clip, python3 + PIL to read GIFs back)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const VID = path.join(OUT, '_test.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=30', '-c:v', 'libvpx', '-b:v', '600k', VID]);
const TMP = [VID];
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } } : null }; };
const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const PY = `
import sys,json
from PIL import Image
im=Image.open(sys.argv[1]); pts=json.loads(sys.argv[2]); fr=[]
for i in range(im.n_frames):
    im.seek(i); rgb=im.convert('RGB'); fr.append({'d':im.info.get('duration'),'px':[list(rgb.getpixel(tuple(p))) for p in pts]})
im.seek(0)
pal=im.getpalette() or []
print(json.dumps({'fmt':im.format,'n':im.n_frames,'w':im.size[0],'h':im.size[1],'loop':im.info.get('loop','none'),'frames':fr,'palN':len(pal)//3}))
`;
let gifN = 0;
const readGif = async (page, pts = [[5, 5]]) => {
  const b64 = await page.evaluate(async () => { const u = new Uint8Array(await window.__lastGif.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
  const f = path.join(OUT, `_g${gifN++}.gif`); fs.writeFileSync(f, Buffer.from(b64, 'base64')); TMP.push(f);
  return JSON.parse(execFileSync('python3', ['-I', '-c', PY, f, JSON.stringify(pts)]).toString());
};
const gen = async page => { await page.click('#genBtn'); await page.waitForSelector('#barDone:not([hidden])', { timeout: 90000 }); };
const again = async page => { await page.click('#againBtn'); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...mobile });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(600);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.isVisible('#sampleTag'), 'sample frames labelled 範例影格');
  assert(await page.evaluate(() => document.querySelectorAll('#strip .fr:not(.add)').length) === 8, '8 sample frames in strip');
  assert(await page.evaluate(() => __gm.workerOK), 'web worker available');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // 1) default: 8 frames, 320 wide, 150ms, infinite loop
  await gen(page);
  let g = await readGif(page, [[5, 60], [300, 230]]);
  assert(g.fmt === 'GIF' && g.n === 8 && g.w === 320 && g.h === 240, `GIF 8 frames 320x240 (PIL: ${g.n} ${g.w}x${g.h})`);
  assert(g.frames.every(f => f.d === 150), 'every frame 150ms');
  assert(g.loop === 0, 'NETSCAPE loop=0 (infinite)');
  const bgPx = g.frames[7].px[0]; assert(Math.abs(bgPx[0] - 244) < 14 && Math.abs(bgPx[1] - 241) < 14 && Math.abs(bgPx[2] - 232) < 14, 'frame 8 background colour preserved after optimize/transparency ' + bgPx);
  const floor = g.frames[3].px[1]; assert(Math.abs(floor[0] - 45) < 16 && Math.abs(floor[1] - 59) < 16, 'floor colour preserved ' + floor);
  assert(await page.isVisible('#gifImg'), 'GIF result shown in preview');
  await page.screenshot({ path: path.join(OUT, '390x844-done.png') });
  await page.click('#dlBtn'); await page.waitForFunction(() => window.__saved.length === 1);
  assert(await page.evaluate(() => window.__saved[0].filename === 'sample.gif' && window.__saved[0].data.type === 'image/gif'), 'download saves sample.gif');
  await again(page);

  // 2) per-frame delay, play once, ping-pong, 32 colours no dither, 240 wide, speed 2x
  await page.click('#fr-0'); await page.fill('#frDelay', '500'); await page.dispatchEvent('#frDelay', 'change');
  assert((await page.textContent('#fr-0 .d')) === '500ms', 'frame 1 own delay 500ms');
  await page.selectOption('#loop', '1'); await page.selectOption('#dir', 'pp'); await page.selectOption('#colors', '32'); await page.uncheck('#dither'); await page.selectOption('#width', '240');
  await gen(page); g = await readGif(page);
  assert(g.n === 14, 'ping-pong 8 -> 14 frames (' + g.n + ')');
  assert(g.w === 240 && g.h === 180, 'width 240 -> 240x180');
  assert(g.frames[0].d === 500 && g.frames[1].d === 150, 'durations 500 / 150 ms');
  assert(g.loop === 'none', 'play once -> no NETSCAPE loop block');
  assert(g.palN <= 32, 'palette <= 32 colours (' + g.palN + ')');
  await again(page);
  await page.selectOption('#loop', 'n'); await page.fill('#loopN', '3'); await page.dispatchEvent('#loopN', 'change'); await page.selectOption('#dir', 'rev'); await page.selectOption('#speed', '2');
  await gen(page); g = await readGif(page);
  assert(g.loop === 2, 'play 3 times -> NETSCAPE loop count 2');
  assert(g.n === 8 && g.frames[7].d === 250 && g.frames[0].d === 80, 'reverse + 2x speed: last frame (orig #1, 500ms) -> 250ms, others 80ms');
  await again(page);
  // reset settings for later screenshots
  await page.selectOption('#dir', 'fwd'); await page.selectOption('#speed', '1'); await page.selectOption('#loop', '0'); await page.selectOption('#colors', '256'); await page.check('#dither');

  // 3) delete down to 1 frame -> generate disabled
  const selFirst = async () => { if (await page.getAttribute('#fr-0', 'aria-pressed') !== 'true') await page.click('#fr-0'); };
  for (let i = 0; i < 7; i++) { await selFirst(); await page.click('#frDel'); }
  assert(await page.evaluate(() => document.querySelectorAll('#strip .fr:not(.add)').length) === 1, '1 frame left');
  assert(await page.isDisabled('#genBtn') && (await page.textContent('#genBtn')).includes('至少 2 格'), '1 frame: 至少 2 格, button disabled');
  await selFirst(); await page.click('#frDel');
  assert((await page.textContent('#genBtn')).includes('請加入圖片'), '0 frames: 請加入圖片');

  // 4) add images via file input (different aspect, contain + bg)
  const mk = (w, h, col) => page.evaluate(async ([w, h, col]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, w, h);
    const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }, [w, h, col]);
  await page.setInputFiles('#fileImg', [{ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(await mk(400, 300, '#ff0000'), 'base64') }, { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(await mk(300, 400, '#0000ff'), 'base64') }]);
  await page.waitForFunction(() => __gm.S.frames.length === 2);
  assert(!(await page.isVisible('#sampleTag')), 'sample tag hidden after own images');
  await page.selectOption('#fit', 'contain'); await page.selectOption('#width', '320');
  await gen(page); g = await readGif(page, [[160, 120], [5, 120]]);
  assert(g.n === 2 && g.w === 320 && g.h === 240, 'two images -> 2 frames 320x240');
  assert(g.frames[0].px[0][0] > 200 && g.frames[1].px[0][2] > 200, 'frame 1 red, frame 2 blue');
  assert(g.frames[1].px[1].every(v => v > 230), 'contain mode: portrait frame has white side borders ' + g.frames[1].px[1]);
  await again(page);

  // 5) video mode: 0–3 s at 10 fps -> 30 frames
  await page.click('#mode-vid');
  assert((await page.textContent('#genBtn')).includes('請先選擇影片'), 'video mode without file prompts');
  await page.setInputFiles('#fileVid', VID);
  await page.waitForSelector('#vBox:not([hidden])', { timeout: 15000 });
  await page.evaluate(() => { const e = document.getElementById('vEnd'); e.value = 3; e.dispatchEvent(new Event('input')); });
  assert((await page.textContent('#vLen')).includes('30 格'), 'selection 3.0 s -> 30 frames at 10 fps');
  await page.screenshot({ path: path.join(OUT, '390x844-video.png') });
  await page.selectOption('#fit', 'cover');
  await gen(page); g = await readGif(page);
  assert(g.n === 30 && g.w === 320 && g.h === 240, `video GIF 30 frames 320x240 (${g.n} ${g.w}x${g.h})`);
  assert(g.frames.every(f => f.d === 100), 'video frames 100ms each (10 fps)');
  await again(page);
  // cancel during generation
  await page.selectOption('#fps', '15');
  await page.click('#genBtn'); await page.waitForTimeout(150); await page.click('#cancelBtn');
  assert(await page.isVisible('#genBtn'), 'cancel returns to idle bar');
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.clear());
  await ctx.close();

  for (const [w, h, name, extra] of [[360, 780, '360x780', mobile], [844, 390, '844x390', mobile], [1280, 800, '1280x800', {}]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, ...extra }); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForTimeout(500);
    assert(await p.evaluate(() => innerWidth) === w, name + ' innerWidth ' + w);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' no horizontal scroll');
    await p.screenshot({ path: path.join(OUT, name + '.png') }); await c.close();
  }
  const cd = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...mobile }); const pd = await cd.newPage(); watch(pd);
  await pd.goto(URL_); await pd.waitForTimeout(500); await pd.screenshot({ path: path.join(OUT, '390x844-dark.png') }); await cd.close();

  assert(errors.length === 0, 'no console errors ' + JSON.stringify(errors));
  await browser.close(); for (const f of TMP) fs.unlinkSync(f); fs.unlinkSync(WRAP); console.log('ALL PASS');
})().catch(e => { console.error(e); for (const f of TMP) try { fs.unlinkSync(f); } catch (_) {} try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
