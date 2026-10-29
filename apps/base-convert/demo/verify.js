// Playwright verification for base-convert. Run: node verify.js
// Reference values come from Python int/format/struct/colorsys.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const short = s => s.length > 120 ? s.slice(0, 120) + '…' : s;
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, `${m}: ${A === B ? short(A) : A + ' != ' + B}`); };

const py = String.raw`
import json, random, struct, colorsys
random.seed(7)
D = "0123456789abcdefghijklmnopqrstuvwxyz"
def b36(n):
    if n == 0: return "0"
    s = ""
    while n: n, r = divmod(n, 36); s = D[r] + s
    return s
cases = []
for w in (8, 16, 32, 64):
    for signed in (False, True):
        for _ in range(6):
            n = random.randrange(-(1 << (w + 4)), 1 << (w + 4))
            m = n & ((1 << w) - 1)
            v = m - (1 << w) if signed and m >> (w - 1) else m
            cases.append({"w": w, "signed": signed, "in": str(n), "dec": str(v), "bin": format(m, "0%db" % w), "oct": format(m, "o"), "hex": format(m, "0%dX" % (w // 4)), "b36": b36(m).upper()})
for _ in range(4):
    n = random.randrange(-(1 << 300), 1 << 300)
    cases.append({"w": 0, "signed": False, "in": str(n), "dec": str(n), "bin": ("-" if n < 0 else "") + format(abs(n), "b"), "oct": ("-" if n < 0 else "") + format(abs(n), "o"), "hex": ("-" if n < 0 else "") + format(abs(n), "X"), "b36": ("-" if n < 0 else "") + b36(abs(n)).upper()})
floats = []
for f in (3.14, -0.5, 1e-40, 6.02214076e23, 0.1):
    floats.append({"f": repr(f), "u32": struct.unpack(">I", struct.pack(">f", f))[0], "u64": str(struct.unpack(">Q", struct.pack(">d", f))[0]), "f32": repr(struct.unpack(">f", struct.pack(">f", f))[0])})
colors = []
for hx in ("FF8800", "1E90FF", "808080", "C71585", "00FF7F", "FFFFFF", "000000", "123456"):
    r, g, b = (int(hx[i:i+2], 16) for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    colors.append({"hex": hx, "rgb": "rgb(%d,%d,%d)" % (r, g, b), "hsl": [round(h * 360) % 360, round(s * 100), round(l * 100)], "int": int(hx, 16)})
print(json.dumps({"cases": cases, "floats": floats, "colors": colors}))`;
const REF = JSON.parse(execFileSync('python3', ['-c', py]).toString());

(async () => {
  const browser = await chromium.launch();
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '360x780', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '844x390', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: 'dark-390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' },
    { name: 'desktop-1280x800', viewport: { width: 1280, height: 800 } },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext(s); const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(s.name + ' console: ' + m.text()); });
    page.on('pageerror', e => errors.push(s.name + ' pageerror: ' + e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__bcReady);
    await page.waitForTimeout(200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844' || s.name === 'dark-390x844' || s.name === '360x780') {
      await page.click('#w-64');
      const small = await page.$$eval('button', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent));
      eq(small, [], s.name + ' all visible buttons >= 44px tall');
      const cw = await page.$$eval('.bit', b => Math.min(...b.map(x => x.getBoundingClientRect().width)));
      assert(cw >= 44, `${s.name} bit cells >= 44px wide (${cw.toFixed(1)})`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), s.name + ' 64-bit grid no horizontal scroll');
      if (s.name !== '360x780') await page.screenshot({ path: `${OUT}/flow-64${s.name.startsWith('dark') ? '-dark' : ''}.png`, fullPage: true });
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__bcReady);
  const vals = async () => page.evaluate(() => ({ bin: f('bin'), oct: f('oct'), dec: f('dec'), hex: f('hex'), cus: f('cus') }) , null).catch(() => null);
  await page.evaluate(() => { window.f = k => document.getElementById('f-' + k).value.replace(/[\s,]/g, ''); });
  // spec step 1: DEC 255 → 11111111 / 377 / FF
  await page.click('#w-8'); await page.click('#sign-u');
  await page.fill('#f-dec', '255'); await page.click('#f-hex');
  eq(await vals(), { bin: '11111111', oct: '377', dec: '255', hex: 'FF', cus: '73' }, 'DEC 255 (8-bit) → 11111111/377/FF, base36 73');
  // spec: 8-bit signed, DEC -1 → FF / 1111 1111
  await page.click('#sign-s'); await page.fill('#f-dec', '-1'); await page.click('#f-oct');
  eq([await page.inputValue('#f-hex'), await page.inputValue('#f-bin')], ['FF', '1111 1111'], '8-bit signed DEC -1 → HEX FF, BIN 1111 1111');
  // spec: 64-bit unsigned max
  await page.click('#w-64'); await page.click('#sign-u'); await page.fill('#f-dec', '18446744073709551615'); await page.click('#f-oct');
  const mx = await vals();
  eq([mx.hex, mx.bin, mx.oct], ['FFFFFFFFFFFFFFFF', '1'.repeat(64), '1777777777777777777777'], '64-bit unsigned max converts with no precision loss');
  // prefixes, underscores, illegal chars
  await page.click('#w-32'); await page.fill('#f-bin', '0b1111_0000'); eq(await page.inputValue('#f-dec'), '240', 'BIN accepts 0b prefix and underscores');
  await page.fill('#f-hex', '0xdead beef'); eq(await page.inputValue('#f-dec'), '3735928559', 'HEX accepts 0x and spaces');
  await page.fill('#f-bin', '1021');
  eq([await page.$eval('#f-bin', e => e.classList.contains('bad')), await page.textContent('#h-bin'), await page.inputValue('#f-dec')], [true, '僅允許 0/1', '3735928559'], 'illegal BIN digit: red, hint, other fields untouched');
  await page.click('#f-oct');
  // overflow and two's complement notes
  await page.click('#w-8'); await page.fill('#f-dec', '300'); await page.click('#f-oct');
  eq([await page.inputValue('#f-dec'), (await page.textContent('#status')).startsWith('溢位')], ['44', true], '8-bit unsigned 300 → overflow, truncated to 44');
  await page.fill('#f-dec', '-2'); await page.click('#f-oct');
  eq([await page.inputValue('#f-dec'), (await page.textContent('#status')).includes('二補數')], ['254', true], 'unsigned -2 → two\'s complement 254 with note');

  // Python cross-check across widths / signedness / arbitrary 300-bit values
  for (const c of REF.cases) {
    await page.click('#w-' + c.w); await page.click(c.signed ? '#sign-s' : '#sign-u');
    await page.selectOption('#cbase', '36');
    await page.fill('#f-dec', c.in); await page.click('#f-oct');
    const v = await vals();
    eq(v, { bin: c.bin, oct: c.oct, dec: c.dec, hex: c.hex, cus: c.b36 }, `w=${c.w || '任意'} ${c.signed ? 'signed' : 'unsigned'} ${c.in.slice(0, 24)}${c.in.length > 24 ? '…' : ''} vs Python`);
  }
  // round trip: type the HEX back in
  await page.click('#w-64'); await page.click('#sign-s'); await page.fill('#f-hex', '8000000000000000'); await page.click('#f-oct');
  eq(await page.inputValue('#f-dec'), '-9223372036854775808', 'signed 64 HEX 8000… → int64 min');

  // bit grid click + drag
  await page.click('#w-8'); await page.click('#sign-u'); await page.fill('#f-dec', '0'); await page.click('#f-oct');
  await page.click('#bit-0'); eq(await page.inputValue('#f-dec'), '1', 'tap bit 0 → 1');
  const c7 = await page.$eval('#bit-7', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const c4 = await page.$eval('#bit-4', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.move(...c7); await page.mouse.down(); await page.mouse.move(c4[0], c4[1], { steps: 8 }); await page.mouse.up();
  eq(await page.inputValue('#f-hex'), 'F1', 'drag bits 7→4 sets them (0xF1)');
  await page.mouse.move(...c7); await page.mouse.down(); await page.mouse.move(c4[0], c4[1], { steps: 8 }); await page.mouse.up();
  eq(await page.inputValue('#f-hex'), '01', 'drag again from a set bit clears them');
  // info row
  await page.click('#w-16'); await page.fill('#f-hex', '1241'); await page.click('#f-oct');
  const info = await page.$$eval('#info dd', d => d.map(x => x.textContent));
  eq(info.slice(0, 4), ['12 41', '41 12', '4', '第 12 位'], 'info: big/little endian, popcount, highest bit');
  await page.fill('#f-hex', '41'); await page.click('#f-oct');
  assert((await page.$eval('#info', e => e.textContent)).includes("'A'"), 'ASCII shows A for 0x41');

  // bit operations
  const op = async (w, signed, a, o, b) => {
    await page.click('#w-' + w); await page.click(signed ? '#sign-s' : '#sign-u');
    await page.fill('#f-dec', a); await page.click('#f-oct');
    await page.selectOption('#op', o); if (o !== 'not') await page.fill('#opB', b);
    return page.$$eval('#opRes button span', s => s.map(x => x.textContent.replace(/ /g, '')));
  };
  eq((await op(8, false, '202', 'and', '0x0F'))[2], '10', '202 AND 0x0F = 10');
  eq((await op(8, false, '202', 'xor', '0b11110000'))[3], '3A', '202 XOR 0xF0 = 0x3A');
  eq((await op(8, false, '1', 'not'))[2], '254', 'NOT 1 (8-bit unsigned) = 254');
  eq((await op(8, true, '-128', 'shr', '3'))[2], '-16', '-128 >> 3 (signed) = -16');
  eq((await op(8, true, '-128', 'ushr', '3'))[3], '10', '-128 >>> 3 (8-bit) = 0x10');
  const ov = await op(8, false, '200', 'add', '100');
  eq([ov[2], (await page.textContent('#opNote')).startsWith('溢位')], ['44', true], '200 + 100 (8-bit) overflows → 44 with warning');
  eq((await op(16, false, '1', 'shl', '20'))[2], '0', '1 << 20 in 16 bits → 0 (truncated)');
  eq((await op(0, false, '12345678901234567890', 'mul', '98765432109876543210'))[2], (12345678901234567890n * 98765432109876543210n).toString(), 'arbitrary width big multiply');
  assert(await page.$eval('#op option[value="ushr"]', o => o.disabled), '>>> disabled in arbitrary width');
  await op(32, false, '7', 'mul', '6'); await page.click('#opApply'); eq(await page.inputValue('#f-dec'), '42', 'apply result to current value');

  // IEEE 754 vs Python struct
  for (const fl of REF.floats) {
    await page.click('#w-32'); await page.fill('#floatIn', fl.f); await page.dispatchEvent('#floatIn', 'change');
    eq(await page.inputValue('#f-dec'), String(fl.u32), `float32 ${fl.f} bits = ${fl.u32}`);
    eq(await page.$eval('#ieeeInfo dd', e => e.textContent), String(Number(fl.f32)), `float32 ${fl.f} reads back ${fl.f32}`);
    await page.click('#w-64'); await page.fill('#floatIn', fl.f); await page.dispatchEvent('#floatIn', 'change');
    eq(await page.inputValue('#f-dec'), String(fl.u64), `float64 ${fl.f} bits = ${fl.u64}`);
  }
  await page.click('#w-8'); assert(await page.$eval('#ieeeBox', e => e.hidden), 'IEEE view hidden for 8-bit');

  // colors vs Python colorsys
  for (const c of REF.colors) {
    await page.fill('#color', '#' + c.hex);
    const rows = await page.$$eval('#colorRes button span', s => s.map(x => x.textContent));
    eq([rows[1], rows[2], rows[3].split('（')[0]], [c.rgb, `hsl(${c.hsl[0]},${c.hsl[1]}%,${c.hsl[2]}%)`, String(c.int)], `color #${c.hex}`);
  }
  await page.fill('#color', '#FF8800'); eq(await page.$eval('#colorRes button:nth-child(2) span', e => e.textContent), 'rgb(255,136,0)', 'spec: #FF8800 → rgb(255,136,0)');
  await page.fill('#color', 'hsl(32, 100%, 50%)'); eq(await page.$eval('#colorRes button span', e => e.textContent), '#FF8800', 'hsl(32,100%,50%) → #FF8800');
  await page.fill('#color', 'rgb(18 52 86 / 50%)'); eq(await page.$eval('#colorRes button span', e => e.textContent), '#12345680', 'rgb() with alpha → 8-digit hex');
  await page.fill('#color', '#f80'); eq(await page.$eval('#colorRes button span', e => e.textContent), '#FF8800', '3-digit hex');
  await page.fill('#cb', '255'); eq(await page.inputValue('#color'), '#FF88FF', 'RGB inputs write back to HEX');
  await page.fill('#color', 'zzz'); assert(!(await page.$eval('#colorErr', e => e.hidden)), 'bad color message');
  await page.fill('#color', '#FF8800'); await page.click('#colorToValue');
  eq([await page.inputValue('#f-dec'), await page.inputValue('#f-hex')], ['16746496', '00 FF 88 00'], 'color int sent to value (switches to 32-bit)');
  // persistence
  await page.reload(); await page.waitForFunction(() => window.__bcReady);
  eq([await page.inputValue('#f-dec'), await page.getAttribute('#w-32', 'aria-pressed')], ['16746496', 'true'], 'state remembered');
  await page.screenshot({ path: `${OUT}/flow-ops.png`, fullPage: true });

  await ctx.close(); await browser.close();
  fs.unlinkSync(WRAP);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASSED');
  process.exit(errors.length ? 1 : 0);
})();
