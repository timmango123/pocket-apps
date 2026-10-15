// Loads antikythera's pure level/evaluation code from the game file (read-only) for offline reasoning.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../../../apps/antikythera/index.html'), 'utf8');
const a = src.indexOf('const TAU = Math.PI * 2;'), b = src.indexOf('/* ---------- state ---------- */');
const of = src.slice(src.indexOf('function orientFor('), src.indexOf('function placePiece('));
const body = of + src.slice(a, b).replace("matchMedia('(prefers-reduced-motion: reduce)').matches", 'false');
const K = new Function('let L = null;' + body + '\nreturn { getLevel, evaluate, relation, pieceWheels, orientFor, outerR, fracEq, specStats, pressure, params };')();
module.exports = K;
