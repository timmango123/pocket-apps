// End-to-end check for 錄音機 (voice-memo) in real Chromium with a fake microphone.
//  1. no permission prompt on load, no console errors, no horizontal overflow at 390 px
//  2. tap record -> fake mic records; pause stops the clock; stop saves a memo of the right length
//  3. the memo decodes, waveform + trim handles appear; drag the handles, apply trim (save as new),
//     download -> a real WAV whose header length matches the handle range within 50 ms
//  4. original download keeps its recorded format; reload -> recordings are still listed (IndexedDB)
//  5. auto trim works; a < 0.5 s recording is discarded
//  6. screen locked / app switched while recording -> keeps recording; pagehide -> stops and saves
//  7. blocked microphone (NotAllowedError without a prompt / no mediaDevices) -> message with the website link
// Writes screenshots (demo/*.png, not committed). Usage: node verify.js [--cover]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) { pass++; console.log('  ok  ', name, extra || ''); } else { fail++; console.log('  FAIL', name, extra || ''); } }
function wavInfo(buf) {
  const s = (o, n) => buf.toString('latin1', o, o + n);
  return { ok: s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE' && s(36, 4) === 'data', ch: buf.readUInt16LE(22), sr: buf.readUInt32LE(24), byteRate: buf.readUInt32LE(28), dataSize: buf.readUInt32LE(40), len: buf.length };
}

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, r));
  const url = `http://localhost:${srv.address().port}/`;
  // LANG must be UTF-8 or Chromium on Linux turns a non-ASCII download name into 'download'
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' }, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, permissions: ['microphone'] });
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.addInitScript(() => {
    window.__gum = 0;
    const md = navigator.mediaDevices, g = md && md.getUserMedia.bind(md);
    if (g) md.getUserMedia = (...a) => { window.__gum++; return g(...a); };
  });

  console.log('load');
  await p.goto(url); await sleep(800);
  t('no getUserMedia on load', await p.evaluate(() => window.__gum === 0));
  t('no horizontal overflow', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  t('empty state shown', await p.isVisible('#empty'));

  console.log('record');
  await p.click('#recBtn'); await sleep(2000);
  t('recording state', await p.evaluate(() => document.getElementById('rec').classList.contains('on')));
  t('mic requested once after tap', await p.evaluate(() => window.__gum === 1));
  t('live meter drawing', await p.evaluate(() => window.__vm && document.getElementById('live').width > 0));
  await p.screenshot({ path: path.join(OUT, 'recording.png') });
  await p.click('#pauseBtn'); const tp0 = await p.textContent('#timer'); await sleep(1000); const tp1 = await p.textContent('#timer');
  t('pause freezes the clock', tp0 === tp1, tp0);
  await p.click('#pauseBtn'); await sleep(2000);
  await p.click('#recBtn');
  await p.waitForSelector('.memo.open', { timeout: 8000 }).catch(async e => { console.log(await p.evaluate(() => JSON.stringify({ st: window.__vm.R.state, n: window.__vm.memos().length, toast: document.getElementById('toastMsg').textContent, sel: window.__vm.sel.id, html: document.getElementById('list').innerHTML.slice(0,300) }))); console.log(errs); throw e; });
  await p.waitForFunction(() => window.__vm.sel.buf || window.__vm.sel.bad, null, { timeout: 8000 });
  const m0 = await p.evaluate(() => { const m = window.__vm.memos()[0]; return { dur: m.duration, mime: m.mime, size: m.size, bad: window.__vm.sel.bad }; });
  t('memo saved, ~4 s (pause excluded)', Math.abs(m0.dur - 4) < 0.4, JSON.stringify(m0));
  t('decodable for editing', !m0.bad);
  t('mic track stopped', await p.evaluate(() => !window.__vm.R.stream));
  t('handles visible', await p.isVisible('#h0') && await p.isVisible('#h1'));

  console.log('download original');
  let [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dlBtn')]);
  const orig = path.join(OUT, 'orig.' + dl.suggestedFilename().split('.').pop()); await dl.saveAs(orig);
  t('original keeps its format', /\.webm$/.test(dl.suggestedFilename()) && fs.statSync(orig).size === m0.size, dl.suggestedFilename());
  fs.unlinkSync(orig);

  console.log('trim');
  const box = await p.locator('#wavebox').boundingBox();
  const drag = async (fromX, toX) => { const y = box.y + box.height / 2; await p.mouse.move(fromX, y); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(fromX + (toX - fromX) * i / 8, y); await p.mouse.up(); };
  await drag(box.x + 2, box.x + box.width * 0.2);
  await drag(box.x + box.width - 2, box.x + box.width * 0.7);
  const s = await p.evaluate(() => ({ a: window.__vm.sel.a, b: window.__vm.sel.b, dur: window.__vm.sel.dur }));
  t('handles dragged to 20% / 70%', Math.abs(s.a / s.dur - 0.2) < 0.03 && Math.abs(s.b / s.dur - 0.7) < 0.03, JSON.stringify(s));
  t('no page scroll from dragging', await p.evaluate(() => scrollX === 0));
  await p.screenshot({ path: path.join(OUT, 'trim.png') });
  await p.click('#playBtn'); await sleep(600);
  const ct = await p.evaluate(() => document.getElementById('player').currentTime);
  t('preview plays from trim start', ct >= s.a - 0.05 && ct < s.b, ct.toFixed(2));
  await p.click('#playBtn');
  await p.click('#applyBtn'); await p.click('#trimNew');
  await p.waitForFunction(() => window.__vm.memos().length === 2 && window.__vm.sel.buf, null, { timeout: 8000 });
  [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dlBtn')]);
  const wavPath = path.join(OUT, 'trimmed.wav'); await dl.saveAs(wavPath);
  const w = wavInfo(fs.readFileSync(wavPath)), wdur = w.dataSize / w.byteRate;
  t('trimmed download is .wav', /\.wav$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  t('valid WAV header', w.ok && w.len === 44 + w.dataSize, JSON.stringify(w));
  t('WAV length = handle range (±50 ms)', Math.abs(wdur - (s.b - s.a)) < 0.05, `${wdur.toFixed(3)} s vs ${(s.b - s.a).toFixed(3)} s`);
  fs.unlinkSync(wavPath);
  t('original kept when saving as new', await p.evaluate(() => window.__vm.memos().filter(m => m.mime.includes('webm')).length === 1));

  console.log('auto trim');
  await p.click('.memo:nth-child(2) .row');
  await p.waitForFunction(() => window.__vm.sel.buf, null, { timeout: 8000 });
  await p.click('#autoBtn'); await sleep(300);
  t('auto trim gives a valid range', await p.evaluate(() => { const s = window.__vm.sel; return s.a >= 0 && s.b <= s.dur && s.b - s.a >= 0.1; }), await p.textContent('#toastMsg'));

  console.log('short recording');
  await p.click('#recBtn'); await sleep(250); await p.click('#recBtn'); await sleep(700);
  t('< 0.5 s recording discarded', await p.evaluate(() => window.__vm.memos().length === 2), await p.textContent('#toastMsg'));

  console.log('page hidden while recording');
  await p.click('#recBtn'); await sleep(1500);
  await p.evaluate(() => { window.__trk = window.__vm.R.stream.getAudioTracks()[0]; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(2000);
  const hid = await p.evaluate(() => ({ st: window.__vm.R.state, track: window.__trk.readyState, rec: window.__vm.R.rec && window.__vm.R.rec.state }));
  t('hidden -> still recording, mic track live', hid.st === 'rec' && hid.track === 'live' && hid.rec === 'recording', JSON.stringify(hid));
  t('hidden -> backup flushed to IndexedDB', await p.evaluate(() => new Promise(r => { const o = indexedDB.open('voice-memo', 1); o.onsuccess = () => { const q = o.result.transaction('pending').objectStore('pending').get('cur'); q.onsuccess = () => r(!!(q.result && q.result.blob.size > 0)); }; })));
  await p.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(300);
  t('visible again -> recording continues, clock counted the hidden time', await p.evaluate(() => window.__vm.R.state === 'rec') && /^00:0[3-4]/.test(await p.textContent('#timer')), await p.textContent('#timer'));
  await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await p.waitForFunction(() => window.__vm.memos().length === 3, null, { timeout: 8000 }).catch(() => {});
  const ph = await p.evaluate(() => ({ n: window.__vm.memos().length, dur: window.__vm.memos()[0].duration, track: window.__trk.readyState, st: window.__vm.R.state }));
  t('pagehide -> stopped and saved (~3.8 s incl. hidden time), mic released', ph.n === 3 && Math.abs(ph.dur - 3.8) < 0.5 && ph.track === 'ended' && ph.st === 'idle', JSON.stringify(ph));
  await sleep(300);
  t('pagehide -> backup cleared after save', await p.evaluate(() => new Promise(r => { const o = indexedDB.open('voice-memo', 1); o.onsuccess = () => { const q = o.result.transaction('pending').objectStore('pending').get('cur'); q.onsuccess = () => r(!q.result); }; })));

  console.log('persistence');
  await p.reload(); await sleep(1000);
  t('recordings survive reload', await p.evaluate(() => document.querySelectorAll('.memo').length === 3));
  t('no recovery banner after a clean save', !(await p.isVisible('#recover')));
  t('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();

  console.log('blocked microphone');
  for (const [label, init] of [
    ['NotAllowedError without prompt', () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); }],
    ['no navigator.mediaDevices', () => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); }]]) {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } }), q = await c2.newPage(), e2 = [];
    q.on('pageerror', e => e2.push(e.message));
    await q.addInitScript(init); await q.goto(url); await sleep(400);
    await q.click('#recBtn'); await sleep(400);
    const href = await q.getAttribute('#notice a', 'href').catch(() => null);
    t(label + ' -> website link', href === 'https://timmango123.github.io/pocket-apps/tools/#voice-memo' && await q.isVisible('#notice'), await q.textContent('#notice'));
    t(label + ' -> link opens in new tab', await q.getAttribute('#notice a', 'target') === '_blank');
    t(label + ' -> record key usable again, no errors', !(await q.isDisabled('#recBtn')) && !e2.length);
    if (label.startsWith('NotAllowed')) await q.screenshot({ path: path.join(OUT, 'blocked.png') });
    await c2.close();
  }

  if (process.argv.includes('--cover')) {
    // cover: a recording in progress above two saved memos, at 390x520
    // feed the fake mic a speech-like signal (syllable envelopes over a buzzy voice) so the meter looks like talking
    const sr = 48000, n = sr * 12, pcm = Buffer.alloc(44 + n * 2), os = require('os');
    pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
    pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const syl = []; for (let t = 0.2; t < 12;) { const d = 0.12 + rnd() * 0.25; syl.push([t, d, 0.15 + rnd() * 0.85]); t += d + (rnd() < 0.2 ? 0.35 + rnd() * 0.4 : 0.03 + rnd() * 0.08); }
    for (let i = 0, k = 0; i < n; i++) {
      const t = i / sr; while (k < syl.length - 1 && t > syl[k][0] + syl[k][1]) k++;
      const [s0, d, a] = syl[k], x = (t - s0) / d, env = x > 0 && x < 1 ? Math.sin(Math.PI * x) * a : 0;
      const f0 = 140 + 30 * Math.sin(t * 3), v = Math.sin(2 * Math.PI * f0 * t) * 0.5 + Math.sin(4 * Math.PI * f0 * t) * 0.3 + Math.sin(6 * Math.PI * f0 * t) * 0.2;
      pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * env * 0.9)) * 32767), 44 + i * 2);
    }
    const voice = path.join(os.tmpdir(), 'voice-memo-cover.wav'); fs.writeFileSync(voice, pcm);
    const b2 = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + voice] });
    const c3 = await b2.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2, colorScheme: 'light', permissions: ['microphone'] }), q = await c3.newPage();
    await q.goto(url); await sleep(500);
    await q.evaluate(async () => {
      const mk = (name, dur, seed) => { const pk = { min: [], max: [] }; for (let i = 0; i < 800; i++) { const v = Math.abs(Math.sin(i * 0.05 + seed) * Math.sin(i * 0.013 + seed * 3)) * 0.8; pk.max.push(v); pk.min.push(-v * 0.9); } return { id: 'c' + seed, name, createdAt: Date.now() - seed * 3600e3, duration: dur, mime: 'audio/webm', size: Math.round(dur * 4100), blob: new Blob([new Uint8Array(10)], { type: 'audio/webm' }), peaks: pk }; };
      const db = await new Promise(r => { const o = indexedDB.open('voice-memo', 1); o.onsuccess = () => r(o.result); });
      await new Promise(r => { const tx = db.transaction('memos', 'readwrite'); [mk('週會重點：新版上線時程', 312.4, 1), mk('吉他和弦練習', 94.7, 2)].forEach(m => tx.objectStore('memos').put(m)); tx.oncomplete = r; });
    });
    await q.reload(); await sleep(600);
    await q.click('#recBtn'); await sleep(7200);
    await q.screenshot({ path: path.join(OUT, 'cover.png') });
    await b2.close(); fs.unlinkSync(voice);
  }
  await browser.close(); srv.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
