// Cron 解讀器：9.5 上架重審的回歸測試（node tests.js，約 20 秒）。
// 1) 下次執行時間：與本檔獨立寫的「逐 15 分鐘區塊走時鐘」暴力搜尋（Intl 時區、含夏令時間規則）逐筆比對，
//    再對一張手算表（日期星期已另外核對）。2) 介面：全形輸入、錯誤欄位、補欄建議、符號鍵、格子點選／滑動、
//    複製／分享、最近使用（pagehide 存檔）、儲存值驗證、夏令時間標示、不可能的排程。
// 固定「現在」與時區（context timezoneId + clock.setFixedTime），頁面用本機 http 伺服器載入。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let fails = 0, passes = 0;
const assert = (c, m) => { if (c) { passes++; if (process.env.V) console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];

// 2026-10-30 (Fri) 12:17:23.456 in Taipei
const FROM1 = Date.UTC(2026, 9, 30, 4, 17, 23, 456);
// 2027-03-12 12:00 UTC, two days before the US spring-forward
const FROM2 = Date.UTC(2027, 2, 12, 12, 0, 0);

// ---------- independent brute-force walker ----------
const DIM = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const WDAY = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const MN = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
function spec(expr, mode) {
  const MAC = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };
  let e = expr.trim().toLowerCase();
  if (MAC[e]) e = (mode === '5' ? '' : '0 ') + MAC[e];
  let t = e.toUpperCase().split(/\s+/);
  if (mode === '5') t = ['0'].concat(t);
  if (mode === 'q' && t.length === 6) t.push('*');
  const [S, Mi, H, DOM, MON, DOW, Y] = t, q = mode === 'q';
  const DN = q ? { SUN: 1, MON: 2, TUE: 3, WED: 4, THU: 5, FRI: 6, SAT: 7 } : { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  const expand = (tok, lo, hi, starHi, names, norm = v => v) => {
    const set = new Set();
    for (const part of tok.split(',')) {
      if (part === '?') { for (let v = lo; v <= starHi; v++) set.add(norm(v)); continue; }
      const m = /^(\*|\w+)(?:-(\w+))?(?:\/(\d+))?$/.exec(part);
      if (!m) continue;
      const val = x => names && names[x] != null ? names[x] : +x;
      const a = m[1] === '*' ? lo : val(m[1]);
      const b = m[2] ? val(m[2]) : (m[1] === '*' || m[3]) ? starHi : a;
      for (let v = a; v <= b; v += m[3] ? +m[3] : 1) set.add(norm(v));
    }
    return set;
  };
  const sec = expand(S, 0, 59, 59), min = expand(Mi, 0, 59, 59), hour = expand(H, 0, 23, 23), mon = expand(MON, 1, 12, 12, MN);
  const year = Y ? expand(Y, 1970, 2099, 2099) : null;
  const domParts = DOM.split(','), dowParts = DOW.split(',');
  const domPlain = expand(domParts.filter(p => !/[LW]/.test(p)).join(',') || 'X', 1, 31, 31);
  const dowNorm = v => q ? v - 1 : v % 7;
  const dowPlain = expand(dowParts.filter(p => !/[L#]/.test(p)).join(',') || 'X', q ? 1 : 0, q ? 7 : 7, q ? 7 : 6, DN, dowNorm);
  const nearestWeekday = (y, m, n) => { const last = DIM(y, m); if (n > last) n = last; const w = WDAY(y, m, n); if (w >= 1 && w <= 5) return n; if (w === 6) return n === 1 ? 3 : n - 1; return n === last ? n - 2 : n + 1; };
  const domOK = (y, m, d) => {
    if (domPlain.has(d)) return true;
    const last = DIM(y, m);
    for (const p of domParts) {
      if (p === 'L' && d === last) return true;
      let r;
      if ((r = /^L-(\d+)$/.exec(p)) && d === last - +r[1]) return true;
      if (p === 'LW') { let x = last; while (WDAY(y, m, x) === 0 || WDAY(y, m, x) === 6) x--; if (d === x) return true; }
      if ((r = /^(\d+)W$/.exec(p)) && d === nearestWeekday(y, m, +r[1])) return true;
    }
    return false;
  };
  const dowOK = (y, m, d) => {
    const w = WDAY(y, m, d);
    if (dowPlain.has(w)) return true;
    for (const p of dowParts) {
      let r;
      if (p === 'L' && q && w === 6) return true;
      if ((r = /^(\w+)L$/.exec(p)) && w === dowNorm(DN[r[1]] != null ? DN[r[1]] : +r[1]) && d + 7 > DIM(y, m)) return true;
      if ((r = /^(\w+)#(\d)$/.exec(p)) && w === dowNorm(DN[r[1]] != null ? DN[r[1]] : +r[1]) && d > (+r[2] - 1) * 7 && d <= +r[2] * 7) return true;
    }
    return false;
  };
  const domStar = DOM[0] === '*' || DOM === '?', dowStar = DOW[0] === '*' || DOW === '?';
  const dayOK = (y, m, d) => q ? (DOM === '?' ? dowOK(y, m, d) : domOK(y, m, d)) : (domStar || dowStar) ? domOK(y, m, d) && dowOK(y, m, d) : domOK(y, m, d) || dowOK(y, m, d);
  const fixed = Mi[0] !== '*' && H[0] !== '*' && (mode === '5' || S[0] !== '*');
  return { sec: [...sec].sort((a, b) => a - b), min, hour, mon, year, dayOK, fixed };
}
// Walks real instants in 15-minute chunks (every UTC offset is a multiple of 15 min, so a chunk has one wall day/hour).
// Non-existent wall times never show up; repeated ones show up twice (wildcard jobs keep both, fixed-time jobs the first).
// Fixed-time jobs whose time was skipped by a spring-forward run once at the jump.
function walk(expr, mode, tz, from, n) {
  const sp = spec(expr, mode), CH = 900000, out = [], seen = new Set();
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const wallOf = ms => { const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = +p.value; return Date.UTC(o.year, o.month - 1, o.day, o.hour % 24, o.minute, o.second); };
  const okWall = w => { const D = new Date(w); const y = D.getUTCFullYear(), m = D.getUTCMonth() + 1, d = D.getUTCDate(); return (!sp.year || sp.year.has(y)) && sp.mon.has(m) && sp.hour.has(D.getUTCHours()) && sp.min.has(D.getUTCMinutes()) && sp.dayOK(y, m, d); };
  let prev = null;
  for (let c = Math.floor(from / CH) * CH; out.length < n && c < from + 9 * 366 * 86400000; c += CH) {
    const off = wallOf(c) - c;
    if (prev != null && off > prev && sp.fixed) {
      let hit = false;
      for (let w = c + prev; w < c + off && !hit; w += 60000) hit = okWall(w);
      if (hit && c > from) out.push({ t: c, gap: true });
    }
    prev = off;
    const D = new Date(c + off), y = D.getUTCFullYear(), m = D.getUTCMonth() + 1, d = D.getUTCDate();
    if ((sp.year && !sp.year.has(y)) || !sp.mon.has(m) || !sp.hour.has(D.getUTCHours()) || !sp.dayOK(y, m, d)) continue;
    for (let k = 0; k < 15 && out.length < n; k++) {
      if (!sp.min.has(new Date(c + off + k * 60000).getUTCMinutes())) continue;
      for (const s of sp.sec) {
        const t = c + k * 60000 + s * 1000, key = c + off + k * 60000 + s * 1000;
        if (t <= from) continue;
        if (sp.fixed && seen.has(key)) continue;
        seen.add(key); out.push({ t }); if (out.length >= n) break;
      }
    }
  }
  return out.slice(0, n);
}

const WALK = [
  ['*/15 9-17 * * 1-5', '5', 'Asia/Taipei', FROM1, 60], ['0 0 1 * 1', '5', 'Asia/Taipei', FROM1, 12], ['0 0 */2 * 1', '5', 'Asia/Taipei', FROM1, 8],
  ['0 0 1 * */2', '5', 'UTC', FROM1, 6], ['5,35 */3 * JAN-MAR,OCT mon-fri', '5', 'UTC', FROM1, 40], ['0 0 * * 7', '5', 'Europe/London', FROM1, 6],
  ['30 1 * * *', '5', 'America/New_York', FROM1, 10], ['*/20 1 * * *', '5', 'America/New_York', FROM1, 15], ['1-10/3 * * * *', '5', 'UTC', FROM1, 30],
  ['0 9-17/2 * * *', '5', 'Asia/Tokyo', FROM1, 20], ['15 10 * * 5-7', '5', 'Australia/Sydney', FROM1, 12], ['0 0 31 * *', '5', 'Asia/Taipei', FROM1, 6],
  ['0 12 */2 * *', '5', 'Asia/Taipei', FROM1, 20], ['@weekly', '5', 'Europe/London', FROM1, 4], ['0 0 29 2 *', '5', 'UTC', FROM1, 2],
  ['30 2 * * *', '5', 'America/New_York', FROM2, 8], ['*/30 2 * * *', '5', 'America/New_York', FROM2, 8], ['30 2 * * *', '5', 'Europe/Berlin', FROM2, 20],
  ['0,30 2 * * *', '5', 'Europe/Berlin', FROM2, 40], ['45 1 * * *', '5', 'Australia/Lord_Howe', FROM2, 30], ['*/10 1 * * *', '5', 'Australia/Lord_Howe', FROM2, 160],
  ['15 2 * * 0', '5', 'America/Santiago', FROM2, 30], ['0 0 1-7 * 5', '5', 'UTC', FROM1, 10],
  ['*/20 * * * * *', '6', 'Asia/Taipei', FROM1, 10], ['15 30 8 * * 1-5', '6', 'Asia/Taipei', FROM1, 5], ['0 */15 9-17 * * 1-5', '6', 'Asia/Kolkata', FROM1, 20],
  ['30 30 1 * * *', '6', 'America/New_York', FROM1, 4], ['*/30 * 1 * * *', '6', 'America/New_York', FROM1, 300],
  ['0 0 12 L * ?', 'q', 'Asia/Taipei', FROM1, 6], ['0 0 9 ? * 2#1', 'q', 'Asia/Taipei', FROM1, 6], ['0 0 18 ? * 6L', 'q', 'Asia/Taipei', FROM1, 6],
  ['0 0 10 15W * ?', 'q', 'UTC', FROM1, 8], ['0 0 10 1W * ?', 'q', 'UTC', FROM1, 8], ['0 30 17 LW * ?', 'q', 'UTC', FROM1, 6],
  ['0 0 8 L-2 * ?', 'q', 'UTC', FROM1, 5], ['0 0 9 ? * MON-FRI', 'q', 'Asia/Taipei', FROM1, 8], ['0 0 0 * * ? 2027-2028', 'q', 'UTC', FROM1, 3],
  ['0 0 9 ? * L', 'q', 'Asia/Taipei', FROM1, 4], ['0 15 10 ? * 6#3', 'q', 'Asia/Taipei', FROM1, 4], ['0 0 12 ? * SUN-SAT/2', 'q', 'UTC', FROM1, 8],
];

// hand-verified (weekdays checked separately): [expr, mode, tz, from, ISO UTC times, notes]
const HAND = [
  ['0 9,18 * * 1-5', '5', 'Asia/Taipei', FROM1, ['2026-10-30T10:00', '2026-11-02T01:00', '2026-11-02T10:00']],
  ['0 0 29 2 *', '5', 'UTC', FROM1, ['2028-02-29T00:00', '2032-02-29T00:00']],
  ['0 0 31 * *', '5', 'Asia/Taipei', FROM1, ['2026-10-30T16:00', '2026-12-30T16:00', '2027-01-30T16:00']],
  ['0 0 */2 * 1', '5', 'Asia/Taipei', FROM1, ['2026-11-08T16:00', '2026-11-22T16:00', '2026-12-06T16:00']],
  ['0 0 1 * 1', '5', 'Asia/Taipei', FROM1, ['2026-10-31T16:00', '2026-11-01T16:00', '2026-11-08T16:00']],
  ['0 0 1 * */2', '5', 'UTC', FROM1, ['2026-11-01T00:00', '2026-12-01T00:00', '2027-04-01T00:00']],
  ['0 9 * * 7', '5', 'UTC', FROM1, ['2026-11-01T09:00', '2026-11-08T09:00']],
  ['0 9 * * sun', '5', 'UTC', FROM1, ['2026-11-01T09:00', '2026-11-08T09:00']],
  ['0 9 * * 0', '5', 'UTC', FROM1, ['2026-11-01T09:00', '2026-11-08T09:00']],
  ['30 1 * * *', '5', 'America/New_York', FROM1, ['2026-10-30T05:30', '2026-10-31T05:30', '2026-11-01T05:30 dup', '2026-11-02T06:30']],
  ['*/30 1 * * *', '5', 'America/New_York', FROM1, ['2026-10-30T05:00', '2026-10-30T05:30', '2026-10-31T05:00', '2026-10-31T05:30', '2026-11-01T05:00 dup', '2026-11-01T05:30 dup', '2026-11-01T06:00 dup', '2026-11-01T06:30 dup', '2026-11-02T06:00']],
  ['30 2 * * *', '5', 'America/New_York', FROM2, ['2027-03-13T07:30', '2027-03-14T07:00 gap', '2027-03-15T06:30']],
  ['*/30 2 * * *', '5', 'America/New_York', FROM2, ['2027-03-13T07:00', '2027-03-13T07:30', '2027-03-15T06:00', '2027-03-15T06:30']],
  ['*/20 * * * * *', '6', 'Asia/Taipei', FROM1, ['2026-10-30T04:17:40', '2026-10-30T04:18', '2026-10-30T04:18:20']],
  ['0 0 9 ? * 2#1', 'q', 'Asia/Taipei', FROM1, ['2026-11-02T01:00', '2026-12-07T01:00']],
  ['0 0 12 L * ?', 'q', 'Asia/Taipei', FROM1, ['2026-10-31T04:00', '2026-11-30T04:00']],
  ['0 0 10 15W * ?', 'q', 'UTC', FROM1, ['2026-11-16T10:00', '2026-12-15T10:00']],
  ['0 0 10 1W * ?', 'q', 'UTC', FROM1, ['2026-11-02T10:00', '2026-12-01T10:00', '2027-01-01T10:00', '2027-02-01T10:00', '2027-03-01T10:00', '2027-04-01T10:00', '2027-05-03T10:00']],
  ['0 30 17 LW * ?', 'q', 'UTC', FROM1, ['2026-10-30T17:30', '2026-11-30T17:30', '2026-12-31T17:30']],
  ['0 0 18 ? * 6L', 'q', 'Asia/Taipei', FROM1, ['2026-10-30T10:00', '2026-11-27T10:00', '2026-12-25T10:00']],
  ['０ ９ ＊ ＊ １－５', '5', 'UTC', FROM1, ['2026-10-30T09:00', '2026-11-02T09:00']],
  ['0　9  *\t* MON–fri', '5', 'UTC', FROM1, ['2026-10-30T09:00', '2026-11-02T09:00']],
  ['0 0 30 2 *', '5', 'UTC', FROM1, []],
  ['0 0 0 * * ? 2020', 'q', 'UTC', FROM1, []],
];
const iso = (t, gap, dup) => new Date(t).toISOString().replace(/:00\.000Z$|\.000Z$/, '').replace(/(T\d\d:\d\d):00$/, '$1') + (gap ? ' gap' : dup ? ' dup' : '');

function serve() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
    srv.listen(0, '127.0.0.1', () => { srv.unref(); res('http://127.0.0.1:' + srv.address().port + '/'); });
  });
}

(async () => {
  const URL = await serve();
  const browser = await chromium.launch();
  async function open({ w = 390, h = 844, tz = 'Asia/Taipei', now = FROM1, init } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: tz, locale: 'zh-TW' });
    await ctx.clock.setFixedTime(new Date(now));
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__cronReady);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const val = () => p.inputValue('#expr');
    const setExpr = async v => { await p.fill('#expr', v); };
    return { ctx, p, touch, center, val, setExpr };
  }

  // ---------- 1. next runs vs brute force and the hand table ----------
  {
    const t = await open({ tz: 'UTC' });
    let walkOk = 0;
    for (const [e, m, tz, from, n] of WALK) {
      const app = await t.p.evaluate(([e, m, tz, from, n]) => __cron.nextRuns(__cron.parse(e, m), tz, from, n).map(r => r.t + (r.gap ? 'g' : '')), [e, m, tz, from, n]);
      const ref = walk(e, m, tz, from, n).map(r => r.t + (r.gap ? 'g' : ''));
      const ok = JSON.stringify(app) === JSON.stringify(ref) && app.length === n;
      if (ok) walkOk++;
      else { const i = app.findIndex((x, k) => x !== ref[k]); assert(false, `暴力搜尋比對 ${m} "${e}" ${tz}: 第 ${i} 筆 app=${app[i] && iso(parseInt(app[i]))} ref=${ref[i] && iso(parseInt(ref[i]))}（${app.length}/${ref.length} 筆）`); }
    }
    eq(walkOk, WALK.length, `${WALK.length} 個表達式的下次執行時間與獨立暴力搜尋逐筆相同（含夏令時間、L/W/#、年份）`);
    for (const [e, m, tz, from, want] of HAND) {
      const got = await t.p.evaluate(([e, m, tz, from, n]) => __cron.nextRuns(__cron.parse(e, m), tz, from, n).map(r => [r.t, !!r.gap, !!r.dup]), [e, m, tz, from, Math.max(want.length, 1)]);
      eq(got.map(([x, g, d]) => iso(x, g, d)), want, `手算表 ${m} "${e}" ${tz}`);
    }
    // impossible / sparse schedules finish quickly instead of hanging
    const slow = await t.p.evaluate(() => {
      const cases = [['0 0 30 2 *', '5'], ['0 0 31 4,6,9,11 *', '5'], ['* * * 30 2 *', '6'], ['* * * 31 2 ? *', 'q'], ['0 0 0 ? * 2#5 2099', 'q'], ['* * * * * *', '6'], ['0 0 0 L-30 2 ?', 'q']];
      return cases.map(([e, m]) => { const t0 = performance.now(); const r = __cron.nextRuns(__cron.parse(e, m), 'America/New_York', Date.now(), 50); return [e, r.length, Math.round(performance.now() - t0)]; });
    });
    for (const [e, n, ms] of slow) assert(ms < 400, `「${e}」算 50 筆只花 ${ms} ms（找到 ${n} 筆）`);
    // descriptions
    const D = await t.p.evaluate(list => list.map(([e, m]) => { const d = __cron.describe(__cron.parse(e, m)); return [d.text, d.sub, d.never]; }), [
      ['0 0 */2 * 1', '5'], ['0 0 1 * 1', '5'], ['*/15 9-17 * * 1-5', '5'], ['15 10 * * 5-7', '5'], ['0 9-17/2 * * *', '5'], ['0 0 30 2 *', '5'], ['0 0 1-7 * 5', '5'], ['0 0 * * 5L', '5'], ['0 0 8 L-2 * ?', 'q'], ['*/7 * * * *', '5'], ['0 0 0 * * ? 2020', 'q'], ['0 0 1 * 0-7', '5']]);
    assert(D[0][0].includes('且當天是週一') && D[0][1].includes('同時符合'), '「0 0 */2 * 1」說明為「且」（日欄以 * 開頭），不是「或」：' + D[0][0]);
    assert(D[1][0].includes('或') && D[1][1].includes('「或」'), '「0 0 1 * 1」說明為「或」');
    eq(D[2][0], '週一至週五，09:00 至 17:45，每 15 分鐘', '「*/15 9-17」寫出真正的最後一次 17:45');
    eq(D[3][0], '週五至週日的 10:15', '5-7 讀作週五至週日（週一起算）');
    eq(D[4][0], '每天 09:00、11:00、13:00、15:00 與 17:00', '9-17/2 列出各時刻');
    assert(D[5][2] && D[5][2].includes('2 月最多只有 29 天'), '2 月 30 日：說明直接警告永遠不會執行');
    assert(D[6][1].includes('6#1'), '「1-7 且週五」提示 OR 規則與 Quartz 6#1');
    assert(D[7][1].includes('擴充語法'), '標準格式用 L 時註明是擴充語法');
    assert(D[8][0].includes('倒數第 3 天'), 'L-2 讀作倒數第 3 天');
    assert(D[9][0].includes('不是固定每 7 分鐘'), '*/7 說明整點會重新計算');
    assert(D[10][2] && D[10][2].includes('已經過去'), '年份已過：說明不會再執行');
    eq(D[11][0], '每天 00:00', '日 1 或週 0-7（每天）= 每天');
    // parse errors point at the field
    const E = await t.p.evaluate(list => list.map(([e, m]) => { try { __cron.parse(e, m); return null; } catch (x) { return [x.message, x.idx, x.fix && x.fix.mode]; } }), [
      ['0 9 * FOO *', '5'], ['0 9 * * 1 2', '5'], ['0 0 9 * *', '6'], ['0 0 9 ? * 0', 'q'], ['0 22-2 * * *', '5'], ['0 9 * * SAT-SUN', '5'], ['0 24 * * *', '5'], ['0 9 * mon *', '5'], ['*/0 * * * *', '5'], ['0 9 *', '5']]);
    eq([E[0][1], E[0][0].includes('第 4 欄（月）')], [3, true], '名稱錯誤標在第 4 欄');
    eq([E[1][1], E[1][2]], [5, '6'], '5 欄格式輸入 6 欄：標出多餘欄並建議改用 6 欄');
    eq([E[2][2], E[2][0].includes('第 1 欄是秒')], ['5', true], '6 欄格式輸入 5 欄：建議標準 5 欄');
    assert(E[3][1] === 5 && E[3][0].includes('週日是 1'), 'Quartz 週 0：說明週日是 1');
    assert(E[4][0].includes('22-23,0-2'), '跨午夜範圍：教怎麼拆');
    assert(E[5][0].includes('5-7'), 'SAT-SUN：提示週日可寫 7');
    eq(E[6][1], 1, '24 點標在第 2 欄');
    assert(E[7][0].includes('JAN–DEC'), '月欄寫 MON：提示月份名稱');
    eq(E[8][1], 0, '間隔 0 標在第 1 欄');
    assert(E[9][0].includes('缺少「月」「週」欄') && E[9][1] === 3, '少欄：說出缺哪幾欄');
    await t.ctx.close();
  }

  // ---------- 2. typing, field strip, keys, error fix ----------
  {
    const t = await open();
    eq(await t.p.textContent('#runs li:first-child .tm'), '2026-10-30週五18:00', '預設表達式：下一次是今天 18:00');
    eq(await t.p.textContent('#runs li:first-child .rel'), '5 小時 42 分後', '相對時間兩個單位、無條件捨去');
    for (const a of ['autocapitalize', 'autocorrect', 'spellcheck', 'autocomplete']) assert(['off', 'false'].includes(await t.p.getAttribute('#expr', a)), `輸入框 ${a} 關閉`);
    await t.setExpr('０ ９ ＊ ＊ １－５');
    eq(await t.p.textContent('#say'), '週一至週五的 09:00', '全形輸入照樣解讀');
    await t.p.locator('#expr').blur();
    eq(await t.val(), '0 9 * * 1-5', '離開輸入框後換成半形、單一空格');
    await t.setExpr('0 9 * FOO *');
    eq(await t.p.$$eval('#fields .f', fs => fs.map(f => f.classList.contains('bad'))), [false, false, false, true, false], '錯誤欄位（月）標紅');
    assert((await t.p.getAttribute('#expr', 'aria-invalid')) === 'true', 'aria-invalid');
    await t.setExpr('0 0 9 1 * mon');
    eq(await t.p.$$eval('#fields .f', fs => fs.length), 6, '多餘的第 6 欄也顯示出來');
    await t.p.tap('#errFix');
    await t.p.waitForFunction(() => document.getElementById('mode-6').getAttribute('aria-pressed') === 'true');
    eq([await t.val(), (await t.p.textContent('#say')).startsWith('每月 1 號或每週一')], ['0 0 9 1 * mon', true], '「改用含秒 6 欄」保留原式並解讀');
    await t.p.tap('#mode-5'); await t.p.waitForFunction(() => document.getElementById('mode-5').getAttribute('aria-pressed') === 'true');
    // symbol keys insert at the caret and keep the keyboard up
    await t.setExpr('0 9 * * 1');
    await t.p.focus('#expr'); await t.p.$eval('#expr', e => e.setSelectionRange(9, 9));
    const k = await t.center('#key-3');
    await t.touch('touchStart', [k]); await t.touch('touchEnd', []);
    await t.p.waitForFunction(() => document.getElementById('expr').value === '0 9 * * 1,');
    eq(await t.p.evaluate(() => document.activeElement.id), 'expr', '點符號鍵後輸入框仍有焦點（鍵盤不收起）');
    await t.p.keyboard.type('3');
    eq(await t.val(), '0 9 * * 1,3', '符號插在游標處，接著打字');
    await t.p.$eval('#expr', e => e.setSelectionRange(3, 3));
    await t.p.tap('#key-0'); await t.p.waitForFunction(() => document.getElementById('expr').value === '0 9* * * 1,3');
    assert(true, '符號鍵插入游標中間');
    const kh = await t.p.$$eval('#keys button', bs => bs.map(b => Math.round(b.getBoundingClientRect().height * 10) / 10));
    assert(kh.length === 5 && kh.every(h => h >= 44), '標準格式 5 個符號鍵，高 ≥ 44px');
    await t.p.keyboard.press('Enter');
    eq(await t.p.evaluate(() => document.activeElement.id), '', 'Enter（完成）收起鍵盤');
    await t.ctx.close();
  }

  // ---------- 3. visual editor cells: tap once, swipe scrolls, drag paints, keyboard ----------
  {
    const t = await open();
    await t.setExpr('0 9 * * *');
    await t.p.$eval('#ve', e => e.scrollIntoView({ block: 'center' }));
    const seq = [];
    for (let i = 0; i < 6; i++) {
      const before = await t.val();
      const c = await t.center('#ve-cell-10');
      await t.touch('touchStart', [c]); await t.touch('touchEnd', []);
      await t.p.waitForFunction(b => document.getElementById('expr').value !== b, before);
      seq.push(await t.val());
    }
    eq(seq, ['0 9,10 * * *', '0 9 * * *', '0 9,10 * * *', '0 9 * * *', '0 9,10 * * *', '0 9 * * *'], 'CDP 觸控連點格子：每次剛好切換一次');
    await t.p.waitForTimeout(900);
    eq(await t.val(), '0 9 * * *', '之後沒有遲到的 click 再切一次');
    // vertical swipe starting on a cell scrolls the page and changes nothing
    await t.p.$eval('#ve-cell-12', e => scrollTo(0, scrollY + e.getBoundingClientRect().top - innerHeight + 120)); await t.p.waitForTimeout(100);
    const y0 = await t.p.evaluate(() => scrollY), q = await t.center('#ve-cell-12');
    await t.touch('touchStart', [q]); for (let k = 1; k <= 12; k++) await t.touch('touchMove', [[q[0] + 1, q[1] - k * 15]]);
    await t.touch('touchEnd', []);
    await t.p.waitForFunction(y => scrollY > y + 40, y0);
    await t.p.waitForTimeout(300);
    eq(await t.val(), '0 9 * * *', '從格子往上滑：捲動頁面，不切換格子');
    // sideways drag paints a run
    await t.p.$eval('#ve-cell-12', e => e.scrollIntoView({ block: 'center' })); await t.p.waitForTimeout(100);
    const a = await t.center('#ve-cell-12'), z = await t.center('#ve-cell-14');
    await t.touch('touchStart', [a]); for (let k = 1; k <= 8; k++) await t.touch('touchMove', [[a[0] + (z[0] - a[0]) * k / 8, a[1]]]);
    await t.touch('touchEnd', []);
    await t.p.waitForFunction(() => document.getElementById('expr').value === '0 9,12-14 * * *');
    assert(true, '水平拖曳 12→14 一次選三格');
    await t.p.waitForTimeout(850);
    await t.p.focus('#ve-cell-3'); await t.p.keyboard.press('Enter');
    await t.p.waitForFunction(() => document.getElementById('expr').value === '0 3,9,12-14 * * *');
    eq(await t.p.evaluate(() => document.activeElement.id), 've-cell-3', '鍵盤 Enter 切換一次，焦點留在同一格');
    await t.p.click('#ve-cell-13');
    eq(await t.val(), '0 3,9,12,14 * * *', '滑鼠點擊切換一次');
    await t.ctx.close();
  }

  // ---------- 4. copy, share, recent list (pagehide), validated storage, count ----------
  {
    const t = await open({ init: () => { navigator.share = d => { window.__shared = d; return Promise.resolve(); }; } });
    await t.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL.replace(/\/$/, '') });
    await t.setExpr('*/5  9 * * 1-5');
    await t.p.tap('#copy');
    await t.p.waitForSelector('.toast:has-text("已複製")');
    eq(await t.p.evaluate(() => navigator.clipboard.readText()), '*/5 9 * * 1-5', '複製：整理過的表達式');
    await t.p.tap('#share');
    await t.p.waitForFunction(() => window.__shared);
    const sh = await t.p.evaluate(() => window.__shared.text);
    assert(sh.includes('*/5 9 * * 1-5') && sh.includes('週一至週五') && sh.includes('2026-11-02 週一 09:00'), '分享：表達式、中文說明與接下來的時間');
    eq(await t.p.$$eval('#hist .chip.mono', b => b.map(x => x.textContent)), ['*/5 9 * * 1-5'], '複製後記入「最近」');
    // typed but not yet remembered → reload (pagehide) keeps it
    await t.setExpr('0 12 * * 6');
    await t.p.reload(); await t.p.waitForFunction(() => window.__cronReady);
    eq(await t.p.$$eval('#hist .chip.mono', b => b.map(x => x.textContent)), ['0 12 * * 6', '*/5 9 * * 1-5'], '剛打的表達式在重新整理（pagehide）時記入「最近」');
    eq(await t.val(), '0 12 * * 6', '重新整理後還原上次的表達式');
    await t.p.tap('#ex-1'); await t.p.waitForFunction(() => document.getElementById('expr').value === '0 0 * * *');
    await t.p.tap('#hist-1'); await t.p.waitForFunction(() => document.getElementById('expr').value === '*/5 9 * * 1-5');
    assert(true, '點「最近」叫回表達式');
    // mode switch that can't convert: original kept in 最近, toast explains
    await t.setExpr('0 0 15 * 5');
    await t.p.tap('#mode-q');
    await t.p.waitForSelector('.toast:has-text("無法直接轉成")');
    eq(await t.p.$eval('#hist-0', b => b.firstChild.textContent), '0 0 15 * 5', '無法轉換時原式留在「最近」');
    eq(await t.p.$eval('#hist-0 small', b => b.textContent), '5 欄', '其他格式的項目標出格式');
    await t.p.tap('#hist-0');
    await t.p.waitForFunction(() => document.getElementById('mode-5').getAttribute('aria-pressed') === 'true' && document.getElementById('expr').value === '0 0 15 * 5');
    assert(true, '點其他格式的「最近」項目會切回該格式');
    await t.p.selectOption('#count', '20');
    await t.p.reload(); await t.p.waitForFunction(() => window.__cronReady);
    eq([await t.p.inputValue('#count'), await t.p.$$eval('#runs li', l => l.length)], ['20', 20], '筆數設定保留');
    await t.p.tap('#histClear'); await t.p.waitForFunction(() => document.getElementById('hist').hidden);
    await t.p.reload(); await t.p.waitForFunction(() => window.__cronReady);
    assert(await t.p.$eval('#hist', e => e.hidden), '清除後重新整理仍是空的');
    // corrupt storage (an example on screen, so pagehide has nothing to add)
    await t.p.tap('#ex-1'); await t.p.waitForFunction(() => document.getElementById('expr').value === '0 0 * * *');
    await t.p.evaluate(() => {
      const K = 'cron-reader:v1:';
      localStorage.setItem(K + 'mode', '"constructor"'); localStorage.setItem(K + 'tz', '5'); localStorage.setItem(K + 'count', '7');
      localStorage.setItem(K + 'last:5', '{"a":1}'); localStorage.setItem(K + 'hist', JSON.stringify([{ m: '5', e: 123 }, { m: 'z', e: '1 * * * *' }, null, { m: '5', e: '0  1 * * *' }, { m: '6', e: '0 0 1 * * *' }]));
    });
    await t.p.reload(); await t.p.waitForFunction(() => window.__cronReady);
    eq([await t.p.getAttribute('#mode-5', 'aria-pressed'), await t.val(), await t.p.inputValue('#tz'), await t.p.inputValue('#count')], ['true', '0 9,18 * * 1-5', 'Asia/Taipei', '10'], '損壞的儲存值改用預設');
    eq(await t.p.$$eval('#hist .chip.mono', b => b.map(x => x.firstChild.textContent)), ['0 0 1 * * *'], '「最近」只留有效項目');
    await t.p.evaluate(() => localStorage.setItem('cron-reader:v1:hist', '"oops"'));
    await t.p.reload(); await t.p.waitForFunction(() => window.__cronReady);
    assert(await t.p.$eval('#hist', e => e.hidden), '「最近」不是陣列時當作空的');
    await t.ctx.close();
  }

  // ---------- 5. DST rows, never-runs messages ----------
  {
    const t = await open({ tz: 'America/New_York' });
    await t.p.selectOption('#tz', 'America/New_York');
    await t.setExpr('30 1 * * *');
    eq(await t.p.$$eval('#runs li', l => l.map(x => x.querySelector('.dup') ? x.querySelector('.dup').textContent.includes('只執行第一次') : false).slice(0, 4)), [false, false, true, false], '時鐘撥回那天：固定時間只列一次並說明');
    await t.setExpr('*/30 1 * * *');
    eq(await t.p.$$eval('#runs li .dup', l => l.map(x => x.textContent.match(/第 \d 次/)[0])), ['第 1 次', '第 1 次', '第 2 次', '第 2 次'], '萬用字元工作：重複的時刻兩次都列出');
    await t.setExpr('0 0 30 2 *');
    assert((await t.p.textContent('#runs')).includes('2 月最多只有 29 天') && (await t.p.textContent('#say .warn')).includes('永遠不會執行'), '2 月 30 日：直接說明永遠不會執行');
    await t.ctx.close();
    const u = await open({ tz: 'America/New_York', now: FROM2 });
    await u.p.selectOption('#tz', 'America/New_York');
    await u.setExpr('30 2 * * *');
    const gap = await u.p.$eval('#runs li.gap', li => li.textContent);
    assert(gap.includes('2027-03-14') && gap.includes('當地沒有 02:30') && gap.includes('03:00 補跑'), '夏令時間開始：跳過的 02:30 標示並說明 03:00 補跑');
    eq(await u.p.textContent('#runs li:first-child .rel'), '19 小時 30 分後', '相對時間（固定的現在）');
    await u.ctx.close();
  }

  // ---------- 6. small / landscape screens ----------
  for (const [w, h] of [[375, 500], [844, 390], [320, 568]]) {
    const t = await open({ w, h });
    await t.p.tap('#mode-q'); await t.p.waitForFunction(() => document.getElementById('mode-q').getAttribute('aria-pressed') === 'true');
    const r = await t.p.evaluate(() => ({
      ow: document.scrollingElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('button, select, summary')].filter(b => b.offsetParent && !b.closest('.chips')).map(b => b.getBoundingClientRect()).filter(b => b.height < 44 || b.width < 43.5).length,
    }));
    eq([r.ow <= 0, r.small], [true, 0], `${w}×${h}：沒有水平捲動、按鈕都 ≥ 44px`);
    await t.ctx.close();
  }

  await browser.close();
  assert(!errors.length, '沒有頁面錯誤' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  console.log(`${fails ? 'FAIL' : 'ok'}: ${passes} 項通過，${fails} 項失敗`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
