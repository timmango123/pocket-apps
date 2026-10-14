// Playwright verification for cron-reader. Run: node verify.js
// croniter is not installed, so next-run times are cross-checked against an independent
// Python brute-force search (minute by minute, zoneinfo for time zones).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const short = s => s.length > 120 ? s.slice(0, 120) + '…' : s;
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, `${m}: ${A === B ? short(A) : A + ' != ' + B}`); };

const FROM = Date.UTC(2026, 9, 13, 10, 17, 23, 456);
const CASES = [
  ['0 9 * * 1-5', '5', 'Asia/Taipei', 10], ['*/15 9-17 * * 1-5', '5', 'Asia/Taipei', 50], ['0 0 1 * 1', '5', 'Asia/Taipei', 12],
  ['0 9,18 * * 1-5', '5', 'Asia/Taipei', 10], ['5,35 */3 * JAN-MAR,OCT mon-fri', '5', 'UTC', 40], ['0 0 * * 7', '5', 'Europe/London', 6],
  ['30 1 * * *', '5', 'America/New_York', 30], ['30 2 * * *', '5', 'America/New_York', 160], ['0 12 */2 * *', '5', 'Asia/Tokyo', 20],
  ['0 0 1-7 * 5', '5', 'UTC', 10], ['@monthly', '5', 'Asia/Taipei', 5], ['15 10 * * 5-7', '5', 'Australia/Sydney', 12],
  ['*/20 * * * * *', '6', 'Asia/Taipei', 10], ['15 30 8 * * 1-5', '6', 'Asia/Taipei', 5], ['0 */15 9-17 * * 1-5', '6', 'Asia/Kolkata', 20],
  ['0 0 12 L * ?', 'q', 'Asia/Taipei', 6], ['0 0 9 ? * 2#1', 'q', 'Asia/Taipei', 6], ['0 0 18 ? * 6L', 'q', 'Asia/Taipei', 6],
  ['0 0 10 15W * ?', 'q', 'UTC', 8], ['0 0 10 1W * ?', 'q', 'UTC', 8], ['0 30 17 LW * ?', 'q', 'UTC', 6], ['0 0 8 L-2 * ?', 'q', 'UTC', 5],
  ['0 0 9 ? * MON-FRI', 'q', 'Asia/Taipei', 8], ['0 0 0 * * ? 2027-2028', 'q', 'UTC', 3],
];
const py = String.raw`
import json, sys, calendar
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
MON = dict(JAN=1,FEB=2,MAR=3,APR=4,MAY=5,JUN=6,JUL=7,AUG=8,SEP=9,OCT=10,NOV=11,DEC=12)
DOW = dict(SUN=0,MON=1,TUE=2,WED=3,THU=4,FRI=5,SAT=6)
MAC = {"@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@daily": "0 0 * * *", "@weekly": "0 0 * * 0", "@hourly": "0 * * * *"}
def val(t, kind, q):
    t = t.upper()
    if kind == "mon" and t in MON: return MON[t]
    if kind == "dow" and t in DOW: return DOW[t] + (1 if q else 0)
    return int(t)
def norm(v, kind, q):
    if kind != "dow": return v
    return v - 1 if q else v % 7
def field(tok, kind, lo, hi, q):
    f = {"vals": set(), "star": tok.startswith("*") or tok == "?", "q": tok == "?", "L": [], "LW": False, "W": [], "lastDow": [], "nth": []}
    if kind == "dow": lo, hi = (1, 7) if q else (0, 7)
    for part in tok.split(","):
        P = part.upper()
        if P in ("*", "?"): a, b, st = lo, (7 if q else 6) if kind == "dow" else hi, 1
        elif kind == "dom" and P == "L": f["L"].append(0); continue
        elif kind == "dom" and P.startswith("L-"): f["L"].append(int(P[2:])); continue
        elif kind == "dom" and P == "LW": f["LW"] = True; continue
        elif kind == "dom" and P.endswith("W"): f["W"].append(int(P[:-1])); continue
        elif kind == "dow" and P.endswith("L"): f["lastDow"].append(norm(val(P[:-1], kind, q), kind, q)); continue
        elif kind == "dow" and "#" in P: x, k = P.split("#"); f["nth"].append((norm(val(x, kind, q), kind, q), int(k))); continue
        else:
            st = 1
            if "/" in P: P, s = P.split("/"); st = int(s)
            if P == "*": a, b = lo, ((7 if q else 6) if kind == "dow" else hi)
            elif "-" in P: x, y = P.split("-"); a, b = val(x, kind, q), val(y, kind, q)
            else: a = val(P, kind, q); b = a if st == 1 and "/" not in part else ((7 if q else 6) if kind == "dow" else hi)
        for v in range(a, b + 1, st): f["vals"].add(norm(v, kind, q))
    return f
def dom_ok(f, y, m, d):
    if d in f["vals"]: return True
    last = calendar.monthrange(y, m)[1]
    for n in f["L"]:
        if d == last - n: return True
    if f["LW"]:
        t = last
        while calendar.weekday(y, m, t) >= 5: t -= 1
        if d == t: return True
    for n in f["W"]:
        t = min(n, last); wd = calendar.weekday(y, m, t)  # Mon=0..Sun=6
        if wd == 5: t = t - 1 if t > 1 else t + 2
        elif wd == 6: t = t + 1 if t < last else t - 2
        if d == t: return True
    return False
def dow_ok(f, y, m, d):
    w = (calendar.weekday(y, m, d) + 1) % 7
    if w in f["vals"]: return True
    last = calendar.monthrange(y, m)[1]
    for x in f["lastDow"]:
        if w == x and d > last - 7: return True
    for x, k in f["nth"]:
        if w == x and (d - 1) // 7 + 1 == k: return True
    return False
def runs(expr, mode, tz, frm, n):
    q = mode == "q"
    if expr.startswith("@"): expr = MAC[expr]
    t = expr.split()
    if mode == "5": t = ["0"] + t
    if q and len(t) == 6: t.append("*")
    if not q: t.append("*")
    keys = [("sec",0,59),("min",0,59),("hour",0,23),("dom",1,31),("mon",1,12),("dow",0,6),("year",1970,2099)]
    F = {k: field(t[i], k, lo, hi, q) for i, (k, lo, hi) in enumerate(keys)}
    z = ZoneInfo(tz); out = []; seen = set()
    secs = sorted(F["sec"]["vals"])
    minute = (frm // 60000) * 60
    end = frm // 1000 + 5 * 366 * 86400
    while len(out) < n and minute < end:
        L = datetime.fromtimestamp(minute, z)
        if L.minute in F["min"]["vals"] and L.hour in F["hour"]["vals"] and L.month in F["mon"]["vals"] and L.year in F["year"]["vals"]:
            dm, dw = dom_ok(F["dom"], L.year, L.month, L.day), dow_ok(F["dow"], L.year, L.month, L.day)
            ok = (dw if F["dom"]["q"] else dm) if q else ((dm and dw) if (F["dom"]["star"] or F["dow"]["star"]) else (dm or dw))
            if ok:
                for s in secs:
                    ts = (minute + s) * 1000
                    wall = (L.year, L.month, L.day, L.hour, L.minute, s)
                    if ts > frm and wall not in seen:
                        seen.add(wall); out.append(ts)
                        if len(out) >= n: break
        minute += 60
    return out
cases, frm = json.loads(sys.argv[1]), int(sys.argv[2])
print(json.dumps([runs(e, m, tz, frm, n) for e, m, tz, n in cases]))`;
const REF = JSON.parse(execFileSync('python3', ['-c', py, JSON.stringify(CASES), String(FROM)], { maxBuffer: 1 << 26 }).toString());

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
    await page.goto(URL); await page.waitForFunction(() => window.__cronReady);
    await page.waitForTimeout(200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844' || s.name === 'dark-390x844') {
      const small = await page.$$eval('button', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent));
      eq(small, [], s.name + ' all visible buttons >= 44px');
      await page.click('#vm-list'); await page.click('#vt-dow');
      const cellW = await page.$$eval('#vbody .cells button', b => Math.min(...b.map(x => Math.min(x.getBoundingClientRect().width, x.getBoundingClientRect().height))));
      assert(cellW >= 44, s.name + ' editor cells >= 44px (' + cellW + ')');
      await page.screenshot({ path: `${OUT}/flow-full${s.name.startsWith('dark') ? '-dark' : ''}.png`, fullPage: true });
      await page.click('#mode-q'); await page.click('#ex-2');
      await page.screenshot({ path: `${OUT}/flow-quartz${s.name.startsWith('dark') ? '-dark' : ''}.png`, fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), s.name + ' quartz view no horizontal scroll');
    }
    await ctx.close();
  }

  const ctx = await browser.newContext(Object.assign({}, base, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__cronReady);

  // next-run times vs Python brute force
  const got = await page.evaluate(({ cases, from }) => cases.map(([e, m, tz, n]) => window.__cron.next(e, m, tz, from, n)), { cases: CASES, from: FROM });
  CASES.forEach((c, i) => {
    eq(got[i].map(r => r.t), REF[i], `next ${c[3]} runs of "${c[0]}" [${c[1]}] in ${c[2]} match brute force`);
  });
  const dups = got[6].filter(r => r.dup).map(r => new Date(r.t).toISOString());
  eq(dups, ['2026-11-01T05:30:00.000Z'], 'NY 01:30 on 2026-11-01 listed once and marked as repeated');
  assert(!got[7].some(r => new Date(r.t).toISOString().startsWith('2027-03-14')), 'NY 02:30 skipped on DST start 2027-03-14');
  const t0 = Date.now();
  const never = await page.evaluate(f => window.__cron.next('0 0 30 2 *', '5', 'UTC', f, 10), FROM);
  eq(never, [], '0 0 30 2 * → never within 5 years');
  assert(Date.now() - t0 < 1500, '0 0 30 2 * computed quickly (' + (Date.now() - t0) + 'ms)');
  const leap = await page.evaluate(f => window.__cron.next('0 0 29 2 *', '5', 'UTC', f, 3).map(r => new Date(r.t).toISOString()), FROM);
  eq(leap, ['2028-02-29T00:00:00.000Z'], 'Feb 29 within 5-year window');

  // descriptions
  const say = async (expr, mode = '5') => page.evaluate(([e, m]) => { const c = window.__cron.parse(e, m); const d = window.__cron.describe(c); return d.text + (d.sub ? ' | ' + d.sub : ''); }, [expr, mode]);
  const D = {
    '0 9 * * 1-5': '週一至週五的 09:00', '*/5 * * * *': '每 5 分鐘', '0 0 * * *': '每天 00:00', '0 9 * * 1': '每週一的 09:00',
    '0 0 1 * *': '每月 1 號的 00:00', '0 * * * 1-5': '週一至週五，每小時整點', '*/15 9-17 * * 1-5': '週一至週五，9 點至 17 點之間每 15 分鐘',
    '0 9,18 * * 1-5': '週一至週五的 09:00 與 18:00', '@yearly': '1 月 1 號的 00:00', '0 0 30 2 *': '2 月 30 號的 00:00', '* * * * *': '每分鐘',
    '30 * * * *': '每小時的第 30 分', '0 */2 * * *': '每 2 小時（從 0 點起）的整點', '0 8 * 1-3 *': '1 至 3 月每天的 08:00',
  };
  for (const [e, want] of Object.entries(D)) eq((await say(e)).split(' | ')[0], want, `description "${e}"`);
  eq(await say('0 9 * * 1-5'), '週一至週五的 09:00', 'spec: 0 9 * * 1-5 → 週一至週五的 09:00');
  const orText = await say('0 0 1 * 1');
  assert(orText.includes('每月 1 號或每週一') && orText.includes('「或」'), '0 0 1 * 1 explains OR relation: ' + orText);
  for (const e of ['*/5 * * * *', '0 0 * * *', '0 9 * * 1', '0 0 1 * *', '0 * * * 1-5', '*/15 9-17 * * 1-5', '0 9,18 * * 1-5', '@yearly', '0 0 30 2 *', '0 12 */2 * *'])
    assert(!/undefined|null|NaN/.test(await say(e)), `description for "${e}" is clean: ${await say(e)}`);
  for (const [e, m] of [['0 0 12 L * ?', 'q'], ['0 0 9 ? * 2#1', 'q'], ['0 0 18 ? * 6L', 'q'], ['0 0 10 15W * ?', 'q'], ['0 30 17 LW * ?', 'q'], ['*/10 * * * * *', '6'], ['15 30 8 * * *', '6'], ['0 0 0 * * ? 2027-2028', 'q']])
    console.log('info', e.padEnd(22), '→', await say(e, m));
  eq(await say('0 0 9 ? * 2#1', 'q'), '每月第 1 個週一的 09:00', 'Quartz 2#1 = first Monday');
  eq(await say('0 0 18 ? * 6L', 'q'), '每月最後一個週五的 18:00', 'Quartz 6L = last Friday');

  // errors
  const err = async (e, m = '5') => page.evaluate(([e, m]) => { try { window.__cron.parse(e, m); return 'OK'; } catch (x) { return x.message; } }, [e, m]);
  eq(await err('0 25 * * *'), '第 2 欄（時）：25 超過 0–23', 'hour range error');
  eq(await err('0 9 * *'), '應為 5 欄，目前 4 欄', 'field count error');
  eq(await err('0 0 1 * 1', 'q'), '應為 6 或 7 欄，目前 5 欄', 'quartz field count');
  eq(await err('0 0 0 1 * 1', 'q'), 'Quartz 格式中「日」與「週」必須有一個是 ?（另一個才會生效）', 'quartz ? rule');
  eq(await err('*/0 * * * *'), '第 1 欄（分）：間隔不能為 0', 'zero step');
  eq(await err('0 0 * FOO *'), '第 4 欄（月）：無法辨識「FOO」', 'bad month name');

  // UI flow
  await page.fill('#expr', '0   9  * *   1-5 '); await page.waitForTimeout(50);
  eq(await page.$eval('#say', e => e.textContent), '週一至週五的 09:00', 'UI: extra spaces collapsed, sentence shown');
  const runsUi = await page.$$eval('#runs li .tm', l => l.length);
  eq(runsUi, 10, 'UI lists 10 runs by default');
  await page.selectOption('#count', '50'); eq(await page.$$eval('#runs li .tm', l => l.length), 50, 'UI lists 50 runs');
  await page.fill('#expr', '0 25 * * *');
  eq(await page.$eval('#err', e => e.textContent), '第 2 欄（時）：25 超過 0–23', 'UI error box');
  assert(await page.$eval('#fields .f:nth-child(2)', e => e.classList.contains('bad')), 'UI highlights bad field label');
  await page.fill('#expr', '0 0 30 2 *');
  assert((await page.$eval('#runs', e => e.textContent)).includes('5 年內不會執行'), 'UI shows "5 年內不會執行"');
  // caret field highlight
  await page.fill('#expr', '0 9 * * 1-5'); await page.focus('#expr');
  await page.evaluate(() => { const e = document.getElementById('expr'); e.setSelectionRange(2, 2); e.dispatchEvent(new Event('select')); });
  eq(await page.$eval('#fields .f.on span', e => e.textContent), '時', 'caret in 2nd token highlights 時');
  // visual editor: drag across Mon..Fri on dow grid, starting from '*'
  await page.fill('#expr', '0 9 * * *');
  await page.click('#vt-dow'); await page.click('#vm-list');
  const b1 = await page.$eval('#ve-cell-1', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const b5 = await page.$eval('#ve-cell-5', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.move(...b1); await page.mouse.down(); await page.mouse.move(b5[0], b5[1], { steps: 8 }); await page.mouse.up();
  eq(await page.inputValue('#expr'), '0 9 * * 1-5', 'drag Mon→Fri in editor writes 1-5');
  await page.click('#ve-cell-3'); eq(await page.inputValue('#expr'), '0 9 * * 1,2,4,5', 'tap toggles Wed off');
  await page.click('#vt-min'); await page.click('#vm-step'); await page.fill('#ve-step', '10'); await page.dispatchEvent('#ve-step', 'change');
  eq(await page.inputValue('#expr'), '*/10 9 * * 1,2,4,5', 'step editor writes */10');
  await page.click('#vt-hour'); await page.click('#vm-range'); await page.selectOption('#ve-from', '9'); await page.selectOption('#ve-to', '17');
  eq(await page.inputValue('#expr'), '*/10 9-17 * * 1,2,4,5', 'range editor writes 9-17');
  await page.click('#vt-min'); await page.click('#vm-all');
  eq(await page.inputValue('#expr'), '* 9-17 * * 1,2,4,5', '"每" writes *');
  // examples + mode conversion
  await page.click('#ex-1'); eq(await page.inputValue('#expr'), '0 0 * * *', 'example chip fills expression');
  await page.fill('#expr', '0 9 * * 1-5'); await page.click('#mode-q');
  eq(await page.inputValue('#expr'), '0 0 9 ? * 2-6', '5→Quartz conversion shifts weekday numbers');
  eq(await page.$eval('#say', e => e.textContent), '週一至週五的 09:00', 'converted Quartz expression keeps meaning');
  await page.click('#mode-6'); eq(await page.inputValue('#expr'), '0 0 9 * * 1-5', 'Quartz→6 conversion');
  await page.click('#mode-5'); eq(await page.inputValue('#expr'), '0 9 * * 1-5', '6→5 conversion');
  await page.selectOption('#tz', 'America/New_York');
  await page.reload(); await page.waitForFunction(() => window.__cronReady);
  eq([await page.inputValue('#expr'), await page.inputValue('#tz')], ['0 9 * * 1-5', 'America/New_York'], 'expression and tz remembered');

  await ctx.close(); await browser.close();
  fs.unlinkSync(WRAP);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASSED');
  process.exit(errors.length ? 1 : 0);
})();
