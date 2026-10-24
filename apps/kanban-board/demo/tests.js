// 看板待辦 tests: core logic (CORE markers of ../index.html) + real touch drag/tap flows in Chromium via CDP.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const SRC = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(SRC, 'utf8');
const KB = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return KB;')();
let pass = 0, fail = 0;
function ok(c, msg){ if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = Date.UTC(2026, 9, 18, 4, 0, 0);
const mkBoard = (a, b, c) => ({id:'b', name:'t', cols:[a, b, c].map(l => l.map(t => ({id:t, title:t, note:'', due:null, color:null, created:NOW, doneAt:null})))});
const titles = b => b.cols.map(l => l.map(c => c.id).join('')).join('|');

/* ---- dates (independent: JS Date arithmetic in UTC) ---- */
{
  const ref = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  for (const [s, n] of [['2026-10-18', 1], ['2026-12-31', 1], ['2024-02-28', 1], ['2025-02-28', 1], ['2026-03-01', -1], ['2026-10-18', 365], ['2026-01-01', -1], ['2028-02-29', 7]])
    ok(KB.addDays(s, n) === ref(s, n), `addDays ${s} ${n} = ${ref(s, n)}`);
  ok(KB.validDate('2026-02-29') === null && KB.validDate('2024-02-29') === '2024-02-29', 'leap day validation');
  ok(KB.validDate('2026-13-01') === null && KB.validDate('2026-00-10') === null && KB.validDate('2026-04-31') === null, 'invalid month/day rejected');
  ok(KB.validDate('2026/1/5') === '2026-01-05' && KB.validDate('2026-10-18T09:00:00Z') === '2026-10-18', 'slash dates and ISO timestamps accepted');
  ok(KB.validDate('') === null && KB.validDate('tomorrow') === null && KB.validDate(20261018) === null && KB.validDate('1899-12-31') === null, 'garbage dates rejected');
  ok(KB.weekday('2026-10-18') === '日' && KB.weekday('2026-10-24') === '六' && KB.weekday('2000-01-01') === '六', 'weekday (2026-10-18 is Sunday)');
  ok(KB.nextMonday('2026-10-18') === '2026-10-19' && KB.nextMonday('2026-10-19') === '2026-10-26' && KB.nextMonday('2026-10-24') === '2026-10-26', 'next Monday');
  const T = '2026-10-18', di = (d, done) => KB.dueInfo(d, T, done);
  ok(di('2026-10-17').text === '逾期 1 天' && di('2026-10-17').level === 'over', 'yesterday = overdue 1 day');
  ok(di('2025-10-18').text === '逾期 365 天', 'a year overdue = 365 days');
  ok(di(T).text === '今天到期' && di('2026-10-19').text === '明天到期' && di('2026-10-20').text === '後天到期', 'today / tomorrow / day after');
  ok(di('2026-10-24').text === '10/24（六）' && di('2026-10-24').diff === 6, '6 days later shows date with weekday');
  ok(di('2027-01-02').text === '2027/1/2（六）', 'next year shows the year');
  ok(di('2026-10-01', true).level === 'done' && di('2026-10-01', true).text === '10/1（四）', 'done cards are never overdue');
  ok(KB.dueInfo(null, T) === null, 'no due date -> nothing');
}
/* ---- titles & line parsing ---- */
{
  ok(KB.normTitle('  a \n\t b  ') === 'a b', 'title whitespace collapsed');
  ok(KB.normTitle('派對\u200b準備') === '派對準備' && KB.normTitle('\ufeffA\u2060B') === 'AB', 'zero-width space / word joiner / BOM removed, not turned into spaces');
  ok(KB.normTitle('👨\u200d👩\u200d👧 家') === '👨\u200d👩\u200d👧 家', 'emoji ZWJ sequences kept intact');
  {
    const longLine = '長'.repeat(350);
    const pl = KB.parseLines('短\n' + longLine);
    ok(pl[1].title === '長'.repeat(300) && pl[1].note === longLine && pl[0].note === '', 'line over 300 chars: title cut, full text kept in note');
    const cc = KB.cleanCard({title:'x'.repeat(310), note:'舊備註'}, NOW, false, {});
    ok(cc.title.length === 300 && cc.note === 'x'.repeat(310) + '\n\n舊備註', 'import: long title overflow prepended to note');
    const lines400 = Array.from({length:400}, (_, i) => '第' + (i + 1) + '項 準備資料與文件').join('\n');
    ok(lines400.length > 5000 && KB.parseLines(lines400).length === 400 && KB.parseLines(lines400)[399].title === '第400項 準備資料與文件', '400-line paste (>5000 chars) parses to 400 full titles');
  }
  ok(KB.normTitle('   ') === '' && KB.normTitle(null) === '' && KB.normTitle('​') === '', 'blank titles are empty');
  const long = '😀'.repeat(400);
  ok(Array.from(KB.normTitle(long)).length === 300 && !/\ud83d$/.test(KB.normTitle(long)), 'title cut at 300 chars without splitting emoji');
  ok(KB.normTitle('<b>"&\'</b>') === '<b>"&\'</b>', 'special characters kept verbatim (escaped only when shown)');
  const L = KB.parseLines('- 買牛奶\n* 繳電話費\n\n1. 寄包裹\n2) 回信\n[ ] 讀書\n[x] 洗衣服\n☑ 倒垃圾\n• 運動\n   \n普通一行');
  ok(eq(L.map(x => x.title), ['買牛奶', '繳電話費', '寄包裹', '回信', '讀書', '洗衣服', '倒垃圾', '運動', '普通一行']), 'bullets, numbers and checkboxes stripped, blank lines skipped');
  ok(eq(L.map(x => x.done), [false, false, false, false, false, true, true, false, false]), '[x] and ☑ marked done');
  ok(eq(KB.parseLines('2026 年計畫').map(x => x.title), ['2026 年計畫']) && eq(KB.parseLines('3.5 公斤').map(x => x.title), ['3.5 公斤']), 'numbers that are not list markers kept');
  ok(KB.parseLines('a\r\nb\rc').length === 3, 'CRLF / CR line endings');
}
/* ---- move ---- */
{
  let b = mkBoard(['A', 'B', 'C'], ['D'], []);
  ok(KB.move(b, 'A', 0, 2) && titles(b) === 'BCA|D|', 'move within column to the end');
  ok(KB.move(b, 'A', 0, 0) && titles(b) === 'ABC|D|', 'move within column to the top');
  ok(!KB.move(b, 'A', 0, 0), 'no-op move returns false');
  ok(KB.move(b, 'B', 1, 1) && titles(b) === 'AC|DB|', 'cross-column move at index');
  ok(KB.move(b, 'C', 2, 99, NOW) && titles(b) === 'A|DB|C' && b.cols[2][0].doneAt === NOW, 'index clamped; entering 完成 stamps doneAt');
  ok(KB.move(b, 'C', 0, -5) && titles(b) === 'CA|DB|' && b.cols[0][0].doneAt === null, 'negative index clamped; leaving 完成 clears doneAt');
  ok(!KB.move(b, 'zz', 1, 0) && !KB.move(b, 'A', 3, 0), 'unknown card / column rejected');
  ok(eq(KB.counts(b), [2, 2, 0]), 'counts');
}
/* ---- import: 20+ inputs with known answers ---- */
{
  const P = t => KB.parseImport(t, NOW);
  const cases = [
    ['', 'error'], ['   \n ', 'error'], ['{', 'error'], ['{"boards":[', 'error'], ['[]', 'error'], ['{}', 'error'], ['null', 'error'], ['42', 'error'], ['"text"', 'error'],
    ['{"boards":[]}', 'error'], ['{"boards":[1,2]}', 'error'], ['[1,2,3]', 'error'], ['{"foo":{"bar":1}}', 'error'],
  ];
  for (const [t, want] of cases) ok(!!P(t).error, `import rejects ${JSON.stringify(t)} with a message`);
  ok(/第 2 行/.test(P('{\n "boards": [,]\n}').error || ''), 'JSON error reports the line');
  let r = P('買牛奶\n- 繳費\n[x] 洗碗');
  ok(r.plain && r.boards.length === 1 && eq(KB.counts(r.boards[0]), [2, 0, 1]), 'plain text list -> board with todo/done');
  r = P('["a", {"title":"b"}, {"name":"c"}, {"title":"   "}]');
  ok(r.cards === 3 && r.skipped === 1 && eq(KB.counts(r.boards[0]), [3, 0, 0]), 'array of titles/cards; blank title skipped');
  r = P(JSON.stringify({name:'X', cards:[{title:'a', status:'done'}, {title:'b', column:'進行中'}, {title:'c', col:1}, {title:'d', status:'weird'}, {title:'e', done:true}]}));
  ok(eq(KB.counts(r.boards[0]), [1, 2, 2]) && r.boards[0].name === 'X', 'flat cards with status/column names');
  r = P(JSON.stringify({name:'', columns:[{key:'done', cards:[{title:'z', due:'2026-02-30', color:'pink', note:{x:1}}]}]}));
  const z = r.boards[0].cols[2][0];
  ok(r.boards[0].name === '未命名看板' && z.due === null && z.color === null && z.note === '' && z.doneAt === NOW, 'bad due/color/note dropped, done stamped, empty name defaulted');
  r = P(JSON.stringify({boards:[{name:'🍣 午餐', columns:[{name:'待辦', cards:[{title:'訂位 <script>', due:'2026-10-20', color:'red', note:'電話 02-1234\n第二行'}]}]}]}));
  const s = r.boards[0].cols[0][0];
  ok(r.boards[0].name === '🍣 午餐' && s.title === '訂位 <script>' && s.due === '2026-10-20' && s.color === 'red' && s.note === '電話 02-1234\n第二行', 'emoji, html-ish text, multi-line note preserved');
  const big = {boards:[{name:'big', cards:Array.from({length:3100}, (_, i) => ({title:'t' + i}))}]};
  r = P(JSON.stringify(big));
  ok(r.cards === 3000 && r.skipped === 100 && r.capped === 100, 'per-board card cap 3000 enforced with skipped count');
  ok(/3000 張卡片。/.test(KB.importSummary(r)) && /100 張超過每個看板 3000 張的上限/.test(KB.importSummary(r)), 'summary names cards dropped by the cap');
  r = P(JSON.stringify({boards:[{name:'a', cards:['x', '  ']}, 5, ...Array.from({length:101}, (_, i) => ({name:'b' + i, cards:[]}))]}));
  const sum = KB.importSummary(r);
  ok(r.boards.length === 100 && r.badBoards === 1 && r.overBoards === 2 && /1 張沒有標題/.test(sum) && /1 個看板格式不對/.test(sum) && /2 個看板超過 100 個的上限/.test(sum), 'summary names blank cards, bad boards and boards over the limit: ' + sum);
  ok(!!P('x'.repeat(10 * 1024 * 1024 + 1)).error, '>10 MB rejected');
  ok(P('﻿' + JSON.stringify({boards:[{name:'a', cols:[['x'], [], []]}]})).cards === 1, 'BOM tolerated, internal format accepted');
  // round trip
  const st = {cur:'b1', boards:[{id:'b1', name:'工作', cols:[[{id:'c1', title:'寫報告', note:'n', due:'2026-11-01', color:'blue', created:1, doneAt:null}], [], [{id:'c2', title:'開會', note:'', due:null, color:null, created:2, doneAt:5}]]}, {id:'b2', name:'空的', cols:[[], [], []]}]};
  const back = P(JSON.stringify(KB.exportData(st, NOW)));
  const strip = b => b.map(x => ({name:x.name, cols:x.cols.map(l => l.map(c => ({t:c.title, n:c.note, d:c.due, c:c.color, cr:c.created, da:c.doneAt})))}));
  ok(eq(strip(back.boards), strip(st.boards)), 'export -> import round trip is lossless');
  ok(new Set(back.boards.flatMap(b => b.cols.flat().map(c => c.id))).size === 2 && back.boards[0].id !== 'b1', 'imported ids are fresh');
  // loadState keeps ids and drops duplicates
  const ls = KB.loadState({cur:'nope', boards:[{id:'b1', name:'a', cols:[[{id:'x', title:'1'}, {id:'x', title:'2'}], [], []]}, 'junk']}, NOW);
  ok(ls.cur === 'b1' && ls.boards.length === 1 && ls.boards[0].cols[0][0].id === 'x' && ls.boards[0].cols[0][1].id !== 'x', 'loadState keeps ids, fixes duplicates, falls back cur');
  ok(KB.loadState({boards:'x'}) === null && KB.loadState(null) === null, 'loadState rejects garbage');
  const sm = KB.sample('2026-10-18', NOW);
  ok(sm.sample && eq(KB.counts(sm), [5, 2, 2]) && sm.cols[1][0].due === '2026-10-18', 'sample board');
}

/* ---- browser: real touch input ---- */
(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const WRAP = path.resolve(__dirname, '_wrapped.html');
  fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + html + '</body></html>');
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({viewport:{width:390, height:610}, isMobile:true, hasTouch:true, deviceScaleFactor:2});
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('file://' + WRAP); await p.waitForSelector('html[data-ready="1"]');
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y, id:1}]});
  const wait = ms => p.waitForTimeout(ms);
  const center = async sel => { const r = await p.locator(sel).first().boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
  const ids = () => p.evaluate(() => __kb.board().cols.map(l => l.map(c => c.title)));
  async function drag(from, to, opts = {}){
    const [x, y] = from; await touch('touchStart', x, y); await wait(opts.hold || 420);
    const steps = 12;
    for (let i = 1; i <= steps; i++){ await touch('touchMove', x + (to[0] - x) * i / steps, y + (to[1] - y) * i / steps); await wait(16); }
    if (opts.dwell) for (let t = 0; t < opts.dwell; t += 50){ await touch('touchMove', to[0] + (t % 100 ? 1 : 0), to[1]); await wait(50); }
    if (opts.then) for (const pt of opts.then){ await touch('touchMove', pt[0], pt[1]); await wait(pt[2] || 60); }
    await touch('touchEnd'); await wait(400);
  }
  let before = await ids();
  // 1. long-press drag first todo card below the third
  const c0 = await center('#col0 .card >> nth=0'), c2 = await p.locator('#col0 .card >> nth=2').boundingBox();
  await drag(c0, [c0[0], c2.y + c2.height * 0.75]);
  let after = await ids();
  ok(eq(after[0], [before[0][1], before[0][2], before[0][0], ...before[0].slice(3)]), 'touch drag reorders within column: ' + after[0].slice(0, 3).join(','));
  ok(await p.locator('.sheet').count() === 0, 'drag does not open the card sheet');
  ok(await p.locator('.ghost').count() === 0 && await p.locator('.card.ph').count() === 0, 'no ghost/placeholder left behind');
  // 2. a quick swipe (no long-press) scrolls instead of dragging
  before = after;
  const s0 = await center('#col0 .card >> nth=1');
  await touch('touchStart', s0[0], s0[1]); for (let i = 1; i <= 6; i++){ await touch('touchMove', s0[0], s0[1] - i * 12); await wait(16); } await touch('touchEnd'); await wait(300);
  ok(eq(await ids(), before), 'quick swipe does not move cards');
  // 3. drag to right edge -> switches to 進行中 and drops there
  const e0 = await center('#col0 .card >> nth=0'), title0 = before[0][0];
  await drag(e0, [384, 330], {dwell:450, then:[[200, 330, 400], [200, 330, 100]]});
  after = await ids();
  ok(after[1].includes(title0) && !after[0].includes(title0), 'edge drag moves card to 進行中');
  ok(await p.evaluate(() => __kb.curCol) === 1, 'board scrolled to 進行中');
  // 4. drop on a tab
  const card1 = await center('#col1 .card >> nth=0'), tab2 = await center('#tab2');
  const t1 = after[1][0];
  await drag(card1, tab2, {dwell:100});
  after = await ids();
  ok(after[2][0] === t1, 'dropping on 完成 tab puts the card on top of 完成');
  ok(await p.evaluate(t => __kb.board().cols[2][0].doneAt > 0, t1), 'doneAt set');
  // 5. undo restores
  await p.click('#undoBtn'); await wait(200);
  ok((await ids())[1][0] === t1, 'undo puts it back');
  await p.click('#redoBtn'); await wait(200);
  ok((await ids())[2][0] === t1, 'redo re-applies');
  // 6. tap opens the sheet, "move to" fallback works
  await p.evaluate(() => __kb.goCol(0, true)); await wait(100);
  const tap = await center('#col0 .card .ct >> nth=0');
  await touch('touchStart', tap[0], tap[1]); await wait(60); await touch('touchEnd'); await wait(400);
  ok(await p.locator('.sheet.on').count() === 1, 'tap opens the card sheet');
  const tt = (await ids())[0][0];
  await p.click('.sheet #dCol [data-col="1"]'); await wait(100);
  await p.click('.sheet [data-close] >> nth=0'); await wait(350);
  ok((await ids())[1][0] === tt, 'sheet 欄位 buttons move the card');
  // 7. rapid taps 8/s on ▶ buttons, alternating with tab taps: every tap counted exactly once
  await p.evaluate(() => { const b = __kb.board(); b.cols[0] = Array.from({length:12}, (_, i) => ({id:'r' + i, title:'快速 ' + i, note:'', due:null, color:null, created:1, doneAt:null})); b.cols[1] = []; __kb.render(); __kb.goCol(0, true); });
  await wait(200);
  const adv = await center('#col0 .card .adv >> nth=0');
  for (let i = 0; i < 8; i++){ await touch('touchStart', adv[0], adv[1]); await wait(30); await touch('touchEnd'); await wait(95); }
  await wait(300);
  after = await ids();
  ok(after[0].length === 4 && after[1].length === 8, `8 rapid taps on ▶ moved exactly 8 cards (${after[1].length})`);
  ok(eq(after[1], ['快速 7', '快速 6', '快速 5', '快速 4', '快速 3', '快速 2', '快速 1', '快速 0']), 'moved in tap order');
  const [ta, tb] = [await center('#tab1'), await center('#tab0')];
  for (let i = 0; i < 8; i++){ const pt = i % 2 ? tb : ta; await touch('touchStart', pt[0], pt[1]); await wait(30); await touch('touchEnd'); await wait(95); }
  await wait(600);
  ok(await p.evaluate(() => __kb.curCol) === 0, 'alternating tab taps end on the last tapped tab');
  for (let i = 0; i < 8; i++){ await touch('touchStart', ...(await center('#undoBtn'))); await wait(30); await touch('touchEnd'); await wait(95); }
  await wait(300);
  after = await ids();
  ok(after[0].length === 12 && after[1].length === 0, '8 rapid undo taps undo exactly 8 moves');
  // 8. composer: multi-line paste, persistence across reload
  await p.click('#col0 [data-add]');
  await p.fill('#col0 .composer textarea', '- 甲\n- 乙\n[x] 丙');
  await p.click('#col0 [data-cadd]'); await wait(150);
  after = await ids();
  ok(after[0][0] === '甲' && after[0][1] === '乙' && after[2][0] === '丙', 'pasted list -> 2 todo + 1 done, in order');
  await p.fill('#col0 .composer textarea', '還沒送出的草稿');
  await p.reload(); await p.waitForSelector('html[data-ready="1"]'); await wait(200);
  ok((await ids())[0][0] === '甲', 'cards persist after reload');
  ok(await p.inputValue('#col0 .composer textarea') === '還沒送出的草稿', 'unsent draft survives reload');
  // 9. 1000 cards render fast
  const t = await p.evaluate(() => { const b = __kb.board(); b.cols[0] = Array.from({length:1000}, (_, i) => ({id:'m' + i, title:'第 ' + i + ' 張卡片，有點長的標題測試換行顯示', note:i % 3 ? '' : 'x', due:i % 5 ? null : '2026-10-' + String(1 + i % 28).padStart(2, '0'), color:['red', null, 'blue'][i % 3], created:1, doneAt:null})); const t0 = performance.now(); __kb.render(); return performance.now() - t0; });
  ok(t < 250, `render 1000 cards in ${t.toFixed(0)} ms`);
  const t2 = await p.evaluate(() => new Promise(res => { const t0 = performance.now(); document.querySelector('#col0 .card .adv').click(); requestAnimationFrame(() => setTimeout(() => res(performance.now() - t0), 0)); }));
  console.log(`    1000 cards: render ${t.toFixed(0)} ms, ▶ to next frame ${t2.toFixed(0)} ms`);
  ok(t2 < 100, `advance with 1000 cards: ${t2.toFixed(0)} ms`);
  // 9b. long columns render in pages of 200
  ok(await p.locator('#col0 .card').count() === 200 && (await p.textContent('#col0 [data-more]')).includes('還有 799 張'), 'long column shows 200 cards + "show more"');
  await p.click('#col0 [data-more]'); await wait(100);
  ok(await p.locator('#col0 .card').count() === 400, 'show more adds 200');
  // 11. big paste through the composer is never truncated
  await p.evaluate(() => { const b = __kb.board(); b.cols = [[], [], []]; __kb.render(); __kb.goCol(0, true); });
  if (await p.isVisible('#col0 [data-add]')) await p.click('#col0 [data-add]');
  ok(await p.getAttribute('#col0 .composer textarea', 'maxlength') === null && await p.getAttribute('#col0 .composer textarea', 'enterkeyhint') === 'enter', 'composer has no maxlength; Enter key labelled as enter');
  const lines400 = Array.from({length:400}, (_, i) => '第' + (i + 1) + '項 準備資料與文件').join('\n') + '\n' + '超'.repeat(320);
  await p.fill('#col0 .composer textarea', lines400); await p.click('#col0 [data-cadd]'); await wait(200);
  after = await p.evaluate(() => __kb.board().cols[0]);
  ok(after.length === 401 && after[399].title === '第400項 準備資料與文件' && after[400].title === '超'.repeat(300) && after[400].note === '超'.repeat(320), `5,800-char paste -> 401 cards, long line kept in note (${after.length})`);
  ok((await p.textContent('#toastMsg')).includes('完整內容放在備註'), 'toast mentions the long title');
  await p.evaluate(() => { const b = __kb.board(); b.cols[1] = Array.from({length:2590}, (_, i) => ({id:'f' + i, title:'f' + i, note:'', due:null, color:null, created:1, doneAt:null})); __kb.render(); });
  await p.fill('#col0 .composer textarea', Array.from({length:20}, (_, i) => 'over' + i).join('\n')); await p.click('#col0 [data-cadd]'); await wait(150);
  ok(await p.evaluate(() => __kb.board().cols[0].length) === 401 && (await p.inputValue('#col0 .composer textarea')).startsWith('over0') && (await p.textContent('#toastMsg')).includes('3000 張的上限'), 'over the 3000 cap: nothing added, text kept, reason shown');
  await p.fill('#col0 .composer textarea', ''); await p.keyboard.press('Escape');
  // 12. toast is hidden / moved when a sheet opens; toast text does not wrap per character
  await p.evaluate(() => { const b = __kb.board(); b.cols = [[{id:'t1', title:'吐司測試', note:'', due:null, color:null, created:1, doneAt:null}], [], []]; __kb.render(); });
  await p.click('#col0 .card .adv'); await wait(250);
  ok(await p.isVisible('#toastAct'), 'undo toast shown');
  await p.click('#boardBtn'); await wait(350);
  ok(!(await p.evaluate(() => document.getElementById('toast').classList.contains('on'))), 'opening a sheet hides the toast');
  await p.fill('#bNew', 'x'); await p.click('#bAdd'); await wait(150); await p.click('#boardBtn'); await wait(350);
  await p.click('#bList [data-board] >> nth=0'); await wait(350);
  await p.click('#menuBtn'); await wait(350); await p.click('#mCopy'); await wait(200);
  ok(!(await p.evaluate(() => document.getElementById('toast').classList.contains('on'))) && (await p.textContent('.sheet .snote')).length > 4 && await p.isVisible('.sheet .snote'), 'message while a sheet is open shows inside the sheet, not over its buttons');
  await p.keyboard.press('Escape'); await wait(300);
  const smallT = await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && r.height && b.offsetParent && (r.width < 44 || r.height < 44); }).map(b => b.id || b.className));
  ok(!smallT.length, 'every visible button >= 44px: ' + smallT.join(','));
  // 13. rotation keeps the column
  await p.evaluate(() => __kb.goCol(1, true)); await wait(200);
  await p.setViewportSize({width:844, height:390}); await wait(400);
  await p.setViewportSize({width:390, height:610}); await wait(500);
  ok(await p.evaluate(() => __kb.curCol) === 1 && await p.getAttribute('#tab1', 'aria-selected') === 'true', 'portrait -> landscape -> portrait stays on 進行中');
  // 14. detail title over 300 chars warns
  await p.click('#col1 .card >> nth=0'); await wait(350);
  await p.fill('#dTitle', '題'.repeat(320)); await wait(50);
  ok((await p.textContent('#dTitleErr')).includes('超出的 20 字不會保存'), 'detail title over 300 chars says how much will be dropped');
  await p.fill('#dNote', '註'.repeat(5003)); await wait(50);
  ok((await p.textContent('#dNoteErr')).includes('超出的 3 字'), 'note over 5000 chars says so');
  await p.keyboard.press('Escape'); await wait(300);
  // 15. two tabs: a sync clears undo history so undo cannot wipe the other tab's work
  {
    await p.evaluate(() => { __kb.board().cols[0].unshift({id:'two', title:'兩分頁', note:'', due:null, color:null, created:1, doneAt:null}); __kb.render(); __kb.goCol(0, true); });
    const p2 = await ctx.newPage(); p2.on('pageerror', e => errors.push(e.message));
    await p2.goto('file://' + WRAP); await p2.waitForSelector('html[data-ready="1"]');
    await p2.click('#col0 .card .adv'); await wait(200);
    ok(!(await p2.isDisabled('#undoBtn')), 'tab B has an undo step');
    await p.bringToFront(); if (await p.isVisible('#col0 [data-add]')) await p.click('#col0 [data-add]'); else await p.focus('#col0 .composer textarea'); await p.keyboard.type('A 分頁新增'); await p.keyboard.press('Enter'); await wait(300);
    ok(await p2.isDisabled('#undoBtn') && await p2.isDisabled('#redoBtn'), 'tab B: undo/redo cleared after syncing tab A');
    ok(await p2.evaluate(() => __kb.board().cols[0].some(c => c.title === 'A 分頁新增')), 'tab B sees the new card');
    await p2.close();
  }
  // 16. corrupt save: banner + download of the raw data
  await p.evaluate(() => localStorage.setItem(__kb.KEY, '{"boards":[{"name":"壞'));
  await p.reload(); await p.waitForSelector('html[data-ready="1"]');
  ok(await p.isVisible('#corruptBar') && await p.isVisible('#corruptDl'), 'corrupt save: banner with download shown');
  const dl = p.waitForEvent('download', {timeout:3000}).catch(() => null);
  await p.click('#corruptDl'); const d = await dl;
  ok(d && fs.readFileSync(await d.path(), 'utf8') === '{"boards":[{"name":"壞', 'raw damaged data downloads byte for byte');
  // 10. landscape (three columns): touch drag across columns
  {
    const c2 = await browser.newContext({viewport:{width:844, height:390}, isMobile:true, hasTouch:true});
    const q = await c2.newPage(); q.on('pageerror', e => errors.push(e.message));
    await q.goto('file://' + WRAP); await q.waitForSelector('html[data-ready="1"]');
    const cd = await c2.newCDPSession(q);
    const T = (type, x, y) => cd.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y, id:1}]});
    const ttl = await q.evaluate(() => __kb.board().cols[0][0].title);
    const a = await q.locator('#col0 .card').first().boundingBox(), dst = await q.locator('#col1 .card').first().boundingBox();
    const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2, x1 = dst.x + dst.width / 2, y1 = dst.y + dst.height * 0.25;
    await T('touchStart', x0, y0); await q.waitForTimeout(420);
    for (let i = 1; i <= 15; i++){ await T('touchMove', x0 + (x1 - x0) * i / 15, y0 + (y1 - y0) * i / 15); await q.waitForTimeout(16); }
    await q.waitForTimeout(100); await T('touchEnd'); await q.waitForTimeout(400);
    ok(await q.evaluate(t => __kb.board().cols[1][0].title === t, ttl), 'landscape: touch drag to the top of 進行中');
    // mouse drag (desktop) to the end of 完成
    await q.setViewportSize({width:1280, height:800}); await q.waitForTimeout(200);
    const m = await q.locator('#col1 .card').first().boundingBox(), dn = await q.locator('#col2 .list').boundingBox();
    await q.mouse.move(m.x + 40, m.y + 20); await q.mouse.down();
    await q.mouse.move(m.x + 60, m.y + 30, {steps:3}); await q.mouse.move(dn.x + 100, dn.y + dn.height - 80, {steps:12}); await q.waitForTimeout(100); await q.mouse.up(); await q.waitForTimeout(400);
    ok(await q.evaluate(t => { const c = __kb.board().cols[2]; return c[c.length - 1].title === t && c[c.length - 1].doneAt > 0; }, ttl), 'desktop: mouse drag to the end of 完成');
    ok(await q.locator('.sheet').count() === 0, 'mouse drag does not open the sheet');
    await c2.close();
  }
  ok(errors.length === 0, 'no page/console errors: ' + errors.join(' | '));
  await browser.close();
  try { fs.unlinkSync(WRAP); } catch (e) {}
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
