// PDF 工具箱核心測試：node tests.js
// 從 ../index.html 的 CORE 標記之間取出 PDF 讀寫核心，用三種來源的 PDF 測：Chromium（Playwright page.pdf）、
// 自家 writer 產生的、以及手工組出的 xref stream + object stream + 增量更新檔；輸出再用自家解析器、
// pypdf（若有）、qpdf（若有）與 Chromium 檢查。
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os'), { spawnSync } = require('child_process');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const PDF = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return PDF;')();
const { N, Ref, PStr, Stream, PDFDoc, PDFWriter, PDFError } = PDF;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-tools-'));
const save = (name, bytes) => { const f = path.join(TMP, name); fs.writeFileSync(f, bytes); return f; };
const b2s = b => Buffer.from(b).toString('latin1');
const hasQpdf = spawnSync('which', ['qpdf']).status === 0;
const hasPypdf = spawnSync('python3', ['-I', '-c', 'import pypdf']).status === 0;
function pypdf(file) {
  if (!hasPypdf) return null;
  const r = spawnSync('python3', ['-I', '-c', `import pypdf,json,sys\nr=pypdf.PdfReader(sys.argv[1],strict=False)\nprint(json.dumps({"n":len(r.pages),"rot":[p.get("/Rotate") or 0 for p in r.pages],"text":[p.extract_text() for p in r.pages],"size":[[float(p.mediabox.width),float(p.mediabox.height)] for p in r.pages]}))`, file], { encoding: 'utf8' });
  if (r.status !== 0) { console.log('   pypdf error:', r.stderr.trim().split('\n').pop()); return { err: r.stderr }; }
  return JSON.parse(r.stdout);
}
function qpdf(file) { if (!hasQpdf) return null; const r = spawnSync('qpdf', ['--check', file], { encoding: 'utf8' }); return { status: r.status, out: r.stdout + r.stderr }; }
function checkOut(name, bytes, expectPages) {
  const f = save(name, bytes), c = PDF.check(bytes);
  ok(c.pages.length === expectPages && c.issues.length === 0, `${name}: 自家解析 ${c.pages.length} 頁，問題 ${JSON.stringify(c.issues)}`);
  const py = pypdf(f); if (py) ok(!py.err && py.n === expectPages, `${name}: pypdf ${py.n} 頁`);
  const q = qpdf(f); if (q) ok(q.status === 0, `${name}: qpdf --check ${q.out.slice(0, 200)}`);
  return { file: f, check: c, py };
}

// ---------- inflate / deflate ----------
{
  const txt = Buffer.from('hello hello hello '.repeat(3000) + 'tail');
  for (const level of [0, 1, 6, 9]) ok(Buffer.compare(Buffer.from(PDF.inflate(new Uint8Array(zlib.deflateSync(txt, { level })))), txt) === 0, 'inflate level ' + level);
  const rnd = Buffer.alloc(200000); for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 7919 ^ (i >> 3) ^ (i >> 11)) & 255;
  ok(Buffer.compare(Buffer.from(PDF.inflate(new Uint8Array(zlib.deflateSync(rnd)))), rnd) === 0, 'inflate random data');
  ok(Buffer.compare(Buffer.from(PDF.inflate(new Uint8Array(zlib.deflateRawSync(txt)))), txt) === 0, 'inflate raw deflate (no zlib header)');
  const trunc = PDF.inflate(new Uint8Array(zlib.deflateSync(txt)).subarray(0, 40));
  ok(trunc.truncated === true && trunc.length > 0, 'truncated stream returns partial data with flag');
  ok(PDF.inflate(new Uint8Array([1, 2, 3])).truncated === true, 'garbage does not throw');
  ok(Buffer.compare(zlib.inflateSync(Buffer.from(PDF.storeDeflate(rnd))), rnd) === 0, 'storeDeflate is valid zlib');
}
// ---------- lexer / parser ----------
{
  const src = PDF.bytesOf('<< /A#20B (str\\)ing\\101\\n) /Hex <48 65 6c6c6f> /Arr [1 -2.5 3 0 R true null /N] /Nested << /K 5 0 R >> /Empty () >>');
  const p = new PDF.Parser(src, 0);
  const o = p.parse();
  ok(o instanceof Map && o.has('A B'), 'name with #20 escape');
  ok(b2s(o.get('A B').bytes) === 'str)ingA\n', 'literal string escapes: ' + JSON.stringify(b2s(o.get('A B').bytes)));
  ok(b2s(o.get('Hex').bytes) === 'Hello', 'hex string with whitespace');
  const a = o.get('Arr'); ok(a.length === 6 && a[0] === 1 && a[1] === -2.5 && a[2] instanceof Ref && a[2].num === 3 && a[3] === true && a[4] === null && a[5].name === 'N', 'array with ref/bool/null/name');
  ok(o.get('Nested').get('K') instanceof Ref && o.get('Nested').get('K').num === 5, 'nested dict ref');
  ok(o.get('Empty').bytes.length === 0, 'empty string');
}
// ---------- writer sample + parse ----------
let sampleBytes, sampleDoc;
{
  sampleBytes = PDF.samplePdf({ title: 'Writer Sample', pages: [{ size: [595.276, 841.89], lines: ['alpha', 'beta'], boxes: 3 }, { size: [612, 792], rotate: 90, lines: ['gamma'] }, { size: [792, 612], lines: ['delta'] }] });
  const r = checkOut('writer-sample.pdf', sampleBytes, 3);
  sampleDoc = r.check.doc;
  ok(sampleDoc.pages[1].rotate === 90 && sampleDoc.pages[0].rotate === 0, 'writer sample: /Rotate parsed');
  ok(Math.abs(sampleDoc.pages[0].width - 595.276) < 0.01 && sampleDoc.pages[2].width === 792, 'writer sample: page sizes');
  if (r.py && !r.py.err) ok(/alpha/.test(r.py.text[0]) && /gamma/.test(r.py.text[1]), 'writer sample: pypdf extracts text');
  ok(PDF.pageSizeName(595.3, 841.9) === 'A4' && PDF.pageSizeName(792, 612) === 'Letter' && PDF.pageSizeName(500, 500) === null, 'pageSizeName');
}
// ---------- hand-built: xref stream + object stream + incremental update ----------
function buildXrefStreamPdf() {
  // objects 1 (catalog), 2 (pages), 3 (page) live in object stream 5; 4 = content stream; 6 = xref stream
  const content = 'BT /F1 24 Tf 72 700 Td (ObjStm page) Tj ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 400 500] /Rotate 90 /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'];
  let hdr = '', body = ''; objs.forEach((o, i) => { hdr += (i + 1) + ' ' + body.length + ' '; body += o + '\n'; });
  const stmData = zlib.deflateSync(Buffer.from(hdr + body));
  let out = '%PDF-1.5\n%\xe2\xe3\xcf\xd3\n'; const offs = {};
  offs[4] = out.length; out += '4 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n';
  offs[5] = out.length; out += '5 0 obj\n<< /Type /ObjStm /N 3 /First ' + hdr.length + ' /Length ' + stmData.length + ' /Filter /FlateDecode >>\nstream\n' + stmData.toString('latin1') + '\nendstream\nendobj\n';
  offs[6] = out.length;
  // xref stream rows: W [1 4 2], with PNG Up predictor (Columns 7)
  const rows = [[0, 0, 65535], [2, 5, 0], [2, 5, 1], [2, 5, 2], [1, offs[4], 0], [1, offs[5], 0], [1, offs[6], 0]];
  const raw = Buffer.alloc(rows.length * 8); let prev = Buffer.alloc(7);
  rows.forEach((r, i) => { const row = Buffer.alloc(7); row[0] = r[0]; row.writeUInt32BE(r[1], 1); row.writeUInt16BE(r[2], 5); raw[i * 8] = 2; for (let k = 0; k < 7; k++) raw[i * 8 + 1 + k] = (row[k] - prev[k]) & 255; prev = row; });
  const xdata = zlib.deflateSync(raw);
  out += '6 0 obj\n<< /Type /XRef /Size 7 /W [1 4 2] /Root 1 0 R /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> /Length ' + xdata.length + ' >>\nstream\n' + xdata.toString('latin1') + '\nendstream\nendobj\n';
  out += 'startxref\n' + offs[6] + '\n%%EOF\n';
  const firstXref = offs[6];
  // incremental update: new page object 3 (rotate 0 override, different MediaBox) + classic xref table with /Prev
  const o3 = out.length; out += '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Rotate 0 /MediaBox [0 0 300 300] >>\nendobj\n';
  const x2 = out.length;
  out += 'xref\n0 1\n0000000000 65535 f \n3 1\n' + String(o3).padStart(10, '0') + ' 00000 n \ntrailer\n<< /Size 7 /Root 1 0 R /Prev ' + firstXref + ' >>\nstartxref\n' + x2 + '\n%%EOF\n';
  return { bytes: Buffer.from(out, 'latin1'), firstEnd: x2 };
}
let handDoc;
{
  const { bytes } = buildXrefStreamPdf();
  const r = checkOut('hand-xrefstm.pdf', new Uint8Array(bytes), 1);
  handDoc = r.check.doc;
  ok(handDoc.pages[0].rotate === 0 && handDoc.pages[0].width === 300 && handDoc.pages[0].height === 300, 'incremental update wins: page 3 overridden (rotate 0, 300×300)');
  ok(handDoc.xref.get(1).inStream === 5 && handDoc.fetch(new Ref(1, 0)).get('Type').name === 'Catalog', 'catalog read from object stream via xref stream');
  ok(!handDoc.reconstructed, 'xref stream + Prev chain parsed without reconstruction');
  // without the update: inherited attributes from the Pages node
  const first = bytes.subarray(0, bytes.indexOf(Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Rotate 0')));
  const d0 = new PDFDoc(new Uint8Array(Buffer.concat([first, Buffer.from('startxref\n' + (bytes.indexOf(Buffer.from('6 0 obj'))) + '\n%%EOF\n')])));
  ok(d0.pages.length === 1 && d0.pages[0].rotate === 90 && d0.pages[0].width === 400 && d0.pages[0].height === 500, 'inherited /Rotate and /MediaBox from Pages node');
  ok(d0.fetch(d0.pages[0].attrs.Resources) instanceof Map && d0.fetch(d0.pages[0].attrs.Resources).has('Font'), 'inherited /Resources');
  // copy that page: output page carries inherited values explicitly
  const out = PDF.buildPdf([{ kind: 'pdf', doc: d0, page: d0.pages[0], rot: 90 }]);
  const c = checkOut('hand-copied.pdf', out, 1);
  const pg = c.check.pages[0];
  ok(pg.rotate === 180 && pg.width === 400 && pg.dict.has('Resources') && c.check.doc.fetch(pg.dict.get('Resources')).has('Font'), 'copied page: rotate 90+90=180, box and resources inlined');
  if (c.py && !c.py.err) ok(/ObjStm page/.test(c.py.text[0]), 'copied page text extractable by pypdf');
  // damaged xref offsets -> reconstruction
  const broken = Buffer.from(bytes); const sx = broken.lastIndexOf('startxref'); broken.write('startxref\n999999999\n%%EOF\n', sx, 'latin1');
  const db = new PDFDoc(new Uint8Array(broken));
  ok(db.reconstructed && db.pages.length === 1 && db.pages[0].width === 300, 'bad startxref → scan reconstruction finds the updated page');
  // encrypted
  let enc = null; try { new PDFDoc(new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n3 0 obj<</Filter/Standard/V 1/R 2/O<00>/U<00>/P -1>>endobj\ntrailer<</Root 1 0 R/Encrypt 3 0 R>>\n%%EOF'))); } catch (e) { enc = e; }
  ok(enc instanceof PDFError && enc.code === 'encrypted', 'encrypted PDF detected: ' + (enc && enc.code));
  let np = null; try { new PDFDoc(new Uint8Array(Buffer.from('hello world'))); } catch (e) { np = e; }
  ok(np instanceof PDFError && np.code === 'notpdf', 'non-PDF rejected');
  // hybrid file: classic table marking objects free + /XRefStm supplying them
  const hybridSrc = bytes.subarray(0, bytes.indexOf(Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Rotate 0')));
  const xo = bytes.indexOf(Buffer.from('6 0 obj'));
  const hy = Buffer.concat([hybridSrc, Buffer.from('xref\n0 4\n0000000000 65535 f \n0000000000 65535 f \n0000000000 65535 f \n0000000000 65535 f \ntrailer\n<< /Size 7 /Root 1 0 R /XRefStm ' + xo + ' >>\nstartxref\n' + hybridSrc.length + '\n%%EOF\n')]);
  const hd = new PDFDoc(new Uint8Array(hy));
  ok(!hd.reconstructed && hd.pages.length === 1 && hd.pages[0].rotate === 90, 'hybrid /XRefStm entries override free table entries');
}
// ---------- images ----------
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function makePng(w, h, colorType, pix, extra) {
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = colorType; ihdr[12] = 0;
  const bpp = { 0: 1, 2: 3, 3: 1, 6: 4 }[colorType], raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * bpp + 1)] = 0; for (let x = 0; x < w * bpp; x++) raw[y * (w * bpp + 1) + 1 + x] = pix(x, y); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...(extra || []), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let imgPdfBytes;
(async () => {
  {
    const rgb = makePng(8, 6, 2, (x, y) => (x * 31 + y * 7) & 255), info = PDF.parsePNG(new Uint8Array(rgb));
    ok(info.width === 8 && info.height === 6 && info.colorType === 2 && info.direct, 'PNG RGB parsed, direct embed');
    const img = PDF.pngImage(info);
    ok(img.dict.get('ColorSpace').name === 'DeviceRGB' && img.dict.get('DecodeParms').get('Predictor') === 15 && img.dict.get('DecodeParms').get('Colors') === 3, 'PNG image dict uses FlateDecode + PNG predictors');
    const rgba = makePng(4, 4, 6, (x, y) => x & 1 ? 255 : 10), infoA = PDF.parsePNG(new Uint8Array(rgba));
    ok(!infoA.direct, 'PNG with alpha is not direct-embedded (goes through canvas → SMask)');
    const pal = makePng(4, 4, 3, () => 0, [(() => { const len = Buffer.alloc(4); len.writeUInt32BE(6); const td = Buffer.concat([Buffer.from('PLTE'), Buffer.from([255, 0, 0, 0, 0, 255])]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); })()]);
    const infoP = PDF.parsePNG(new Uint8Array(pal)); const imgP = PDF.pngImage(infoP);
    ok(infoP.direct && Array.isArray(imgP.dict.get('ColorSpace')) && imgP.dict.get('ColorSpace')[2] === 1, 'palette PNG → /Indexed colour space (hival 1)');
    // RGBA pixels → RGB + SMask
    const px = new Uint8Array(4 * 6 * 4); for (let i = 0; i < px.length; i += 4) { px[i] = 200; px[i + 1] = 100; px[i + 2] = 50; px[i + 3] = i < 32 ? 128 : 255; }
    const ri = await PDF.rgbaImage(px, 4, 6);
    ok(ri.smask && ri.width === 4 && ri.height === 6, 'rgbaImage builds SMask when alpha present');
    ok(Buffer.compare(zlib.inflateSync(Buffer.from(ri.raw)).subarray(0, 3), Buffer.from([200, 100, 50])) === 0, 'rgbaImage RGB data is zlib (inflates to pixels)');
    const ri2 = await PDF.rgbaImage(new Uint8Array([1, 2, 3, 255]), 1, 1); ok(!ri2.smask, 'opaque pixels → no SMask');
    // JPEG with EXIF orientation 6 and Adobe CMYK marker
    const exif = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, 0]), Buffer.from('Exif\0\0'), exif]); app1.writeUInt16BE(app1.length - 2, 2);
    const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x01, 0x90, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
    const ji = PDF.parseJPEG(new Uint8Array(jpg));
    ok(ji.width === 400 && ji.height === 300 && ji.comps === 3 && ji.orientation === 6, 'JPEG SOF + EXIF orientation parsed: ' + JSON.stringify(ji));
    const jimg = PDF.jpegImage(new Uint8Array(jpg), ji);
    ok(jimg.dict.get('Filter').name === 'DCTDecode' && jimg.dict.get('ColorSpace').name === 'DeviceRGB', 'JPEG image dict DCTDecode/DeviceRGB');
    const sofC = Buffer.from(sof); sofC[3] = 20; sofC[9] = 4; const jc = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xee, 0, 7, 0x41, 0x64, 0x6f, 0x62, 0x65]), sofC.subarray(0, 10), Buffer.from([1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 4, 0x11, 1]), Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
    const jci = PDF.parseJPEG(new Uint8Array(jc)); const jcimg = PDF.jpegImage(new Uint8Array(jc), jci);
    ok(jci.comps === 4 && jci.adobe && jcimg.dict.get('ColorSpace').name === 'DeviceCMYK' && jcimg.dict.get('Decode').length === 8, 'Adobe CMYK JPEG → DeviceCMYK with inverted Decode');
    // layout
    const lay = PDF.imageLayout({ width: 400, height: 300, orientation: 1 }, { size: 'a4', margin: 10 });
    ok(Math.abs(lay.pw - 841.89) < 0.01 && Math.abs(lay.ph - 595.276) < 0.01 && lay.W <= lay.pw - 2 * 28.3 && Math.abs(lay.W / lay.H - 4 / 3) < 1e-6, 'landscape image → landscape A4 with 10 mm margin, aspect kept');
    const lay6 = PDF.imageLayout({ width: 400, height: 300, orientation: 6 }, { size: 'letter', margin: 0 });
    ok(lay6.pw === 612 && lay6.ph === 792 && lay6.W === 594 && lay6.H === 792, 'EXIF orientation 6 swaps to portrait Letter, no margin');
    const layF = PDF.imageLayout({ width: 2000, height: 1000, orientation: 1 }, { size: 'fit', margin: 5 });
    ok(Math.abs(layF.pw - (841.89 + 2 * 5 * 72 / 25.4)) < 0.01 && Math.abs(layF.ph - (420.945 + 2 * 5 * 72 / 25.4)) < 0.01, 'fit page: image scaled to A4 long edge plus margins');
    const m6 = PDF.imageMatrix(6, 10, 20, 100, 200); ok(m6.join(',') === '0,-200,100,0,10,220', 'orientation 6 matrix [0 -H W 0 x y+H]: ' + m6.join(','));
    const m1 = PDF.imageMatrix(1, 10, 20, 100, 200); ok(m1.join(',') === '100,0,0,200,10,20', 'orientation 1 matrix');
    const m3 = PDF.imageMatrix(3, 0, 0, 100, 200); ok(m3.join(',') === '-100,0,0,-200,100,200', 'orientation 3 matrix (180°)');
    // images → PDF
    imgPdfBytes = PDF.buildPdf([{ kind: 'image', img, rot: 0 }, { kind: 'image', img: jimg, rot: 90 }, { kind: 'image', img: ri, rot: 0 }], { size: 'a4', margin: 10 });
    const c = checkOut('images.pdf', imgPdfBytes, 3);
    ok(c.check.pages[1].rotate === 90 && Math.abs(c.check.pages[0].width - 841.89) < 0.01, 'image PDF: rotation and landscape A4 for a landscape image');
    const xo = c.check.doc.fetch(c.check.doc.fetch(c.check.pages[2].dict.get('Resources')).get('XObject').get('Im1'));
    ok(xo instanceof Stream && xo.dict.get('SMask') instanceof Ref, 'alpha image page has SMask reference');
  }
  // ---------- Chromium PDF + merge / extract / rotate ----------
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<h1>Chromium Fixture</h1>' + '<p style="font:14px serif">Lorem ipsum dolor sit amet, consectetur.</p>'.repeat(120) + '<h2 style="page-break-before:always">Second part</h2><p>tail</p>');
  const chromeBytes = new Uint8Array(await page.pdf({ format: 'A4', printBackground: true }));
  const chromeJpegB64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#48c'; x.fillRect(0, 0, 320, 200); x.fillStyle = '#fff'; x.font = '40px sans-serif'; x.fillText('JPEG', 100, 120); return c.toDataURL('image/jpeg', 0.85).split(',')[1]; });
  await browser.close();
  const chromeFile = save('chromium.pdf', chromeBytes);
  const cd = PDF.check(chromeBytes); const chromeDoc = cd.doc;
  ok(cd.pages.length >= 4 && cd.issues.length === 0 && !chromeDoc.reconstructed, `Chromium PDF parsed: ${cd.pages.length} pages, ${JSON.stringify(cd.issues)}`);
  ok(Math.abs(cd.pages[0].width - 595.9) < 2 && Math.abs(cd.pages[0].height - 842) < 2, 'Chromium page size ≈ A4');
  const cj = new Uint8Array(Buffer.from(chromeJpegB64, 'base64')), cji = PDF.parseJPEG(cj);
  ok(cji.width === 320 && cji.height === 200 && cji.comps === 3, 'real Chromium JPEG parsed');
  // merge: chromium p1 (rot 90) + sample p2 (already 90, +90) + hand page + image + chromium last page
  const last = chromeDoc.pages.length - 1;
  const merged = PDF.buildPdf([
    { kind: 'pdf', doc: chromeDoc, page: chromeDoc.pages[0], rot: 90 },
    { kind: 'pdf', doc: sampleDoc, page: sampleDoc.pages[1], rot: 90 },
    { kind: 'pdf', doc: handDoc, page: handDoc.pages[0], rot: 0 },
    { kind: 'image', img: PDF.jpegImage(cj, cji), rot: 0 },
    { kind: 'pdf', doc: chromeDoc, page: chromeDoc.pages[last], rot: 270 },
  ], { size: 'letter', margin: 0 });
  const mr = checkOut('merged.pdf', merged, 5);
  ok(mr.check.pages.map(p => p.rotate).join(',') === '90,180,0,0,270', 'merged rotations: ' + mr.check.pages.map(p => p.rotate).join(','));
  if (mr.py && !mr.py.err) {
    ok(mr.py.rot.join(',') === '90,180,0,0,270', 'pypdf sees the same rotations');
    ok(/Chromium Fixture/.test(mr.py.text[0]) && /gamma/.test(mr.py.text[1]) && /ObjStm page/.test(mr.py.text[2]) && /tail/.test(mr.py.text[4]), 'pypdf extracts text from every copied page');
  }
  // shared objects between pages of the same source are written once
  const twice = PDF.buildPdf([{ kind: 'pdf', doc: chromeDoc, page: chromeDoc.pages[0], rot: 0 }, { kind: 'pdf', doc: chromeDoc, page: chromeDoc.pages[1], rot: 0 }]);
  const once = PDF.buildPdf([{ kind: 'pdf', doc: chromeDoc, page: chromeDoc.pages[0], rot: 0 }]);
  const tr = checkOut('two-pages.pdf', twice, 2);
  ok(twice.length < once.length * 1.9, `shared font objects deduplicated (${once.length} → ${twice.length} bytes for 2 pages)`);
  // extract a single page: the output never drags other pages along
  const one = PDF.check(once);
  ok(one.pages.length === 1 && [...one.doc.xref.keys()].every(n => { const o = one.doc.getObj(n); return !(o instanceof Map && o.get('Type') && o.get('Type').name === 'Page' && n !== one.pages[0].ref.num); }), 'extracted output contains exactly one /Type /Page object');
  // round trip: output of our writer re-parsed and re-merged
  const rt = PDF.buildPdf([{ kind: 'pdf', doc: mr.check.doc, page: mr.check.pages[1], rot: 180 }, { kind: 'pdf', doc: mr.check.doc, page: mr.check.pages[3], rot: 0 }]);
  const rr = checkOut('roundtrip.pdf', rt, 2);
  ok(rr.check.pages[0].rotate === 0 && rr.check.pages[1].width === 792, 'round trip: 180+180 → 0, image page kept landscape Letter width');
  // ---------- Chromium loads the outputs (new headless has the PDF viewer) ----------
  let viewer = null; try { viewer = await chromium.launch({ channel: 'chromium' }); } catch (e) { console.log('   (無 chromium channel，略過 PDF viewer 測試)'); }
  if (viewer) {
    for (const f of [mr.file, path.join(TMP, 'images.pdf'), chromeFile]) {
      const p = await viewer.newPage({ viewport: { width: 800, height: 1000 } }); const errs = [];
      p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      let loaded = true; try { await p.goto('file://' + f, { timeout: 15000 }); await p.waitForTimeout(1200); } catch (e) { loaded = false; errs.push(e.message); }
      const type = loaded ? await p.evaluate(() => { const e = document.querySelector('embed'); return e && e.type; }).catch(() => null) : null;
      const shot = loaded ? await p.screenshot({ type: 'png' }) : null;
      const q = await viewer.newPage();
      const st = shot ? await q.evaluate(async b64 => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let white = 0; const colors = new Set(); for (let i = 0; i < d.length; i += 16) { if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) white++; colors.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); } return { white: white / (d.length / 16), colors: colors.size }; }, shot.toString('base64')) : null;
      ok(loaded && type === 'application/pdf' && errs.length === 0 && st && st.white > 0.15 && st.colors > 10, `Chromium viewer renders ${path.basename(f)} (white ${st && st.white.toFixed(2)}, colors ${st && st.colors}) ${errs.join(' | ')}`);
      await p.close(); await q.close();
    }
    await viewer.close();
  }
  console.log(`${pass} passed, ${fail} failed` + (hasPypdf ? '（含 pypdf 檢查）' : '') + (hasQpdf ? '（含 qpdf 檢查）' : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
