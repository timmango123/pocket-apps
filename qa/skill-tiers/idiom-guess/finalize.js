// merges raw-results-before.json (+ raw-results-after.json as afterFix) and findings.json into results.json
const fs = require('fs'), path = require('path');
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const raw = rd('raw-results-before.json'), findings = rd('findings.json');
const tiers = r => { const o = {}; for (const [t, v] of Object.entries(r.tiers)) o[t] = { runs: v.runs, summary: { ...v.summary, pageErrors: v.errors.length, inputStats: v.stats }, errors: v.errors }; return o; };
const out = { game: raw.game, testedLevels: raw.testedLevels, timeCap: '300 s simulated per attempt (thinking pauses replayed at 0.3× real time; the game has no clock)', knowledge: raw.knowledge,
  wallSeconds: Math.round(raw.wallMs / 1000), tiers: tiers(raw), probe: raw.probe, findings };
if (fs.existsSync(path.join(__dirname, 'raw-results-after.json'))) {
  const a = rd('raw-results-after.json');
  out.afterFix = { date: '2026-10-18', changes: [
    'levelConfig: tray 8→10→12→14→16→18→21 keys, guesses 6 (L1–35) → 5 (L36–65) → 4 (L66–100), meaning after 0/1/2/3 guesses then paid only (L81+), look-alike distractors from L26; at most two dials step between neighbouring levels',
    'a loss on a level stores PROG.fails[n]; the retry uses variant k = another idiom of the same rarity (levelIdiom(n, k), levelSeed(n, k)), so the answer shown on the loss card cannot be typed back in',
    'replays pay a token reward (levels already cleared: 5; today\'s daily again: 0) and leave the daily record alone',
    'leaving a round keeps it: reopening the same level / daily / practice resumes (grid tile shows a dot)',
    'a row already guessed is refused with a note instead of costing a guess',
    'the whole meaning bar (≥44 px) is the 看釋義 tap target; keys are 52 px tall on screens ≥700 px high',
    'result overlays use a plain scrim instead of backdrop blur (win sequence 44 → 58 fps on the loaded test machine)'],
    wallSeconds: Math.round(a.wallMs / 1000), tiers: tiers(a), probe: a.probe };
  if (fs.existsSync(path.join(__dirname, 'check-clumsy.json'))) { const c = rd('check-clumsy.json'); out.afterFix.clumsyRecheck = { note: 'clumsy L75/L99/L100 rerun with a page-side touch/click log to explain apparent drops', summary: c.tiers.clumsy.summary, runs: c.tiers.clumsy.runs.map(r => ({ level: r.level, cleared: r.cleared, tries: r.tries })), dropLog: c.dropLog }; }
  if (fs.existsSync(path.join(__dirname, 'sim-all-levels.json'))) out.afterFix.modelAllLevels = rd('sim-all-levels.json');
}
if (fs.existsSync(path.join(__dirname, 'raw-results-after2.json'))) {
  const a2 = rd('raw-results-after2.json');
  out.afterReview = { date: '2026-10-18', note: 'rerun after the independent review fixes (sha 5ffb5ddfa53c failed: 穩定 8.9)', changes: [
    'unfinished rounds saved per slot (lv<n>/daily/free) in localStorage key rounds on every change and restored on open: refresh, a killed tab or playing another level no longer resets a round, so a loss cannot be dodged',
    'free practice: a loss offers 再來一題 with a different idiom (never the one just revealed)',
    '揭開一字 / 排除三字 cost one star each; star thresholds follow the chances (6: 2/4, 5 and 4: 2/3)',
    'confusing trays (L26+) always contain a second real idiom sharing characters with the answer (450/450 level variants; was 33/600 overall)',
    'toast on the level list sits at the bottom; help card text scrolls with the switches and 知道了 pinned; dark grey tiles contrast >= 4.5; landscape HUD on the right column with taller keys; full-row tap feedback; title/help/daily texts fixed',
    'bot: reads revealed slots (a stray 揭開一字 purchase used to make it delete forever); restarts after the time cap start a fresh round'],
    wallSeconds: Math.round(a2.wallMs / 1000), tiers: tiers(a2), probe: a2.probe, dropLog: a2.dropLog, hangs: a2.hangs };
}
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 1));
const line = r => Object.entries(r).map(([t, v]) => t + ':' + v.summary.cleared).join(' ');
console.log('before', line(out.tiers)); if (out.afterFix) console.log('after ', line(out.afterFix.tiers)); if (out.afterReview) console.log('review', line(out.afterReview.tiers));
