// Loads the banqi engine (CORE markers). BANQI_APP overrides the file (use a frozen copy while editing the app).
const fs = require('fs'), path = require('path');
const APP = process.env.BANQI_APP || path.resolve(__dirname, '../../../apps/banqi/index.html');
const html = fs.readFileSync(APP, 'utf8');
const BQ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BQ;')();
module.exports = { BQ, html, APP };
