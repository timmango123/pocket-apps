// Shared helpers for the asteroid-storm release review (serves the snapshot, mobile contexts, CDP touch).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = path.resolve(__dirname, '../../../apps/asteroid-storm/index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  const reqs = [];
  const srv = http.createServer((req, res) => { reqs.push(req.url); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(SRC)); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, reqs, url: `http://127.0.0.1:${srv.address().port}/app/asteroid-storm/` })));
}
async function launch() { return chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); }
async function newPage(browser, w, h, scheme, extra) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme || 'dark', ...(extra || {}) });
  const page = await ctx.newPage(), errors = [], external = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e.stack || e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith('http://127.0.0.1') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, errors, external, cdp };
}
// Multi-finger CDP touch. Measured: touchStart/touchMove list all active fingers; touchEnd lists only the finger(s) lifted ([] lifts all).
class Hands {
  constructor(cdp) { this.cdp = cdp; this.f = {}; }
  pts() { return Object.entries(this.f).map(([id, p]) => ({ x: p.x, y: p.y, id: +id })); }
  async send(type) { await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: this.pts() }); }
  async down(id, x, y) { this.f[id] = { x, y }; await this.send('touchStart'); }
  async move(id, x, y) { this.f[id] = { x, y }; await this.send('touchMove'); }
  async moveAll(m) { for (const id in m) this.f[id] = m[id]; await this.send('touchMove'); }
  async up(id) { const p = this.f[id]; delete this.f[id]; await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id: +id }] }); }
  async upAll() { this.f = {}; await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  async tap(x, y, id = 9, hold = 50) { await this.down(id, x, y); await sleep(hold); await this.up(id); }
}
const center = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; }, sel);
const st = page => page.evaluate(() => window.__game.state());
module.exports = { serve, launch, newPage, Hands, center, st, sleep, SRC };
