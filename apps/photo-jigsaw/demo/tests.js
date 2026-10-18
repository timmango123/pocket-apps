// Core logic tests for 自訂拼圖 (photo-jigsaw). Extracts the pure functions between CORE markers of ../index.html.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  ';return {mulberry32, chooseGrid, makeEdges, edgePts, piecePath, isEdgePiece, rotV, groupToWorld, worldToGroup, rotateGroupAbout, cellsOf, adjacentCells, canMerge, nearBoard, groupCenter, formatTime, serializeState, validSave};')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// --- rng ---
{
  const a = C.mulberry32(7), b = C.mulberry32(7), c = C.mulberry32(8);
  const xa = [a(), a(), a()], xb = [b(), b(), b()], xc = [c(), c(), c()];
  ok(xa.join() === xb.join() && xa.join() !== xc.join(), 'seeded rng reproducible and seed-dependent');
  ok(xa.every(v => v >= 0 && v < 1), 'rng in [0,1)');
}
// --- grid choice ---
{
  for (const n of [12, 20, 30, 48, 63, 80, 99]) {
    const g = C.chooseGrid(n, 4 / 3);
    ok(Math.abs(g.count - n) <= 4 && g.cols * g.rows === g.count, `grid for ${n} pieces at 4:3 close to target (${g.cols}x${g.rows}=${g.count})`);
    ok(Math.abs(Math.log((g.cols / g.rows) / (4 / 3))) < 0.5, `grid for ${n} has near-square cells`);
  }
  const p = C.chooseGrid(30, 3 / 4); ok(p.rows > p.cols, 'portrait image gets more rows than cols');
  const w = C.chooseGrid(30, 2); ok(w.cols >= 2 * w.rows - 1, 'wide image gets more cols');
  ok(C.chooseGrid(12, 1).count === 12, '12 pieces on a square = 12 (3x4 or 4x3)');
  const g99 = C.chooseGrid(99, 4 / 3); ok(g99.count >= 90 && g99.count <= 108, '99 target lands between 90 and 108');
}
// --- edges ---
{
  const e1 = C.makeEdges(5, 4, 42), e2 = C.makeEdges(5, 4, 42), e3 = C.makeEdges(5, 4, 43);
  ok(JSON.stringify(e1) === JSON.stringify(e2), 'edges deterministic for a seed');
  ok(JSON.stringify(e1) !== JSON.stringify(e3), 'edges differ between seeds');
  ok(e1.H.length === 5 && e1.H[0].length === 5 && e1.V.length === 4 && e1.V[0].length === 6, 'edge array shapes');
  ok(e1.H[0].every(x => x === null) && e1.H[4].every(x => x === null), 'top/bottom borders flat');
  ok(e1.V.every(r => r[0] === null && r[5] === null), 'left/right borders flat');
  ok(e1.H[1].every(x => x && (x.s === 1 || x.s === -1)), 'inner edges have a tab direction');
  let tabs = 0, tot = 0; for (let r = 1; r < 4; r++) for (let c = 0; c < 5; c++) { tot++; if (e1.H[r][c].s === 1) tabs++; }
  ok(tabs > 2 && tabs < tot - 2, 'tab directions mixed');
  const pts = C.edgePts(e1.H[1][0]);
  ok(pts.length === 19 && pts[0][0] === 0 && pts[0][1] === 0 && pts[18][0] === 1 && pts[18][1] === 0, 'tab edge: 6 cubic segments from (0,0) to (1,0)');
  const maxV = Math.max(...pts.map(p => Math.abs(p[1])));
  ok(maxV >= 0.2 && maxV <= 0.26, 'tab sticks out 20-26% of the edge length');
  ok(pts.every(p => p[0] >= -0.01 && p[0] <= 1.01), 'edge stays within its span');
  const flat = C.edgePts(null); ok(flat.length === 4 && flat.every(p => p[1] === 0), 'flat edge is one straight cubic');
  const sgn = Math.sign(pts[9][1]); ok(sgn === e1.H[1][0].s, 'tab head on the side given by s');
}
// --- piece path ---
{
  const cols = 4, rows = 3, cw = 100, ch = 80, E = C.makeEdges(cols, rows, 5);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const P = C.piecePath(E, c, r, cw, ch);
    ok((P.length - 1) % 3 === 0, `piece ${c},${r} path is a cubic chain`);
    ok(near(P[0][0], P[P.length - 1][0]) && near(P[0][1], P[P.length - 1][1]), `piece ${c},${r} path closed`);
    ok(P.every(p => p[0] >= -0.3 * cw && p[0] <= cw * 1.3 && p[1] >= -0.3 * ch - 1 && p[1] <= ch * 1.3 + 1), `piece ${c},${r} within padding`);
  }
  // corner piece: two flat sides
  const P00 = C.piecePath(E, 0, 0, cw, ch);
  ok(P00.slice(0, 4).every(p => near(p[1], 0)), 'top-left piece top edge flat');
  ok(P00.slice(P00.length - 4).every(p => near(p[0], 0)), 'top-left piece left edge flat');
  // shared edge: bottom of (1,0) equals top of (1,1) in world coordinates (segment lengths depend on flat vs tab edges)
  const seg = (c, r) => { const L = [E.H[r][c] ? 19 : 4, E.V[r][c + 1] ? 19 : 4, E.H[r + 1][c] ? 19 : 4, E.V[r][c] ? 19 : 4]; const o = [0]; for (let i = 0; i < 3; i++) o.push(o[i] + L[i] - 1); return { top: [0, L[0]], right: [o[1], o[1] + L[1]], bottom: [o[2], o[2] + L[2]], left: [o[3], o[3] + L[3]] }; };
  const A = C.piecePath(E, 1, 0, cw, ch), B = C.piecePath(E, 1, 1, cw, ch), sa = seg(1, 0), sb = seg(1, 1);
  const aBottom = A.slice(sa.bottom[0], sa.bottom[1]).map(p => [p[0] + 1 * cw, p[1] + 0 * ch]).reverse();
  const bTop = B.slice(sb.top[0], sb.top[1]).map(p => [p[0] + 1 * cw, p[1] + 1 * ch]);
  ok(aBottom.length === 19 && aBottom.every((p, i) => near(p[0], bTop[i][0]) && near(p[1], bTop[i][1])), 'neighbouring pieces share exactly the same edge curve');
  const A2 = C.piecePath(E, 1, 1, cw, ch), B2 = C.piecePath(E, 2, 1, cw, ch), s2 = seg(1, 1), s3 = seg(2, 1);
  const aRight = A2.slice(s2.right[0], s2.right[1]).map(p => [p[0] + cw, p[1] + ch]), bLeft = B2.slice(s3.left[0], s3.left[1]).map(p => [p[0] + 2 * cw, p[1] + ch]).reverse();
  ok(aRight.length === 19 && aRight.every((p, i) => near(p[0], bLeft[i][0]) && near(p[1], bLeft[i][1])), 'left/right neighbours share the vertical edge curve');
  ok(C.isEdgePiece(0, 1, 4, 3) && C.isEdgePiece(3, 1, 4, 3) && C.isEdgePiece(2, 0, 4, 3) && C.isEdgePiece(2, 2, 4, 3) && !C.isEdgePiece(1, 1, 4, 3) && !C.isEdgePiece(2, 1, 4, 3), 'edge piece detection');
}
// --- group transforms ---
{
  ok(C.rotV(1, 0, 1).join() === '0,1' && C.rotV(1, 0, 2).join() === '-1,0' && C.rotV(1, 0, 3).join() === '0,-1' && C.rotV(1, 0, 4).join() === '1,0', 'rotV quarter turns clockwise (screen coords)');
  const g = { pcs: [0], x: 10, y: 20, rot: 1 };
  const w = C.groupToWorld(g, 5, 7), back = C.worldToGroup(g, w[0], w[1]);
  ok(near(back[0], 5) && near(back[1], 7), 'worldToGroup inverts groupToWorld');
  for (let rot = 0; rot < 4; rot++) {
    const h = { pcs: [0, 1], x: 33, y: -12, rot };
    const piv = C.groupToWorld(h, 50, 40);
    const n = C.rotateGroupAbout(h, piv[0], piv[1], 1);
    const after = C.groupToWorld({ x: n.x, y: n.y, rot: n.rot }, 50, 40);
    ok(n.rot === (rot + 1) % 4 && near(after[0], piv[0]) && near(after[1], piv[1]), `rotation about a pivot keeps the pivot fixed (rot ${rot})`);
    const n4 = [0, 1, 2, 3].reduce(acc => C.rotateGroupAbout({ pcs: [0], x: acc.x, y: acc.y, rot: acc.rot }, 100, 100, 1), { x: h.x, y: h.y, rot: h.rot });
    ok(near(n4.x, h.x) && near(n4.y, h.y) && n4.rot === rot, `four turns return to start (rot ${rot})`);
  }
  const cc = C.rotateGroupAbout({ x: 0, y: 0, rot: 0 }, 0, 0, -1); ok(cc.rot === 3, 'counter-clockwise turn');
}
// --- merging ---
{
  const cols = 4, tol = 10;
  const cells = C.cellsOf({ pcs: [5, 6] }, cols); ok(cells[0].c === 1 && cells[0].r === 1 && cells[1].c === 2 && cells[1].r === 1, 'cellsOf maps ids to col,row');
  ok(C.adjacentCells([{ c: 1, r: 1 }], [{ c: 2, r: 1 }]) && C.adjacentCells([{ c: 1, r: 1 }], [{ c: 1, r: 0 }]) && !C.adjacentCells([{ c: 1, r: 1 }], [{ c: 2, r: 2 }]) && !C.adjacentCells([{ c: 1, r: 1 }], [{ c: 3, r: 1 }]), 'adjacency: orthogonal neighbours only');
  const a = { pcs: [5], x: 100, y: 100, rot: 0 };
  ok(C.canMerge(a, { pcs: [6], x: 104, y: 97, rot: 0 }, cols, tol), 'neighbour within tolerance merges');
  ok(!C.canMerge(a, { pcs: [6], x: 112, y: 100, rot: 0 }, cols, tol), 'neighbour beyond tolerance does not merge');
  ok(!C.canMerge(a, { pcs: [6], x: 100, y: 100, rot: 1 }, cols, tol), 'different rotation never merges');
  ok(!C.canMerge(a, { pcs: [10], x: 100, y: 100, rot: 0 }, cols, tol), 'diagonal piece aligned but not adjacent does not merge');
  ok(!C.canMerge(a, { pcs: [7], x: 100, y: 100, rot: 0 }, cols, tol), 'same row two apart does not merge');
  ok(C.canMerge({ pcs: [0, 1, 4], x: 0, y: 0, rot: 2 }, { pcs: [8, 9], x: 3, y: -3, rot: 2 }, 4, 5), 'rotated groups merge when a pair touches (4-8 adjacent)');
  ok(C.nearBoard({ x: 3, y: -4, rot: 0 }, 6) && !C.nearBoard({ x: 3, y: -4, rot: 0 }, 4) && !C.nearBoard({ x: 0, y: 0, rot: 2 }, 6), 'board snap needs rot 0 and origin within tolerance');
  const cen = C.groupCenter({ pcs: [0, 1], x: 0, y: 0, rot: 0 }, 4, 100, 80); ok(near(cen[0], 100) && near(cen[1], 40), 'group centre of two side-by-side cells');
  const cen2 = C.groupCenter({ pcs: [0], x: 10, y: 10, rot: 1 }, 4, 100, 80); ok(near(cen2[0], 10 - 40) && near(cen2[1], 10 + 50), 'group centre follows rotation');
}
// --- time + save ---
{
  ok(C.formatTime(0) === '00:00' && C.formatTime(65000) === '01:05' && C.formatTime(3599999) === '59:59' && C.formatTime(3600000) === '1:00:00', 'formatTime');
  const S = { img: { kind: 'builtin', id: 'bay' }, cols: 4, rows: 3, seed: 99, rotMode: true, elapsed: 1234.6, ghost: true, edgeOnly: false,
    groups: [{ pcs: [0, 1], x: 1.234, y: -2.5, rot: 1, locked: false, tray: false }, { pcs: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], x: 0, y: 0, rot: 0, locked: true, tray: false }], trayOrder: [] };
  const d = C.serializeState(S);
  ok(d.v === 1 && d.elapsed === 1235 && d.groups[0].x === 1.23 && d.groups[0].rot === 1 && d.groups[1].locked === true && d.rotMode === true, 'serialize rounds and copies');
  ok(C.validSave(JSON.parse(JSON.stringify(d))), 'serialized state validates');
  ok(!C.validSave(null) && !C.validSave({}) && !C.validSave({ v: 2 }), 'garbage rejected');
  const dup = JSON.parse(JSON.stringify(d)); dup.groups[0].pcs = [0, 0]; ok(!C.validSave(dup), 'duplicate piece id rejected');
  const miss = JSON.parse(JSON.stringify(d)); miss.groups[1].pcs.pop(); ok(!C.validSave(miss), 'missing piece rejected');
  const oob = JSON.parse(JSON.stringify(d)); oob.groups[0].pcs = [0, 12]; ok(!C.validSave(oob), 'out of range id rejected');
  const nan = JSON.parse(JSON.stringify(d)); nan.groups[0].x = 'x'; ok(!C.validSave(nan), 'non-numeric position rejected');
  const tray = JSON.parse(JSON.stringify(d)); tray.groups[0].tray = true; delete tray.groups[0].x; ok(C.validSave(tray), 'tray groups need no position');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
