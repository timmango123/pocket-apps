// 手機版面健檢：每個 app 用大廳裡實際的 iframe 大小開啟（Safari 工具列與大廳上方列都扣掉），
// 找出被切到、超出畫面或被別的東西蓋住的按鈕、輸入框和文字。
//   node qa/layout/run.js              全部 app
//   node qa/layout/run.js chess sudoku 只測指定的 app
//   --shots                            問題頁面存截圖到 qa/layout/shots/
// 結果寫到 qa/layout/report.md，有問題時結束碼為 1。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '../..'), APPS = path.join(ROOT, 'apps');
const args = process.argv.slice(2), SHOTS = args.includes('--shots'), only = args.filter(a => !a.startsWith('--'));
const apps = fs.readdirSync(APPS).filter(d => !d.endsWith('-hub') && fs.existsSync(path.join(APPS, d, 'index.html')) && (!only.length || only.includes(d))).sort();
// iframe size inside the hub on common phones in Safari (toolbars and the hub's 53px bar removed)
const SIZES = [{ name: 'SE', width: 375, height: 500 }, { name: '14', width: 390, height: 610 }, { name: 'Max', width: 430, height: 740 }];
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const wrap = html => /^\s*<!doctype/i.test(html) ? html : SKELETON + html + '</body></html>';

function serve() {
  const srv = http.createServer((req, res) => {
    const m = decodeURIComponent(req.url.split('?')[0]).match(/^\/app\/([a-z0-9-]+)\/$/);
    const file = m && path.join(APPS, m[1], 'index.html');
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(wrap(fs.readFileSync(file, 'utf8')));
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}

// Runs in the page. Returns a list of problems.
function inspect() {
  const W = innerWidth, H = innerHeight, out = [];
  const se = document.scrollingElement || document.documentElement;
  const ow = se.scrollWidth - W;
  if (ow > 1) out.push({ kind: 'overflow', msg: `頁面可以左右捲動 ${ow}px` });
  const css = el => getComputedStyle(el);
  const pageScrollsY = se.scrollHeight > H + 1 && !['hidden', 'clip'].includes(css(document.documentElement).overflowY) && !['hidden', 'clip'].includes(css(document.body).overflowY);
  const shown = el => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const s = css(e);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05 || e.hidden || e.inert || e.getAttribute('aria-hidden') === 'true') return false;
      if (e.tagName === 'DIALOG' && !e.open) return false;
      if (e.tagName === 'DETAILS' && !e.open && e !== el && !(el.tagName === 'SUMMARY' && el.parentElement === e)) return false;
    }
    return true;
  };
  const name = el => {
    const t = (el.getAttribute('aria-label') || el.textContent || el.value || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}>${t ? ' ' + t : ''}`;
  };
  // visible part of el after clipping ancestors; returns {r, clipBy}
  function visibleRect(el) {
    const b = el.getBoundingClientRect();
    let r = { l: b.left, t: b.top, r: b.right, b: b.bottom }, clipBy = null;
    for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const s = css(e);
      const ox = s.overflowX, oy = s.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      const scrollable = (['auto', 'scroll'].includes(ox) && e.scrollWidth > e.clientWidth + 1) || (['auto', 'scroll'].includes(oy) && e.scrollHeight > e.clientHeight + 1);
      if (scrollable) return { r, clipBy: null, scroll: true };   // the user can scroll to it
      const q = e.getBoundingClientRect();
      const n = { l: Math.max(r.l, q.left), t: Math.max(r.t, q.top), r: Math.min(r.r, q.right), b: Math.min(r.b, q.bottom) };
      if (ox === 'visible') { n.l = r.l; n.r = r.r; }
      if (oy === 'visible') { n.t = r.t; n.b = r.b; }
      if ((n.r - n.l) * (n.b - n.t) < (r.r - r.l) * (r.b - r.t) - 1) clipBy = clipBy || e;
      r = n;
      if (s.position === 'fixed') break;
    }
    return { r, clipBy };
  }
  const area = r => Math.max(0, r.r - r.l) * Math.max(0, r.b - r.t);
  const CTRL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [role=switch], [role=checkbox], [role=radio], summary, [tabindex]:not([tabindex="-1"])';
  const ctrls = [...document.querySelectorAll(CTRL)].filter(el => el !== document.body && shown(el));
  const textEls = [...document.querySelectorAll('body *')].filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !el.closest(CTRL) && !['SCRIPT', 'STYLE', 'OPTION', 'TITLE'].includes(el.tagName) && shown(el));
  // controls drawn on top of each other (neither inside the other)
  const inScroller = el => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const s = css(e); if ((['auto', 'scroll'].includes(s.overflowX) && e.scrollWidth > e.clientWidth + 1) || (['auto', 'scroll'].includes(s.overflowY) && e.scrollHeight > e.clientHeight + 1)) return true; } return false; };
  const layerOf = el => { let top = null; for (let e = el; e && e !== document.body; e = e.parentElement) { const s = css(e); if (s.position === 'fixed' || s.position === 'absolute') { const q = e.getBoundingClientRect(); if (q.width * q.height > W * H * 0.5) top = e; } } return top; };
  const pinnedOf = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = css(e); if (s.position === 'sticky' || s.position === 'fixed') { const q = e.getBoundingClientRect(); if (q.width * q.height < W * H * 0.5) return e; } } return null; };
  const boxes = ctrls.map(el => [el, el.getBoundingClientRect()]).filter(([, b]) => b.width >= 8 && b.height >= 8);
  const overlapped = new Set();
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, A] = boxes[i], [c, C] = boxes[j];
    if (a.contains(c) || c.contains(a) || overlapped.has(a) || overlapped.has(c) || inScroller(a) || inScroller(c)) continue;
    if (a.tagName === 'CANVAS' || c.tagName === 'CANVAS') continue;             // buttons floating over a game board
    if (layerOf(a) !== layerOf(c)) continue;                                    // a start menu or dialog over the page
    const ix = Math.min(A.right, C.right) - Math.max(A.left, C.left), iy = Math.min(A.bottom, C.bottom) - Math.max(A.top, C.top);
    if (ix <= 0 || iy <= 0) continue;
    const inside = (X, Y) => Y.left >= X.left - 1 && Y.right <= X.right + 1 && Y.top >= X.top - 1 && Y.bottom <= X.bottom + 1;
    if ((/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && inside(A, C)) || (/^(INPUT|TEXTAREA|SELECT)$/.test(c.tagName) && inside(C, A))) continue; // a show/clear button inside a field
    const small = Math.min(A.width * A.height, C.width * C.height);
    if (ix * iy > small * 0.15 && ix > 6 && iy > 6) {
      overlapped.add(a); overlapped.add(c);
      // one of them on a sticky or fixed bar: content scrolling under it is fine, recheck after scrolling
      const pinned = pinnedOf(a) ? c : pinnedOf(c) ? a : null;
      if (pinned && pageScrollsY) { pinned.dataset.layoutCheck = out.length; (pinned === a ? c : a).dataset.layoutOther = out.length; }
      out.push({ kind: pinned && pageScrollsY ? 'overlap-pinned' : 'overlap', msg: `${name(a)} 和 ${name(c)} 疊在一起` });
    }
  }
  const covered = new Set();
  for (const el of [...ctrls, ...textEls]) {
    const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) continue;
    const isCtrl = ctrls.includes(el);
    const fixed = (() => { for (let e = el; e; e = e.parentElement) if (css(e).position === 'fixed') return true; return false; })();
    const { r, clipBy, scroll } = visibleRect(el);
    if (scroll) continue;
    const full = area({ l: b.left, t: b.top, r: b.right, b: b.bottom });
    // viewport clipping: sideways always counts; below the fold only if the page can't scroll there (or it's fixed)
    const vp = { l: Math.max(r.l, 0), r: Math.min(r.r, W), t: Math.max(r.t, (pageScrollsY && !fixed) ? -1e9 : 0), b: Math.min(r.b, (pageScrollsY && !fixed) ? 1e9 : H) };
    const vis = area(vp);
    if (vis <= 0) continue;                       // entirely off screen: an off-canvas drawer or similar, on purpose
    const side = vp.l > r.l + 1 ? '左' : vp.r < r.r - 1 ? '右' : vp.t > r.t + 1 ? '上' : vp.b < r.b - 1 ? '下' : '';
    // past the screen edge counts from 10%; clipped by a box (handles, bubbles that poke out on purpose) from 35%
    if (vis < full * (side ? 0.9 : 0.65) - 4) {
      out.push({ kind: 'clipped', msg: `${name(el)} 被切掉 ${Math.round(100 - vis / full * 100)}%（${side ? '超出畫面' + side + '緣' : '被 ' + name(clipBy) + ' 裁切'}）` });
      continue;
    }
    if (!isCtrl) continue;
    // covered: sample the centre of the visible part
    const cx = (vp.l + vp.r) / 2, cy = (vp.t + vp.b) / 2;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
    const lab = hit.closest('label'); if (lab && (lab.contains(el) || (el.id && lab.htmlFor === el.id))) continue;
    // a full-screen overlay (start menu, dialog) on top of everything is intended
    let ov = null; for (let e = hit; e && e !== document.body; e = e.parentElement) { const s = css(e); if (s.position === 'fixed' || s.position === 'absolute') { const q = e.getBoundingClientRect(); if (q.width * q.height > W * H * 0.5) { ov = e; break; } } }
    if (ov && !ov.contains(el)) continue;
    if (covered.has(hit)) continue;
    covered.add(hit);
    el.dataset.layoutCheck = out.length;
    out.push({ kind: 'covered', msg: `${name(el)} 被 ${name(hit)} 蓋住` });
  }
  return out;
}

// A control under a sticky bar is fine if scrolling brings it out: scroll it to the middle and look again.
async function recheckCovered(probs) {
  const keep = [];
  for (const [i, pr] of probs.entries()) {
    if (pr.kind === 'overlap-pinned') {
      const el = document.querySelector(`[data-layout-check="${i}"]`), other = document.querySelector(`[data-layout-other="${i}"]`);
      if (!el || !other) continue;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const A = el.getBoundingClientRect(), C = other.getBoundingClientRect();
      const ix = Math.min(A.right, C.right) - Math.max(A.left, C.left), iy = Math.min(A.bottom, C.bottom) - Math.max(A.top, C.top);
      if (ix > 6 && iy > 6) keep.push({ kind: 'overlap', msg: pr.msg + '（捲動後仍被擋住）' });
      continue;
    }
    if (pr.kind !== 'covered') { keep.push(pr); continue; }
    const el = document.querySelector(`[data-layout-check="${i}"]`);
    if (!el) continue;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;                  // re-rendered or hidden meanwhile
    const cx = Math.min(Math.max(b.left + b.width / 2, 0), innerWidth - 1), cy = Math.min(Math.max(b.top + b.height / 2, 0), innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    const ok = hit && (hit === el || el.contains(hit) || hit.contains(el) || (hit.closest('label') && (hit.closest('label').contains(el) || hit.closest('label').htmlFor === el.id)));
    if (!ok) keep.push(pr);
    delete el.dataset.layoutCheck;
  }
  return keep;
}

(async () => {
  const srv = await serve(), base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  if (SHOTS) fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  const results = {};
  const jobs = []; for (const a of apps) for (const s of SIZES) jobs.push([a, s]);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const [a, s] = jobs[next++];
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      let probs;
      try {
        await p.goto(`${base}/app/${a}/`, { waitUntil: 'load', timeout: 30000 });
        await p.waitForTimeout(1200);
        probs = await p.evaluate(inspect);
        if (probs.some(x => x.kind === 'covered' || x.kind === 'overlap-pinned')) probs = await p.evaluate(recheckCovered, probs);
      } catch (e) { probs = [{ kind: 'error', msg: '載入失敗：' + e.message.split('\n')[0] }]; }
      if (probs.length && SHOTS) await p.screenshot({ path: path.join(__dirname, 'shots', `${a}-${s.name}.png`) }).catch(() => {});
      await ctx.close();
      (results[a] = results[a] || {})[s.name] = probs;
      process.stdout.write(probs.length ? 'x' : '.');
    }
  }
  await Promise.all([1, 2, 3, 4].map(worker));
  await browser.close(); srv.close();

  // known, intended layouts (qa/layout/allow.json): each entry names a message fragment and why it's fine
  const allow = JSON.parse(fs.readFileSync(path.join(__dirname, 'allow.json'), 'utf8'));
  for (const a of apps) for (const s of SIZES) results[a][s.name] = results[a][s.name].filter(pr => !(allow[a] || []).some(x => pr.msg.includes(x.match)));
  const bad = apps.filter(a => SIZES.some(s => results[a][s.name].length));
  const lines = [`# 手機版面健檢（${new Date().toISOString().slice(0, 10)}）`, '',
    `結果：${bad.length ? `**${bad.length} 款有問題**` : '全部通過'}（共 ${apps.length} 款）`, '',
    `尺寸（大廳裡 iframe 的實際大小）：${SIZES.map(s => `${s.width}×${s.height}`).join('、')}`, ''];
  for (const a of bad) {
    lines.push(`## ${a}`, '');
    const seen = new Map();
    for (const s of SIZES) for (const pr of results[a][s.name]) { const k = pr.msg; seen.set(k, (seen.get(k) || []).concat(s.width)); }
    for (const [m, ws] of seen) lines.push(`- ${m}（${ws.join('、')}）`);
    lines.push('');
  }
  if (!only.length) fs.writeFileSync(path.join(__dirname, 'report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 1));
  console.log(`\n${bad.length ? '有問題：' + bad.join('、') : '全部通過'}`);
  process.exit(bad.length ? 1 : 0);
})();
