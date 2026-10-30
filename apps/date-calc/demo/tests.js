// 日期計算機（date-calc）：9.5 上架重審的回歸測試（node tests.js，約 20–40 秒）。
// 先在 Node 用與 app 無關的算法（JS Date 的 UTC 運算、ISO 週公式、Node 內建 ICU 農曆）核對日期表，
// 再用 Chromium 在 Asia/Taipei 與 America/New_York（固定時鐘、跨夏令時）各跑一次頁面流程。
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const core = html.slice(html.indexOf('function toDayNumber'), html.indexOf('/* ---------- 今天'));
const C = new Function(core + '\nreturn { toDayNumber, fromDayNumber, addMonths, ymd, workdays, isoWeek, dayOfYear, weekday, parseDateText, iso, solarToLunar, termOnDay };')();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('FAIL  ', name, '-', e.message); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m ? m + ': ' : '') + 'expected ' + B + ' got ' + A); }

// ---- independent reference: JS Date in UTC (setUTCFullYear so years 1–99 are not mapped to 19xx) ----
const ref = {
  day(y, m, d) { const x = new Date(0); x.setUTCFullYear(y, m - 1, d); return Math.round(x.getTime() / 864e5); },
  ymd(n) { const x = new Date(n * 864e5); return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]; },
  iso(n) { const [y, m, d] = ref.ymd(n); return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); },
  dim(y, m) { const x = new Date(0); x.setUTCFullYear(y, m, 0); return x.getUTCDate(); },
  addMonths(n, k) { const [y, m, d] = ref.ymd(n), x = new Date(0); x.setUTCFullYear(y, m - 1 + k, 1); const Y = x.getUTCFullYear(), M = x.getUTCMonth() + 1; return ref.day(Y, M, Math.min(d, ref.dim(Y, M))); },
  wd(n) { return new Date(n * 864e5).getUTCDay(); },
  doy(n) { return n - ref.day(ref.ymd(n)[0], 1, 1) + 1; },
  // ISO week by the ordinal-date formula (not the app's "Thursday of this week" method)
  isoWeek(n) {
    const y = ref.ymd(n)[0], wd = ref.wd(n) || 7, w = Math.floor((ref.doy(n) - wd + 10) / 7);
    const p = Y => (Y + Math.floor(Y / 4) - Math.floor(Y / 100) + Math.floor(Y / 400)) % 7, weeks = Y => p(Y) === 4 || p(Y - 1) === 3 ? 53 : 52;
    if (w < 1) return { y: y - 1, w: weeks(y - 1) };
    if (w > weeks(y)) return { y: y + 1, w: 1 };
    return { y, w };
  }
};
// small seeded PRNG so the sweep is the same every run
let seed = 20261030; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const dn = s => { const [y, m, d] = s.split('-').map(Number); return ref.day(y, m, d); };

// [start, end, days (end − start)] — hand-checked, then also checked against the reference
const DIFF_CASES = [
  ['2026-03-07', '2026-03-09', 2],     // US DST starts 03-08
  ['2026-10-31', '2026-11-02', 2],     // US DST ends 11-01
  ['2024-02-28', '2024-03-01', 2],
  ['2023-02-28', '2023-03-01', 1],
  ['1900-02-28', '1900-03-01', 1],     // 1900 is not a leap year
  ['2000-02-28', '2000-03-01', 2],     // 2000 is
  ['2100-02-28', '2100-03-01', 1],     // 2100 is not
  ['1900-01-01', '2100-01-01', 73049],
  ['2026-12-25', '2026-10-07', -79],
  ['0001-01-01', '9999-12-31', 3652058],
  ['1911-12-31', '1912-01-01', 1]      // 民國前 1 年 → 民國 1 年
];
// [base, months to add, expected, clamped]
const MONTH_CASES = [
  ['2024-01-31', 1, '2024-02-29', true], ['2023-01-31', 1, '2023-02-28', true], ['2100-01-31', 1, '2100-02-28', true],
  ['2000-01-31', 1, '2000-02-29', true], ['2024-03-31', -1, '2024-02-29', true], ['2024-02-29', 12, '2025-02-28', true],
  ['2000-02-29', -1200, '1900-02-28', true], ['2024-01-15', 1, '2024-02-15', false], ['2026-10-31', 1, '2026-11-30', true],
  ['9999-12-31', 1, null, false], ['0001-01-01', -1, null, false]
];

(async () => {
  console.log('Date arithmetic (Node, against JS Date in UTC)');
  await t('day numbers, weekday, day-of-year and ISO week match the reference on 4000 random dates in 1–9999 plus every day of 1899–2101', () => {
    const days = [];
    for (let i = 0; i < 4000; i++) { const y = 1 + Math.floor(rnd() * 9999), m = 1 + Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * ref.dim(y, m)); days.push([y, m, d]); }
    for (let n = ref.day(1899, 1, 1); n <= ref.day(2101, 12, 31); n++) days.push(ref.ymd(n));
    for (const [y, m, d] of days) {
      const n = C.toDayNumber(y, m, d), r = ref.day(y, m, d), tag = y + '-' + m + '-' + d;
      if (n !== r) throw new Error('day number ' + tag);
      const g = C.fromDayNumber(n); if (g.y !== y || g.m !== m || g.d !== d) throw new Error('round trip ' + tag);
      if (C.weekday(n) !== ref.wd(r)) throw new Error('weekday ' + tag);
      if (C.dayOfYear(n) !== ref.doy(r)) throw new Error('day of year ' + tag);
      eq(C.isoWeek(n), ref.isoWeek(r), 'ISO week ' + tag);
    }
  });
  await t('known ISO weeks: 2026-12-31 → 2026-W53, 2027-01-01 → 2026-W53, 2027-01-04 → 2027-W1, 2024-12-30 → 2025-W1', () => {
    eq(C.isoWeek(dn('2026-12-31')), { y: 2026, w: 53 }); eq(C.isoWeek(dn('2027-01-01')), { y: 2026, w: 53 });
    eq(C.isoWeek(dn('2027-01-04')), { y: 2027, w: 1 }); eq(C.isoWeek(dn('2024-12-30')), { y: 2025, w: 1 });
  });
  await t('day-count table (DST weeks, 1900/2000/2100, year 1 to 9999) equals the reference', () => {
    for (const [a, b, d] of DIFF_CASES) { eq(dn(b) - dn(a), d, 'reference ' + a + '→' + b); eq(C.parseDateText(b).n - C.parseDateText(a).n, d, a + '→' + b); }
  });
  await t('adding months clamps to month end (Jan 31 + 1 month, Feb 29 + 1 year) and refuses to leave years 1–9999', () => {
    for (const [b, k, want, cl] of MONTH_CASES) {
      const r = C.addMonths(dn(b), k);
      if (want == null) { eq(r, null, b + ' ' + k); continue; }
      eq(C.iso(r.n), want, b + ' + ' + k + ' months'); eq(r.clamped, cl, b + ' + ' + k + ' clamped');
      eq(ref.iso(ref.addMonths(dn(b), k)), want, 'reference ' + b + ' + ' + k);
    }
    for (let i = 0; i < 3000; i++) {
      const n = ref.day(1 + Math.floor(rnd() * 9000), 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28) + (rnd() < .3 ? 3 : 0)), k = Math.floor(rnd() * 2400) - 1200;
      const r = C.addMonths(n, k), e = ref.addMonths(n, k);
      if (r && r.n !== e) throw new Error(ref.iso(n) + ' + ' + k + ': ' + C.iso(r.n) + ' vs ' + ref.iso(e));
    }
  });
  await t('years/months/days split: whole months by month-end rule, remainder in days, reaches the end date; 9999-12-31 inclusive does not throw', () => {
    eq(C.ymd(dn('2024-01-31'), dn('2025-03-15')), { y: 1, m: 1, d: 15 });
    eq(C.ymd(dn('2023-01-31'), dn('2023-02-28')), { y: 0, m: 1, d: 0 });
    eq(C.ymd(dn('2024-02-29'), dn('2025-02-28')), { y: 1, m: 0, d: 0 });
    eq(C.ymd(dn('9999-12-31'), dn('9999-12-31') + 1), { y: 0, m: 0, d: 1 });
    for (let i = 0; i < 2000; i++) {
      const a = ref.day(1900 + Math.floor(rnd() * 300), 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28)), b = a + Math.floor(rnd() * 5000);
      const r = C.ymd(a, b), k = r.y * 12 + r.m, at = ref.addMonths(a, k);
      if (at + r.d !== b || r.d < 0 || ref.addMonths(a, k + 1) <= b || r.m > 11) throw new Error('ymd ' + ref.iso(a) + '→' + ref.iso(b) + ' ' + JSON.stringify(r));
    }
  });
  await t('business days: N-th working day and range count match a plain day-by-day reference loop', () => {
    const hol = new Set(['2026-10-09', '2026-10-26', '2026-12-25']);
    const off = n => { const w = ref.wd(n); return w === 0 || w === 6 || hol.has(ref.iso(n)); };
    for (let i = 0; i < 60; i++) {
      const st = dn('2026-09-01') + Math.floor(rnd() * 150), N = 1 + Math.floor(rnd() * 60);
      let n = st, left = N; while (left) { n++; if (!off(n)) left--; }
      eq(C.workdays(st, { holidays: hol, sat: true, sun: true, mode: 'n', n: N }).end, n, 'N=' + N + ' from ' + ref.iso(st));
      const en = st + Math.floor(rnd() * 120); let c = 0; for (let k = st; k <= en; k++) if (!off(k)) c++;
      eq(C.workdays(st, { holidays: hol, sat: true, sun: true, mode: 'end', end: en }).count, c, ref.iso(st) + '..' + ref.iso(en));
    }
    eq(C.iso(C.workdays(dn('2026-10-12'), { holidays: hol, sat: true, sun: true, mode: 'n', n: 10 }).end), '2026-10-27');
  });

  console.log('Typed dates');
  const PARSE = [
    ['2026-01-05', '2026-01-05'], ['2026/1/5', '2026-01-05'], ['2026.1.5', '2026-01-05'], ['2026 1 5', '2026-01-05'],
    ['115/1/5', '2026-01-05'], ['115.1.5', '2026-01-05'], ['1150105', '2026-01-05'], ['20260105', '2026-01-05'],
    ['２０２６／１／５', '2026-01-05'], ['１１５．１．５', '2026-01-05'], ['2026年1月5日', '2026-01-05'], ['民國115年1月5日', '2026-01-05'],
    ['2026-01-05（一）', '2026-01-05'], ['2026/1/5 星期一', '2026-01-05'], ['西元2026年1月5日', '2026-01-05'],
    ['1/1/1', '1912-01-01'], ['99/1/1', '2010-01-01'], ['民國前1年12月31日', '1911-12-31'], ['民前 10 年 1 月 1 日', '1902-01-01'],
    ['0099-01-01', '0099-01-01'], ['西元99/1/1', '0099-01-01'], ['2024/2/29', '2024-02-29'], ['2000-02-29', '2000-02-29'], ['9999-12-31', '9999-12-31']
  ];
  const BAD = [['2026-02-30', '2 月只有 28 天'], ['115/2/29', '2 月只有 28 天'], ['1900-02-29', '1900 年 2 月只有 28 天'], ['2100-02-29', '只有 28 天'],
    ['2026-13-01', '月份需在 1–12'], ['2026-04-31', '4 月只有 30 天'], ['0/1/1', '沒有民國 0 年'], ['10000-01-01', '1–9999'], ['1/5/2026', '看不懂'], ['abc', '看不懂'], ['2026-1-0', '1 日開始']];
  await t('accepts ISO, slashes, dots, spaces, 年月日, 民國 (1–3 digit years, 民國/民國前 prefix), compact digits, full-width, trailing weekday', () => {
    for (const [s, want] of PARSE) { const r = C.parseDateText(s); ok(r.n != null, s + ': ' + r.err); eq(C.iso(r.n), want, s); }
  });
  await t('invalid dates get a specific message (Feb 30, 1900/2100 not leap, month 13, 民國 0, US order)', () => {
    for (const [s, part] of BAD) { const r = C.parseDateText(s); ok(r.n == null && r.err.includes(part), s + ' → ' + JSON.stringify(r)); }
    ok(C.parseDateText('  ').empty, 'blank is "empty", not an error');
  });

  console.log('Lunar calendar (Node, against ICU chinese calendar and known 春節 dates)');
  await t('春節 and leap months on known dates', () => {
    const CNY = { 1950: '02-17', 1984: '02-02', 1990: '01-27', 2000: '02-05', 2020: '01-25', 2023: '01-22', 2024: '02-10', 2025: '01-29', 2026: '02-17', 2027: '02-06', 2028: '01-26', 2030: '02-03', 2100: '02-09' };
    for (const [y, md] of Object.entries(CNY)) { const l = C.solarToLunar(dn(y + '-' + md)); eq([l.month, l.day, l.isLeap], [1, 1, false], '春節 ' + y); }
    const L = [['2023-03-22', 2], ['2025-07-25', 6], ['2033-12-22', 11], ['2020-05-23', 4], ['1987-07-26', 6], ['2017-07-23', 6]];
    for (const [s, m] of L) { const l = C.solarToLunar(dn(s)); eq([l.month, l.day, l.isLeap], [m, 1, true], '閏' + m + '月 ' + s); }
    eq(C.solarToLunar(dn('2101-01-01')), null, 'outside the table');
  });
  await t('every day 1901–2100 agrees with ICU, except ICU\'s known midnight-boundary/pre-1929 errors where the table is right', () => {
    // ICU (Node) disagrees in these windows; each was checked against the new-moon time in UTC+8 or a published 春節/中元 date
    const ICU_WRONG = ['1917-03-23', '1922-06-25', '1954-02-03', '1955-02-22', '1987-07-26', '1999-01-17', '2012-08-17', '2018-11-07', '2027-02-06', '2030-02-02', '2070-03-12'].map(dn);
    const f = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
    const bad = [];
    for (let n = dn('1901-01-01'); n <= dn('2100-12-31'); n++) {
      const l = C.solarToLunar(n), p = f.formatToParts(new Date(n * 864e5)), mo = p.find(x => x.type === 'month').value, d = +p.find(x => x.type === 'day').value;
      if (l.month !== parseInt(mo, 10) || l.day !== d || l.isLeap !== /bis/.test(mo)) bad.push(n);
    }
    const starts = bad.filter(n => !bad.includes(n - 1));
    ok(starts.every(n => ICU_WRONG.includes(n)), 'unexpected disagreements starting ' + starts.filter(n => !ICU_WRONG.includes(n)).map(ref.iso).join(', '));
    ok(bad.length < 500, bad.length + ' days differ');
  });
  await t('solar terms on known dates (Taiwan time)', () => {
    const T = [['2026-02-04', '立春'], ['2026-04-05', '清明'], ['2026-06-21', '夏至'], ['2026-10-08', '寒露'], ['2026-12-22', '冬至'], ['2025-02-03', '立春'], ['2024-12-21', '冬至'], ['2023-12-22', '冬至'], ['2024-06-21', '夏至']];
    for (const [s, name] of T) eq(C.termOnDay(dn(s)), name, s);
  });

  console.log('Page');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  // served over http, not file://: Chromium can drop a localStorage write across a reload of a file:// page
  const page = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + html + '</body></html>';
    // /blank is an empty page on the same origin, for seeding storage without the app's pagehide flush overwriting it
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(q.url === '/blank' ? '<!doctype html><title>blank</title>' : page); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  // 2026-03-08 20:00 UTC: New York has just switched to EDT (still 03-08), Taipei is already 03-09
  const NOW = new Date('2026-03-08T20:00:00Z');
  const localToday = (tz, at = NOW) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  async function open(tz, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: tz, colorScheme: 'light' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL.slice(0, -1) });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(tz + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(tz + ' console: ' + m.text()); });
    await p.clock.install({ time: opt.time || NOW });
    if (opt.store) { await p.goto(URL + 'blank'); await p.evaluate(s => { localStorage.clear(); for (const k in s) localStorage.setItem('date-calc:v1:' + k, s[k]); }, opt.store); }
    await p.goto(URL);
    await p.waitForFunction(() => window.__dateCalc);
    return { ctx, p };
  }
  const text = (p, s) => p.$eval(s, e => e.textContent.replace(/\u00a0/g, ' '));
  const val = (p, s) => p.$eval(s, e => e.value);

  for (const tz of ['Asia/Taipei', 'America/New_York']) {
    console.log('  ' + tz);
    const { ctx, p } = await open(tz);
    await t(tz + ': "today" is the local calendar date at a fixed instant; 今天 button (touch) fills it', async () => {
      const want = localToday(tz);
      eq(await p.evaluate(() => window.__dateCalc.today()), want);
      ok((await text(p, '#today-line')).includes(want), 'today line');
      await p.fill('#diff-start', '2000-01-01');
      await p.tap('#diff-start ~ [data-today]');
      await p.waitForFunction(w => document.querySelector('#diff-start').value === w, want);
    });
    await t(tz + ': day-count table through the UI equals the reference, with and without 含首日', async () => {
      for (const [a, b, d] of DIFF_CASES) {
        await p.fill('#diff-start', a); await p.fill('#diff-end', b);
        const want = (d < 0 ? '−' : '') + Math.abs(d).toLocaleString('zh-TW');
        eq(await text(p, '#diff-days'), want, a + '→' + b);
      }
      await p.fill('#diff-start', '2026-03-07'); await p.fill('#diff-end', '2026-03-09');
      await p.check('#diff-incl'); eq(await text(p, '#diff-days'), '3', 'inclusive');
      ok((await text(p, '#diff-alt')).includes('不含首日）是 2 天'), 'inclusive note gives the other count');
      ok((await text(p, '#diff-sentence')).includes('（含首日）'), 'sentence says 含首日');
      await p.uncheck('#diff-incl'); eq(await text(p, '#diff-days'), '2', 'exclusive');
      ok((await text(p, '#diff-alt')).includes('含首日）是 3 天'), 'exclusive note gives the inclusive count');
      await p.fill('#diff-start', '9999-12-31'); await p.fill('#diff-end', '9999-12-31'); await p.check('#diff-incl');
      eq(await text(p, '#diff-days'), '1', '9999-12-31 inclusive'); await p.uncheck('#diff-incl');
    });
    await t(tz + ': add/subtract days, weeks, months, years with month-end clamping and a note', async () => {
      await p.click('#tab-add');
      const cases = [['2024-01-31', 1, 'm', 1, '2024-02-29', true], ['2023-01-31', 1, 'm', 1, '2023-02-28', true], ['2024-02-29', 1, 'y', 1, '2025-02-28', true],
        ['2000-02-29', 100, 'y', -1, '1900-02-28', true], ['2026-03-07', 1, 'd', 1, '2026-03-08', false], ['2026-03-08', 1, 'w', 1, '2026-03-15', false],
        ['2026-11-01', 1, 'd', -1, '2026-10-31', false], ['2024-01-31', 100, 'd', -1, '2023-10-23', false]];
      for (const [b, k, u, s, want, cl] of cases) {
        await p.fill('#add-base', b); await p.fill('#add-n', String(k)); await p.click('#add-unit-' + u); await p.click(s > 0 ? '#add-sign-plus' : '#add-sign-minus');
        eq(await text(p, '#add-result'), want, b + (s > 0 ? ' + ' : ' − ') + k + u);
        eq(!!(await p.$('#add-clamp')), cl, 'clamp note ' + b);
      }
      await p.fill('#add-base', '9999-12-01'); await p.fill('#add-n', '1'); await p.click('#add-unit-m'); await p.click('#add-sign-plus');
      ok((await text(p, '#add-out')).includes('超出西元 1–9999 年'), 'range error');
      await p.fill('#add-n', '-3'); ok((await text(p, '#add-out')).includes('往前（減）'), 'negative amount explains direction');
      await p.fill('#add-n', '1'); await p.click('#add-unit-d'); await p.fill('#add-base', '2026-12-31');
      ok((await text(p, '#add-out')).includes('ISO 第 53 週（屬 2026 年）'), 'result shows ISO week of 2027-01-01');
      ok((await text(p, '#add-out')).includes('民國 116 年'), 'result shows 民國 year');
    });
    await t(tz + ': typed 民國 / full-width / compact dates are read, explained under the field and tidied on blur', async () => {
      await p.click('#tab-diff');
      for (const s of ['115/1/5', '２０２６／１／５', '1150105', '民國115年1月5日']) {
        await p.fill('#diff-start', s);
        ok((await text(p, '#diff-start-hint')).startsWith('＝ 2026-01-05 · 星期一 · 民國 115 年'), s + ' hint: ' + await text(p, '#diff-start-hint'));
      }
      await p.locator('#diff-start').blur();
      await p.waitForFunction(() => document.querySelector('#diff-start').value === '2026-01-05');
      ok((await text(p, '#diff-start-hint')).startsWith('星期一'), 'hint after tidy');
      eq(await val(p, '#diff-start-pick'), '2026-01-05', 'native picker follows the typed date');
    });
    await t(tz + ': Feb 30 is flagged on the field (aria-invalid, message) and in the result', async () => {
      await p.fill('#diff-start', '115/2/30');
      eq(await p.getAttribute('#diff-start', 'aria-invalid'), 'true');
      ok((await text(p, '#diff-start-hint')).includes('2026 年 2 月只有 28 天，沒有 30 日'), 'hint');
      ok(await p.$eval('#diff-start-hint', e => e.classList.contains('bad')), 'hint styled as error');
      ok((await text(p, '#diff-out')).includes('起日有誤'), 'result names the bad field');
      await p.locator('#diff-start').blur();
      eq(await val(p, '#diff-start'), '115/2/30', 'invalid text is left for the user to fix');
      await p.fill('#diff-start', '2026-02-28');
      eq(await p.getAttribute('#diff-start', 'aria-invalid'), null, 'cleared when fixed');
    });
    await t(tz + ': the native date picker sets the field', async () => {
      await p.$eval('#diff-end-pick', e => { e.value = '2027-02-06'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.waitForFunction(() => document.querySelector('#diff-end').value === '2027-02-06');
      eq(await text(p, '#diff-days'), String(dn('2027-02-06') - dn('2026-02-28')));
    });
    await t(tz + ': lunar tab reads typed dates (春節 2026, 2033 閏十一月) and the day/month buttons', async () => {
      await p.click('#tab-lunar');
      await p.fill('#lunar-date', '115/2/17'); eq(await text(p, '#lunar-result'), '正月初一');
      ok((await text(p, '#lunar-out')).includes('丙午年'), '丙午');
      await p.fill('#lunar-date', '2033-12-22'); eq(await text(p, '#lunar-result'), '閏十一月初一');
      await p.click('#lunar-next'); await p.waitForFunction(() => document.querySelector('#lunar-date').value === '2033-12-23');
      eq(await text(p, '#lunar-result'), '閏十一月初二');
      await p.fill('#lunar-date', '2101-01-01'); ok(await p.$('#lunar-range'), 'range message');
    });
    await ctx.close();
  }

  await t('copy puts the sentence on the clipboard; screen readers hear one sentence after typing stops (no card-wide live regions)', async () => {
    const { ctx, p } = await open('Asia/Taipei');
    eq(await p.$$eval('.card[aria-live], .card [aria-live]', e => e.length), 0, 'no live region around inputs/cards');
    await p.fill('#diff-start', '2024-01-31'); await p.fill('#diff-end', '2025-03-15');
    await p.clock.runFor(1000);
    await p.waitForFunction(() => document.querySelector('#sr').textContent.includes('相差 409 天'));
    ok((await text(p, '#diff-out')).includes('1 年 1 個月 15 天'), 'y/m/d split');
    await p.click('#diff-copy');
    await p.waitForFunction(() => /已複製|無法自動複製/.test(document.querySelector('#toast').textContent));
    const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    eq(clip, '2024-01-31（三）→ 2025-03-15（六）相差 409 天（不含首日）');
    await ctx.close();
  });
  await t('inputs survive a reload right after typing (pagehide flush, debounce never ran) and come back as typed', async () => {
    const { ctx, p } = await open('Asia/Taipei');
    await p.clock.pauseAt(new Date(NOW.getTime() + 60000)); // timers frozen: the 300 ms save debounce cannot run
    await p.fill('#diff-start', '115/1/5'); await p.fill('#diff-end', '2026-02-17'); await p.check('#diff-incl');
    await p.click('#tab-add'); await p.click('#add-unit-w'); await p.fill('#add-n', '7'); await p.fill('#add-base', '115/3/1');
    await p.reload(); await p.waitForFunction(() => window.__dateCalc);
    eq(await val(p, '#diff-start'), '2026-01-05', 'tidied on leaving the field'); eq(await val(p, '#diff-end'), '2026-02-17');
    eq(await val(p, '#add-base'), '115/3/1', 'still as typed (never left the field)'); eq(await text(p, '#add-result'), '2026-04-19');
    ok(await p.isChecked('#diff-incl'), 'incl kept'); ok(await p.isVisible('#p-add'), 'tab kept');
    eq(await val(p, '#add-n'), '7'); eq(await p.getAttribute('#add-unit-w', 'aria-pressed'), 'true');
    await p.click('#tab-diff'); eq(await text(p, '#diff-days'), '44');
    await ctx.close();
  });
  await t('corrupt or hostile storage falls back to defaults: no NaN, no injected markup, no errors', async () => {
    const before = errors.length;
    const { ctx, p } = await open('Asia/Taipei', { store: {
      inputs: JSON.stringify({ diff: 'x', add: { n: 'abc', unit: 'q', sign: 'z', base: 12 }, work: { mode: 5, n: null, sat: 'no' }, lunar: [], anniFirst: 'maybe' }),
      holidays: JSON.stringify([1, '2026-02-30', '2026-01-01', '2026-01-01', null]),
      anniversaries: JSON.stringify([null, 5, { title: '<img src=x onerror=alert(1)>', date: '2026-01-01', icon: '<b>', id: {} }, { title: 'bad', date: '2026-02-30' }]),
      theme: '"neon"', tab: '"zzz"'
    } });
    for (const tab of ['diff', 'add', 'work', 'anni', 'lunar']) { await p.click('#tab-' + tab); ok(!/NaN|undefined/.test(await text(p, '#p-' + tab)), tab + ' shows NaN/undefined'); }
    eq(await text(p, '#add-result'), localToday('Asia/Taipei', new Date(NOW.getTime() + 100 * 864e5)), 'add falls back to today + 100 days');
    eq(await p.$$eval('#hol-list .chip', e => e.length), 1, 'one valid, de-duplicated holiday');
    eq(await p.$$eval('.anni', e => e.length), 1, 'one valid anniversary');
    eq(await p.$$eval('.anni img, .anni b:not(.num)', e => e.length), 0, 'title and icon are escaped / replaced');
    await p.evaluate(() => localStorage.setItem('date-calc:v1:inputs', '{not json')); await p.reload(); await p.waitForFunction(() => window.__dateCalc);
    ok(await p.$('#diff-days'), 'unparsable JSON → defaults');
    eq(errors.length, before, 'no page errors');
    await ctx.close();
  });
  await t('crossing midnight while open moves "today" and the anniversary count (fixed clock, New York)', async () => {
    const { ctx, p } = await open('America/New_York', { time: new Date('2026-03-08T04:59:00Z') }); // 23:59 EST on 03-07
    ok((await text(p, '#today-line')).includes('2026-03-07'), 'before midnight');
    await p.click('#tab-anni');
    await p.fill('#anni-title', '開始存錢'); await p.fill('#anni-date', '2026-03-01'); await p.click('#anni-add');
    await p.waitForFunction(() => document.querySelector('.anni h3').textContent === '開始存錢');
    eq(await p.$eval('.anni .count b', e => e.textContent), '7', 'day 7 including the first day');
    await p.clock.runFor(90000);
    await p.waitForFunction(() => document.querySelector('#today-line').textContent.includes('2026-03-08'));
    eq(await p.$eval('.anni .count b', e => e.textContent), '8', 'day 8 after midnight');
    await ctx.close();
  });
  await t('holiday import takes mixed formats with labels; work-day count follows', async () => {
    const { ctx, p } = await open('Asia/Taipei');
    await p.click('#tab-work'); await p.click('#work-mode-end');
    await p.fill('#work-start', '2026-10-12'); await p.fill('#work-end', '2026-10-31');
    eq(await text(p, '#work-count'), '14', 'with the 10/26 sample');
    await p.click('details.imp summary');
    await p.fill('#hol-import', '115/10/30 公司旅遊\n2026-02-30\n２０２６／１０／２６');
    await p.click('#hol-import-btn');
    await p.waitForFunction(() => /匯入 1 筆，1 筆看不懂/.test(document.querySelector('#toast').textContent));
    eq(await text(p, '#work-count'), '13', 'after adding 10/30');
    await p.fill('#hol-date', '2026/2/30'); await p.click('#hol-add');
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('只有 28 天'));
    await ctx.close();
  });
  await t('every date field has a ≥44px calendar button whose picker is labelled, and the hint is tied to the field', async () => {
    const { ctx, p } = await open('Asia/Taipei');
    const r = await p.$$eval('input.dtext', els => els.map(e => { const pk = document.getElementById(e.id + '-pick'), b = pk.parentElement.getBoundingClientRect(); return [e.id, Math.round(b.width), Math.round(b.height), !!pk.getAttribute('aria-label'), e.getAttribute('aria-describedby') === e.id + '-hint']; }));
    eq(r.length, 8, 'eight date fields');
    for (const [id, w, h, lab, desc] of r) ok((w >= 44 || w === 0) && (h >= 44 || h === 0) && lab && desc, JSON.stringify([id, w, h, lab, desc]));
    await ctx.close();
  });

  await browser.close();
  if (errors.length) { fail++; console.log('FAIL   page errors: ' + errors.slice(0, 5).join(' | ')); }
  console.log(fail ? `FAIL ${fail} failed, ${pass} passed` : `all ${pass} passed`);
  process.exit(fail ? 1 : 0);
})();
