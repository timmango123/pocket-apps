// Unit tests for 錄音機 (voice-memo), run against the tool's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {MIME_ORDER,pickMime,extForMime,fmtClock,fmtBytes,defaultName,safeFileName,computePeaks,peaksForWidth,setHandle,isFullRange,sampleRange,sliceChannels,sameChannels,encodeWAV,findSoundBounds,mixdown};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// --- mime selection ---
t('prefers webm/opus when supported', C.pickMime(() => true) === 'audio/webm;codecs=opus');
t('iOS Safari: only audio/mp4', C.pickMime(m => m === 'audio/mp4') === 'audio/mp4');
t('Firefox-like: ogg when webm missing', C.pickMime(m => m.startsWith('audio/ogg')) === 'audio/ogg;codecs=opus');
t('nothing supported -> browser default', C.pickMime(() => false) === '');
t('isTypeSupported throwing is survived', C.pickMime(m => { if (m.includes('webm')) throw new Error('x'); return m === 'audio/mp4'; }) === 'audio/mp4');
t('ext: webm', C.extForMime('audio/webm;codecs=opus') === 'webm');
t('ext: mp4 -> m4a', C.extForMime('audio/mp4') === 'm4a');
t('ext: ogg', C.extForMime('audio/ogg') === 'ogg');
t('ext: wav', C.extForMime('audio/wav') === 'wav');
t('ext: empty -> webm', C.extForMime('') === 'webm');

// --- formatting ---
t('0 -> 00:00.0', C.fmtClock(0) === '00:00.0');
t('5.25 -> 00:05.2', C.fmtClock(5.25) === '00:05.2');
t('59.99 never shows 60', C.fmtClock(59.99) === '00:59.9');
t('61.5 -> 01:01.5', C.fmtClock(61.5) === '01:01.5');
t('one hour -> 1:00:00.0', C.fmtClock(3600) === '1:00:00.0');
t('float noise 0.3 -> .3', C.fmtClock(0.1 + 0.2) === '00:00.3');
t('negative / NaN -> 0', C.fmtClock(-3) === '00:00.0' && C.fmtClock(NaN) === '00:00.0');
t('bytes', C.fmtBytes(0) === '0 B' && C.fmtBytes(512) === '512 B' && C.fmtBytes(2048) === '2.0 KB' && C.fmtBytes(13002342) === '12.4 MB');
t('default name', C.defaultName(new Date(2026, 9, 7, 14, 32)) === '錄音 2026-10-07 14:32');
t('file name strips \\/:*?"<>|', C.safeFileName('錄音 2026-10-07 14:32', 'webm') === '錄音 2026-10-07 1432.webm');
t('file name strips all reserved chars', C.safeFileName('a\\b/c:d*e?f"g<h>i|j', 'wav') === 'abcdefghij.wav');
t('empty file name -> recording', C.safeFileName('  ///  ', 'm4a') === 'recording.m4a');
t('leading dots removed', C.safeFileName('..hidden', 'wav') === 'hidden.wav');

// --- peaks ---
{ const d = new Float32Array(1000); for (let i = 0; i < 1000; i++) d[i] = i < 500 ? 0 : (i % 2 ? 0.5 : -0.25);
  const p = C.computePeaks(d, 10);
  t('peaks: n buckets', p.min.length === 10 && p.max.length === 10);
  t('peaks: silent half is 0', p.max[0] === 0 && p.min[4] === 0);
  t('peaks: loud half min/max', near(p.max[5], 0.5) && near(p.min[9], -0.25));
  const w = C.peaksForWidth(p, 2);
  t('re-bucket down keeps extremes', w.max[0] === 0 && near(w.max[1], 0.5) && near(w.min[1], -0.25));
  const up = C.peaksForWidth(p, 40);
  t('re-bucket up repeats buckets', up.max.length === 40 && up.max[19] === 0 && near(up.max[20], 0.5));
  const odd = C.computePeaks(new Float32Array([1, -1, 0.5]), 7);
  t('more buckets than samples: no gaps', odd.max.length === 7 && Array.from(odd.max).every(v => v >= 0) && odd.max[0] === 1); }

// --- trim handles ---
{ let s = { a: 0, b: 10 };
  s = C.setHandle(s, 0, 2.5, 10, 0.1); t('move start', s.a === 2.5 && s.b === 10);
  s = C.setHandle(s, 1, 7, 10, 0.1); t('move end', s.a === 2.5 && s.b === 7);
  s = C.setHandle(s, 0, 9, 10, 0.1); t('start cannot pass end - min', near(s.a, 6.9) && s.b === 7);
  s = C.setHandle(s, 1, 1, 10, 0.1); t('end cannot pass start + min', near(s.b, 7.0) && near(s.a, 6.9));
  s = C.setHandle({ a: 1, b: 5 }, 0, -3, 10, 0.1); t('start clamps at 0', s.a === 0);
  s = C.setHandle({ a: 1, b: 5 }, 1, 99, 10, 0.1); t('end clamps at duration', s.b === 10);
  s = C.setHandle({ a: 0, b: 0.05 }, 1, 0.01, 0.05, 0.1); t('clip shorter than min stays valid', s.a === 0 && near(s.b, 0.05));
  t('full range detect', C.isFullRange({ a: 0, b: 10 }, 10) && !C.isFullRange({ a: 0.5, b: 10 }, 10)); }
t('sample range', JSON.stringify(C.sampleRange(1, 2.5, 48000, 480000)) === '[48000,120000]');
t('sample range clamps', JSON.stringify(C.sampleRange(-1, 99, 48000, 1000)) === '[0,1000]');
t('sample range never inverted', (r => r[1] >= r[0])(C.sampleRange(3, 1, 100, 1000)));

// --- WAV encoder ---
function parseWav(buf) {
  const v = new DataView(buf), s = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  return { riff: s(0, 4), size: v.getUint32(4, true), wave: s(8, 4), fmt: s(12, 4), fmtLen: v.getUint32(16, true), pcm: v.getUint16(20, true), ch: v.getUint16(22, true), sr: v.getUint32(24, true), byteRate: v.getUint32(28, true), align: v.getUint16(32, true), bits: v.getUint16(34, true), data: s(36, 4), dataSize: v.getUint32(40, true), v };
}
{ const sr = 48000, n = sr * 2, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin(i / sr * 2 * Math.PI * 440) * 0.5;
  a[0] = 1; a[1] = -1; a[2] = 2; a[3] = -2; a[4] = 0;
  const buf = C.encodeWAV([a], sr), h = parseWav(buf);
  t('wav: 44-byte header + data', buf.byteLength === 44 + n * 2);
  t('wav: RIFF/WAVE/fmt /data tags', h.riff === 'RIFF' && h.wave === 'WAVE' && h.fmt === 'fmt ' && h.data === 'data');
  t('wav: RIFF size = 36 + data', h.size === 36 + n * 2 && h.dataSize === n * 2);
  t('wav: PCM 16-bit mono 48k', h.fmtLen === 16 && h.pcm === 1 && h.ch === 1 && h.sr === 48000 && h.bits === 16 && h.align === 2 && h.byteRate === 96000);
  t('wav: duration from header = 2.000 s', h.dataSize / h.byteRate === 2);
  t('wav: full scale +1 -> 32767', h.v.getInt16(44, true) === 32767);
  t('wav: full scale -1 -> -32768', h.v.getInt16(46, true) === -32768);
  t('wav: clipping', h.v.getInt16(48, true) === 32767 && h.v.getInt16(50, true) === -32768);
  t('wav: zero', h.v.getInt16(52, true) === 0);
  t('wav: sample value', Math.abs(h.v.getInt16(44 + 1000 * 2, true) / 32767 - a[1000]) < 1 / 32767 + 1e-6); }
{ const L = new Float32Array([0.5, 0.25]), Rr = new Float32Array([-0.5, -0.25]);
  const h = parseWav(C.encodeWAV([L, Rr], 44100));
  t('wav: stereo header', h.ch === 2 && h.align === 4 && h.byteRate === 44100 * 4 && h.dataSize === 8);
  t('wav: stereo interleaved L R L R', h.v.getInt16(44, true) === Math.round(0.5 * 32767) && h.v.getInt16(46, true) === -16384 && h.v.getInt16(48, true) === Math.round(0.25 * 32767) && h.v.getInt16(50, true) === -8192); }
t('wav: empty clip is a valid 44-byte file', (b => b.byteLength === 44 && parseWav(b).dataSize === 0)(C.encodeWAV([new Float32Array(0)], 48000)));
t('same channels -> mono', C.sameChannels([new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3])]) && !C.sameChannels([new Float32Array([1, 2, 3]), new Float32Array([1, 0, 3])]));

// --- trim end to end: seconds -> samples -> wav length within 50 ms ---
{ const sr = 48000, d = new Float32Array(sr * 7.3);
  for (const [a, b] of [[0.42, 3.17], [1, 7.3], [0, 0.1], [6.95, 7.3]]) {
    const [s0, s1] = C.sampleRange(a, b, sr, d.length), part = C.sliceChannels([d], s0, s1), h = parseWav(C.encodeWAV(part, sr));
    t(`trim ${a}-${b}s: wav length within 50 ms`, Math.abs(h.dataSize / h.byteRate - (b - a)) < 0.05);
  } }

// --- auto trim (silence finder) ---
{ const sr = 16000, d = new Float32Array(sr * 5);
  for (let i = Math.round(1.2 * sr); i < Math.round(3.6 * sr); i++) d[i] = 0.3 * Math.sin(i * 0.2);
  for (let i = 0; i < d.length; i++) d[i] += (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.0005; // hiss well below -45 dBFS
  const r = C.findSoundBounds(d, sr);
  t('auto trim: start ≈ 1.2 - 0.1 s', r && Math.abs(r.a - 1.1) < 0.051);
  t('auto trim: end ≈ 3.6 + 0.1 s', r && Math.abs(r.b - 3.7) < 0.051);
  t('auto trim: silence -> null', C.findSoundBounds(new Float32Array(sr), sr) === null);
  const q = new Float32Array(sr); q.fill(0.004); // ≈ -48 dBFS
  t('auto trim: -48 dBFS counts as silence', C.findSoundBounds(q, sr) === null);
  q.fill(0.007); // ≈ -43 dBFS
  t('auto trim: -43 dBFS counts as sound', !!C.findSoundBounds(q, sr));
  const e = new Float32Array(sr); e[0] = 1; e[sr - 1] = 1;
  const r2 = C.findSoundBounds(e, sr);
  t('auto trim: pads clamp to clip edges', r2 && r2.a === 0 && r2.b === 1); }
t('mixdown averages', (m => near(m[0], 0) && near(m[1], 0.5))(C.mixdown([new Float32Array([1, 1]), new Float32Array([-1, 0])])));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
