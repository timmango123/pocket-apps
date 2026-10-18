// EXIF 檢視與清除：核心邏輯測試。取出 index.html 的 CORE 區段，用 Chromium 產生 JPEG／PNG／WebP 原圖，
// 以自己的寫入器加上 EXIF／XMP／文字區塊，再解析、清除，驗證影像資料逐位元相同、沒有殘留，且輸出仍可被 Chromium 解碼。
// 用法：node tests.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const EX = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return EX;')();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const field = (info, key) => info.summary.fields.find(f => f.key === key);
const fval = (info, key) => (field(info, key) || {}).value;

const fullTiff = (ori, le) => EX.buildTiff({
  ifd0: { 0x010F: { t: 2, v: 'Canon' }, 0x0110: { t: 2, v: 'Canon EOS R6' }, 0x0112: { t: 3, v: ori }, 0x0131: { t: 2, v: 'Adobe Lightroom 7.4' }, 0x013B: { t: 2, v: '林小美' }, 0x8298: { t: 2, v: '© 2025' }, 0x010E: { t: 2, v: 'Family trip' } },
  exif: { 0x829A: { t: 5, v: [1, 250] }, 0x829D: { t: 5, v: [56, 10] }, 0x8822: { t: 3, v: 3 }, 0x8827: { t: 3, v: 200 }, 0x9003: { t: 2, v: '2025:10:04 17:42:18' }, 0x9011: { t: 2, v: '+08:00' }, 0x9204: { t: 10, v: [-1, 3] }, 0x9209: { t: 3, v: 16 }, 0x920A: { t: 5, v: [35, 1] }, 0xA002: { t: 4, v: 64 }, 0xA003: { t: 4, v: 48 }, 0xA403: { t: 3, v: 0 }, 0xA405: { t: 3, v: 56 }, 0xA420: { t: 2, v: 'abc123' }, 0xA430: { t: 2, v: '王大明' }, 0xA431: { t: 2, v: '093021004512' }, 0xA434: { t: 2, v: 'RF24-105mm F4 L IS USM' }, 0xA435: { t: 2, v: '8832001077' }, 0x927C: { t: 7, v: new Uint8Array(40) }, 0x9286: { t: 7, v: EX.concat([EX.encStr('ASCII\0\0\0'), EX.encStr('hello')]) } },
  gps: { 1: { t: 2, v: 'S' }, 2: { t: 5, v: EX.gpsDms(33.8688) }, 3: { t: 2, v: 'E' }, 4: { t: 5, v: EX.gpsDms(151.2093) }, 5: { t: 1, v: 1 }, 6: { t: 5, v: EX.rat(12.5, 10) }, 29: { t: 2, v: '2025:10:04' } },
  interop: { 1: { t: 2, v: 'R98' } }
}, le);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fx = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 64, 48); gr.addColorStop(0, '#f80'); gr.addColorStop(1, '#08f'); g.fillStyle = gr; g.fillRect(0, 0, 64, 48);
    g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(10, 10, 20, 20);
    const out = {};
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) { const bl = await new Promise(r => c.toBlob(r, t, 0.8)); const u = new Uint8Array(await bl.arrayBuffer()); out[t] = btoa(String.fromCharCode(...u)); }
    return out;
  });
  const b64 = s => Uint8Array.from(Buffer.from(s, 'base64'));
  const JPG = b64(fx['image/jpeg']), PNG = b64(fx['image/png']), WEBP = b64(fx['image/webp']);
  const decode = async u8 => page.evaluate(async b => { const u = Uint8Array.from(atob(b), c => c.charCodeAt(0)); try { const bm = await createImageBitmap(new Blob([u])); return [bm.width, bm.height]; } catch (e) { return null; } }, Buffer.from(u8).toString('base64'));

  // --- sniff ---
  ok(EX.sniff(JPG) === 'jpeg' && EX.sniff(PNG) === 'png' && EX.sniff(WEBP) === 'webp', 'sniff: jpeg/png/webp');
  const heic = EX.concat([new Uint8Array([0, 0, 0, 24]), EX.encStr('ftypheic'), new Uint8Array([0, 0, 0, 0]), EX.encStr('mif1heic')]);
  ok(EX.sniff(heic) === 'heic' && EX.parse(heic).format === 'heic', 'sniff: HEIC detected by ftyp brand');
  ok(EX.sniff(EX.encStr('hello world!')) === 'unknown', 'sniff: garbage is unknown');
  ok(EX.parse(JPG).summary.risk === 'clean' && EX.parse(JPG).tiff === null, 'plain canvas JPEG has no EXIF and is clean');

  // --- TIFF writer / reader round trip, both byte orders ---
  for (const le of [false, true]) {
    const t = fullTiff(6, le);
    const r = EX.parseTiff(t, 0, t.length);
    ok(r.le === le && r.errors.length === 0, `tiff ${le ? 'II' : 'MM'}: header ok`);
    ok(r.ifds.ifd0 && r.ifds.exif && r.ifds.gps && r.ifds.interop, `tiff ${le ? 'II' : 'MM'}: all four IFDs found`);
    const g = (gr, tag) => (r.ifds[gr].find(e => e.tag === tag) || {}).value;
    ok(g('ifd0', 0x0110) === 'Canon EOS R6' && g('ifd0', 0x013B) === '林小美', 'tiff: ASCII incl. UTF-8 round trip');
    ok(g('ifd0', 0x0112) === 6 && g('exif', 0x8827) === 200 && g('exif', 0xA002) === 64, 'tiff: SHORT/LONG values');
    ok(Math.abs(g('exif', 0x829A) - 1 / 250) < 1e-9 && Math.abs(g('exif', 0x829D) - 5.6) < 1e-9, 'tiff: RATIONAL values');
    ok(Math.abs(g('exif', 0x9204) + 1 / 3) < 1e-9, 'tiff: SRATIONAL negative value');
    ok(g('interop', 1) === 'R98', 'tiff: interop IFD via pointer in ExifIFD');
    const lat = g('gps', 2); ok(Array.isArray(lat) && lat.length === 3 && lat[0] === 33 && lat[1] === 52, 'tiff: GPS DMS rationals');
  }

  // --- JPEG: write, parse summary ---
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description xmp:CreatorTool="Lightroom"><dc:creator><rdf:Seq><rdf:li>林小美</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>';
  const jpg = EX.jpegInsertExif(JPG, fullTiff(6, false), [
    { marker: 0xE1, payload: EX.concat([EX.encStr('http://ns.adobe.com/xap/1.0/\0'), EX.encStr(xmp)]) },
    { marker: 0xED, payload: EX.concat([EX.encStr('Photoshop 3.0\0'), EX.encStr('8BIM'), new Uint8Array([4, 4, 0, 0, 0, 0, 0, 0])]) },
    { marker: 0xFE, payload: EX.encStr('made with love') },
    { marker: 0xE5, payload: EX.encStr('VENDOR\0private stuff') }
  ]);
  const trailing = EX.concat([jpg, EX.encStr('MotionPhoto trailer bytes')]);
  const ji = EX.parse(trailing);
  ok(ji.format === 'jpeg' && ji.width === 64 && ji.height === 48, 'jpeg: SOF dimensions');
  ok(fval(ji, 'time') === '2025/10/04 17:42:18（UTC+08:00）', 'jpeg summary: 拍攝時間 with offset');
  ok(fval(ji, 'camera') === 'Canon EOS R6', 'jpeg summary: camera (make not duplicated)');
  ok(fval(ji, 'lens') === 'RF24-105mm F4 L IS USM', 'jpeg summary: lens');
  ok(fval(ji, 'exposure') === 'f/5.6　1/250 s　ISO 200　35 mm（等效 56 mm）　-0.3 EV', 'jpeg summary: exposure line ' + fval(ji, 'exposure'));
  ok(/光圈先決/.test(fval(ji, 'mode')) && /白平衡自動/.test(fval(ji, 'mode')), 'jpeg summary: mode');
  ok(fval(ji, 'size') === '64 × 48', 'jpeg summary: size');
  ok(/順時針旋轉 90°/.test(fval(ji, 'orientation')) && ji.summary.orientation === 6, 'jpeg summary: orientation 6');
  const gps = field(ji, 'gps');
  ok(gps && gps.flag === 'danger' && Math.abs(ji.summary.gps.lat + 33.8688) < 1e-4 && Math.abs(ji.summary.gps.lon - 151.2093) < 1e-4, 'jpeg summary: GPS decoded with S/E refs');
  ok(gps.value.startsWith('33.8688° S, 151.2093° E') && /海拔 -13 m|海拔 -12 m/.test(gps.value), 'jpeg summary: GPS text + below-sea-level altitude ' + gps.value);
  ok(gps.link === 'https://www.google.com/maps?q=-33.868800,151.209300' && gps.geo === 'geo:-33.868800,151.209300', 'jpeg summary: map links');
  ok(fval(ji, 'gpstime') === '2025/10/04 UTC', 'jpeg summary: GPS date');
  ok(fval(ji, 'serial') === '093021004512' && fval(ji, 'lserial') === '8832001077', 'jpeg summary: serial numbers');
  ok(fval(ji, 'owner') === '王大明' && fval(ji, 'artist') === '林小美' && fval(ji, 'copyright') === '© 2025', 'jpeg summary: owner / artist / copyright');
  ok(fval(ji, 'software') === 'Adobe Lightroom 7.4' && fval(ji, 'uid') === 'abc123', 'jpeg summary: software, unique id');
  ok(fval(ji, 'comment') === 'Family trip；hello；made with love', 'jpeg summary: description + user comment + COM ' + fval(ji, 'comment'));
  ok(/作者/.test(fval(ji, 'xmp')) && /軟體/.test(fval(ji, 'xmp')), 'jpeg summary: XMP peek finds creator and tool');
  ok(fval(ji, 'iptc') && fval(ji, 'makernote') === '40 B' && fval(ji, 'trailing') === '25 B', 'jpeg summary: IPTC, MakerNote, trailing data');
  ok(field(ji, 'icc') && /可保留/.test(fval(ji, 'icc')), 'jpeg summary: ICC listed as keepable');
  const wk = ji.summary.warnings.map(w => w.key);
  ok(ji.summary.risk === 'high' && wk.includes('gps') && wk.includes('serial') && wk.includes('owner') && wk.includes('software') && wk.includes('thumb') === false, 'jpeg: warnings & high risk');
  ok(ji.meta.filter(m => m.kind === 'app').length === 1 && /APP5/.test(ji.meta.find(m => m.kind === 'app').label), 'jpeg: unknown APP5 listed');
  const exifIfd = ji.tiff.ifds.exif;
  ok(exifIfd.find(e => e.name === 'ExposureTime').text === '1/250 s' && exifIfd.find(e => e.name === 'FNumber').text === 'f/5.6' && exifIfd.find(e => e.name === 'Flash').text === '關閉（16）', 'jpeg: tag table text formatting');
  ok(exifIfd.find(e => e.name === 'MakerNote').text === '（二進位 40 B）', 'jpeg: MakerNote shown as binary size');

  // --- JPEG strip: keep orientation ---
  const js = EX.strip(trailing, { keepIcc: true, orientation: 6 });
  ok(same(EX.imageData(js.bytes), EX.imageData(JPG)), 'jpeg strip: DQT/SOF/DHT + scan data byte-identical to original');
  const jsi = EX.parse(js.bytes);
  ok(jsi.summary.count === 1 && jsi.summary.orientation === 6 && !jsi.xmp && !jsi.iptc && jsi.comments.length === 0 && jsi.trailing === 0, 'jpeg strip: only Orientation remains');
  ok(jsi.icc && jsi.meta.filter(m => m.kind !== 'icc' && m.kind !== 'exif').length === 0, 'jpeg strip: ICC kept, nothing else');
  ok(jsi.summary.fields.every(f => ['size', 'orientation', 'icc'].includes(f.key)) && jsi.summary.risk === 'clean', 'jpeg strip: summary clean');
  const kinds = js.removed.map(r => r.kind).sort().join(',');
  ok(kinds === 'app,comment,exif,iptc,trailing,xmp', 'jpeg strip: removed list ' + kinds);
  ok(js.bytes[0] === 0xFF && js.bytes[1] === 0xD8 && js.bytes[js.bytes.length - 2] === 0xFF && js.bytes[js.bytes.length - 1] === 0xD9, 'jpeg strip: SOI…EOI framing');
  const jsDec = await decode(js.bytes); ok(jsDec && jsDec[0] === 48 && jsDec[1] === 64, 'jpeg strip: decodes in Chromium with orientation applied ' + jsDec);
  // --- JPEG strip: drop everything, drop ICC ---
  const jd = EX.strip(trailing, { keepIcc: false, orientation: 0 });
  const jdi = EX.parse(jd.bytes);
  ok(jdi.tiff === null && jdi.meta.length === 0 && jdi.summary.count === 0 && !jdi.icc, 'jpeg strip (all): zero metadata blocks');
  ok(same(EX.imageData(jd.bytes), EX.imageData(JPG)), 'jpeg strip (all): image data identical');
  ok(jd.removed.some(r => r.kind === 'icc'), 'jpeg strip (all): ICC reported removed');
  const jdDec = await decode(jd.bytes); ok(jdDec && jdDec[0] === 64 && jdDec[1] === 48, 'jpeg strip (all): decodes, unrotated');
  ok(jd.bytes.length < trailing.length && jd.bytes.length <= JPG.length, 'jpeg strip (all): no larger than the untouched original');
  // idempotent
  const jd2 = EX.strip(jd.bytes, { keepIcc: false, orientation: 0 }); ok(same(jd2.bytes, jd.bytes) && jd2.removed.length === 0, 'jpeg strip: idempotent');
  // APP14 Adobe kept, JFIF kept
  const adobe = EX.jpegInsertExif(JPG, fullTiff(1, false), [{ marker: 0xEE, payload: EX.concat([EX.encStr('Adobe'), new Uint8Array([0, 100, 0, 0, 0, 0, 1])]) }]);
  const ad = EX.parse(EX.strip(adobe, {}).bytes);
  ok(ad.segs.some(s => s.kind === 'adobe') && ad.segs.some(s => s.kind === 'jfif') && !ad.tiff, 'jpeg strip: APP14 Adobe and JFIF APP0 kept, EXIF dropped');
  let threw = false; try { EX.strip(JPG.subarray(0, 100), {}); } catch (e) { threw = true; } ok(threw, 'jpeg strip: truncated file throws instead of producing garbage');
  // truncated EXIF does not crash parse
  const cut = trailing.subarray(0, 300); const ci = EX.parse(cut); ok(ci.format === 'jpeg' && ci.summary, 'jpeg parse: truncated input survives');

  // --- PNG ---
  const png = EX.pngInsert(PNG, [
    EX.pngChunk('eXIf', fullTiff(3, true)),
    EX.pngChunk('tEXt', EX.concat([EX.encStr('Software'), new Uint8Array([0]), EX.encStr('Screenshot tool')])),
    EX.pngChunk('iTXt', EX.concat([EX.encStr('XML:com.adobe.xmp'), new Uint8Array([0, 0, 0, 0, 0]), EX.encStr(xmp)])),
    EX.pngChunk('zTXt', EX.concat([EX.encStr('Comment'), new Uint8Array([0, 0, 120, 156, 3, 0, 0, 0, 0, 1])])),
    EX.pngChunk('tIME', new Uint8Array([7, 233, 10, 4, 9, 42, 11]))
  ]);
  const pi = EX.parse(png);
  ok(pi.format === 'png' && pi.width === 64 && pi.height === 48, 'png: IHDR dimensions');
  ok(fval(pi, 'time') === '2025/10/04 17:42:18（UTC+08:00）' && fval(pi, 'camera') === 'Canon EOS R6' && /旋轉 180°/.test(fval(pi, 'orientation')), 'png summary: EXIF from eXIf (little-endian)');
  ok(fval(pi, 'pngtext') === 'Software：Screenshot tool；Comment：（壓縮文字 8 B）', 'png summary: text chunks ' + fval(pi, 'pngtext'));
  ok(pi.xmp && /作者/.test(fval(pi, 'xmp')), 'png summary: XMP from iTXt');
  ok(pi.meta.some(m => m.kind === 'time' && m.text === '2025/10/04 09:42:11 UTC'), 'png: tIME parsed');
  ok(pi.summary.gps && pi.summary.risk === 'high', 'png summary: GPS and high risk');
  const ps = EX.strip(png, { keepIcc: true, orientation: 3 });
  ok(same(EX.imageData(ps.bytes), EX.imageData(PNG)), 'png strip: IHDR/IDAT chunks byte-identical');
  const psi = EX.parse(ps.bytes);
  ok(psi.summary.count === 1 && psi.summary.orientation === 3 && psi.texts.length === 0 && !psi.xmp && !psi.pngTime, 'png strip: only orientation eXIf remains');
  ok(ps.removed.length === 5 && ps.removed.filter(r => r.kind === 'text').length === 3, 'png strip: removed 5 chunks (3 text)');
  const psc = EX.pngChunk('eXIf', EX.orientationTiff(3)); const chunks = ps.bytes;
  ok(Buffer.from(chunks).indexOf(Buffer.from(psc)) > 0, 'png strip: eXIf chunk CRC matches our writer');
  const psDec = await decode(ps.bytes); ok(psDec && psDec[0] === 64 && psDec[1] === 48, 'png strip: decodes in Chromium ' + psDec);
  const pd = EX.strip(png, { keepIcc: false, orientation: 0 });
  ok(EX.parse(pd.bytes).meta.length === 0 && same(pd.bytes, EX.strip(PNG, {}).bytes), 'png strip (all): identical to stripping the pristine PNG');
  ok((await decode(pd.bytes)) !== null, 'png strip (all): decodes');
  // crc32 reference
  ok(EX.crc32(EX.encStr('123456789'), 0, 9) === 0xCBF43926, 'crc32 reference vector');

  // --- WebP ---
  const webp = EX.webpWithMeta(WEBP, { exif: EX.concat([EX.encStr('Exif\0\0'), fullTiff(8, false)]), xmp, icc: EX.encStr('fake icc profile') });
  const wi = EX.parse(webp);
  ok(wi.format === 'webp' && wi.width === 64 && wi.height === 48 && wi.vp8x && (wi.vp8x.flags & 0x2C) === 0x2C, 'webp: VP8X flags for ICC+EXIF+XMP set, dimensions');
  ok(fval(wi, 'camera') === 'Canon EOS R6' && /逆時針旋轉 90°/.test(fval(wi, 'orientation')) && wi.summary.gps, 'webp summary: EXIF chunk with Exif\\0\\0 prefix parsed');
  ok(wi.xmp && wi.icc === 16 && fval(wi, 'icc').startsWith('16 B'), 'webp summary: XMP and ICC');
  const ws = EX.strip(webp, { keepIcc: true, orientation: 8 });
  ok(same(EX.imageData(ws.bytes), EX.imageData(WEBP)), 'webp strip: VP8/VP8L/ALPH payload byte-identical');
  const wsi = EX.parse(ws.bytes);
  ok(wsi.summary.count === 1 && wsi.summary.orientation === 8 && !wsi.xmp && wsi.icc === 16, 'webp strip: orientation EXIF + ICC remain, XMP gone');
  ok((wsi.vp8x.flags & 0x04) === 0 && (wsi.vp8x.flags & 0x08) && (wsi.vp8x.flags & 0x20), 'webp strip: VP8X flags updated (XMP cleared, EXIF+ICC set)');
  const riff = ws.bytes[4] | (ws.bytes[5] << 8) | (ws.bytes[6] << 16) | (ws.bytes[7] << 24);
  ok(riff === ws.bytes.length - 8 && ws.bytes.length % 2 === 0, 'webp strip: RIFF size correct and even');
  const wsDec = await decode(ws.bytes); ok(wsDec && wsDec[0] + wsDec[1] === 112, 'webp strip: decodes in Chromium ' + wsDec);
  const wd = EX.strip(webp, { keepIcc: false, orientation: 0 });
  const wdi = EX.parse(wd.bytes);
  ok(wdi.meta.length === 0 && wdi.tiff === null && (wdi.vp8x.flags & 0x2C) === 0, 'webp strip (all): no metadata chunks, flags cleared');
  ok(same(EX.imageData(wd.bytes), EX.imageData(WEBP)), 'webp strip (all): image payload identical');
  const wdDec = await decode(wd.bytes); ok(wdDec && wdDec[0] === 64 && wdDec[1] === 48, 'webp strip (all): decodes');
  const wplain = EX.strip(WEBP, {}); ok(same(wplain.bytes, WEBP) || same(EX.imageData(wplain.bytes), EX.imageData(WEBP)), 'webp strip: pristine simple file unchanged');
  const wori = EX.strip(WEBP, { orientation: 6 }); const woi = EX.parse(wori.bytes);
  ok(woi.vp8x && woi.summary.orientation === 6 && (await decode(wori.bytes)) !== null, 'webp strip: simple file gains VP8X + EXIF orientation and still decodes');
  ok(fval(EX.parse(EX.webpWithMeta(WEBP, { exif: fullTiff(1, false) })), 'camera') === 'Canon EOS R6', 'webp: EXIF chunk without Exif\\0\\0 prefix also parsed');


  // --- HEIC / AVIF (ISOBMFF): Exif + XMP items are wiped in place, every other byte untouched ---
  const { buildHeif } = require('./heif-fixture.js');
  const hevc = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 255);
  const heTiff = fullTiff(6, false);
  const heExif = EX.concat([Uint8Array.from([0, 0, 0, 6]), EX.encStr('Exif\0\0'), heTiff]);
  for (const split of [false, true]) {
    const hf = buildHeif({ split, items: [{ id: 1, type: 'hvc1', data: hevc }, { id: 2, type: 'Exif', data: heExif, cdsc: 1 }, { id: 3, type: 'mime', mime: 'application/rdf+xml', data: EX.encStr(xmp), cdsc: 1 }] });
    const hi = EX.parse(hf);
    ok(hi.format === 'heic' && hi.width === 64 && hi.height === 48, `heic${split ? ' (2 extents)' : ''}: format + ispe dimensions`);
    ok(fval(hi, 'camera') === 'Canon EOS R6' && hi.summary.orientation === 6 && Math.abs(hi.summary.gps.lat + 33.8688) < 1e-4 && hi.summary.risk === 'high', `heic${split ? ' (2 extents)' : ''}: EXIF item parsed (camera, orientation, GPS)`);
    ok(/作者/.test(fval(hi, 'xmp')) && fval(hi, 'serial') === '093021004512', 'heic: XMP item + serial');
    for (const o of [0, 6]) {
      const hs = EX.strip(hf, { orientation: o });
      ok(hs.bytes.length === hf.length && hs.removed.map(r => r.kind).sort().join() === 'exif,xmp', `heic strip o=${o}: same length, removed exif+xmp`);
      let outside = 0; const ranges = EX.heifItems(hf).items.filter(i => i.type !== 'hvc1').flatMap(i => i.extents);
      for (let k = 0; k < hf.length; k++) if (hf[k] !== hs.bytes[k] && !ranges.some(([a, l]) => k >= a && k < a + l)) outside++;
      ok(outside === 0, `heic strip o=${o}: only metadata item bytes changed`);
      const hsi = EX.parse(hs.bytes);
      ok(!hsi.summary.gps && !hsi.xmp && hsi.summary.count === (o ? 1 : 0) && hsi.summary.orientation === (o || 1) && hsi.summary.risk === 'clean', `heic strip o=${o}: re-parse clean`);
      ok(['Canon', '093021004512', '林小美', 'Lightroom'].every(w => Buffer.from(hs.bytes).indexOf(w) < 0), `heic strip o=${o}: no identifying strings left in the bytes`);
      ok(EX.strip(hs.bytes, { orientation: o }).removed.length === 0, `heic strip o=${o}: idempotent`);
    }
  }
  const avifF = buildHeif({ brand: 'avif', compat: ['mif1', 'avif'], items: [{ id: 1, type: 'av01', data: hevc }, { id: 2, type: 'Exif', data: heExif }] });
  ok(EX.sniff(avifF) === 'avif' && EX.parse(avifF).summary.gps, 'avif: sniffed and EXIF parsed');
  ok(EX.sniff(buildHeif({ brand: 'mif1', compat: ['mif1', 'avif', 'miaf'], items: [{ id: 1, type: 'av01', data: hevc }] })) === 'avif', 'avif: mif1 major brand with avif compat');
  let hthrew = false; try { EX.strip(heic, {}); } catch (e) { hthrew = true; } ok(hthrew && EX.parse(heic).broken, 'heic without meta box: reported broken, strip refuses');
  ok(EX.parse(hf0trunc()).format === 'heic', 'heic: truncated file survives parse');
  function hf0trunc() { const f = buildHeif({ items: [{ id: 1, type: 'hvc1', data: hevc }, { id: 2, type: 'Exif', data: heExif }] }); return f.subarray(0, 200); }

  // --- formatting / edge cases found in review ---
  ok(EX.fmtExposure(0.3) === '0.3 s' && EX.fmtExposure(1 / 3) === '1/3 s' && EX.fmtExposure(0.0166) === '1/60 s' && EX.fmtExposure(0.4) === '0.4 s' && EX.fmtExposure(1 / 8000) === '1/8000 s', 'fmtExposure: 0.3 s is not shown as 1/3 s');
  const t35 = EX.buildTiff({ ifd0: { 0x0110: { t: 2, v: 'X' } }, exif: { 0x920A: { t: 5, v: [26, 1] }, 0xA405: { t: 3, v: 26 } } }, false);
  ok(fval(EX.parse(EX.jpegInsertExif(JPG, t35)), 'exposure') === '26 mm', 'exposure: 35 mm equivalent omitted when equal');
  const t00 = EX.buildTiff({ ifd0: { 0x0110: { t: 2, v: 'X' } }, gps: { 1: { t: 2, v: 'N' }, 2: { t: 5, v: [[0, 1], [0, 1], [0, 1]] }, 3: { t: 2, v: 'E' }, 4: { t: 5, v: [[0, 1], [0, 1], [0, 1]] } } }, false);
  const i00 = EX.parse(EX.jpegInsertExif(JPG, t00));
  ok(!i00.summary.gps && /沒有定位/.test(fval(i00, 'gps')) && i00.summary.risk !== 'high', 'GPS 0,0 (no fix) not reported as a location');
  const tbad = EX.buildTiff({ ifd0: { 0x0110: { t: 2, v: 'X' } }, gps: { 2: { t: 5, v: [[95, 1], [0, 1], [0, 1]] }, 4: { t: 5, v: [[10, 1], [0, 1], [0, 1]] } } }, false);
  ok(/損壞/.test(fval(EX.parse(EX.jpegInsertExif(JPG, tbad)), 'gps')), 'GPS out of range explained as corrupt');
  const ucBE = EX.concat([EX.encStr('UNICODE\0'), Uint8Array.from([0x5F, 0x35, 0x4E, 0x09])]); // 張三 big-endian
  const ucLE = EX.concat([EX.encStr('UNICODE\0'), Uint8Array.from([0x35, 0x5F, 0x09, 0x4E])]);
  ok(fval(EX.parse(EX.jpegInsertExif(JPG, EX.buildTiff({ ifd0: { 0x0110: { t: 2, v: 'X' } }, exif: { 0x9286: { t: 7, v: ucBE } } }, false))), 'comment') === '張三', 'UserComment UNICODE big-endian (MM file)');
  ok(fval(EX.parse(EX.jpegInsertExif(JPG, EX.buildTiff({ ifd0: { 0x0110: { t: 2, v: 'X' } }, exif: { 0x9286: { t: 7, v: ucLE } } }, true))), 'comment') === '張三', 'UserComment UNICODE little-endian (II file)');
  ok(EX.parse(EX.jpegInsertExif(JPG, fullTiff(1, false))).summary.count === 35, 'tag count excludes IFD pointer tags: ' + EX.parse(EX.jpegInsertExif(JPG, fullTiff(1, false))).summary.count);
  const emptyX = EX.jpegInsertExif(JPG, EX.orientationTiff(1), [{ marker: 0xE1, payload: EX.concat([EX.encStr('http://ns.adobe.com/xap/1.0/\0'), EX.encStr('<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>')]) }]);
  ok(!EX.parse(emptyX).xmp && EX.parse(emptyX).meta.find(m => m.kind === 'xmp').empty, 'empty XMP packet is not flagged as personal data');
  // garbage / edge inputs never throw from parse
  for (const g of [new Uint8Array(0), Uint8Array.from([0xFF, 0xD8]), Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF]), EX.concat([PNG.subarray(0, 8)]), EX.encStr('RIFF\x10\0\0\0WEBPVP8X'), EX.encStr('\0\0\0\x08ftyp')]) {
    let e = null; try { EX.parse(g); } catch (x) { e = x; } ok(!e, 'parse never throws on garbage (' + g.length + ' B) ' + (e && e.message));
  }

  // truncated files: no scan data → refused with a reason; cut-off tail → stripped and closed with EOI
  ok(EX.parse(trailing.subarray(0, 400)).broken, 'jpeg cut inside the header is reported broken');
  const tail = JPG.subarray(0, JPG.length - 20), tailI = EX.parse(EX.jpegInsertExif(tail, fullTiff(1, false)));
  ok(tailI.cutTail && !tailI.broken && tailI.summary.gps, 'jpeg with a cut-off tail still parsed');
  const tailS = EX.strip(EX.jpegInsertExif(tail, fullTiff(1, false)), {});
  ok(EX.parse(tailS.bytes).tiff === null && tailS.bytes[tailS.bytes.length - 2] === 0xFF && tailS.bytes[tailS.bytes.length - 1] === 0xD9 && Buffer.from(tailS.bytes).indexOf(Buffer.from(tail.subarray(tail.length - 60))) === tailS.bytes.length - 62, 'jpeg cut-off tail: every scan byte kept, closed with EOI, EXIF gone');
  ok(EX.parse(png.subarray(0, png.length - 30)).broken && EX.parse(webp.subarray(0, 40)).broken, 'png / webp truncated → broken');
  // --- helpers ---
  ok(EX.fmtExposure(1 / 250) === '1/250 s' && EX.fmtExposure(2.5) === '2.5 s' && EX.fmtExposure(0.5) === '1/2 s', 'fmtExposure');
  ok(EX.fmtBytes(512) === '512 B' && EX.fmtBytes(2048) === '2.0 KB' && EX.fmtBytes(3 * 1048576) === '3.00 MB', 'fmtBytes');
  const dms = EX.gpsDms(25.10968); ok(dms[0][0] === 25 && dms[1][0] === 6 && Math.abs(dms[2][0] / dms[2][1] - 34.848) < 0.01, 'gpsDms');

  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
