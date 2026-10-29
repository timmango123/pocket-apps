// Help text says a clear scores 10*n*n*(1+0.5*combo); the HUD and float show the combo after the clear ("連擊×2" on the 2nd clear).
const C = require('./common').core();
const G = C.newGame('normal', 1); G.b.fill(0);
G.hand = [{ id: C.SHAPES.findIndex(s => s.key === 'dot'), col: 1, used: false }, { id: C.SHAPES.findIndex(s => s.key === 'dot'), col: 1, used: false }, { id: C.SHAPES.findIndex(s => s.key === 'dot'), col: 1, used: false }];
for (let c = 0; c < 8; c++) G.b[c] = 1; for (let c = 0; c < 8; c++) G.b[9 + c] = 1;
const e1 = C.step(G, 0, 0, 8); const e2 = C.step(G, 1, 1, 8);
console.log(JSON.stringify({ first: { gain: e1.gain, combo: e1.combo }, second: { gain: e2.gain, comboShown: e2.combo, helpFormulaWouldGive: 1 + Math.round(10 * (1 + 0.5 * e2.combo)) } }));
