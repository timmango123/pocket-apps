// Usage: node clip-probe.js   (SIZES=360x640,... APP=other.html OUT=result.json)
// Extended clip probe: every stage 1-100 at many sizes; objective strip (whole strip and each part, also with the door
// open), HUD (pause inside, power-up chips not cut, nothing past the right edge) with worst-case power-ups and lives.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const SKEL = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const html = SKEL + fs.readFileSync(process.env.APP || require('path').resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SIZES = (process.env.SIZES || '320x568,320x640,360x640,375x667,390x844,430x932,375x500,390x610,430x740,844x390').split(',').map(s => s.split('x').map(Number));
(async () => {
  const b = await chromium.launch(); const out = {};
  for (const [w, h] of SIZES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await ctx.route('**/*', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('http://bm.test/'); await sleep(300);
    const r = await page.evaluate(async () => {
      const $ = id => document.getElementById(id), g = window.__game; g.manual(true);
      const res = { info: [], hud: [], cells: {}, infoModes: {}, hudLv: {} };
      const over = el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      const inside = (a, c) => a.left >= c.left - 0.5 && a.right <= c.right + 0.5 && a.top >= c.top - 0.5 && a.bottom <= c.bottom + 0.5;
      const checkInfo = (n, tag) => {
        const info = $('info'); if (getComputedStyle(info).display === 'none') return;
        const ib = info.getBoundingClientRect();
        if (over(info)) res.info.push(n + tag + ':strip' + (info.scrollWidth - info.clientWidth));
        for (const c of info.querySelectorAll('.mons,.mon,.goal')) { if (over(c) || !inside(c.getBoundingClientRect(), ib)) res.info.push(n + tag + ':' + c.className + ':' + c.textContent); }
        if (ib.right > innerWidth + 0.5 || ib.left < -0.5) res.info.push(n + tag + ':offscreen');
      };
      const checkHud = (n, tag) => {
        const hd = $('hud').getBoundingClientRect();
        for (const id of ['hudLab', 'hudTime', 'hudLives', 'pauseBtn']) { const e = $(id).getBoundingClientRect(); if (e.width && !inside(e, hd)) res.hud.push(n + tag + ':' + id); }
        const pw = $('hudPw'); if (over(pw)) res.hud.push(n + tag + ':pw' + (pw.scrollWidth - pw.clientWidth));
        for (const c of pw.children) if (!inside(c.getBoundingClientRect(), pw.getBoundingClientRect())) res.hud.push(n + tag + ':chip ' + c.textContent);
        if (hd.right > innerWidth + 0.5) res.hud.push(n + tag + ':hud past edge');
        const p = $('pauseBtn').getBoundingClientRect(); if (p.right > innerWidth + 0.5 || p.top < hd.top - 0.5 || p.bottom > hd.bottom + 0.5) res.hud.push(n + tag + ':pause cut');
      };
      for (let n = 1; n <= 100; n++) {
        g.startStage(n); g.tick(1100); await new Promise(r => requestAnimationFrame(r));
        checkInfo(n, ''); res.infoModes[n] = $('info').className;
        const s = g.sim(); res.cells[n] = s ? undefined : 0;
        // door open
        s.enemies.forEach(e => e.alive = false); g.tick(100); checkInfo(n, 'door');
        // worst HUD
        const bm = s.bombers[0]; bm.bombs = 8; bm.fire = 8; bm.speed = 5.2; bm.kick = true; bm.shield = true; s.lives = 5; g.tick(20);
        checkHud(n, 'max'); res.hudLv[n] = $('hud').className;
      }
      return res;
    });
    r.errs = errs; delete r.cells;
    const modes = {}; for (const v of Object.values(r.infoModes)) modes[v || 'm0'] = (modes[v || 'm0'] || 0) + 1;
    const lv = {}; for (const v of Object.values(r.hudLv)) lv[v || 'c0'] = (lv[v || 'c0'] || 0) + 1;
    out[w + 'x' + h] = { info: r.info, hud: r.hud, infoModes: modes, hudLevels: lv, errs: errs };
    console.log(w + 'x' + h, JSON.stringify(out[w + 'x' + h]));
    await ctx.close();
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
  await b.close();
})();
