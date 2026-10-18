// Writes TW_CROSS in ../../index.html: jieba words (freq >= MINF, default 100; 2-4 characters) that would be cut in two
// where a TW_CTX phrase starts or ends the part it changes and that reach outside the phrase (推导|出 for 导出PDF).
// passOut skips such a match. Stored per phrase: "phrase word word;phrase word …". Needs simp.txt (see extract-jieba.py). node cross-tw.js [MINF]
const fs = require('fs'), path = require('path'), ch = s => Array.from(s);
const APP = path.resolve(__dirname, '../../index.html');
let html = fs.readFileSync(APP, 'utf8');
html = html.replace(/\/\*TWX-START\*\/[\s\S]*?\/\*TWX-END\*\//, '/*TWX-START*/const TW_CROSS = ``;/*TWX-END*/'); fs.writeFileSync(APP, html);
const { ZC } = require('./eng.js');
const ctx = html.match(/const TW_CTX = `([^`]*)`/)[1].split(/\s+/).filter(Boolean).map(e => e.split('>')).filter(([k, v]) => k !== v);
const MINF = +(process.argv[2] || 100);
const W = fs.readFileSync(path.join(__dirname, 'simp.txt'), 'utf8').split('\n').map(l => l.split('\t')).filter(r => +r[1] >= MINF && ch(r[0]).length >= 2 && ch(r[0]).length <= 4).map(r => r[0]);
const TWK = new Set(html.match(/,tw:`([^`]*)`/)[1].split('|').map(e => e.split('\t')[0]).concat(ctx.map(e => e[0])));
const STOP = new Set(Array.from('的了着过是在和与也都就还又要会能有不没把被给从对向为让很'));
const s2t = t => ZC.join(ZC.convert(t, { dir: 's2t' })), t2s = t => ZC.join(ZC.convert(t, { dir: 't2s' }));
const out = new Map();   // phrase -> words that cut it
for (const [K, V] of ctx) {
  const k = ch(t2s(K)), L = k.length, kk = ch(K), vv = ch(V);
  let p0 = 0, p1 = 0;
  while (p0 < L && p0 < vv.length && kk[p0] === vv[p0]) p0++;
  while (p1 < L - p0 && p1 < vv.length - p0 && kk[L - 1 - p1] === vv[vv.length - 1 - p1]) p1++;
  const cs = p0, ce = L - p1;
  for (const w of W) {
    const a = ch(w), n = a.length;
    for (let ws = -(n - 1); ws < L; ws++) {
      const we = ws + n;
      if (!(ws < 0 || we > L) || !((ws < cs && we > cs) || (ws < ce && we > ce))) continue;
      let ok = true; for (let i = 0; i < n; i++) { const p = ws + i; if (p >= 0 && p < L && a[i] !== k[p]) { ok = false; break; } }
      // a word that starts with the phrase and holds the whole changed part (身份證 around 身份) only counts when it has its own vocabulary entry
      // a single particle outside the phrase (项目|的 against 目的) reads as its own word
      if (ok && (ws === -1 && we <= L && STOP.has(a[0]) || we === L + 1 && ws >= 0 && STOP.has(a[n - 1]))) continue;
      if (ok && ws >= 0 && ws <= cs && we >= ce && !TWK.has(s2t(w))) continue;
      if (ok) { if (!out.has(K)) out.set(K, new Set()); out.get(K).add(s2t(w)); }
    }
  }
}
html = html.replace(/\/\*TWX-START\*\/[\s\S]*?\/\*TWX-END\*\//, '/*TWX-START*/const TW_CROSS = `' + [...out].map(([k, ws]) => k + ' ' + [...ws].sort().join(' ')).join(';') + '`;/*TWX-END*/');
fs.writeFileSync(APP, html);
console.log('TW_CROSS phrases', out.size, 'words', [...out.values()].reduce((n, x) => n + x.size, 0));
