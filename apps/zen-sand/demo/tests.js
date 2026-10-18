// Core tests for 禪意沙畫 (zen-sand): the sand height-map, rake stamping, stone deflection, lighting and persistence.
// Extracts the pure core between CORE markers of ../index.html. Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const ZS = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return ZS;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const at = (f, x, y) => f.h[y * f.cols + x];
const col = (f, x, y0, y1) => { const o = []; for (let y = y0; y <= y1; y++) o.push(at(f, x, y)); return o; };

// --- field & profile ---
{
  const f = ZS.makeField(40, 30);
  ok(f.cols === 40 && f.rows === 30 && f.h.length === 1200 && ZS.maxAbs(f) === 0, 'new field is flat');
  ok(Math.abs(ZS.profileAt(0, 2, 1) + 0.98) < 0.02, 'groove centre is about -depth');
  ok(ZS.profileAt(2.6, 2, 1) > 0.45, 'ridge beside the groove rises about half the depth');
  ok(Math.abs(ZS.profileAt(6, 2, 1)) < 0.01, 'profile is flat far from the tine');
  const R = ZS.mulberry(5); const a = R(), b = R(); const R2 = ZS.mulberry(5);
  ok(R2() === a && R2() === b && a >= 0 && a < 1, 'seeded rng reproducible');
}
// --- single stroke: grooves and ridges, replace not accumulate ---
{
  const f = ZS.makeField(80, 60), d = ZS.newDirty();
  const n = ZS.applyStroke(f, 1, [[10, 30], [70, 30]], [], d);
  ok(n > 50, 'stroke produced stamps: ' + n);
  ok(at(f, 40, 30) < -0.9, 'single tine digs a groove along the stroke: ' + at(f, 40, 30).toFixed(2));
  ok(at(f, 40, 27) > 0.35 && at(f, 40, 33) > 0.35, 'sand piles up on both sides');
  ok(Math.abs(at(f, 40, 22)) < 0.01 && Math.abs(at(f, 40, 38)) < 0.01, 'sand away from the stroke untouched');
  ok(Math.abs(at(f, 2, 30)) < 0.01 && Math.abs(at(f, 78, 30)) < 0.01, 'stroke ends where the finger stopped');
  ok(d.x0 <= 8 && d.x1 >= 72 && d.y0 <= 26 && d.y1 >= 34, 'dirty rect covers the stroke');
  const before = at(f, 40, 30);
  ZS.applyStroke(f, 1, [[10, 30], [70, 30]], [], null);
  ok(Math.abs(at(f, 40, 30) - before) < 0.02, 'raking the same line again does not dig deeper');
  ZS.applyStroke(f, 1, [[40, 5], [40, 55]], [], null);
  ok(at(f, 40, 30) < -0.9 && at(f, 37, 30) > 0.3, 'a crossing stroke replaces the old groove with its own profile');
}
// --- rakes: tine count, spacing, stick ---
{
  const grooves = id => { const f = ZS.makeField(120, 80); ZS.applyStroke(f, id, [[10, 40], [110, 40]], [], null); const c = col(f, 60, 10, 70); let n = 0; for (let i = 1; i < c.length - 1; i++) if (c[i] < -0.6 && c[i] <= c[i - 1] && c[i] < c[i + 1]) n++; return { n, c }; };
  for (let k = 1; k <= 5; k++) ok(grooves(k).n === k, `${k}-tine rake cuts ${k} grooves (got ${grooves(k).n})`);
  const g5 = grooves(5).c, idx = []; for (let i = 1; i < g5.length - 1; i++) if (g5[i] < -0.6 && g5[i] <= g5[i - 1] && g5[i] < g5[i + 1]) idx.push(i + 10);
  ok(idx.every((v, i) => i === 0 || Math.abs(v - idx[i - 1] - ZS.SPACING) <= 1), 'tines evenly spaced: ' + idx.join(','));
  ok(Math.abs(idx[2] - 40) <= 1, 'rake centred on the finger');
  const stick = grooves(6);
  const wide = stick.c.filter(v => v < -0.5).length, narrow = grooves(1).c.filter(v => v < -0.5).length;
  ok(stick.n === 1 && wide > narrow && Math.min(...stick.c) < -1.1, `stick makes one wider (${wide} vs ${narrow}) deeper groove`);
  ok(ZS.tinePositions(0, 0, 1, 0, 3).map(p => p[1].toFixed(1)).join(',') === [-ZS.SPACING, 0, ZS.SPACING].map(v => v.toFixed(1)).join(','), 'tines spread perpendicular to heading');
  ok(ZS.tinePositions(0, 0, 0, 1, 2).every(p => Math.abs(p[1]) < 1e-9), 'vertical heading spreads tines horizontally');
}
// --- stones: lines flow around them ---
{
  const stones = [{ x: 60, y: 40, r: 10 }];
  const p = ZS.deflect(55, 40, stones);
  ok(Math.abs(p[0] - 50) < 1e-9 && Math.abs(p[1] - 40) < 1e-9, 'a tine inside a stone is pushed to its edge');
  ok(ZS.deflect(60, 40, stones) === null, 'a tine on the stone centre is dropped');
  const q = ZS.deflect(80, 40, stones); ok(q[0] === 80 && q[1] === 40, 'outside tines untouched');
  const two = ZS.deflect(61, 40, [{ x: 60, y: 40, r: 5 }, { x: 68, y: 40, r: 5 }]);
  ok(two === null || (Math.hypot(two[0] - 60, two[1] - 40) >= 5 - 1e-6 && Math.hypot(two[0] - 68, two[1] - 40) >= 5 - 1e-6), 'between touching stones: pushed clear or skipped');
  const f = ZS.makeField(120, 80);
  ZS.applyStroke(f, 5, [[5, 40], [115, 40]], stones, null);
  let inside = 0; for (let y = 32; y <= 48; y++) for (let x = 52; x <= 68; x++) if (Math.hypot(x - 60, y - 40) < 6 && Math.abs(at(f, x, y)) > 0.05) inside++;
  ok(inside === 0, 'sand under the stone stays flat (' + inside + ' cells disturbed)');
  ok(at(f, 20, 40) < -0.9 && at(f, 100, 40) < -0.9, 'grooves continue on both sides of the stone');
  ok(Math.abs(at(f, 60, 29)) > 0.3 || Math.abs(at(f, 60, 30)) > 0.3 || Math.abs(at(f, 60, 28)) > 0.3, 'grooves bend around the stone edge');
  const fp = ZS.footprint({ u: 0.5, v: 0.5, s: 40 }, 200, 100, 2);
  ok(fp.x === 50 && fp.y === 25 && Math.abs(fp.r - (40 * 0.72 + 7) / 2) < 1e-9, 'footprint converts to cells with a quiet margin');
  const g = ZS.makeField(60, 60); ZS.applyStroke(g, 5, [[0, 30], [60, 30]], [], null);
  const orig = new Float32Array(g.h); ZS.flattenUnder(g, 30, 30, 8, 5);
  ok(Math.abs(at(g, 30, 30)) < 1e-6 && Math.abs(at(g, 33, 27)) < 1e-6 && Math.abs(at(g, 30, 23)) < Math.abs(orig[23 * 60 + 30]) && at(g, 30, 23) * orig[23 * 60 + 30] >= 0 && at(g, 30, 21) === orig[21 * 60 + 30] && at(g, 30, 38) === orig[38 * 60 + 30], 'flattenUnder is flat under the stone body, eases out, untouched beyond r');
  const g3 = ZS.makeField(60, 60); ZS.applyStroke(g3, 5, [[0, 30], [60, 30]], [], null); ZS.flattenUnder(g3, 30, 30, 8);
  ok(Math.abs(at(g3, 30, 30)) < 1e-6 && Math.abs(at(g3, 30, 34)) < 1e-6, 'default inner radius is 60% of r');
  ok(ZS.hitItem([{ t: 'stone', u: 0.5, v: 0.5, s: 20 }], 100 + 28, 100, 200, 200) !== null, 'small items get a 30px touch radius');
}
// --- smoothing ---
{
  const f = ZS.makeField(50, 50); ZS.applyStroke(f, 3, [[5, 25], [45, 25]], [], null);
  const m0 = ZS.maxAbs(f); ZS.relax(f, 0.5);
  ok(Math.abs(ZS.maxAbs(f) - m0 / 2) < 1e-6, 'relax halves every height');
  ZS.clear(f); ok(ZS.maxAbs(f) === 0, 'clear flattens all');
}
// --- lighting ---
{
  const pal = { base: [200, 200, 200], amb: 0.7, dif: 0.4, spec: 0, tint: 0, L: [-0.6, -0.6, 0.55] };
  const f = ZS.makeField(60, 40), px = new Uint8ClampedArray(60 * 40 * 4);
  ZS.shade(f, px, pal, 0, 0, 59, 39);
  const flat = px[(20 * 60 + 30) * 4];
  ok(px[(20 * 60 + 30) * 4 + 3] === 255 && flat > 150 && flat < 200, 'flat sand is lit by ambient + lambert: ' + flat);
  ZS.applyStroke(f, 1, [[5, 20], [55, 20]], [], null);
  ZS.shade(f, px, pal, 0, 0, 59, 39);
  const top = px[(18 * 60 + 30) * 4], bottom = px[(22 * 60 + 30) * 4];
  ok(bottom > flat && top < flat, `light from top-left: the lower wall faces it and is brighter (${bottom}), the upper wall darker (${top}) than flat sand (${flat})`);
  const px2 = new Uint8ClampedArray(60 * 40 * 4); ZS.shade(f, px2, pal, 10, 10, 20, 20);
  ok(px2[(15 * 60 + 15) * 4 + 3] === 255 && px2[(30 * 60 + 30) * 4 + 3] === 0, 'shade only touches the requested rect');
}
// --- resample / serialize ---
{
  const f = ZS.makeField(40, 30); ZS.applyStroke(f, 5, [[0, 15], [40, 15]], [], null);
  const g = ZS.resample(f, 80, 60);
  ok(g.cols === 80 && g.rows === 60 && Math.min(...col(g, 40, 26, 34)) < -0.6 && Math.max(...col(g, 40, 26, 34)) > -0.2, 'upsampling keeps the groove in place');
  const same = ZS.resample(f, 40, 30); ok(same !== f && same.h.every((v, i) => v === f.h[i]), 'same-size resample copies');
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
  ok(ZS.b64encode(bytes) === Buffer.from(bytes).toString('base64'), 'base64 encode matches Node');
  ok(Buffer.from(ZS.b64decode(ZS.b64encode(bytes))).equals(Buffer.from(bytes)), 'base64 round trip');
  for (const n of [1, 2, 3, 4, 5]) { const b = new Uint8Array(n).map((_, i) => i * 50); ok(Buffer.from(ZS.b64decode(ZS.b64encode(b))).equals(Buffer.from(b)), 'base64 round trip length ' + n); }
  const s = ZS.serialize(f), back = ZS.deserialize(s);
  ok(typeof s.h === 'string' && s.cols === 40 && s.rows === 30, 'serialize gives cols, rows and a string');
  let err = 0; for (let i = 0; i < f.h.length; i++) err = Math.max(err, Math.abs(back.h[i] - f.h[i]));
  ok(err < 0.01, 'quantised round trip error < 0.01: ' + err.toFixed(4));
  ok(ZS.deserialize(null) === null && ZS.deserialize({ cols: 4, rows: 4, h: 'AA' }) === null && ZS.deserialize({ cols: 0, rows: 1, h: '' }) === null, 'bad saves rejected');
  ok(JSON.parse(JSON.stringify(s)).h === s.h, 'serialized garden survives JSON');
}
// --- items & sample garden ---
{
  const items = [{ t: 'stone', u: 0.5, v: 0.5, s: 30 }, { t: 'leaf', u: 0.52, v: 0.5, s: 10 }];
  ok(ZS.hitItem(items, 100, 100, 200, 200) === items[0], 'hit test finds the stone under the finger');
  ok(ZS.hitItem(items, 104, 100, 200, 200) === items[1], 'nearest / top-most item wins');
  ok(ZS.hitItem(items, 10, 10, 200, 200) === null, 'nothing hit on empty sand');
  const g = ZS.sampleGarden(390, 844, 52);
  ok(g.items.length === 9 && g.items.filter(i => i.t === 'stone').length === 4 && g.items.every(i => i.u > 0.05 && i.u < 0.95 && i.v > 0.1 && i.v < 0.75), 'sample garden: 9 items incl. 4 stones, all on the sand');
  ok(g.strokes.length > 10 && g.strokes.every(s => s.rake === 5 && s.pts.length >= 2), 'sample strokes are 5-tine lines and rings');
  const f = ZS.makeField(195, 422), stones = g.items.filter(i => i.t === 'stone').map(i => ZS.footprint(i, 390, 844, 2));
  let n = 0; for (const s of g.strokes) n += ZS.applyStroke(f, s.rake, s.pts.map(p => [p[0] / 2, p[1] / 2]), stones, null);
  ok(n > 10000 && ZS.maxAbs(f) > 0.9, 'sample garden rakes the whole field');
  let covered = 0; for (let i = 0; i < f.h.length; i++) if (Math.abs(f.h[i]) > 0.1) covered++;
  ok(covered / f.h.length > 0.5, 'most of the sand carries grooves: ' + (covered / f.h.length * 100).toFixed(0) + '%');
  const g2 = ZS.sampleGarden(390, 844, 52);
  ok(JSON.stringify(g2) === JSON.stringify(g), 'sample garden is deterministic');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
