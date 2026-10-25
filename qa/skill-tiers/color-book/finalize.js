// Turns raw.json (from bot.js) into results.json + the table in notes.md.  node finalize.js
const fs = require('fs'), path = require('path');
const D = __dirname, raw = JSON.parse(fs.readFileSync(path.join(D, 'raw.json'), 'utf8'));
const findings = JSON.parse(fs.readFileSync(path.join(D, 'findings.json'), 'utf8'));
const NAMES = { clumsy: '手殘', casual: '普通', skilled: '熟練', world: '世界級', superhuman: '非人' };
const tiers = {};
for (const t of Object.keys(NAMES)) {
  const runs = raw[t] || []; if (!runs.length) continue;
  const sum = k => runs.reduce((a, r) => a + (r[k] || 0), 0), regions = sum('regions');
  tiers[t] = { runs, summary: {
    cleared: `${runs.filter(r => r.cleared).length}/${runs.length}`,
    totalSimMin: +sum('simMin').toFixed(1),
    secPerRegion: +(sum('simMin') * 60 / regions).toFixed(2),
    wrongPer100: +(sum('wrong') * 100 / regions).toFixed(1),
    deadPer100: +(sum('dead') * 100 / regions).toFixed(1),
    zoomsPer100: +(sum('zooms') * 100 / regions).toFixed(1),
    hints: sum('hints'), stuck: sum('stuck'), pageErrors: sum('errors') || runs.reduce((a, r) => a + r.errors.length, 0),
  } };
}
const out = { game: 'color-book', note: '填色本沒有輸贏：「完成」= 在牆鐘上限內塗完整張；時間是模擬的人類時間（反應、找、手勢），不是牆鐘。', tiers, findings };
fs.writeFileSync(path.join(D, 'results.json'), JSON.stringify(out, null, 1));
let md = '| 等級 | No. | 圖（塊） | 完成 | 時間 | 秒/塊 | 點錯 | 空點 | 縮放 | 提示 | 卡住 |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const t in tiers) for (const r of tiers[t].runs) md += `| ${NAMES[t]} | ${r.level} | ${r.name}（${r.regions}） | ${r.cleared ? '✓' : '✗ ' + (r.filledPct || '') + '%'} | ${r.simMin} 分 | ${r.secPerRegion} | ${r.wrong} | ${r.dead} | ${r.zooms} | ${r.hints} | ${r.stuck} |\n`;
md += '\n| 等級 | 完成 | 總時間 | 秒/塊 | 點錯/100塊 | 空點/100塊 | 縮放/100塊 | 提示 | 卡住 |\n|---|---|---|---|---|---|---|---|---|\n';
for (const t in tiers) { const s = tiers[t].summary; md += `| ${NAMES[t]} | ${s.cleared} | ${s.totalSimMin} 分 | ${s.secPerRegion} | ${s.wrongPer100} | ${s.deadPer100} | ${s.zoomsPer100} | ${s.hints} | ${s.stuck} |\n`; }
console.log(md);
