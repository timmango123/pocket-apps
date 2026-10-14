// 辨色眼力 (color-eye) end-to-end verification.
// 1) Runs core-check.js (game's own generator: ΔE, quantization, uniform odd position, difficulty curve).
// 2) Auto-player plays one Classic run in real Chromium at 390x844 with real touch input (CDP Input.dispatchTouchEvent).
//    It finds the odd cell by READING PIXELS of a screenshot (fits a linear colour model in CIELAB across the board and
//    taps the biggest outlier), waits >=150 ms reaction before each tap, uses its 3 hints, plays to TARGET correct answers
//    (well past the ΔE 1.2 floor and the q>=40 hue-gradient interference), then taps wrong cells on purpose to end the run.
//    Records demo/run.mp4 and demo/run-result.png.
// Usage: node verify.js [targetCorrect=70]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {rgb8ToLab, deltaE, targetDE};')();
const TARGET = +(process.argv[2] || 70);
const sleep = ms => new Promise(r => setTimeout(r, ms));

execFileSync(process.execPath, [path.join(__dirname, 'core-check.js')], { stdio: 'inherit' });

async function touch(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(50 + Math.random() * 30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }
// least-squares fit v = c0 + c1 x + c2 y (per Lab channel), return residual ΔE per included cell
function residuals(pts, skip) {
  const use = pts.filter((p, i) => !p.dim && i !== skip);
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of use) { const v = [1, p.x, p.y]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += v[i] * v[j]; for (let c = 0; c < 3; c++) R[c][i] += v[i] * p.lab[c]; } }
  const solve = (A, b) => { const m = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < 3; i++) { let piv = i; for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[piv][i])) piv = r; [m[i], m[piv]] = [m[piv], m[i]]; if (Math.abs(m[i][i]) < 1e-12) return [b[0] / (A[0][0] || 1), 0, 0]; for (let r = 0; r < 3; r++) if (r !== i) { const f = m[r][i] / m[i][i]; for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c]; } } return m.map((r, i) => r[3] / r[i]); };
  const coef = [0, 1, 2].map(c => solve(M, R[c]));
  return pts.map(p => p.dim ? -1 : Math.hypot(...[0, 1, 2].map(c => p.lab[c] - (coef[c][0] + coef[c][1] * p.x + coef[c][2] * p.y))));
}
function findOdd(pts) {
  // 1) odd-one-out vs the median colour (works for flat boards of any size)
  const live = pts.filter(p => !p.dim), med = [0, 1, 2].map(c => { const v = live.map(p => p.lab[c]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const dm = pts.map(p => p.dim ? -1 : Math.hypot(p.lab[0] - med[0], p.lab[1] - med[1], p.lab[2] - med[2]));
  const order = dm.map((d, i) => [d, i]).sort((a, b) => b[0] - a[0]);
  if (order[0][0] > 0.3 && order[1][0] < 0.1) return order[0][1];
  // 2) board has a colour gradient. Gradient cells form smooth bands, so each one has a neighbour of (almost) the same
  //    colour; the odd cell differs from every neighbour. Among such "isolated" cells take the one off the fitted plane.
  const k = Math.round(Math.sqrt(pts.length));
  const iso = pts.map((p, i) => { if (p.dim) return -1; let m = 1e9; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const x = p.x + dx, y = p.y + dy; if (x < 0 || y < 0 || x >= k || y >= k) continue; const q = pts[y * k + x]; if (q.dim) continue; m = Math.min(m, C.deltaE(p.lab, q.lab)); } return m === 1e9 ? -1 : m; });
  const res = residuals(pts, -1);
  const cand = iso.map((v, i) => [v, i]).filter(v => v[0] > 0.45).map(v => v[1]);
  if (cand.length) { const r2 = residuals(pts, cand.reduce((a, b) => (res[b] > res[a] ? b : a))); return cand.reduce((a, b) => (r2[b] * Math.min(iso[b], 3) > r2[a] * Math.min(iso[a], 3) ? b : a)); }
  // 3) fallback: fit a plane in Lab and take the largest residual
  let r = residuals(pts, -1), best = r.indexOf(Math.max(...r));
  r = residuals(pts, best); // refit without the suspect so it cannot bend the plane
  return r.indexOf(Math.max(...r));
}

(async () => {
  const browser = await chromium.launch();
  const helper = await (await browser.newContext()).newPage(); // decodes screenshots into pixels
  await helper.setContent('<canvas id=c></canvas>');
  const vdir = path.join(OUT, '_vid'); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(1200);
  await tapSel(cdp, page, '.mode[data-m="classic"]');
  await sleep(400);
  const log = [], t0 = Date.now();
  let botWrong = 0, reactMin = 1e9, hintsUsed = 0;
  const st = () => page.evaluate(() => window.__game.state());
  while (true) {
    let s = await st();
    while (s.status === 'playing' && s.animating) { await sleep(20); s = await st(); }
    if (s.status !== 'playing') break;
    const shown = Date.now();
    if ([45, 55, 65].includes(s.correct) && s.hints > 0 && !log.find(l => l.hintAt === s.correct)) { await sleep(150); await tapSel(cdp, page, '#bHint'); hintsUsed++; log.push({ hintAt: s.correct }); await sleep(350); }
    const geo = await page.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(); return { b: { x: b.left, y: b.top, w: b.width, h: b.height }, cells: [...document.querySelectorAll('.cell')].map(e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.62, w: r.width, dim: e.classList.contains('dim') }; }) }; });
    const png = await page.screenshot({ clip: { x: geo.b.x, y: geo.b.y, width: geo.b.w, height: geo.b.h } });
    const rgbs = await helper.evaluate(async ({ b64, cells, b }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.getElementById('c'); c.width = img.width; c.height = img.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
      const sc = img.width / b.w;
      // 9 sample points across the lower-middle of each cell; take the most common colour so a passing paint droplet
      // or "+pts" label (they fly over the board) does not fool the reading
      return cells.map(cl => { const out = {}; const half = cl.w * 0.28;
        for (const dx of [-1, 0, 1]) for (const dy of [-0.6, 0, 0.6]) { const px = Math.round((cl.x + dx * half - b.x) * sc), py = Math.round((cl.y + dy * half * 0.6 - b.y) * sc);
          const d = x.getImageData(px, py, 1, 1).data, key = d[0] + ',' + d[1] + ',' + d[2]; out[key] = (out[key] || 0) + 1; }
        return Object.entries(out).sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number); });
    }, { b64: png.toString('base64'), cells: geo.cells, b: geo.b });
    const k = Math.round(Math.sqrt(geo.cells.length));
    const pts = rgbs.map((rgb, i) => ({ lab: C.rgb8ToLab(rgb), x: i % k, y: Math.floor(i / k), dim: geo.cells[i].dim }));
    let target = findOdd(pts);
    const ending = s.correct >= TARGET;
    if (ending) { target = (target + 1 + Math.floor(Math.random() * (geo.cells.length - 1))) % geo.cells.length; while (geo.cells[target].dim) target = (target + 1) % geo.cells.length; }
    const wait = 150 + Math.random() * 90 - (Date.now() - shown);
    if (wait > 0) await sleep(wait);
    reactMin = Math.min(reactMin, Date.now() - shown);
    await touch(cdp, geo.cells[target].x, geo.cells[target].y);
    await sleep(60);
    const s2 = await st();
    if (!ending && s2.correct === s.correct) botWrong++;
    if (!ending && s2.correct !== s.correct && [1, 10, 20, 30, 40, 50, 60, 70, 80].includes(s2.correct)) log.push({ correct: s2.correct, k: s.k, targetDE: +s.target.toFixed(2), timeLeft: +s2.time.toFixed(1), score: s2.score });
    if (ending) await sleep(200);
    if (Date.now() - t0 > 240000) break;
  }
  await sleep(1800);
  const fin = await st();
  await page.screenshot({ path: path.join(OUT, 'run-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'run.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  await browser.close();
  console.log('Difficulty ramp seen by the bot:'); console.table(log.filter(l => l.correct));
  console.log(`BOT RUN: status=${fin.status} score=${fin.score} correct=${fin.correct} maxStreak=${fin.maxStreak} minΔE=${fin.minDE.toFixed(2)} pixel-misreads=${botWrong} hintsUsed=${hintsUsed} minReaction=${reactMin}ms runtime=${secs}s video=${Math.round(fs.statSync(mp4).size / 1024)}KB errors=${errors.length ? errors.join(' | ') : 'none'}`);
})();
