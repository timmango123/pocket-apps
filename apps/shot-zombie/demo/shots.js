// Screenshot + smoke test (pointer taps, wrong taps, pause, results, storage-throw, desktop) for 射擊殭屍.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = process.argv[2] || '/tmp';
(async () => {
  const browser = await chromium.launch(); const errs = [];
  const mk = async (opts, init) => { const ctx = await browser.newContext(opts); if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push('pageerror ' + e)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); return p; };
  const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const p = await mk(mobile);
  await p.goto(URL); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + '/01-title.png' });
  await p.tap('#mSurv'); await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/02-start.png' });
  // play with taps at correct lanes via touch
  const tapLane = async l => { const L = await p.evaluate(() => window.__game.layout()); await p.touchscreen.tap(L.playX + L.laneW * (l + .5), L.btnTop + L.btnH / 2); };
  const closest = () => p.evaluate(() => { const s = window.__game.state(); let b = null; for (const e of s.ents) if (e.type === 'z' && e.y > window.__game.VIS && (!b || e.y > b.y)) b = e; return b; });
  for (let i = 0, n = 0; i < 60 && n < 6; i++) { const z = await closest(); if (z && z.y > 0.12) { await tapLane(z.lane); n++; } await p.waitForTimeout(120); }
  await p.waitForTimeout(40); await p.screenshot({ path: OUT + '/03-kill.png' });
  let st = await p.evaluate(() => window.__game.state()); console.log('after taps', st.kills, st.hearts, st.wrong);
  // wrong tap
  let z = null; for (let i = 0; i < 40 && !(z = await closest()); i++) await p.waitForTimeout(100); await tapLane((z.lane + 1) % 3); await p.waitForTimeout(120);
  await p.screenshot({ path: OUT + '/04-wrong.png' });
  st = await p.evaluate(() => window.__game.state()); console.log('after wrong', st.kills, st.hearts, st.wrong);
  // pause
  await p.tap('#btnPause'); await p.waitForTimeout(200); await p.screenshot({ path: OUT + '/05-pause.png' });
  await p.tap('#pResume'); await p.waitForTimeout(200);
  // jump ahead: fake kills to reach armor/survivor stage via bot
  await p.evaluate(() => { const g = window.__game; const keys = ['1','2','3','4']; let pend = false, last = '';
    (function t() { const s = g.state(); if (s.phase === 'play' && !pend && !window.__stop) { let b = null; for (const e of s.ents) if (e.type === 'z' && e.y > g.VIS && (!b || e.y > b.y)) b = e;
      if (b && b.id + ':' + b.hp !== last) { last = b.id + ':' + b.hp; pend = true; setTimeout(() => { pend = false; window.dispatchEvent(new KeyboardEvent('keydown', { key: keys[b.lane] })); }, 150); } }
      requestAnimationFrame(t); })(); });
  for (let i = 0; i < 120; i++) { await p.waitForTimeout(500); st = await p.evaluate(() => window.__game.state()); if (st.kills >= 52 || st.phase !== 'play') break; }
  // wait for a survivor + armored on screen
  for (let i = 0; i < 40; i++) { st = await p.evaluate(() => window.__game.state()); if (st.ents.some(e => e.type === 's' && e.y > 0.25) && st.ents.some(e => e.armor && e.y > 0.1)) break; await p.waitForTimeout(150); }
  await p.screenshot({ path: OUT + '/06-late.png' }); await p.evaluate(() => window.__stop = true);
  console.log('late', st.kills, st.lanes, st.phase);
  // let it overrun
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(500); st = await p.evaluate(() => window.__game.state()); if (st.phase === 'over') break; }
  await p.screenshot({ path: OUT + '/07-result.png' });
  console.log('result phase', st.phase, st.kills, st.score);
  await p.keyboard.press('r'); await p.waitForTimeout(300);
  console.log('after retry', (await p.evaluate(() => window.__game.state())).phase);
  // time attack mobile
  await p.evaluate(() => window.__game.start('ta')); await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/08-ta.png' });
  // storage throws
  const q = await mk(mobile, () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); });
  await q.goto(URL); await q.waitForTimeout(500); await q.tap('#mTA'); await q.waitForTimeout(1500);
  console.log('storage-throw phase', (await q.evaluate(() => window.__game.state())).phase);
  // desktop
  const d = await mk({ viewport: { width: 1280, height: 800 } });
  await d.goto(URL); await d.waitForTimeout(800); await d.screenshot({ path: OUT + '/09-desk-title.png' });
  await d.click('#mSurv'); await d.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) { const s = await d.evaluate(() => window.__game.state()); let b = null; for (const e of s.ents) if (e.type === 'z' && e.y > 0.03 && (!b || e.y > b.y)) b = e; if (b) await d.keyboard.press('jkl;'[b.lane]); await d.waitForTimeout(200); }
  await d.waitForTimeout(30); await d.screenshot({ path: OUT + '/10-desk-play.png' });
  console.log('desk', JSON.stringify((({ kills, wrong }) => ({ kills, wrong }))(await d.evaluate(() => window.__game.state()))));
  // cover
  const cvp = await mk({ viewport: { width: 300, height: 400 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await cvp.goto(URL); await cvp.waitForTimeout(300); await cvp.evaluate(() => window.__game.start('ta')); await cvp.waitForTimeout(900);
  for (let i = 0; i < 9; i++) { await cvp.evaluate(() => { const s = window.__game.state(); let b = null; for (const e of s.ents) if (e.type === 'z' && e.y > -0.03 && (!b || e.y > b.y)) b = e; if (b) window.__game.press(b.lane); }); await cvp.waitForTimeout(260); }
  await cvp.evaluate(() => { const s = window.__game.state(); let b = null; for (const e of s.ents) if (e.type === 'z' && e.y > 0.03 && (!b || e.y > b.y)) b = e; window.__game.press(b.lane); });
  await cvp.waitForTimeout(45);
  await cvp.screenshot({ path: OUT + '/cover.jpg', type: 'jpeg', quality: 80 });
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})();
