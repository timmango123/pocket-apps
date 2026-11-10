// Node-only helpers for the mini-golf skill tiers: loads the game's own core and levels from apps/mini-golf/index.html
// (or APP=...). The real-page bot lives in the reviewer folder; this is the pure-sim sweep used while tuning.
const fs = require('fs'), path = require('path');
const APP = process.env.APP || path.resolve(__dirname, '../../../apps/mini-golf/index.html');
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {buildLevel, initState, cloneState, simShot, solveLevel, replay, dragToShot, makeHeur, PULLMAX, holePos, stepTick};')();
const LEVELS = JSON.parse(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1]);
module.exports = { C, LEVELS, APP };
