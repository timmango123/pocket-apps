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

// --- release r1 regressions (core) ---
// tones above maxF are not reported (they used to read an octave low: 2600 Hz -> E6 1300 Hz)
for (const sr of [44100, 48000]) for (const f of [2100, 2600, 3500]) {
  const r = C.detectPitch(tone(f, sr), sr, { minF: 40, maxF: 2000 });
  t(`${f} Hz @${sr} above the 2000 Hz limit gives no reading`, r.status !== 'ok', r);
}
for (const sr of [44100, 48000]) for (const f of [1900, 1500]) {
  const r = C.detectPitch(tone(f, sr), sr, { minF: 40, maxF: 2000 });
  t(`${f} Hz @${sr} just under the limit still reads`, r.status === 'ok' && Math.abs(cents(r.freq, f)) < 1, r.freq);
}
// broadband noise at 10 dB SNR no longer pulls low strings sharp (was E2 +8 ¢, E1 +16 ¢), and the noise is measurable
{
  let sd = 7; const rn = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const gauss = () => { let x = 0; for (let i = 0; i < 12; i++) x += rn(); return x - 6; };
  const H = [0.3, 1, 0.8, 0.5, 0.35, 0.25, 0.15, 0.1];
  for (const sr of [44100, 48000]) for (const [m, minF] of [[40, 60], [45, 60], [28, 30], [33, 30]]) {
    const f = C.midiToFreq(m); const errs = [], confs = [];
    for (let k = 0; k < 12; k++) {
      const b = new Float32Array(4096);
      for (let i = 0; i < 4096; i++) { let x = 0; H.forEach((h, j) => x += h * Math.sin(2 * Math.PI * f * (j + 1) * (i + k * 800) / sr + 0.7 * j)); b[i] = 0.05 * x; }
      const nsd = C.rmsOf(b) / Math.pow(10, 10 / 20);
      for (let i = 0; i < 4096; i++) b[i] += nsd * gauss();
      const r = C.detectPitch(b, sr, { minF, maxF: 2000 });
      if (r.status === 'ok') { errs.push(cents(r.freq, f)); confs.push(r.conf); }
    }
    errs.sort((a, b) => a - b); confs.sort((a, b) => a - b);
    const med = errs[errs.length >> 1];
    t(`${C.noteName(m)} @${sr} 10 dB SNR: median within 2 ¢, worst within 3 ¢`, errs.length >= 10 && Math.abs(med) < 2 && Math.abs(errs[0]) < 3 && Math.abs(errs[errs.length - 1]) < 3, errs.map(e => e.toFixed(1)).join(','));
    t(`${C.noteName(m)} @${sr} 10 dB SNR: dip depth below the 0.92 noise flag`, confs[confs.length >> 1] < 0.92, confs[confs.length >> 1]);
  }
  const clean = C.detectPitch(tone(82.41, 48000, 4096, GUITAR), 48000, { minF: 60 });
  t('clean E2: dip depth well above the noise flag', clean.conf > 0.95, clean.conf);
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} unit checks passed, ${fail} failed`);
browserTests().then(() => {
  console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, e => { console.log('FAIL browser run', e && e.stack || e); process.exit(1); });

// ---------------- browser regressions (real CDP touch, fake microphone) ----------------
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const http = require('http');
  const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + html + '\n</body></html>';
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const W = ms => new Promise(r => setTimeout(r, ms));
  // Fake microphone: an oscillator (plus optional noise) in its own AudioContext, returned by getUserMedia.
  const FAKE = () => {
    window.__fake = { mode: 'grant', oscs: [] };
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.__fake.mode !== 'grant') { const e = new Error(window.__fake.mode); e.name = window.__fake.mode; throw e; }
      const ac = new AudioContext(), dst = ac.createMediaStreamDestination(), g = ac.createGain();
      g.gain.value = 0; g.connect(dst);
      window.__fake.set = (f, amp = 0.3) => {
        window.__fake.oscs.forEach(o => { try { o.stop(); } catch (e) {} }); window.__fake.oscs = [];
        if (!f) { g.gain.value = 0; return; }
        const o = ac.createOscillator(); o.frequency.value = f; o.connect(g); o.start(); window.__fake.oscs.push(o); g.gain.value = amp;
      };
      window.__fake.freq = f => { window.__fake.oscs[0].frequency.value = f; };
      window.__fake.noise = amp => {
        const n = ac.createBufferSource(), b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const ng = ac.createGain(); ng.gain.value = amp; n.buffer = b; n.loop = true; n.connect(ng).connect(dst); n.start(); window.__fake.oscs.push(n);
      };
      return dst.stream;
    };
  };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function open(w = 390, h = 844, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(w + 'x' + h + ' console ' + m.text()); });
    p.on('pageerror', e => errors.push(w + 'x' + h + ' pageerror ' + e.message));
    await p.addInitScript(FAKE);
    if (init) await p.addInitScript(init[0], init[1]);
    await p.goto(URL); await p.waitForFunction(() => window.__tuner);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id || 1, radiusX: 1, radiusY: 1 })) });
    const center = s => p.evaluate(s => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, s);
    const tap = async (s, hold = 40) => { const c = await center(s); await T('touchStart', [c]); await W(hold); await T('touchEnd', [c]); };
    return { ctx, p, T, center, tap };
  }
  const st = p => p.evaluate(() => ({ a4: __tuner.S.a4, inst: __tuner.S.instrument, lock: __tuner.S.lockedString, theme: __tuner.S.theme, ref: document.getElementById('refBtn').classList.contains('on'), card: __tuner.cardState, panel: !document.getElementById('a4Panel').hidden }));
  const until = (p, fn, arg, ms = 4000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

  // 1. [veto] touch: resting finger, overlapping taps, detail-0 replay, long press
  {
    const { ctx, p, T, center, tap } = await open();
    await tap('#a4Btn'); t('A4 button opens the panel on tap', await until(p, () => !document.getElementById('a4Panel').hidden));
    await W(850);
    const REST = [370, 830, 9];
    const rest = async (sel, n) => {
      const b0 = await st(p); const c = await center(sel);
      await T('touchStart', [REST]); await W(150);
      for (let i = 0; i < n; i++) { await T('touchStart', [REST, [c[0], c[1], 1]]); await W(50); await T('touchEnd', [[c[0], c[1], 1]]); await W(120); }
      const b1 = await st(p);
      await T('touchEnd', [REST]); await W(850);
      return [b0, b1];
    };
    let [a, b] = await rest('#a4Up', 5); t('finger resting at (370,830): 5 taps on A4 + change A4 5 times', b.a4 - a.a4 === 5, b.a4 - a.a4);
    [a, b] = await rest('#srow [data-i="1"]', 1); t('finger resting: tap on a string locks it', a.lock === null && b.lock === 1, [a.lock, b.lock]);
    [a, b] = await rest('#inst [data-k="violin"]', 1); t('finger resting: tap on an instrument switches it', b.inst === 'violin', b.inst);
    [a, b] = await rest('#themeBtn', 1); t('finger resting: tap on theme cycles it', a.theme !== b.theme, [a.theme, b.theme]);
    [a, b] = await rest('#refBtn', 1); t('finger resting: tap on reference tone plays it', !a.ref && b.ref, [a.ref, b.ref]);
    await tap('#refBtn'); await W(850);
    [a, b] = await rest('.go', 1); t('finger resting: tap on start starts tuning', a.card === 'idle' && b.card !== 'idle', [a.card, b.card]);
    await until(p, () => __tuner.running);
    await tap('[data-act="stop"]'); await until(p, () => !__tuner.running); await W(850);
    // overlapping taps: finger 2 lands 50 ms after finger 1, either lifts first -> both act
    for (const firstUp of [1, 2]) {
      const b0 = await st(p), c1 = await center('#a4Down'), c2 = await center(b0.inst === 'bass' ? '#inst [data-k="guitar"]' : '#inst [data-k="bass"]');
      const p1 = [c1[0], c1[1], 1], p2 = [c2[0], c2[1], 2];
      await T('touchStart', [p1]); await W(50); await T('touchStart', [p1, p2]); await W(60);
      if (firstUp === 1) { await T('touchEnd', [p1]); await W(30); await T('touchEnd', [p2]); } else { await T('touchEnd', [p2]); await W(30); await T('touchEnd', [p1]); }
      await W(850); const b1 = await st(p);
      t(`overlapping taps (finger ${firstUp} lifts first): A4 − and instrument both act`, b1.a4 === b0.a4 - 1 && b1.inst !== b0.inst, [b0.a4, b1.a4, b0.inst, b1.inst]);
    }
    // a tap, then the click Chromium 141 sends afterwards (detail 0, no pointerType), on the element, its edge and elementFromPoint
    const replay = async sel => {
      const c = await center(sel); await T('touchStart', [c]); await W(40); await T('touchEnd', [c]); await W(100);
      await p.evaluate(([s, x, y]) => {
        const el = document.querySelector(s), r = el.getBoundingClientRect();
        const ev = (cx, cy) => new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: cx, clientY: cy, view: window });
        el.dispatchEvent(ev(x, y));
        el.dispatchEvent(ev(r.left + 1, r.top + 1));
        const under = document.elementFromPoint(x, y); if (under) under.dispatchEvent(ev(x, y));
      }, [sel, c[0], c[1]]);
      await W(850);
    };
    let b0 = await st(p); await replay('#a4Up'); let b1 = await st(p);
    t('tap A4 + then detail-0 clicks (element, edge, elementFromPoint): A4 changes once', b1.a4 - b0.a4 === 1, b1.a4 - b0.a4);
    b0 = await st(p); await replay('#srow [data-i="2"]'); b1 = await st(p);
    t('tap string then detail-0 clicks: it stays locked', b1.lock === 2, [b0.lock, b1.lock]);
    b0 = await st(p); await replay('#themeBtn'); b1 = await st(p);
    t('tap theme then detail-0 clicks: theme moves one step', ({ auto: 'light', light: 'dark', dark: 'auto' })[b0.theme] === b1.theme, [b0.theme, b1.theme]);
    b0 = await st(p); await replay('#refBtn'); b1 = await st(p);
    t('tap reference tone then detail-0 clicks: it keeps playing', !b0.ref && b1.ref, [b0.ref, b1.ref]);
    await tap('#refBtn'); await W(850);
    b0 = await st(p); await replay('#a4Btn'); b1 = await st(p);
    t('tap A4 then detail-0 clicks: the panel toggles once', b0.panel !== b1.panel, [b0.panel, b1.panel]);
    await replay('#a4Btn');
    // a lone detail-0 click with no recent tap (screen reader) acts once; keyboard Enter acts once
    b0 = await st(p); await p.evaluate(() => document.getElementById('a4Up').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))); b1 = await st(p);
    t('a lone detail-0 click acts once', b1.a4 - b0.a4 === 1, b1.a4 - b0.a4);
    b0 = await st(p); await p.focus('#a4Up'); await p.keyboard.press('Enter'); b1 = await st(p);
    t('keyboard Enter on A4 + acts once', b1.a4 - b0.a4 === 1, b1.a4 - b0.a4);
    // keyboard focus stays on the chosen instrument / string (buttons are no longer rebuilt)
    await p.focus('#inst [data-k="ukulele"]'); await p.keyboard.press('Enter');
    t('Enter on an instrument switches it and keeps focus on that button', await p.evaluate(() => __tuner.S.instrument === 'ukulele' && document.activeElement && document.activeElement.dataset.k === 'ukulele'));
    await p.focus('#srow [data-i="1"]'); await p.keyboard.press('Enter');
    t('Enter on a string locks it and keeps focus on that string', await p.evaluate(() => __tuner.S.lockedString === 1 && document.activeElement && document.activeElement.dataset.i === '1'));
    await p.keyboard.press('Enter'); await p.focus('#inst [data-k="guitar"]'); await p.keyboard.press('Enter');
    // long press on a string plays its reference tone and does not lock it
    b0 = await st(p); { const c = await center('#srow [data-i="0"]'); await T('touchStart', [c]); await W(650); await T('touchEnd', [c]); }
    await W(850); b1 = await st(p);
    t('holding a string 0.65 s plays the reference tone and leaves the lock alone', b1.ref && b1.lock === b0.lock, [b1.ref, b0.lock, b1.lock]);
    await tap('#refBtn'); await W(300);
    // a tap that swaps the card must not fire the control that appears under the finger
    await tap('.go'); await until(p, () => __tuner.running); await W(900);
    t('tapping start does not also tap the new stop button', await p.evaluate(() => __tuner.running));
    await tap('[data-act="stop"]'); await until(p, () => !__tuner.running); await W(900);
    t('tapping stop does not also tap the new start button', await p.evaluate(() => !__tuner.running && __tuner.cardState === 'idle'));
    await ctx.close();
  }

  // 2. [veto] corrupt saves load normally
  for (const bad of ['{"instrument":"__proto__"}', '{"instrument":"toString"}', '{"instrument":"constructor"}', '{"instrument":"hasOwnProperty"}',
    '{"lockedString":-1}', '{"lockedString":1.5}', '{"lockedString":"2"}', '{"lockedString":99}', '{"a4":"x"}', '{"a4":null,"theme":5}', '[1,2]', '"guitar"', '{"instrument":"bass","lockedString":4}']) {
    const n0 = errors.length;
    const { ctx, p, tap } = await open(390, 844, [v => { try { localStorage.setItem('tuner.v1', v); } catch (e) {} }, bad]);
    const s = await st(p);
    const okState = Object.prototype.hasOwnProperty.call({ chromatic: 1, guitar: 1, ukulele: 1, violin: 1, bass: 1 }, s.inst) && (s.lock === null || (Number.isInteger(s.lock) && s.lock >= 0 && s.lock < 6)) && s.a4 >= 430 && s.a4 <= 450 && ['auto', 'light', 'dark'].includes(s.theme);
    await tap('#inst [data-k="violin"]'); const sw = await until(p, () => __tuner.S.instrument === 'violin', null, 2000);
    let reading = true;
    if (/lockedString/.test(bad)) {
      await tap('#inst [data-k="guitar"]'); await W(850);
      await tap('.go'); await until(p, () => __tuner.running);
      await p.evaluate(() => __fake.set(110)); reading = await until(p, () => __tuner.shown && Math.abs(__tuner.shown.f - 110) < 1, null, 3000);
    }
    t(`corrupt save ${bad}: loads with valid state, controls work, tuning reads, no errors`, okState && sw && reading && errors.length === n0, [JSON.stringify(s), sw, reading, errors.slice(n0)]);
    await ctx.close();
  }
  // existing saves still load unchanged
  {
    const { ctx, p } = await open(390, 844, [() => { if (!sessionStorage.x) { sessionStorage.x = 1; localStorage.setItem('tuner.v1', JSON.stringify({ instrument: 'bass', a4: 442, lockedString: 2, theme: 'dark' })); } }]);
    const s = await st(p);
    t('a valid save loads unchanged', s.inst === 'bass' && s.a4 === 442 && s.lock === 2 && s.theme === 'dark', JSON.stringify(s));
    await ctx.close();
  }

  // 3–4. readings: above the limit, settled 準, noise flag (chromatic, live fake mic)
  {
    const { ctx, p, tap } = await open();
    await tap('#inst [data-k="chromatic"]'); await W(850);
    t('idle note is a quiet ♪, not a loading bar; idle needle rests at the left, not at centre', await p.evaluate(() => document.getElementById('nName').textContent === '♪' && __tuner.needle <= -40));
    await tap('.go'); await until(p, () => __tuner.running);
    await p.evaluate(() => __fake.set(2600)); await W(1200);
    t('2600 Hz (above the 2000 Hz limit) shows no reading', await p.evaluate(() => !__tuner.shown && document.getElementById('freq').textContent === '— Hz'), await p.evaluate(() => document.getElementById('freq').textContent));
    await p.evaluate(() => __fake.set(1300)); t('1300 Hz still reads', await until(p, () => __tuner.shown && Math.abs(__tuner.shown.f - 1300) < 2, null, 3000));
    const watch = async (ms) => p.evaluate(ms => new Promise(res => { const seen = []; const t0 = performance.now(); (function f() { const h = document.getElementById('hint').textContent, c = document.getElementById('cents').textContent; seen.push([h, c]); if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(seen); })(); }), ms);
    for (let k = 0; k < 3; k++) {
      await p.evaluate(() => __fake.set(0)); await until(p, () => !__tuner.shown, null, 4000);
      await p.evaluate(f => __fake.set(f), 440 * Math.pow(2, -6 / 1200));
      const seen = await watch(1300);
      t(`steady −6 ¢ after silence (try ${k + 1}): 準 never shows, not even during the attack`, seen.every(([h]) => h !== '準！') && seen.some(([, c]) => c === '−6 ¢'), seen.filter(([h]) => h === '準！').slice(0, 3));
    }
    await p.evaluate(() => __fake.set(0)); await until(p, () => !__tuner.shown, null, 4000);
    await p.evaluate(f => __fake.set(f), 440 * Math.pow(2, -3 / 1200));
    t('steady −3 ¢ reaches 準', await until(p, () => document.getElementById('hint').textContent === '準！', null, 3000));
    const glide = [];
    for (const c of [-4.5, -5.6, -6.8, -7.4, -3]) { await p.evaluate(f => __fake.freq(f), 440 * Math.pow(2, c / 1200)); glide.push(...await watch(500)); }
    const bad = glide.filter(([h, c]) => h === '準！' && !(Math.abs(parseInt(c.replace('−', '-'), 10)) <= 5));
    t('gliding −3 → −7.4 ¢: whenever 準 shows, the shown cents are within ±5', bad.length === 0, bad.slice(0, 3));
    t('gliding: −7 ¢ shows 偏低', glide.some(([h, c]) => c === '−7 ¢' && h === '偏低'));
    // heavy broadband noise is flagged
    await p.evaluate(() => { __fake.set(110, 0.3); __fake.noise(0.13); });
    t('a noisy reading is flagged 雜音大', await until(p, () => /雜音大/.test(document.getElementById('sub').textContent), null, 4000), await p.evaluate(() => document.getElementById('sub').textContent));
    await ctx.close();
  }

  // 5–7. layout: start button on the first screen at 360x640, A4 panel at 360, landscape fits the reading and strings
  {
    const { ctx, p } = await open(360, 640);
    const g = await p.evaluate(() => { const r = document.querySelector('.go').getBoundingClientRect(); return { bottom: r.bottom, top: r.top, ih: innerHeight, sy: scrollY }; });
    t('360x640: start button is fully on the first screen without scrolling', g.sy === 0 && g.top >= 0 && g.bottom <= g.ih, g);
    await p.evaluate(() => document.getElementById('a4Btn').click());
    const a = await p.evaluate(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.width, b.height]; }; const lines = s => { const e = document.querySelector(s); return e.getClientRects().length === 1 && e.getBoundingClientRect().height < 30 ? 1 : 2; };
      const lh = el => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getClientRects().length; };
      return { down: r('#a4Down'), up: r('#a4Up'), reset: lh(document.getElementById('a4Reset')), lbl: lh(document.querySelector('.a4panel .lbl')), radius: getComputedStyle(document.getElementById('a4Up')).borderRadius, over: document.documentElement.scrollWidth - innerWidth }; });
    t('360 px A4 panel: − and + stay 44x44 and round', a.down[0] >= 44 && a.down[1] >= 44 && a.up[0] === a.up[1] && a.up[0] >= 44 && a.down[0] === a.down[1] && a.radius === '50%', a);
    t('360 px A4 panel: 重設 and 基準音 A4 stay on one line, no horizontal scroll', a.reset === 1 && a.lbl === 1 && a.over <= 0, a);
    await ctx.close();
  }
  for (const [w, h] of [[844, 390], [667, 375]]) {
    const { ctx, p, tap } = await open(w, h);
    await tap('.go'); await until(p, () => __tuner.running);
    await p.evaluate(() => __fake.set(110)); await until(p, () => __tuner.shown, null, 3000);
    const v = await p.evaluate(() => { const vis = s => { const b = document.querySelector(s).getBoundingClientRect(); return b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight + 0.5 && b.right <= innerWidth + 0.5 && b.height > 0; };
      return { note: vis('#note'), needle: vis('#dial'), cents: vis('#cents'), strings: vis('#srow'), stop: vis('[data-act="stop"]'), sy: scrollY, over: document.documentElement.scrollWidth - innerWidth }; });
    t(`${w}x${h} landscape: note, needle, cents, string row (and stop) all visible at once`, v.note && v.needle && v.cents && v.strings && v.stop && v.sy === 0 && v.over <= 0, v);
    await ctx.close();
  }

  // 8. a fast permission denial is not described as an embedded page
  {
    const { ctx, p, tap } = await open();
    await p.evaluate(() => { __fake.mode = 'NotAllowedError'; });
    await tap('.go'); await until(p, () => __tuner.cardState === 'denied', null, 3000);
    const h2 = await p.evaluate(() => (document.querySelector('#card h2') || {}).textContent || '');
    t('fast NotAllowedError: card explains the permission settings, not "embedded in another site"', /權限|麥克風/.test(h2) && !/無法使用/.test(h2) && await p.evaluate(() => !!document.querySelector('#card [data-act="start"]')), h2);
    await ctx.close();
  }

  t('no page or console errors in the browser checks', errors.length === 0, errors.slice(0, 5));
  await browser.close(); srv.close();
}
