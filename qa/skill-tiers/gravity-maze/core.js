// Loads gravity-maze's own rules (CORE markers) and LEVELS from the app file, for the Node tier simulation.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(process.env.APP || path.join(__dirname, '../../../apps/gravity-maze/index.html'), 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {parseLevel, initState, rotate, fall, solve, isWin, stateKey};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
module.exports = { C, LEVELS, html };
