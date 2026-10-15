// Verification for 合成波節拍 (rhythm-tap).
// 1) Runs check.js: every one of the 100 charts (built by the game's own core code) passes the playability rules
//    and is strictly harder than the previous one.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real multi-touch (CDP Input.dispatchTouchEvent):
//    one finger per lane, each note pressed at its time +0..40 ms (spec: player anticipates; notes are visible >= 680 ms),
//    holds held to the tail, swipes flicked 45 px. Records level-NN.mp4 (+ audio rendered by the game's own synth in an
//    OfflineAudioContext, synced to the start flash) and level-NN-result.png.
// Usage: node verify.js [--check-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FF = '/usr/bin/ffmpeg';

async function waitUntil(t) { const d = t - Date.now(); if (d > 4) await sleep(d - 3); while (Date.now() < t) { /* spin */ } }
async function tapSel(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 9 }] }); await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y, id: 9 }] });
}

async function playLevel(browser, n) {
  const vdir = path.join(OUT, '_vid' + n); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(); const tVideo0 = Date.now();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#tSelect'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(1500);
  await tapSel(cdp, page, '#sGo');
  await sleep(300);
  const chart = await page.evaluate(() => window.__game.chart());
  const epoch = await page.evaluate(() => window.__game.epoch());
  const lanes = await page.evaluate(() => window.__game.lanes());
  // build touch actions
  const acts = [];
  for (const nt of chart) {
    const x = lanes.cx + (nt.lane - 1.5) * lanes.lw, y = lanes.padY, id = nt.lane + 1, t0 = epoch + nt.t * 1000 + Math.random() * 40;
    acts.push({ t: t0, type: 'touchStart', p: { x, y, id } });
    if (nt.type === 1) acts.push({ t: epoch + nt.end * 1000 + 30, type: 'touchEnd', p: { x, y, id } });
    else if (nt.type === 2) {
      for (let k = 1; k <= 3; k++) acts.push({ t: t0 + 16 * k, type: 'touchMove', p: { x: x + nt.dir * 15 * k, y, id } });
      acts.push({ t: t0 + 70, type: 'touchEnd', p: { x: x + nt.dir * 45, y, id } });
    } else acts.push({ t: t0 + 55, type: 'touchEnd', p: { x, y, id } });
  }
  acts.sort((a, b) => a.t - b.t);
  let late = 0, maxLate = 0;
  for (const a of acts) {
    await waitUntil(a.t);
    const l = Date.now() - a.t; if (l > 15) late++; if (l > maxLate) maxLate = l;
    // fire-and-forget so a busy renderer can't stall the schedule; timestamp = moment of touch (like touch hardware)
    cdp.send('Input.dispatchTouchEvent', { type: a.type, touchPoints: [a.p], timestamp: Date.now() / 1000 }).catch(() => {});
  }
  for (let i = 0; i < 80; i++) { if (await page.isVisible('#result')) break; await sleep(250); }
  await sleep(1800);
  const st = await page.evaluate(() => window.__game.state());
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const tEnd = (Date.now() - tVideo0) / 1000 + 2;
  const wavB64 = await page.evaluate(() => window.__game.renderAudio());
  await sleep(500);
  await ctx.close();
  const wav = path.join(vdir, 'audio.wav'); fs.writeFileSync(wav, Buffer.from(wavB64, 'base64'));
  const webm = path.join(vdir, fs.readdirSync(vdir).find(f => f.endsWith('.webm')));
  // A/V sync: find the start flash (song time 0) near its expected position in the video
  const expect = (epoch - tVideo0) / 1000;
  let syncT = expect;
  try {
    const log = execFileSync('bash', ['-c', `${FF} -hide_banner -i "${webm}" -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - 2>/dev/null`]).toString();
    const fr = []; let cur = null;
    for (const line of log.split('\n')) { let m = line.match(/pts_time:([\d.]+)/); if (m) cur = +m[1]; m = line.match(/YAVG=([\d.]+)/); if (m && cur != null) fr.push([cur, +m[1]]); }
    let bestJ = 0;
    for (let i = 1; i < fr.length; i++) { if (Math.abs(fr[i][0] - expect) > 2) continue; const j = fr[i][1] - fr[i - 1][1]; if (j > bestJ) { bestJ = j; syncT = fr[i][0]; } }
  } catch (e) { }
  const mp4 = path.join(OUT, 'level-' + n + '.mp4'), dly = Math.max(0, Math.round(syncT * 1000));
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', webm, '-i', wav, '-filter_complex', `[1:a]adelay=${dly},apad[a]`, '-map', '0:v', '-map', '[a]', '-t', tEnd.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-r', '25', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const r = st.res || {};
  return { n, cleared: !!r.pass, grade: r.grade, acc: r.acc, cnt: r.cnt, maxCombo: r.maxCombo, notes: chart.length, late, maxLate, syncDelta: (syncT - expect).toFixed(2), errors, mb: (fs.statSync(mp4).size / 1048576).toFixed(1) };
}

(async () => {
  const args = process.argv.slice(2);
  console.log(execFileSync('node', [path.join(__dirname, 'check.js')]).toString());
  if (args.includes('--check-only')) return;
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const browser = await chromium.launch();
  for (const n of (lv.length ? lv : [50, 75, 99, 100])) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'grade', r.grade, 'acc', r.acc && r.acc.toFixed(2) + '%', 'P/G/Good/Miss', (r.cnt || []).join('/'), 'of', r.notes, 'notes, max combo', r.maxCombo,
      '| late touches', r.late, 'max', r.maxLate + 'ms | video', r.mb + 'MB (A/V sync flash found ' + r.syncDelta + 's from estimate)', r.errors.length ? 'ERRORS ' + r.errors.slice(0, 3).join(' | ') : 'no errors');
  }
  await browser.close();
})();
