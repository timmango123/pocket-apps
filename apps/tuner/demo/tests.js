// Unit tests for 調音器 (tuner), run against the page's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {NOTE_NAMES,INSTRUMENTS,A4_MIN,A4_MAX,midiToFreq,centsOff,noteName,freqToNote,nearestString,rmsOf,yin,detectPitch,median,createTracker,centsToAngle,clampA4};')();
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? extra : ''); } }

// deterministic noise
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function tone(f, sr, n = 4096, harm = [1], amp = 0.3, phase = 0.4) {
  const b = new Float32Array(n), norm = harm.reduce((a, x) => a + Math.abs(x), 0);
  for (let i = 0; i < n; i++) { let s = 0; harm.forEach((h, k) => { s += h * Math.sin(2 * Math.PI * f * (k + 1) * i / sr + phase * (k + 1)); }); b[i] = amp * s / norm; }
  return b;
}
// plucked-string-like spectrum: strong 2nd/3rd harmonics, weak fundamental
const GUITAR = [0.6, 1.0, 0.8, 0.5, 0.35, 0.25, 0.15, 0.1];
const cents = (a, b) => 1200 * Math.log2(a / b);

// --- note mapping ---
let n = C.freqToNote(440);
t('440 Hz -> A4 +0', n.label === 'A4' && Math.abs(n.cents) < 1e-9 && n.nearest === 69);
n = C.freqToNote(82.41);
t('82.41 Hz -> E2 within 0.1 cent', n.label === 'E2' && Math.abs(n.cents) < 0.1, n.cents);
n = C.freqToNote(261.63);
t('261.63 Hz -> C4', n.label === 'C4' && n.name === 'C' && n.octave === 4);
n = C.freqToNote(466.16);
t('466.16 Hz -> A#4', n.label === 'A#4' && n.name === 'A#');
n = C.freqToNote(440 * Math.pow(2, 30 / 1200));
t('A4 +30 cents', n.label === 'A4' && Math.abs(n.cents - 30) < 1e-6);
n = C.freqToNote(440 * Math.pow(2, -49 / 1200));
t('A4 -49 cents stays A4', n.label === 'A4' && Math.abs(n.cents + 49) < 1e-6);
n = C.freqToNote(440 * Math.pow(2, 51 / 1200));
t('A4 +51 cents rounds to A#4 -49', n.label === 'A#4' && Math.abs(n.cents + 49) < 1e-6);
n = C.freqToNote(41.2);
t('41.20 Hz -> E1 (bass)', n.label === 'E1');
n = C.freqToNote(130.81);
t('C3 octave boundary', n.label === 'C3');
n = C.freqToNote(123.47);
t('B2 octave boundary', n.label === 'B2');
// A4 calibration
n = C.freqToNote(442, 442);
t('A4=442: 442 Hz is A4 +0', n.label === 'A4' && Math.abs(n.cents) < 1e-9);
n = C.freqToNote(440, 442);
t('A4=442: 440 Hz is A4 -7.85 cents', n.label === 'A4' && Math.abs(n.cents + 7.85) < 0.02, n.cents);
t('A4=432: E2 string = 80.91 Hz', Math.abs(C.midiToFreq(40, 432) - 80.91) < 0.01, C.midiToFreq(40, 432));
t('clampA4 430..450', C.clampA4(400) === 430 && C.clampA4(460) === 450 && C.clampA4(441.4) === 441);

// --- string tables (spec frequencies) ---
const table = { guitar: [82.41, 110.00, 146.83, 196.00, 246.94, 329.63], ukulele: [392.00, 261.63, 329.63, 440.00], violin: [196.00, 293.66, 440.00, 659.26], bass: [41.20, 55.00, 73.42, 98.00] };
for (const [k, fs_] of Object.entries(table)) {
  const got = C.INSTRUMENTS[k].strings.map(m => C.midiToFreq(m));
  t(k + ' string table matches spec', got.length === fs_.length && got.every((f, i) => Math.abs(f - fs_[i]) < 0.01), got.map(f => f.toFixed(2)).join(','));
}
const G = C.INSTRUMENTS.guitar.strings;
let s = C.nearestString(84, G);
t('84 Hz -> guitar E2 string, about +33 cents', s.index === 0 && Math.abs(s.cents - cents(84, 82.4069)) < 1e-3);
s = C.nearestString(100, G);
t('100 Hz -> nearer A2 than E2 by cents', s.index === 1);
s = C.nearestString(250, G);
t('250 Hz -> B3 string', s.index === 4);
s = C.nearestString(318, C.INSTRUMENTS.ukulele.strings);
t('ukulele 318 Hz -> E4 string', s.midi === 64);
s = C.nearestString(83.2, G, 444);
t('A4=444 shifts strings: E2 = 83.16', Math.abs(s.freq - 83.158) < 0.01 && Math.abs(s.cents) < 1);

// --- YIN on synthetic buffers ---
for (const sr of [48000, 44100]) {
  for (const [label, f] of [['E2', 82.41], ['A2', 110], ['D3', 146.83], ['G3', 196], ['B3', 246.94], ['E4', 329.63], ['A4', 440], ['E5', 659.26], ['C6', 1046.5]]) {
    const r = C.detectPitch(tone(f, sr), sr, { minF: 40 });
    t(`sine ${label} ${f} Hz @${sr}: ok within 1 cent`, r.status === 'ok' && Math.abs(cents(r.freq, f)) < 1, r.freq);
    const h = C.detectPitch(tone(f, sr, 4096, GUITAR), sr, { minF: 40 });
    t(`harmonic-rich ${label} @${sr}: no octave error, within 2 cents`, h.status === 'ok' && Math.abs(cents(h.freq, f)) < 2, h.freq);
  }
}
{
  const r = C.detectPitch(tone(440, 48000), 48000, { minF: 60 });
  t('440 Hz reads 439.5..440.5 Hz (spec step 3)', r.freq > 439.5 && r.freq < 440.5, r.freq);
  const e = C.detectPitch(tone(82.41, 48000, 4096, GUITAR), 48000, { minF: 60 });
  t('E2 82.41 Hz guitar-like: reads E2 within ±2 cents', C.freqToNote(e.freq).label === 'E2' && Math.abs(C.freqToNote(e.freq).cents) < 2, e.freq);
}
// bass: low E1 needs the 30 Hz floor
{
  const r = C.detectPitch(tone(41.2, 48000, 4096, [1, 0.7, 0.4]), 48000, { minF: 30 });
  t('bass E1 41.2 Hz detected with minF 30', r.status === 'ok' && Math.abs(cents(r.freq, 41.2)) < 2, r.freq);
}
// detuned strings
for (const c of [-40, -12, -3, 3, 12, 40]) {
  const f = 110 * Math.pow(2, c / 1200);
  const r = C.detectPitch(tone(f, 48000, 4096, GUITAR), 48000, { minF: 60 });
  const ns = C.nearestString(r.freq, G);
  t(`A2 detuned ${c} cents reads ${c} ±1.5`, ns.index === 1 && Math.abs(ns.cents - c) < 1.5, ns.cents);
}
// with some noise on top
{
  const b = tone(196, 48000, 4096, GUITAR, 0.3); for (let i = 0; i < b.length; i++) b[i] += (rnd() - 0.5) * 0.04;
  const r = C.detectPitch(b, 48000, { minF: 60 });
  t('G3 with light noise still within 3 cents', r.status === 'ok' && Math.abs(cents(r.freq, 196)) < 3, r.freq);
}
// rejection
{
  t('silence -> silent', C.detectPitch(new Float32Array(4096), 48000).status === 'silent');
  t('very quiet tone (rms < 0.01) -> silent', C.detectPitch(tone(440, 48000, 4096, [1], 0.01), 48000).status === 'silent');
  let unsure = 0;
  for (let k = 0; k < 10; k++) { const b = new Float32Array(4096); for (let i = 0; i < b.length; i++) b[i] = (rnd() - 0.5) * 0.5; if (C.detectPitch(b, 48000, { minF: 40 }).status !== 'ok') unsure++; }
  t('white noise rejected 10/10', unsure === 10, unsure);
  const r = C.detectPitch(tone(3000, 48000), 48000, { minF: 40, maxF: 2000 });
  t('3 kHz tone outside 30..2000 Hz is not reported', r.status !== 'ok' || r.freq <= 2000, r);
}
// timing (spec: ~2 ms per frame on a phone; just guard against pathological slowness here)
{
  const b = tone(82.41, 48000, 4096, GUITAR), t0 = process.hrtime.bigint();
  for (let k = 0; k < 50; k++) C.detectPitch(b, 48000, { minF: 30 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 50;
  t('YIN frame (minF 30, 4096 buffer) under 15 ms in node', ms < 15, ms.toFixed(2) + ' ms');
}

// --- smoothing + octave guard ---
t('median odd/even', C.median([5, 1, 3]) === 3 && C.median([4, 1, 3, 2]) === 2.5);
{
  const tr = C.createTracker(5);
  [110, 110.2, 109.9, 110.1, 110].forEach(f => tr.push(f));
  t('tracker median of last 5', Math.abs(tr.value - 110) < 1e-9);
  const v = tr.push(220.1);
  t('single octave-up jump ignored', Math.abs(v - 110) < 0.2, v);
  const v2 = tr.push(110.05);
  t('back to normal after one-off octave', Math.abs(v2 - 110.05) < 0.2, v2);
  tr.push(55); t('single octave-down jump ignored', Math.abs(tr.value - 110.05) < 0.2);
  tr.push(220); const v3 = tr.push(220.2);
  t('octave confirmed twice is accepted (new note)', Math.abs(v3 - 220.2) < 0.3, v3);
  const tr2 = C.createTracker(5);
  [110, 110, 110, 146.8, 146.8].forEach(f => tr2.push(f));
  t('new note takes over after 3 of 5 readings', tr2.push(146.8) === 146.8);
  const tr3 = C.createTracker(5); [110, 110, 111.5, 110, 110].forEach(f => tr3.push(f));
  t('one outlier does not move the median', tr3.value === 110);
  tr3.reset(); t('reset clears', tr3.value === null);
}
// needle mapping
t('needle: 0 -> 0deg, +50 -> 60deg, -50 -> -60deg', C.centsToAngle(0) === 0 && C.centsToAngle(50) === 60 && C.centsToAngle(-50) === -60);
t('needle clamps past the ends', C.centsToAngle(300) === 66 && C.centsToAngle(-300) === -66);

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
