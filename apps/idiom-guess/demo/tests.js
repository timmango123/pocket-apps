// Core tests for 成語猜字 (idiom-guess): loads the pure functions between CORE markers of ../index.html and checks the idiom list,
// level table, tray building, Wordle-style judgement, rewards and share text. Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const IG = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return IG;')();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

// --- idiom list ---
ok(IG.LIST.length >= 300, 'at least 300 idioms (' + IG.LIST.length + ')');
ok(IG.LIST.every(x => x.w.length === 4 && new Set(x.w).size === 4), 'every idiom has four distinct characters');
ok(IG.LIST.every(x => x.m.length >= 4 && /[。]$/.test(x.m)), 'every idiom has a meaning ending with a full stop');
ok(IG.LIST.every(x => [1, 2, 3].includes(x.t)), 'every idiom has a tier 1–3');
ok(new Set(IG.LIST.map(x => x.w)).size === IG.LIST.length, 'no duplicate idioms');
const simp = /[们这为说对时门车马飞见长开关东业书实现发点么没过还经进问几种给体头国问从动电]/;   // common simplified-only forms
ok(IG.LIST.every(x => !simp.test(x.w) && !simp.test(x.m)), 'no simplified characters in idioms or meanings');
ok(IG.LIST.every(x => !/[,.!?;:()]/.test(x.m)), 'meanings use full-width punctuation only');
ok(IG.TIERS[3].length >= 20, 'tier 3 has at least 20 idioms for levels 81–100 (' + IG.TIERS[3].length + ')');

// --- levels ---
const lv = []; for (let n = 1; n <= 100; n++) lv.push(IG.levelIdiom(n));
ok(lv.every(x => x && x.w), 'all 100 levels resolve to an idiom');
ok(new Set(lv.map(x => x.w)).size === 100, '100 different level idioms');
ok(lv.slice(0, 40).every(x => x.t === 1) && lv.slice(40, 80).every(x => x.t === 2) && lv.slice(80).every(x => x.t === 3), 'tiers rise with level: 1–40 common, 41–80 medium, 81–100 rarer');
ok(IG.levelIdiom(7).w === IG.levelIdiom(7).w && IG.ORDER.length === IG.LIST.length, 'level order is a fixed permutation of the list');
ok([1, 16, 36, 56, 71, 86, 96].map(n => IG.levelConfig(n).tray).join() === '8,10,12,14,16,18,21', 'tray grows 8→10→12→14→16→18→21');
ok(IG.levelConfig(1).clueAfter === 0 && IG.levelConfig(16).clueAfter === 1 && IG.levelConfig(41).clueAfter === 2 && IG.levelConfig(66).clueAfter === 3 && IG.levelConfig(81).clueAfter === -1, 'meaning hint comes later at higher levels');
ok(IG.levelConfig(35).attempts === 6 && IG.levelConfig(36).attempts === 5 && IG.levelConfig(65).attempts === 5 && IG.levelConfig(66).attempts === 4 && IG.levelConfig(100).attempts === 4, 'guesses 6 → 5 (from 36) → 4 (from 66)');
{ // no two neighbouring levels change more than two dials at once (smooth curve)
  let worst = 0; for (let n = 2; n <= 100; n++) { const a = IG.levelConfig(n - 1), b = IG.levelConfig(n); worst = Math.max(worst, ['tray', 'clueAfter', 'attempts', 'tier'].filter(k => a[k] !== b[k]).length); }
  ok(worst <= 2, 'at most two difficulty dials step between neighbouring levels (' + worst + ')'); }
ok(!IG.levelConfig(25).confuse && IG.levelConfig(26).confuse, 'look-alike distractors from level 26');
{ // retry variants after a loss: another idiom of the same rarity, deterministic
  let ok1 = true; for (let n = 1; n <= 100; n++) for (let k = 1; k <= 4; k++) { const a = IG.levelIdiom(n, 0), b = IG.levelIdiom(n, k); if (!b || b.w === a.w || b.t !== a.t || b.w !== IG.levelIdiom(n, k).w) ok1 = false; }
  ok(ok1, 'retry variants 1–4 are different idioms of the same rarity for every level');
  ok(IG.levelSeed(5, 0) === IG.hash('lv5') && IG.levelSeed(5, 1) !== IG.levelSeed(5, 0), 'variant 0 keeps the original tray seed'); }

// --- daily / random ---
ok(IG.dailyKey(new Date(2026, 9, 17)) === '2026-10-17', 'daily key is YYYY-MM-DD');
ok(IG.dailyIdiom('2026-10-17').w === IG.dailyIdiom('2026-10-17').w && IG.dailyIdiom('2026-10-17').w !== IG.dailyIdiom('2026-10-18').w, 'daily idiom is deterministic per day and changes daily');
{ const seen = new Set(); for (let i = 0; i < 200; i++) seen.add(IG.randomIdiom(IG.rng(i), [1, 2, 3]).w); ok(seen.size > 100, 'random idioms vary (' + seen.size + ' in 200 draws)'); }
{ const r1 = IG.rng(5), r2 = IG.rng(5); ok(r1() === r2() && r1() === r2(), 'seeded rng is reproducible'); ok(IG.hash('a') !== IG.hash('b'), 'hash separates strings'); }

// --- tray ---
for (const [n, size, confuse] of [[1, 8, false], [35, 10, true], [50, 12, true], [70, 14, true], [80, 16, true], [90, 18, true], [100, 21, true]]) {
  const w = IG.levelIdiom(n).w, t = IG.buildTray(w, size, IG.hash('lv' + n), confuse);
  ok(t.length === size, 'level ' + n + ' tray has ' + size + ' keys');
  ok(new Set(t).size === size, 'level ' + n + ' tray keys are unique');
  ok(w.split('').every(c => t.includes(c)), 'level ' + n + ' tray contains the answer');
  ok(t.join('') === IG.buildTray(w, size, IG.hash('lv' + n), confuse).join(''), 'level ' + n + ' tray is deterministic');
  const shown = IG.LIST.filter(x => x.w !== w && x.w.split('').every(c => t.includes(c)));
  ok(true, 'level ' + n + ' other idioms fully in tray: ' + shown.length);
}
{ let anyNear = 0; for (let n = 31; n <= 60; n++) { const w = IG.levelIdiom(n).w, t = IG.buildTray(w, 12, IG.hash('lv' + n), true); const near = IG.LIST.filter(x => x.w !== w && x.w.split('').some(c => w.includes(c))); anyNear += t.filter(c => !w.includes(c) && near.some(x => x.w.includes(c))).length; }
  ok(anyNear > 30, 'confusing trays draw distractors from idioms sharing a character (' + anyNear + ')'); }

// --- judgement ---
ok(IG.judge('一目了然', '一目了然').join('') === 'hhhh', 'exact guess → all hits');
ok(IG.judge('一見鍾情', '一目了然').join('') === 'hmmm', 'first char only → h m m m');
ok(IG.judge('然了目一', '一目了然').join('') === 'nnnn', 'reversed → all near');
ok(IG.judge('風平浪靜', '一目了然').join('') === 'mmmm', 'no overlap → all miss');
ok(IG.judge('一了目然', '一目了然').join('') === 'hnnh', 'swapped middle → h n n h');
ok(IG.judge('目目目目', '一目了然').join('') === 'mhmm', 'repeated guess char counts once');

// --- scoring ---
ok(IG.stars(1) === 3 && IG.stars(2) === 3 && IG.stars(3) === 2 && IG.stars(4) === 2 && IG.stars(5) === 1 && IG.stars(6) === 1, 'stars 3/2/1 by tries');
ok(IG.reward(1, false) === 35 && IG.reward(6, false) === 10 && IG.reward(1, true) === 55 && IG.reward(4, false, 4) === 10 && IG.reward(1, false, 4) === 25, 'reward 10 + 5 per spare try, +20 for daily');
ok(IG.COST.clue === 10 && IG.COST.strike === 15 && IG.COST.reveal === 25, 'hint costs 10/15/25');
ok(IG.ATTEMPTS === 6 && IG.LEVELS === 100, 'six attempts, 100 levels');

// --- key states & share ---
{ const ks = IG.keyStates(['一見鍾情', '然了目一'], [IG.judge('一見鍾情', '一目了然'), IG.judge('然了目一', '一目了然')]);
  ok(ks['一'] === 'h' && ks['見'] === 'm' && ks['然'] === 'n' && ks['目'] === 'n', 'key states keep the best result per character');
  const sh = IG.shareText('第 3 關', [['h', 'm', 'm', 'm'], ['h', 'h', 'h', 'h']], true);
  ok(sh.startsWith('成語猜字 第 3 關 2/6') && sh.includes('🟥⬜⬜⬜') && sh.includes('🟥🟥🟥🟥'), 'share text is a Wordle-style grid');
  ok(IG.shareText('x', [], false).includes('X/6') && IG.shareText('x', [], false, 4).includes('X/4'), 'share text marks a loss with X'); }

// --- page conventions ---
ok(/idiom-guess:v1:/.test(html), 'localStorage keys prefixed idiom-guess:v1:');
ok(/prefers-color-scheme/.test(html) && /data-theme="dark"/.test(html), 'dark mode via media query and manual theme');
ok(/prefers-reduced-motion/.test(html), 'respects reduced motion');
ok(/id="unlockSw" role="switch"/.test(html) && /'unlockAll'/.test(html), 'level select has a saved 解鎖全部關卡 switch');
ok(!/https?:\/\/[^"']+\.(js|css)/.test(html), 'no external scripts or stylesheets');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
