// End-to-end check of 噪音分貝計 in Chromium with a fake microphone playing generated WAV files of known level.
// Run: node verify.js            (writes demo/390x844.png and demo/cover-390x520.png, both gitignored)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + SRC + '\n</body></html>';
const OUT = __dirname, TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-'));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const expectDb = amp => 20 * Math.log10(amp / Math.SQRT2) + 94; // sine of peak `amp` -> dB with the default offset

function wav(file, f, amp, secs = 4, sr = 48000) {
  const n = Math.round(Math.round(secs * f) * sr / f), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * 32767 * Math.sin(2 * Math.PI * f * i / sr)), 44 + i * 2);
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
  const ctx = await browser.newContext({ acceptDownloads: true, ...opts }), page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await sleep(300);
  return { ctx, page, errors };
}
const level = page => page.evaluate(() => __db.session.level + __db.S.offset);
const num = async (page, sel) => parseFloat(await page.locator(sel).textContent());
const fake = file => ({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + file] });

(async () => {
  const srv = await serve(), URL = `http://localhost:${srv.address().port}/`;
  try {
    // 1. plain load + error states
    {
      const browser = await chromium.launch();
      const { ctx, page, errors } = await open(browser, URL);
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(w[0] <= w[1], `no horizontal scroll at 390 (${w})`);
      assert(await page.evaluate(() => __db.cardState) === 'idle' && !(await page.evaluate(() => !!__db.stream)), 'idle on load, microphone not requested');
      const card = await page.locator('#card').textContent();
      assert(/點擊開始測量/.test(card) && /估計值/.test(card), 'start button + "非專業儀器，數值為估計值" note');
      assert(await page.locator('#num').textContent() === '--' && !(await page.evaluate(() => /NaN|undefined|Infinity/.test(document.body.innerText))), 'idle readout shows "--", no NaN');
      assert(await page.evaluate(() => getComputedStyle(document.getElementById('num')).fontSize) === '80px', 'main reading 80px');
      assert(Math.round((await page.locator('#cvWrap').boundingBox()).height) === 180, 'history chart 180px tall');
      await page.locator('#set summary').click();
      const small = await page.evaluate(() => [...document.querySelectorAll('button, summary')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 6), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      assert(small.length === 0, 'touch targets >= 44px ' + JSON.stringify(small));
      const w2 = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(w2[0] <= w2[1], 'no horizontal scroll with settings open');
      await page.locator('#wSeg button[data-w="slow"]').click();
      await page.reload(); await sleep(200);
      assert(await page.locator('#wSeg button[aria-pressed="true"]').getAttribute('data-w') === 'slow' && /SLOW/.test(await page.locator('#wTag').textContent()), 'weighting saved in decibel-meter.v1');
      await page.evaluate(() => localStorage.clear()); await page.reload(); await sleep(200);
      await page.screenshot({ path: OUT + '/idle-390x844.png' });
      await page.locator('.go').click(); await sleep(600);
      assert(await page.evaluate(() => __db.cardState) === 'nomic' && /找不到麥克風/.test(await page.locator('#card').textContent()), 'no microphone -> 找不到麥克風 card + retry');
      assert(await page.locator('#led').getAttribute('data-s') === 'err', 'status light turns red');
      assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
      await ctx.close();
      const fr = await open(browser, URL + 'frame');
      const f = fr.page.frames()[1];
      await f.locator('.go').click(); await sleep(300);
      assert(await f.evaluate(() => __db.cardState) === 'blocked' && /開啟網站版/.test(await f.locator('#card').textContent()), 'sandboxed iframe (like claude.ai) -> 這裡無法使用麥克風 + website link');
      assert(await f.locator('#card a.site').getAttribute('href') === 'https://timmango123.github.io/pocket-apps/tools/#decibel-meter' && await f.locator('#card a.site').getAttribute('target') === '_blank', 'website link to tools/#decibel-meter, new tab');
      assert(fr.errors.length === 0, 'no console errors in blocked iframe: ' + fr.errors.join(' | '));
      for (const [delay, perm, want] of [[900, 'denied', 'denied'], [5, 'prompt', 'blocked']]) {
        const c2 = await browser.newContext(mobile), p2 = await c2.newPage(), e2 = [];
        p2.on('console', m => { if (m.type() === 'error') e2.push(m.text()); }); p2.on('pageerror', e => e2.push(String(e)));
        await p2.addInitScript(([delay, perm]) => {
          navigator.mediaDevices.getUserMedia = () => new Promise((_, rej) => setTimeout(() => rej(new DOMException('Permission denied', 'NotAllowedError')), delay));
          navigator.permissions.query = async () => ({ state: perm });
        }, [delay, perm]);
        await p2.goto(URL); await sleep(200);
        await p2.locator('.go').click(); await sleep(delay + 400);
        assert(await p2.evaluate(() => __db.cardState) === want, `NotAllowedError after ${delay} ms (permission ${perm}) -> ${want} card`);
        assert(await p2.locator('#card a.site').count() === 1, 'card links to the website version');
        assert(!(await p2.evaluate(() => /NaN|undefined|Infinity/.test(document.body.innerText))), 'no NaN on screen after denial');
        assert(e2.length === 0, 'no console errors');
        await c2.close();
      }
      await browser.close();
    }

    // 2. fake mic: 1 kHz sine, peak 0.1 -> 71.0 dB
    {
      const exp = expectDb(0.05);
      const browser = await chromium.launch(fake(wav(path.join(TMP, 'k1.wav'), 1000, 0.05)));
      const { ctx, page, errors } = await open(browser, URL);
      await page.locator('.go').click();
      await page.waitForFunction(() => __db.running, null, { timeout: 5000 });
      assert(true, 'tap start -> measuring');
      await sleep(2500);
      let lv = await level(page);
      assert(Math.abs(lv - exp) < 1, `1 kHz at -29 dBFS reads ${lv.toFixed(2)} dB (expected ${exp.toFixed(2)})`);
      assert(Math.abs(await num(page, '#num') - exp) <= 1, 'big number shows ' + await page.locator('#num').textContent());
      assert(/一般/.test(await page.locator('#level').textContent()), 'band: 一般（交談）');
      assert(await page.locator('#led').getAttribute('data-s') === 'on', 'status light on');
      assert(Math.abs(await num(page, '#sLeq') - exp) < 1.2, 'Leq ' + await page.locator('#sLeq').textContent());
      assert(await page.evaluate(() => __db.session.hist.size) >= 2, 'history gets one point per second');
      const ind = await page.locator('#ind').evaluate(e => e.style.left);
      assert(/^4\d\./.test(ind), 'bar indicator near 45% (' + ind + ')');
      const ow = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(ow[0] <= 390 && ow[1] === 390, `no horizontal overflow while measuring (${ow})`);
      // calibration +10 shifts reading and stats
      const leq0 = await num(page, '#sLeq');
      await page.locator('#calBtn').click();
      for (let i = 0; i < 10; i++) await page.locator('#calUp').click();
      assert(await page.locator('#calOut').textContent() === '+10 dB', 'offset +10');
      await sleep(250);
      assert(Math.abs(await num(page, '#sLeq') - leq0 - 10) < 0.25, `calibration +10 moves Leq ${leq0} -> ${await page.locator('#sLeq').textContent()}`);
      assert(Math.abs(await num(page, '#num') - exp - 10) <= 1, 'reading moves up 10');
      await page.locator('#calKnown').fill('60'); await page.locator('#calApply').click(); await sleep(400);
      lv = await level(page);
      assert(Math.abs(lv - 60) < 0.6, `known 60 dB applied -> reads ${lv.toFixed(2)}, offset ${await page.evaluate(() => __db.S.offset)}`);
      await page.locator('#calReset').click(); await page.locator('#calClose').click();
      assert(await page.evaluate(() => __db.S.offset) === 0, 'offset restored to default');
      // A-weighting at 1 kHz is ~0
      await page.locator('#set summary').click();
      await page.locator('#aW').check(); await sleep(900);
      lv = await level(page);
      assert(Math.abs(lv - exp) < 0.6 && await page.locator('#unit').textContent() === 'dBA', `dBA at 1 kHz ≈ dB (${lv.toFixed(2)})`);
      await page.locator('#aW').uncheck();
      // marker + alarm
      await page.locator('#markBtn').click(); await sleep(1300);
      assert(await page.evaluate(() => { const h = __db.session.hist; for (let i = 0; i < h.size; i++) if (h.at(i).mark === 1) return true; return false; }), 'marker stored on the curve');
      for (let i = 0; i < 25; i++) await page.locator('#alDown').click();
      assert(await page.locator('#alOut').textContent() === '60 dB', 'alarm threshold 60');
      await sleep(3600);
      assert(await page.locator('#alarmFrame').evaluate(e => e.classList.contains('on')) && /持續 3 秒/.test(await page.locator('#toast').textContent()), 'over threshold for 3 s -> red frame + toast');
      // chart inspect by dragging
      const bb = await page.locator('#cv').boundingBox();
      await page.mouse.move(bb.x + bb.width - 20, bb.y + 90);
      assert(await page.locator('#tip').isVisible() && /平均/.test(await page.locator('#tip').textContent()), 'hover/drag on the chart shows ' + await page.locator('#tip').textContent());
      await page.locator('#range button[data-r="300"]').click();
      assert(await page.locator('#range button[aria-pressed="true"]').getAttribute('data-r') === '300', 'range 5 分');
      await page.locator('#range button[data-r="60"]').click();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: OUT + '/390x844.png' });
      // CSV export
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#csvBtn').click()]);
      const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^\ufeff/, '').trim().split('\r\n');
      assert(csv[0] === 'time,avg_db,max_db,marker' && csv.length >= 8 && /^noise-\d{8}-\d{4}\.csv$/.test(dl.suggestedFilename()), `CSV ${dl.suggestedFilename()} with ${csv.length - 1} rows`);
      assert(csv.some(r => r.endsWith(',標記')) && csv.slice(1).every(r => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d,\d+\.\d,\d+\.\d,/.test(r)), 'CSV rows: local ISO time, 1-decimal values, marker');
      // hidden -> released, then resume marks the gap
      await page.evaluate(() => { window.__t = __db.stream.getAudioTracks()[0]; });
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      assert(await page.evaluate(() => __t.readyState) === 'ended' && !(await page.evaluate(() => __db.running)), 'hidden -> track stopped, microphone released');
      assert(await page.locator('#led').getAttribute('data-s') === 'paused' && await page.locator('#playBtn').getAttribute('aria-label') === '繼續測量', 'paused, play button offers 繼續');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
      await sleep(1200);
      await page.locator('#playBtn').click(); await page.waitForFunction(() => __db.running); await sleep(1500);
      assert(await page.evaluate(() => { const h = __db.session.hist; for (let i = 0; i < h.size; i++) if (h.at(i).mark === 2) return true; return false; }), 'interruption marked on the curve after resuming');
      await page.locator('#resetBtn').click();
      assert(await page.evaluate(() => __db.session.hist.size) === 0 && await page.locator('#sTime').textContent() === '0:00', 'reset clears stats and curve');
      await page.locator('#playBtn').click();
      assert(await page.evaluate(() => __t.readyState === 'ended' && !__db.stream), 'pause stops the microphone');
      assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
      await ctx.close(); await browser.close();
    }

    // 3. quiet vs loud (>= 20 dB apart) and A-weighting at 100 Hz
    {
      const read = async (file, aW) => {
        const browser = await chromium.launch(fake(file));
        const { ctx, page, errors } = await open(browser, URL);
        if (aW) await page.evaluate(() => localStorage.setItem('decibel-meter.v1', JSON.stringify({ aWeight: true })));
        if (aW) await page.reload();
        await page.locator('.go').click(); await page.waitForFunction(() => __db.running); await sleep(2000);
        const lv = await level(page), txt = await page.locator('#num').textContent(), band = await page.locator('#level').textContent();
        assert(errors.length === 0, 'no console errors');
        await ctx.close(); await browser.close();
        return { lv, txt, band };
      };
      const q = await read(wav(path.join(TMP, 'quiet.wav'), 500, 0.002)), l = await read(wav(path.join(TMP, 'loud.wav'), 500, 0.3));
      assert(Math.abs(q.lv - expectDb(0.002)) < 1 && /安靜/.test(q.band), `quiet tone ${q.lv.toFixed(1)} dB (${q.band})`);
      assert(Math.abs(l.lv - expectDb(0.3)) < 1 && /吵雜/.test(l.band), `loud tone ${l.lv.toFixed(1)} dB (${l.band})`);
      assert(l.lv - q.lv >= 20, `loud - quiet = ${(l.lv - q.lv).toFixed(1)} dB (>= 20)`);
      const lo = await read(wav(path.join(TMP, 'low.wav'), 100, 0.1), true);
      assert(Math.abs(lo.lv - (expectDb(0.1) - 19.1)) < 1.5, `100 Hz with A-weighting reads ${lo.lv.toFixed(1)} dBA (≈ ${(expectDb(0.1) - 19.1).toFixed(1)})`);
    }

    // 4. cover: light theme, a live reading plus a minute of varied history
    {
      const browser = await chromium.launch(fake(wav(path.join(TMP, 'cover.wav'), 700, 0.08)));
      const { ctx, page } = await open(browser, URL, { ...mobile, viewport: { width: 390, height: 520 }, colorScheme: 'light' });
      await page.locator('.go').click(); await page.waitForFunction(() => __db.running);
      await page.evaluate(() => {
        const s = __db.session, now = Date.now(); s.reset();
        for (let i = 60; i >= 1; i--) { const base = 52 + 9 * Math.sin(i / 7) + (i > 18 && i < 26 ? 14 : 0) + ((i * 37) % 11) / 2; s.hist.push(now - i * 1000, base, base + 4 + ((i * 13) % 5), i === 22 ? 1 : 0); s.stats.add(base, base + 2, 1); }
      });
      await sleep(1500);
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); scrollTo(0, 0); __db.drawChart(); }); await sleep(200);
      await page.screenshot({ path: OUT + '/cover-390x520.png' });
      await ctx.close(); await browser.close();
    }
    console.log('all checks passed');
  } finally { srv.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
