// Unit tests for 噪音分貝計 (decibel-meter), run against the page's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {DB_BASE,CAL_MIN,CAL_MAX,DB_MIN,DB_MAX,WEIGHT_TAU,BANDS,meanSquare,dbfsFromRms,dbfsFromMs,rawDb,displayDb,fmtDb,clampCal,calibrate,timeWeight,bandIndex,aWeightDb,aWeightRatio,leqOf,createStats,createHistory,createSession,createAlarm,localIso,toCsv,fmtElapsed};')();
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? extra : ''); } }
const near = (a, b, e) => Math.abs(a - b) <= e;
const sine = (f, amp, n = 2048, sr = 48000, dc = 0) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = dc + amp * Math.sin(2 * Math.PI * f * i / sr); return b; };
const msOfDb = raw => Math.pow(10, (raw - 94) / 10); // mean square that reads `raw` dB before calibration

// --- RMS -> dB ---
{
  const ms = C.meanSquare(sine(1500, 1, 4800));
  t('full-scale sine mean square = 0.5', near(ms, 0.5, 1e-3), ms);
  t('full-scale sine = -3.01 dBFS', near(C.dbfsFromMs(ms), -3.01, 0.01));
  t('full-scale sine reads 90.99 dB (offset 94)', near(C.rawDb(ms), 90.99, 0.02));
  t('DC offset removed before RMS', near(C.meanSquare(sine(1500, 0.1, 4800, 48000, 0.3)), 0.005, 1e-5));
  t('rms 0.01 -> -40 dBFS -> 54 dB', near(C.dbfsFromRms(0.01), -40, 1e-9) && near(C.rawDb(1e-4), 54, 1e-9));
  t('rms 1 -> 0 dBFS -> 94 dB', C.rawDb(1) === 94);
  t('silence: dBFS is -Infinity, raw floors at 0', C.dbfsFromRms(0) === -Infinity && C.rawDb(0) === 0);
  t('silence displays "<20", never NaN', C.fmtDb(C.rawDb(0), 0) === '<20' && C.fmtDb(null, 0) === '--' && C.fmtDb(NaN, 0) === '--');
  t('display clamps to 20..120', C.displayDb(5, 0) === 20 && C.displayDb(140, 0) === 120 && C.displayDb(60, 0) === 60);
  t('fmtDb 1 decimal', C.fmtDb(63.27, 0, 1) === '63.3' && C.fmtDb(63.27, 0) === '63');
  t('loud clip shows 120', C.fmtDb(130, 0) === '120');
}

// --- calibration ---
{
  t('calibrate: reads 64, meter says 60 -> offset -4', C.calibrate(64, 60, 0) === -4);
  t('calibrate relative to an existing offset', C.calibrate(64, 70, 2) === 6); // shown 66, want 70 -> offset 2 + 4
  t('calibration clamps to ±30', C.calibrate(40, 100, 0) === 30 && C.calibrate(100, 40, 0) === -30);
  t('clampCal rounds to 0.1', C.clampCal(3.14159) === 3.1);
  let ok = true;
  for (const raw of [25, 40, 55.5, 70, 88, 99]) if (!near(C.displayDb(raw, 10) - C.displayDb(raw, 0), 10, 1e-9)) ok = false;
  t('calibration +10 shifts every reading in range by exactly 10', ok);
}

// --- time weighting ---
{
  t('timeWeight starts from the first value', C.timeWeight(null, 5, 0.05, 0.125) === 5);
  // step from 40 dB to 80 dB in 50 ms frames
  const run = (tau, secs) => { let w = msOfDb(40); for (let k = 0; k < Math.round(secs / 0.05); k++) w = C.timeWeight(w, msOfDb(80), 0.05, tau); return C.rawDb(w); };
  const oneTau = (tau) => { let w = 0; const n = Math.round(tau / 0.005); for (let k = 0; k < n; k++) w = C.timeWeight(w, 1, 0.005, tau); return w; };
  t('fast: 63.2% of a power step after 125 ms', near(oneTau(0.125), 1 - Math.exp(-1), 1e-6), oneTau(0.125));
  t('slow: 63.2% of a power step after 1 s', near(oneTau(1), 1 - Math.exp(-1), 1e-6));
  t('fast settles within 0.1 dB after 1 s', near(run(0.125, 1), 80, 0.1), run(0.125, 1));
  t('slow still rising after 0.5 s (< 78.5)', run(1, 0.5) < 78.5 && run(1, 0.5) > 70, run(1, 0.5));
  t('slow settles within 0.5 dB after 5 s', near(run(1, 5), 80, 0.5));
  // same result regardless of frame rate
  let a = 0, b = 0; for (let k = 0; k < 10; k++) a = C.timeWeight(a, 1, 0.05, 0.125); for (let k = 0; k < 5; k++) b = C.timeWeight(b, 1, 0.1, 0.125);
  t('time weighting independent of frame size', near(a, b, 1e-12));
}

// --- bands ---
{
  const cases = [[10, 0], [29.9, 0], [30, 1], [49.9, 1], [50, 2], [69.9, 2], [70, 3], [84.9, 3], [85, 4], [99.9, 4], [100, 5], [120, 5]];
  t('band thresholds 30/50/70/85/100', cases.every(([d, i]) => C.bandIndex(d) === i), cases.map(([d]) => C.bandIndex(d)).join(','));
  t('band names', C.BANDS.map(b => b.name).join() === '極安靜,安靜,一般,吵雜,很吵,危險');
  t('band examples', C.BANDS[0].eg === '耳語' && C.BANDS[1].eg === '圖書館' && C.BANDS[2].eg === '交談' && C.BANDS[3].eg === '車流' && C.BANDS[4].eg === '傷耳風險');
}

// --- A weighting ---
{
  const ref = [[1000, 0], [100, -19.1], [31.5, -39.4], [63, -26.2], [250, -8.6], [500, -3.2], [2000, 1.2], [4000, 1.0], [8000, -1.1], [10000, -2.5], [20, -50.5]];
  for (const [f, a] of ref) t(`A-weight ${f} Hz = ${a} dB`, near(C.aWeightDb(f), a, 0.15), C.aWeightDb(f).toFixed(2));
  const N = 2048, sr = 48000, spec = new Float32Array(N / 2).fill(-Infinity);
  const k1 = Math.round(1000 * N / sr); spec[k1] = -20;
  t('A-weighted ratio for a 1 kHz spectrum ≈ 0 dB', near(10 * Math.log10(C.aWeightRatio(spec, sr, N)), C.aWeightDb(k1 * sr / N), 1e-6));
  spec.fill(-Infinity); const k2 = Math.round(100 * N / sr); spec[k2] = -20;
  t('A-weighted ratio for a 100 Hz spectrum ≈ -19 dB', near(10 * Math.log10(C.aWeightRatio(spec, sr, N)), C.aWeightDb(k2 * sr / N), 1e-6) && near(10 * Math.log10(C.aWeightRatio(spec, sr, N)), -19.5, 1.5));
  spec.fill(-200); spec[0] = 0; spec[k1] = -20;
  t('DC bin ignored by A-weighting', near(10 * Math.log10(C.aWeightRatio(spec, sr, N)), C.aWeightDb(k1 * sr / N), 0.01));
  t('empty spectrum -> ratio 1', C.aWeightRatio(new Float32Array(1024).fill(-Infinity), sr, N) === 1);
}

// --- Leq + stats ---
{
  t('Leq of equal levels', near(C.leqOf([60, 60, 60]), 60, 1e-9));
  t('Leq of 60 and 70 = 67.4 (energy average, not 65)', near(C.leqOf([60, 70]), 67.4, 0.01), C.leqOf([60, 70]));
  t('Leq of 50 and 80 = 77.0', near(C.leqOf([50, 80]), 76.99, 0.01));
  t('Leq of nothing is null', C.leqOf([]) === null);
  const s = C.createStats();
  t('empty stats are null (no NaN)', s.min === null && s.max === null && s.leq === null && s.secs === 0);
  [[60, 61], [70, 69], [50, 52]].forEach(([b, l]) => s.add(b, l, 0.1));
  t('stats min/max of level', s.min === 52 && s.max === 69);
  t('stats leq of blocks', near(s.leq, C.leqOf([60, 70, 50]), 1e-9));
  t('stats elapsed', near(s.secs, 0.3, 1e-9));
  s.reset(); t('stats reset', s.n === 0 && s.leq === null);
}

// --- ring buffer ---
{
  const h = C.createHistory(1800);
  for (let i = 0; i < 2000; i++) h.push(i * 1000, 40 + (i % 10), 50 + (i % 10), i === 1999 ? 1 : 0);
  t('ring buffer holds 1800 points after 2000 s', h.size === 1800);
  t('oldest point is second 200 (overwritten)', h.at(0).t === 200000 && h.at(1799).t === 1999000);
  t('marker kept on newest point', h.at(1799).mark === 1);
  t('since() returns the last 60 s', h.since(1940000).length === 60);
  t('fixed memory: arrays stay 1800 long', h.arrays.t.length === 1800 && h.arrays.avg.length === 1800 && h.arrays.max.length === 1800);
  h.clear(); t('clear', h.size === 0 && h.since(0).length === 0);
}

// --- session: 100 ms blocks, 1 s points, weighting, marker, interruption ---
{
  const S = C.createSession({ weighting: 'fast' });
  let now = 1e12;
  const feedFor = (raw, secs) => { const ms = msOfDb(raw); for (let k = 0; k < Math.round(secs / 0.05); k++) { now += 50; S.feed(ms, 0.05, now); } };
  feedFor(60, 5);
  t('5 s at 60 dB -> 5 history points', S.hist.size === 5, S.hist.size);
  t('history avg = 60', near(S.hist.at(4).avg, 60, 0.01));
  t('stats: 50 blocks of 100 ms', S.stats.n === 50, S.stats.n);
  t('Leq = 60, elapsed 5 s', near(S.stats.leq, 60, 0.01) && near(S.stats.secs, 5, 0.01));
  feedFor(80, 5);
  t('Leq of 5 s at 60 + 5 s at 80 = 77.0', near(S.stats.leq, C.leqOf([60, 80]), 0.05), S.stats.leq);
  t('max 80, min 60', near(S.stats.max, 80, 0.01) && near(S.stats.min, 60, 0.01));
  t('level follows the fast weighting', near(S.level, 80, 0.01));
  S.mark(1); feedFor(80, 1);
  t('marker lands on the next 1 s point', S.hist.at(S.hist.size - 1).mark === 1);
  S.interrupt(); now += 30000; feedFor(50, 2);
  const last2 = S.hist.since(0).slice(-2);
  t('interruption: first point after a pause is flagged, gap in time', last2[0].mark === 2 && last2[1].mark === 0 && last2[0].t - S.hist.at(S.hist.size - 3).t > 30000);
  t('interruption keeps stats', S.stats.n > 100);
  S.reset(); t('reset clears stats and history', S.hist.size === 0 && S.stats.n === 0 && S.level === null);
  // slow weighting reacts slower to a clap
  const F = C.createSession({ weighting: 'fast' }), L = C.createSession({ weighting: 'slow' });
  let tt = 0; for (let k = 0; k < 40; k++) { tt += 50; F.feed(msOfDb(40), 0.05, tt); L.feed(msOfDb(40), 0.05, tt); }
  for (let k = 0; k < 2; k++) { tt += 50; F.feed(msOfDb(90), 0.05, tt); L.feed(msOfDb(90), 0.05, tt); }
  t('100 ms clap: fast peaks higher than slow', F.level > L.level + 5, F.level.toFixed(1) + ' vs ' + L.level.toFixed(1));
  t('100 ms clap: fast reads > 85, slow < 82', F.level > 85 && L.level < 82);
  // 30 minutes keeps memory bounded
  const M = C.createSession({}); let tm = 0; for (let k = 0; k < 2000 * 20; k++) { tm += 50; M.feed(1e-4, 0.05, tm); }
  t('2000 s of data -> ring buffer capped at 1800', M.hist.size === 1800);
}

// --- alarm ---
{
  const A = C.createAlarm(3); let fired = 0, now = 0;
  const run = (db, secs) => { for (let k = 0; k < secs * 10; k++) { now += 100; if (A.update(db, 85, now)) fired++; } };
  run(84, 10); t('below threshold never fires', fired === 0);
  run(86, 2.8); t('2.8 s over does not fire', fired === 0);
  run(80, 1); run(86, 3.1); t('3 s over fires once', fired === 1);
  run(90, 10); t('stays quiet while still over', fired === 1);
  run(70, 0.5); run(88, 3.1); t('re-arms after dropping below', fired === 2);
}

// --- CSV + formatting ---
{
  const pts = [{ t: Date.UTC(2026, 9, 15, 6, 30, 5), avg: 55.04, max: 61.96, mark: 0 }, { t: Date.UTC(2026, 9, 15, 6, 30, 6), avg: 10, max: 130, mark: 1 }, { t: Date.UTC(2026, 9, 15, 6, 31, 0), avg: 50, max: 52, mark: 2 }];
  const csv = C.toCsv(pts, 0).trim().split('\r\n');
  t('CSV header', csv[0] === 'time,avg_db,max_db,marker');
  const [tm, avg, mx, mk] = csv[1].split(',');
  t('CSV time is a local ISO string with offset', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(tm) && new Date(tm).getTime() === pts[0].t, tm);
  t('CSV values 1 decimal', avg === '55.0' && mx === '62.0' && mk === '');
  t('CSV clamps to 20..120 and names markers', csv[2].endsWith(',20.0,120.0,標記') && csv[3].endsWith(',中斷後繼續'), csv[2]);
  t('CSV applies calibration', C.toCsv(pts.slice(0, 1), 10).includes(',65.0,72.0,'));
  t('fmtElapsed', C.fmtElapsed(0) === '0:00' && C.fmtElapsed(65.9) === '1:05' && C.fmtElapsed(3725) === '1:02:05');
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
