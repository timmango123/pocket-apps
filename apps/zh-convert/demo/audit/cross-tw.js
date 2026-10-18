// Writes TW_CROSS in ../../index.html: jieba words (2-4 characters) that reach outside a TW_CTX phrase (推导|出 for 导出PDF,
// 返回值|班 for 返回值); passOut skips the phrase there. Words that cut the changed part need freq >= MINF (100), others >= MINF2 (400);
// particles, trailing locatives, numbers and edge pronouns are exempt. Stored by phrase edge (see group()). Needs simp.txt (extract-jieba.py). node cross-tw.js [MINF] [MINF2]
const fs = require('fs'), path = require('path'), ch = s => Array.from(s);
const APP = path.resolve(__dirname, '../../index.html');
let html = fs.readFileSync(APP, 'utf8');
// shared by side: "<inside> <outside> …" for words that reach out to the left (L, 推 before 導), "<inside> …" after a
// "R" mark for words that reach out to the right (值班 after 返回值: 值 + 班), and B<phrase> codes for words around a whole phrase.
// Output: TW_CROSS = "L導 推;L代 寫…;R值 班;B…" — any TW_CTX phrase that starts with 導 is skipped after 推, and so on.
function group(m) {
  const g = new Map(), add = (k, w) => { if (!g.has(k)) g.set(k, new Set()); g.get(k).add(w); };
  for (const [k, ws] of m) { const kc = ch(k); for (const c of ws) { const [, l, n, r] = c.match(/^(\D*)(\d)(\D*)$/);
    if (l && r) add('B' + k, c); else if (l) add('L' + kc.slice(0, n).join(''), l); else add('R' + kc.slice(kc.length - n).join(''), r); } }
  return [...g].map(([k, ws]) => k + ' ' + [...ws].sort().join(' ')).join(';');
}
html = html.replace(/\/\*TWX-START\*\/[\s\S]*?\/\*TWX-END\*\//, '/*TWX-START*/const TW_CROSS = ``;/*TWX-END*/'); fs.writeFileSync(APP, html);
const { ZC } = require('./eng.js');
const ctx = html.match(/const TW_CTX = `([^`]*)`/)[1].split(/\s+/).filter(Boolean).map(e => e.split('>')).filter(([k, v]) => k !== v);
const MINF = +(process.argv[2] || 100);
const W = fs.readFileSync(path.join(__dirname, 'simp.txt'), 'utf8').split('\n').map(l => l.split('\t')).filter(r => +r[1] >= MINF && ch(r[0]).length >= 2 && ch(r[0]).length <= 4);
const FQ = new Map(W.map(r => [r[0], +r[1]]));   // words that only cut an unchanged end need freq >= MINF2 (值班 473)
const MINF2 = +(process.argv[3] || 400);
const TWK = new Set(html.match(/,tw:`([^`]*)`/)[1].split('|').map(e => e.split('\t')[0]).concat(ctx.map(e => e[0])));
const LOC = new Set(Array.from('里中上内外下边'));   // a trailing locative: 浏览器窗口|里 against 口里
const NUM = new Set(Array.from('一二三四五六七八九十两几这那每各某多半整第'));
const STOP = new Set(Array.from('的了着过是在和与也都就还又要会能有不没把被给从对向为让很'));
const s2t = t => ZC.join(ZC.convert(t, { dir: 's2t' })), t2s = t => ZC.join(ZC.convert(t, { dir: 't2s' }));
const out = new Map();   // phrase -> words that cut it
for (const [K, V] of ctx) {
  const k = ch(t2s(K)), L = k.length, kk = ch(K), vv = ch(V);
  let p0 = 0, p1 = 0;
  while (p0 < L && p0 < vv.length && kk[p0] === vv[p0]) p0++;
  while (p1 < L - p0 && p1 < vv.length - p0 && kk[L - 1 - p1] === vv[vv.length - 1 - p1]) p1++;
  const cs = p0, ce = L - p1;
  for (const [w] of W) {
    const a = ch(w), n = a.length;
    for (let ws = -(n - 1); ws < L; ws++) {
      const we = ws + n;
      if (!(ws < 0 || we > L)) continue;   // any word that reaches outside the phrase (返回值|班 against 值班)
      if (!((ws < cs && we > cs) || (ws < ce && we > ce)) && FQ.get(w) < MINF2) continue;
      let ok = true; for (let i = 0; i < n; i++) { const p = ws + i; if (p >= 0 && p < L && a[i] !== k[p]) { ok = false; break; } }
      // a word that starts with the phrase and holds the whole changed part (身份證 around 身份) only counts when it has its own vocabulary entry
      // a single particle outside the phrase (项目|的 against 目的) reads as its own word
      if (ok && (ws === -1 && we <= L && STOP.has(a[0]) || we === L + 1 && ws >= 0 && (STOP.has(a[n - 1]) || LOC.has(a[n - 1])))) continue;
      // a pronoun at the edge of the phrase stays one even inside 他们 / 我们 (软件支持他|们)
      if (ok && (we > L && ws === L - 1 || ws < 0 && we === 1) && '他她我你它'.includes(k[Math.max(ws, 0)])) continue;
      // a number or demonstrative before a measure word (一|條信息 against 一條) is its own word too
      if (ok && ws < 0 && a.slice(0, -ws).every(c => NUM.has(c))) continue;
      if (ok && ws >= 0 && ws <= cs && we >= ce && !TWK.has(s2t(w))) continue;
      // stored compactly: the part outside the phrase around a digit for how many phrase characters it covers (推1 = 推+導)
      if (ok) { if (!out.has(K)) out.set(K, new Set()); const tw = ch(s2t(w)), lo = Math.max(0, -ws), ro = Math.max(0, we - L);
        out.get(K).add(tw.slice(0, lo).join('') + (n - lo - ro) + tw.slice(n - ro).join('')); }
    }
  }
}
html = html.replace(/\/\*TWX-START\*\/[\s\S]*?\/\*TWX-END\*\//, '/*TWX-START*/const TW_CROSS = `' + group(out) + '`;/*TWX-END*/');
fs.writeFileSync(APP, html);
console.log('TW_CROSS phrases', out.size, 'words', [...out.values()].reduce((n, x) => n + x.size, 0));
