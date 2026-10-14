// Skill-tier bot for word-world (字字成真). Sandbox: the goal is the 圖鑑 (dex, 42 living words).
// Usage: node bot.js [tier ...] [probes]   -> writes results.json
// Real headless Chromium, mobile 390x844 @2x, real time. Taps = CDP touch events; typing = CDP Input.insertText per
// character (what a phone IME commits), submit = tap on 「變！」. The bot READS window.__ww.state() / chip DOM
// (what is on screen) and the pure __ww.parse() to label what it typed; it never calls addWord/addBlob/step.
// rAF is wrapped only to (a) hold callbacks while the page is "hidden" (as real browsers do) and (b) measure
// frame cost and how many game-loop callbacks run per displayed frame.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const GAME = '/mnt/project-files/apps/word-world/index.html';
const SESSION_S = +(process.env.SESSION || 120);

// vocabulary as a player would type it (main Chinese name first, then English / aliases)
const VOCAB = [['cat','貓'],['dog','狗'],['fish','魚'],['bird','鳥'],['rabbit','兔子'],['bear','熊'],['penguin','企鵝'],['frog','青蛙'],['duck','鴨子'],['turtle','烏龜'],['butterfly','蝴蝶'],['bee','蜜蜂'],['tree','樹'],['flower','花'],['grass','草'],['mushroom','蘑菇'],['seed','種子'],['apple','蘋果'],['rain','雨'],['cloud','雲'],['snow','雪'],['wind','風'],['sun','太陽'],['moon','月亮'],['star','星星'],['rainbow','彩虹'],['fire','火'],['water','水'],['boat','船'],['car','車'],['house','房子'],['mountain','山'],['rock','石頭'],['snowman','雪人'],['balloon','氣球'],['ball','球'],['cake','蛋糕'],['candy','糖果'],['heart','愛心'],['music','音樂'],['night','星空'],['ghost','幽靈']];
const COMMON = ['cat','dog','fish','bird','tree','flower','rain','sun','moon','water','car','house','ball','cake','snow','star'];
const NOT_WORDS = ['恐龍','大象','老虎','汽球','彩紅','小豬','hello','dinosaur','月','海','車車車車','我想要一隻貓和一隻狗','pizza','火車','手機','unicorn'];
const ODD = ['', '   ', '😀', '🐱🐶', '👨‍👩‍👧‍👦家庭', 'ＣＡＴ', 'Cat', 'scat cat', '貓貓貓貓貓貓貓', 'a'.repeat(60), '<b>貓</b>', 'cat貓dog狗fish魚bird鳥', '　', '​', 'catdog', 'sun moon sun moon', '大家好'];
const TYPO_ZH = { 貓: '苗', 狗: '夠', 魚: '漁', 鳥: '島', 熊: '能', 樹: '數', 花: '華', 雨: '語', 雲: '云', 雪: '血', 風: '楓', 火: '伙', 水: '誰', 船: '傳', 車: '扯', 山: '三', 球: '求', 星: '心', 太: '大', 陽: '楊', 月: '越', 亮: '量' };
const KEYS = 'qwertyuiopasdfghjklzxcvbnm';

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, cps: 1.5, typo: 0.15, random: 0.5, vocab: 12, combo: 1, chipRate: 0.35, fixTypos: 0,   target: false, events: true },
  casual:     { react: [400, 100], pos: 20, cps: 3,   typo: 0.06, random: 0.15, vocab: 25, combo: 2, chipRate: 0.3, fixTypos: 0.3, target: false },
  skilled:    { react: [260, 50],  pos: 10, cps: 5,   typo: 0.02, random: 0,    vocab: 38, combo: 3, chipRate: 0.4, fixTypos: 0.9, target: true },
  world:      { react: [180, 25],  pos: 4,  cps: 8,   typo: 0.003, random: 0,   vocab: 42, combo: 5, chipRate: 0.2, fixTypos: 1,   target: true },
  superhuman: { react: [16, 0],    pos: 0,  cps: 1000, typo: 0,    random: 0,   vocab: 42, combo: 5, chipRate: 0,   fixTypos: 1,   target: true },
};

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const sleep = ms => new Promise(res => setTimeout(res, Math.max(0, ms)));

const INIT = `(() => {
  const realRAF = window.requestAnimationFrame.bind(window);
  let hid = false; const held = [];
  const fc = window.__fc = { cbs: 0, frames: 0, maxPerFrame: 0, cbMs: [], lastTs: -1, perTs: 0 };
  const wrap = cb => ts => {
    if (hid) { held.push(cb); return; }
    if (ts !== fc.lastTs) { fc.lastTs = ts; fc.frames++; fc.perTs = 0; }
    fc.perTs++; fc.cbs++; if (fc.perTs > fc.maxPerFrame) fc.maxPerFrame = fc.perTs;
    const t0 = performance.now(); cb(ts); const d = performance.now() - t0; if (fc.cbMs.length < 20000) fc.cbMs.push(d);
  };
  window.requestAnimationFrame = cb => realRAF(wrap(cb));
  Object.defineProperty(Document.prototype, 'hidden', { get() { return hid; }, configurable: true });
  Object.defineProperty(Document.prototype, 'visibilityState', { get() { return hid ? 'hidden' : 'visible'; }, configurable: true });
  window.__setHidden = h => { hid = h; document.dispatchEvent(new Event('visibilitychange')); if (!h) { const c = held.splice(0); c.forEach(cb => realRAF(wrap(cb))); } };
  window.__fcReset = () => { fc.cbs = 0; fc.frames = 0; fc.maxPerFrame = 0; fc.cbMs = []; };
  try { localStorage.setItem('wordworld.muted', 'true'); } catch (e) {}
})();`;

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(GAME, 'utf8') + '</body></html>';
  await ctx.route('**/*', r => r.request().url().startsWith('http://game.test/') ? r.fulfill({ body: html, contentType: 'text/html' }) : r.abort());
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto('http://game.test/');
  await sleep(600);
  return { ctx, page, cdp, errors };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 8, radiusY: 8, force: 1 })) });
async function tap(cdp, x, y, hold = 60) { await touch(cdp, 'touchStart', [{ x, y }]); await sleep(hold); await touch(cdp, 'touchEnd', []); }
async function rect(page, sel) { return page.evaluate(s => { const e = typeof s === 'string' ? document.querySelector(s) : null; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel); }
const chipInfo = page => page.evaluate(() => { const box = document.getElementById('chips').getBoundingClientRect(); return [...document.querySelectorAll('.chip')].map(c => { const r = c.getBoundingClientRect(); return { id: c.dataset.id, found: c.classList.contains('found'), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, visible: r.left >= box.left - 2 && r.right <= box.right - 20 }; }); });
const wstate = page => page.evaluate(() => { const s = __ww.state(); return { n: s.n, found: s.found, pond: s.pond, day: +s.day.toFixed(2), types: s.types, toast: document.getElementById('toast').textContent }; });

async function typeText(env, T, r, text, log) {
  const { page, cdp } = env;
  const inp = await rect(page, '#word');
  await tap(cdp, inp.x + gauss(r) * T.pos * 0.3, inp.y + gauss(r) * T.pos * 0.2);
  let typed = '';
  for (const ch of [...text]) {
    let c = ch;
    if (T.typo && r() < T.typo) {
      c = /[a-z]/i.test(ch) ? KEYS[Math.floor(r() * 26)] : (TYPO_ZH[ch] || '的');
      if (r() < T.fixTypos) { // notices, backspaces, retypes
        await cdp.send('Input.insertText', { text: c }); await sleep(1000 / T.cps + T.react[0]);
        await page.keyboard.press('Backspace'); log.typoFixed++; c = ch;
      } else log.typoKept++;
    }
    await cdp.send('Input.insertText', { text: c }); typed += c;
    if (T.cps < 1000) await sleep(1000 / T.cps * (1 + gauss(r) * 0.25));
  }
  return page.evaluate(() => document.getElementById('word').value);
}
async function submit(env, T, r) {
  const b = await rect(env.page, '#goBtn');
  await tap(env.cdp, b.x + gauss(r) * T.pos * 0.4, b.y + gauss(r) * T.pos * 0.3);
}

async function session(browser, tierId, T, seed) {
  const r = rng(seed);
  const env = await newPage(browser); const { page, cdp } = env;
  const log = { submits: 0, recognisedWords: 0, blobs: 0, emptySubmits: 0, chipTaps: 0, worldTaps: 0, typoFixed: 0, typoKept: 0, missedTaps: 0, timeline: [], odd: [], clumsy: [] };
  const known = (T.vocab >= 42 ? VOCAB : [...VOCAB.filter(v => COMMON.includes(v[0])), ...VOCAB.filter(v => !COMMON.includes(v[0]))].slice(0, T.vocab)).map(v => v[0]);
  const zh = Object.fromEntries(VOCAB.map(v => [v[0], v[1]]));
  await page.evaluate(() => __fcReset());
  const t0 = Date.now(); let lastFound = 0; let full = null; let maxEnts = 0;
  const react = () => Math.max(16, T.react[0] + gauss(r) * T.react[1]);
  while (Date.now() - t0 < SESSION_S * 1000) {
    const s = await wstate(page); maxEnts = Math.max(maxEnts, s.n);
    if (s.found !== lastFound) { log.timeline.push([+((Date.now() - t0) / 1000).toFixed(1), s.found]); lastFound = s.found; }
    if (s.found >= 42 && !full) { full = +((Date.now() - t0) / 1000).toFixed(1); if (tierId !== 'clumsy') break; }
    await sleep(react());
    // clumsy extras
    if (T.events && r() < 0.12) {
      const k = Math.floor(r() * 4);
      if (k === 0) { const st = await rect(page, '#world'); await touch(cdp, 'touchStart', [{ x: st.l + r() * st.w, y: st.t + r() * st.h, id: 0 }, { x: st.l + r() * st.w, y: st.t + r() * st.h, id: 1 }]); await sleep(120); await touch(cdp, 'touchEnd', []); log.clumsy.push('two-finger tap'); }
      else if (k === 1) { const st = await rect(page, '#world'); const x = st.l + r() * st.w, y = st.t + st.h * (0.3 + r() * 0.6); for (let i = 0; i < 10; i++) { await tap(cdp, x, y, 15); await sleep(25); } log.clumsy.push('rapid taps x10'); }
      else if (k === 2) { await page.setViewportSize({ width: 844, height: 390 }); await sleep(1500); await page.setViewportSize({ width: 390, height: 844 }); await sleep(400); log.clumsy.push('rotate & back'); }
      else { await page.evaluate(() => __setHidden(true)); await sleep(1500); await page.evaluate(() => __setHidden(false)); log.clumsy.push('background 1.5 s'); }
      continue;
    }
    const chips = await chipInfo(page);
    const undiscovered = known.filter(id => !chips.find(c => c.id === id && c.found));
    const roll = r();
    if (T.random && roll < T.random) {
      // random / odd behaviour
      const k = r();
      if (k < 0.3) { const vis = chips.filter(c => c.visible); const c = vis[Math.floor(r() * vis.length)]; await tap(cdp, c.x + gauss(r) * T.pos, c.y + gauss(r) * T.pos * 0.5); log.chipTaps++; }
      else if (k < 0.5) { const st = await rect(page, '#world'); await tap(cdp, st.l + r() * st.w, st.t + r() * st.h); log.worldTaps++; }
      else if (k < 0.75) { const odd = ODD[Math.floor(r() * ODD.length)]; const v = await typeText(env, T, r, odd, log); await submit(env, T, r); await sleep(300); const after = await wstate(page); log.odd.push({ input: odd, field: v, toast: after.toast }); log.submits++; if (!v.trim()) log.emptySubmits++; }
      else { const w = NOT_WORDS[Math.floor(r() * NOT_WORDS.length)]; const v = await typeText(env, T, r, w, log); const ids = await page.evaluate(v => __ww.parse(v), v); await submit(env, T, r); log.submits++; if (ids.length) log.recognisedWords += ids.length; else log.blobs++; }
      continue;
    }
    if (r() < T.chipRate || !undiscovered.length && T.target) {
      // look for an undiscovered chip (targeting tiers) or any chip; scroll the chip row with a swipe if needed
      const pool = T.target ? chips.filter(c => !c.found) : chips;
      if (!pool.length) { await sleep(200); continue; }
      let c = pool.find(c => c.visible);
      if (!c) {
        const box = await rect(page, '#chips'); const dir = pool[0].x > box.r ? -1 : 1;
        const y = box.t + 20; const x0 = box.x + 100 * -dir * -1; // swipe
        await touch(cdp, 'touchStart', [{ x: box.x - dir * -120, y }]);
        for (let i = 1; i <= 8; i++) { await touch(cdp, 'touchMove', [{ x: box.x - dir * -120 + dir * 30 * i, y }]); await sleep(16); }
        await touch(cdp, 'touchEnd', []); await sleep(350);
        continue;
      }
      const ex = gauss(r) * T.pos, ey = gauss(r) * T.pos * 0.5;
      await tap(cdp, c.x + ex, c.y + ey); log.chipTaps++;
      if (Math.abs(ey) > 24 || Math.abs(ex) > c.w / 2) log.missedTaps++;
      continue;
    }
    // type one or more words
    const pool = T.target && undiscovered.length ? undiscovered : known;
    const n = Math.max(1, Math.min(T.combo, 1 + Math.floor(r() * T.combo)));
    const pickW = []; for (let i = 0; i < n && pool.length; i++) { const id = pool[Math.floor(r() * pool.length)]; if (!pickW.includes(id)) pickW.push(id); }
    const useEn = r() < 0.25; // sometimes English
    const text = pickW.map(id => useEn ? id : zh[id]).join(useEn ? ' ' : '');
    const v = await typeText(env, T, r, text, log);
    const ids = await page.evaluate(v => __ww.parse(v), v);
    await submit(env, T, r); log.submits++;
    if (ids.length) log.recognisedWords += ids.length; else log.blobs++;
    await sleep(250 * ids.length);
  }
  const s = await wstate(page);
  const fc = await page.evaluate(() => { const a = __fc.cbMs.slice().sort((x, y) => x - y); return { frames: __fc.frames, cbs: __fc.cbs, maxPerFrame: __fc.maxPerFrame, cbMsMean: +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(2), cbMsP95: +a[Math.floor(a.length * 0.95)].toFixed(2) }; });
  const secs = (Date.now() - t0) / 1000;
  const out = { durationS: +secs.toFixed(1), dexFound: s.found, dexFullAtS: full, wordsPerMin: +(log.recognisedWords / secs * 60).toFixed(1), discoveriesPerMin: +(s.found / secs * 60).toFixed(1), finalEntities: s.n, maxEntities: maxEnts, loopFrames: fc, ...log, errors: env.errors.slice(0, 5) };
  if (!out.odd.length) delete out.odd; if (!out.clumsy.length) delete out.clumsy;
  await env.ctx.close();
  return out;
}

// targeted bug probes (run once, not tier specific)
async function probes(browser) {
  const P = {};
  // 1. background/foreground cycles -> number of game-loop callbacks per displayed frame
  { const env = await newPage(browser); const { page } = env;
    const counts = [];
    for (let i = 0; i <= 5; i++) {
      await page.evaluate(() => __fcReset()); await sleep(1000);
      counts.push(await page.evaluate(() => ({ perFrame: +(__fc.cbs / __fc.frames).toFixed(2), maxPerFrame: __fc.maxPerFrame, cbMs: +(__fc.cbMs.reduce((a, b) => a + b, 0) / __fc.cbMs.length).toFixed(2) })));
      await page.evaluate(() => __setHidden(true)); await sleep(300); await page.evaluate(() => __setHidden(false)); await sleep(200);
    }
    P.backgroundCycles = counts; P.backgroundErrors = env.errors.slice(0, 3); await env.ctx.close(); }
  // 2. rapid taps on the grown tree -> apples with no cap
  { const env = await newPage(browser); const { page, cdp } = env;
    const tree = await page.evaluate(() => { const t = __ww.ents.find(e => e.type === 'tree'); const r = document.getElementById('world').getBoundingClientRect(); return { x: r.left + t.x, y: r.top + t.y - 18, grow: t.grow }; });
    const before = (await wstate(page)).n;
    for (let i = 0; i < 300; i++) { await tap(cdp, tree.x, tree.y, 10); await sleep(10); }
    await sleep(500);
    const s = await wstate(page);
    await page.evaluate(() => __fcReset()); await sleep(2000);
    const cost = await page.evaluate(() => +(__fc.cbMs.reduce((a, b) => a + b, 0) / __fc.cbMs.length).toFixed(2));
    P.treeTapFlood = { taps: 300, entsBefore: before, entsAfter: s.n, apples: s.types.filter(t => t === 'apple').length, frameCbMs: cost };
    // does typing still trim? add 3 words
    await env.ctx.close(); }
  // 3. parser edge cases (pure function)
  { const env = await newPage(browser);
    P.parse = await env.page.evaluate(() => Object.fromEntries(['scat cat', 'cats', 'ＣＡＴ', 'Cat', 'catdog', '大家好', '開心', '點心', '心情', '我家', '月餅', '夜市', 'sun moon', 'bobcat cat', 'water lily', '貓貓貓貓貓貓貓'].map(s => [s, __ww.parse(s)])));
    // 4. maxlength vs long paste / emoji
    const inp = await rect(env.page, '#word'); await tap(env.cdp, inp.x, inp.y);
    await env.cdp.send('Input.insertText', { text: '👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦' });
    P.emojiField = await env.page.evaluate(() => document.getElementById('word').value);
    const b = await rect(env.page, '#goBtn'); await tap(env.cdp, b.x, b.y); await sleep(300);
    P.emojiBlob = await env.page.evaluate(() => { const e = __ww.ents.filter(e => e.type === 'blob').pop(); return e ? { label: e.label, codepoints: [...e.label].length } : null; });
    await env.ctx.close(); }
  // 5. rotate with entities: all entities stay inside the world after 390x844 -> 844x390 -> back
  { const env = await newPage(browser); const { page } = env;
    const chips = await chipInfo(page);
    for (const id of ['water', 'fish', 'duck', 'cat', 'car', 'boat']) { const c = (await chipInfo(page)).find(c => c.id === id); if (c && c.visible) await tap(env.cdp, c.x, c.y); await sleep(300); }
    await sleep(1500);
    const snap = () => page.evaluate(() => { const r = document.getElementById('world').getBoundingClientRect(); return { W: r.width, H: r.height, out: __ww.ents.filter(e => e.x < -60 || e.x > r.width + 60 || e.y < -60 || e.y > r.height + 60).map(e => e.type), fishOutOfPond: __ww.ents.filter(e => e.type === 'fish' && e.state === 'swim').map(f => { const p = __ww.ents.find(e => e.type === 'water'); const dx = (f.x - p.x) / p.rx, dy = (f.y - p.y) / p.ry; return +(dx * dx + dy * dy).toFixed(2); }) }; });
    const a = await snap();
    await page.setViewportSize({ width: 844, height: 390 }); await sleep(800); const b2 = await snap();
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(800); const c2 = await snap();
    P.rotate = { before: a, landscape: b2, after: c2, errors: env.errors.slice(0, 3) };
    await page.setViewportSize({ width: 844, height: 390 }); await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'landscape.png') });
    await env.ctx.close(); }
  return P;
}

async function main() {
  const args = process.argv.slice(2);
  const tiers = args.filter(a => TIERS[a]);
  const run = tiers.length || args.includes('probes') ? tiers : Object.keys(TIERS);
  const resPath = path.join(OUT, 'results.json');
  const results = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, 'utf8')) : { game: 'word-world', tiers: {}, findings: [] };
  results.harness = { viewport: '390x844@2 touch', sessionS: SESSION_S, note: 'real time; one session per tier (stops early when dex is complete, except clumsy)' };
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  for (const tierId of run) {
    const s = await session(browser, tierId, TIERS[tierId], 4242 + tierId.length);
    console.log(tierId, JSON.stringify({ dex: s.dexFound, full: s.dexFullAtS, wpm: s.wordsPerMin, submits: s.submits, blobs: s.blobs, ents: s.maxEntities, fc: s.loopFrames, err: s.errors }));
    results.tiers[tierId] = { runs: [s], summary: { dexFound: s.dexFound + '/42', dexFullAtS: s.dexFullAtS, discoveriesPerMin: s.discoveriesPerMin, recognisedWordsPerMin: s.wordsPerMin, frameCbMsMean: s.loopFrames.cbMsMean, errors: s.errors.length } };
    fs.writeFileSync(resPath, JSON.stringify(results, null, 1));
  }
  if (args.includes('probes') || !tiers.length) { results.probes = await probes(browser); console.log(JSON.stringify(results.probes, null, 1)); fs.writeFileSync(resPath, JSON.stringify(results, null, 1)); }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
