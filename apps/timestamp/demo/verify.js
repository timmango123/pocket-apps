// Playwright verification for timestamp. Run: node verify.js
// Cross-checks against Python datetime + zoneinfo.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const short = s => s.length > 110 ? s.slice(0, 110) + '…' : s;
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, `${m}: ${A === B ? short(A) : A + ' != ' + B}`); };

const TS = [0, 1700000000, -1, -86400 * 365 * 80 - 12345, 2147483648, 951782400, 1735689599, 1609459200, 4102444800, -2208988800, 1230768000, 1262217600];
const WALLS = [
  ['America/New_York', 2026, 3, 8, 2, 30, 0], ['America/New_York', 2026, 11, 1, 1, 30, 0], ['America/New_York', 2026, 7, 4, 12, 0, 0],
  ['Europe/London', 2026, 3, 29, 1, 15, 0], ['Europe/London', 2026, 10, 25, 1, 15, 0], ['Australia/Sydney', 2026, 4, 5, 2, 30, 0],
  ['Australia/Sydney', 2026, 10, 4, 2, 30, 0], ['Australia/Lord_Howe', 2026, 10, 4, 2, 15, 0], ['Asia/Taipei', 1970, 1, 1, 8, 0, 0],
  ['Asia/Kolkata', 2000, 2, 29, 23, 59, 59], ['Pacific/Apia', 2011, 12, 30, 12, 0, 0], ['UTC', 1969, 12, 31, 23, 59, 59],
];
const py = `
import json, sys
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
ts, walls = json.loads(sys.argv[1]), json.loads(sys.argv[2])
tp = ZoneInfo("Asia/Taipei")
out = {"ts": [], "walls": []}
for t in ts:
    u = datetime(1970,1,1,tzinfo=timezone.utc) + timedelta(seconds=t)
    l = u.astimezone(tp)
    iy, iw, _ = l.isocalendar()
    out["ts"].append({"utc": u.strftime("%Y-%m-%dT%H:%M:%S") + ".000Z", "local": l.strftime("%Y-%m-%d %H:%M:%S"), "wd": l.isoweekday() % 7,
                      "doy": l.timetuple().tm_yday, "week": [iy, iw], "rfc": l.strftime("%a, %d %b %Y %H:%M:%S %z")})
for tz, y, mo, d, h, mi, s in walls:
    z = ZoneInfo(tz)
    a = datetime(y, mo, d, h, mi, s, tzinfo=z, fold=0); b = a.replace(fold=1)
    ta, tb = int(a.timestamp()), int(b.timestamp())
    back = datetime.fromtimestamp(ta, z).replace(tzinfo=None) == a.replace(tzinfo=None)
    status = "gap" if not back else ("dup" if ta != tb else "ok")
    out["walls"].append({"t": ta * 1000, "status": status})
print(json.dumps(out))`;
const REF = JSON.parse(execFileSync('python3', ['-c', py, JSON.stringify(TS), JSON.stringify(WALLS)]).toString());

(async () => {
  const browser = await chromium.launch();
  const base = { timezoneId: 'Asia/Taipei', locale: 'zh-TW' };
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '360x780', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '844x390', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: 'dark-390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' },
    { name: 'desktop-1280x800', viewport: { width: 1280, height: 800 } },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext(Object.assign({}, base, s)); const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(s.name + ' console: ' + m.text()); });
    page.on('pageerror', e => errors.push(s.name + ' pageerror: ' + e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__tsReady);
    await page.waitForTimeout(300);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844' || s.name === 'dark-390x844') {
      const small = await page.$$eval('button', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent));
      eq(small, [], s.name + ' all visible buttons >= 44px');
      await page.click('#batch summary');
      await page.selectOption('#dtZone', 'America/New_York'); await page.fill('#dtIn', '2026-03-08T02:30'); await page.dispatchEvent('#dtIn', 'input');
      const sw2 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert(sw2, s.name + ' full page (batch open) no horizontal scroll');
      await page.screenshot({ path: `${OUT}/flow-full${s.name.startsWith('dark') ? '-dark' : ''}.png`, fullPage: true });
    }
    await ctx.close();
  }

  const ctx = await browser.newContext(Object.assign({}, base, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__tsReady);
  eq(await page.evaluate(() => window.__ts.LOCAL_TZ), 'Asia/Taipei', 'local tz is Asia/Taipei in test');

  // library vs Python for many instants
  const got = await page.evaluate(ts => ts.map(t => {
    const T = window.__ts, ms = t * 1000, p = T.partsAt('Asia/Taipei', ms), pad = n => String(n).padStart(2, '0');
    const r = T.parseTs(String(t), 's');
    return { utc: T.isoSub(r), local: `${String(p.y).padStart(4, '0')}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`, wd: p.wd, doy: T.dayOfYear(p), week: [T.isoWeek(p).wy, T.isoWeek(p).w] };
  }), TS);
  TS.forEach((t, i) => { const { rfc, ...ref } = REF.ts[i]; eq(got[i], ref, `ts ${t}: UTC/local/weekday/day-of-year/ISO week vs Python`); });
  const walls = await page.evaluate(ws => ws.map(([tz, ...f]) => { const r = window.__ts.wallToUtc(tz, ...f); return { t: r.t, status: r.status }; }), WALLS);
  WALLS.forEach((w, i) => eq(walls[i], REF.walls[i], `wall→UTC ${w.join(' ')} vs Python zoneinfo`));

  // UI: spec examples
  const rows = async () => page.$$eval('#tsOut .r', rs => Object.fromEntries(rs.map(r => [r.querySelector('.k').textContent, r.querySelector('button').textContent])));
  let r = await rows();
  eq(r['ISO 8601'], '2023-11-14T22:13:20.000Z', '1700000000 → ISO');
  eq(r['本地時間'], '2023-11-15 06:13:20（週三）', '1700000000 → Taipei local');
  eq(r['RFC 2822'], REF.ts[1].rfc, '1700000000 → RFC 2822 equals Python strftime');
  eq(r['判斷單位'], '秒（可在上方手動指定）', 'auto unit = seconds');
  await page.fill('#tsIn', '1700000000000'); r = await rows();
  eq([r['ISO 8601'], r['判斷單位'].slice(0, 2)], ['2023-11-14T22:13:20.000Z', '毫秒'], '1700000000000 same instant, unit ms');
  await page.fill('#tsIn', '0'); r = await rows();
  eq(r['ISO 8601'], '1970-01-01T00:00:00.000Z', '0 → 1970-01-01T00:00:00Z');
  await page.fill('#tsIn', '1700000000123456789'); r = await rows();
  eq([r['秒'], r['ISO 8601'], r['判斷單位'].slice(0, 2)], ['1700000000.123456789', '2023-11-14T22:13:20.123456789Z', '奈秒'], '19-digit ns: exact seconds, no precision loss');
  await page.fill('#tsIn', '1700000000123456'); r = await rows();
  eq([r['秒'], r['判斷單位'].slice(0, 2)], ['1700000000.123456', '微秒'], '16-digit µs');
  await page.fill('#tsIn', '-1.5'); r = await rows();
  eq(r['ISO 8601'], '1969-12-31T23:59:58.500Z', 'negative fractional seconds');
  await page.fill('#tsIn', '1700000000.123'); r = await rows();
  eq(r['毫秒'], '1700000000123', 'fractional seconds → ms');
  await page.fill('#tsIn', '2147483648');
  assert((await page.$eval('#tsOut', e => e.textContent)).includes('32 位元'), '2038 warning shown');
  await page.fill('#tsIn', '2024/02/29 12:00:00'); r = await rows();
  eq(r['ISO 8601'], '2024-02-29T04:00:00.000Z', 'YYYY/MM/DD parsed as local Taipei');
  await page.fill('#tsIn', 'Tue, 14 Nov 2023 22:13:20 +0000'); r = await rows();
  eq(r['秒'], '1700000000', 'RFC 2822 string parsed');
  await page.fill('#tsIn', '2023-11-14T22:13:20Z'); r = await rows();
  eq(r['秒'], '1700000000', 'ISO string parsed');
  await page.fill('#tsIn', '9'.repeat(25));
  assert((await page.$eval('#tsOut', e => e.textContent)).includes('超出可表示範圍'), 'out of range message');
  await page.fill('#tsIn', 'abc');
  assert((await page.$eval('#tsOut', e => e.textContent)).includes('無法辨識'), 'unrecognised message');
  await page.fill('#tsIn', '1700000000'); await page.selectOption('#unit', 'ms'); r = await rows();
  eq(r['ISO 8601'], '1970-01-20T16:13:20.000Z', 'manual unit override (ms)');
  await page.selectOption('#unit', 'auto');

  // date → timestamp, DST
  await page.selectOption('#dtZone', 'America/New_York'); await page.fill('#dtIn', '2026-03-08T02:30'); await page.fill('#dtSec', '0'); await page.dispatchEvent('#dtSec', 'input');
  assert((await page.$eval('#dtOut', e => e.textContent)).includes('不存在'), 'NY 2026-03-08 02:30 → does not exist');
  await page.fill('#dtIn', '2026-11-01T01:30'); await page.dispatchEvent('#dtIn', 'input');
  let dtt = await page.$eval('#dtOut', e => e.textContent);
  assert(dtt.includes('兩次') && dtt.includes(String(REF.walls[1].t / 1000)), 'NY 2026-11-01 01:30 → ambiguous, earlier used');
  await page.selectOption('#dtZone', 'Asia/Taipei'); await page.fill('#dtIn', '2023-11-15T06:13'); await page.fill('#dtSec', '20'); await page.dispatchEvent('#dtSec', 'input');
  eq(await page.$eval('#dtOut .r.main button', e => e.textContent), '1700000000', 'Taipei 2023-11-15 06:13:20 → 1700000000');

  // zones
  await page.fill('#tsIn', '1700000000');
  const z = await page.$$eval('#zones li', ls => ls.map(l => [l.querySelector('.tz').textContent, l.querySelector('button.t span').textContent]));
  eq(z, [['UTC+08:00 · Asia/Taipei', '06:13:20'], ['UTC+00:00 · UTC', '22:13:20'], ['UTC+09:00 · Asia/Tokyo', '07:13:20'], ['UTC-05:00 · America/New_York', '17:13:20'], ['UTC+00:00 · Europe/London', '22:13:20']], 'default zone list for 1700000000');
  await page.selectOption('#zoneAdd', 'Asia/Kolkata'); await page.click('#zoneAddBtn');
  eq(await page.$eval('#zones li:last-child button.t span', e => e.textContent), '03:43:20', 'added Kolkata (+05:30)');
  await page.click('#zone-del-1');
  eq(await page.$$eval('#zones li', l => l.length), 5, 'delete zone');
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem('timestamp:v1:zones'))), ['Asia/Taipei', 'Asia/Tokyo', 'America/New_York', 'Europe/London', 'Asia/Kolkata'], 'zones persisted');

  // batch
  await page.click('#batch summary');
  const bt = await page.$$eval('#batchOut tbody tr', rs => rs.map(r => [...r.children].map(c => c.textContent)));
  eq(bt.map(r => r[2]), ['1970-01-01T00:00:00.000Z', '2023-11-14T22:13:20.000Z', '2023-11-14T22:13:20.123Z', '2023-11-14T22:13:20.123456789Z', '1969-12-31T00:00:00.000Z', '2023-11-14T22:13:20.500Z', '2024-02-29T04:00:00.000Z', '無法辨識'], 'batch conversion table');

  // live clock + background stop
  const s1 = +(await page.$eval('#liveSec', e => e.textContent));
  assert(Math.abs(s1 - Date.now() / 1000) < 3, 'live seconds near now');
  await page.click('#livePause'); assert(!(await page.evaluate(() => window.__ts.timerActive())), 'pause stops timer');
  await page.click('#livePause'); assert(await page.evaluate(() => window.__ts.timerActive()), 'resume restarts timer');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert(!(await page.evaluate(() => window.__ts.timerActive())), 'hidden page stops timer');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  assert(await page.evaluate(() => window.__ts.timerActive()), 'visible page restarts timer');

  await ctx.close(); await browser.close();
  fs.unlinkSync(WRAP);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASSED');
  process.exit(errors.length ? 1 : 0);
})();
