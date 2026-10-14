// 4x4 2048 move evaluation (row tables + expectimax). Runs inside a worker_thread per tier.
const { parentPort } = require('worker_threads');
// board: array of 16 exponents (0 = empty, 1 = 2, 2 = 4 ...)
const ROWS = 65536;
const moveL = new Uint16Array(ROWS), gainL = new Uint32Array(ROWS), heur = new Float64Array(ROWS);
const revRow = r => ((r & 0xF) << 12) | ((r >> 4 & 0xF) << 8) | ((r >> 8 & 0xF) << 4) | (r >> 12 & 0xF);
for (let r = 0; r < ROWS; r++) {
  const l = [r & 0xF, r >> 4 & 0xF, r >> 8 & 0xF, r >> 12 & 0xF];
  // heuristic (nneonneo-style)
  let sum = 0, empty = 0, merges = 0, prev = 0, counter = 0, monoL = 0, monoR = 0;
  for (let i = 0; i < 4; i++) {
    const v = l[i]; sum += Math.pow(v, 3.5);
    if (v === 0) empty++; else { if (prev === v) counter++; else if (counter > 0) { merges += 1 + counter; counter = 0; } prev = v; }
  }
  if (counter > 0) merges += 1 + counter;
  for (let i = 1; i < 4; i++) { if (l[i - 1] > l[i]) monoL += Math.pow(l[i - 1], 4) - Math.pow(l[i], 4); else monoR += Math.pow(l[i], 4) - Math.pow(l[i - 1], 4); }
  heur[r] = 200000 + 270 * empty + 700 * merges - 47 * Math.min(monoL, monoR) - 11 * sum;
  // move left
  const t = l.filter(v => v); const o = []; let g = 0;
  for (let i = 0; i < t.length; i++) { if (i + 1 < t.length && t[i] === t[i + 1] && t[i] < 15) { o.push(t[i] + 1); g += 1 << (t[i] + 1); i++; } else o.push(t[i]); }
  while (o.length < 4) o.push(0);
  moveL[r] = o[0] | o[1] << 4 | o[2] << 8 | o[3] << 12; gainL[r] = g;
}
const toRows = b => [0, 1, 2, 3].map(i => b[i * 4] | b[i * 4 + 1] << 4 | b[i * 4 + 2] << 8 | b[i * 4 + 3] << 12);
const transpose = R => [0, 1, 2, 3].map(c => ((R[0] >> (4 * c)) & 0xF) | ((R[1] >> (4 * c)) & 0xF) << 4 | ((R[2] >> (4 * c)) & 0xF) << 8 | ((R[3] >> (4 * c)) & 0xF) << 12);
// dir: 0 up, 1 right, 2 down, 3 left ; returns {R, gain, moved}
function doMove(R, dir) {
  let rows = (dir === 0 || dir === 2) ? transpose(R) : R, gain = 0;
  const out = rows.map(r => {
    if (dir === 1 || dir === 2) { const rr = revRow(r); gain += gainL[rr]; return revRow(moveL[rr]); }
    gain += gainL[r]; return moveL[r];
  });
  const res = (dir === 0 || dir === 2) ? transpose(out) : out;
  return { R: res, gain, moved: res.some((v, i) => v !== R[i]) };
}
const evalB = R => { const C = transpose(R); return heur[R[0]] + heur[R[1]] + heur[R[2]] + heur[R[3]] + heur[C[0]] + heur[C[1]] + heur[C[2]] + heur[C[3]]; };
const key = R => R[0] + ',' + R[1] + ',' + R[2] + ',' + R[3];
function emptyCells(R) { const e = []; for (let i = 0; i < 4; i++) for (let c = 0; c < 4; c++) if (!((R[i] >> (4 * c)) & 0xF)) e.push([i, c]); return e; }
function expectimax(R, depth) {
  const cache = new Map();
  function chance(R, d, p) {
    if (d <= 0 || p < 0.0002) return evalB(R);
    const k = key(R) + '|' + d; if (cache.has(k)) return cache.get(k);
    const e = emptyCells(R); if (!e.length) return maxNode(R, d, p);
    let s = 0;
    for (const [i, c] of e) for (const [v, pv] of [[1, 0.9], [2, 0.1]]) {
      const R2 = R.slice(); R2[i] |= v << (4 * c);
      s += pv * maxNode(R2, d, p * pv / e.length);
    }
    const v = s / e.length; cache.set(k, v); return v;
  }
  function maxNode(R, d, p) {
    let best = 0;
    for (let dir = 0; dir < 4; dir++) { const m = doMove(R, dir); if (m.moved) best = Math.max(best, chance(m.R, d - 1, p)); }
    return best;
  }
  const scores = [];
  for (let dir = 0; dir < 4; dir++) { const m = doMove(R, dir); scores.push(m.moved ? chance(m.R, depth - 1, 1) + 1e-6 : -1); }
  return scores;
}
function decide(board, mode, depth) {
  const R = toRows(board);
  const legal = [0, 1, 2, 3].filter(d => doMove(R, d).moved);
  if (!legal.length) return { legal, scores: [-1, -1, -1, -1] };
  let scores;
  if (mode === 'greedy') scores = [0, 1, 2, 3].map(d => { const m = doMove(R, d); return m.moved ? evalB(m.R) + 2 * m.gain : -1; });
  else {
    // adaptive: go one deeper when the board is crowded
    const e = emptyCells(R).length;
    scores = expectimax(R, depth + (depth >= 3 && e <= 3 ? 1 : 0));
  }
  return { legal, scores };
}
if (parentPort) parentPort.on('message', m => parentPort.postMessage({ id: m.id, ...decide(m.board, m.mode, m.depth) }));
module.exports = { decide };
