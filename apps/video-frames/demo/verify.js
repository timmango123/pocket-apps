// Verify video-frames: node verify.js   (needs ffmpeg for the test clip, python3 + PIL for read-back)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const VID = path.join(OUT, '_clip.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=1280x720:rate=30', '-pix_fmt', 'yuv420p', '-c:v', 'libvpx', '-b:v', '2M', VID]);
const TMP = [VID];
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } } : null }; };
const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
let k = 0;
const pull = async (page, expr) => { const b64 = await page.evaluate(async e => { const b = eval(e); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }, expr);
  const f = path.join(OUT, '_o' + (k++)); fs.writeFileSync(f, Buffer.from(b64, 'base64')); TMP.push(f); return f; };
const py = (code, ...args) => JSON.parse(execFileSync('python3', ['-I', '-c', code, ...args]).toString());
const IMG = 'import sys,json\nfrom PIL import Image\nim=Image.open(sys.argv[1]);print(json.dumps({"fmt":im.format,"w":im.size[0],"h":im.size[1]}))';
const ZIP = 'import sys,json,zipfile,io\nfrom PIL import Image\nz=zipfile.ZipFile(sys.argv[1]);bad=z.testzip();out=[]\nfor n in z.namelist():\n  im=Image.open(io.BytesIO(z.read(n)));out.append([n,im.format,im.size[0],im.size[1]])\nprint(json.dumps({"bad":bad,"files":out}))';

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...mobile });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_);
  await page.waitForFunction(() => window.__vfReady, null, { timeout: 30000 });
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.isVisible('#sampleChip'), 'sample video generated (MediaRecorder) and labelled 範例影片');
  const sd = await page.evaluate(() => __vf.S.dur); assert(sd > 3 && sd < 6, 'sample duration resolved (WebM Infinity fix) ' + sd.toFixed(2));
  assert((await page.textContent('#res')) === '640×360', 'sample resolution 640×360');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '390x844.png') });
  const sizes = await page.evaluate(() => ['#prevF', '#nextF', '#playBtn', '#back1', '#fwd1', '#speedBtn', '#shutter'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height)]; }));
  assert(sizes.every(([s, w, h]) => h >= 52 && w >= 44), 'control buttons >= 52px tall ' + JSON.stringify(sizes.slice(0, 2)));
  assert(sizes[6][1] === 72 && sizes[6][2] === 72, 'shutter 72px');

  // open 1280x720 30fps clip
  await page.setInputFiles('#fileInput', VID);
  await page.waitForFunction(() => __vf.S.name === '_clip.webm' && __vf.S.dur > 5, null, { timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById('fpsChip').textContent.includes('估計幀率'), null, { timeout: 10000 }); await page.waitForTimeout(300);
  assert((await page.textContent('#res')) === '1280×720', 'resolution shows 1280×720');
  const fpsTxt = await page.textContent('#fpsChip'); assert(/^30 fps/.test(fpsTxt), 'fps chip: ' + fpsTxt);
  assert(!(await page.isVisible('#sampleChip')), 'sample label hidden for own video');
  // frame stepping
  await page.click('#fwd1'); await page.waitForTimeout(300);
  let t = await page.evaluate(() => __vf.vid.currentTime); assert(Math.abs(t - 1) < 0.02, '+1s -> ' + t.toFixed(3));
  await page.click('#nextF'); await page.waitForTimeout(250);
  let t2 = await page.evaluate(() => __vf.vid.currentTime); const fi = x => Math.floor(x * 30 + 1e-3);
  assert(fi(t2) === fi(t) + 1, `next frame: frame ${fi(t)} -> ${fi(t2)} (t=${t2.toFixed(4)})`);
  await page.keyboard.press('.'); await page.waitForTimeout(250); await page.keyboard.press('.'); await page.waitForTimeout(250);
  const t3 = await page.evaluate(() => __vf.vid.currentTime); assert(fi(t3) === fi(t2) + 2, 'keyboard . twice -> +2 frames (' + fi(t3) + ')');
  await page.click('#prevF'); await page.waitForTimeout(250);
  const t4 = await page.evaluate(() => __vf.vid.currentTime); assert(fi(t4) === fi(t3) - 1, 'previous frame -> ' + fi(t4));
  assert((await page.textContent('#tc')) === (await page.evaluate(() => __vf.fmtTC(__vf.vid.currentTime))), 'timecode chip ' + (await page.textContent('#tc')));
  assert(await page.evaluate(() => __vf.fmtTC(12.367)) === '00:12.367', 'fmtTC(12.367) = 00:12.367');
  // scrub: drag 50px right on the screen = +5 frames
  const sb = await page.locator('#screen').boundingBox(); const before = fi(t4);
  await page.mouse.move(sb.x + 100, sb.y + 80); await page.mouse.down(); await page.mouse.move(sb.x + 150, sb.y + 80, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);
  const t5 = await page.evaluate(() => __vf.vid.currentTime); assert(fi(t5) === before + 5, `scrub 50px -> +5 frames (${before} -> ${fi(t5)})`);
  assert(await page.evaluate(() => __vf.vid.paused), 'scrub leaves video paused (no tap toggle)');

  // capture full resolution PNG
  await page.click('#shutter'); await page.waitForFunction(() => __vf.S.caps.length === 1);
  assert((await page.textContent('#capN')) === '1', 'tray counter 1');
  let f = await pull(page, '__vf.S.caps[0].blob'); let im = py(IMG, f);
  assert(im.fmt === 'PNG' && im.w === 1280 && im.h === 720, 'capture is PNG 1280×720 (original resolution)');
  await page.click('#fmt-jpg'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300); await page.keyboard.press('s');
  await page.waitForFunction(() => __vf.S.caps.length === 2); f = await pull(page, '__vf.S.caps[1].blob'); im = py(IMG, f);
  assert(im.fmt === 'JPEG' && im.w === 1280, 'JPG capture via S key 1280 wide');
  assert(await page.evaluate(() => document.querySelectorAll('#marks .mk').length) === 2, 'two capture markers on timeline');

  // sharpest frame
  await page.click('#sharpBtn'); await page.waitForFunction(() => window.__sharp, null, { timeout: 30000 });
  const sh = await page.evaluate(() => ({ ...window.__sharp, t: __vf.vid.currentTime }));
  assert(sh.n >= 28 && Math.abs(sh.best - sh.t) <= 0.52, `sharpest-frame scan: ${sh.n} frames within ±0.5 s, best ${sh.best.toFixed(3)}`);
  await page.click('#gotoBest'); await page.waitForTimeout(300);
  assert(Math.abs(await page.evaluate(() => __vf.vid.currentTime) - sh.best) < 0.02, 'jump to sharpest frame');

  // burst collage: 16 frames from 0 to 5 s
  await page.click('#burstBox summary');
  await page.fill('#bStart', '0'); await page.fill('#bEnd', '5'); await page.fill('#bN', '16');
  await page.click('#bGo'); await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 60000 });
  const col = await page.evaluate(() => ({ ...window.__lastCollage, blob: null, name: window.__saved[0].filename }));
  assert(col.cols === 4 && col.rows === 4 && col.W === 2160, `burst 16 -> 4×4 grid, width 2160 (${col.W}×${col.H})`);
  const diffs = col.times.slice(1).map((x, i) => x - col.times[i]);
  assert(col.times[0] === 0 && Math.abs(col.times[15] - 5) < 0.002 && diffs.every(d => Math.abs(d - 1 / 3) < 1e-6), 'time points evenly spaced 0, 0.333 … 5.000');
  f = await pull(page, 'window.__saved[0].data'); im = py(IMG, f);
  assert(im.fmt === 'JPEG' && im.w === 2160 && im.h === col.H, 'collage JPG ' + im.w + '×' + im.h + ' ' + col.name);

  // tray drawer: select both, download ZIP, persistence
  await page.click('#trayBtn'); assert(await page.isVisible('#drawer'), 'tray drawer opens');
  await page.screenshot({ path: path.join(OUT, '390x844-tray.png') });
  await page.click('#drawer .tSelAll'); await page.click('#drawer .tDl');
  await page.waitForFunction(() => window.__saved.length === 2);
  const zname = await page.evaluate(() => window.__saved[1].filename);
  f = await pull(page, 'window.__saved[1].data'); const z = py(ZIP, f);
  assert(z.bad === null && z.files.length === 2 && z.files[0][1] === 'PNG' && z.files[0][2] === 1280, 'STORE ZIP valid with 2 images: ' + z.files.map(x => x[0]).join(', '));
  assert(/^_clip-00-0\d-\d{3}\.png$/.test(z.files[0][0]), 'file name uses timecode ' + z.files[0][0] + ' (' + zname + ')');
  await page.click('#drawerClose');
  await page.reload(); await page.waitForFunction(() => window.__vfReady, null, { timeout: 30000 });
  assert((await page.textContent('#capN')) === '2', 'captures persist in IndexedDB after reload');
  await page.click('#trayBtn'); await page.click('#drawer .tClear'); assert((await page.textContent('#capN')) === '2', 'clear needs a second tap');
  await page.click('#drawer .tClear'); await page.waitForTimeout(200);
  assert((await page.textContent('#capN')) === '0', 'tray cleared after confirmation');
  await page.click('#drawerClose');
  await page.evaluate(() => localStorage.clear());
  await ctx.close();

  for (const [w, h, name, extra] of [[360, 780, '360x780', mobile], [844, 390, '844x390', mobile], [1280, 800, '1280x800', {}]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, ...extra }); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForFunction(() => window.__vfReady, null, { timeout: 30000 }); await p.waitForTimeout(1200);
    assert(await p.evaluate(() => innerWidth) === w, name + ' innerWidth ' + w);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' no horizontal scroll');
    await p.screenshot({ path: path.join(OUT, name + '.png') }); await c.close();
  }
  const cd = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...mobile }); const pd = await cd.newPage(); watch(pd);
  await pd.goto(URL_); await pd.waitForFunction(() => window.__vfReady, null, { timeout: 30000 }); await pd.waitForTimeout(1200);
  await pd.click('#burstBox summary'); await pd.screenshot({ path: path.join(OUT, '390x844-dark.png') }); await cd.close();

  assert(errors.length === 0, 'no console errors ' + JSON.stringify(errors));
  await browser.close(); for (const x of TMP) fs.unlinkSync(x); fs.unlinkSync(WRAP); console.log('ALL PASS');
})().catch(e => { console.error(e); for (const x of TMP) try { fs.unlinkSync(x); } catch (_) {} try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
