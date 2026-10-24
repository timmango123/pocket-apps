// Minimal HEIF/AVIF writer used only by tests: ftyp + meta(hdlr,pitm,iinf,iloc,iref,iprp,...) + mdat.
const enc = s => Uint8Array.from(Buffer.from(s, 'utf8'));
const cat = a => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const u16 = v => Uint8Array.from([v >> 8 & 255, v & 255]), u32 = v => Uint8Array.from([v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255]);
const box = (t, ...p) => { const b = cat(p); return cat([u32(b.length + 8), enc(t), b]); };
const full = (t, v, f, ...p) => box(t, Uint8Array.from([v, f >> 16 & 255, f >> 8 & 255, f & 255]), ...p);
function buildHeif({ brand = 'heic', compat = ['mif1', 'heic'], primary = 1, items, props = null, split = false }) {
  // items: [{id, type, mime?, data:Uint8Array, cdsc?:toId}]
  const ftyp = box('ftyp', enc(brand), u32(0), ...compat.map(enc));
  const hdlr = full('hdlr', 0, 0, u32(0), enc('pict'), new Uint8Array(12), Uint8Array.from([0]));
  const pitm = full('pitm', 0, 0, u16(primary));
  const iinf = full('iinf', 0, 0, u16(items.length), ...items.map(it => full('infe', 2, 0, u16(it.id), u16(0), enc(it.type), Uint8Array.from([0]), ...(it.mime ? [enc(it.mime), Uint8Array.from([0])] : []))));
  const refs = items.filter(it => it.cdsc);
  const iref = refs.length ? full('iref', 0, 0, ...refs.map(it => box('cdsc', u16(it.id), u16(1), u16(it.cdsc)))) : new Uint8Array(0);
  const iprp = props || box('iprp', box('ipco', full('ispe', 0, 0, u32(64), u32(48))), full('ipma', 0, 0, u32(1), u16(primary), Uint8Array.from([1, 0x81])));
  const ilocFor = offs => full('iloc', 0, 0, Uint8Array.from([0x44, 0x00]), u16(items.length), ...items.map((it, i) => {
    const ex = split && it.type === 'Exif' ? [[offs[i], it.data.length >> 1], [offs[i] + (it.data.length >> 1), it.data.length - (it.data.length >> 1)]] : [[offs[i], it.data.length]];
    return cat([u16(it.id), u16(0), u16(ex.length), ...ex.flatMap(([o, l]) => [u32(o), u32(l)])]);
  }));
  const metaFor = offs => full('meta', 0, 0, hdlr, pitm, ilocFor(offs), iinf, iref, iprp);
  const head = ftyp.length + metaFor(items.map(() => 0)).length + 8;
  const offs = []; let p = head; for (const it of items) { offs.push(p); p += it.data.length; }
  return cat([ftyp, metaFor(offs), box('mdat', ...items.map(it => it.data))]);
}
module.exports = { buildHeif, box, full, u16, u32, enc, cat };
