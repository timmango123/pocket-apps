// End-to-end check of 調音器 in Chromium with a fake microphone that plays generated WAV files of known pitch.
// Run: node verify.js            (writes demo/390x844.png and demo/cover-390x520.png, both gitignored)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + SRC + '\n</body></html>';
const OUT = __dirname, TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tuner-'));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cents = (a, b) => 1200 * Math.log2(a / b);

// 16-bit mono WAV, guitar-like harmonics, whole number of periods so the fake device loops cleanly
function wav(file, f, secs = 3, sr = 48000, harm = [0.6, 1, 0.8, 0.5, 0.35, 0.25, 0.15]) {
  const n = Math.round(Math.round(secs * f) * sr / f), b = Buffer.alloc(44 + n * 2), norm = harm.reduce((a, x) => a + x, 0);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { let s = 0; harm.forEach((h, k) => s += h * Math.sin(2 * Math.PI * f * (k + 1) * i / sr)); b.writeInt16LE(Math.round(0.4 * 32767 * s / norm), 44 + i * 2); }
  fs.writeFileSync(file, b); return file;
}
function serve() {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/frame')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(`<!doctype html><body style="margin:0"><iframe id="f" sandbox="allow-scripts" style="width:390px;height:844px;border:0"></iframe><script>document.getElementById('f').srcdoc=${JSON.stringify(PAGE).replace(/</g, '\\u003c')}</script></body>`); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
async function open(browser, url, opts = mobile) {
  const ctx = await browser.newContext(opts), page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await sleep(300);
  return { ctx, page, errors };
}
const shown = page => page.evaluate(() => __tuner.shown && { f: __tuner.shown.f, cents: __tuner.shown.cents, name: __tuner.shown.name });
async function waitStable(page, ms = 1500) { await sleep(ms); return shown(page); }

(async () => {
  const srv = await serve(), URL = `http://localhost:${srv.address().port}/`;
  const fake = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  try {
    // 1. plain load: no permission requested, no errors, no overflow, 44px targets
    {
      const browser = await chromium.launch();
      const { ctx, page, errors } = await open(browser, URL);
      await page.addInitScript(() => {});
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(w[0] <= w[1], `no horizontal scroll at 390 (${w})`);
      assert(await page.evaluate(() => __tuner.cardState) === 'idle' && !(await page.evaluate(() => !!__tuner.stream)), 'idle on load, microphone not requested');
      assert(/點擊開始調音/.test(await page.locator('#card').textContent()) && /不會錄音或上傳/.test(await page.locator('#card').textContent()), 'start button + privacy note shown');
      const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 6), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      assert(small.length === 0, 'touch targets >= 44px ' + JSON.stringify(small));
      const go = await page.locator('.go').boundingBox(); assert(go.height >= 56, 'start button is 56px tall');
      const nm = await page.evaluate(() => getComputedStyle(document.getElementById('nName')).fontSize); assert(nm === '96px', 'note name 96px');
      await page.screenshot({ path: OUT + '/idle-390x844.png' });
      // reference tone works without a microphone
      await page.locator('#refBtn').click(); await sleep(150);
      assert(await page.evaluate(() => __tuner.ctx && __tuner.ctx.state === 'running'), 'reference tone plays without microphone permission');
      // instrument switch + persistence
      await page.locator('#inst button[data-k="violin"]').click();
      assert(await page.locator('#srow .str').count() === 4, 'violin shows 4 strings');
      assert(JSON.parse(await page.evaluate(() => localStorage.getItem('tuner.v1'))).instrument === 'violin', 'instrument saved in tuner.v1');
      await page.reload(); await sleep(200);
      assert(await page.locator('#inst button[aria-pressed="true"]').textContent() === '小提琴', 'instrument restored after reload');
      await page.evaluate(() => localStorage.clear());
      // no microphone at all (headless without a fake device)
      await page.reload(); await sleep(200);
      await page.locator('.go').click(); await sleep(600);
      assert(await page.evaluate(() => __tuner.cardState) === 'nomic' && /找不到麥克風/.test(await page.locator('#card').textContent()), 'no microphone -> 找不到麥克風 card');
      assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
      await ctx.close();
      // srcdoc iframe without allow="microphone" (like claude.ai) -> blocked card, getUserMedia not even attempted
      const fr = await open(browser, URL + 'frame');
      const f = fr.page.frames()[1];
      await f.locator('.go').click(); await sleep(300);
      const fst = await f.evaluate(() => __tuner.cardState); assert(fst === 'blocked', fst + ': sandboxed iframe without microphone permission -> "這裡無法使用麥克風" + website link');
      assert(/開啟網站版/.test(await f.locator('#card').textContent()), 'blocked card offers the website version');
      assert(fr.errors.length === 0, 'no console errors in blocked iframe: ' + fr.errors.join(' | '));
      await browser.close();
    }
    // denied / blocked: headless Chromium has no permission prompt, so stub getUserMedia the way real browsers reject it
    {
      const browser = await chromium.launch();
      for (const [delay, perm, want] of [[900, 'denied', 'denied'], [5, 'prompt', 'blocked']]) {
        const ctx = await browser.newContext(mobile), page = await ctx.newPage(), errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
        await page.addInitScript(([delay, perm]) => {
          navigator.mediaDevices.getUserMedia = () => new Promise((_, rej) => setTimeout(() => rej(new DOMException('Permission denied', 'NotAllowedError')), delay));
          navigator.permissions.query = async () => ({ state: perm });
        }, [delay, perm]);
        await page.goto(URL); await sleep(200);
        await page.locator('.go').click(); await sleep(delay + 400);
        const st = await page.evaluate(() => __tuner.cardState);
        assert(st === want, `NotAllowedError after ${delay} ms (permission ${perm}) -> ${st} card`);
        assert(await page.locator('#card a.site').getAttribute('href') === 'https://timmango123.github.io/pocket-apps/tools/#tuner' && await page.locator('#card a.site').getAttribute('target') === '_blank', 'website link to tools/#tuner, new tab');
        if (want === 'denied') assert(/Safari/.test(await page.locator('#card').textContent()) && await page.locator('#card [data-act="start"]').count() === 1, 'denied card explains how to allow the microphone and offers retry');
        assert(/參考音/.test(await page.locator('#card').textContent()), 'card points to the reference tones');
        assert(!(await page.evaluate(() => /NaN|undefined/.test(document.body.innerText))), 'no NaN/undefined on screen');
        assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
        await ctx.close();
      }
      await browser.close();
    }

    // 2. fake mic playing E2 (82.41 Hz, guitar-like): tap start, read E2 within ±2 cents
    {
      const browser = await chromium.launch({ args: [...fake, '--use-file-for-fake-audio-capture=' + wav(path.join(TMP, 'e2.wav'), 82.41)] });
      const { ctx, page, errors } = await open(browser, URL);
      await page.locator('.go').click();
      await page.waitForFunction(() => __tuner.running, null, { timeout: 5000 });
      assert(true, 'tap start -> microphone stream running');
      let r = await waitStable(page);
      assert(r && r.name === 'E2' && Math.abs(r.cents) <= 2 && Math.abs(r.f - 82.41) < 0.2, `guitar mode reads E2 ${r && r.f.toFixed(2)} Hz ${r && r.cents.toFixed(2)} cents`);
      assert(await page.locator('#srow .str.near').getAttribute('data-i') === '0', 'auto mode highlights the low E string');
      const ow = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(ow[0] <= 390 && ow[1] === 390, `no horizontal overflow while tuning (${ow})`);
      assert(await page.evaluate(() => document.getElementById('meter').classList.contains('intune')), 'in-tune zone turns the meter green');
      assert(await page.locator('#hint').textContent() === '準！', 'hint says 準！');
      await page.screenshot({ path: OUT + '/390x844.png' });
      // chromatic
      await page.locator('#inst button[data-k="chromatic"]').click(); r = await waitStable(page, 600);
      assert(r.name === 'E2', 'chromatic mode reads E2');
      // lock the A string while E2 sounds -> far flat, tighten
      await page.locator('#inst button[data-k="guitar"]').click();
      await page.locator('#srow .str[data-i="1"]').click(); r = await waitStable(page, 600);
      assert(r.name === 'A2' && r.cents < -450, `locked A2 while E2 plays -> ${r.cents.toFixed(0)} cents`);
      assert(/低很多/.test(await page.locator('#hint').textContent()), 'hint: 低很多・把弦調緊');
      await page.locator('#srow .str[data-i="1"]').click();
      // A4 = 442 shifts the reading by about -7.85 cents
      await page.locator('#a4Btn').click(); await page.locator('#a4Up').click(); await page.locator('#a4Up').click();
      r = await waitStable(page, 1000);
      assert(r.name === 'E2' && Math.abs(r.cents + 7.85) < 2, `A4=442 -> E2 ${r.cents.toFixed(2)} cents`);
      assert(await page.locator('#cents').evaluate(e => e.classList.contains('flat')), 'flat reading coloured flat');
      await page.locator('#a4Reset').click();
      // reference tone pauses detection
      await page.locator('#refBtn').click(); await sleep(400);
      assert(await page.evaluate(() => document.getElementById('meter').classList.contains('dim')), 'detection paused while reference tone plays');
      await page.locator('#refBtn').click();
      // hidden page releases the microphone
      const track = await page.evaluate(() => { window.__t = __tuner.stream.getAudioTracks()[0]; return __t.readyState; });
      assert(track === 'live', 'track live while tuning');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      assert(await page.evaluate(() => __t.readyState) === 'ended' && !(await page.evaluate(() => __tuner.running)), 'hidden -> track stopped, microphone released');
      assert(/點擊繼續/.test(await page.locator('#card').textContent()), 'back in front: 點擊繼續');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
      await page.locator('.go').click(); await page.waitForFunction(() => __tuner.running);
      r = await waitStable(page, 1200);
      assert(r && r.name === 'E2', 'restart after resume reads E2 again');
      await page.locator('.stop').click();
      assert(!(await page.evaluate(() => __tuner.running)) && await page.evaluate(() => __t.readyState) === 'ended', 'stop button stops the track');
      assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
      await ctx.close(); await browser.close();
    }

    // 3. other pitches: A4 440, ukulele C4, bass E1, violin E5, chromatic F#3
    for (const [f, inst, name] of [[440, 'chromatic', 'A4'], [261.63, 'ukulele', 'C4'], [41.2, 'bass', 'E1'], [659.26, 'violin', 'E5'], [185.0, 'chromatic', 'F♯3']]) {
      const browser = await chromium.launch({ args: [...fake, '--use-file-for-fake-audio-capture=' + wav(path.join(TMP, f + '.wav'), f)] });
      const { ctx, page, errors } = await open(browser, URL);
      await page.locator(`#inst button[data-k="${inst}"]`).click();
      await page.locator('.go').click(); await page.waitForFunction(() => __tuner.running);
      const r = await waitStable(page);
      const label = (await page.locator('#nName').textContent()) + (await page.locator('#nAcc').textContent()) + (await page.locator('#nOct').textContent());
      assert(r && label === name && Math.abs(cents(r.f, f)) < 2, `${inst} ${f} Hz -> ${label} ${r && r.f.toFixed(2)} Hz`);
      assert(errors.length === 0, 'no console errors');
      await ctx.close(); await browser.close();
    }

    // 4. cover: guitar, low E slightly flat (82.0 Hz ≈ −8.6 cents), 390×520
    {
      const browser = await chromium.launch({ args: [...fake, '--use-file-for-fake-audio-capture=' + wav(path.join(TMP, 'cover.wav'), 82.0)] });
      const { ctx, page } = await open(browser, URL, { ...mobile, viewport: { width: 390, height: 520 }, colorScheme: 'light' });
      await page.locator('.go').click(); await page.waitForFunction(() => __tuner.running);
      const r = await waitStable(page, 2000);
      assert(r.name === 'E2' && r.cents < -6 && r.cents > -11, `82.0 Hz -> E2 ${r.cents.toFixed(1)} cents`);
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); scrollTo(0, 0); }); await sleep(200);
      await page.screenshot({ path: OUT + '/cover-390x520.png' });
      await ctx.close(); await browser.close();
    }
    console.log('all checks passed');
  } finally { srv.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
