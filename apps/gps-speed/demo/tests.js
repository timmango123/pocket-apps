// 測速與里程（gps-speed）核心單元測試：抽出 index.html 的 CORE-START..CORE-END 直接執行。
// 用法：node tests.js（失敗時結束碼為 1）
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {R_EARTH,MAX_ACC,STILL,haversine,UNITS,nextUnit,speedIn,fmtSpeed,fmtDist,fmtDur,fmtPace,signalLevel,median,newTrip,startClock,stopClock,elapsedMs,breakSeg,addFix,tripStats,segStats,projector,fitView,niceScale,simplify,buildGpx,gpxFileName,parseGpx,pack,unpack};')();
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); } }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 以公尺位移產生座標（小範圍內足夠準確）
const M_LAT = 1 / 111194.93; // 1 m 的緯度（R = 6371000）
const offset = (lat, lon, north, east) => ({ lat: lat + north * M_LAT, lon: lon + east * M_LAT / Math.cos(lat * Math.PI / 180) });
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---- Haversine ----
t('同一點距離 0', C.haversine({ lat: 25, lon: 121 }, { lat: 25, lon: 121 }) === 0);
t('赤道經度 1° ≈ 111,195 m', near(C.haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 111194.93, 0.5));
t('緯度 1° ≈ 111,195 m', near(C.haversine({ lat: 10, lon: 30 }, { lat: 11, lon: 30 }), 111194.93, 0.5));
{ const d = C.haversine({ lat: 25.0330, lon: 121.5654 }, { lat: 22.6273, lon: 120.3014 }); t('台北 101 → 高雄 ≈ 297 km', near(d, 297000, 3000), d); }
{ const d = C.haversine({ lat: 51.5007, lon: -0.1246 }, { lat: 40.6892, lon: -74.0445 }); t('倫敦 → 紐約 ≈ 5,575 km', near(d, 5574800, 8000), d); }
t('對稱', C.haversine({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }) === C.haversine({ lat: 3, lon: 4 }, { lat: 1, lon: 2 }));
{ const a = { lat: 25.03, lon: 121.53 }, b = offset(25.03, 121.53, 300, 400); t('小範圍 3-4-5 三角形 = 500 m', near(C.haversine(a, b), 500, 0.5), C.haversine(a, b)); }

// ---- 單位換算與格式 ----
t('10 m/s = 36 km/h', near(C.speedIn(10, 'kmh'), 36, 1e-9));
t('10 m/s = 22.37 mph', near(C.speedIn(10, 'mph'), 22.369, 0.001));
t('10 m/s = 19.44 節', near(C.speedIn(10, 'kn'), 19.438, 0.001));
t('m/s 不變', C.speedIn(7.5, 'mps') === 7.5);
t('單位循環 km/h → mph → m/s → 節 → km/h', C.nextUnit('kmh') === 'mph' && C.nextUnit('mph') === 'mps' && C.nextUnit('mps') === 'kn' && C.nextUnit('kn') === 'kmh');
t('fmtSpeed 一位小數', C.fmtSpeed(6.5, 'kmh') === '23.4' && C.fmtSpeed(0, 'kmh') === '0.0' && C.fmtSpeed(-1, 'kmh') === '0.0' && C.fmtSpeed(null, 'mph') === '0.0');
t('fmtDist 公尺', JSON.stringify(C.fmtDist(850.4, 'kmh')) === '{"v":"850","u":"m"}');
t('fmtDist 公里兩位（無條件捨去）', JSON.stringify(C.fmtDist(12349, 'kmh')) === '{"v":"12.34","u":"km"}');
t('fmtDist ≥100 km 一位', C.fmtDist(123456, 'kmh').v === '123.4');
t('fmtDist 英里', JSON.stringify(C.fmtDist(1609.344 * 3.5, 'mph')) === '{"v":"3.50","u":"mi"}');
t('fmtDist 浬（節）', JSON.stringify(C.fmtDist(1852 * 2, 'kn')) === '{"v":"2.00","u":"浬"}');
t('fmtDur', C.fmtDur(0) === '0:00' && C.fmtDur(59.9) === '0:59' && C.fmtDur(754) === '12:34' && C.fmtDur(3723) === '1:02:03');
t('配速 5\'00"/km（12 km/h）', C.fmtPace(1000 / 300, 'kmh').v === "5'00\"" && C.fmtPace(1000 / 300, 'kmh').u === '/km');
t('配速 mph 時改為每英里', C.fmtPace(1609.344 / 480, 'mph').v === "8'00\"" && C.fmtPace(3, 'mph').u === '/mi');
t('靜止配速顯示 --', C.fmtPace(0.3, 'kmh').v === '--' && C.fmtPace(0, 'kmh').v === '--');
t('訊號等級 <10 良好、10–30 普通、>30 差', C.signalLevel(5) === 3 && C.signalLevel(10) === 2 && C.signalLevel(30) === 2 && C.signalLevel(31) === 1 && C.signalLevel(null) === 0);
t('中位數', C.median([3, 1, 2]) === 2 && C.median([1, 9]) === 5 && C.median([]) === 0);

// ---- 行程：直線等速 ----
const LAT0 = 25.03, LON0 = 121.53, T0 = Date.UTC(2026, 9, 7, 6, 32);
function drive(T, n, mps, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = (opts.from || 0) + i, p = offset(LAT0, LON0, mps * k, 0);
    out.push(C.addFix(T, { lat: p.lat, lon: p.lon, acc: opts.acc || 5, spd: opts.noSpeed ? null : mps, ele: 30, t: T0 + k * 1000 }));
  }
  return out;
}
{
  const T = C.newTrip(); C.startClock(T, T0); drive(T, 101, 10);
  const st = C.tripStats(T, T0 + 100000);
  t('10 m/s 跑 100 秒：距離 1000 m', near(st.dist, 1000, 1), st.dist);
  t('顯示速度 36.0 km/h', C.fmtSpeed(T.speed, 'kmh') === '36.0');
  t('移動時間 100 秒、經過時間 100 秒', near(st.moving, 100, 0.01) && near(st.elapsed, 100, 0.01), st);
  t('平均 = 距離 ÷ 移動時間 = 10 m/s', near(st.avg, 10, 0.01));
  t('最高速度 10 m/s', near(st.max, 10, 1e-9));
  t('101 個有效點、一段', T.n === 101 && T.segs.length === 1);
}
{
  const T = C.newTrip(); C.startClock(T, T0); drive(T, 61, 5, { noSpeed: true });
  t('沒有 coords.speed 時由位移推算速度：5 m/s', near(T.speed, 5, 0.05), T.speed);
  t('推算模式距離 300 m', near(T.dist, 300, 1), T.dist);
}
{
  // 慢跑 2.5 m/s 無 coords.speed：位移 < 3 m/秒，仍要量得到速度與距離
  const T = C.newTrip(); drive(T, 121, 2.5, { noSpeed: true });
  t('慢跑 2.5 m/s 無裝置速度：速度約 2.5', near(T.speed, 2.5, 0.2), T.speed);
  t('慢跑 120 秒距離 ≈ 300 m（誤差 < 1%）', near(T.dist, 300, 3), T.dist);
}

// ---- 點過濾 ----
{
  const T = C.newTrip(); drive(T, 11, 10);
  const d0 = T.dist, far = offset(LAT0, LON0, 5000, 0);
  const r = C.addFix(T, { lat: far.lat, lon: far.lon, acc: 5, spd: null, t: T0 + 11000 });
  t('1 秒跳 5 km → 視為跳點丟棄', !r.ok && r.reason === 'jump' && T.dist === d0, r);
  const back = drive(T, 5, 10, { from: 11 });
  t('跳點後回到正常路線繼續累加', back.every(x => x.ok) && near(T.dist, 150, 1), T.dist);
  t('最高速度不受跳點影響', T.max <= 10.0001, T.max);
}
{
  const T = C.newTrip({ jumpLimit: 70 }); drive(T, 3, 80);
  t('80 m/s 超過預設上限（252 km/h）→ 丟棄', T.dist === 0 && T.n === 1, T.dist);
  const H = C.newTrip({ jumpLimit: 100 }); drive(H, 11, 80);
  t('高速模式（100 m/s）可記錄 80 m/s 的高鐵', near(H.dist, 800, 1), H.dist);
}
{
  const T = C.newTrip(); drive(T, 11, 10);
  const d0 = T.dist, p = offset(LAT0, LON0, 120, 0);
  const r = C.addFix(T, { lat: p.lat, lon: p.lon, acc: 45, spd: 10, t: T0 + 11000 });
  t('精度 45 m 的點不計入距離（但仍更新目前位置）', r.ok && r.reason === 'inaccurate' && T.dist === d0 && T.cur.acc === 45, r);
  t('精度差的點不刷新最高速度', T.max === 10);
}
{
  const T = C.newTrip(); C.addFix(T, { lat: LAT0, lon: LON0, acc: 5, spd: 0, t: T0 });
  const p = offset(LAT0, LON0, 2, 0); const r = C.addFix(T, { lat: p.lat, lon: p.lon, acc: 5, spd: null, t: T0 + 1000 });
  t('離上一有效點 < 3 m 視為漂移', r.reason === 'drift' && T.dist === 0, r);
  const q = offset(LAT0, LON0, 6, 0); const r2 = C.addFix(T, { lat: q.lat, lon: q.lon, acc: 20, spd: null, t: T0 + 2000 });
  t('精度 20 m 時門檻為 10 m（6 m 仍是漂移）', r2.reason === 'drift' && T.dist === 0, r2);
}
{
  const T = C.newTrip(); C.addFix(T, { lat: LAT0, lon: LON0, acc: 5, spd: 1, t: T0 });
  t('時間戳相同或倒退的點忽略', C.addFix(T, { lat: LAT0, lon: LON0, acc: 5, spd: 1, t: T0 }).reason === 'dup');
  t('座標無效忽略', C.addFix(T, { lat: NaN, lon: LON0, acc: 5, t: T0 + 5 }).reason === 'bad');
}
// 原地靜止 2 分鐘（驗收：距離 < 10 m、速度 0），兩種情境：有 coords.speed 與沒有
for (const withSpeed of [true, false]) {
  const T = C.newTrip(); let n = 0, e = 0;
  for (let i = 0; i <= 120; i++) {
    n = n * 0.85 + gauss() * 1.2; e = e * 0.85 + gauss() * 1.2; // 慢慢游移的 GPS 漂移
    const p = offset(LAT0, LON0, n, e);
    C.addFix(T, { lat: p.lat, lon: p.lon, acc: 6 + rnd() * 6, spd: withSpeed ? Math.abs(gauss()) * 0.15 : null, t: T0 + i * 1000 });
  }
  const st = C.tripStats(T, T0 + 120000);
  t(`靜止 2 分鐘（${withSpeed ? '有' : '無'}裝置速度）距離 < 10 m`, st.dist < 10, st.dist);
  t(`靜止 2 分鐘（${withSpeed ? '有' : '無'}裝置速度）速度顯示 0`, C.fmtSpeed(T.speed, 'kmh') === '0.0', T.speed);
  t(`靜止 2 分鐘（${withSpeed ? '有' : '無'}裝置速度）移動時間 < 15 秒`, st.moving < 15, st.moving);
}
// 單次速度尖峰被 3 點中位數壓掉
{
  const T = C.newTrip(); drive(T, 10, 4);
  const p = offset(LAT0, LON0, 40, 0); C.addFix(T, { lat: p.lat, lon: p.lon, acc: 5, spd: 30, t: T0 + 10000 });
  t('單一讀數 30 m/s 的尖峰：顯示仍約 4 m/s', near(T.speed, 4, 0.01), T.speed);
}

// ---- 移動時間 vs 經過時間、暫停分段 ----
{
  const T = C.newTrip(); C.startClock(T, T0);
  drive(T, 61, 5);                              // 0–60 s 移動 300 m
  for (let i = 61; i <= 120; i++) { const p = offset(LAT0, LON0, 300, 0); C.addFix(T, { lat: p.lat, lon: p.lon, acc: 5, spd: 0, t: T0 + i * 1000 }); } // 61–120 s 停等紅燈
  C.stopClock(T, T0 + 120000); C.breakSeg(T, false);   // 暫停 5 分鐘
  C.startClock(T, T0 + 420000);
  for (let i = 0; i <= 60; i++) { const p = offset(LAT0, LON0, 800 + 5 * i, 0); C.addFix(T, { lat: p.lat, lon: p.lon, acc: 5, spd: 5, t: T0 + 420000 + i * 1000 }); }
  const st = C.tripStats(T, T0 + 480000);
  t('經過時間不含暫停：180 秒', near(st.elapsed, 180, 0.01), st.elapsed);
  t('移動時間只算速度 ≥ 0.5 m/s：約 120 秒', near(st.moving, 120, 2.5), st.moving);
  t('暫停後第一點不和暫停前相連：距離 600 m（不是 1100 m）', near(st.dist, 600, 2), st.dist);
  t('平均速度 = 600 m ÷ 移動時間 ≈ 5 m/s', near(st.avg, 5, 0.15), st.avg);
  t('暫停後開新段', T.segs.length === 2 && T.gaps[1] === false);
  C.breakSeg(T, true); const p = offset(LAT0, LON0, 2000, 0); C.addFix(T, { lat: p.lat, lon: p.lon, acc: 5, spd: 3, t: T0 + 900000 });
  t('背景中斷的段落標記為虛線連接', T.segs.length === 3 && T.gaps[2] === true);
  t('暫停時鐘可重複呼叫', (C.stopClock(T, T0 + 1e6), C.stopClock(T, T0 + 2e6), C.elapsedMs(T, T0 + 3e6)) === C.elapsedMs(T, 0));
}

// ---- 投影、縮放、比例尺、簡化 ----
{
  const pr = C.projector(LAT0, LON0), q = pr(offset(LAT0, LON0, 300, 400));
  t('投影：北 300 m、東 400 m', near(q.x, 400, 0.5) && near(q.y, 300, 0.5), q);
  const v = C.fitView([{ x: 0, y: 0 }, { x: 1000, y: 500 }], 400, 200);
  t('自動縮放保留 10% 邊距', near(v.s, Math.min(400 * 0.8 / 1000, 200 * 0.8 / 500), 1e-9) && v.cx === 500 && v.cy === 250, v);
  t('單點時用最小範圍 60 m', near(C.fitView([{ x: 5, y: 5 }], 300, 300).s, 4, 1e-9));
  const s = C.niceScale(0.5, 100); t('比例尺 1/2/5 × 10ⁿ', s.m === 200 && s.label === '200 m' && s.px === 100, s);
  t('比例尺公里標示', C.niceScale(0.05, 100).label === '2 km');
  const line = []; for (let i = 0; i <= 200; i++) { const p = offset(LAT0, LON0, i * 5, (i % 2) * 0.5); line.push({ ...p, t: i }); }
  const sl = C.simplify(line, 2);
  t('Douglas–Peucker：近似直線 201 點簡化到 2 點', sl.length === 2 && sl[0] === line[0] && sl[1] === line[200], sl.length);
  const zig = []; for (let i = 0; i <= 20; i++) zig.push(offset(LAT0, LON0, i * 10, (i % 2) * 20));
  t('Douglas–Peucker：明顯轉折都保留', C.simplify(zig, 2).length === 21);
}

// ---- GPX ----
{
  const segs = [[{ lat: 25.03, lon: 121.53, ele: 12.34, t: T0, acc: 5, spd: 1 }, { lat: 25.0301, lon: 121.5302, ele: null, t: T0 + 1000 }], [{ lat: 25.031, lon: 121.531, ele: 15, t: T0 + 60000 }]];
  const x = C.buildGpx({ segs, startedAt: T0, name: 'A & B <test>' });
  t('GPX 1.1 標頭', x.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && x.includes('<gpx version="1.1"') && x.includes('xmlns="http://www.topografix.com/GPX/1/1"'));
  t('每段一個 trkseg', (x.match(/<trkseg>/g) || []).length === 2);
  t('時間為 UTC ISO 8601', x.includes('<time>2026-10-07T06:32:00Z</time>'));
  t('名稱跳脫', x.includes('<name>A &amp; B &lt;test&gt;</name>'));
  t('沒有海拔時省略 <ele>', (x.match(/<ele>/g) || []).length === 2 && x.includes('<ele>12.3</ele>'));
  const g = C.parseGpx(x);
  t('GPX 來回：段數、點數、座標、時間', g.segs.length === 2 && g.segs[0].length === 2 && g.segs[1].length === 1 && near(g.segs[0][1].lon, 121.5302, 1e-7) && g.segs[0][0].t === T0 && g.segs[0][0].ele === 12.3 && g.segs[0][1].ele === null, g.segs);
  t('GPX 名稱還原', g.name === 'A & B <test>', g.name);
  const other = `<?xml version="1.0"?><gpx><rte><name>路線</name><rtept lat='25.0' lon='121.0'/><rtept lat="25.01" lon="121.0"></rtept></rte></gpx>`;
  const g2 = C.parseGpx(other); t('只有 rtept（無 trkseg）的 GPX 也能讀', g2.segs.length === 1 && g2.segs[0].length === 2 && g2.name === '路線');
  t('檔名 gps-YYYYMMDD-HHMM.gpx（當地時間）', /^gps-\d{8}-\d{4}\.gpx$/.test(C.gpxFileName(T0)) && C.gpxFileName(new Date(2026, 9, 7, 14, 32).getTime()) === 'gps-20261007-1432.gpx');
  const st = C.segStats([[0, 1, 2, 3].map(i => ({ ...offset(LAT0, LON0, i * 10, 0), t: T0 + i * 2000 })), [{ ...offset(LAT0, LON0, 999, 0), t: T0 + 99000 }, { ...offset(LAT0, LON0, 1009, 0), t: T0 + 104000 }]]);
  t('匯入軌跡的統計：段間不連線', near(st.dist, 40, 0.1) && near(st.elapsed, 11, 0.01) && near(st.moving, 11, 0.01) && near(st.max, 5, 0.01), st);
  const pk = C.unpack(C.pack({ lat: 25.123456789, lon: 121.987654321, ele: 12.345, t: T0, acc: 4.6, spd: 3.14159 }));
  t('儲存格式 pack/unpack', pk.lat === 25.123457 && pk.lon === 121.987654 && pk.ele === 12.3 && pk.acc === 5 && pk.spd === 3.14 && pk.t === T0, pk);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
