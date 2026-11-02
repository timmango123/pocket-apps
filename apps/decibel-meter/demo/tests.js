// Unit tests for 噪音分貝計 (decibel-meter), run against the page's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {DB_BASE,CAL_MIN,CAL_MAX,DB_MIN,DB_MAX,WEIGHT_TAU,BANDS,meanSquare,dbfsFromRms,dbfsFromMs,rawDb,displayDb,fmtDb,clampCal,calibrate,timeWeight,bandIndex,aWeightDb,aWeightRatio,leqOf,createStats,createHistory,createSession,createAlarm,localIso,toCsv,fmtElapsed,analyserReady,validSession,validHist,validStats};')();
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
  t('over 120 shows ">120" (symmetric with "<20")', C.fmtDb(130, 0) === '>120' && C.fmtDb(121, 0, 1) === '>120' && C.fmtDb(91, 30) === '>120');
  t('exactly 120 still shows 120', C.fmtDb(120, 0) === '120' && C.fmtDb(90, 30, 1) === '120.0');
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

// --- history: every second of the measurement is kept (CSV must not silently lose the start) ---
{
  const h = C.createHistory();
  const T0 = 1.7e12;
  for (let i = 0; i < 4000; i++) h.push(T0 + i * 1000, 40 + (i % 10), 50 + (i % 10), i === 3999 ? 1 : (i === 5 ? 2 : 0));
  t('history holds all 4000 points (over an hour), nothing dropped', h.size === 4000 && h.at(0).t === T0 && h.at(3999).t === T0 + 3999000);
  t('marker kept on newest point', h.at(3999).mark === 1 && h.at(5).mark === 2);
  t('since() returns the last 60 s', h.since(T0 + 3940000).length === 60 && h.since(T0 + 3940000)[0].t === T0 + 3940000);
  t('since(0) returns everything', h.since(0).length === 4000);
  const d = h.dump(), h2 = C.createHistory(); h2.push(T0 + 5000000, 70, 75, 0);
  t('dump is valid and compact', C.validHist(d) && JSON.stringify(d).length < 4000 * 16, JSON.stringify(d).length);
  h2.prepend(d);
  t('prepend puts saved points before the current ones', h2.size === 4001 && h2.at(0).t === T0 && h2.at(3999).t === T0 + 3999000 && h2.at(4000).t === T0 + 5000000 && h2.at(4000).avg === 70);
  t('prepend round-trips values and markers', Math.abs(h2.at(1234).avg - h.at(1234).avg) < 0.006 && h2.at(3999).mark === 1 && h2.at(5).mark === 2 && h2.at(6).mark === 0);
  h.clear(); t('clear', h.size === 0 && h.since(0).length === 0);
  t('validHist rejects first times that are not real dates (no NaN in summary / CSV)', !C.validHist({ dt: [1e300], a: [1], m: [1], k: [] }) && !C.validHist({ dt: [0], a: [1], m: [1], k: [] }) && !C.validHist({ dt: [T0, 1e300], a: [1, 1], m: [1, 1], k: [] }) && C.validHist({ dt: [T0, 1000], a: [1, 1], m: [1, 1], k: [] }));
  t('validStats rejects absurd elapsed time', !C.validStats({ n: 1, e: 1, min: 1, max: 1, secs: 1e300 }));
  t('validHist rejects broken data', !C.validHist(null) && !C.validHist({ dt: [1], a: [], m: [], k: [] }) && !C.validHist({ dt: [1], a: ['x'], m: [1], k: [] }) && !C.validHist({ dt: [1], a: [1], m: [1], k: [5, 1] }) && !C.validHist({ dt: [1], a: [1], m: [1], k: [0, 7] }));
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
  // over 30 minutes: history and CSV keep every second, matching the elapsed time
  const M = C.createSession({}); let tm = 0; for (let k = 0; k < 2000 * 20; k++) { tm += 50; M.feed(1e-4, 0.05, tm); }
  t('2000 s of data -> 2000 history points, CSV has them all', M.hist.size >= 1999 && M.hist.size <= 2000 && C.toCsv(M.hist.since(0), 0).trim().split('\r\n').length === M.hist.size + 1 && Math.abs(M.stats.secs - 2000) < 0.1, M.hist.size);
  t('3 h fits in memory as typed arrays', (() => { const H = C.createHistory(); for (let i = 0; i < 10800; i++) H.push(i * 1000, 50, 55); return H.size === 10800 && H.cap < 20000; })());
}

// --- reset undo / autosave restore ---
{
  const S = C.createSession({}); let now = 1e12;
  const feedFor = (raw, secs) => { const ms = msOfDb(raw); for (let k = 0; k < Math.round(secs / 0.05); k++) { now += 50; S.feed(ms, 0.05, now); } };
  feedFor(60, 5); S.mark(1); feedFor(80, 5);
  const before = { n: S.stats.n, leq: S.stats.leq, min: S.stats.min, max: S.stats.max, secs: S.stats.secs, size: S.hist.size };
  const snap = S.dump();
  t('dump is a valid saved session and survives JSON', C.validSession(JSON.parse(JSON.stringify(snap))));
  S.reset(); t('reset empties the session', S.empty);
  t('undo right after reset restores everything', S.restore(JSON.parse(JSON.stringify(snap))) && S.stats.n === before.n && near(S.stats.leq, before.leq, 1e-9) && S.stats.min === before.min && S.stats.max === before.max && near(S.stats.secs, before.secs, 1e-9) && S.hist.size === before.size);
  t('restored history keeps the marker', S.hist.since(0).some(p => p.mark === 1));
  S.reset(); S.interrupt(); feedFor(50, 3);
  t('undo after measuring a bit more merges: old points first, stats combined', S.restore(snap) && S.hist.size === before.size + 3 && S.hist.at(0).t < S.hist.at(before.size).t && near(S.stats.secs, before.secs + 3, 0.01) && near(S.stats.min, 50, 0.01) && near(S.stats.max, 80, 0.01));
  t('Leq after merge is the energy average of all blocks', near(S.stats.leq, 10 * Math.log10((before.n * Math.pow(10, before.leq / 10) + 30 * Math.pow(10, 5)) / (before.n + 30)), 0.02));
  const R = C.createSession({}); t('restore into a fresh session (page reload)', R.restore(JSON.parse(JSON.stringify(snap))) && R.hist.size === before.size && near(R.stats.leq, before.leq, 1e-9));
  const bad = [null, 5, [], {}, { v: 2, stats: snap.stats, hist: snap.hist }, { v: 1, stats: { n: 1, e: 1, min: 'x', max: 1, secs: 1 }, hist: snap.hist }, { v: 1, stats: { n: -1, e: 0, secs: 0 }, hist: snap.hist }, { v: 1, stats: snap.stats, hist: { dt: [1, 2], a: [1], m: [1, 2], k: [] } }];
  t('broken saved sessions are rejected, session untouched', bad.every(d => { const X = C.createSession({}); return X.restore(d) === false && X.empty; }));
  t('empty stats dump has no Infinity (JSON-safe)', JSON.stringify(C.createSession({}).dump()).indexOf('null') > 0 && C.validSession(JSON.parse(JSON.stringify(C.createSession({}).dump()))));
}

// --- warm-up: the analyser buffer starts zero-filled; no statistic may see it ---
{
  const N = 8192, need = N / 48000 + 0.05, full = new Float32Array(N).fill(0.01), half = new Float32Array(N); half.fill(0.01, N / 2);
  t('not ready before a full window of audio', !C.analyserReady(full, need - 0.01, 0.1, need));
  t('not ready while the oldest samples are still the zero fill', !C.analyserReady(half, need + 0.1, 0.4, need));
  t('ready once the window is full of real samples', C.analyserReady(full, need, need, need));
  t('silent microphone (all zeros) still starts after 1.5 s of audio', !C.analyserReady(new Float32Array(N), 1.4, 1.4, need) && C.analyserReady(new Float32Array(N), 1.5, 1.5, need));
  t('audio clock stuck: wall-clock fallback after 3 s, never stuck', C.analyserReady(new Float32Array(N), 0, 3, need));
  // the bug: feeding the partly-filled frames dragged 最小 down to <20 / 3-9 dB low; with the gate the min equals the steady level
  const run = gate => {
    const S = C.createSession({ weighting: 'fast' }); let now = 0;
    for (let r = 0; r < 5; r++) { // start + 4 resumes
      if (r) S.interrupt();
      for (let k = 0; k < 40; k++) {
        now += 50; const audio = k * 0.05, filled = Math.min(1, audio / (N / 48000));
        const buf = new Float32Array(N); for (let i = Math.round(N * (1 - filled)); i < N; i++) buf[i] = i % 2 ? 0.01 : -0.01; // newest samples at the end
        if (gate && !C.analyserReady(buf, audio, audio, need)) continue;
        S.feed(C.meanSquare(buf.subarray(N - 2048)), 0.05, now); // the 2048-point level window: zeros at first
      }
    }
    return S.stats;
  };
  const steady = C.rawDb(1e-4);
  t('resume x4 with the warm-up gate: 最小 equals the steady level', near(run(true).min, steady, 0.05) && near(run(true).leq, steady, 0.05), run(true).min.toFixed(2) + ' vs ' + steady);
  t('(control) without the gate 最小 would read low', run(false).min < steady - 3);
}

// --- A-weighting with the 8192-point spectrum: low tones no longer over-read ---
{
  const spec = (f, N, sr) => { // Blackman-windowed spectrum in dB, like AnalyserNode.getFloatFrequencyData
    const x = new Float64Array(N); for (let i = 0; i < N; i++) x[i] = (0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N)) * Math.sin(2 * Math.PI * f * i / sr + 0.3);
    const out = new Float32Array(N / 2).fill(-300), lim = Math.min(N / 2, Math.ceil(f * N / sr * 2) + 40);
    for (let k = 0; k < lim; k++) { let re = 0, im = 0; const c = 2 * Math.PI * k / N; for (let i = 0; i < N; i++) { re += x[i] * Math.cos(c * i); im -= x[i] * Math.sin(c * i); } const m = Math.hypot(re, im) / N; out[k] = m > 0 ? 20 * Math.log10(m) : -300; }
    return out;
  };
  for (const sr of [48000, 44100]) for (const [f, tol] of [[50, 0.3], [63, 0.2], [100, 0.1], [250, 0.05]]) {
    const err = 10 * Math.log10(C.aWeightRatio(spec(f, 8192, sr), sr, 8192)) - C.aWeightDb(f);
    t(`A-weight ${f} Hz @ ${sr}: error ${err.toFixed(2)} dB within ${tol}`, Math.abs(err) <= tol, err.toFixed(2));
  }
  const html2 = html;
  t('app uses an 8192-point analyser for the A-weighting spectrum', /anF\.fftSize = 8192/.test(html2) && /anF\.getFloatFrequencyData\(spec\)/.test(html2) && /aWeightRatio\(spec, ctx\.sampleRate, anF\.fftSize\)/.test(html2));
}

// --- page wiring (static checks on the markup) ---
{
  t('reset offers 復原 (undo) in its toast', /toast\('已重設統計與曲線', \{ label: '復原'/.test(html));
  t('session autosaved under its own key; settings key unchanged', html.includes("'decibel-meter.session.v1'") && html.includes("const KEY = 'decibel-meter.v1'"));
  t('idle card offers 還原上次測量', html.includes('data-act="restore">還原上次測量'));
  t('warm-up gate in tick()', /if \(!analyserReady\(bufF,/.test(html));
  t('legend explains the dashed alarm line; hint for drag / double tap', html.includes('</i>警示門檻</span>') && html.includes('拖曳曲線看數值・點兩下切換範圍'));
  t('controls come right after the readout on phones', /\.lcd \{ order: 1; \} #card \{ order: 2; \} \.ctrl \{ order: 3; \} \.chart-card \{ order: 4; \}/.test(html));
  t('needle stops above the scale numbers', /\.bar \.ind, \.bar \.mx \{ position: absolute; top: -6px; bottom: -3px;/.test(html) && /margin: 14px 0 7px/.test(html));
}

// --- resume: 最小 / 最大 wait three time constants while the weighting settles; Leq and time count everything ---
{
  const S = C.createSession({ weighting: 'fast' }); let now = 1.7e12;
  for (let k = 0; k < 40; k++) { now += 50; S.feed(msOfDb(71), 0.05, now); }
  const n0 = S.stats.n; S.interrupt(); now += 5000;
  now += 50; S.feed(msOfDb(70.4), 0.05, now); now += 50; S.feed(msOfDb(70.9), 0.05, now); // dip right after resuming
  for (let k = 0; k < 40; k++) { now += 50; S.feed(msOfDb(71), 0.05, now); }
  t('after resume 最小 stays at the steady level (no 0.3 dB dip)', S.stats.n === n0 + 21 && S.stats.min > 70.95, S.stats.min);
  const L = C.createSession({ weighting: 'slow' }); let tl = 1.7e12; for (let k = 0; k < 60; k++) { tl += 50; L.feed(msOfDb(71), 0.05, tl); }
  L.interrupt(); tl += 5000; L.feed(msOfDb(60), 0.05, tl += 50); for (let k = 0; k < 80; k++) { tl += 50; L.feed(msOfDb(71), 0.05, tl); }
  t('slow weighting: 3 s settle after resume, a start-up dip does not reach 最小', L.stats.n === 70 && L.stats.min > 70.7, L.stats.min);
  const E = C.createSession({}); E.interrupt(); E.feed(msOfDb(60), 0.05, 1.7e12);  E.feed(msOfDb(60), 0.05, 1.7e12 + 50);
  t('a block that only counts for Leq leaves 最小 / 最大 empty, never Infinity', E.stats.n === 1 && E.stats.min === null && E.stats.max === null && C.validSession(JSON.parse(JSON.stringify(E.dump()))));
  const F = C.createSession({}); for (let k = 0; k < 4; k++) F.feed(msOfDb(60), 0.05, 1.7e12 + k * 50);
  t('first start is not affected (min/max from the first block)', F.stats.n === 2 && near(F.stats.min, 60, 0.01));
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
  t('CSV writes <20 below range and the real value above 120 (not 120.0), names markers', csv[2].endsWith(',<20,130.0,標記') && C.toCsv([{ t: pts[0].t, avg: 95, max: 101, mark: 0 }], 25).includes(',120.0,126.0,') && csv[3].endsWith(',中斷後繼續'), csv[2]);
  t('CSV applies calibration', C.toCsv(pts.slice(0, 1), 10).includes(',65.0,72.0,'));
  t('fmtElapsed', C.fmtElapsed(0) === '0:00' && C.fmtElapsed(65.9) === '1:05' && C.fmtElapsed(3725) === '1:02:05');
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
